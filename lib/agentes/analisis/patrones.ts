// =====================================================================
// ATALAYA INCENDIOS · Agente "patrones" (análisis)
// ---------------------------------------------------------------------
// Propósito: mirar los focos en conjunto. Varios incendios cercanos en el
// tiempo rara vez son casualidad: pueden ser el mismo incendio partido en
// dos avisos, una serie intencionada (que hay que llevar al SEPRONA) o dos
// frentes que van a converger (que obliga a replanificar el dispositivo).
// DUEÑO: constructor D. Dependencias: lib/ia/llm (razonamiento).
// =====================================================================
import { z } from "zod";
import type { Cluster, Decision, Incendio, TipoCluster } from "../../dominio/tipos";
import type { Agente, ContextoAgente, ResultadoCiclo } from "../../motor/contratos";
import { gradosATexto, haversine, rumbo } from "../../fuentes/geo";
import { completarJson, modeloPara, proveedorDisponible } from "../../ia/llm";
import { nuevoId } from "../../motor/ids";
import { decisionBase } from "../planificacion/comun";

/** Distancia máxima entre focos para sospechar que están relacionados. */
const KM_CLUSTER = 30;
/** Ventana temporal (minutos de mundo) para sospechar de una serie. */
const MINUTOS_CLUSTER = 120;

const ESQUEMA = z.object({
  tipo: z.enum(["mismo_incendio", "serie_sospechosa", "convergencia", "independientes"]),
  analisis: z.string(),
  recomendacion: z.string(),
});

export const analistaPatrones: Agente = {
  id: "patrones",
  nombre: "Analista de patrones",
  categoria: "analisis",
  descripcion: "Busca relación entre focos: el mismo incendio partido, una serie intencionada o dos frentes que convergen.",
  modelo: modeloPara("razonamiento"),
  cadenciaSeg: 120,
  tiempoMaximoSeg: 150, // una o dos llamadas de razonamiento de ~25 s + margen
  despiertaCon: ["incendio_nuevo"],

  async ciclo(ctx: ContextoAgente): Promise<ResultadoCiclo> {
    const { estado } = ctx;
    const activos = estado.incendiosOperativos();
    if (activos.length < 2) {
      ctx.informarTarea(activos.length ? "Un solo foco activo: no hay patrón que buscar" : "Sin focos activos");
      return { resumen: "Menos de dos focos activos: nada que agrupar" };
    }

    const grupos = agrupar(activos, estado.reloj.factor || 12);
    if (!grupos.length) {
      ctx.informarTarea(`${activos.length} focos, ninguno a menos de ${KM_CLUSTER} km ni en la misma ventana de ${MINUTOS_CLUSTER} min`);
      return { resumen: `${activos.length} focos independientes (separados más de ${KM_CLUSTER} km)` };
    }

    if (!proveedorDisponible()) {
      ctx.informarTarea("Hay focos agrupables pero no hay proveedor de IA configurado");
      return { resumen: `${grupos.length} grupo(s) de focos detectados, pero el análisis necesita el LLM (sin proveedor configurado)` };
    }

    const decisiones: Decision[] = [];
    const resumenes: string[] = [];

    for (const grupo of grupos) {
      if (ctx.abortSignal.aborted) break;
      ctx.informarTarea(`Analizando ${grupo.length} focos relacionados`, grupo[0].id);
      const analisis = await analizarGrupo(grupo, ctx);
      if (!analisis) continue;

      const idsGrupo = grupo.map((i) => i.id).sort();
      const previo = [...estado.clusters.values()].find((c) => c.incendios.slice().sort().join("|") === idsGrupo.join("|"));
      const cluster: Cluster = {
        id: previo?.id ?? nuevoId("clu"),
        incendios: idsGrupo,
        tipo: analisis.tipo as TipoCluster,
        analisis: analisis.analisis,
        recomendacion: analisis.recomendacion,
        detectadoEn: previo?.detectadoEn ?? ctx.ahoraMundo,
        actualizadoEn: ctx.ahoraMundo,
      };
      estado.guardar(estado.clusters, cluster);
      for (const i of grupo) estado.actualizar(estado.incendios, i.id, { clusterId: cluster.id });
      resumenes.push(`${grupo.length} focos → ${cluster.tipo}`);

      if (cluster.tipo === "serie_sospechosa" && !previo) {
        decisiones.push(decisionSerieSospechosa(cluster, grupo, ctx));
        ctx.registrar("sistema", `Serie sospechosa: ${grupo.length} focos en menos de ${KM_CLUSTER} km y ${MINUTOS_CLUSTER} min. ${cluster.analisis}`, {
          nivel: "critico",
          datos: { clusterId: cluster.id },
        });
      }
      if (cluster.tipo === "convergencia") {
        ctx.registrar("sistema", `Convergencia de frentes: ${grupo.map((i) => i.nombre).join(" y ")}. ${cluster.recomendacion}`, {
          incendioId: grupo[0].id,
          nivel: "critico",
          datos: { clusterId: cluster.id },
        });
        try {
          const { despertar } = await import("../../motor/orquestador");
          despertar("coordinador");
        } catch {
          /* el coordinador se despertará por cadencia */
        }
      }
    }

    return { resumen: resumenes.length ? `Patrones: ${resumenes.join(" · ")}` : "Sin patrones nuevos", decisiones };
  },
};

