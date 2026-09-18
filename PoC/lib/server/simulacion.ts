// Reproductor de escenarios en el servidor: inyecta eventos de data/dataset/*.json
// por la misma puerta que los periféricos reales (pipeline de poc-07 en
// POST /api/ingesta/observacion; si no está disponible, ingestarObservacion del motor).
// Sobrevive a recargas del navegador (timer en globalThis) y lo ven todos los clientes.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { EventoIngesta, FuenteIngesta } from "../types";
import type { EstadoSimulacion } from "../tipos-sistema";
import { configurar, ingestarObservacion, obtenerEstado } from "./motor";

const DIR = path.join(process.cwd(), "data", "dataset");
export const ESCENARIO_GUION = "simulacro-mendez-alvaro"; // el guion de 8 ticks de escenario.ts

export interface EventoDataset {
  id?: string;
  lugar?: { nombre: string; direccion?: string; osmId?: string };
  offsetSeg: number;
  titulo?: string;
  fuente?: FuenteIngesta;
  canal?: string;
  observacion: Record<string, unknown> & { perifericoId?: string; tipo?: string; texto?: string; imagenUrl?: string; imagenBase64?: string; posicion?: { lat: number; lon: number }; sensor?: { magnitud: string; valor: number; unidad: string }; autor?: string; tipoEmergencia?: string; simulacro?: boolean; datasetId?: string };
  ruido?: boolean;
  duplicaDe?: string;
  bulo?: { motivo: string };
  esperado?: { categoria?: string; gravedad?: string; foco?: string };
}

export interface Escenario {
  id: string;
  nombre: string;
  tipo: string;
  descripcion?: string;
  centro?: { lat: number; lon: number; nombre?: string };
  duracionSeg?: number;
  eventos: EventoDataset[];
}

type G = typeof globalThis & { __crisisSim?: EstadoSimulacion & { timer?: ReturnType<typeof setTimeout>; escenario?: Escenario; baseUrl?: string; proximoEn?: number; enCurso?: { eventoId: string; desde: number }; reproduccionId?: number; ultimoTick?: { tick: number; en: number }; intervaloGuion?: number } };
const g = globalThis as G;

function sim() {
  if (!g.__crisisSim) g.__crisisSim = { activa: false, velocidad: 1, indice: 0, total: 0, ultimos: [] };
  return g.__crisisSim;
}

export type ResumenEscenario = Pick<Escenario, "id" | "nombre" | "tipo" | "descripcion" | "duracionSeg"> & { eventos: number };

export async function listarEscenarios(): Promise<ResumenEscenario[]> {
  const out: ResumenEscenario[] = [
    { id: ESCENARIO_GUION, nombre: "Simulacro guiado: incendio industrial Méndez Álvaro (8 ticks)", tipo: "incendio_industrial", descripcion: "Guion de respaldo con giro de viento; avanza un tick por paso.", duracionSeg: 8 * 45, eventos: 8 },
  ];
  try {
    for (const f of (await readdir(DIR)).filter((x) => x.endsWith(".json") && !x.startsWith("_") && x !== "sueltos.json").sort()) {
      try {
        const esc = JSON.parse(await readFile(path.join(DIR, f), "utf8")) as Escenario;
        out.push({ id: esc.id ?? f.replace(/\.json$/, ""), nombre: esc.nombre, tipo: esc.tipo, descripcion: esc.descripcion, duracionSeg: esc.duracionSeg, eventos: esc.eventos?.length ?? 0 });
      } catch (err) {
        console.warn("[simulacion] dataset ilegible", f, err instanceof Error ? err.message : err);
      }
    }
  } catch {
    /* sin carpeta data/dataset todavía */
  }
  return out;
}

async function cargarEscenario(id: string): Promise<Escenario> {
  const archivo = path.join(DIR, `${id.replace(/[^a-z0-9_-]/gi, "")}.json`);
  const esc = JSON.parse(await readFile(archivo, "utf8")) as Escenario;
  esc.id = esc.id ?? id;
  esc.eventos = [...(esc.eventos ?? [])].sort((a, b) => a.offsetSeg - b.offsetSeg);
  return esc;
}

