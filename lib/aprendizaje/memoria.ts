// =====================================================================
// ATALAYA INCENDIOS · Memoria y aprendizaje entre ejecuciones
// ---------------------------------------------------------------------
// DUEÑO: constructor C.
// Lo que el sistema aprende NO se inventa: sale de hechos verificables de la
// ejecución (una denegación con su comentario humano, una llamada sin
// respuesta, una puntuación baja del supervisor) y se guarda con su evidencia.
//
//   leccionesPara(agenteId, contexto, k)  → lecciones relevantes por similitud
//   registrarLeccion(l)                    → embedding + Supabase + fichero
//   compararConAnterior(ejecucion)         → párrafo "qué cambió esta vez"
//   extraerLecciones(evento, decision, …)  → el LLM saca la lección del hecho
//
// Persistencia triple y tolerante: memoria + `data/aprendizaje/*.json` +
// Supabase (`lecciones`, RPC `buscar_lecciones`). Si la base no está, la demo
// sigue aprendiendo con el fichero.
// =====================================================================

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Decision, Ejecucion, Evento, Leccion, MetricasEjecucion } from "../dominio/tipos";
import { obtenerClienteSupabase } from "../db/cliente";
import { incrustarConsulta, incrustarPasajes, similitudCoseno } from "../ia/embeddings";
import { completarJson, proveedorDisponible } from "../ia/llm";

const DIRECTORIO = path.join(process.cwd(), "data", "aprendizaje");
const RUTA_LECCIONES = path.join(DIRECTORIO, "lecciones.json");
const RUTA_EJECUCIONES = path.join(DIRECTORIO, "ejecuciones.json");

/** Similitud por encima de la cual dos lecciones se consideran la misma. */
export const UMBRAL_DUPLICADO = Number(process.env.APRENDIZAJE_UMBRAL_DUPLICADO ?? 0.92);

/**
 * RENDIMIENTO (constructor S, 2026-09-19). Medido: `leccionesPara` se llamaba en
 * CADA ciclo de CADA agente (incluidos los deterministas, que van cada 5-30 s) y
 * cada llamada costaba un embedding (160-510 ms) + una RPC a Supabase + una
 * reescritura de `lecciones.json` (1,3 MB con los vectores). Tres topes nuevos:
 *  1. el orquestador ya no pide lecciones para los agentes deterministas;
 *  2. caché de la respuesta por (agenteId, k) durante TTL_CONSULTA_MS;
 *  3. caché LRU del embedding de la consulta (los contextos se repiten mucho).
 * Y `marcarAplicadas` agrupa los incrementos y escribe como mucho una vez por
 * minuto, siempre fuera del camino caliente.
 */
const TTL_CONSULTA_MS = Number(process.env.APRENDIZAJE_TTL_CONSULTA_MS ?? 60_000);
/** Entradas máximas de la caché LRU de embeddings de consulta. */
const MAX_EMBEDDINGS_CACHE = Number(process.env.APRENDIZAJE_CACHE_EMBEDDINGS ?? 64);
/** Intervalo mínimo entre dos escrituras de `lecciones.json` por uso de lecciones. */
const GUARDADO_MIN_MS = Number(process.env.APRENDIZAJE_GUARDADO_MIN_MS ?? 60_000);

interface LeccionIndexada extends Leccion {
  embedding: number[];
}

interface EntradaConsulta {
  en: number;
  lecciones: Leccion[];
}

interface CacheMemoria {
  lecciones?: LeccionIndexada[];
  cargando?: Promise<LeccionIndexada[]>;
  ejecuciones?: Ejecucion[];
  guardadoPendiente?: NodeJS.Timeout;
  /** Marca de tiempo del último volcado real de `lecciones.json`. */
  ultimoGuardado?: number;
  /** Incrementos de `vecesAplicada` aún sin volcar (se agrupan). */
  aplicacionesPendientes?: Map<string, number>;
  /** Temporizador del volcado agrupado de aplicaciones (uno cada GUARDADO_MIN_MS). */
  aplicacionesTemporizador?: NodeJS.Timeout;
  /** Respuestas recientes de `leccionesPara`, por (agenteId, k, contexto). */
  consultas?: Map<string, EntradaConsulta>;
  /** LRU de embeddings de consulta (el Map conserva el orden de inserción). */
  embeddingsConsulta?: Map<string, number[]>;
}

