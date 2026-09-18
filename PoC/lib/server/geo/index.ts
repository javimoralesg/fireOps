// Punto de entrada del módulo geográfico: re-exporta todo y añade los dos
// ensambladores que consume la capa de servidor (mapa en vivo y reproyección del grafo).
// Sin efectos al importar.

import type { NodoGrafo } from "../../types";
import type { CoordOsm } from "./nodos-osm";
import { poisCercanos, type Poi } from "./overpass";
import { proyectarLocal, utm30ToLatLon, type PuntoWgs84 } from "./utm";

export * from "./utm";
export * from "./nominatim";
export * from "./overpass";
export * from "./osrm";
export * from "./penacho";
export * from "./nodos-osm";

// ---------------------------------------------------------------------------
// construirMapa
// ---------------------------------------------------------------------------

/** Sensor de tráfico tal y como lo devuelve lib/server/conectores/madridTrafico.ts (UTM 30N). */
export interface SensorUtm {
  id: string;
  descripcion: string;
  /** Coordenada este UTM ETRS89 30N (st_x). */
  x: number;
  /** Coordenada norte UTM ETRS89 30N (st_y). */
  y: number;
  carga: number;
  nivelServicio: number;
  intensidad: number;
  timestamp?: string;
}

export interface SensorMapa {
  id: string;
  descripcion: string;
  lat: number;
  lon: number;
  carga: number;
  nivelServicio: number;
  intensidad: number;
  timestamp: string;
}

export interface MapaOperativo {
  centro: PuntoWgs84;
  sensores: SensorMapa[];
  pois: Poi[];
}

export interface OpcionesMapa {
  /** Marca de tiempo común de la lectura de tráfico (ISO). Por defecto, ahora. */
  timestamp?: string;
  /** Radio de búsqueda de POIs (m). */
  radioPoisM?: number;
}

/**
 * Ensambla la capa de mapa: convierte los sensores de tráfico de UTM 30N a WGS84 y
 * añade los POIs sensibles del entorno.
 *
 * Los POIs que ya están representados como nodo del grafo (mismo `osmId`) se descartan,
 * para no pintar dos veces el mismo hospital o parque de bomberos.
 *
 * Si Overpass falla o tarda, `pois` vuelve vacío: el mapa nunca debe tumbar la vista
 * de mando por un servicio externo.
 */
export async function construirMapa(
  centro: PuntoWgs84,
  nodos: NodoGrafo[],
  sensoresUtm: SensorUtm[],
  opciones: OpcionesMapa = {},
): Promise<MapaOperativo> {
  const ts = opciones.timestamp ?? new Date().toISOString();

  const sensores: SensorMapa[] = (sensoresUtm ?? [])
    .filter((s) => s && Number.isFinite(s.x) && Number.isFinite(s.y))
    .map((s) => {
      const { lat, lon } = utm30ToLatLon(s.x, s.y);
      return {
        id: s.id,
        descripcion: s.descripcion,
        lat,
        lon,
        carga: s.carga,
        nivelServicio: s.nivelServicio,
        intensidad: s.intensidad,
        timestamp: s.timestamp ?? ts,
      };
    });

  let pois: Poi[] = [];
  try {
    pois = await poisCercanos(centro.lat, centro.lon, opciones.radioPoisM ?? 2000);
    const yaEnGrafo = new Set((nodos ?? []).map((n) => n.osmId).filter(Boolean) as string[]);
    if (yaEnGrafo.size) pois = pois.filter((p) => !yaEnGrafo.has(p.id));
  } catch {
    pois = [];
  }

  return { centro, sensores, pois };
}

// ---------------------------------------------------------------------------
// reproyectarNodos
// ---------------------------------------------------------------------------

/** Margen del lienzo: todos los nodos quedan dentro de [MARGEN, 100 − MARGEN]. */
const MARGEN = 8;
/** Posición preferida del incidente en el lienzo. */
const ANCLA_INCIDENTE = { x: 30, y: 55 };
/** Posición de reserva: incidente centrado, cuando (30, 55) obliga a alejar demasiado el zoom. */
const ANCLA_CENTRADA = { x: 50, y: 50 };
/**
 * La UI estira el eje X un 60 % respecto al Y, así que una misma distancia en metros
 * ocupa 1,6 veces menos unidades en X que en Y.
 */
