// =====================================================================
// Agente vigía de cámaras. DUEÑO: constructor B.
// ---------------------------------------------------------------------
// Cada ciclo toma hasta 3 cámaras vigiladas (rotación justa, primero las
// móviles con fotograma nuevo y después las más cercanas a focos activos),
// descarga su JPEG REAL, lo reduce a ≤ 800 px de ancho y se lo pasa al modelo
// de visión con `completarJson({papel:"vision", imagenes:[…]})`.
//
// Dos análisis seguidos con humo o fuego y confianza ≥ 0,6 → Observacion de
// canal "camara" + evento `camara_positiva` (nivel crítico). Un solo positivo
// de humo no basta: las cámaras de carretera confunden niebla, polvo y contraluz.
// LLAMAS con confianza ≥ 0,8 sí valen al primer análisis, y cada observación de
// cámara se verifica en el acto (verificador.verificarObservacionAhora): el foco
// se declara o confirma segundos después de verse el fuego, no en el siguiente
// ciclo. Una misma cámara no abre más de una observación por minuto salvo que
// pase de humo a fuego.
//
// Límite de imágenes por minuto configurable con VISION_IMAGENES_POR_MINUTO
// (por defecto 12; 3 si el proveedor de visión es Groq, que da 8.000 TPM
// gratis y cada imagen cuesta ~2.048 tokens).
//
// Sin proveedor de visión: estado "error" con el motivo, servicio "Visión" en
// rojo y NINGÚN resultado inventado.
// Dependencias: lib/fuentes/{dgtCamaras,camarasMovil,geo}, lib/ia/llm, sharp
// (opcional: si no está instalado se envía la imagen tal cual).
// =====================================================================
import { z } from "zod";
import type { Agente, ContextoAgente } from "../../motor/contratos";
import type { AnalisisCamara, Camara, Observacion } from "../../dominio/tipos";
import { fuenteActiva } from "../../dominio/fuentes-deteccion";
import { imagenCamara, listarTodasLasCamaras } from "../../fuentes/dgtCamaras";
import { fotogramaDe } from "../../fuentes/camarasMovil";
import { haversine } from "../../fuentes/geo";
import { completarJson, modeloPara, motivoIndisponible, proveedorDisponible, type ImagenLLM, type PrioridadLLM } from "../../ia/llm";
import { nuevoId } from "../../motor/ids";

const MAX_POR_CICLO = 3;
const MAX_HISTORIAL = 20;
const CONFIANZA_MINIMA = 0.6;
/** Llamas con esta confianza o más: observación al primer análisis, sin esperar confirmación. */
const CONFIANZA_LLAMAS = 0.8;
/** Una cámara que sigue viendo lo mismo no abre otra observación hasta pasado este tiempo real. */
const SEGUNDOS_ENTRE_OBSERVACIONES = 60;
const ANCHO_MAXIMO = 800;

const esquemaVision = z.object({
  humo: z.boolean().describe("true si se ve una columna o velo de humo de incendio"),
  fuego: z.boolean().describe("true si se ven llamas o resplandor de fuego"),
  confianza: z.number().min(0).max(1).describe("0 a 1: seguridad de la valoración"),
  descripcion: z.string().describe("Una o dos frases en español diciendo qué se ve y DÓNDE en la imagen"),
});

const SISTEMA_VISION = `Eres un analista de imágenes de cámaras de vigilancia de carreteras y de móviles en campo para un centro de mando de incendios forestales en España.
Tu trabajo es decir si en la imagen hay HUMO o FUEGO de un incendio forestal.

Ten mucho cuidado con los falsos positivos, que son habituales en estas cámaras:
- niebla y bruma matinal (velo uniforme que cubre toda la escena, sin origen en un punto)
- nubes bajas y estelas de condensación
- polvo o calima levantada por el viento o por obras
- vapor de agua, humo de escape de vehículos, humo de una chimenea
- reflejos en la óptica, gotas de lluvia en el cristal, contraluz y sol bajo
- el propio rótulo quemado de la cámara, la marca de tiempo y las farolas de noche

Una columna de humo de incendio nace en un punto del terreno, se ensancha hacia arriba y se inclina con el viento. El fuego se ve como llamas o un resplandor anaranjado, casi siempre de noche.
Si la imagen está oscura, borrada o no se distingue nada, responde humo=false, fuego=false y confianza baja explicando por qué.
Responde SIEMPRE en español y di en qué parte de la imagen está lo que ves (izquierda, centro, fondo, sobre la cresta, etc.).`;

