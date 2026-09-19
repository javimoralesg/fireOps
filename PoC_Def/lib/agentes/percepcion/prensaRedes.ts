// =====================================================================
// Agente de prensa y redes. DUEÑO: constructor B.
// ---------------------------------------------------------------------
// Cada 180 s (y al nacer un incendio) busca "incendio forestal" y el municipio
// y la provincia de cada incendio activo en:
//   · Exa (si hay EXA_API_KEY: búsqueda semántica de noticias, 48 h)
//   · Google News RSS (sin clave)
//   · Bluesky (sin clave, api.bsky.app)
// Deduplica por URL/id en memoria, extrae con el modelo rápido a
// {esIncendio, municipio, provincia, resumen, gravedad, fiabilidad},
// geocodifica el municipio con Nominatim y crea Observaciones de canal
// "prensa" o "rrss" con su urlFuente. Máximo 10 ítems por ciclo.
// Solo se analizan publicaciones de los últimos 15 días: cada fuente ya
// aplica la ventana (lib/fuentes/recencia.ts) y aquí se vuelve a comprobar
// la fecha antes de gastar una llamada al modelo.
// =====================================================================
import { z } from "zod";
import type { Agente, ContextoAgente } from "../../motor/contratos";
import type { Observacion } from "../../dominio/tipos";
import { buscarPosts } from "../../fuentes/bluesky";
import { buscarNoticias, exaDisponible } from "../../fuentes/exa";
import { noticiasGoogle } from "../../fuentes/rss";
import { esReciente } from "../../fuentes/recencia";
import { geocodificar } from "../../fuentes/nominatim";
import { completarJson, proveedorDisponible } from "../../ia/llm";
import { nuevoId } from "../../motor/ids";

const MAX_ITEMS_CICLO = 6;
/** El orquestador aborta el ciclo a los 30 s: se para antes por las buenas. */
const MS_LIMITE_CICLO = 21_000;
const MAX_VISTOS = 500;

const esquema = z.object({
  esIncendio: z.boolean().describe("true si habla de un incendio forestal real en España, ahora o en los últimos días"),
  situacion: z
    .enum(["activo", "estabilizado", "controlado", "extinguido", "desconocido"])
    .describe("situación del incendio según el texto: activo (sin controlar), estabilizado, controlado, extinguido o desconocido"),
  municipio: z.string().describe("Municipio afectado; cadena vacía si no se dice"),
  provincia: z.string().describe("Provincia; cadena vacía si no se dice"),
  resumen: z.string().describe("Una frase en español con lo relevante para el mando"),
  gravedad: z.enum(["leve", "moderada", "grave", "critica"]),
  fiabilidad: z.number().min(0).max(1).describe("0 a 1 según la solvencia de la fuente y la concreción"),
  areaHa: z.number().min(0).nullable().describe("Hectáreas afectadas si el texto da una cifra; null si no"),
  nivelDeclarado: z.number().int().min(0).max(3).nullable().describe("Nivel de gravedad (0-3) si el texto lo declara; null si no"),
  mediosMencionados: z.string().describe("Medios que ya actúan según el texto (UME, medios aéreos, brigadas…); cadena vacía si no se dicen"),
});

const SISTEMA = `Analizas titulares de prensa y mensajes de redes sociales sobre incendios forestales en España para un centro de mando.
Extrae SOLO lo que dice el texto. Marca esIncendio=false si:
- habla de un incendio de otro país
- es un incendio urbano, industrial o de un vehículo (no forestal)
- es una noticia antigua conmemorativa, una opinión, una campaña de prevención o un dato estadístico
- es publicidad, humor o una metáfora ("incendio" en sentido figurado)
Gravedad: "leve" = conato o ya controlado; "moderada" = activo sin afectados; "grave" = desalojos, carreteras cortadas o viviendas amenazadas; "critica" = víctimas o evacuaciones masivas.
Fiabilidad: alta para medios identificados y cuentas oficiales; baja para cuentas anónimas o mensajes sin datos. Responde SIEMPRE en español.`;