type ConCache = typeof globalThis & { __atalayaMemoria?: CacheMemoria };
const cache: CacheMemoria = ((globalThis as ConCache).__atalayaMemoria ??= {});

// ---------------------------------------------------------------------
// Carga y guardado
// ---------------------------------------------------------------------

async function leerJson<T>(ruta: string, porDefecto: T): Promise<T> {
  try {
    return JSON.parse(await readFile(ruta, "utf8")) as T;
  } catch {
    return porDefecto;
  }
}

async function escribirJson(ruta: string, datos: unknown): Promise<void> {
  try {
    await mkdir(DIRECTORIO, { recursive: true });
    await writeFile(ruta, JSON.stringify(datos, null, 0), "utf8");
  } catch (e) {
    console.warn(`[aprendizaje] no se pudo escribir ${path.basename(ruta)}: ${e instanceof Error ? e.message : e}`);
  }
}

interface FilaLeccion {
  id: string;
  datos: Leccion;
  embedding?: number[] | string | null;
  similitud?: number;
}

async function cargarLecciones(): Promise<LeccionIndexada[]> {
  if (cache.lecciones) return cache.lecciones;
  if (cache.cargando) return cache.cargando;
  cache.cargando = (async () => {
    let lecciones = await leerJson<LeccionIndexada[]>(RUTA_LECCIONES, []);
    const bd = obtenerClienteSupabase();
    if (bd) {
      try {
        const { data, error } = await bd.from("lecciones").select("id, datos, embedding");
        if (error) throw new Error(error.message);
        const deBd = (data ?? [])
          .map((f: FilaLeccion) => ({ ...(f.datos as Leccion), embedding: comoVector(f.embedding) }))
          .filter((l) => l.id);
        // La base manda sobre el fichero cuando hay ambas.
        const porId = new Map<string, LeccionIndexada>();
        for (const l of lecciones) porId.set(l.id, l);
        for (const l of deBd) porId.set(l.id, l);
        lecciones = [...porId.values()];
      } catch (e) {
        console.warn(`[aprendizaje] Supabase no devolvió lecciones (uso el fichero): ${e instanceof Error ? e.message : e}`);
      }
    }
    console.log(`[aprendizaje] ${lecciones.length} lecciones cargadas`);
    cache.lecciones = lecciones;
    cache.cargando = undefined;
    return lecciones;
  })();
  return cache.cargando;
}

