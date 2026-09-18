// Rutas por carretera con OSRM (servidor de demostración público del proyecto OSRM).
// https://router.project-osrm.org — sin clave, uso razonable, sin SLA.
//
// Se usa para dibujar la ruta real de un recurso (bomberos → incidente, incidente →
// hospital, ruta de evacuación) en vez de una línea recta. Sin efectos al importar.

export const BASE_OSRM = "https://router.project-osrm.org";

/** Timeout de la petición (ms). */
const TIMEOUT_MS = 15000;

export type PerfilOsrm = "driving";

export interface PuntoRuta {
  lat: number;
  lon: number;
}

export interface Ruta {
  /** Polilínea de la ruta en orden [lat, lon] (el orden que espera Leaflet). */
  coords: [number, number][];
  distanciaM: number;
  duracionS: number;
  fuente: "OSRM";
}

/** Caché en memoria: clave de puntos + perfil → ruta. */
const cache = new Map<string, Ruta>();

function clave(puntos: PuntoRuta[], perfil: PerfilOsrm): string {
  return `${perfil}|${puntos.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(";")}`;
}

interface RespuestaOsrm {
  code?: string;
  message?: string;
  routes?: {
    distance: number;
    duration: number;
    geometry?: { coordinates: [number, number][] };
  }[];
}

/**
 * Calcula la ruta por carretera que pasa por `puntos` (mínimo 2: origen y destino;
 * los intermedios se tratan como vías de paso).
 *
 * OSRM habla en `lon,lat`; la ruta devuelta se reordena a `[lat, lon]`.
 *
 * @throws si hay menos de 2 puntos, si el servicio falla o si no hay ruta posible.
 */
export async function ruta(puntos: PuntoRuta[], perfil: PerfilOsrm = "driving"): Promise<Ruta> {
  if (!Array.isArray(puntos) || puntos.length < 2) {
    throw new Error("OSRM necesita al menos 2 puntos (origen y destino)");
  }
  const k = clave(puntos, perfil);
  const enCache = cache.get(k);
  if (enCache) return enCache;

  const tramo = puntos.map((p) => `${p.lon},${p.lat}`).join(";");
  const url = `${BASE_OSRM}/route/v1/${perfil}/${tramo}?overview=full&geometries=geojson`;

  const res = await fetch(url, {
    headers: { "User-Agent": "crisis-mando-ai/0.1 (hackathon; contacto en repo)" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const json = (await res.json()) as RespuestaOsrm;
  const r = json.routes?.[0];
  if (json.code !== "Ok" || !r) throw new Error(`OSRM: ${json.code ?? "sin ruta"} ${json.message ?? ""}`.trim());

  const salida: Ruta = {
    coords: (r.geometry?.coordinates ?? []).map(([lon, lat]) => [lat, lon] as [number, number]),
    distanciaM: Math.round(r.distance),
    duracionS: Math.round(r.duration),
    fuente: "OSRM",
  };
  cache.set(k, salida);
  return salida;
}

/** Vacía la caché de rutas (útil en tests). */
export function limpiarCacheRutas(): void {
  cache.clear();
}
