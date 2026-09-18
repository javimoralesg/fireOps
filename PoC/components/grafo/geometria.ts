// Geometría del grafo esquemático (GrafoCiudad): proyección de lat/lon a metros,
// encuadre sin valores atípicos, vértices coincidentes, colocación de etiquetas
// sin solapes y resolución de los nombres del dominó. Funciones puras: sin React.
//
// Mundo del SVG:
// - con coordenadas reales (lat/lon en al menos dos vértices) 1 unidad = 1 metro,
//   x crece hacia el este e y hacia el sur (norte arriba);
// - sin ellas, el lienzo clásico 160×100 (x·1,6, y) que usaba el grafo antes.

import type { AristaGrafo, ImpactoDomino, NodoGrafo } from "@/lib/types";
import { distanciaM, normalizar, normalizarNombre, rumbo as rumboGeo } from "@/components/mapa/geo";

export interface Pt {
  x: number;
  y: number;
}

export interface Caja {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface FueraDeEscala {
  /** Distancia real al foco (m). */
  distanciaM: number;
  /** Rumbo real desde el foco (0 = norte). */
  rumbo: number;
}

export interface Proyeccion {
  /** Posición en el mundo (recortada al borde del encuadre si es atípica). */
  pos: Map<string, Pt>;
  /** Posición sin recortar (para cálculos de distancia). */
  real: Map<string, Pt>;
  /** true → mundo en metros proyectados desde lat/lon. */
  geo: boolean;
  /** Vértices atípicos dibujados en el borde, con su distancia real. */
  fuera: Map<string, FueraDeEscala>;
  /** Caja que contiene todos los vértices ya recortados. */
  caja: Caja;
  /** Proyecta un punto lat/lon al mundo (solo con geografía real). */
  aMundo: ((lat: number, lon: number) => Pt) | null;
}

const M_POR_GRADO_LAT = 110_574;
const M_POR_GRADO_LON = 111_320;
/** Extensión mínima del encuadre (m o unidades del lienzo) para no hacer zoom infinito sobre un solo vértice. */
const EXTENSION_MINIMA_M = 250;
const EXTENSION_MINIMA_LIENZO = 20;

export const tieneGeo = (n: NodoGrafo): n is NodoGrafo & { lat: number; lon: number } =>
  typeof n.lat === "number" &&
  typeof n.lon === "number" &&
  Number.isFinite(n.lat) &&
  Number.isFinite(n.lon) &&
  Math.abs(n.lat) <= 90 &&
  Math.abs(n.lon) <= 180 &&
  !(n.lat === 0 && n.lon === 0);

function mediana(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function cuantil(ordenados: number[], q: number): number {
  if (!ordenados.length) return 0;
  const i = (ordenados.length - 1) * q;
  const a = Math.floor(i);
  const b = Math.min(ordenados.length - 1, a + 1);
  return ordenados[a] + (ordenados[b] - ordenados[a]) * (i - a);
}

/** Recta robusta (Theil–Sen): ignora los vértices con x/y recortados o incoherentes. */
function ajusteRobusto(xs: number[], ys: number[]): { a: number; b: number } | null {
  const pendientes: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const dx = xs[j] - xs[i];
      if (Math.abs(dx) > 0.5) pendientes.push((ys[j] - ys[i]) / dx);
    }
  }
  if (!pendientes.length) return null;
  const a = mediana(pendientes);
  return { a, b: mediana(xs.map((x, i) => ys[i] - a * x)) };
}

export function cajaDe(puntos: Iterable<Pt>): Caja {
  const c: Caja = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of puntos) {
    c.minX = Math.min(c.minX, p.x);
    c.minY = Math.min(c.minY, p.y);
    c.maxX = Math.max(c.maxX, p.x);
    c.maxY = Math.max(c.maxY, p.y);
  }
  if (!Number.isFinite(c.minX)) return { minX: 0, minY: 0, maxX: 160, maxY: 100 };
  return c;
}

/** Amplía la caja para incluir un punto. */
export function incluir(c: Caja, p: Pt): Caja {
  return { minX: Math.min(c.minX, p.x), minY: Math.min(c.minY, p.y), maxX: Math.max(c.maxX, p.x), maxY: Math.max(c.maxY, p.y) };
}