const FACTOR_X = 1.6;
/**
 * Si anclar el incidente en (30, 55) obliga a alejar el zoom más de este factor
 * respecto a centrarlo en (50, 50), se usa el encuadre centrado.
 */
const FACTOR_MAX_DESVIO = 1.5;

/**
 * Recalcula `x`/`y` (lienzo 0..100) y rellena `lat`/`lon` de los nodos a partir de las
 * coordenadas reales de OSM.
 *
 * FÓRMULA
 * -------
 * 1. Proyección equirectangular local centrada en el incidente, norte arriba:
 *        xM = R·(lon − lon₀)·π/180·cos(lat₀)   (este positivo)
 *        yM = R·(lat − lat₀)·π/180             (norte positivo)
 * 2. Paso a unidades de lienzo con UNA sola escala `escala` en m/unidad, compensando
 *    que la UI multiplica X por 1,6:
 *        x = cx + xM / (escala · 1,6)
 *        y = cy − yM / escala                  (la Y del lienzo crece hacia abajo)
 *    Así 1 unidad de Y y 1 unidad de X pintadas representan los mismos metros.
 * 3. `escala` es la mínima que mantiene a todos los nodos dentro de [8, 92] en ambos
 *    ejes. Se prueba primero con el incidente anclado en (cx, cy) = (30, 55); si eso
 *    obliga a una escala más de 1,5× peor que centrar el incidente en (50, 50) —pasa
 *    cuando hay un nodo muy excéntrico, como el 112 de Pozuelo, a 10,6 km al ONO—, se
 *    usa el encuadre centrado. El incidente SIEMPRE queda en (30, 55) o en (50, 50).
 *
 * Los nodos sin entrada en `coords` conservan su `x`/`y` originales y se quedan sin
 * lat/lon: nunca se inventan coordenadas.
 */
export function reproyectarNodos(
  nodos: NodoGrafo[],
  coords: Record<string, CoordOsm>,
  centro: PuntoWgs84,
): NodoGrafo[] {
  const lista = nodos ?? [];

  // Paso 1-2 con escala = 1: "unidades por metro-escala".
  const crudos = new Map<string, { ux: number; uy: number; c: CoordOsm }>();
  for (const n of lista) {
    const c = coords?.[n.id];
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    const { xM, yM } = proyectarLocal(c.lat, c.lon, centro);
    crudos.set(n.id, { ux: xM / FACTOR_X, uy: -yM, c });
  }
  if (crudos.size === 0) return lista.map((n) => ({ ...n }));

  const us = [...crudos.values()];
  const minUx = Math.min(...us.map((u) => u.ux));
  const maxUx = Math.max(...us.map((u) => u.ux));
  const minUy = Math.min(...us.map((u) => u.uy));
  const maxUy = Math.max(...us.map((u) => u.uy));

  // Escala mínima (m/unidad) que mantiene todos los nodos dentro de [MARGEN, 100−MARGEN]
  // con el origen (el incidente) clavado en `ancla`.
  const hueco = (u: number, ancla: number) =>
    u >= 0 ? u / (100 - MARGEN - ancla) : u / (MARGEN - ancla);
  const escalaPara = (ancla: { x: number; y: number }) =>
    Math.max(
      hueco(maxUx, ancla.x),
      hueco(minUx, ancla.x),
      hueco(maxUy, ancla.y),
      hueco(minUy, ancla.y),
      1e-9,
    );

  const escalaAnclada = escalaPara(ANCLA_INCIDENTE);
  const escalaCentrada = escalaPara(ANCLA_CENTRADA);

  const anclar = escalaAnclada <= escalaCentrada * FACTOR_MAX_DESVIO;
  const escala = anclar ? escalaAnclada : escalaCentrada;
  const ancla = anclar ? ANCLA_INCIDENTE : ANCLA_CENTRADA;
  const cx = ancla.x;
  const cy = ancla.y;

  const recorta = (v: number) => Math.min(100 - MARGEN, Math.max(MARGEN, v));
  const redondea = (v: number) => Math.round(v * 100) / 100;

  return lista.map((n) => {
    const u = crudos.get(n.id);
    if (!u) return { ...n };
    return {
      ...n,
      lat: u.c.lat,
      lon: u.c.lon,
      osmId: u.c.osmId,
      origen: "OSM" as const,
      x: redondea(recorta(cx + u.ux / escala)),
      y: redondea(recorta(cy + u.uy / escala)),
    };
  });
}
