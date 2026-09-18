// Almacén de estado del sistema: singleton en memoria (sobrevive al HMR de
// Next vía globalThis) + persistencia JSON en data/estado.json para que la
// demo sobreviva a recargas y reinicios del servidor.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EntradaTimeline, EstadoSistema } from "../tipos-sistema";

const RUTA = path.join(process.cwd(), "data", "estado.json");

type Global = typeof globalThis & { __crisisEstado?: EstadoSistema; __crisisCargado?: boolean; __crisisLock?: Promise<unknown>; __crisisVersion?: number; __crisisSuscriptores?: Set<(version: number) => void> };
const g = globalThis as Global;

export async function cargarEstado(fabricaInicial: () => Promise<EstadoSistema>): Promise<EstadoSistema> {
  if (g.__crisisEstado) return g.__crisisEstado;
  if (!g.__crisisCargado) {
    g.__crisisCargado = true;
    try {
      const txt = await readFile(RUTA, "utf8");
      g.__crisisEstado = JSON.parse(txt) as EstadoSistema;
      return g.__crisisEstado;
    } catch {
      /* no hay snapshot: se crea uno nuevo */
    }
  }
  g.__crisisEstado = await fabricaInicial();
  await guardar();
  return g.__crisisEstado;
}

export function estadoActual(): EstadoSistema {
  if (!g.__crisisEstado) throw new Error("Estado no cargado; llama a cargarEstado() primero.");
  return g.__crisisEstado;
}

export function reemplazarEstado(nuevo: EstadoSistema) {
  g.__crisisEstado = nuevo;
}

export async function guardar() {
  const e = g.__crisisEstado;
  if (!e) return;
  e.actualizadoEn = new Date().toISOString();
  g.__crisisVersion = (g.__crisisVersion ?? 0) + 1;
  for (const fn of g.__crisisSuscriptores ?? []) {
    try {
      fn(g.__crisisVersion);
    } catch {
      /* un suscriptor roto no bloquea */
    }
  }
  await mkdir(path.dirname(RUTA), { recursive: true });
  await writeFile(RUTA, JSON.stringify(e, null, 2), "utf8");
}

/** Versión monótona del estado (sube en cada guardar()). */
export function versionEstado(): number {
  return g.__crisisVersion ?? 0;
}

/** Suscripción a cambios (para SSE). Devuelve la función para cancelar. */
export function suscribir(fn: (version: number) => void): () => void {
  g.__crisisSuscriptores = g.__crisisSuscriptores ?? new Set();
  g.__crisisSuscriptores.add(fn);
  return () => g.__crisisSuscriptores?.delete(fn);
}

/** Serializa mutaciones concurrentes (tick automático + acciones del usuario). */
export async function conBloqueo<T>(fn: () => Promise<T>): Promise<T> {
  const anterior = g.__crisisLock ?? Promise.resolve();
  let liberar!: () => void;
  const mio = new Promise<void>((r) => (liberar = r));
  g.__crisisLock = anterior.then(() => mio);
  await anterior;
  try {
    return await fn();
  } finally {
    liberar();
  }
}

/** Id único incluso entre bundles/procesos distintos (Next dev instancia los módulos por ruta). */
export function nuevoId(prefijo: string) {
  return `${prefijo}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Elimina duplicados por id conservando la primera aparición (defensa ante carreras o snapshots). */
export function dedupePorId<T extends { id: string }>(xs: T[]): T[] {
  const vistos = new Set<string>();
  return xs.filter((x) => (vistos.has(x.id) ? false : (vistos.add(x.id), true)));
}

export function registrar(e: EstadoSistema, tipo: EntradaTimeline["tipo"], texto: string, ref?: string) {
  e.timeline.unshift({ id: nuevoId("tl"), timestamp: new Date().toISOString(), tick: e.incidente.tick, tipo, texto, ref });
  if (e.timeline.length > 300) e.timeline.length = 300;
}