/** Punto del borde de la caja en la dirección centro → p. */
function recortarAlBorde(c: Pt, p: Pt, caja: Caja): Pt {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  let t = 1;
  if (dx > 0) t = Math.min(t, (caja.maxX - c.x) / dx);
  if (dx < 0) t = Math.min(t, (caja.minX - c.x) / dx);
  if (dy > 0) t = Math.min(t, (caja.maxY - c.y) / dy);
  if (dy < 0) t = Math.min(t, (caja.minY - c.y) / dy);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/**
 * Coloca los vértices en el mundo. Con lat/lon usa una proyección equirrectangular
 * local (error despreciable a escala de barrio) y deduce la posición de los vértices
 * sin coordenadas a partir de su x/y del lienzo con un ajuste robusto. Los vértices
 * atípicos (p. ej. el 112 a 11 km) se recortan al borde del encuadre y se marcan.
 */
export function proyectarNodos(nodos: NodoGrafo[]): Proyeccion {
  const pos = new Map<string, Pt>();
  const fuera = new Map<string, FueraDeEscala>();
  const conGeo = nodos.filter(tieneGeo);
  let geo = false;
  let aMundo: Proyeccion["aMundo"] = null;

  if (conGeo.length >= 2) {
    const lat0 = mediana(conGeo.map((n) => n.lat));
    const lon0 = mediana(conGeo.map((n) => n.lon));
    const kx = Math.cos((lat0 * Math.PI) / 180) * M_POR_GRADO_LON;
    const proyectar = (lat: number, lon: number): Pt => ({ x: (lon - lon0) * kx, y: -(lat - lat0) * M_POR_GRADO_LAT });
    for (const n of conGeo) pos.set(n.id, proyectar(n.lat, n.lon));
    const c = cajaDe(pos.values());
    if (c.maxX - c.minX > 1 || c.maxY - c.minY > 1) {
      geo = true;
      aMundo = proyectar;
    } else pos.clear();
  }

  if (geo) {
    const sinGeo = nodos.filter((n) => !pos.has(n.id));
    if (sinGeo.length) {
      const ref = conGeo.filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
      const fx = ajusteRobusto(
        ref.map((n) => n.x),
        ref.map((n) => pos.get(n.id)!.x),
      );
      const fy = ajusteRobusto(
        ref.map((n) => n.y),
        ref.map((n) => pos.get(n.id)!.y),
      );
      const centro = { x: mediana([...pos.values()].map((p) => p.x)), y: mediana([...pos.values()].map((p) => p.y)) };
      for (const n of sinGeo) {
        const ok = fx && fy && Number.isFinite(n.x) && Number.isFinite(n.y);
        pos.set(n.id, ok ? { x: fx.a * n.x + fx.b, y: fy.a * n.y + fy.b } : { ...centro });
      }
    }
  } else {
    for (const n of nodos) pos.set(n.id, { x: (Number.isFinite(n.x) ? n.x : 50) * 1.6, y: Number.isFinite(n.y) ? n.y : 50 });
  }

  const real = new Map(pos);

  // Atípicos: solo con geografía real (en el lienzo clásico todo cabe en 0..100).
  if (geo && pos.size >= 5) {
    const puntos = [...pos.values()];
    const c = { x: mediana(puntos.map((p) => p.x)), y: mediana(puntos.map((p) => p.y)) };
    const dist = [...pos.entries()].map(([id, p]) => [id, Math.hypot(p.x - c.x, p.y - c.y)] as const);
    const orden = dist.map(([, d]) => d).sort((a, b) => a - b);
    const q1 = cuantil(orden, 0.25);
    const q3 = cuantil(orden, 0.75);
    const umbral = Math.max(q3 + 3 * (q3 - q1), 2 * q3, 400);
    const dentro = dist.filter(([, d]) => d <= umbral);
    if (dentro.length >= 2 && dentro.length < dist.length) {
      const cajaDentro = cajaDe(dentro.map(([id]) => pos.get(id)!));
      const margen = 0.06 * Math.max(cajaDentro.maxX - cajaDentro.minX, cajaDentro.maxY - cajaDentro.minY, EXTENSION_MINIMA_M);
      const borde: Caja = {
        minX: cajaDentro.minX - margen,
        minY: cajaDentro.minY - margen,
        maxX: cajaDentro.maxX + margen,
        maxY: cajaDentro.maxY + margen,
      };
      const cc = { x: (borde.minX + borde.maxX) / 2, y: (borde.minY + borde.maxY) / 2 };
      const byId = new Map(nodos.map((n) => [n.id, n]));
      const foco = nodos.find((n) => n.tipo === "Incidencia" && tieneGeo(n));
      for (const [id, d] of dist) {
        if (d <= umbral) continue;
        const p = pos.get(id)!;
        pos.set(id, recortarAlBorde(cc, p, borde));
        const n = byId.get(id);
        if (n && foco && tieneGeo(n) && tieneGeo(foco)) {
          fuera.set(id, { distanciaM: distanciaM([foco.lat, foco.lon], [n.lat, n.lon]), rumbo: rumboGeo([foco.lat, foco.lon], [n.lat, n.lon]) });
        } else {
          fuera.set(id, { distanciaM: d, rumbo: normalizar((Math.atan2(p.x - c.x, -(p.y - c.y)) * 180) / Math.PI) });
        }
      }
    }
  }

  let caja = cajaDe(pos.values());
  const minimo = geo ? EXTENSION_MINIMA_M : EXTENSION_MINIMA_LIENZO;
  if (caja.maxX - caja.minX < minimo) {
    const m = (caja.minX + caja.maxX) / 2;
    caja = { ...caja, minX: m - minimo / 2, maxX: m + minimo / 2 };
  }
  if (caja.maxY - caja.minY < minimo) {
    const m = (caja.minY + caja.maxY) / 2;
    caja = { ...caja, minY: m - minimo / 2, maxY: m + minimo / 2 };
  }
  return { pos, real, geo, fuera, caja, aMundo };
}

// ---------------------------------------------------------------------------
// Vista (zoom y desplazamiento)
// ---------------------------------------------------------------------------

/** Centro de la vista en el mundo y escala en píxeles por unidad del mundo. */
export interface Vista {
  cx: number;
  cy: number;
  s: number;
}

export interface Margen {
  t: number;
  r: number;
  b: number;
  l: number;
}

/** Vista que encaja la caja en un rectángulo de w×h px dejando los márgenes libres. */
export function encuadrar(caja: Caja, w: number, h: number, m: Margen): Vista {
  const bw = Math.max(caja.maxX - caja.minX, 1e-6);
  const bh = Math.max(caja.maxY - caja.minY, 1e-6);
  const aw = Math.max(40, w - m.l - m.r);
  const ah = Math.max(40, h - m.t - m.b);
  const s = Math.min(aw / bw, ah / bh);
  return {
    s,
    cx: (caja.minX + caja.maxX) / 2 - (m.l - m.r) / 2 / s,
    cy: (caja.minY + caja.maxY) / 2 - (m.t - m.b) / 2 / s,
  };
}

/** viewBox del SVG para una vista y un tamaño de contenedor. */
export function viewBoxDe(v: Vista, w: number, h: number) {
  return { x: v.cx - w / 2 / v.s, y: v.cy - h / 2 / v.s, w: w / v.s, h: h / v.s };
}

const PASOS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000, 20_000, 50_000];

