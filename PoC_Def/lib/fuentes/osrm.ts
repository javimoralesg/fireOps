// =====================================================================
// Rutas por carretera real con OSRM. DUEÑO: constructor B.
// Verificado (§5.2): https://router.project-osrm.org/route/v1/driving/
// {lon1},{lat1};{lon2},{lat2}?overview=full&geometries=geojson
// Ávila → Navaluenga: 38,4 km / 41 min / 1178 puntos en 0,22 s. Sin clave.
// Servidor de demostración sin SLA: conviene no pasar de ~1 req/s sostenida,
// por eso cacheamos por par origen-destino redondeado.
// =====================================================================
import type { Punto, Trazado } from "../dominio/tipos";
import { haversine } from "./geo";

const BASE = "https://router.project-osrm.org";
const TIMEOUT_MS = 15_000;
const CACHE_MS = 30 * 60_000;

export interface RutaCalculada {
  coords: Trazado;
  distanciaM: number;
  duracionS: number;
  url: string;
}

type Global = typeof globalThis & { __atalayaOsrm?: Map<string, { en: number; datos: RutaCalculada }> };
const g = globalThis as Global;
const cache = () => (g.__atalayaOsrm ??= new Map());

const coord = (p: Punto) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`;

/** Ruta en coche entre dos puntos. Devuelve la polilínea en [lat, lon]. */
export async function ruta(origen: Punto, destino: Punto): Promise<RutaCalculada> {
  const clave = `${coord(origen)}|${coord(destino)}`;
  const c = cache().get(clave);
  if (c && Date.now() - c.en < CACHE_MS) return c.datos;

  const url = `${BASE}/route/v1/driving/${coord(origen)};${coord(destino)}?overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`OSRM ${res.status} ${res.statusText}`);
  const j = (await res.json()) as {
    code?: string;
    message?: string;
    routes?: { distance: number; duration: number; geometry?: { coordinates: [number, number][] } }[];
  };
  if (j.code !== "Ok" || !j.routes?.length) throw new Error(`OSRM sin ruta: ${j.code ?? "?"} ${j.message ?? ""}`.trim());
  const r = j.routes[0];
  const coords: Trazado = (r.geometry?.coordinates ?? []).map(([lon, lat]) => [lat, lon] as [number, number]);
  if (!coords.length) throw new Error("OSRM devolvió una ruta sin geometría");

  const datos: RutaCalculada = { coords, distanciaM: Math.round(r.distance), duracionS: Math.round(r.duration), url };
  cache().set(clave, { en: Date.now(), datos });
  return datos;
}

/**
 * Matriz de duraciones desde un origen a N destinos en UNA llamada
 * (`/table/v1/driving/...?sources=0`): "qué parque de bomberos llega antes".
 * Devuelve segundos por destino (Infinity si OSRM no encuentra ruta).
 */
export async function tiemposDesde(origen: Punto, destinos: Punto[]): Promise<{ duracionesS: number[]; url: string }> {
  if (!destinos.length) return { duracionesS: [], url: "" };
  const lista = [origen, ...destinos.slice(0, 90)].map(coord).join(";");
  const url = `${BASE}/table/v1/driving/${lista}?sources=0&annotations=duration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`OSRM table ${res.status} ${res.statusText}`);
  const j = (await res.json()) as { code?: string; durations?: (number | null)[][] };
  if (j.code !== "Ok" || !j.durations?.[0]) throw new Error(`OSRM table sin datos: ${j.code ?? "?"}`);
  return { duracionesS: j.durations[0].slice(1).map((d) => (typeof d === "number" ? Math.round(d) : Infinity)), url };
}

/** Longitud acumulada de la polilínea en metros (por segmento). */
function longitudes(coords: Trazado): { acumulada: number[]; total: number } {
  const acumulada = [0];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversine({ lat: coords[i - 1][0], lon: coords[i - 1][1] }, { lat: coords[i][0], lon: coords[i][1] }) * 1000;
    acumulada.push(total);
  }
  return { acumulada, total };
}

/** Punto sobre la polilínea en un progreso 0..1 (interpolando dentro del segmento). */
export function puntoEnRuta(coords: Trazado, progreso: number): Punto {
  if (!coords.length) throw new Error("Ruta vacía");
  const t = Math.max(0, Math.min(1, progreso));
  const { acumulada, total } = longitudes(coords);
  if (total === 0) return { lat: coords[0][0], lon: coords[0][1] };
  const objetivo = t * total;
  let i = 1;
  while (i < acumulada.length - 1 && acumulada[i] < objetivo) i += 1;
  const d0 = acumulada[i - 1];
  const d1 = acumulada[i];
  const f = d1 > d0 ? (objetivo - d0) / (d1 - d0) : 0;
  return {
    lat: +(coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f).toFixed(6),
    lon: +(coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f).toFixed(6),
  };
}

/**
 * Avanza `metros` sobre una ruta desde su progreso actual.
 * Lo usa el constructor D para mover unidades por la carretera real.
 */
export function avanzarPorRuta(
  ruta: { coords: Trazado; distanciaM: number; progreso?: number },
  metros: number,
): { progreso: number; posicion: Punto; llegado: boolean; metrosRestantes: number } {
  const total = ruta.distanciaM > 0 ? ruta.distanciaM : longitudes(ruta.coords).total;
  const actual = Math.max(0, Math.min(1, ruta.progreso ?? 0));
  const recorrido = actual * total + Math.max(0, metros);
  const progreso = total > 0 ? Math.min(1, recorrido / total) : 1;
  return {
    progreso: +progreso.toFixed(5),
    posicion: puntoEnRuta(ruta.coords, progreso),
    llegado: progreso >= 1,
    metrosRestantes: Math.max(0, Math.round(total - recorrido)),
  };
}