/** Convierte una observación del dataset en EventoIngesta (fallback cuando no hay pipeline de periféricos). */
function eventoDesdeObservacion(ev: EventoDataset, escenarioId: string): EventoIngesta {
  const o = ev.observacion;
  const fuente: FuenteIngesta = ev.fuente ?? (o.tipo === "publicacion" ? "Exa" : o.tipo === "sensor" ? "Periferico" : o.tipo === "voz" ? "HappyRobot" : "Ciudadano");
  const texto = o.texto ?? ev.titulo ?? "Observación simulada";
  const verificacion = ev.bulo ? { estado: "sospechoso" as const, motivo: ev.bulo.motivo } : ev.duplicaDe ? { estado: "duplicado" as const, motivo: `Duplicado de ${ev.duplicaDe} (dataset)`, duplicaDe: ev.duplicaDe } : undefined;
  return {
    id: ev.id ?? `sim-${escenarioId}-${Date.now().toString(36)}`,
    fuente,
    timestamp: new Date().toISOString(),
    titulo: ev.titulo ?? texto.slice(0, 80),
    detalle: `${texto}${o.sensor ? ` [${o.sensor.magnitud}: ${o.sensor.valor} ${o.sensor.unidad}]` : ""} · simulacro ${escenarioId}${ev.canal ? ` · canal ${ev.canal}` : ""}`,
    confianza: ev.ruido ? 0.3 : ev.bulo ? 0.35 : 0.75,
    ubicacion: (o as { ubicacion?: string }).ubicacion || ev.lugar?.nombre,
    imagenUrl: o.imagenUrl,
    geo: o.posicion ? { lat: o.posicion.lat, lon: o.posicion.lon } : undefined,
    perifericoId: o.perifericoId,
    verificacion,
    etiquetas: [...((o as { etiquetas?: string[] }).etiquetas ?? []), "simulacro"],
    categoria: (o as { categoria?: string }).categoria,
  };
}