/** Paso "redondo" (1, 2, 5, 10…) que ocupa como mucho `objetivoPx` píxeles. */
export function pasoRedondo(s: number, objetivoPx: number): number {
  let paso = PASOS[0];
  for (const p of PASOS) if (p * s <= objetivoPx) paso = p;
  return paso;
}

// ---------------------------------------------------------------------------
// Vértices coincidentes: se abren en abanico con un desplazamiento fijo en px
// ---------------------------------------------------------------------------

/**
 * Agrupa los vértices a menos de `eps` (unidades del mundo) y devuelve el
 * desplazamiento en píxeles de cada miembro respecto al primero (el más importante),
 * que se queda en su sitio. `ids` debe venir ordenado de más a menos importante.
 */
export function abanicoCoincidentes(
  ids: string[],
  pos: Map<string, Pt>,
  eps: number,
  radioPx: (id: string) => number,
): { desplazamiento: Map<string, Pt>; ancla: Map<string, string> } {
  const grupos: { p: Pt; miembros: string[] }[] = [];
  for (const id of ids) {
    const p = pos.get(id);
    if (!p) continue;
    const g = grupos.find((gr) => Math.hypot(gr.p.x - p.x, gr.p.y - p.y) <= eps);
    if (g) g.miembros.push(id);
    else grupos.push({ p, miembros: [id] });
  }
  const desplazamiento = new Map<string, Pt>();
  const ancla = new Map<string, string>();
  for (const g of grupos) {
    if (g.miembros.length < 2) continue;
    const [primero, ...resto] = g.miembros;
    const rMax = Math.max(...resto.map(radioPx));
    const R = radioPx(primero) + rMax + 5 + (resto.length > 3 ? resto.length : 0);
    resto.forEach((id, i) => {
      const a = ((-40 + (i * 360) / resto.length) * Math.PI) / 180;
      desplazamiento.set(id, { x: Math.cos(a) * R, y: Math.sin(a) * R });
      ancla.set(id, primero);
    });
  }
  return { desplazamiento, ancla };
}

