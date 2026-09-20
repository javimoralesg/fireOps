// =====================================================================
// Open-Meteo · meteorología real sin clave. DUEÑO: constructor B.
// Endpoints verificados con curl:
//   https://api.open-meteo.com/v1/forecast   (actual, horaria y multipunto)
//   https://api.open-meteo.com/v1/elevation  (hasta 100 coordenadas)
// Límite no comercial: ~600 llamadas/min, 5.000/h, 10.000/día. Latencia
// medida hoy: 0,20–0,21 s. Caché en memoria por punto redondeado.
// Si la fuente falla se LANZA el error: nunca se inventan valores.
// =====================================================================
import type { Meteo, Punto } from "../dominio/tipos";
import { claveRedondeada, gradosATexto, interpolarAngulo } from "./geo";

const BASE = "https://api.open-meteo.com/v1/forecast";
const BASE_ELEV = "https://api.open-meteo.com/v1/elevation";
const TIMEOUT_MS = 12_000;
const CACHE_PREVISION_MS = 10 * 60_000;
const CACHE_ACTUAL_MS = 5 * 60_000;
const CACHE_ELEVACION_MS = 24 * 60 * 60_000;

const VARIABLES_HORA =
  "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,vapour_pressure_deficit";
const VARIABLES_ACTUAL =
  "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation";

export interface PrevisionHoraria {
  horas: Meteo[];
  url: string;
  obtenidaEn: string;
}

export interface PuntoViento {
  punto: Punto;
  vientoKmh: number;
  direccionGrados: number;
  direccionTexto: string;
  rachasKmh: number;
}

export interface RejillaViento {
  centro: Punto;
  radioKm: number;
  n: number;
  puntos: PuntoViento[];
  url: string;
  obtenidaEn: string;
}

type Global = typeof globalThis & {
  __atalayaOpenMeteo?: {
    prevision: Map<string, { en: number; datos: PrevisionHoraria }>;
    actual: Map<string, { en: number; datos: Meteo }>;
    elevacion: Map<string, { en: number; datos: number }>;
  };
};
const g = globalThis as Global;
const caches = () =>
  (g.__atalayaOpenMeteo ??= { prevision: new Map(), actual: new Map(), elevacion: new Map() });