async function imagenBase64(imagenUrl?: string): Promise<{ imagenBase64?: string; imagenMime?: string }> {
  if (!imagenUrl || !imagenUrl.startsWith("/")) return {};
  try {
    const buf = await readFile(path.join(process.cwd(), "public", imagenUrl));
    const ext = path.extname(imagenUrl).toLowerCase();
    return { imagenBase64: buf.toString("base64"), imagenMime: ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg" };
  } catch {
    return {};
  }
}

/** Inyecta un evento: pipeline de periféricos (poc-07) si responde; si no, motor directo. */
export async function inyectar(ev: EventoDataset, escenarioId: string, baseUrl?: string): Promise<EstadoSimulacion["ultimos"][number]> {
  const eventoId = ev.id ?? `sim-${Date.now().toString(36)}`;
  const base = { datasetId: escenarioId, eventoId, timestamp: new Date().toISOString() };
  const s = sim();
  const url = baseUrl ?? s.baseUrl;
  if (url) {
    try {
      // categoriaForzada/tipoEmergencia: el pipeline puede usarlos cuando no hay LLM (y lo marca como "clasificación del dataset").
      const o = { ...ev.observacion, ...(await imagenBase64(ev.observacion.imagenUrl)), simulacro: true, datasetId: escenarioId, eventoDatasetId: eventoId, canal: ev.canal, esperado: ev.esperado, categoriaForzada: ev.esperado?.categoria, tipoEmergencia: ev.observacion.tipoEmergencia };
      const res = await fetch(`${url}/api/ingesta/observacion`, { method: "POST", headers: { "content-type": "application/json", "x-atalaya-rol": "administrador", "x-simulacion": "1" }, body: JSON.stringify(o), signal: AbortSignal.timeout(Number(process.env.SIM_PIPELINE_TIMEOUT_MS ?? 300_000)) });
      if (res.ok) {
        const r = (await res.json()) as { impacto?: { accion?: string; decisionId?: string }; evento?: { id?: string; categoria?: string }; analisis?: { categoria?: string } };
        return { ...base, eventoId: r.evento?.id ?? eventoId, impacto: r.impacto?.accion ?? "registrado", decisionId: r.impacto?.decisionId, categoria: r.analisis?.categoria ?? r.evento?.categoria };
      }
      if (res.status !== 404) {
        // El pipeline existe pero falló: NO duplicar por el motor directo.
        return { ...base, impacto: "error", error: `pipeline ${res.status}: ${(await res.text()).slice(0, 160)}` };
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (/timeout|abort/i.test(m)) {
        // El pipeline sigue procesando en segundo plano: no se inyecta una segunda vez.
        return { ...base, impacto: "timeout", error: `pipeline sin respuesta en el límite; el evento seguirá procesándose (${m})` };
      }
      console.warn("[simulacion] pipeline no disponible:", m);
    }
  }
  // Fallback: motor directo (clasificación local + decisión si no es ruido/bulo/duplicado)
  const x = eventoDesdeObservacion(ev, escenarioId);
  if (ev.esperado?.categoria && !x.categoria) {
    x.categoria = ev.esperado.categoria;
    x.procesadoPor = [...(x.procesadoPor ?? []), { modelo: "dataset (clasificación esperada)", latenciaMs: 0, tarea: "clasificacion" }];
  }
  const pedir = !ev.ruido && !ev.bulo && !ev.duplicaDe;
  const r = await ingestarObservacion(x, { pedirDecision: pedir, foco: ev.esperado?.foco, descripcionFoco: pedir ? `${x.titulo}. ${x.detalle}` : undefined });
  return { ...base, eventoId: r.eventoId, impacto: r.decisionId ? "nuevo_foco" : ev.ruido ? "ruido" : "registrado", decisionId: r.decisionId, categoria: x.categoria };
}

function programarSiguiente(reproduccionId = sim().reproduccionId) {
  const s = sim();
  if (!s.activa || !s.escenario || reproduccionId !== s.reproduccionId) return;
  if (s.indice >= s.total) {
    s.activa = false;
    s.siguienteEnSeg = undefined;
    return;
  }
  const actual = s.escenario.eventos[s.indice];
  const anterior = s.indice > 0 ? s.escenario.eventos[s.indice - 1].offsetSeg : actual.offsetSeg;
  const esperaMs = Math.max(0, ((actual.offsetSeg - anterior) * 1000) / s.velocidad);
  s.proximoEn = Date.now() + esperaMs;
  s.siguienteEnSeg = Math.round(esperaMs / 1000);
  s.timer = setTimeout(async () => {
    const st = sim();
    if (!st.activa || !st.escenario || reproduccionId !== st.reproduccionId) return;
    const ev = st.escenario.eventos[st.indice];
    st.indice += 1;
    st.enCurso = { eventoId: ev.id ?? `sim-${st.indice}`, desde: Date.now() };
    try {
      st.ultimos.unshift(await inyectar(ev, st.escenario.id));
    } catch (err) {
      st.ultimos.unshift({ datasetId: st.escenario.id, eventoId: ev.id ?? `sim-${st.indice}`, impacto: "error", timestamp: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) });
    }
    st.enCurso = undefined;
    if (st.ultimos.length > 100) st.ultimos.length = 100;
    programarSiguiente(reproduccionId);
  }, esperaMs);
}

/** El guion de 8 ticks se reproduce con el auto-avance del motor (un solo temporizador de ticks). */
async function programarGuion() {
  const s = sim();
  const intervalo = Math.max(10, Math.round(45 / s.velocidad));
  s.intervaloGuion = intervalo;
  await configurar({ autoAvance: true, intervaloSeg: intervalo });
  s.ultimoTick = { tick: s.indice, en: Date.now() };
  s.proximoEn = Date.now() + intervalo * 1000;
  s.siguienteEnSeg = intervalo;
}

export async function iniciarSimulacion(escenarioId: string, velocidad = 1, desdeSeg = 0, baseUrl?: string): Promise<EstadoSimulacion> {
  detenerSimulacion();
  const s = sim();
  s.reproduccionId = (s.reproduccionId ?? 0) + 1;
  s.velocidad = Math.max(0.1, Math.min(60, velocidad));
  s.baseUrl = baseUrl ?? s.baseUrl;
  if (s.escenarioId !== escenarioId) s.ultimos = []; // mismo escenario: se conserva el historial
  s.iniciadaEn = new Date().toISOString();
  s.activa = true;
  if (escenarioId === ESCENARIO_GUION) {
    const e = await obtenerEstado();
    s.escenario = undefined;
    s.escenarioId = ESCENARIO_GUION;
    s.nombre = "Simulacro guiado: incendio industrial Méndez Álvaro";
    s.indice = e.incidente.tick;
    s.total = 8;
    if (e.incidente.tick >= 8 || !e.incidente.activo) {
      s.activa = false; // guion terminado: no se activa el auto-avance
      return estadoSimulacion(e.incidente.tick);
    }
    await programarGuion();
    return estadoSimulacion(e.incidente.tick);
  }
  const esc = await cargarEscenario(escenarioId);
  s.escenario = esc;
  s.escenarioId = esc.id;
  s.nombre = esc.nombre;
  s.total = esc.eventos.length;
  s.indice = esc.eventos.findIndex((x) => x.offsetSeg >= desdeSeg);
  if (s.indice < 0) s.indice = s.total;
  programarSiguiente();
  return estadoSimulacion();
}

export function detenerSimulacion(): EstadoSimulacion {
  const s = sim();
  if (s.timer) clearTimeout(s.timer);
  s.timer = undefined;
  if (s.escenarioId === ESCENARIO_GUION) void configurar({ autoAvance: false });
  s.reproduccionId = (s.reproduccionId ?? 0) + 1; // invalida cualquier callback en vuelo
  s.enCurso = undefined;
  s.activa = false;
  s.siguienteEnSeg = undefined;
  return estadoSimulacion();
}

/** Cambia la velocidad sin reiniciar: reprograma el siguiente evento (o el intervalo del guion). */
export async function cambiarVelocidad(velocidad: number): Promise<EstadoSimulacion> {
  const s = sim();
  s.velocidad = Math.max(0.1, Math.min(60, velocidad));
  if (!s.activa) return estadoSimulacion();
  if (s.escenarioId === ESCENARIO_GUION) {
    await programarGuion();
  } else if (!s.enCurso) {
    if (s.timer) clearTimeout(s.timer);
    programarSiguiente();
  }
  return estadoSimulacion();
}

export function estadoSimulacion(tick?: number): EstadoSimulacion {
  const s = sim();
  const { timer: _t, escenario: _e, baseUrl: _b, proximoEn, enCurso, reproduccionId: _r, ultimoTick: _u, intervaloGuion: _i, ...resto } = s;
  const offsetSeg = s.escenario ? (s.escenario.eventos[Math.min(s.indice, s.total) - 1]?.offsetSeg ?? 0) : s.indice * 45;
  if (s.escenarioId === ESCENARIO_GUION && typeof tick === "number") {
    if (tick !== s.ultimoTick?.tick) s.ultimoTick = { tick, en: Date.now() };
    s.indice = tick;
    if (s.activa && tick >= s.total) {
      s.activa = false;
      void configurar({ autoAvance: false });
    }
    if (s.activa && s.intervaloGuion) s.proximoEn = (s.ultimoTick?.en ?? Date.now()) + s.intervaloGuion * 1000;
  }
  return { ...resto, offsetSeg, indice: s.indice, activa: s.activa, siguienteEnSeg: s.activa && proximoEn && !enCurso ? Math.max(0, Math.round((proximoEn - Date.now()) / 1000)) : undefined, procesando: enCurso ? { eventoId: enCurso.eventoId, desdeHaceSeg: Math.round((Date.now() - enCurso.desde) / 1000) } : undefined };
}

/** Inyección manual de un evento compuesto a mano (o de data/dataset/sueltos.json). */
export async function inyectarManual(ev: EventoDataset, baseUrl?: string) {
  const s = sim();
  if (baseUrl) s.baseUrl = baseUrl;
  const r = await inyectar({ ...ev, offsetSeg: 0 }, ev.observacion.datasetId ?? "manual");
  s.ultimos.unshift(r);
  if (s.ultimos.length > 100) s.ultimos.length = 100;
  return r;
}

export async function eventosSueltos(): Promise<EventoDataset[]> {
  try {
    const j = JSON.parse(await readFile(path.join(DIR, "sueltos.json"), "utf8")) as { eventos?: EventoDataset[] } | EventoDataset[];
    return Array.isArray(j) ? j : (j.eventos ?? []);
  } catch {
    return [];
  }
}
