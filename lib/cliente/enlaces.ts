// Construcción y saneado de enlaces a las fuentes. DUEÑO: constructor N.
// Sin dependencias externas.
//
// Regla del mando: si hay fuente, se puede abrir; si no hay URL o la URL no es
// utilizable, NO se pinta enlace (nunca uno roto). Todo lo que sale de aquí es
// `undefined` o una URL que se puede abrir tal cual.

/** Esquemas que se dejan abrir desde la interfaz. */
const ESQUEMAS = ["http:", "https:"];

/**
 * Devuelve la URL si es abrible (absoluta http/https, o interna que empieza por
 * "/"). Descarta vacíos, `javascript:`, `data:` y cualquier cosa que no parsee.
 */
export function urlSegura(url?: string | null): string | undefined {
  const texto = (url ?? "").trim();
  if (!texto) return undefined;
  if (texto.startsWith("/") && !texto.startsWith("//")) return texto;
  try {
    const u = new URL(texto);
    return ESQUEMAS.includes(u.protocol) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Id de OpenStreetMap → ficha pública del elemento.
 * `osm:node/349239286` → https://www.openstreetmap.org/node/349239286
 * `osm:way/959754910:AMB` (unidad derivada de un parque) → .../way/959754910
 * También admite `node/123` y `relation/123` sin prefijo.
 */
export function urlOsm(id?: string | null): string | undefined {
  const texto = (id ?? "").trim();
  if (!texto) return undefined;
  const sinPrefijo = texto.startsWith("osm:") ? texto.slice(4) : texto;
  // El sufijo ":ALGO" lo añade Atalaya para distinguir varias unidades de una
  // misma base: no forma parte del identificador de OSM.
  const coincide = /^(node|way|relation)\/(\d+)/.exec(sinPrefijo);
  if (!coincide) return undefined;
  return `https://www.openstreetmap.org/${coincide[1]}/${coincide[2]}`;
}

/** Coordenadas → OpenStreetMap centrado ahí (para lo que no tiene id de OSM). */
export function urlOsmPunto(lat: number, lon: number, zoom = 15): string | undefined {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lon.toFixed(5)}#map=${zoom}/${lat.toFixed(5)}/${lon.toFixed(5)}`;
}

/**
 * Fundamento legal → /conocimiento con el documento y el fragmento citado.
 * Los `chunkId` son `doc_<documento>#<n>`: el documento sale de ahí. Si la
 * página de conocimiento (constructor C) todavía no lee los parámetros, el
 * enlace sigue llevando a la biblioteca: nunca queda roto.
 */
export function urlConocimiento(chunkId?: string | null, documento?: string | null): string {
  const trozo = (chunkId ?? "").trim();
  const parametros = new URLSearchParams();
  const documentoId = trozo.includes("#") ? trozo.split("#")[0] : "";
  if (documentoId) parametros.set("documento", documentoId);
  if (trozo) parametros.set("chunk", trozo);
  else if (documento) parametros.set("consulta", documento);
  const cadena = parametros.toString();
  return `/conocimiento${cadena ? `?${cadena}` : ""}${trozo ? `#${encodeURIComponent(trozo)}` : ""}`;
}

/** Nombre corto del dominio de una URL, para explicar a dónde lleva el enlace. */
export function dominio(url?: string | null): string | undefined {
  const segura = urlSegura(url);
  if (!segura || segura.startsWith("/")) return undefined;
  try {
    return new URL(segura).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
