// =====================================================================
// Cámaras de tráfico de la DGT (etraffic). DUEÑO: constructor B.
// ---------------------------------------------------------------------
// Hallazgo verificado hoy (§1.1): el DATEX2 de cámaras NO existe (404).
// El API real del visor eTraffic es:
//   POST https://etraffic.dgt.es/etrafficWEB/api/cache/getCamaras
//   · sin clave, PERO exige Content-Type: application/json y CUERPO
//     (sin cuerpo el edge de Akamai responde 411 Length Required)
//   · la respuesta es texto = base64 + XOR 0x66 ('f') → JSON
//   · 1.948 cámaras en toda España, campos:
//     { idCamara, carretera, pk, sentido, coordX = LONGITUD, coordY = LATITUD }
//   · imagen: https://etraffic.dgt.es/camarasEtraffic/<idCamara>.jpg
//     (JPEG 853x480, Cache-Control max-age=120, refresco real 2–6 min)
//   · CORS del listado restringido a etraffic.dgt.es → SIEMPRE por el backend.
//
// `listarCamaras()` fusiona DGT + Ayuntamiento de Madrid para que el Vigía
// pueda vigilar cualquiera. Los ids llevan prefijo de fuente ("dgt:176130",
// "mad:06304") para que no choquen.
// =====================================================================
import type { Camara, Punto } from "../dominio/tipos";
import { haversine } from "./geo";
import { listarCamarasMadrid, imagenCamaraMadrid } from "./camarasMadrid";
import { imagenCamaraMovil } from "./camarasMovil";

const URL_LISTADO = "https://etraffic.dgt.es/etrafficWEB/api/cache/getCamaras";
const URL_IMAGEN_BASE = "https://etraffic.dgt.es/camarasEtraffic/";
const TIMEOUT_MS = 20_000;
const CACHE_LISTADO_MS = 60 * 60_000; // 1 h
const CACHE_IMAGEN_MS = 5_000; // nunca más de 5 s

export const intervaloCamaras = (): number => Math.max(5, Number(process.env.CAMARAS_INTERVALO_SEG ?? 20));

interface ImagenDescargada { bytes: Uint8Array; mime: string; url: string }
interface CacheCamaras {
  dgt?: { en: number; datos: Camara[] };
  todas?: { en: number; datos: Camara[] };
  imagenes: Map<string, { en: number; datos: ImagenDescargada }>;
}
type Global = typeof globalThis & { __atalayaCamaras?: CacheCamaras };
const g = globalThis as Global;
const est = (): CacheCamaras => (g.__atalayaCamaras ??= { imagenes: new Map() });

/** Decodificación del payload del visor: base64 + XOR 0x66 (el `Ps()` del bundle). */
export function decodificarDgt(b64: string): string {
  const k = "f".charCodeAt(0);
  const bin = Buffer.from(b64, "base64");
  const salida = Buffer.allocUnsafe(bin.length);
  for (let i = 0; i < bin.length; i++) salida[i] = bin[i] ^ k;
  return salida.toString("utf-8");
}

interface CamaraDgt {
  idCamara: string;
  carretera?: string;
  pk?: number;
  sentido?: string;
  coordX?: number; // longitud
  coordY?: number; // latitud
}

export const urlImagenDgt = (idCamara: string): string => `${URL_IMAGEN_BASE}${idCamara}.jpg`;

function nombreDgt(c: CamaraDgt): string {
  const pk = typeof c.pk === "number" ? ` PK ${c.pk.toFixed(1).replace(".", ",")}` : "";
  const sentido = c.sentido === "+" ? " (creciente)" : c.sentido === "-" ? " (decreciente)" : "";
  return `${c.carretera ?? "Carretera"}${pk}${sentido}`;
}

