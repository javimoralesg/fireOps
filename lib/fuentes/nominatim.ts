// =====================================================================
// Geocodificación con Nominatim (OSM). DUEÑO: constructor B.
// Verificado (§5.3). Reglas DURAS del servicio público:
//   · 1 petición por segundo como máximo  → aquí se serializa en una cola
//   · User-Agent identificativo obligatorio
// Búsqueda limitada a España (countrycodes=es). `state_district` = provincia,
// `state` = comunidad autónoma. Caché en memoria (el callejero no cambia).
// =====================================================================
import type { Punto } from "../dominio/tipos";
import { enEspana } from "../dominio/espana";

const BASE = "https://nominatim.openstreetmap.org";
const UA = "atalaya-incendios/1.0 (HackSpain 2026; contacto javimorgalis@gmail.com)";
const TIMEOUT_MS = 12_000;
const INTERVALO_MS = 1100; // 1 req/s con margen

export interface LugarGeocodificado {
  punto: Punto;
  nombre: string;
  municipio?: string;
  provincia?: string;
  comunidad?: string;
  url: string;
}

type Global = typeof globalThis & {
  __atalayaNominatim?: { cola: Promise<unknown>; ultima: number; cacheBusqueda: Map<string, LugarGeocodificado | undefined>; cacheReverso: Map<string, { municipio: string; provincia: string; comunidad: string; url: string }> };
};
const g = globalThis as Global;
const est = () => (g.__atalayaNominatim ??= { cola: Promise.resolve(), ultima: 0, cacheBusqueda: new Map(), cacheReverso: new Map() });

/** Serializa TODAS las llamadas a Nominatim con 1,1 s entre ellas. */
function enCola<T>(fn: () => Promise<T>): Promise<T> {
  const e = est();
  const siguiente = e.cola.then(async () => {
    const espera = Math.max(0, INTERVALO_MS - (Date.now() - e.ultima));
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    try {
      return await fn();
    } finally {
      e.ultima = Date.now();
    }
  });
  e.cola = siguiente.catch(() => undefined);
  return siguiente as Promise<T>;
}

interface Direccion {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  state_district?: string;
  province?: string;
  state?: string;
  county?: string;
}

const municipioDeDireccion = (a: Direccion = {}) => a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.county ?? "";

async function pedir<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", "Accept-Language": "es" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** Busca un lugar en España por texto libre ("Navaluenga, Ávila"). */
export async function geocodificar(texto: string): Promise<LugarGeocodificado | undefined> {
  const consulta = texto.trim();
  if (!consulta) return undefined;
  const clave = consulta.toLowerCase();
  const e = est();
  if (e.cacheBusqueda.has(clave)) return e.cacheBusqueda.get(clave);

  const url = `${BASE}/search?q=${encodeURIComponent(consulta)}&format=jsonv2&limit=1&addressdetails=1&countrycodes=es&accept-language=es`;
  const filas = await enCola(() => pedir<{ lat: string; lon: string; name?: string; display_name?: string; address?: Direccion }[]>(url));
  const f = filas?.[0];
  if (!f) {
    e.cacheBusqueda.set(clave, undefined);
    return undefined;
  }
  const lugar: LugarGeocodificado = {
    punto: { lat: Number(f.lat), lon: Number(f.lon) },
    nombre: f.name || (f.display_name ?? consulta).split(",")[0].trim(),
    municipio: municipioDeDireccion(f.address) || undefined,
    provincia: f.address?.state_district ?? f.address?.province ?? undefined,
    comunidad: f.address?.state ?? undefined,
    url,
  };
  // countrycodes=es ya acota, pero Nominatim a veces cuela lugares limítrofes: fuera de España no vale.
  if (!enEspana(lugar.punto)) {
    e.cacheBusqueda.set(clave, undefined);
    return undefined;
  }
  e.cacheBusqueda.set(clave, lugar);
  return lugar;
}

/** Geocodificación inversa a nivel municipio (zoom=10). */
export async function municipioDe(p: Punto): Promise<{ municipio: string; provincia: string; comunidad: string; url: string }> {
  const clave = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
  const e = est();
  const c = e.cacheReverso.get(clave);
  if (c) return c;

  const url = `${BASE}/reverse?lat=${p.lat.toFixed(5)}&lon=${p.lon.toFixed(5)}&format=jsonv2&zoom=10&addressdetails=1&accept-language=es`;
  const j = await enCola(() => pedir<{ name?: string; address?: Direccion }>(url));
  const datos = {
    municipio: municipioDeDireccion(j.address) || j.name || "",
    provincia: j.address?.state_district ?? j.address?.province ?? "",
    comunidad: j.address?.state ?? "",
    url,
  };
  if (!datos.municipio && !datos.provincia) throw new Error("Nominatim reverse no devolvió municipio ni provincia");
  e.cacheReverso.set(clave, datos);
  return datos;
}
