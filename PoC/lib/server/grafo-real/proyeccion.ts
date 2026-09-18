// Proyección lat/lon → lienzo 0..100 del GrafoCiudad y utilidades de cercanía.
//
// El lienzo SVG de la consola mide 160×100 (poc-26): la x se estira por 1,6.
// Por eso x,y siguen yendo de 0 a 100, pero la caja geográfica se calcula con
// relación de aspecto 1,6:1 EN METROS (extensión este-oeste = 1,6 × extensión
// norte-sur); así, al estirar la x, la geometría no se deforma.
// x crece hacia el este, y crece hacia el SUR (norte arriba).
// Margen del 6 % en cada borde para que las etiquetas no se corten.

import { destino, distanciaM, formatearDistancia } from "@/components/mapa/geo";
import type { NodoGrafo } from "@/lib/types";

export interface Bbox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

const MARGEN = 6; // % del lienzo reservado en cada borde
/** Nodos más lejos de esto no cuentan para encuadrar (se recortan al borde). */
export const RADIO_ENCUADRE_M = 3000;
/** Ancho/alto del lienzo de la consola (160×100). */
export const RELACION_ASPECTO = 1.6;

/**
 * Caja centrada en `centro` con semialtura `radioM` (norte-sur) y semianchura
 * `radioM × 1,6` (este-oeste), en metros.
 */
export function bboxDe(centro: { lat: number; lon: number }, radioM: number, aspecto = RELACION_ASPECTO): Bbox {
  const [maxLat] = destino([centro.lat, centro.lon], 0, radioM);
  const [minLat] = destino([centro.lat, centro.lon], 180, radioM);
  const [, maxLon] = destino([centro.lat, centro.lon], 90, radioM * aspecto);
  const [, minLon] = destino([centro.lat, centro.lon], 270, radioM * aspecto);
  return { minLat, minLon, maxLat, maxLon };
}

/**
 * Semialtura (m) mínima para que una caja de aspecto 1,6:1 centrada en `centro`
 * contenga los nodos con coordenadas. Los que estén a más de `limiteM` se
 * ignoran para que un outlier lejano (el 112 de Pozuelo, a 11 km) no encoja
 * todo el grafo: esos se recortan al borde del lienzo.
 */
export function radioQueAbarca(
  centro: { lat: number; lon: number },
  nodos: NodoGrafo[],
  limiteM = RADIO_ENCUADRE_M,
  aspecto = RELACION_ASPECTO,
): number {
  let max = 0;
  for (const n of nodos) {
    if (typeof n.lat !== "number" || typeof n.lon !== "number") continue;
    if (distanciaM([centro.lat, centro.lon], [n.lat, n.lon]) > limiteM) continue;
    const dy = distanciaM([centro.lat, centro.lon], [n.lat, centro.lon]);
    const dx = distanciaM([centro.lat, centro.lon], [centro.lat, n.lon]);
    max = Math.max(max, dy, dx / aspecto);
  }
  return max;
}

// Los nodos que caen fuera de la caja (el 112 de Pozuelo, a 12 km) se pegan al
// borde en lugar de agrandar el lienzo y aplastar el resto del grafo.
/**
 * Caja ajustada a los nodos que caen dentro del encuadre (< `limiteM` del
 * centro), estirada hasta la relación 1,6:1 en metros para no deformar la
 * geometría. Así el grafo ocupa todo el lienzo en vez de apelotonarse.
 * `radioMinimoM` evita cajas degeneradas cuando hay muy pocos nodos.
 */
export function bboxQueAbarca(
  centro: { lat: number; lon: number },
  nodos: NodoGrafo[],
  radioMinimoM = 400,
  limiteM = RADIO_ENCUADRE_M,
  aspecto = RELACION_ASPECTO,
): Bbox {
  const dentro = nodos.filter(
    (n) => typeof n.lat === "number" && typeof n.lon === "number" && distanciaM([centro.lat, centro.lon], [n.lat, n.lon]) <= limiteM,
  );
  const lats = [centro.lat, ...dentro.map((n) => n.lat as number)];
  const lons = [centro.lon, ...dentro.map((n) => n.lon as number)];
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLon = Math.min(...lons);
  let maxLon = Math.max(...lons);

  const latMedia = (minLat + maxLat) / 2;
  const lonMedia = (minLon + maxLon) / 2;
  const metrosPorGradoLat = distanciaM([latMedia - 0.005, lonMedia], [latMedia + 0.005, lonMedia]) / 0.01;
  const metrosPorGradoLon = distanciaM([latMedia, lonMedia - 0.005], [latMedia, lonMedia + 0.005]) / 0.01;

  let alto = Math.max((maxLat - minLat) * metrosPorGradoLat, 2 * radioMinimoM);
  let ancho = Math.max((maxLon - minLon) * metrosPorGradoLon, 2 * radioMinimoM * aspecto);
  if (ancho < alto * aspecto) ancho = alto * aspecto;
  else alto = ancho / aspecto;

  const semiLat = alto / 2 / metrosPorGradoLat;
  const semiLon = ancho / 2 / metrosPorGradoLon;
  minLat = latMedia - semiLat;
  maxLat = latMedia + semiLat;
  minLon = lonMedia - semiLon;
  maxLon = lonMedia + semiLon;
  return { minLat, minLon, maxLat, maxLon };
}

const acotar = (v: number) => Math.max(2, Math.min(98, Math.round(v * 10) / 10));

/**
 * Rellena x,y (0..100, lienzo 160×100) de cada nodo con lat/lon dentro de la
 * caja. Devuelve copias: no muta los nodos de entrada. Los nodos sin lat/lon se
 * dejan como estaban.
 */
export function proyectar(nodos: NodoGrafo[], bbox: Bbox): NodoGrafo[] {
  const anchoLon = Math.max(1e-9, bbox.maxLon - bbox.minLon);
  const altoLat = Math.max(1e-9, bbox.maxLat - bbox.minLat);
  const util = 100 - 2 * MARGEN;
  const centro = { lat: (bbox.minLat + bbox.maxLat) / 2, lon: (bbox.minLon + bbox.maxLon) / 2 };
  return nodos.map((n) => {
    if (typeof n.lat !== "number" || typeof n.lon !== "number") return { ...n };
    const x = MARGEN + (util * (n.lon - bbox.minLon)) / anchoLon;
    const y = MARGEN + (util * (bbox.maxLat - n.lat)) / altoLat; // y hacia el sur
    const recortado = x < 2 || x > 98 || y < 2 || y > 98;
    const aviso = `fuera del encuadre (${formatearDistancia(distanciaM([centro.lat, centro.lon], [n.lat, n.lon]))})`;
    return {
      ...n,
      x: acotar(x),
      y: acotar(y),
      detalle: recortado ? [n.detalle, aviso].filter(Boolean).join(" · ") : n.detalle,
    };
  });
}

/** Nodos con coordenadas a menos de `radioM` de (lat, lon), del más cercano al más lejano. */
export function nodosCercanos(
  nodos: NodoGrafo[],
  lat: number,
  lon: number,
  radioM: number,
): { nodo: NodoGrafo; distanciaM: number }[] {
  const salida: { nodo: NodoGrafo; distanciaM: number }[] = [];
  for (const nodo of nodos) {
    if (typeof nodo.lat !== "number" || typeof nodo.lon !== "number") continue;
    const d = distanciaM([lat, lon], [nodo.lat, nodo.lon]);
    if (d <= radioM) salida.push({ nodo, distanciaM: Math.round(d) });
  }
  return salida.sort((a, b) => a.distanciaM - b.distanciaM);
}
