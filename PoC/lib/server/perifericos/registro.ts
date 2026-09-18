// Registro de periféricos emparejados (poc-07). Almacén JSON propio
// (data/perifericos.json) para no tocar EstadoSistema; la consola lo lee por
// GET /api/perifericos. Mismo patrón que lib/server/estado.ts.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import type { Capacidad, CategoriaObservacion, Periferico, PosicionGeo, TipoPeriferico } from "../../tipos-perifericos";

const RUTA = path.join(process.cwd(), "data", "perifericos.json");
const RUTA_URL_PUBLICA = path.join(process.cwd(), "data", "url-publica.txt");
const LATIDO_MAX_MS = 30_000;

type Global = typeof globalThis & { __perifericos?: Periferico[]; __perifericosLock?: Promise<unknown> };
const g = globalThis as Global;

async function cargar(): Promise<Periferico[]> {
  if (g.__perifericos) return g.__perifericos;
  try {
    g.__perifericos = JSON.parse(await readFile(RUTA, "utf8")) as Periferico[];
  } catch {
    g.__perifericos = [];
  }
  return g.__perifericos;
}

async function guardar() {
  await mkdir(path.dirname(RUTA), { recursive: true });
  await writeFile(RUTA, JSON.stringify(g.__perifericos ?? [], null, 2), "utf8");
}

async function conBloqueo<T>(fn: () => Promise<T>): Promise<T> {
  const anterior = g.__perifericosLock ?? Promise.resolve();
  let liberar!: () => void;
  const mio = new Promise<void>((r) => (liberar = r));
  g.__perifericosLock = anterior.then(() => mio);
  await anterior;
  try {
    return await fn();
  } finally {
    liberar();
  }
}

const ahora = () => new Date().toISOString();
const enLinea = (p: Periferico) => Date.now() - new Date(p.ultimoLatido).getTime() < LATIDO_MAX_MS;

export async function listarPerifericos(): Promise<Periferico[]> {
  const xs = await cargar();
  return xs.map((p) => ({ ...p, enLinea: enLinea(p) }));
}

export async function obtenerPeriferico(id: string): Promise<Periferico | undefined> {
  const p = (await cargar()).find((x) => x.id === id);
  return p ? { ...p, enLinea: enLinea(p) } : undefined;
}

export async function registrarPeriferico(datos: { nombre: string; tipo: TipoPeriferico; capacidades?: Capacidad[]; userAgent?: string; posicion?: PosicionGeo; nodoId?: string }): Promise<Periferico> {
  return conBloqueo(async () => {
    const xs = await cargar();
    const p: Periferico = {
      id: `per-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`,
      nombre: datos.nombre.trim().slice(0, 60) || "Periférico sin nombre",
      tipo: datos.tipo,
      registradoEn: ahora(),
      ultimoLatido: ahora(),
      enLinea: true,
      posicion: datos.posicion,
      capacidades: datos.capacidades ?? [],
      modo: "manual",
      intervaloVigilanciaSeg: 15,
      observaciones: 0,
      confianza: datos.tipo === "efectivo" || datos.tipo === "pma" ? 0.95 : 0.7,
      nodoId: datos.nodoId,
      userAgent: datos.userAgent?.slice(0, 200),
    };
    xs.unshift(p);
    await guardar();
    return p;
  });
}

export async function latido(id: string, datos: { posicion?: PosicionGeo; capacidades?: Capacidad[]; modo?: Periferico["modo"]; intervaloVigilanciaSeg?: number }): Promise<Periferico | undefined> {
  return conBloqueo(async () => {
    const p = (await cargar()).find((x) => x.id === id);
    if (!p) return undefined;
    p.ultimoLatido = ahora();
    if (datos.posicion) p.posicion = { ...datos.posicion, timestamp: datos.posicion.timestamp || ahora() };
    if (datos.capacidades) p.capacidades = datos.capacidades;
    if (datos.modo) p.modo = datos.modo;
    if (typeof datos.intervaloVigilanciaSeg === "number") p.intervaloVigilanciaSeg = Math.max(5, Math.min(120, datos.intervaloVigilanciaSeg));
    await guardar();
    return { ...p, enLinea: true };
  });
}

export async function actualizarPeriferico(id: string, cambios: Partial<Pick<Periferico, "nombre" | "modo" | "intervaloVigilanciaSeg" | "nodoId" | "tipo">>): Promise<Periferico | undefined> {
  return conBloqueo(async () => {
    const p = (await cargar()).find((x) => x.id === id);
    if (!p) return undefined;
    Object.assign(p, cambios);
    await guardar();
    return { ...p, enLinea: enLinea(p) };
  });
}

export async function eliminarPeriferico(id: string): Promise<boolean> {
  return conBloqueo(async () => {
    const xs = await cargar();
    const i = xs.findIndex((x) => x.id === id);
    if (i < 0) return false;
    xs.splice(i, 1);
    await guardar();
    return true;
  });
}

/** El pipeline de ingesta lo llama tras procesar una observación: contador, resumen y reputación. */
export async function anotarObservacion(id: string, datos: { observacionId: string; resumen: string; categoria?: CategoriaObservacion; eventoId?: string; veredicto?: "fiable" | "dudosa" | "falsa" }): Promise<void> {
  return conBloqueo(async () => {
    const p = (await cargar()).find((x) => x.id === id);
    if (!p) return;
    p.observaciones += 1;
    p.ultimaObservacion = { id: datos.observacionId, timestamp: ahora(), resumen: datos.resumen.slice(0, 160), categoria: datos.categoria, eventoId: datos.eventoId };
    if (datos.veredicto === "fiable") p.confianza = Math.min(1, p.confianza + 0.03);
    if (datos.veredicto === "dudosa") p.confianza = Math.max(0.05, p.confianza - 0.05);
    if (datos.veredicto === "falsa") p.confianza = Math.max(0.05, p.confianza - 0.15);
    await guardar();
  });
}

function ipLan(): string | undefined {
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista ?? []) if (i.family === "IPv4" && !i.internal) return i.address;
  }
  return undefined;
}

/**
 * URL pública de la app para el QR de emparejamiento. Orden: data/url-publica.txt
 * (la escribe scripts/tunel.sh con la URL de cloudflared) > PUBLIC_BASE_URL > IP de la LAN.
 * Cámara y GPS del móvil exigen HTTPS: sin túnel solo funcionará el texto.
 */
export async function urlPublica(): Promise<{ url: string; segura: boolean; origen: "tunel" | "env" | "lan" }> {
  try {
    const u = (await readFile(RUTA_URL_PUBLICA, "utf8")).trim();
    if (/^https?:\/\//.test(u)) return { url: u.replace(/\/$/, ""), segura: u.startsWith("https://"), origen: "tunel" };
  } catch {
    /* sin túnel */
  }
  const env = process.env.PUBLIC_BASE_URL?.trim();
  if (env) return { url: env.replace(/\/$/, ""), segura: env.startsWith("https://"), origen: "env" };
  const port = process.env.PORT || "3456";
  return { url: `http://${ipLan() ?? "localhost"}:${port}`, segura: false, origen: "lan" };
}