// ---------------------------------------------------------------------
// Límite de imágenes por minuto
// ---------------------------------------------------------------------

export function limiteImagenesPorMinuto(): number {
  const env = Number(process.env.VISION_IMAGENES_POR_MINUTO);
  if (Number.isFinite(env) && env > 0) return Math.floor(env);
  const proveedor = (process.env.LLM_VISION_PROVEEDOR ?? process.env.LLM_PROVEEDOR ?? "").trim().toLowerCase();
  // Groq gratuito: 8.000 TPM y ~2.048 tokens por imagen → 3 imágenes/minuto.
  return proveedor === "groq" ? 3 : 12;
}

type Memoria = {
  enviadas: number[];
  rotacion: number;
  fotogramasAnalizados: Map<string, number>;
  /** Última observación abierta por cada cámara (instante real y si era de fuego). */
  ultimaObservacion: Map<string, { en: number; fuego: boolean }>;
};
type Global = typeof globalThis & { __atalayaVigia?: Memoria };
const g = globalThis as Global;
const memoria = (): Memoria => {
  const m = (g.__atalayaVigia ??= { enviadas: [], rotacion: 0, fotogramasAnalizados: new Map(), ultimaObservacion: new Map() });
  m.ultimaObservacion ??= new Map(); // objetos creados antes de existir este campo (recarga en caliente)
  return m;
};

/** Cuántas imágenes se pueden enviar ahora mismo sin pasarse del límite (lo consulta también el análisis inmediato de los móviles). */
export function cupoDisponible(): number {
  const m = memoria();
  const hace1min = Date.now() - 60_000;
  m.enviadas = m.enviadas.filter((t) => t > hace1min);
  return Math.max(0, limiteImagenesPorMinuto() - m.enviadas.length);
}

// ---------------------------------------------------------------------
// Reducción de la imagen (sharp si está disponible)
// ---------------------------------------------------------------------

let sharpProbado = false;
let sharpModulo: ((entrada: Uint8Array) => { resize: (o: { width: number; withoutEnlargement: boolean }) => { jpeg: (o: { quality: number }) => { toBuffer: () => Promise<Buffer> } } }) | undefined;