// ---------------------------------------------------------------------------
// Etiquetas
// ---------------------------------------------------------------------------

export interface PeticionEtiqueta {
  id: string;
  /** Centro del vértice en px (cualquier origen: la colocación es invariante a traslaciones). */
  x: number;
  y: number;
  r: number;
  texto: string;
  fs: number;
  prioridad: number;
  /** Etiquetas críticas: solo evitan otras etiquetas, pueden pisar vértices secundarios. */
  ignoraVertices?: boolean;
}

export interface EtiquetaColocada {
  dx: number;
  dy: number;
  ancla: "start" | "middle" | "end";
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const solapan = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function tocaCirculo(r: Rect, cx: number, cy: number, radio: number) {
  const px = Math.max(r.x, Math.min(cx, r.x + r.w));
  const py = Math.max(r.y, Math.min(cy, r.y + r.h));
  return (px - cx) ** 2 + (py - cy) ** 2 < radio * radio;
}

/**
 * Coloca etiquetas por orden de prioridad probando ocho posiciones (abajo,
 * derecha, izquierda, arriba y las diagonales). Una etiqueta que no cabe sin
 * pisar otra (o un vértice, salvo las críticas) se omite: aparece al pasar el
 * ratón o al acercar.
 */
export function colocarEtiquetas(
  peticiones: PeticionEtiqueta[],
  obstaculos: { id: string; x: number; y: number; r: number }[],
  /** Zona visible (mismas coordenadas): se prefieren posiciones que no se salgan. */
  visible?: Rect,
  /** Zonas tapadas por controles flotantes (mismas coordenadas). */
  reservados: Rect[] = [],
): Map<string, EtiquetaColocada> {
  const colocadas = new Map<string, EtiquetaColocada>();
  const ocupados: Rect[] = [...reservados];
  const orden = [...peticiones].sort((a, b) => b.prioridad - a.prioridad);
  for (const p of orden) {
    // 0,62·fs por carácter (la fuente de la UI es más ancha que la media) y margen de 3 px:
    // con 0,56 la estimación se quedaba corta y etiquetas "sin solape" se pisaban en pantalla.
    const w = p.texto.length * p.fs * 0.62 + 6;
    const h = p.fs * 1.45;
    const d = p.r * 0.72 + 3; // separación en diagonal
    const candidatos: [EtiquetaColocada, Rect][] = [
      [{ dx: 0, dy: p.r + 2 + p.fs * 0.95, ancla: "middle" }, { x: p.x - w / 2, y: p.y + p.r + 1.5, w, h }],
      [{ dx: p.r + 4, dy: p.fs * 0.36, ancla: "start" }, { x: p.x + p.r + 2.5, y: p.y - h / 2, w, h }],
      [{ dx: -(p.r + 4), dy: p.fs * 0.36, ancla: "end" }, { x: p.x - p.r - 2.5 - w, y: p.y - h / 2, w, h }],
      [{ dx: 0, dy: -(p.r + 4), ancla: "middle" }, { x: p.x - w / 2, y: p.y - p.r - 3 - h, w, h }],
      [{ dx: d, dy: d + p.fs * 0.85, ancla: "start" }, { x: p.x + d - 1, y: p.y + d, w, h }],
      [{ dx: d, dy: -d, ancla: "start" }, { x: p.x + d - 1, y: p.y - d - h * 0.85, w, h }],
      [{ dx: -d, dy: d + p.fs * 0.85, ancla: "end" }, { x: p.x - d + 1 - w, y: p.y + d, w, h }],
      [{ dx: -d, dy: -d, ancla: "end" }, { x: p.x - d + 1 - w, y: p.y - d - h * 0.85, w, h }],
    ];
    // Desplazamiento simple: si la etiqueta se sale de la zona visible, se empuja hacia dentro.
    const ajustar = ([pos, rect]: [EtiquetaColocada, Rect]): [EtiquetaColocada, Rect, boolean] => {
      if (!visible) return [pos, rect, false];
      let mx = 0;
      let my = 0;
      if (rect.x < visible.x + 2) mx = visible.x + 2 - rect.x;
      else if (rect.x + rect.w > visible.x + visible.w - 2) mx = visible.x + visible.w - 2 - rect.x - rect.w;
      if (rect.y < visible.y + 2) my = visible.y + 2 - rect.y;
      else if (rect.y + rect.h > visible.y + visible.h - 2) my = visible.y + visible.h - 2 - rect.y - rect.h;
      if (!mx && !my) return [pos, rect, false];
      return [{ ...pos, dx: pos.dx + mx, dy: pos.dy + my }, { ...rect, x: rect.x + mx, y: rect.y + my }, true];
    };
    for (const candidato of candidatos) {
      const [pos, rect, movido] = ajustar(candidato);
      if (movido && tocaCirculo(rect, p.x, p.y, p.r + 1)) continue; // no tapar su propio vértice
      if (ocupados.some((o) => solapan(o, rect))) continue;
      if (!p.ignoraVertices && obstaculos.some((o) => o.id !== p.id && tocaCirculo(rect, o.x, o.y, o.r + 1))) continue;
      colocadas.set(p.id, pos);
      ocupados.push(rect);
      break;
    }
  }
  return colocadas;
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

const ABREVIATURAS: [RegExp, string][] = [
  [/^Colegio de Educaci[oó]n Infantil y Primaria\b/i, "CEIP"],
  [/^Instituto de Educaci[oó]n Secundaria\b/i, "IES"],
  [/^Hospital (?:General |Infantil )?Universitario\b/i, "Hosp."],
  [/^Unidad Integral de Distrito \(UID\) de Polic[ií]a Municipal/i, "UID Policía Municipal"],
  [/^Polic[ií]a Municipal\s*[-–—]\s*/i, "Policía Mun. · "],
  [/^Centro Municipal de Mayores\b/i, "C. Mayores"],
  [/^Centro Deportivo Municipal\b/i, "CDM"],
  [/^Residencia (?:para|de) Mayores\b/i, "Residencia"],
  [/^Subestaci[oó]n Transformadora\b/i, "Subestación"],
  [/^Estaci[oó]n de Mercanc[ií]as\b/i, "Est. Mercancías"],
];

/** Nombre corto para una etiqueta del lienzo (el completo va en el detalle). */
export function nombreCorto(nombre: string, max = 30): string {
  let s = nombre.replace(/\s*\(\s*-?\d+[.,]\d+\s*,\s*-?\d+[.,]\d+\s*\)/g, "");
  const partes = s.split(" · ");
  if (partes[0].trim().length >= 12) s = partes[0];
  for (const [re, rep] of ABREVIATURAS) s = s.replace(re, rep);
  s = s.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const corte = s.lastIndexOf(" ", max - 1);
  return (corte > max * 0.55 ? s.slice(0, corte) : s.slice(0, max - 1)).replace(/[\s,·—–-]+$/, "") + "…";
}

const SUBTIPOS: Record<string, string> = {
  nursing_home: "residencia de mayores",
  senior: "mayores",
  disabled: "discapacidad",
  group_home: "vivienda tutelada",
  social_facility: "centro social",
  community_centre: "centro sociocultural",
  sports_centre: "centro deportivo",
  school: "centro educativo",
  kindergarten: "escuela infantil",
  hospital: "hospital",
  clinic: "clínica",
  fire_station: "parque de bomberos",
  police: "policía",
  fuel: "estación de servicio",
  subway: "metro",
  station: "estación de tren",
  train_station: "estación de tren",
  motorway: "autovía",
  trunk: "vía rápida",
  primary: "vía principal",
  secondary: "vía secundaria",
  tertiary: "vía urbana",
  residential: "calle residencial",
  substation: "subestación",
  distribution: "centro de distribución eléctrica",
  transmission: "subestación de transporte",
  traction: "subestación de tracción",
  incendio: "incendio",
};

/** Traducción del valor OSM (si la conocemos). */
export function subtipoLegible(subtipo?: string): string | undefined {
  if (!subtipo) return undefined;
  return SUBTIPOS[subtipo];
}

/** "1,2 km" / "340 m". */
export function formatoDistancia(m: number) {
  return m >= 1000 ? `${(m / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`;
}

// ---------------------------------------------------------------------------
// Dominó: los nombres de las rutas pueden venir de un grafo anterior
// ---------------------------------------------------------------------------

const VACIAS = new Set(["de", "del", "la", "el", "los", "las", "c", "y", "en", "a", "al"]);
const fichas = (s: string) => normalizarNombre(s).split(" ").filter((t) => t && !VACIAS.has(t));

/**
 * Resuelve un nombre del dominó a un id de vértice: nombre exacto, id, nombre
 * normalizado (sin tildes) o, por último, el vértice cuyo nombre contiene todas las
 * palabras buscadas ("Hospital Gregorio Marañón" → "Hospital General Universitario
 * Gregorio Marañón"). El origen de una ruta que no aparece se asocia a la incidencia.
 */
export function crearResolutor(nodos: NodoGrafo[]) {
  const exacto = new Map(nodos.map((n) => [n.nombre, n.id]));
  const ids = new Set(nodos.map((n) => n.id));
  const normal = new Map(nodos.map((n) => [normalizarNombre(n.nombre), n.id]));
  const conFichas = nodos.map((n) => ({ id: n.id, f: new Set(fichas(n.nombre)) }));
  const incidencia = nodos.find((n) => n.tipo === "Incidencia")?.id;
  const cache = new Map<string, string | undefined>();
  return (nombre: string, esOrigen = false): string | undefined => {
    const clave = `${esOrigen ? 1 : 0}${nombre}`;
    if (cache.has(clave)) return cache.get(clave);
    let id = exacto.get(nombre) ?? (ids.has(nombre) ? nombre : undefined) ?? normal.get(normalizarNombre(nombre));
    if (!id) {
      const buscadas = fichas(nombre);
      let mejor = Infinity;
      if (buscadas.length) {
        for (const c of conFichas) {
          if (c.f.size < mejor && buscadas.every((t) => c.f.has(t))) {
            id = c.id;
            mejor = c.f.size;
          }
        }
      }
    }
    if (!id && esOrigen) id = incidencia;
    cache.set(clave, id);
    return id;
  };
}

export interface DominoResuelto {
  nodos: Set<string>;
  /** "from->to" de las aristas reales recorridas por alguna ruta. */
  aristas: Set<string>;
  /** Saltos de una ruta sin arista en el grafo actual (se dibujan discontinuos). */
  virtuales: [string, string][];
  /** Riesgo máximo por infraestructura final. */
  riesgoFinal: Map<string, number>;
  sinResolver: string[];
}

export function resolverDomino(
  domino: ImpactoDomino[] | undefined,
  aristas: AristaGrafo[],
  resolver: (nombre: string, esOrigen?: boolean) => string | undefined,
): DominoResuelto {
  const out: DominoResuelto = { nodos: new Set(), aristas: new Set(), virtuales: [], riesgoFinal: new Map(), sinResolver: [] };
  if (!domino?.length) return out;
  const existe = new Set(aristas.map((a) => `${a.from}->${a.to}`));
  const virtuales = new Set<string>();
  for (const imp of domino) {
    const ruta: string[] = [];
    imp.ruta.forEach((nombre, i) => {
      const id = resolver(nombre, i === 0);
      if (!id) out.sinResolver.push(nombre);
      else if (ruta[ruta.length - 1] !== id) ruta.push(id);
    });
    ruta.forEach((id) => out.nodos.add(id));
    for (let i = 0; i < ruta.length - 1; i++) {
      const a = ruta[i];
      const b = ruta[i + 1];
      if (existe.has(`${a}->${b}`)) out.aristas.add(`${a}->${b}`);
      else if (existe.has(`${b}->${a}`)) out.aristas.add(`${b}->${a}`);
      else if (!virtuales.has(`${a}->${b}`)) {
        virtuales.add(`${a}->${b}`);
        out.virtuales.push([a, b]);
      }
    }
    const final = resolver(imp.infraestructura) ?? ruta[ruta.length - 1];
    if (final) {
      out.nodos.add(final);
      out.riesgoFinal.set(final, Math.max(out.riesgoFinal.get(final) ?? 0, imp.riesgo));
    }
  }
  out.sinResolver = [...new Set(out.sinResolver)];
  return out;
}