/** Agrupa focos por proximidad (< 30 km) o cercanía temporal (< 2 h de mundo). */
function agrupar(activos: Incendio[], factor: number): Incendio[][] {
  const grupos: Incendio[][] = [];
  const asignado = new Set<string>();
  for (const a of activos) {
    if (asignado.has(a.id)) continue;
    const grupo = [a];
    for (const b of activos) {
      if (b.id === a.id || asignado.has(b.id)) continue;
      const km = haversine(a.centro, b.centro);
      const minutos = (Math.abs(Date.parse(a.detectadoEn) - Date.parse(b.detectadoEn)) / 60_000) * Math.max(1, factor);
      if (km < KM_CLUSTER || minutos < MINUTOS_CLUSTER) grupo.push(b);
    }
    if (grupo.length >= 2) {
      for (const g of grupo) asignado.add(g.id);
      grupos.push(grupo);
    }
  }
  return grupos;
}

async function analizarGrupo(grupo: Incendio[], ctx: ContextoAgente): Promise<z.infer<typeof ESQUEMA> | undefined> {
  const ordenados = [...grupo].sort((a, b) => a.detectadoEn.localeCompare(b.detectadoEn));
  const lineas = ordenados.map((i, idx) => {
    const anterior = idx > 0 ? ordenados[idx - 1] : undefined;
    const relacion = anterior
      ? ` · a ${haversine(anterior.centro, i.centro).toFixed(1)} km al ${gradosATexto(rumbo(anterior.centro, i.centro))} del anterior, ` +
        `${Math.round((Date.parse(i.detectadoEn) - Date.parse(anterior.detectadoEn)) / 60_000)} min después`
      : "";
    return (
      `${idx + 1}. ${i.nombre} — ${i.municipio || "municipio desconocido"} (${i.provincia || "?"}), detectado ${i.detectadoEn} por ${i.origen}, ` +
      `estado ${i.estado}, ${i.areaHa.toFixed(0)} ha, ` +
      (i.meteo ? `viento ${i.meteo.vientoKmh.toFixed(0)} km/h del ${i.meteo.direccionTexto}` : "sin meteo") +
      (i.frente ? `, frente al ${i.frente.rumboTexto}` : "") +
      relacion
    );
  });

  const lecciones = ctx.lecciones.length
    ? `\n\nLecciones de ejecuciones anteriores que DEBES tener en cuenta:\n${ctx.lecciones.map((l) => `- ${l.texto}`).join("\n")}`
    : "";

  try {
    const r = await completarJson({
      system:
        "Eres analista de patrones de una sala de coordinación de incendios forestales en España. Recibes varios focos activos " +
        "y decides si son: (a) mismo_incendio (dos avisos del mismo fuego), (b) serie_sospechosa (varios inicios en poco tiempo y " +
        "poca distancia, patrón típico de intencionalidad: hay que dar parte al SEPRONA de la Guardia Civil), " +
        "(c) convergencia (frentes que van a juntarse y obligan a un mando único y a replanificar el dispositivo), " +
        "(d) independientes. Sé prudente: acusar de intencionalidad sin patrón claro (alineación en carretera, intervalos regulares, " +
        "mismo rango horario) es grave. Escribe el análisis y la recomendación operativa en español, en 2-3 frases cada uno.",
      user: `Focos activos relacionados:\n${lineas.join("\n")}${lecciones}`,
      esquema: ESQUEMA,
      nombreEsquema: "patron_multifoco",
      papel: "razonamiento",
      // glm5.3-flash razona antes de responder: con 900 devolvía vacío y reintentaba.
      maxTokens: 4000,
      signal: ctx.abortSignal,
    });
    return r.datos;
  } catch (e) {
    ctx.registrar("agente", `El analista de patrones no ha podido consultar el modelo: ${e instanceof Error ? e.message : String(e)}`, { nivel: "aviso" });
    return undefined;
  }
}

