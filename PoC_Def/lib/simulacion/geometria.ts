// =====================================================================
// ATALAYA INCENDIOS · Geometría para el modelo de propagación
// ---------------------------------------------------------------------
// Propósito: utilidades geométricas que necesita lib/simulacion/propagacion.ts
// (polígonos, área real en hectáreas, punto dentro de polígono, remuestreo
// radial de un perímetro). DUEÑO: constructor D.
// Dependencias externas: ninguna. La trigonometría esférica básica
// (destino, haversine, rumbo, gradosATexto, diferenciaAngular) ya la
// publica el constructor B en lib/fuentes/geo.ts y se REUTILIZA aquí: este
// archivo solo añade lo que allí no existe y la reexporta para que el resto
// de lib/simulacion tenga un único punto de entrada.
// =====================================================================
import type { Punto, Trazado } from "../dominio/tipos";
import { destino, diferenciaAngular, gradosATexto, haversine, rumbo } from "../fuentes/geo";

export { destino, diferenciaAngular, gradosATexto, rumbo };

/** Distancia en kilómetros entre dos puntos (alias del haversine de B). */
export const distanciaKm = haversine;

/** Normaliza un ángulo a [0, 360). */
export const normalizarGrados = (g: number): number => ((g % 360) + 360) % 360;

/** Recorta un número al intervalo [min, max]. */
export const recortar = (x: number, min: number, max: number): number => Math.max(min, Math.min(max, x));

const RAD = Math.PI / 180;
/** Metros por grado de latitud (elipsoide WGS84, valor medio). */
const M_POR_GRADO_LAT = 110_574;
/** Metros por grado de longitud en el ecuador. */
const M_POR_GRADO_LON = 111_320;

/**
 * Proyección local equirectangular centrada en `origen`: convierte lat/lon a
 * metros planos (x = este, y = norte). Para un incendio (decenas de km como
 * mucho) el error frente a UTM es de centésimas de porcentaje, y evita meter
 * una dependencia de proyecciones solo para calcular un área.
 */
export function aMetrosLocales(origen: Punto, p: Punto): { x: number; y: number } {
  return {
    x: (p.lon - origen.lon) * M_POR_GRADO_LON * Math.cos(origen.lat * RAD),
    y: (p.lat - origen.lat) * M_POR_GRADO_LAT,
  };
}

/** Centro geométrico (media de vértices) de un trazado. */
export function centroide(poligono: Trazado): Punto {
  if (!poligono?.length) return { lat: 0, lon: 0 };
  let lat = 0;
  let lon = 0;
  for (const [la, lo] of poligono) {
    lat += la;
    lon += lo;
  }
  return { lat: lat / poligono.length, lon: lon / poligono.length };
}

/**
 * Área de un polígono en hectáreas por la fórmula del cordón de zapato
 * (shoelace) sobre la proyección local en metros. El polígono puede estar
 * abierto o cerrado; se trata siempre como cerrado.
 */
export function areaHa(poligono: Trazado): number {
  if (!poligono || poligono.length < 3) return 0;
  const origen = centroide(poligono);
  const pts = poligono.map(([lat, lon]) => aMetrosLocales(origen, { lat, lon }));
  let doble = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    doble += a.x * b.y - b.x * a.y;
  }
  return Math.abs(doble) / 2 / 10_000;
}

/**
 * ¿El punto cae dentro del polígono? Algoritmo del número de cruces
 * (ray casting) en coordenadas lat/lon; suficiente porque los perímetros
 * son pequeños y no cruzan el antimeridiano.
 */
