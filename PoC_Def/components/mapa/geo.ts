// Geometría del mapa: destino por rumbo, límites, rejilla de viento e
// interpolación de posiciones entre snapshots. DUEÑO: constructor E. Sin dependencias.

import type { Punto, Trazado } from "@/lib/dominio/tipos";

export const RADIO_TIERRA_M = 6_371_000;

/** España peninsular + islas, para el encuadre inicial. */
export const LIMITES_ESPANA: [[number, number], [number, number]] = [
  [27.4, -18.4],
  [43.9, 4.6],
];

const rad = (g: number) => (g * Math.PI) / 180;
const grad = (r: number) => (r * 180) / Math.PI;

/** Punto a `metros` de `origen` siguiendo el `rumboGrados` (0 = norte, horario). */
export function destino(origen: Punto, rumboGrados: number, metros: number): [number, number] {
  const d = metros / RADIO_TIERRA_M;
  const b = rad(rumboGrados);
  const lat1 = rad(origen.lat);
  const lon1 = rad(origen.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [grad(lat2), ((grad(lon2) + 540) % 360) - 180];
}

/** Distancia en metros entre dos puntos (haversine). */
export function distanciaM(a: Punto, b: Punto): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Límites [[sur, oeste], [norte, este]] que contienen todos los puntos dados. */
export function limitesDe(puntos: [number, number][], margenGrados = 0.08): [[number, number], [number, number]] | null {
  const validos = puntos.filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo));
  if (validos.length === 0) return null;
  let sur = 90,
    norte = -90,
    oeste = 180,
    este = -180;
  for (const [la, lo] of validos) {
    sur = Math.min(sur, la);
    norte = Math.max(norte, la);
    oeste = Math.min(oeste, lo);
    este = Math.max(este, lo);
  }
  return [
    [sur - margenGrados, oeste - margenGrados],
    [norte + margenGrados, este + margenGrados],
  ];
}

/** Círculo aproximado como polígono, por si un foco aún no tiene perímetro. */
export function circulo(centro: Punto, radioM: number, lados = 28): Trazado {
  const puntos: Trazado = [];
  for (let i = 0; i < lados; i += 1) puntos.push(destino(centro, (360 / lados) * i, radioM));
  return puntos;
}

export interface FlechaViento {
  /** Base de la flecha. */
  desde: [number, number];
  /** Punta de la flecha. */
  hasta: [number, number];
  /** Dos segmentos cortos que forman la punta. */
  punta: [number, number][];
  /** Rumbo HACIA el que sopla (grados). */
  rumboGrados: number;
  velocidadKmh: number;
}

/**
 * Rejilla de flechas de viento alrededor de un punto, calculada aquí mismo a
 * partir de la meteo del foco (la dirección de `Meteo` es DESDE dónde sopla,
 * así que la flecha apunta a dirección + 180°).
 */
export function rejillaViento(
  centro: Punto,
  direccionDesdeGrados: number,
  velocidadKmh: number,
  { lado = 5, separacionM = 5000 }: { lado?: number; separacionM?: number } = {},
): FlechaViento[] {
  const hacia = (direccionDesdeGrados + 180) % 360;
  // Longitud de la flecha proporcional a la velocidad (1 km por cada 4 km/h, con topes).
  const largoM = Math.max(900, Math.min(separacionM * 0.75, velocidadKmh * 220));
  const flechas: FlechaViento[] = [];
  const mitad = (lado - 1) / 2;
  for (let fila = 0; fila < lado; fila += 1) {
    for (let col = 0; col < lado; col += 1) {
      const dNorte = (mitad - fila) * separacionM;
      const dEste = (col - mitad) * separacionM;
      const paso1 = destino(centro, dNorte >= 0 ? 0 : 180, Math.abs(dNorte));
      const nodo = destino({ lat: paso1[0], lon: paso1[1] }, dEste >= 0 ? 90 : 270, Math.abs(dEste));
      const base = { lat: nodo[0], lon: nodo[1] };
      const desde = destino(base, (hacia + 180) % 360, largoM / 2);
      const hasta = destino(base, hacia, largoM / 2);
      const puntaIzq = destino({ lat: hasta[0], lon: hasta[1] }, (hacia + 150) % 360, largoM * 0.3);
      const puntaDer = destino({ lat: hasta[0], lon: hasta[1] }, (hacia + 210) % 360, largoM * 0.3);
      flechas.push({ desde, hasta, punta: [puntaIzq, hasta, puntaDer], rumboGrados: hacia, velocidadKmh });
    }
  }
  return flechas;
}