type Memoria = { vistos: Set<string> };
type Global = typeof globalThis & { __atalayaPrensa?: Memoria };
const g = globalThis as Global;
const memoria = (): Memoria => (g.__atalayaPrensa ??= { vistos: new Set() });

interface Item {
  id: string;
  texto: string;
  url: string;
  canal: "prensa" | "rrss";
  remitente: string;
  publicado?: string;
}

/** Consultas del ciclo: la general y una por municipio/provincia de incendio activo. */
function consultas(ctx: ContextoAgente): string[] {
  const lista = new Set<string>(["incendio forestal"]);
  for (const i of ctx.estado.incendiosActivos()) {
    if (i.municipio) lista.add(`incendio forestal ${i.municipio}`);
    else if (i.provincia) lista.add(`incendio forestal ${i.provincia}`);
  }
  // Dos consultas como máximo: cada una son 3 peticiones y el ciclo del
  // orquestador se aborta a los 30 s.
  return [...lista].slice(0, 2);
}

async function recolectar(ctx: ContextoAgente): Promise<{ items: Item[]; fallos: string[] }> {
  const items: Item[] = [];
  const fallos: string[] = [];
  const m = memoria();

  const limite = Date.now() + MS_LIMITE_CICLO / 2;
  for (const q of consultas(ctx)) {
    if (ctx.abortSignal.aborted || Date.now() > limite) break;
    const tareas: Promise<void>[] = [
      noticiasGoogle(q, 10)
        .then((ns) => {
          ctx.estado.marcarServicio("Google News", true, `${ns.length} titulares para "${q}"`);
          for (const n of ns) items.push({ id: n.id, texto: n.titulo, url: n.url, canal: "prensa", remitente: n.medio ?? "Google News", publicado: n.publicado });
        })
        .catch((e) => {
          const d = e instanceof Error ? e.message : String(e);
          fallos.push(`Google News: ${d}`);
          ctx.estado.marcarServicio("Google News", false, d);
        }),
      buscarPosts(q, { limite: 10 })
        .then((ps) => {
          ctx.estado.marcarServicio("Bluesky", true, `${ps.length} publicaciones para "${q}"`);
          for (const p of ps) items.push({ id: p.id, texto: p.texto, url: p.url, canal: "rrss", remitente: p.autor, publicado: p.creadoEn });
        })
        .catch((e) => {
          const d = e instanceof Error ? e.message : String(e);
          fallos.push(`Bluesky: ${d}`);
          ctx.estado.marcarServicio("Bluesky", false, d);
        }),
    ];
    if (exaDisponible()) {
      tareas.push(
        buscarNoticias(q, { horas: 24, max: 10 })
          .then((ns) => {
            ctx.estado.marcarServicio("Exa", true, `${ns.length} resultados para "${q}"`);
            for (const n of ns) items.push({ id: n.id, texto: `${n.titulo}. ${n.extracto}`.trim(), url: n.url, canal: "prensa", remitente: new URL(n.url).hostname, publicado: n.publicado });
          })
          .catch((e) => {
            const d = e instanceof Error ? e.message : String(e);
            fallos.push(`Exa: ${d}`);
            ctx.estado.marcarServicio("Exa", false, d);
          }),
      );
    }
    await Promise.all(tareas);
  }

  const nuevos = items.filter((i) => {
    const clave = i.url || i.id;
    if (m.vistos.has(clave) || m.vistos.has(i.id)) return false;
    if (!esReciente(i.publicado)) return false;
    return true;
  });
  return { items: nuevos.slice(0, MAX_ITEMS_CICLO), fallos };
}

