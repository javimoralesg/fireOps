// Geocodificador sobre Nominatim (OpenStreetMap), respetando su política de uso:
// https://operations.osmfoundation.org/policies/nominatim/
//
//  · User-Agent identificable y con contacto.
//  · Máximo 1 petición por segundo (cola serializada en memoria de proceso).
//  · Caché de resultados para no repetir la misma consulta.
//  · Acotado a Madrid (viewbox + bounded=1) para no gastar peticiones fuera de escenario.
//
// Sin efectos al importar: la cola arranca como una promesa ya resuelta y no se
// dispara ninguna petición hasta que alguien llama a `geocodificar`.

export const URL_NOMINATIM = "https://nominatim.openstreetmap.org/search";

/** Identificación exigida por la política de uso de Nominatim. */
export const USER_AGENT = "crisis-mando-ai/0.1 (hackathon; contacto en repo)";

/** Caja de Madrid capital y área metropolitana cercana: lonIzq,latSup,lonDer,latInf. */
export const VIEWBOX_MADRID = "-3.9,40.58,-3.50,40.28";

/** Intervalo mínimo entre peticiones (ms). La política dice 1 req/s; dejamos margen. */
const INTERVALO_MIN_MS = 1100;

/** Tiempo máximo de espera de una petición (ms). */
const TIMEOUT_MS = 12000;

export interface ResultadoGeocodificacion {
  lat: number;
  lon: number;
  /** display_name de Nominatim (dirección completa legible). */
  nombre: string;
  /** "node/123" | "way/456" | "relation/789". */
  osmId: string;
  /** Ficha del elemento en openstreetmap.org, para citar la fuente en la UI. */
  url: string;
}

/**
 * Textos que NO son geocodificables en el contexto del escenario: o son demasiado
 * genéricos (toda la ciudad, toda la comunidad) o no son un lugar.
 */
const TEXTOS_NO_GEOCODIFICABLES = new Set([
  "",
  "madrid",
  "madrid, espana",
  "espana",
  "comunidad de madrid",
  "remoto",
  "en remoto",
  "teletrabajo",
  "desconocido",
  "desconocida",
  "sin ubicacion",
  "sin ubicación",
  "n/a",
  "na",
  "-",
  "varios",
  "multiple",
  "múltiple",
  "ciudad",
  "centro de mando",
]);

/**
 * Tipos de dirección demasiado gruesos para posicionar un nodo del grafo: si Nominatim
 * solo sabe devolvernos "el país" o "la ciudad", damos el texto por no geocodificable.
 */
const ADDRESSTYPES_DEMASIADO_GRUESOS = new Set([
  "country",
  "state",
  "region",
  "province",
  "county",
  "city",
  "municipality",
  "postcode",
  "continent",
]);

/** Normaliza para clave de caché y para la lista negra: minúsculas, sin tildes ni espacios sobrantes. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Caché en memoria de proceso: texto normalizado → resultado (o null si no geocodificable). */
const cache = new Map<string, ResultadoGeocodificacion | null>();

/** Cola serializada: cada petición se encadena a la anterior con al menos INTERVALO_MIN_MS de separación. */
let cola: Promise<unknown> = Promise.resolve();
let ultimaPeticionMs = 0;

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Encola `tarea` respetando el límite de 1 petición/segundo. Devuelve su resultado. */
function enCola<T>(tarea: () => Promise<T>): Promise<T> {
  const siguiente = cola.then(async () => {
    const espera = ultimaPeticionMs + INTERVALO_MIN_MS - Date.now();
    if (espera > 0) await esperar(espera);
    ultimaPeticionMs = Date.now();
    return tarea();
  });
  // La cola nunca debe romperse por un fallo de una tarea concreta.
  cola = siguiente.then(
    () => undefined,
    () => undefined,
  );
  return siguiente;
}

interface FilaNominatim {
  lat: string;
  lon: string;
  display_name?: string;
  name?: string;
  osm_type?: "node" | "way" | "relation";
  osm_id?: number;
  addresstype?: string;
}

/**
 * Geocodifica un texto libre dentro de Madrid.
 *
 * @returns el primer resultado utilizable, o `null` si el texto no es geocodificable
 *          (genérico tipo "Madrid" / "Remoto", sin resultados, o resultado demasiado grueso).
 */
export async function geocodificar(texto: string): Promise<ResultadoGeocodificacion | null> {
  const clave = normalizarTexto(texto ?? "");
  if (cache.has(clave)) return cache.get(clave) ?? null;
  if (TEXTOS_NO_GEOCODIFICABLES.has(clave) || clave.length < 4) {
    cache.set(clave, null);
    return null;
  }

  const url = new URL(URL_NOMINATIM);
  url.searchParams.set("q", texto);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "3");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("viewbox", VIEWBOX_MADRID);
  url.searchParams.set("bounded", "1");

  const filas = await enCola(async () => {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "es", Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    return (await res.json()) as FilaNominatim[];
  });

  const fila = (Array.isArray(filas) ? filas : []).find(
    (f) => f && !ADDRESSTYPES_DEMASIADO_GRUESOS.has(f.addresstype ?? ""),
  );
  if (!fila || !fila.osm_type || fila.osm_id == null) {
    cache.set(clave, null);
    return null;
  }

  const osmId = `${fila.osm_type}/${fila.osm_id}`;
  const resultado: ResultadoGeocodificacion = {
    lat: Number(fila.lat),
    lon: Number(fila.lon),
    nombre: fila.display_name ?? fila.name ?? texto,
    osmId,
    url: `https://www.openstreetmap.org/${osmId}`,
  };
  cache.set(clave, resultado);
  return resultado;
}

/** Vacía la caché (útil en tests). No toca la cola de rate-limit. */
export function limpiarCacheGeocodificacion(): void {
  cache.clear();
}

/** Nombre de calle/lugar para unas coordenadas (Nominatim /reverse, misma cola de 1 req/s y caché). */
const cacheInverso = new Map<string, string>();
export async function geocodificarInverso(lat: number, lon: number): Promise<string> {
  const clave = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const c = cacheInverso.get(clave);
  if (c) return c;
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=17&accept-language=es`;
  const res = await enCola(() => fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, signal: AbortSignal.timeout(10_000) }));
  if (!res.ok) throw new Error(`nominatim reverse ${res.status}`);
  const j = (await res.json()) as { display_name?: string; address?: Record<string, string>; name?: string };
  const a = j.address ?? {};
  const via = a.road ?? a.pedestrian ?? a.footway ?? j.name;
  const nombre = [via, a.house_number].filter(Boolean).join(" ") || j.display_name?.split(",").slice(0, 2).join(",") || clave;
  const texto = a.suburb || a.neighbourhood || a.city_district ? `${nombre}, ${a.suburb ?? a.neighbourhood ?? a.city_district}` : nombre;
  cacheInverso.set(clave, texto);
  return texto;
}