/** Una sola flecha (para las zonas de peligro que trae el snapshot). */
export function flechaViento(centro: Punto, direccionDesdeGrados: number, velocidadKmh: number, largoM = 2500): FlechaViento {
  const hacia = (direccionDesdeGrados + 180) % 360;
  const desde = destino(centro, (hacia + 180) % 360, largoM / 2);
  const hasta = destino(centro, hacia, largoM / 2);
  const puntaIzq = destino({ lat: hasta[0], lon: hasta[1] }, (hacia + 150) % 360, largoM * 0.3);
  const puntaDer = destino({ lat: hasta[0], lon: hasta[1] }, (hacia + 210) % 360, largoM * 0.3);
  return { desde, hasta, punta: [puntaIzq, hasta, puntaDer], rumboGrados: hacia, velocidadKmh };
}

/** Rumbo inicial en grados (0 = norte, horario) de `a` hacia `b`. */
export function rumboEntre(a: [number, number], b: [number, number]): number {
  const lat1 = rad(a[0]);
  const lat2 = rad(b[0]);
  const dLon = rad(b[1] - a[1]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (grad(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Parte la polilínea de una ruta por su progreso (0..1 de la DISTANCIA, que es
 * lo que calcula `avanzarPorRuta` en el servidor). Devuelve el tramo ya
 * recorrido, el que queda y el rumbo en el punto de corte, para pintar el
 * recorrido más grueso y la flecha de sentido.
 */
export function partirRuta(
  coords: Trazado,
  progreso: number,
): { recorrido: Trazado; restante: Trazado; corte: [number, number] | null; rumboGrados: number | null } {
  if (!coords || coords.length < 2) return { recorrido: [], restante: coords ?? [], corte: null, rumboGrados: null };
  const k = Math.max(0, Math.min(1, progreso || 0));

  const tramos: number[] = [];
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const d = distanciaM({ lat: coords[i - 1][0], lon: coords[i - 1][1] }, { lat: coords[i][0], lon: coords[i][1] });
    tramos.push(d);
    total += d;
  }
  if (total <= 0) return { recorrido: [], restante: coords, corte: null, rumboGrados: null };

  const objetivo = k * total;
  let acumulado = 0;
  for (let i = 0; i < tramos.length; i += 1) {
    if (acumulado + tramos[i] >= objetivo) {
      const t = tramos[i] > 0 ? (objetivo - acumulado) / tramos[i] : 0;
      const corte = interpolar(coords[i], coords[i + 1], t);
      return {
        recorrido: [...coords.slice(0, i + 1), corte],
        restante: [corte, ...coords.slice(i + 1)],
        corte,
        rumboGrados: rumboEntre(coords[i], coords[i + 1]),
      };
    }
    acumulado += tramos[i];
  }
  const ultimo = coords[coords.length - 1];
  return { recorrido: coords, restante: [ultimo], corte: ultimo, rumboGrados: rumboEntre(coords[coords.length - 2], ultimo) };
}

/** Interpolación lineal entre dos posiciones (animación suave de las unidades). */
export function interpolar(a: [number, number], b: [number, number], t: number): [number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/** Convierte un `Punto` del dominio a la pareja que espera Leaflet. */
export const aLatLng = (p: Punto): [number, number] => [p.lat, p.lon];