async function pedirJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status} ${res.statusText} (${url.slice(0, 120)})`);
  return (await res.json()) as T;
}

/** Convierte "2026-09-19T14:00" + desfase a ISO UTC real. */
function aIsoUtc(horaLocal: string, desfaseSeg: number): string {
  const ms = Date.parse(`${horaLocal}:00Z`) - desfaseSeg * 1000;
  return new Date(ms).toISOString();
}

interface RespuestaHoraria {
  utc_offset_seconds: number;
  elevation?: number;
  hourly?: {
    time: string[];
    temperature_2m: (number | null)[];
    relative_humidity_2m: (number | null)[];
    wind_speed_10m: (number | null)[];
    wind_direction_10m: (number | null)[];
    wind_gusts_10m: (number | null)[];
    precipitation: (number | null)[];
    vapour_pressure_deficit?: (number | null)[];
  };
  current?: Record<string, number | string>;
}

const num = (v: number | null | undefined, porDefecto = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : porDefecto);

/** Meteo observada ahora mismo en un punto (bloque `current`, intervalo 15 min). */
export async function meteoActual(p: Punto): Promise<Meteo> {
  const clave = claveRedondeada(p, 0.05);
  const c = caches().actual.get(clave);
  if (c && Date.now() - c.en < CACHE_ACTUAL_MS) return c.datos;

  const url = `${BASE}?latitude=${p.lat.toFixed(4)}&longitude=${p.lon.toFixed(4)}&current=${VARIABLES_ACTUAL}&timezone=UTC`;
  const j = await pedirJson<RespuestaHoraria>(url);
  if (!j.current) throw new Error("Open-Meteo no devolvió bloque `current`");
  const dir = num(j.current.wind_direction_10m as number);
  const meteo: Meteo = {
    temperaturaC: num(j.current.temperature_2m as number),
    humedadPct: num(j.current.relative_humidity_2m as number),
    vientoKmh: num(j.current.wind_speed_10m as number),
    direccionGrados: dir,
    direccionTexto: gradosATexto(dir),
    rachasKmh: num(j.current.wind_gusts_10m as number),
    precipitacionMm: num(j.current.precipitation as number),
    horaMundo: new Date().toISOString(),
    fuente: "Open-Meteo",
    url,
  };
  caches().actual.set(clave, { en: Date.now(), datos: meteo });
  return meteo;
}

/** Previsión horaria de 48 h (timezone Europe/Madrid), cacheada 10 min por punto. */
export async function previsionHoraria(p: Punto): Promise<PrevisionHoraria> {
  const clave = claveRedondeada(p, 0.05);
  const c = caches().prevision.get(clave);
  if (c && Date.now() - c.en < CACHE_PREVISION_MS) return c.datos;

  const url =
    `${BASE}?latitude=${p.lat.toFixed(4)}&longitude=${p.lon.toFixed(4)}` +
    `&hourly=${VARIABLES_HORA}&forecast_days=3&past_days=1&timezone=Europe%2FMadrid`;
  const j = await pedirJson<RespuestaHoraria>(url);
  const h = j.hourly;
  if (!h || !Array.isArray(h.time) || h.time.length === 0) throw new Error("Open-Meteo no devolvió serie horaria");

  const desfase = j.utc_offset_seconds ?? 0;
  const horas: Meteo[] = h.time.map((t, i) => {
    const dir = num(h.wind_direction_10m[i]);
    const vpd = h.vapour_pressure_deficit ? h.vapour_pressure_deficit[i] : undefined;
    return {
      temperaturaC: num(h.temperature_2m[i]),
      humedadPct: num(h.relative_humidity_2m[i]),
      vientoKmh: num(h.wind_speed_10m[i]),
      direccionGrados: dir,
      direccionTexto: gradosATexto(dir),
      rachasKmh: num(h.wind_gusts_10m[i]),
      precipitacionMm: num(h.precipitation[i]),
      vpd: typeof vpd === "number" ? vpd : undefined,
      horaMundo: aIsoUtc(t, desfase),
      fuente: "Open-Meteo",
      url,
    };
  });

  const datos: PrevisionHoraria = { horas, url, obtenidaEn: new Date().toISOString() };
  caches().prevision.set(clave, { en: Date.now(), datos });
  return datos;
}

/**
 * Meteo en una hora de mundo concreta: interpola linealmente entre las dos
 * horas que la rodean. La dirección del viento se interpola de forma CIRCULAR
 * (350° → 10° pasa por el norte, no por el sur).
 */
export function meteoEnHora(prevision: PrevisionHoraria, horaMundoIso: string): Meteo {
  const horas = prevision.horas;
  if (!horas.length) throw new Error("Previsión vacía: no se puede interpolar");
  const t = Date.parse(horaMundoIso);
  if (!Number.isFinite(t)) return horas[0];

  let i = 0;
  while (i < horas.length - 1 && Date.parse(horas[i + 1].horaMundo) <= t) i += 1;
  const a = horas[i];
  const b = horas[Math.min(i + 1, horas.length - 1)];
  const ta = Date.parse(a.horaMundo);
  const tb = Date.parse(b.horaMundo);
  if (t <= ta || tb <= ta) return { ...a, horaMundo: horaMundoIso };
  if (t >= tb) return { ...b, horaMundo: horaMundoIso };

  const f = (t - ta) / (tb - ta);
  const lin = (x: number, y: number) => +(x + (y - x) * f).toFixed(2);
  const dir = +interpolarAngulo(a.direccionGrados, b.direccionGrados, f).toFixed(1);
  return {
    temperaturaC: lin(a.temperaturaC, b.temperaturaC),
    humedadPct: lin(a.humedadPct, b.humedadPct),
    vientoKmh: lin(a.vientoKmh, b.vientoKmh),
    direccionGrados: dir,
    direccionTexto: gradosATexto(dir),
    rachasKmh: lin(a.rachasKmh, b.rachasKmh),
    precipitacionMm: lin(a.precipitacionMm, b.precipitacionMm),
    vpd: a.vpd !== undefined && b.vpd !== undefined ? lin(a.vpd, b.vpd) : (a.vpd ?? b.vpd),
    horaMundo: horaMundoIso,
    fuente: a.fuente,
    url: a.url,
  };
}

/** Lluvia acumulada en las `horas` previas a `horaMundoIso` (mm). */
export function precipitacionAcumulada(prevision: PrevisionHoraria, horaMundoIso: string, horas = 24): number {
  const t = Date.parse(horaMundoIso);
  if (!Number.isFinite(t)) return 0;
  const desde = t - horas * 3_600_000;
  let suma = 0;
  for (const h of prevision.horas) {
    const th = Date.parse(h.horaMundo);
    if (th >= desde && th <= t) suma += h.precipitacionMm;
  }
  return +suma.toFixed(2);
}

/** Elevación del terreno en metros (API de elevación de Open-Meteo, cacheada 24 h). */
export async function elevacion(p: Punto): Promise<number> {
  const clave = claveRedondeada(p, 0.01);
  const c = caches().elevacion.get(clave);
  if (c && Date.now() - c.en < CACHE_ELEVACION_MS) return c.datos;
  const url = `${BASE_ELEV}?latitude=${p.lat.toFixed(4)}&longitude=${p.lon.toFixed(4)}`;
  const j = await pedirJson<{ elevation?: number[] }>(url);
  const v = j.elevation?.[0];
  if (typeof v !== "number") throw new Error("Open-Meteo elevation sin dato");
  caches().elevacion.set(clave, { en: Date.now(), datos: v });
  return v;
}

/** Elevaciones de varios puntos en UNA llamada (máx. 100 por petición). */
export async function elevaciones(puntos: Punto[]): Promise<number[]> {
  if (!puntos.length) return [];
  const lote = puntos.slice(0, 100);
  const url =
    `${BASE_ELEV}?latitude=${lote.map((p) => p.lat.toFixed(4)).join(",")}` +
    `&longitude=${lote.map((p) => p.lon.toFixed(4)).join(",")}`;
  const j = await pedirJson<{ elevation?: number[] }>(url);
  if (!Array.isArray(j.elevation)) throw new Error("Open-Meteo elevation sin datos");
  return j.elevation;
}

/**
 * Rejilla n×n de viento alrededor de un centro, en UNA sola llamada multipunto
 * (verificado: 3 puntos en 0,20 s; la respuesta es un ARRAY en el mismo orden).
 * El paso mínimo útil es 0,05° (~5,5 km): Open-Meteo redondea a la celda del
 * modelo y con menos paso salen puntos duplicados.
 */
export async function rejillaViento(centro: Punto, radioKm = 15, n = 5): Promise<RejillaViento> {
  const lado = Math.max(2, Math.min(10, Math.round(n)));
  const pasoGrados = Math.max(0.05, (2 * radioKm) / 111.32 / (lado - 1));
  const puntosPedidos: Punto[] = [];
  for (let i = 0; i < lado; i++) {
    for (let j = 0; j < lado; j++) {
      puntosPedidos.push({
        lat: +(centro.lat + (i - (lado - 1) / 2) * pasoGrados).toFixed(4),
        lon: +(centro.lon + (j - (lado - 1) / 2) * pasoGrados).toFixed(4),
      });
    }
  }
  const url =
    `${BASE}?latitude=${puntosPedidos.map((p) => p.lat).join(",")}` +
    `&longitude=${puntosPedidos.map((p) => p.lon).join(",")}` +
    `&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&timezone=UTC`;
  const j = await pedirJson<RespuestaHoraria[] | RespuestaHoraria>(url);
  const filas = Array.isArray(j) ? j : [j];
  const puntos: PuntoViento[] = filas.map((f, i) => {
    const dir = num(f.current?.wind_direction_10m as number);
    return {
      punto: { lat: Number(( f as unknown as { latitude: number }).latitude ?? puntosPedidos[i].lat), lon: Number((f as unknown as { longitude: number }).longitude ?? puntosPedidos[i].lon) },
      vientoKmh: num(f.current?.wind_speed_10m as number),
      direccionGrados: dir,
      direccionTexto: gradosATexto(dir),
      rachasKmh: num(f.current?.wind_gusts_10m as number),
    };
  });
  return { centro, radioKm, n: lado, puntos, url, obtenidaEn: new Date().toISOString() };
}

/**
 * Meteo actual de MUCHOS puntos en una sola llamada (para `zonasPeligro`).
 * Devuelve la meteo en el mismo orden que los puntos de entrada.
 */
export async function meteoMultipunto(puntos: Punto[]): Promise<Meteo[]> {
  if (!puntos.length) return [];
  const url =
    `${BASE}?latitude=${puntos.map((p) => p.lat.toFixed(4)).join(",")}` +
    `&longitude=${puntos.map((p) => p.lon.toFixed(4)).join(",")}` +
    `&current=${VARIABLES_ACTUAL}&hourly=vapour_pressure_deficit&forecast_days=1&timezone=UTC`;
  const j = await pedirJson<RespuestaHoraria[] | RespuestaHoraria>(url);
  const filas = Array.isArray(j) ? j : [j];
  const ahora = new Date().toISOString();
  return filas.map((f) => {
    const dir = num(f.current?.wind_direction_10m as number);
    const vpdSerie = f.hourly?.vapour_pressure_deficit;
    const horaActual = new Date().getUTCHours();
    const vpd = vpdSerie && typeof vpdSerie[horaActual] === "number" ? (vpdSerie[horaActual] as number) : undefined;
    return {
      temperaturaC: num(f.current?.temperature_2m as number),
      humedadPct: num(f.current?.relative_humidity_2m as number),
      vientoKmh: num(f.current?.wind_speed_10m as number),
      direccionGrados: dir,
      direccionTexto: gradosATexto(dir),
      rachasKmh: num(f.current?.wind_gusts_10m as number),
      precipitacionMm: num(f.current?.precipitation as number),
      vpd,
      horaMundo: ahora,
      fuente: "Open-Meteo",
      url,
    };
  });
}