export const agentePrensaRedes: Agente = {
  id: "prensa_redes",
  nombre: "Prensa y redes",
  categoria: "percepcion",
  descripcion:
    "Rastrea Google Noticias, Bluesky y Exa buscando incendios forestales en España y convierte lo relevante en observaciones situadas en el mapa.",
  modelo: "rapido",
  cadenciaSeg: 180,
  despiertaCon: ["incendio_nuevo"],

  async ciclo(ctx: ContextoAgente) {
    ctx.informarTarea("Buscando incendios en prensa y redes sociales");
    const { items, fallos } = await recolectar(ctx);
    const m = memoria();

    if (!items.length) {
      const resumen = fallos.length ? `Sin novedades. Fuentes con problemas: ${fallos.join("; ")}` : "Sin novedades en prensa ni redes";
      ctx.informarTarea(resumen);
      return { resumen };
    }

    if (!proveedorDisponible()) {
      const resumen = `${items.length} publicaciones nuevas, pero no hay proveedor de IA para analizarlas`;
      ctx.informarTarea(resumen);
      return { resumen };
    }

    const observaciones: Observacion[] = [];
    let descartados = 0;
    const finPlazo = Date.now() + MS_LIMITE_CICLO / 2;
    for (const item of items) {
      if (ctx.abortSignal.aborted || Date.now() > finPlazo) break;
      m.vistos.add(item.url || item.id);
      m.vistos.add(item.id);
      if (m.vistos.size > MAX_VISTOS) m.vistos = new Set([...m.vistos].slice(-MAX_VISTOS));

      try {
        const { datos } = await completarJson({
          system: SISTEMA,
          user: `Canal: ${item.canal === "prensa" ? "prensa" : "red social"}. Fuente: ${item.remitente}. ${item.publicado ? `Publicado: ${item.publicado}.` : ""}\n\nTexto:\n"""\n${item.texto.slice(0, 1200)}\n"""`,
          esquema,
          nombreEsquema: "extraccion_prensa",
          papel: "rapido",
          signal: ctx.abortSignal,
        });

        if (!datos.esIncendio || datos.situacion === "controlado" || datos.situacion === "extinguido") {
          descartados += 1;
          continue;
        }

        let punto;
        const lugar = [datos.municipio.trim(), datos.provincia.trim()].filter(Boolean).join(", ");
        if (lugar) {
          try {
            punto = (await geocodificar(`${lugar}, España`))?.punto;
          } catch (e) {
            console.warn("[prensa] geocodificación fallida:", e instanceof Error ? e.message : e);
          }
        }

        const observacion: Observacion = {
          id: nuevoId("obs"),
          canal: item.canal,
          recibidaEn: new Date().toISOString(),
          texto: `${datos.resumen} · ${item.texto.slice(0, 280)}`,
          remitente: item.remitente,
          urlFuente: item.url,
          punto,
          referenciaExterna: item.id,
          extraccion: {
            esIncendio: true,
            tipo: "incendio_activo",
            gravedad: datos.gravedad,
            lugarTexto: lugar || undefined,
            municipio: datos.municipio.trim() || undefined,
            resumen: datos.resumen,
            fiabilidad: Math.max(0, Math.min(1, datos.fiabilidad)),
            areaHa: datos.areaHa ?? undefined,
            nivelDeclarado: datos.nivelDeclarado === null ? undefined : (datos.nivelDeclarado as 0 | 1 | 2 | 3),
            situacion: datos.situacion,
            mediosMencionados: datos.mediosMencionados.trim() || undefined,
          },
        };
        ctx.estado.guardar(ctx.estado.observaciones, observacion);
        observaciones.push(observacion);
        ctx.registrar("observacion", `${item.canal === "prensa" ? "Prensa" : "Redes"} (${item.remitente}): ${datos.resumen}`, {
          nivel: datos.gravedad === "grave" || datos.gravedad === "critica" ? "aviso" : "info",
          datos: { observacionId: observacion.id, url: item.url, punto, gravedad: datos.gravedad },
        });
      } catch (e) {
        console.warn("[prensa] extracción fallida:", e instanceof Error ? e.message : e);
      }
    }

    const resumen = `${items.length} publicaciones revisadas: ${observaciones.length} sobre incendios reales, ${descartados} descartadas${fallos.length ? `. Problemas: ${fallos[0]}` : ""}`;
    ctx.informarTarea(resumen);
    return { resumen, observaciones: observaciones.length ? observaciones : undefined };
  },
};
