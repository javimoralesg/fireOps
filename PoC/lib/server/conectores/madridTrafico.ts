// Tráfico en tiempo real del Ayuntamiento de Madrid (sin clave).
// https://informo.madrid.es/informo/tmadrid/pm.xml — ~4.000 puntos de medida.

import type { Evidencia } from "../../tipos-sistema";
import { distanciaMetros, gradosATexto, latLonToUtm30, madridLocalAIso, rumboGrados } from "./geo";
import { utm30ToLatLon } from "../geo/utm";

export const URL_TRAFICO = "https://informo.madrid.es/informo/tmadrid/pm.xml";

export interface SensorTrafico {
  id: string;
  descripcion: string;
  intensidad: number;
  ocupacion: number;
  carga: number; // 0..100
  nivelServicio: number; // 0 fluido … 3 congestión
  x: number;
  y: number;
  distanciaM: number;
  rumbo: string; // "NE" respecto al incidente
  lat: number; // WGS84 (convertido desde ETRS89 UTM 30N)
  lon: number;
  etiqueta: string; // descripción legible para el jurado
}

function num(s: string | undefined): number {
  return s ? Number(s.replace(",", ".")) : NaN;
}

function campo(bloque: string, tag: string): string | undefined {
  const m = bloque.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m?.[1]?.trim();
}

export async function sensoresCercanos(lat: number, lon: number, radioM = 1500, max = 12): Promise<{ sensores: SensorTrafico[]; fechaHora: string }> {
  const res = await fetch(URL_TRAFICO, { signal: AbortSignal.timeout(12000), cache: "no-store" });
  if (!res.ok) throw new Error(`informo.madrid.es ${res.status}`);
  const xml = await res.text();
  const bruto = xml.match(/<fecha_hora>([^<]*)<\/fecha_hora>/)?.[1];
  const fechaHora = bruto ? madridLocalAIso(bruto) : new Date().toISOString();
  const centro = latLonToUtm30(lat, lon);
  const sensores: SensorTrafico[] = [];
  for (const m of xml.matchAll(/<pm>([\s\S]*?)<\/pm>/g)) {
    const b = m[1];
    if (campo(b, "error") === "S") continue;
    const x = num(campo(b, "st_x"));
    const y = num(campo(b, "st_y"));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const d = distanciaMetros(centro, { x, y });
    if (d > radioM) continue;
    const descripcion = campo(b, "descripcion") ?? "";
    const rumbo = gradosATexto(rumboGrados(centro, { x, y }));
    const ll = utm30ToLatLon(x, y);
    sensores.push({
      lat: ll.lat,
      lon: ll.lon,
      id: campo(b, "idelem") ?? "?",
      descripcion,
      rumbo,
      etiqueta: etiquetaLegible(descripcion, Math.round(d), rumbo),
      intensidad: num(campo(b, "intensidad")) || 0,
      ocupacion: num(campo(b, "ocupacion")) || 0,
      carga: num(campo(b, "carga")) || 0,
      nivelServicio: num(campo(b, "nivelServicio")) || 0,
      x,
      y,
      distanciaM: Math.round(d),
    });
  }
  sensores.sort((a, b) => b.carga - a.carga);
  return { sensores: sensores.slice(0, max), fechaHora };
}

/** Los puntos "PM#####" son los sensores de Calle 30 (M-30); el XML no trae nombre de vía para ellos. */
export function etiquetaLegible(descripcion: string, distanciaM: number, rumbo: string): string {
  const esM30 = /^PM\d+/.test(descripcion);
  const base = esM30 ? `M-30 (Calle 30), punto ${descripcion}` : descripcion;
  return `${base} · ${distanciaM} m al ${rumbo} del incidente`;
}

export function evidenciaTrafico(s: SensorTrafico, ts: string): Evidencia {
  return {
    id: `ev-traf-${s.id}`,
    fuente: "MadridTrafico",
    descripcion: `${s.etiqueta}: carga ${s.carga} %, nivel de servicio ${s.nivelServicio}, ${s.intensidad} veh/h (sensor ${s.id})`,
    valor: s.carga,
    unidad: "% carga",
    timestamp: ts,
    url: URL_TRAFICO,
    confianza: 0.95,
    nodoId: /^PM\d+/.test(s.descripcion) ? "Infraestructuras/m30-sur" : "Infraestructuras/via-mendez-alvaro",
    lat: s.lat,
    lon: s.lon,
  };
}
