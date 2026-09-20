// =====================================================================
// Cámaras del Ayuntamiento de Madrid (informo.madrid.es). DUEÑO: B.
// Verificado (§1.2): KML sin clave con 357 cámaras
//   https://informo.madrid.es/informo/tmadrid/CCTV.kml   (UTF-8 con BOM)
//   imagen: https://informo.madrid.es/cameras/Camara<Numero>.jpg
//           (1280x720, ~114 KB, Cache-Control max-age=1)
// Utilidad forestal baja (urbano), pero cubre El Pardo y la Casa de Campo y
// demuestra que la plataforma federa varias redes. Parser KML sin dependencias.
// =====================================================================
import type { Camara } from "../dominio/tipos";

const URL_KML = "https://informo.madrid.es/informo/tmadrid/CCTV.kml";
const TIMEOUT_MS = 20_000;
const CACHE_MS = 60 * 60_000;

type Global = typeof globalThis & {
  __atalayaCamarasMadrid?: { en: number; datos: Camara[] };
  /** Descarga en curso: deduplicación de vuelos (constructor T, 2026-09-19). */
  __atalayaCamarasMadridVuelo?: Promise<Camara[]>;
};
const g = globalThis as Global;

export const urlImagenMadrid = (numero: string): string => `https://informo.madrid.es/cameras/Camara${numero}.jpg`;

function entre(texto: string, abre: string, cierra: string): string | undefined {
  const i = texto.indexOf(abre);
  if (i < 0) return undefined;
  const j = texto.indexOf(cierra, i + abre.length);
  return j < 0 ? undefined : texto.slice(i + abre.length, j);
}

function valorDe(bloque: string, nombre: string): string | undefined {
  const i = bloque.indexOf(`<Data name="${nombre}">`);
  if (i < 0) return undefined;
  return entre(bloque.slice(i), "<Value>", "</Value>")?.trim();
}

/** Parser mínimo del KML: un `Placemark` por cámara (coordenadas lon,lat,alt). */
export function parsearKml(kml: string): Camara[] {
  const intervaloSeg = Math.max(5, Number(process.env.CAMARAS_INTERVALO_SEG ?? 20));
  const camaras: Camara[] = [];
  for (const trozo of kml.split("<Placemark>").slice(1)) {
    const bloque = trozo.split("</Placemark>")[0];
    const numero = valorDe(bloque, "Numero");
    const nombre = valorDe(bloque, "Nombre");
    const coords = entre(bloque, "<coordinates>", "</coordinates>")?.trim();
    if (!numero || !coords) continue;
    const [lon, lat] = coords.split(",").map((x) => Number(x.trim()));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    camaras.push({
      id: `mad:${numero}`,
      nombre: nombre || `Cámara ${numero}`,
      punto: { lat, lon },
      fuente: "Madrid",
      urlImagen: urlImagenMadrid(numero),
      carretera: "Madrid ciudad",
      intervaloSeg,
      vigilada: false,
      historial: [],
    });
  }
  return camaras;
}

/**
 * Catálogo de cámaras de Madrid (1 h de caché). En arranque en frío varias
 * peticiones caen a la vez (salud, /api/camaras, enriquecimiento) y cada una
 * se bajaba el KML entero: ahora comparten la misma descarga.
 */
export function listarCamarasMadrid(): Promise<Camara[]> {
  const c = g.__atalayaCamarasMadrid;
  if (c && Date.now() - c.en < CACHE_MS) return Promise.resolve(c.datos);
  return (g.__atalayaCamarasMadridVuelo ??= descargarCamarasMadrid().finally(() => {
    g.__atalayaCamarasMadridVuelo = undefined;
  }));
}

async function descargarCamarasMadrid(): Promise<Camara[]> {
  const res = await fetch(URL_KML, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`CCTV.kml ${res.status} ${res.statusText}`);
  const camaras = parsearKml(await res.text());
  if (!camaras.length) throw new Error("CCTV.kml sin cámaras");
  g.__atalayaCamarasMadrid = { en: Date.now(), datos: camaras };
  return camaras;
}

/** Descarga el JPEG en vivo (recibe el número sin el prefijo "mad:"). */
export async function imagenCamaraMadrid(numero: string): Promise<{ bytes: Uint8Array; mime: string; url: string }> {
  const url = `${urlImagenMadrid(numero)}?v=${Date.now()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`Imagen de la cámara de Madrid ${numero}: ${res.status} ${res.statusText}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 1000) throw new Error(`Imagen de la cámara de Madrid ${numero} vacía (${bytes.byteLength} bytes)`);
  return { bytes, mime: res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg", url };
}
