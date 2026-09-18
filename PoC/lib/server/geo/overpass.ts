// Puntos de interés sensibles alrededor del incidente, vía Overpass API (OpenStreetMap).
//
// Una sola consulta por llamada (la API penaliza el abuso), `out center` para que los
// `way`/`relation` devuelvan un centroide, timeout 25 s y caché en memoria por
// (lat, lon, radio) redondeados. Sin efectos al importar.

export const URL_OVERPASS = "https://overpass-api.de/api/interpreter";

export const USER_AGENT_OVERPASS = "crisis-mando-ai/0.1 (hackathon; contacto en repo)";

/** Timeout declarado a Overpass y usado también como corte del fetch (con algo de margen). */
const TIMEOUT_S = 25;
const TIMEOUT_MS = (TIMEOUT_S + 5) * 1000;

/** Tope de POIs devueltos, para no inundar el grafo ni el mapa. */
export const MAX_POIS = 60;

export type TipoPoi =
  | "hospital"
  | "bomberos"
  | "policia"
  | "centro_salud"
  | "colegio"
  | "residencia"
  | "refugio";

export interface Poi {
  /** "node/123" | "way/456" (Overpass también puede devolver "relation/789"). */
  id: string;
  tipo: TipoPoi;
  nombre: string;
  lat: number;
  lon: number;
  /** Ficha en openstreetmap.org. */
  url: string;
  fuente: "Overpass";
  /** Distancia en metros al centro de la consulta (extra útil para ordenar en la UI). */
  distanciaM: number;
}

interface ElementoOverpass {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Caché en memoria: "lat|lon|radio" redondeados → POIs. */
const cache = new Map<string, Poi[]>();

function clave(lat: number, lon: number, radioM: number): string {
  // ~11 m de resolución en la clave: dos consultas casi idénticas comparten caché.
  return `${lat.toFixed(4)}|${lon.toFixed(4)}|${Math.round(radioM / 50) * 50}`;
}

const RAD = Math.PI / 180;
const R_TIERRA = 6371008.8;

function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_TIERRA * Math.asin(Math.sqrt(h));
}

/**
 * Caja envolvente (latSur,lonOeste,latNorte,lonEste) del círculo de radio `radioM`.
 * 1° de latitud ≈ 111 320 m; en longitud se corrige por cos(lat).
 */
export function bboxDesdeRadio(lat: number, lon: number, radioM: number): string {
  const dLat = radioM / 111320;
  const dLon = radioM / (111320 * Math.cos(lat * RAD));
  return `${(lat - dLat).toFixed(6)},${(lon - dLon).toFixed(6)},${(lat + dLat).toFixed(6)},${(lon + dLon).toFixed(6)}`;
}

/**
 * Construye LA consulta Overpass QL (una sola por llamada).
 *
 * Se filtra por `[bbox:...]` y no por diez cláusulas `(around:...)`: cada `around`
 * obliga a la instancia pública a recalcular el índice espacial y, con diez de ellas,
 * la consulta agota los 25 s de forma sistemática. Con la caja envolvente la respuesta
 * llega en pocos segundos; el recorte al círculo exacto de `radioM` se hace después en
 * cliente con la distancia haversine.
 *
 * `social_facility` entra entera y se descarta luego todo lo que no sea
 * `nursing_home` / `assisted_living` (ver {@link tipoDesdeTags}).
 */
export function consultaOverpass(lat: number, lon: number, radioM: number): string {
  const bbox = bboxDesdeRadio(lat, lon, radioM);
  return `[out:json][timeout:${TIMEOUT_S}][bbox:${bbox}];
(
  nwr[amenity~"^(hospital|fire_station|police|clinic|doctors|school|social_facility|community_centre)$"][name];
  nwr[leisure=sports_centre][name];
);
out center 400;`;
}

/** Traduce las etiquetas OSM al tipo funcional que usa el centro de mando. */
export function tipoDesdeTags(tags: Record<string, string>): TipoPoi | null {
  const amenity = tags.amenity;
  if (amenity === "hospital") return "hospital";
  if (amenity === "fire_station") return "bomberos";
  if (amenity === "police") return "policia";
  if (amenity === "clinic" || amenity === "doctors") return "centro_salud";
  if (amenity === "school") return "colegio";
  if (amenity === "social_facility") {
    const sf = tags.social_facility;
    return sf === "nursing_home" || sf === "assisted_living" ? "residencia" : null;
  }
  // Polideportivos y centros culturales/sociales: candidatos a albergue temporal.
  if (amenity === "community_centre") return "refugio";
  if (tags.leisure === "sports_centre") return "refugio";
  return null;
}

function normalizarNombre(n: string): string {
  return n
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * POIs sensibles (sanitarios, emergencias, escolares, residencias y posibles refugios)
 * dentro de `radioM` metros del punto dado.
 *
 * Resultado ordenado por distancia, deduplicado (mismo id, y mismo tipo+nombre en un
 * radio de ~150 m para fusionar el típico `way` + `relation` del mismo edificio) y
 * limitado a {@link MAX_POIS}.
 */
export async function poisCercanos(lat: number, lon: number, radioM = 2000): Promise<Poi[]> {
  const k = clave(lat, lon, radioM);
  const enCache = cache.get(k);
  if (enCache) return enCache;

  const res = await fetch(URL_OVERPASS, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT_OVERPASS,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ data: consultaOverpass(lat, lon, radioM) }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const json = (await res.json()) as { elements?: ElementoOverpass[]; remark?: string };
  if (json.remark && !json.elements?.length) throw new Error(`Overpass: ${json.remark}`);

  const brutos: Poi[] = [];
  for (const e of json.elements ?? []) {
    const tags = e.tags ?? {};
    const nombre = tags.name?.trim();
    if (!nombre) continue; // solo POIs con nombre: si no, no se puede citar en un parte
    const tipo = tipoDesdeTags(tags);
    if (!tipo) continue;
    const pLat = e.lat ?? e.center?.lat;
    const pLon = e.lon ?? e.center?.lon;
    if (typeof pLat !== "number" || typeof pLon !== "number") continue;
    const distancia = haversine(lat, lon, pLat, pLon);
    if (distancia > radioM) continue; // recorte al círculo real (la consulta pide una caja)
    const id = `${e.type}/${e.id}`;
    brutos.push({
      id,
      tipo,
      nombre,
      lat: pLat,
      lon: pLon,
      url: `https://www.openstreetmap.org/${id}`,
      fuente: "Overpass",
      distanciaM: Math.round(distancia),
    });
  }

  brutos.sort((a, b) => a.distanciaM - b.distanciaM);

  const vistosId = new Set<string>();
  const vistosNombre: Poi[] = [];
  const salida: Poi[] = [];
  for (const p of brutos) {
    if (vistosId.has(p.id)) continue;
    const duplicado = vistosNombre.some(
      (q) =>
        q.tipo === p.tipo &&
        normalizarNombre(q.nombre) === normalizarNombre(p.nombre) &&
        haversine(q.lat, q.lon, p.lat, p.lon) < 150,
    );
    if (duplicado) continue;
    vistosId.add(p.id);
    vistosNombre.push(p);
    salida.push(p);
    if (salida.length >= MAX_POIS) break;
  }

  cache.set(k, salida);
  return salida;
}

/** Vacía la caché de POIs (útil en tests). */
export function limpiarCachePois(): void {
  cache.clear();
}