/** Catálogo de cámaras de la DGT (1 h de caché; si falla se sirve la caché previa). */
export async function listarCamarasDgt(): Promise<Camara[]> {
  const e = est();
  if (e.dgt && Date.now() - e.dgt.en < CACHE_LISTADO_MS) return e.dgt.datos;

  let camaras: Camara[];
  try {
    const res = await fetch(URL_LISTADO, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://etraffic.dgt.es",
        Referer: "https://etraffic.dgt.es/etrafficWEB/",
        Accept: "*/*",
      },
      body: "{}",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`getCamaras ${res.status} ${res.statusText}`);
    const texto = (await res.text()).trim();
    const json = JSON.parse(decodificarDgt(texto)) as { camaras?: CamaraDgt[]; urlBase?: string };
    const lista = json.camaras ?? [];
    if (!lista.length) throw new Error("getCamaras devolvió 0 cámaras");
    const intervaloSeg = intervaloCamaras();
    camaras = lista
      .filter((c) => Number.isFinite(c.coordY) && Number.isFinite(c.coordX) && c.idCamara)
      .map<Camara>((c) => ({
        id: `dgt:${c.idCamara}`,
        nombre: nombreDgt(c),
        punto: { lat: Number(c.coordY), lon: Number(c.coordX) },
        fuente: "DGT",
        urlImagen: `${json.urlBase ?? URL_IMAGEN_BASE}${c.idCamara}.jpg`,
        carretera: c.carretera,
        intervaloSeg,
        vigilada: false,
        historial: [],
      }));
  } catch (err) {
    if (e.dgt) {
      console.warn("[dgtCamaras] fallo, se sirve la caché anterior:", err instanceof Error ? err.message : err);
      return e.dgt.datos;
    }
    throw new Error(`Cámaras DGT no disponibles: ${err instanceof Error ? err.message : err}`);
  }
  e.dgt = { en: Date.now(), datos: camaras };
  return camaras;
}

/** DGT + Madrid en una sola lista. Si una fuente falla, se devuelve la otra. */
export async function listarTodasLasCamaras(): Promise<Camara[]> {
  const e = est();
  if (e.todas && Date.now() - e.todas.en < CACHE_LISTADO_MS) return e.todas.datos;

  const [dgt, madrid] = await Promise.allSettled([listarCamarasDgt(), listarCamarasMadrid()]);
  const lista: Camara[] = [];
  if (dgt.status === "fulfilled") lista.push(...dgt.value);
  else console.warn("[camaras] DGT no disponible:", dgt.reason instanceof Error ? dgt.reason.message : dgt.reason);
  if (madrid.status === "fulfilled") lista.push(...madrid.value);
  else console.warn("[camaras] Madrid no disponible:", madrid.reason instanceof Error ? madrid.reason.message : madrid.reason);

  if (!lista.length) {
    const motivo = dgt.status === "rejected" ? (dgt.reason instanceof Error ? dgt.reason.message : String(dgt.reason)) : "sin cámaras";
    throw new Error(`Ninguna red de cámaras disponible: ${motivo}`);
  }
  e.todas = { en: Date.now(), datos: lista };
  return lista;
}

/** Contrato compartido: la lista completa (DGT + Madrid). */
export async function listarCamaras(): Promise<Camara[]> {
  return listarTodasLasCamaras();
}

/** Cámara por id (con o sin prefijo de fuente). */
export async function camaraPorId(id: string): Promise<Camara | undefined> {
  const lista = await listarTodasLasCamaras();
  return lista.find((c) => c.id === id) ?? lista.find((c) => c.id.split(":")[1] === id);
}

/**
 * Descarga el JPEG en vivo de una cámara (DGT o Madrid).
 * Caché de 5 s como mucho: la gracia es que la imagen sea de ahora mismo.
 */
export async function imagenCamara(id: string): Promise<{ bytes: Uint8Array; mime: string; url: string }> {
  const e = est();
  const c = e.imagenes.get(id);
  if (c && Date.now() - c.en < CACHE_IMAGEN_MS) return c.datos;

  // Los fotogramas del móvil viven en memoria: se sirven sin caché adicional.
  if (id.startsWith("movil:")) return imagenCamaraMovil(id);

  if (id.startsWith("mad:")) {
    const datos = await imagenCamaraMadrid(id.slice(4));
    e.imagenes.set(id, { en: Date.now(), datos });
    return datos;
  }

  const idDgt = id.startsWith("dgt:") ? id.slice(4) : id;
  const url = `${urlImagenDgt(idDgt)}?t=${Date.now()}`;
  const res = await fetch(url, {
    headers: { Accept: "image/jpeg,image/*", "User-Agent": "atalaya-incendios/1.0" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Imagen de la cámara ${idDgt}: ${res.status} ${res.statusText}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 1000) throw new Error(`Imagen de la cámara ${idDgt} vacía o truncada (${bytes.byteLength} bytes)`);
  const datos = { bytes, mime: res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg", url };
  e.imagenes.set(id, { en: Date.now(), datos });
  return datos;
}

/** Cámaras a menos de `radioKm` de un punto, de la más cercana a la más lejana. */
export async function camarasCercanas(p: Punto, radioKm = 30): Promise<(Camara & { distanciaKm: number })[]> {
  const lista = await listarTodasLasCamaras();
  return lista
    .map((c) => ({ ...c, distanciaKm: +haversine(p, c.punto).toFixed(2) }))
    .filter((c) => c.distanciaKm <= radioKm)
    .sort((a, b) => a.distanciaKm - b.distanciaKm);
}