async function reducir(bytes: Uint8Array, mime: string): Promise<{ base64: string; mime: ImagenLLM["mime"]; reducida: boolean }> {
  const mimeSalida: ImagenLLM["mime"] = mime === "image/png" ? "image/png" : mime === "image/webp" ? "image/webp" : "image/jpeg";
  if (!sharpProbado) {
    sharpProbado = true;
    try {
      const mod = (await import("sharp")) as unknown as { default?: typeof sharpModulo };
      sharpModulo = (mod.default ?? (mod as unknown as typeof sharpModulo)) as typeof sharpModulo;
    } catch {
      // sharp no disponible: se envía la imagen tal cual (las de la DGT son
      // 853x480 y ~26 KB, perfectamente manejables).
      sharpModulo = undefined;
    }
  }
  if (sharpModulo) {
    try {
      const buffer = await sharpModulo(bytes).resize({ width: ANCHO_MAXIMO, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      return { base64: buffer.toString("base64"), mime: "image/jpeg", reducida: true };
    } catch {
      // Si sharp falla con esta imagen concreta, se manda la original.
    }
  }
  return { base64: Buffer.from(bytes).toString("base64"), mime: mimeSalida, reducida: false };
}

// ---------------------------------------------------------------------
// Selección de cámaras
// ---------------------------------------------------------------------

/** Cámaras a analizar en este ciclo, por prioridad y con rotación justa. */
async function elegirCamaras(ctx: ContextoAgente, cupo: number): Promise<Camara[]> {
  const m = memoria();
  const vigiladas = [...ctx.estado.camaras.values()].filter((c) => c.vigilada);

  // 1) Móviles en campo con fotograma NUEVO (cada fotograma se analiza una vez).
  const moviles = vigiladas.filter((c) => {
    if (c.fuente !== "Movil") return false;
    const f = fotogramaDe(c.id);
    return Boolean(f) && m.fotogramasAnalizados.get(c.id) !== f?.secuencia;
  });

  const elegidas = moviles.slice(0, cupo);
  if (elegidas.length >= cupo) return elegidas;
  // Cámaras fijas apagadas por el escenario del mando: solo se miran los móviles
  // (ni las fijas vigiladas ni el muestreo por zona de peligro).
  if (!fuenteActiva(ctx.estado.ejecucion, "camaras_fijas")) return elegidas;

  // 2) Cámaras fijas vigiladas, las más cercanas a un foco activo primero.
  const focos = ctx.estado.incendiosActivos().map((i) => i.centro);
  const fijas = vigiladas
    .filter((c) => c.fuente !== "Movil")
    .map((c) => ({ c, d: focos.length ? Math.min(...focos.map((f) => haversine(f, c.punto))) : Infinity }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.c);

  if (fijas.length) {
    // Rotación justa: se empieza donde acabó el ciclo anterior.
    const inicio = m.rotacion % fijas.length;
    const ordenadas = [...fijas.slice(inicio), ...fijas.slice(0, inicio)];
    // Las 2 primeras por cercanía siempre entran; el resto rota.
    const preferentes = focos.length ? fijas.slice(0, 2) : [];
    for (const c of [...preferentes, ...ordenadas]) {
      if (elegidas.length >= cupo) break;
      if (!elegidas.some((e) => e.id === c.id)) elegidas.push(c);
    }
    m.rotacion = (m.rotacion + elegidas.filter((c) => c.fuente !== "Movil").length) % Math.max(1, fijas.length);
    return elegidas;
  }

  // 3) Sin cámaras vigiladas ni incendios: muestreo de 2 cámaras en la zona
  //    forestal de mayor peligro de España (zonasPeligro del meteorólogo).
  const zona = ctx.estado.zonasPeligro[0];
  if (!zona) return elegidas;
  try {
    const catalogo = await listarTodasLasCamaras();
    const cercanas = catalogo
      .map((c) => ({ c, d: haversine(zona.punto, c.punto) }))
      .filter((x) => x.d <= 60)
      .sort((a, b) => a.d - b.d)
      .slice(0, 12)
      .map((x) => x.c);
    if (!cercanas.length) return elegidas;
    const inicio = m.rotacion % cercanas.length;
    for (let i = 0; i < Math.min(2, cupo - elegidas.length); i++) {
      const c = cercanas[(inicio + i) % cercanas.length];
      // Se guarda en el estado para que la sala la vea y tenga historial.
      if (!ctx.estado.camaras.has(c.id)) ctx.estado.guardar(ctx.estado.camaras, c);
      elegidas.push(ctx.estado.camaras.get(c.id) ?? c);
    }
    m.rotacion = (m.rotacion + 2) % cercanas.length;
  } catch (e) {
    console.warn("[vigia] no se pudo muestrear el catálogo:", e instanceof Error ? e.message : e);
  }
  return elegidas;
}

// ---------------------------------------------------------------------
// Análisis de UNA cámara. Lo usa el ciclo y también el análisis inmediato
// de los móviles al llegar el fotograma (lib/fuentes/analisisMovilInmediato.ts).
// ---------------------------------------------------------------------

export interface ResultadoAnalisisCamara {
  analisis: AnalisisCamara;
  /** Observación creada si es el segundo positivo seguido (humo o fuego confirmado). */
  observacion?: Observacion;
}

/**
 * Descarga la imagen de la cámara, la reduce, la pasa al modelo de visión,
 * guarda el análisis en el estado y registra los positivos (aviso al primero,
 * observación + evento crítico al segundo seguido). Cuenta contra el cupo por
 * minuto. Devuelve undefined si falló: el fallo queda registrado y el servicio
 * "Visión" en rojo.
 */
export async function analizarCamaraAhora(ctx: ContextoAgente, camara: Camara, opciones: { prioridad?: PrioridadLLM } = {}): Promise<ResultadoAnalisisCamara | undefined> {
  const m = memoria();
  ctx.informarTarea(`Analizando la cámara ${camara.nombre}`, camara.incendioId);
  const t0 = Date.now();
  // Un fotograma de móvil se analiza una sola vez: se marca ANTES de llamar al
  // modelo para que el ciclo del Vigía y el análisis inmediato no lo repitan.
  if (camara.fuente === "Movil") {
    const f = fotogramaDe(camara.id);
    if (f) m.fotogramasAnalizados.set(camara.id, f.secuencia);
  }
  try {
    const { bytes, mime } = await imagenCamara(camara.id);
    const imagen = await reducir(bytes, mime);
    m.enviadas.push(Date.now());

    const respuesta = await completarJson({
      system: SISTEMA_VISION,
      user:
        `Cámara "${camara.nombre}"${camara.carretera ? ` (${camara.carretera})` : ""}, situada en ${camara.punto.lat.toFixed(4)}, ${camara.punto.lon.toFixed(4)}` +
        `${camara.fuente === "Movil" ? ", enviada desde un móvil en campo" : ", cámara fija de tráfico"}.` +
        ` Hora de la imagen: ${new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}.` +
        ` ¿Se ve humo o fuego de un incendio forestal?`,
      esquema: esquemaVision,
      nombreEsquema: "analisis_camara",
      papel: "vision",
      prioridad: opciones.prioridad,
      imagenes: [{ base64: imagen.base64, mime: imagen.mime }],
      signal: ctx.abortSignal,
    });

    const analisis: AnalisisCamara = {
      en: new Date().toISOString(),
      humo: respuesta.datos.humo,
      fuego: respuesta.datos.fuego,
      confianza: Math.max(0, Math.min(1, respuesta.datos.confianza)),
      descripcion: respuesta.datos.descripcion.trim(),
      modelo: respuesta.modelo,
      imagenUrl: `/api/camaras/${encodeURIComponent(camara.id)}/imagen?t=${Date.now()}`,
      latenciaMs: Date.now() - t0,
    };

    const actual = ctx.estado.camaras.get(camara.id) ?? camara;
    const historial = [...(actual.historial ?? []), analisis].slice(-MAX_HISTORIAL);
    if (!ctx.estado.camaras.has(camara.id)) ctx.estado.guardar(ctx.estado.camaras, { ...camara, historial, ultimoAnalisis: analisis });
    else ctx.estado.actualizar(ctx.estado.camaras, camara.id, { ultimoAnalisis: analisis, historial });

    ctx.estado.marcarServicio("Visión", true, `Último análisis: ${camara.nombre} (${analisis.latenciaMs} ms)`);

    const positivo = (analisis.humo || analisis.fuego) && analisis.confianza >= CONFIANZA_MINIMA;
    const anterior = historial[historial.length - 2];
    const anteriorPositivo = Boolean(anterior && (anterior.humo || anterior.fuego) && anterior.confianza >= CONFIANZA_MINIMA);
    // Llamas claras: no hace falta un segundo análisis. La niebla y el polvo se
    // confunden con humo, no con fuego; esperar otros 10-20 s con llamas a la
    // vista no aporta nada y retrasa el foco.
    const llamasClaras = analisis.fuego && analisis.confianza >= CONFIANZA_LLAMAS;

    if (llamasClaras || (positivo && anteriorPositivo)) {
      const ultima = m.ultimaObservacion.get(camara.id);
      const escalaAFuego = analisis.fuego && !ultima?.fuego;
      const reciente = ultima !== undefined && Date.now() - ultima.en < SEGUNDOS_ENTRE_OBSERVACIONES * 1000;
      if (reciente && !escalaAFuego) {
        // La cámara sigue viendo lo mismo: se anota, pero no se abre otra observación
        // hasta que pase el intervalo (un fuego sostenido inundaría al Verificador).
        ctx.registrar(
          "agente",
          `${camara.nombre}: sigue viéndose ${analisis.fuego ? "fuego" : "humo"} (confianza ${Math.round(analisis.confianza * 100)} %); la observación abierta hace menos de ${SEGUNDOS_ENTRE_OBSERVACIONES} s ya está en manos del Verificador`,
          { incendioId: camara.incendioId, nivel: "aviso", datos: { camaraId: camara.id } },
        );
        return { analisis };
      }
      const observacion: Observacion = {
        id: nuevoId("obs"),
        canal: "camara",
        recibidaEn: analisis.en,
        texto: analisis.descripcion,
        remitente: `Cámara ${camara.nombre} (${camara.fuente})`,
        urlFuente: analisis.imagenUrl,
        punto: camara.punto,
        referenciaExterna: camara.id,
        incendioId: camara.incendioId,
        // Lo que ve la cámara, en el formato del extractor de avisos: así el Verificador
        // conoce la gravedad (llamas = grave) y la fiabilidad que da el modelo.
        extraccion: {
          esIncendio: true,
          tipo: analisis.fuego ? "llamas" : "humo",
          gravedad: analisis.fuego ? "grave" : "moderada",
          resumen: analisis.descripcion,
          fiabilidad: analisis.confianza,
          situacion: "activo",
        },
      };
      ctx.estado.guardar(ctx.estado.observaciones, observacion);
      m.ultimaObservacion.set(camara.id, { en: Date.now(), fuego: analisis.fuego });
      const motivo =
        llamasClaras && !(positivo && anteriorPositivo)
          ? `FUEGO visible (confianza ${Math.round(analisis.confianza * 100)} %): observación inmediata, sin esperar a un segundo análisis`
          : `${analisis.fuego ? "FUEGO" : "humo"} confirmado en dos análisis seguidos (confianza ${Math.round(analisis.confianza * 100)} %)`;
      ctx.registrar("camara_positiva", `${camara.nombre}: ${motivo}. ${analisis.descripcion}`, {
        incendioId: camara.incendioId,
        nivel: "critico",
        datos: { camaraId: camara.id, punto: camara.punto, confianza: analisis.confianza, observacionId: observacion.id, fuego: analisis.fuego },
      });
      // Verificación en el acto: el Verificador declara o confirma el foco ahora,
      // sin esperar a su ciclo (el orquestador impone hasta 15 s de hueco mínimo).
      try {
        const { verificarObservacionAhora } = await import("../analisis/verificador");
        await verificarObservacionAhora(observacion.id);
      } catch (e) {
        ctx.registrar("sistema", `La verificación inmediata de ${camara.nombre} falló; queda para el ciclo del Verificador: ${e instanceof Error ? e.message : String(e)}`, {
          nivel: "aviso",
          datos: { camaraId: camara.id },
        });
      }
      return { analisis, observacion };
    } else if (positivo) {
      ctx.registrar("agente", `${camara.nombre}: posible ${analisis.fuego ? "fuego" : "humo"} (confianza ${Math.round(analisis.confianza * 100)} %), espero a confirmarlo en el siguiente análisis`, {
        incendioId: camara.incendioId,
        nivel: "aviso",
        datos: { camaraId: camara.id },
      });
    }
    return { analisis };
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    ctx.estado.marcarServicio("Visión", false, `${camara.nombre}: ${detalle}`);
    ctx.registrar("sistema", `No se pudo analizar la cámara ${camara.nombre}: ${detalle}`, { nivel: "aviso", datos: { camaraId: camara.id } });
    return undefined;
  }
}

// ---------------------------------------------------------------------
// Agente
// ---------------------------------------------------------------------

export const agenteVigiaCamaras: Agente = {
  id: "vigia_camaras",
  nombre: "Vigía de cámaras",
  categoria: "percepcion",
  descripcion:
    "Analiza con un modelo de visión las imágenes reales de las cámaras de la DGT, de Madrid y de los móviles en campo para detectar humo o fuego.",
  modelo: modeloPara("vision"),
  cadenciaSeg: Math.max(5, Number(process.env.CAMARAS_INTERVALO_SEG ?? 20)),
  despiertaCon: ["incendio_nuevo"],

  async ciclo(ctx: ContextoAgente) {
    if (!proveedorDisponible()) {
      const detalle = motivoIndisponible() ?? "Sin proveedor de visión configurado";
      ctx.estado.marcarServicio("Visión", false, detalle);
      ctx.estado.actualizar(ctx.estado.agentes, "vigia_camaras", { estado: "error", ultimoError: detalle });
      ctx.informarTarea("Sin modelo de visión: no puedo analizar las cámaras");
      return { resumen: detalle };
    }

    const cupo = Math.min(MAX_POR_CICLO, cupoDisponible());
    if (cupo <= 0) {
      const resumen = `Esperando al límite de visión (${limiteImagenesPorMinuto()} imágenes por minuto)`;
      ctx.informarTarea(resumen);
      return { resumen };
    }

    const camaras = await elegirCamaras(ctx, cupo);
    if (!camaras.length) {
      const soloMoviles = !fuenteActiva(ctx.estado.ejecucion, "camaras_fijas");
      const resumen = soloMoviles
        ? "Cámaras fijas apagadas por el escenario: solo se analizan móviles (ninguno con fotograma nuevo)"
        : "Ninguna cámara en vigilancia ahora mismo";
      ctx.informarTarea(resumen);
      return { resumen: soloMoviles ? resumen : "Sin cámaras que analizar" };
    }

    const observaciones: Observacion[] = [];
    const analizadas: string[] = [];
    let positivas = 0;

    for (const camara of camaras) {
      if (ctx.abortSignal.aborted) break;
      const resultado = await analizarCamaraAhora(ctx, camara);
      if (!resultado) continue;
      analizadas.push(camara.nombre);
      if (resultado.observacion) {
        positivas += 1;
        observaciones.push(resultado.observacion);
      }
    }

    const resumen = analizadas.length
      ? `Analizadas ${analizadas.length} cámaras (${analizadas.join(", ")})${positivas ? `, ${positivas} con humo o fuego confirmado` : ", sin humo"}`
      : "Ninguna cámara pudo analizarse en este ciclo";
    ctx.informarTarea(resumen);
    return { resumen, observaciones: observaciones.length ? observaciones : undefined };
  },
};
