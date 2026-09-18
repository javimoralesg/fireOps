// Colocación de etiquetas permanentes sin amontonarse: por prioridad, cada etiqueta
// prueba derecha, izquierda, arriba y abajo de su marcador y se queda con el primer
// hueco libre (en píxeles del zoom actual). Si no cabe, el elemento se queda con el
// tooltip de siempre. Solo se etiqueta lo importante (incidencia, hospitales, efectivos,
// dominó y lo que está bajo el humo); el resto, tooltip al pasar el ratón.

import type { Map as MapaLeaflet } from "leaflet";

export type LadoEtiqueta = "right" | "left" | "top" | "bottom";

export interface CandidatoEtiqueta {
  id: string;
  lat: number;
  lon: number;
  texto: string;
  /** Mayor = se coloca antes. */
  prioridad: number;
  /** Radio del marcador en px (la etiqueta se separa de él). */
  radio: number;
  /** Imprescindible (el foco): puede tapar otros marcadores, nunca otras etiquetas ni controles. */
  forzar?: boolean;
}

export interface Caja {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const ALTO = 18;
/** Margen del tooltip de Leaflet (6 px) + separación propia. */
const HUECO = 8;
export const MAX_CARACTERES_ETIQUETA = 26;

export const textoEtiqueta = (t: string) =>
  t.length > MAX_CARACTERES_ETIQUETA ? `${t.slice(0, MAX_CARACTERES_ETIQUETA - 1).trimEnd()}…` : t;

/** Ancho aproximado en px de la etiqueta (11 px semibold ≈ 6,2 px por carácter). */
const ancho = (texto: string) => textoEtiqueta(texto).length * 6.2 + 12;

const solapan = (a: Caja, b: Caja) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Coloca las etiquetas en píxeles del contenedor (vista actual): hay que recalcular al
 * mover o hacer zoom. `reservadas` son zonas tapadas por controles (botones, zoom, resumen).
 */
export function colocarEtiquetas(
  mapa: MapaLeaflet,
  candidatos: CandidatoEtiqueta[],
  maximo = 14,
  reservadas: Caja[] = [],
): Map<string, LadoEtiqueta> {
  const colocadas = new Map<string, LadoEtiqueta>();
  const puntos = new Map(candidatos.map((c) => [c.id, mapa.latLngToContainerPoint([c.lat, c.lon])]));
  // Los controles, las etiquetas ya puestas y los propios marcadores ocupan sitio.
  const etiquetasPuestas: Caja[] = [...reservadas];
  const marcadores: Caja[] = candidatos.map((c) => {
    const p = puntos.get(c.id)!;
    return { x0: p.x - c.radio, y0: p.y - c.radio, x1: p.x + c.radio, y1: p.y + c.radio };
  });

  const { x: ancho0, y: alto0 } = mapa.getSize();
  const dentro = (k: Caja) => k.x0 >= 2 && k.y0 >= 2 && k.x1 <= ancho0 - 2 && k.y1 <= alto0 - 2;

  for (const c of [...candidatos].sort((a, b) => b.prioridad - a.prioridad)) {
    if (colocadas.size >= maximo) break;
    const p = puntos.get(c.id)!;
    if (p.x < 0 || p.y < 0 || p.x > ancho0 || p.y > alto0) continue; // fuera de la vista
    const w = ancho(c.texto);
    const g = c.radio + HUECO;
    const opciones: [LadoEtiqueta, Caja][] = [
      ["right", { x0: p.x + g, x1: p.x + g + w, y0: p.y - ALTO / 2, y1: p.y + ALTO / 2 }],
      ["left", { x0: p.x - g - w, x1: p.x - g, y0: p.y - ALTO / 2, y1: p.y + ALTO / 2 }],
      ["top", { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - g - ALTO, y1: p.y - g }],
      ["bottom", { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y + g, y1: p.y + g + ALTO }],
    ];
    const libre = opciones.find(
      ([, caja]) =>
        dentro(caja) && !etiquetasPuestas.some((o) => solapan(o, caja)) && (c.forzar || !marcadores.some((o) => solapan(o, caja))),
    );
    if (libre) {
      colocadas.set(c.id, libre[0]);
      etiquetasPuestas.push(libre[1]);
    }
  }
  return colocadas;
}

/** Desplazamiento del tooltip respecto al centro del marcador, según el lado. */
export function desplazamientoEtiqueta(lado: LadoEtiqueta, radio: number): [number, number] {
  const d = radio + 2;
  if (lado === "right") return [d, 0];
  if (lado === "left") return [-d, 0];
  if (lado === "top") return [0, -d];
  return [0, d];
}