/** Parte al SEPRONA cuando el patrón apunta a intencionalidad. */
function decisionSerieSospechosa(cluster: Cluster, grupo: Incendio[], ctx: ContextoAgente): Decision {
  const cuerpo =
    `Se han registrado ${grupo.length} inicios de incendio en menos de ${KM_CLUSTER} km y ${MINUTOS_CLUSTER} minutos:\n` +
    grupo.map((i) => `- ${i.nombre} (${i.municipio}, ${i.provincia}), detectado ${i.detectadoEn} por ${i.origen}, ${i.areaHa.toFixed(0)} ha.`).join("\n") +
    `\n\nAnálisis: ${cluster.analisis}\nRecomendación: ${cluster.recomendacion}`;

  const decision = decisionBase(ctx, {
    agenteId: "patrones",
    titulo: `Parte al SEPRONA por posible serie intencionada (${grupo.length} focos)`,
    resumen: `${grupo.length} inicios en menos de ${KM_CLUSTER} km y ${MINUTOS_CLUSTER} min: se abre ticket y se avisa a la Guardia Civil.`,
    razonamiento:
      `${cluster.analisis} El patrón espacio-temporal es el que describe la investigación de incendios intencionados. ` +
      `No corresponde a esta sala investigar, pero sí dar parte de inmediato para que el SEPRONA pueda recoger indicios antes de que ` +
      `los medios de extinción alteren el terreno. ${cluster.recomendacion}`,
    prioridad: 2,
    riesgo: 35,
    clusterId: cluster.id,
    incendioId: grupo[0].id,
    acciones: [
      {
        tipo: "abrir_ticket",
        descripcion: "Abrir parte para el SEPRONA (Guardia Civil) por posible serie intencionada",
        parametros: { titulo: `Posible serie intencionada · ${grupo.length} focos`, cuerpo, destinatario: "SEPRONA · Guardia Civil", clusterId: cluster.id },
      },
      {
        tipo: "enviar_email",
        descripcion: "Enviar el parte por correo al SEPRONA",
        objetivo: { email: process.env.EMAIL_DEMO?.trim() || undefined },
        parametros: { asunto: `[Atalaya] Posible serie intencionada · ${grupo.length} focos en ${grupo[0].provincia || "la zona"}`, texto: cuerpo, destinatario: "SEPRONA · Guardia Civil" },
      },
    ],
    decisionesPrevias: grupo.flatMap((i) => ctx.estado.decisionesDe(i.id).map((d) => d.id)),
    evidencias: grupo.map((i) => ({
      id: `ev-${i.id}`,
      fuente: `Foco ${i.nombre}`,
      resumen: `Detectado ${i.detectadoEn} por ${i.origen} en ${i.municipio || "?"} (${i.areaHa.toFixed(0)} ha), ${i.centro.lat.toFixed(4)}, ${i.centro.lon.toFixed(4)}.`,
      url: `https://www.openstreetmap.org/?mlat=${i.centro.lat.toFixed(5)}&mlon=${i.centro.lon.toFixed(5)}#map=13/${i.centro.lat.toFixed(5)}/${i.centro.lon.toFixed(5)}`,
      en: ctx.ahoraMundo,
      confianza: i.confianza,
    })),
  });
  return decision;
}
