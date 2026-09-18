// Conversión UTM ETRS89 huso 30N → WGS84 y proyección local plana en metros.
//
// Contexto: los sensores de informo.madrid.es (lib/server/conectores/madridTrafico.ts)
// publican su posición en ETRS89 / UTM huso 30N (campos st_x / st_y). Para pintarlos
// en un mapa Leaflet hace falta la conversión inversa a lat/lon.
//
// Elipsoide: ETRS89 usa GRS80 y WGS84 usa el elipsoide WGS84. Solo se diferencian en
// el achatamiento (1/298,257222101 vs 1/298,257223563), lo que en Madrid supone
// bastante menos de 1 mm. Usamos los mismos parámetros que lib/server/conectores/geo.ts
// (latLonToUtm30) para que el round-trip sea exacto a nivel submilimétrico.

/** Semieje mayor del elipsoide (m). Idéntico en GRS80 y WGS84. */
const A = 6378137;
/** Achatamiento WGS84 (GRS80 difiere en 1e-12, irrelevante aquí). */
const F = 1 / 298.257223563;
/** Factor de escala en el meridiano central de un huso UTM. */
const K0 = 0.9996;
/** Meridiano central del huso 30N: 3° O. */
const LON0 = (-3 * Math.PI) / 180;
/** Falso este del sistema UTM (m). */
const FALSO_ESTE = 500000;

/** Radio medio terrestre (esfera autálica IUGG) usado por las proyecciones locales y el haversine. */
export const RADIO_TIERRA_M = 6371008.8;

export interface PuntoWgs84 {
  lat: number;
  lon: number;
}

/** Desplazamiento plano local en metros respecto a un centro (x hacia el este, y hacia el norte). */
export interface DesplazamientoLocal {
  xM: number;
  yM: number;
}

/**
 * Inversa exacta de la proyección UTM huso 30N (serie de Snyder, "Map Projections —
 * A Working Manual", USGS 1395, §8). Válida para el hemisferio norte (España peninsular).
 *
 * Es la función inversa de `latLonToUtm30` de lib/server/conectores/geo.ts: el round-trip
 * lat/lon → UTM → lat/lon tiene un error inferior al milímetro en la zona de Madrid.
 *
 * @param x Coordenada este UTM en metros (incluye el falso este de 500 000).
 * @param y Coordenada norte UTM en metros (desde el ecuador, hemisferio norte).
 */
export function utm30ToLatLon(x: number, y: number): PuntoWgs84 {
  const e2 = F * (2 - F); // primera excentricidad al cuadrado
  const ep2 = e2 / (1 - e2); // segunda excentricidad al cuadrado (e'²)
  const xr = x - FALSO_ESTE;
  const M = y / K0; // arco de meridiano desde el ecuador
  const mu = M / (A * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  // Latitud del pie de la perpendicular (footpoint latitude).
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const C1 = ep2 * cos1 ** 2;
  const T1 = tan1 ** 2;
  const N1 = A / Math.sqrt(1 - e2 * sin1 ** 2); // radio de curvatura en el primer vertical
  const R1 = (A * (1 - e2)) / (1 - e2 * sin1 ** 2) ** 1.5; // radio de curvatura meridiano
  const D = xr / (N1 * K0);

  const lat =
    phi1 -
    ((N1 * tan1) / R1) *
      (D ** 2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6) / 720);

  const lon =
    LON0 +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5) / 120) /
      cos1;

  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/**
 * Proyección equirectangular local (plate carrée con factor de escala en longitud).
 * Devuelve el desplazamiento en metros del punto respecto al centro:
 *
 *   xM = R · (lon − lon₀)·π/180 · cos(lat₀)      → positivo hacia el ESTE
 *   yM = R · (lat − lat₀)·π/180                  → positivo hacia el NORTE
 *
 * A escala de ciudad (< 20 km) el error frente a una geodésica real es del orden del
 * 0,1 %, más que suficiente para colocar nodos en un lienzo de mando.
 *
 * Ojo: el lienzo de la UI tiene la Y creciendo hacia abajo, así que quien pinte debe
 * invertir el signo de `yM` (lo hace `reproyectarNodos` en ./index.ts).
 */
export function proyectarLocal(lat: number, lon: number, centro: PuntoWgs84): DesplazamientoLocal {
  const rad = Math.PI / 180;
  const cosLat0 = Math.cos(centro.lat * rad);
  return {
    xM: RADIO_TIERRA_M * (lon - centro.lon) * rad * cosLat0,
    yM: RADIO_TIERRA_M * (lat - centro.lat) * rad,
  };
}

/** Inversa de `proyectarLocal`: de metros locales a lat/lon. Útil para tests y para pintar penachos. */
export function desproyectarLocal(xM: number, yM: number, centro: PuntoWgs84): PuntoWgs84 {
  const deg = 180 / Math.PI;
  const cosLat0 = Math.cos((centro.lat * Math.PI) / 180);
  return {
    lat: centro.lat + (yM / RADIO_TIERRA_M) * deg,
    lon: centro.lon + (xM / (RADIO_TIERRA_M * cosLat0)) * deg,
  };
}
