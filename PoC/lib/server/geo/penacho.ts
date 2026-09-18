// Penacho de humo: cono de dispersión aguas abajo del viento y nodos alcanzados.
//
// Modelo deliberadamente simple (tipo "gaussian plume" reducido a su huella en planta),
// pensado para que el mando vea de un vistazo qué queda a sotavento. Todo son funciones
// puras: no hay red ni estado. Sin efectos al importar.

import { RADIO_TIERRA_M } from "./utm";

const RAD = Math.PI / 180;

/** Longitud base del penacho con viento en calma (m). */
export const LONGITUD_BASE_M = 500;
/** Metros de alcance añadidos por cada km/h de viento. */
export const METROS_POR_KMH = 90;
/** Tope de alcance del modelo (m): más allá la pluma se diluye y deja de ser operativa. */
export const LONGITUD_MAX_M = 4000;
/** Semiapertura del cono (grados a cada lado del eje). */
export const SEMIANGULO_GRADOS = 28;

export interface Punto {
  lat: number;
  lon: number;
}

export interface Viento {
  velocidadKmh: number;
  /** Convención meteorológica: grados DESDE donde sopla el viento (0 = del norte). */
  direccionGrados: number;
}

export interface NodoGeo {
  id: string;
  lat: number;
  lon: number;
}

export interface Penacho {
  longitudM: number;
  semianguloGrados: number;
  /** Hacia dónde VA el humo (= direccionGrados + 180), 0..360. */
  rumboGrados: number;
  /** Ids de los nodos dentro del cono. */
  afectados: string[];
}

/** Normaliza un ángulo a [0, 360). */
export function normalizarGrados(g: number): number {
  return ((g % 360) + 360) % 360;
}

/** Diferencia angular mínima entre dos rumbos, en [0, 180]. */
export function diferenciaAngular(a: number, b: number): number {
  const d = Math.abs(normalizarGrados(a) - normalizarGrados(b));
  return d > 180 ? 360 - d : d;
}

/**
 * Distancia ortodrómica (haversine) entre dos puntos WGS84, en metros.
 * A escala urbana el error frente a Vincenty es de centímetros.
 */
export function distanciaM(a: Punto, b: Punto): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(h));
}

/**
 * Rumbo inicial (azimut) de `a` hacia `b`, en grados 0..360 (0 = norte, 90 = este).
 */
export function rumboEntre(a: Punto, b: Punto): number {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const Δλ = (b.lon - a.lon) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizarGrados((Math.atan2(y, x) * 180) / Math.PI);
}

/** Longitud del penacho para una velocidad dada: 500 m + 90 m por km/h, con tope de 4 km. */
export function longitudPenachoM(velocidadKmh: number): number {
  const v = Number.isFinite(velocidadKmh) ? Math.max(0, velocidadKmh) : 0;
  return Math.min(LONGITUD_MAX_M, LONGITUD_BASE_M + METROS_POR_KMH * v);
}

/**
 * Calcula la huella del penacho y qué nodos caen dentro.
 *
 * Un nodo está afectado si:
 *   1. su distancia al foco ≤ longitudM, y
 *   2. |rumbo(centro → nodo) − rumboGrados| ≤ semianguloGrados.
 *
 * El propio foco (distancia ~0) se considera afectado: el rumbo es indefinido pero
 * está obviamente dentro de la nube.
 */
export function penacho(viento: Viento, centro: Punto, nodos: NodoGeo[]): Penacho {
  const longitudM = longitudPenachoM(viento?.velocidadKmh ?? 0);
  const rumbo = normalizarGrados((viento?.direccionGrados ?? 0) + 180);

  const afectados: string[] = [];
  for (const n of nodos ?? []) {
    if (!n || typeof n.lat !== "number" || typeof n.lon !== "number") continue;
    const d = distanciaM(centro, n);
    if (d > longitudM) continue;
    // A menos de 25 m del foco el rumbo no es significativo: se da por afectado.
    if (d <= 25 || diferenciaAngular(rumboEntre(centro, n), rumbo) <= SEMIANGULO_GRADOS) {
      afectados.push(n.id);
    }
  }

  return { longitudM, semianguloGrados: SEMIANGULO_GRADOS, rumboGrados: rumbo, afectados };
}

/**
 * Polígono aproximado del cono (lat/lon) para pintarlo en Leaflet: foco + arco de
 * `pasos` puntos sobre el borde exterior. Útil para la capa de mapa; no lo exige el
 * modelo, pero evita que la UI tenga que reimplementar la trigonometría.
 */
export function poligonoPenacho(p: Penacho, centro: Punto, pasos = 16): [number, number][] {
  const puntos: [number, number][] = [[centro.lat, centro.lon]];
  const desde = p.rumboGrados - p.semianguloGrados;
  const hasta = p.rumboGrados + p.semianguloGrados;
  for (let i = 0; i <= pasos; i++) {
    const rumbo = (desde + ((hasta - desde) * i) / pasos) * RAD;
    const δ = p.longitudM / RADIO_TIERRA_M;
    const φ1 = centro.lat * RAD;
    const λ1 = centro.lon * RAD;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(rumbo));
    const λ2 =
      λ1 +
      Math.atan2(
        Math.sin(rumbo) * Math.sin(δ) * Math.cos(φ1),
        Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
      );
    puntos.push([(φ2 * 180) / Math.PI, (λ2 * 180) / Math.PI]);
  }
  puntos.push([centro.lat, centro.lon]);
  return puntos;
}
