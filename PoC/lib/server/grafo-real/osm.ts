// Cliente genérico de la Overpass API (OpenStreetMap) con caché en disco.
// Lo usa el grafo real (construir.ts) y lo puede reutilizar cualquier sesión que
// necesite POIs reales alrededor de un punto: es agnóstico de nuestro dominio.
//
// Contrato: NUNCA lanza. Si Overpass falla y no hay caché, devuelve [] (o
// origen "fallo" en la variante detallada) para que el llamador decida el respaldo.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ElementoOsm {
  tipo: "node" | "way" | "relation";
  id: number;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

/** De dónde salieron los elementos: red, caché en disco o nada. */
export type OrigenOsm = "overpass" | "cache" | "fallo";

export interface RespuestaOverpass {
  elementos: ElementoOsm[];
  origen: OrigenOsm;
}

export interface OpcionesOverpass {
  /** Validez de la caché en disco. Por defecto 24 h. */
  ttlMs?: number;
  /** Timeout por endpoint. Por defecto 25 s. */
  timeoutMs?: number;
  /** true para saltarse la caché y forzar la llamada a Overpass. */
  sinCache?: boolean;
  /** true para no tocar la red: solo caché en disco (respuesta inmediata). */
  soloCache?: boolean;
}

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const AGENTE = "atalaya-poc/0.1 (hackathon)";
const TTL_POR_DEFECTO = 24 * 60 * 60 * 1000;
const TIMEOUT_POR_DEFECTO = 25_000; // la demo no puede esperar más
const DIR_CACHE = join(process.cwd(), "data", "osm");

interface CrudoOverpass {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Consulta Overpass: `[out:json][timeout:25];( …filtros(around) … );out center tags;` */
export function componerConsulta(centro: { lat: number; lon: number }, radioM: number, filtros: string[]): string {
  const alrededor = `(around:${Math.round(radioM)},${centro.lat},${centro.lon})`;
  const cuerpo = filtros.map((f) => `${f.trim().replace(/;+$/, "")}${alrededor};`).join("\n");
  return `[out:json][timeout:25];\n(\n${cuerpo}\n);\nout center tags;`;
}

function claveCache(centro: { lat: number; lon: number }, radioM: number, filtros: string[]): string {
  const semilla = JSON.stringify([centro.lat.toFixed(5), centro.lon.toFixed(5), Math.round(radioM), [...filtros].sort()]);
  return createHash("sha1").update(semilla).digest("hex").slice(0, 16);
}

export function normalizarElementos(crudos: unknown): ElementoOsm[] {
  if (!Array.isArray(crudos)) return [];
  const salida: ElementoOsm[] = [];
  for (const bruto of crudos as CrudoOverpass[]) {
    const tipo = bruto.type;
    if (tipo !== "node" && tipo !== "way" && tipo !== "relation") continue;
    const lat = bruto.lat ?? bruto.center?.lat;
    const lon = bruto.lon ?? bruto.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number" || typeof bruto.id !== "number") continue;
    salida.push({ tipo, id: bruto.id, lat, lon, tags: bruto.tags ?? {} });
  }
  return salida;
}

async function leerCache(ruta: string, ttlMs: number): Promise<ElementoOsm[] | null> {
  try {
    const texto = await readFile(ruta, "utf8");
    const guardado = JSON.parse(texto) as { guardadoEn?: string; elementos?: ElementoOsm[] };
    const en = guardado.guardadoEn ? Date.parse(guardado.guardadoEn) : NaN;
    if (!Number.isFinite(en) || Date.now() - en > ttlMs) return null;
    return Array.isArray(guardado.elementos) ? guardado.elementos : null;
  } catch {
    return null;
  }
}

async function escribirCache(ruta: string, consulta: string, elementos: ElementoOsm[]): Promise<void> {
  try {
    await mkdir(DIR_CACHE, { recursive: true });
    await writeFile(ruta, JSON.stringify({ guardadoEn: new Date().toISOString(), consulta, elementos }), "utf8");
  } catch {
    // La caché es un lujo: si el disco falla seguimos con lo que tenemos.
  }
}

async function pedirA(endpoint: string, consulta: string, timeoutMs: number): Promise<ElementoOsm[] | null> {
  const corte = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": AGENTE, accept: "application/json" },
      body: `data=${encodeURIComponent(consulta)}`,
      signal: corte,
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[overpass] ${endpoint} respondió ${res.status}: ${(await res.text()).slice(0, 180)}`);
      return null;
    }
    const json = (await res.json()) as { elements?: unknown; remark?: string };
    if (json.remark) console.warn(`[overpass] ${endpoint} remark: ${json.remark.slice(0, 180)}`);
    return normalizarElementos(json.elements);
  } catch (err) {
    console.warn(`[overpass] ${endpoint} sin respuesta: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Consulta Overpass con caché en disco (data/osm/<hash>.json, TTL 24 h).
 * Cada filtro es un selector sin `(around:…)`, p. ej. `nwr["amenity"="hospital"]`.
 * Devuelve [] si la red falla y no hay caché; nunca lanza.
 */
export async function consultarOverpass(
  centro: { lat: number; lon: number },
  radioM: number,
  filtros: string[],
  opts: OpcionesOverpass = {},
): Promise<ElementoOsm[]> {
  return (await consultarOverpassDetallado(centro, radioM, filtros, opts)).elementos;
}

/** Igual que consultarOverpass pero informando de dónde salieron los datos. */
export async function consultarOverpassDetallado(
  centro: { lat: number; lon: number },
  radioM: number,
  filtros: string[],
  opts: OpcionesOverpass = {},
): Promise<RespuestaOverpass> {
  if (filtros.length === 0) return { elementos: [], origen: "cache" };
  const ttlMs = opts.ttlMs ?? TTL_POR_DEFECTO;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_POR_DEFECTO;
  const consulta = componerConsulta(centro, radioM, filtros);
  const ruta = join(DIR_CACHE, `${claveCache(centro, radioM, filtros)}.json`);

  if (!opts.sinCache) {
    const enCache = await leerCache(ruta, ttlMs);
    if (enCache) return { elementos: enCache, origen: "cache" };
  }
  if (opts.soloCache) {
    const caducada = await leerCache(ruta, Number.MAX_SAFE_INTEGER);
    return caducada ? { elementos: caducada, origen: "cache" } : { elementos: [], origen: "fallo" };
  }

  for (const endpoint of ENDPOINTS) {
    const elementos = await pedirA(endpoint, consulta, timeoutMs);
    if (elementos && elementos.length > 0) {
      await escribirCache(ruta, consulta, elementos);
      return { elementos, origen: "overpass" };
    }
  }

  // Última red de seguridad: caché caducada mejor que nada.
  const caducada = await leerCache(ruta, Number.MAX_SAFE_INTEGER);
  if (caducada) return { elementos: caducada, origen: "cache" };
  return { elementos: [], origen: "fallo" };
}
