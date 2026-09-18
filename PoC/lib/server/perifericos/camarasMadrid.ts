// Cámaras de tráfico del Ayuntamiento de Madrid (poc-07).
// Fuente abierta y sin clave: https://informo.madrid.es/informo/tmadrid/CCTV.kml
// (357 Placemark con Numero, Nombre y coordenadas) y el JPEG en vivo de cada una
// en https://informo.madrid.es/cameras/Camara<Numero>.jpg. El KML se cachea 1 h.

import type { AnalisisVision, CamaraTrafico, Periferico } from "../../tipos-perifericos";
import { distanciaM } from "../../../components/mapa/geo";
import { listarPerifericos, registrarPeriferico } from "./registro";

const URL_KML = "https://informo.madrid.es/informo/tmadrid/CCTV.kml";
const CACHE_MS = 60 * 60_000;
const TIMEOUT_MS = 15_000;

export interface CamaraCruda {
  id: string;
  nombre: string;
  lat: number;
  lon: number;
}

type AnalisisCamara = AnalisisVision & { timestamp: string; eventoId?: string };
type Global = typeof globalThis & { __camarasMadrid?: { camaras: CamaraCruda[]; cargadoEn: number }; __camarasAnalisis?: Map<string, AnalisisCamara> };
const g = globalThis as Global;
const analisisPorCamara = (): Map<string, AnalisisCamara> => (g.__camarasAnalisis ??= new Map());

export const urlImagenCamara = (id: string): string => `https://informo.madrid.es/cameras/Camara${id}.jpg`;

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

/** Parser mínimo del KML (sin dependencias): un Placemark por cámara. */
export function parsearKml(kml: string): CamaraCruda[] {
  const camaras: CamaraCruda[] = [];
  for (const trozo of kml.split("<Placemark>").slice(1)) {
    const bloque = trozo.split("</Placemark>")[0];
    const id = valorDe(bloque, "Numero");
    const nombre = valorDe(bloque, "Nombre");
    const coords = entre(bloque, "<coordinates>", "</coordinates>")?.trim();
    if (!id || !coords) continue;
    const [lon, lat] = coords.split(",").map((x) => Number(x.trim()));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    camaras.push({ id, nombre: nombre || `Cámara ${id}`, lat, lon });
  }
  return camaras;
}

/** Catálogo de cámaras (cacheado 1 h; si el KML falla se sirve la caché anterior). */
export async function listarCamaras(): Promise<CamaraCruda[]> {
  const cache = g.__camarasMadrid;
  if (cache && Date.now() - cache.cargadoEn < CACHE_MS) return cache.camaras;
  try {
    const res = await fetch(URL_KML, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) throw new Error(`CCTV.kml ${res.status}`);
    const camaras = parsearKml(await res.text());
    if (!camaras.length) throw new Error("CCTV.kml sin cámaras");
    g.__camarasMadrid = { camaras, cargadoEn: Date.now() };
    return camaras;
  } catch (err) {
    console.warn("[camaras/kml]", err instanceof Error ? err.message : err);
    return cache?.camaras ?? [];
  }
}

/** Las `n` cámaras más cercanas a un punto, con su distancia y último análisis. */
export async function camarasCercanas(lat: number, lon: number, n = 8): Promise<CamaraTrafico[]> {
  const camaras = await listarCamaras();
  return camaras
    .map((c) => ({ ...c, distanciaM: Math.round(distanciaM([lat, lon], [c.lat, c.lon])) }))
    .sort((a, b) => a.distanciaM - b.distanciaM)
    .slice(0, Math.max(1, Math.min(40, n)))
    .map((c) => ({ id: c.id, nombre: c.nombre, lat: c.lat, lon: c.lon, imagenUrl: urlImagenCamara(c.id), distanciaM: c.distanciaM, ultimoAnalisis: analisisPorCamara().get(c.id) }));
}

export async function camaraPorId(id: string): Promise<CamaraCruda | undefined> {
  return (await listarCamaras()).find((c) => c.id === id);
}

/** Guarda en memoria el resultado del último análisis para pintarlo en la lista. */
export function anotarAnalisisCamara(id: string, analisis: AnalisisVision, eventoId?: string): void {
  analisisPorCamara().set(id, { ...analisis, timestamp: new Date().toISOString(), eventoId });
}

/**
 * Periférico virtual de una cámara municipal: se registra la primera vez que se
 * analiza y se reutiliza después (así la consola la ve como un periférico más).
 */
export async function perifericoDeCamara(camara: CamaraCruda): Promise<Periferico> {
  const nombre = `Cámara ${camara.nombre} (${camara.id})`.slice(0, 60);
  const existente = (await listarPerifericos()).find((p) => p.tipo === "camara_trafico" && p.nombre === nombre);
  if (existente) return existente;
  return registrarPeriferico({
    nombre,
    tipo: "camara_trafico",
    capacidades: ["camara", "gps"],
    posicion: { lat: camara.lat, lon: camara.lon, timestamp: new Date().toISOString() },
  });
}