export function dentroDePoligono(punto: Punto, poligono: Trazado): boolean {
  if (!poligono || poligono.length < 3) return false;
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [yi, xi] = poligono[i];
    const [yj, xj] = poligono[j];
    const cruza = yi > punto.lat !== yj > punto.lat;
    if (cruza && punto.lon < ((xj - xi) * (punto.lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/**
 * Convierte un perímetro cualquiera en un vector de `n` radios (metros)
 * medidos desde `centro`, uno por cada rumbo equiespaciado empezando en el
 * norte. Si el perímetro no tiene vértices se devuelve un círculo de
 * `radioMinimoM`. Así el modelo siempre trabaja con la misma rejilla angular
 * aunque el perímetro venga del satélite, de un humano o de un ciclo previo.
 */
export function radiosPorRumbo(centro: Punto, poligono: Trazado | undefined, n: number, radioMinimoM: number): number[] {
  const radios = new Array<number>(n).fill(radioMinimoM);
  if (!poligono || poligono.length < 3) return radios;
  const paso = 360 / n;
  // Para cada vértice, se le asigna el sector angular más cercano y se queda
  // el radio mayor (el perímetro es convexo en la práctica).
  const acumulado = new Array<number>(n).fill(0);
  for (const [lat, lon] of poligono) {
    const p = { lat, lon };
    const d = haversine(centro, p) * 1000;
    const b = rumbo(centro, p);
    const i = Math.round(b / paso) % n;
    acumulado[i] = Math.max(acumulado[i], d);
  }
  // Los sectores sin vértice se interpolan con el vecino más cercano no vacío.
  for (let i = 0; i < n; i++) {
    if (acumulado[i] > 0) {
      radios[i] = Math.max(radioMinimoM, acumulado[i]);
      continue;
    }
    let izquierda = 0;
    let derecha = 0;
    for (let k = 1; k <= n; k++) {
      const a = acumulado[(i - k + n) % n];
      if (a > 0) {
        izquierda = a;
        break;
      }
    }
    for (let k = 1; k <= n; k++) {
      const a = acumulado[(i + k) % n];
      if (a > 0) {
        derecha = a;
        break;
      }
    }
    const media = (izquierda + derecha) / 2 || izquierda || derecha;
    radios[i] = Math.max(radioMinimoM, media);
  }
  return radios;
}

/** Construye el polígono cerrado a partir de los radios por rumbo. */
export function poligonoDesdeRadios(centro: Punto, radios: number[]): Trazado {
  const n = radios.length;
  const paso = 360 / n;
  const puntos: Trazado = radios.map((r, i) => {
    const p = destino(centro, i * paso, Math.max(1, r) / 1000);
    return [p.lat, p.lon] as [number, number];
  });
  // Cerrado explícitamente: Leaflet lo agradece y el shoelace no se entera.
  puntos.push(puntos[0]);
  return puntos;
}

/** Distancia (metros) del centro al perímetro siguiendo un rumbo dado. */
export function alcanceEnRumbo(radios: number[], rumboGrados: number): number {
  const n = radios.length;
  const paso = 360 / n;
  const i = Math.round(normalizarGrados(rumboGrados) / paso) % n;
  return radios[i];
}

// ---------------------------------------------------------------------
// AÑADIDO (constructor K, 2026-09-19): perímetro, distancia entre focos y
// envolvente convexa. Lo necesitan lib/simulacion/contencion.ts (fracción
// de perímetro controlado) y lib/simulacion/fusion.ts (unión de focos).
// ---------------------------------------------------------------------

/** Longitud del perímetro de un trazado cerrado, en metros. */
export function perimetroM(poligono: Trazado | undefined): number {
  if (!poligono || poligono.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < poligono.length; i++) {
    const [laA, loA] = poligono[i];
    const [laB, loB] = poligono[(i + 1) % poligono.length];
    if (laA === laB && loA === loB) continue; // vértice repetido del cierre explícito
    total += haversine({ lat: laA, lon: loA }, { lat: laB, lon: loB }) * 1000;
  }
  return +total.toFixed(1);
}

/** Distancia (m) de un punto plano al segmento AB, en metros locales. */
function distanciaPuntoSegmento(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const largo2 = dx * dx + dy * dy;
  if (largo2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = recortar(((p.x - a.x) * dx + (p.y - a.y) * dy) / largo2, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Distancia BORDE A BORDE entre dos perímetros, en metros. Devuelve 0 si se
 * solapan (algún vértice de uno cae dentro del otro). Aproximación suficiente
 * para perímetros de incendio, que en la práctica son estrellados respecto a
 * su centro: se mide vértice contra segmento en los dos sentidos.
 */
export function distanciaEntrePerimetrosM(a: Trazado | undefined, b: Trazado | undefined): number {
  if (!a || !b || a.length < 3 || b.length < 3) return Number.POSITIVE_INFINITY;
  if (a.some(([lat, lon]) => dentroDePoligono({ lat, lon }, b))) return 0;
  if (b.some(([lat, lon]) => dentroDePoligono({ lat, lon }, a))) return 0;

  const origen = centroide(a);
  const pa = a.map(([lat, lon]) => aMetrosLocales(origen, { lat, lon }));
  const pb = b.map(([lat, lon]) => aMetrosLocales(origen, { lat, lon }));

  let minimo = Number.POSITIVE_INFINITY;
  for (const p of pa) {
    for (let i = 0; i < pb.length; i++) minimo = Math.min(minimo, distanciaPuntoSegmento(p, pb[i], pb[(i + 1) % pb.length]));
  }
  for (const p of pb) {
    for (let i = 0; i < pa.length; i++) minimo = Math.min(minimo, distanciaPuntoSegmento(p, pa[i], pa[(i + 1) % pa.length]));
  }
  return +minimo.toFixed(1);
}

/**
 * Envolvente convexa (cadena monótona de Andrew) de un conjunto de puntos,
 * calculada sobre la proyección local en metros y devuelta en lat/lon.
 */
export function envolventeConvexa(puntos: Punto[]): Trazado {
  if (!puntos.length) return [];
  if (puntos.length < 3) return puntos.map((p) => [p.lat, p.lon] as [number, number]);
  const origen = centroide(puntos.map((p) => [p.lat, p.lon] as [number, number]));
  const planos = puntos
    .map((p) => ({ ...aMetrosLocales(origen, p), punto: p }))
    .sort((u, v) => u.x - v.x || u.y - v.y);
  const cruz = (o: typeof planos[0], a: typeof planos[0], b: typeof planos[0]) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const abajo: typeof planos = [];
  for (const p of planos) {
    while (abajo.length >= 2 && cruz(abajo[abajo.length - 2], abajo[abajo.length - 1], p) <= 0) abajo.pop();
    abajo.push(p);
  }
  const arriba: typeof planos = [];
  for (let i = planos.length - 1; i >= 0; i--) {
    const p = planos[i];
    while (arriba.length >= 2 && cruz(arriba[arriba.length - 2], arriba[arriba.length - 1], p) <= 0) arriba.pop();
    arriba.push(p);
  }
  abajo.pop();
  arriba.pop();
  const casco = [...abajo, ...arriba];
  const trazado: Trazado = casco.map((p) => [p.punto.lat, p.punto.lon] as [number, number]);
  if (trazado.length) trazado.push(trazado[0]);
  return trazado;
}

/**
 * Radios exactos del polígono medidos desde `centro`: para cada uno de los `n`
 * rumbos equiespaciados, lanza un rayo y devuelve la distancia (m) al punto por
 * el que sale del polígono. A diferencia de `radiosPorRumbo` —que reparte los
 * vértices por sectores e interpola los huecos con la media de los vecinos, lo
 * que infla mucho las formas alargadas— este remuestreo es fiel a la geometría
 * y es el que hay que usar para unir dos perímetros (lib/simulacion/fusion.ts).
 * Si un rumbo no corta el polígono (centro fuera) se cae al radio mínimo.
 */
export function radiosPorRayo(centro: Punto, poligono: Trazado | undefined, n: number, radioMinimoM: number): number[] {
  const radios = new Array<number>(n).fill(radioMinimoM);
  if (!poligono || poligono.length < 3) return radios;
  const pts = poligono.map(([lat, lon]) => aMetrosLocales(centro, { lat, lon }));
  const paso = 360 / n;

  for (let i = 0; i < n; i++) {
    const rumboRad = i * paso * RAD;
    // Rumbo geográfico: 0° = norte (+y), 90° = este (+x).
    const dx = Math.sin(rumboRad);
    const dy = Math.cos(rumboRad);
    let mejor = 0;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k];
      const b = pts[(k + 1) % pts.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue; // paralelos
      const t = (a.x * ey - a.y * ex) / den; // distancia a lo largo del rayo
      const u = (a.x * dy - a.y * dx) / den; // posición sobre la arista (0..1)
      if (t > 0 && u >= 0 && u <= 1) mejor = Math.max(mejor, t);
    }
    radios[i] = Math.max(radioMinimoM, mejor);
  }
  return radios;
}