function comoVector(v: number[] | string | null | undefined): number[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as number[];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Programa el volcado de `lecciones.json`. `urgente` (una lección NUEVA) escribe
 * a los 800 ms; el resto (subidas de `vecesAplicada`/`peso`) espera a que hayan
 * pasado al menos GUARDADO_MIN_MS desde la última escritura: el fichero pesa
 * 1,3 MB y no merece un JSON.stringify por ciclo de agente.
 */
function programarGuardado(urgente = false): void {
  const ahora = Date.now();
  const desdeUltimo = ahora - (cache.ultimoGuardado ?? 0);
  const retraso = urgente ? 800 : Math.max(800, GUARDADO_MIN_MS - desdeUltimo);
  if (cache.guardadoPendiente) {
    // Ya hay uno en marcha: solo se adelanta si el nuevo es urgente.
    if (!urgente) return;
    clearTimeout(cache.guardadoPendiente);
  }
  cache.guardadoPendiente = setTimeout(() => {
    cache.guardadoPendiente = undefined;
    cache.ultimoGuardado = Date.now();
    void escribirJson(RUTA_LECCIONES, cache.lecciones ?? []);
  }, retraso);
  cache.guardadoPendiente.unref?.();
}

// ---------------------------------------------------------------------
// Consulta de lecciones
// ---------------------------------------------------------------------

/**
 * Lecciones que este agente debería tener en cuenta para el contexto dado.
 * Orden: similitud × peso. Marca las devueltas como aplicadas (de forma
 * diferida y agrupada, para no escribir en medio de un ciclo).
 * La respuesta se memoriza TTL_CONSULTA_MS por (agenteId, k, contexto): el
 * contexto de un agente apenas cambia entre ciclos seguidos y cada recálculo
 * costaba un embedding y una RPC.
 */
export async function leccionesPara(agenteId: string, contexto: string, k = 5): Promise<Leccion[]> {
  const recortado = contexto.slice(0, 2000);
  // La clave es (agenteId, k), NO el contexto: `contextoBreve` lleva el número
  // de incendios activos y el estado de los tres primeros, así que cambia casi
  // en cada ciclo y una caché por texto exacto no acertaba nunca (medido
  // 2026-09-19: seguían saliendo ~35 embeddings/min). Las lecciones cambian en
  // minutos, no en segundos: un recálculo por agente y ventana es de sobra.
  const clave = `${agenteId}|${k}`;
  cache.consultas ??= new Map();
  const previa = cache.consultas.get(clave);
  if (previa && Date.now() - previa.en < TTL_CONSULTA_MS) {
    // Ya se marcaron como aplicadas al calcularlas: no se vuelve a contar.
    // Copia: el array viaja a `ctx.lecciones` y no debe poder mutar la caché.
    return [...previa.lecciones];
  }

  const todas = await cargarLecciones();
  const candidatas = todas.filter((l) => l.agenteId === agenteId || l.agenteId === "*");
  if (!candidatas.length) {
    cache.consultas.set(clave, { en: Date.now(), lecciones: [] });
    return [];
  }

  let vector: number[] | undefined;
  try {
    vector = await embeddingDeConsulta(recortado);
  } catch (e) {
    console.warn(`[aprendizaje] sin embeddings para recuperar lecciones: ${e instanceof Error ? e.message : e}`);
  }

  const porRpc = vector ? await leccionesPorRpc(vector, k, agenteId) : undefined;
  const elegidas = porRpc?.length
    ? porRpc
    : candidatas
        .map((l) => ({
          leccion: l as Leccion,
          puntuacion: (vector && l.embedding.length ? similitudCoseno(vector, l.embedding) : 0.5) * Math.max(0.1, l.peso),
        }))
        .sort((a, b) => b.puntuacion - a.puntuacion)
        .slice(0, k)
        .map((x) => x.leccion);

  marcarAplicadas(elegidas.map((l) => l.id));
  cache.consultas.set(clave, { en: Date.now(), lecciones: elegidas });
  podarConsultas();
  return elegidas;
}

/** Embedding de la consulta con caché LRU: los contextos de los agentes se repiten casi siempre. */
async function embeddingDeConsulta(texto: string): Promise<number[]> {
  cache.embeddingsConsulta ??= new Map();
  const guardado = cache.embeddingsConsulta.get(texto);
  if (guardado) {
    // Refresca la posición en el LRU.
    cache.embeddingsConsulta.delete(texto);
    cache.embeddingsConsulta.set(texto, guardado);
    return guardado;
  }
  const vector = await incrustarConsulta(texto);
  cache.embeddingsConsulta.set(texto, vector);
  while (cache.embeddingsConsulta.size > MAX_EMBEDDINGS_CACHE) {
    const masViejo = cache.embeddingsConsulta.keys().next().value;
    if (masViejo === undefined) break;
    cache.embeddingsConsulta.delete(masViejo);
  }
  return vector;
}

/** Quita de la caché de consultas lo que ya ha caducado (y pone un tope duro). */
function podarConsultas(): void {
  const consultas = cache.consultas;
  if (!consultas) return;
  const ahora = Date.now();
  for (const [k, v] of consultas) if (ahora - v.en >= TTL_CONSULTA_MS) consultas.delete(k);
  while (consultas.size > 200) {
    const masViejo = consultas.keys().next().value;
    if (masViejo === undefined) break;
    consultas.delete(masViejo);
  }
}

/** Invalida las cachés de consulta (al registrar una lección nueva). */
function invalidarConsultas(): void {
  cache.consultas?.clear();
}

async function leccionesPorRpc(vector: number[], k: number, agenteId: string): Promise<Leccion[] | undefined> {
  const bd = obtenerClienteSupabase();
  if (!bd) return undefined;
  try {
    const { data, error } = await bd.rpc("buscar_lecciones", { consulta: vector, k, agente_id: agenteId });
    if (error) throw new Error(error.message);
    if (!Array.isArray(data) || !data.length) return undefined;
    return (data as FilaLeccion[]).map((f) => f.datos);
  } catch (e) {
    console.warn(`[aprendizaje] la RPC buscar_lecciones no respondió: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

/**
 * Suma +1 a `vecesAplicada` y sube ligeramente el peso, sin bloquear el ciclo.
 * Los incrementos se agrupan y se vuelcan como mucho una vez por minuto: antes
 * cada ciclo de cada agente disparaba un volcado (y con él una reescritura de
 * `lecciones.json`) en el mismo tick.
 */
function marcarAplicadas(ids: string[]): void {
  if (!ids.length) return;
  cache.aplicacionesPendientes ??= new Map();
  for (const id of ids) cache.aplicacionesPendientes.set(id, (cache.aplicacionesPendientes.get(id) ?? 0) + 1);
  if (cache.aplicacionesTemporizador) return;
  cache.aplicacionesTemporizador = setTimeout(() => {
    cache.aplicacionesTemporizador = undefined;
    void volcarAplicaciones();
  }, GUARDADO_MIN_MS);
  cache.aplicacionesTemporizador.unref?.();
}

async function volcarAplicaciones(): Promise<void> {
  const pendientes = cache.aplicacionesPendientes;
  if (!pendientes?.size) return;
  cache.aplicacionesPendientes = new Map();
  const lecciones = await cargarLecciones();
  for (const [id, veces] of pendientes) {
    const l = lecciones.find((x) => x.id === id);
    if (!l) continue;
    l.vecesAplicada += veces;
    // Una lección que se usa vale más, pero nunca pasa de 1.
    l.peso = Math.min(1, Number((l.peso + 0.02 * veces).toFixed(3)));
  }
  programarGuardado();
}

/** Todas las lecciones conocidas, de mayor a menor peso (para /api/aprendizaje). */
export async function listarLecciones(): Promise<Leccion[]> {
  const todas = await cargarLecciones();
  return todas
    .map((indexada) => {
      const copia: Partial<LeccionIndexada> = { ...indexada };
      delete copia.embedding;
      return copia as Leccion;
    })
    .sort((a, b) => b.peso - a.peso || b.creadaEn.localeCompare(a.creadaEn));
}

// ---------------------------------------------------------------------
// Registro de lecciones
// ---------------------------------------------------------------------

/** Guarda una lección con su embedding en memoria, fichero y Supabase. */
export async function registrarLeccion(leccion: Leccion): Promise<void> {
  const lecciones = await cargarLecciones();
  let embedding: number[] = [];
  try {
    [embedding] = await incrustarPasajes([textoIndexable(leccion)]);
  } catch (e) {
    console.warn(`[aprendizaje] lección sin embedding (se guarda igual): ${e instanceof Error ? e.message : e}`);
  }

  const i = lecciones.findIndex((l) => l.id === leccion.id);
  const indexada: LeccionIndexada = { ...leccion, embedding };
  if (i >= 0) lecciones[i] = indexada;
  else lecciones.push(indexada);
  // Una lección nueva sí merece escribirse ya, y deja obsoleta la caché de consultas.
  invalidarConsultas();
  programarGuardado(true);

  const bd = obtenerClienteSupabase();
  if (bd) {
    try {
      const { error } = await bd.from("lecciones").upsert({
        id: leccion.id,
        ejecucion_id: leccion.ejecucionId,
        agente_id: leccion.agenteId,
        datos: leccion,
        embedding: embedding.length ? embedding : null,
      });
      if (error) throw new Error(error.message);
    } catch (e) {
      console.warn(`[aprendizaje] Supabase no aceptó la lección: ${e instanceof Error ? e.message : e}`);
    }
  }
}

function textoIndexable(l: Leccion): string {
  return `${l.categoria}. ${l.texto} Evidencia: ${l.evidencia} Cambio: ${l.cambio}`;
}

/** ¿Ya sabemos esto? Devuelve la lección duplicada si la similitud supera el umbral. */
export async function buscarDuplicada(texto: string): Promise<Leccion | undefined> {
  const lecciones = await cargarLecciones();
  if (!lecciones.length) return undefined;
  try {
    const [vector] = await incrustarPasajes([texto]);
    for (const l of lecciones) {
      if (l.embedding.length && similitudCoseno(vector, l.embedding) > UMBRAL_DUPLICADO) return l;
    }
  } catch {
    // Sin embeddings, comparación textual burda para no duplicar lo evidente.
    const normal = texto.toLowerCase().replace(/\s+/g, " ").trim();
    return lecciones.find((l) => l.texto.toLowerCase().replace(/\s+/g, " ").trim() === normal);
  }
  return undefined;
}

// ---------------------------------------------------------------------
// Extracción de lecciones con el LLM
// ---------------------------------------------------------------------

const EsquemaLeccion = z.object({
  hayLeccion: z.boolean(),
  categoria: z.enum([
    "aviso_poblacion",
    "despliegue",
    "prediccion",
    "comunicacion",
    "deteccion",
    "legal",
    "supervision",
    "general",
  ]),
  agenteId: z.string(),
  texto: z.string(),
  evidencia: z.string(),
  cambio: z.string(),
  peso: z.number(),
});

/**
 * Convierte un hecho de la ejecución en una lección accionable.
 * Fuentes por orden de valor: la denegación humana con su comentario (la
 * evidencia más fuerte que existe), la aprobación comentada, la acción fallida
 * y la puntuación baja del supervisor.
 */
export async function extraerLecciones(
  evento: Evento,
  decision?: Decision,
  comentarioHumano?: string,
): Promise<Leccion[]> {
  if (!proveedorDisponible()) return [];

  const comentario = comentarioHumano ?? decision?.comentarioHumano;
  const acciones = decision?.acciones ?? [];
  const fallidas = acciones.filter((a) => a.estado === "fallida" || a.resultado?.exito === false);

  const contexto = [
    `Hecho (${evento.tipo}, nivel ${evento.nivel}): ${evento.mensaje}`,
    decision && `Decisión: «${decision.titulo}» del agente ${decision.agenteId} (estado ${decision.estado}).`,
    decision && `Razonamiento del agente: ${decision.razonamiento}`,
    decision && acciones.length > 0 && `Acciones: ${acciones.map((a) => `${a.tipo} → ${a.descripcion} [${a.estado}]`).join("; ")}`,
    fallidas.length > 0 &&
      `Acciones que NO salieron: ${fallidas.map((a) => `${a.tipo} (${a.resultado?.resumen ?? "sin resultado"})`).join("; ")}`,
    comentario && `COMENTARIO DEL MANDO HUMANO: «${comentario}» — es la evidencia principal.`,
    decision?.evaluacion &&
      `Supervisor: ${decision.evaluacion.puntuacion}/100 (${decision.evaluacion.aprueba ? "aprueba" : "suspende"}). ` +
        `${decision.evaluacion.criterios.map((c) => `${c.nombre} ${c.puntuacion}: ${c.comentario}`).join(" · ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const r = await completarJson({
      papel: "razonamiento",
      nombreEsquema: "leccion_operativa",
      // Medido 2026-09-19: con 2000 el modelo agotaba el presupuesto razonando
      // ("contenido vacío tras razonar (2000 tokens, tope 2000)") y se reintentaba.
      maxTokens: 4000,
      system:
        "Extraes lecciones operativas de una plataforma de gestión de incendios forestales. " +
        "Una lección buena es concreta, accionable y se puede aplicar la próxima vez sin más contexto " +
        "(«antes de llamar al ayuntamiento fuera de horario, manda también un SMS»). " +
        "Si el hecho no enseña nada nuevo, pon hayLeccion=false. No inventes datos que no estén en el hecho.",
      user:
        `${contexto}\n\n` +
        `Devuelve: hayLeccion; categoria; agenteId (el agente al que aplica, o "*" si vale para todos); ` +
        `texto (la lección en una frase, en imperativo); evidencia (qué ocurrió exactamente, con cifras si las hay); ` +
        `cambio (qué hacer distinto la próxima vez); peso entre 0 y 1 (1 = lección de una denegación humana explícita).`,
      esquema: EsquemaLeccion,
    });

    if (!r.datos.hayLeccion || !r.datos.texto.trim()) return [];

    const duplicada = await buscarDuplicada(`${r.datos.categoria}. ${r.datos.texto} Evidencia: ${r.datos.evidencia} Cambio: ${r.datos.cambio}`);
    if (duplicada) {
      console.log(`[aprendizaje] lección descartada por duplicada de ${duplicada.id}`);
      return [];
    }

    const leccion: Leccion = {
      id: `lec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      ejecucionId: decision?.ejecucionId ?? "",
      agenteId: r.datos.agenteId || decision?.agenteId || "*",
      categoria: r.datos.categoria,
      texto: r.datos.texto.trim(),
      evidencia: r.datos.evidencia.trim(),
      cambio: r.datos.cambio.trim(),
      peso: Math.min(1, Math.max(0, r.datos.peso)),
      creadaEn: new Date().toISOString(),
      vecesAplicada: 0,
      origen: origenDe(evento, comentario, fallidas.length > 0),
    };
    return [leccion];
  } catch (e) {
    console.warn(`[aprendizaje] no se pudo extraer la lección: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

function origenDe(evento: Evento, comentario: string | undefined, hayFallos: boolean): Leccion["origen"] {
  if (evento.tipo === "decision_denegada") return "denegacion_humana";
  if (evento.tipo === "decision_aprobada" && comentario) return "aprobacion_humana";
  if (hayFallos || evento.tipo === "accion_fallida" || evento.tipo === "accion_ejecutada") return "resultado_accion";
  if (evento.tipo === "decision_escalada") return "supervisor";
  return "postmortem";
}

// ---------------------------------------------------------------------
// Ejecuciones y comparativa
// ---------------------------------------------------------------------

/** Guarda una ejecución en el histórico local (y la actualiza si ya estaba). */
export async function registrarEjecucion(ejecucion: Ejecucion): Promise<void> {
  const previas = await listarEjecucionesLocales();
  const otras = previas.filter((e) => e.id !== ejecucion.id);
  cache.ejecuciones = [...otras, ejecucion];
  await escribirJson(RUTA_EJECUCIONES, cache.ejecuciones);
}

async function listarEjecucionesLocales(): Promise<Ejecucion[]> {
  cache.ejecuciones ??= await leerJson<Ejecucion[]>(RUTA_EJECUCIONES, []);
  return cache.ejecuciones;
}

/**
 * Histórico de ejecuciones: el repositorio de A si existe (import dinámico
 * tolerante, porque puede no estar todavía), y si no el fichero local.
 */
export async function listarEjecuciones(): Promise<Ejecucion[]> {
  const locales = await listarEjecucionesLocales();
  try {
    const repositorio = (await import("@/lib/db/repositorio")) as {
      listarEjecuciones?: () => Promise<Ejecucion[]>;
    };
    if (typeof repositorio.listarEjecuciones === "function") {
      const remotas = await repositorio.listarEjecuciones();
      const porId = new Map<string, Ejecucion>();
      for (const e of locales) porId.set(e.id, e);
      for (const e of remotas) porId.set(e.id, e);
      return [...porId.values()].sort((a, b) => b.inicio.localeCompare(a.inicio));
    }
  } catch {
    // El repositorio aún no existe o no expone listarEjecuciones: seguimos con el fichero.
  }
  return [...locales].sort((a, b) => b.inicio.localeCompare(a.inicio));
}

interface Diferencia {
  etiqueta: string;
  ahora?: number;
  antes?: number;
  /** true si bajar es mejor (tiempos, denegaciones). */
  menosEsMejor: boolean;
  unidad: string;
}

/**
 * Párrafo en español comparando esta ejecución con la anterior cerrada.
 * Sin LLM: son cifras, y las cifras no se redactan, se cuentan.
 */
export async function compararConAnterior(ejecucion: Ejecucion): Promise<string | undefined> {
  const todas = await listarEjecuciones();
  const anterior = todas.filter((e) => e.id !== ejecucion.id && e.inicio < ejecucion.inicio).sort((a, b) => b.inicio.localeCompare(a.inicio))[0];
  if (!anterior) return undefined;

  const m = ejecucion.metricas;
  const p = anterior.metricas;
  const campos: Diferencia[] = [
    { etiqueta: "el primer aviso a población tardó", ahora: m.minutosDeteccionAviso, antes: p.minutosDeteccionAviso, menosEsMejor: true, unidad: "min" },
    { etiqueta: "la primera unidad salió en", ahora: m.minutosDeteccionDespliegue, antes: p.minutosDeteccionDespliegue, menosEsMejor: true, unidad: "min" },
    { etiqueta: "decisiones denegadas por el mando", ahora: m.decisionesDenegadas, antes: p.decisionesDenegadas, menosEsMejor: true, unidad: "" },
    { etiqueta: "escaladas a humano", ahora: m.escaladasAHumano, antes: p.escaladasAHumano, menosEsMejor: true, unidad: "" },
    { etiqueta: "poblaciones avisadas", ahora: m.poblacionesAvisadas, antes: p.poblacionesAvisadas, menosEsMejor: false, unidad: "" },
    { etiqueta: "poblaciones en peligro sin avisar", ahora: m.poblacionesEnPeligroSinAvisar, antes: p.poblacionesEnPeligroSinAvisar, menosEsMejor: true, unidad: "" },
    { etiqueta: "puntuación media del supervisor", ahora: m.puntuacionSupervisorMedia, antes: p.puntuacionSupervisorMedia, menosEsMejor: false, unidad: "/100" },
    { etiqueta: "falsos positivos de cámara", ahora: m.falsosPositivosCamara, antes: p.falsosPositivosCamara, menosEsMejor: true, unidad: "" },
  ];

  const frases: string[] = [];
  for (const c of campos) {
    if (c.ahora === undefined || c.antes === undefined) continue;
    if (c.ahora === c.antes) continue;
    const mejora = c.menosEsMejor ? c.ahora < c.antes : c.ahora > c.antes;
    const redondear = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
    frases.push(`${c.etiqueta} ${redondear(c.ahora)}${c.unidad} frente a ${redondear(c.antes)}${c.unidad} (${mejora ? "mejor" : "peor"})`);
  }

  const lecciones = await listarLecciones();
  const deAnterior = lecciones.filter((l) => l.ejecucionId === anterior.id);

  if (!frases.length && !deAnterior.length) {
    return `Respecto a «${anterior.nombre}»: sin diferencias apreciables todavía en las métricas.`;
  }
  const cola = deAnterior.length
    ? ` Se aplican ${deAnterior.length} lección(es) aprendidas allí, empezando por: «${deAnterior.sort((a, b) => b.peso - a.peso)[0].texto}».`
    : "";
  return `Respecto a la ejecución anterior («${anterior.nombre}»): ${frases.join("; ") || "sin cambios en las métricas"}.${cola}`;
}

/** Métricas vacías, para cuando hay que comparar con una ejecución sin datos. */
export function metricasVacias(): MetricasEjecucion {
  return {
    incendios: 0,
    decisionesPropuestas: 0,
    decisionesAprobadas: 0,
    decisionesDenegadas: 0,
    decisionesAutonomas: 0,
    escaladasAHumano: 0,
    poblacionesAvisadas: 0,
    poblacionesEnPeligroSinAvisar: 0,
    llamadasRealizadas: 0,
    llamadasContestadas: 0,
    falsosPositivosCamara: 0,
  };
}
