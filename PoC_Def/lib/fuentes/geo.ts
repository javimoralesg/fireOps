// =====================================================================
// Geometría esférica mínima (haversine, rumbos, destino). DUEÑO: B.
// Sin dependencias externas. Lo usan todas las fuentes y los agentes de
// percepción para distancias, rumbos y rejillas.
// =====================================================================
import type { Punto } from "../dominio/tipos";

const RADIO_TIERRA_KM = 6371.0088;
const aRad = (g: number) => (g * Math.PI) / 180;
const aGrados = (r: number) => (r * 180) / Math.PI;

/** Distancia en kilómetros entre dos puntos (fórmula del semiverseno). */
export function haversine(a: Punto, b: Punto): number {
  const dLat = aRad(b.lat - a.lat);
  const dLon = aRad(b.lon - a.lon);
  const la1 = aRad(a.lat);
  const la2 = aRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distancia en metros (azúcar sobre `haversine`). */
export const distanciaM = (a: Punto, b: Punto): number => haversine(a, b) * 1000;

/** Rumbo inicial de `a` hacia `b`, en grados 0..360 (0 = norte geográfico). */
export function rumbo(a: Punto, b: Punto): number {
  const la1 = aRad(a.lat);
  const la2 = aRad(b.lat);
  const dLon = aRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (aGrados(Math.atan2(y, x)) + 360) % 360;
}

const ROSA = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"] as const;

/** Grados → punto cardinal en español ("SO", "NNE"…). */
export function gradosATexto(grados: number): string {
  const g = ((grados % 360) + 360) % 360;
  return ROSA[Math.round(g / 22.5) % 16];
}

/** Punto a `distanciaKm` de `punto` siguiendo el rumbo `rumboGrados`. */
export function destino(punto: Punto, rumboGrados: number, distanciaKm: number): Punto {
  const d = distanciaKm / RADIO_TIERRA_KM;
  const br = aRad(rumboGrados);
  const la1 = aRad(punto.lat);
  const lo1 = aRad(punto.lon);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
  const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: +aGrados(la2).toFixed(6), lon: +(((aGrados(lo2) + 540) % 360) - 180).toFixed(6) };
}

/** Diferencia angular mínima entre dos rumbos (0..180). */
export function diferenciaAngular(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Interpolación circular de ángulos (para la dirección del viento entre horas). */
export function interpolarAngulo(a: number, b: number, t: number): number {
  const delta = (((b - a) % 360) + 540) % 360 - 180;
  return ((a + delta * t) % 360 + 360) % 360;
}

/** Caja envolvente [oeste, sur, este, norte] de un radio en km alrededor de un punto. */
export function bbox(centro: Punto, radioKm: number): [number, number, number, number] {
  const dLat = radioKm / 111.32;
  const dLon = radioKm / (111.32 * Math.cos(aRad(centro.lat)) || 1);
  return [centro.lon - dLon, centro.lat - dLat, centro.lon + dLon, centro.lat + dLat];
}

/** Clave de caché por punto redondeado (precisión en grados, 0.05 ≈ 5,5 km). */
export const claveRedondeada = (p: Punto, precision = 0.05): string =>
  `${(Math.round(p.lat / precision) * precision).toFixed(3)},${(Math.round(p.lon / precision) * precision).toFixed(3)}`;
