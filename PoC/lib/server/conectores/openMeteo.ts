// Meteorología y calidad del aire en tiempo real (Open-Meteo, sin clave).

import type { Evidencia } from "../../tipos-sistema";
import { gradosATexto } from "./geo";

export interface Meteo {
  temperatura: number;
  vientoKmh: number;
  direccionGrados: number;
  direccionTexto: string;
  humedad: number;
  timestamp: string;
  url: string;
}

export interface CalidadAire {
  pm25: number;
  pm10: number;
  co: number;
  timestamp: string;
  url: string;
}

export async function meteoActual(lat: number, lon: number): Promise<Meteo> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,relative_humidity_2m&timezone=Europe%2FMadrid&timeformat=unixtime`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const j = await res.json();
  const c = j.current;
  return {
    temperatura: c.temperature_2m,
    vientoKmh: c.wind_speed_10m,
    direccionGrados: c.wind_direction_10m,
    direccionTexto: gradosATexto(c.wind_direction_10m),
    humedad: c.relative_humidity_2m,
    timestamp: new Date(c.time * 1000).toISOString(),
    url,
  };
}

export async function aireActual(lat: number, lon: number): Promise<CalidadAire> {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm10,pm2_5,carbon_monoxide&timezone=Europe%2FMadrid&timeformat=unixtime`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) throw new Error(`open-meteo air ${res.status}`);
  const j = await res.json();
  const c = j.current;
  return { pm25: c.pm2_5, pm10: c.pm10, co: c.carbon_monoxide, timestamp: new Date(c.time * 1000).toISOString(), url };
}

export function evidenciaViento(m: Meteo): Evidencia {
  return {
    id: "ev-viento",
    fuente: "OpenMeteo",
    descripcion: `Viento ${m.vientoKmh} km/h del ${m.direccionTexto} (${m.direccionGrados}°), humedad ${m.humedad} %, ${m.temperatura} °C`,
    valor: m.vientoKmh,
    unidad: "km/h",
    timestamp: m.timestamp,
    url: m.url,
    confianza: 0.9,
  };
}

export function evidenciaAire(a: CalidadAire): Evidencia {
  return {
    id: "ev-aire",
    fuente: "OpenMeteoAire",
    descripcion: `Calidad del aire: PM2.5 ${a.pm25} µg/m³, PM10 ${a.pm10} µg/m³, CO ${a.co} µg/m³`,
    valor: a.pm25,
    unidad: "µg/m³ PM2.5",
    timestamp: a.timestamp,
    url: a.url,
    confianza: 0.85,
  };
}
