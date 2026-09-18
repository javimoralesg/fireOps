// Simbología del mapa de la consola: una insignia (letra sobre color) por tipo, igual
// para los vértices del grafo y para el entorno de OpenStreetMap, con los mismos
// colores que GrafoCiudad (tokens --nodo-*). Los colores van como var(--token) porque
// las insignias son HTML (divIcon), no atributos SVG, así que cambian solas con el tema.

import type { TipoEquipamiento } from "./overpass";

export interface Simbolo {
  glifo: string;
  /** Color CSS (var(--token)). */
  color: string;
  etiqueta: string;
  singular: string;
  plural: string;
}

const s = (glifo: string, color: string, etiqueta: string, singular: string, plural: string): Simbolo => ({
  glifo,
  color,
  etiqueta,
  singular,
  plural,
});

export const SIMBOLO_EQUIPAMIENTO: Record<TipoEquipamiento, Simbolo> = {
  hospital: s("H", "var(--nodo-hospital)", "Hospital", "hospital", "hospitales"),
  centro_salud: s("+", "var(--nodo-sanitarios)", "Centro de salud", "centro de salud", "centros de salud"),
  clinica: s("+", "var(--nodo-sanitarios)", "Clínica", "clínica", "clínicas"),
  bomberos: s("B", "var(--nodo-bomberos)", "Parque de bomberos", "parque de bomberos", "parques de bomberos"),
  policia: s("P", "var(--nodo-policia)", "Policía", "sede de policía", "sedes de policía"),
  colegio: s("E", "var(--nodo-comunicaciones)", "Colegio o instituto", "colegio", "colegios"),
  residencia: s("R", "var(--nodo-hospital)", "Residencia de mayores", "residencia", "residencias"),
  refugio: s("Rf", "var(--nodo-ruta)", "Refugio o albergue", "refugio", "refugios"),
  metro: s("M", "var(--nodo-policia)", "Metro", "estación de metro", "estaciones de metro"),
  cercanias: s("C", "var(--nodo-policia)", "Cercanías / tren", "estación de tren", "estaciones de tren"),
  subestacion: s("S", "var(--warning)", "Subestación eléctrica", "subestación", "subestaciones"),
  gasolinera: s("G", "var(--danger)", "Gasolinera", "gasolinera", "gasolineras"),
};

/** Orden de la leyenda y del resumen "Bajo el humo". */
export const ORDEN_EQUIPAMIENTOS: TipoEquipamiento[] = [
  "hospital",
  "residencia",
  "colegio",
  "centro_salud",
  "clinica",
  "refugio",
  "bomberos",
  "policia",
  "metro",
  "cercanias",
  "subestacion",
  "gasolinera",
];

/** Tipos de estado.mapa.pois (backend) → tipos del cliente. */
export const TIPO_POI: Record<string, TipoEquipamiento> = {
  hospital: "hospital",
  centro_salud: "centro_salud",
  clinica: "clinica",
  bomberos: "bomberos",
  policia: "policia",
  colegio: "colegio",
  residencia: "residencia",
  refugio: "refugio",
  metro: "metro",
  estacion: "metro",
  cercanias: "cercanias",
  subestacion: "subestacion",
  gasolinera: "gasolinera",
};

export const SIMBOLO_NODO: Record<string, Simbolo> = {
  Incidencia: s("!", "var(--danger)", "Incidencia", "incidencia", "incidencias"),
  Hospital: SIMBOLO_EQUIPAMIENTO.hospital,
  Centro_Comunicaciones: s("T", "var(--nodo-comunicaciones)", "Comunicaciones", "centro de comunicaciones", "centros de comunicaciones"),
  Ruta_Evacuacion: s("→", "var(--nodo-ruta)", "Ruta de evacuación", "ruta de evacuación", "rutas de evacuación"),
  Carretera: s("V", "var(--nodo-via)", "Vía", "vía", "vías"),
  Bomberos: s("B", "var(--nodo-bomberos)", "Bomberos", "dotación de bomberos", "dotaciones de bomberos"),
  Policia: s("P", "var(--nodo-policia)", "Policía", "unidad de policía", "unidades de policía"),
  Sanitarios: s("A", "var(--nodo-sanitarios)", "Sanitarios (SAMUR)", "unidad sanitaria", "unidades sanitarias"),
  Residencia: SIMBOLO_EQUIPAMIENTO.residencia,
  Colegio: SIMBOLO_EQUIPAMIENTO.colegio,
  Subestacion: SIMBOLO_EQUIPAMIENTO.subestacion,
  Estacion: s("M", "var(--nodo-policia)", "Estación", "estación", "estaciones"),
  Refugio: SIMBOLO_EQUIPAMIENTO.refugio,
  Gasolinera: SIMBOLO_EQUIPAMIENTO.gasolinera,
};

export const SIMBOLO_DESCONOCIDO: Simbolo = s("•", "var(--subtle)", "Otro", "elemento", "elementos");

export const EFECTIVOS = new Set(["Bomberos", "Policia", "Sanitarios"]);

/** Símbolo de un vértice del grafo; las estaciones distinguen metro y tren por subtipo OSM. */
export function simboloNodo(tipo: string, subtipo?: string): Simbolo {
  if (tipo === "Estacion" && subtipo && !/subway|metro|light_rail/i.test(subtipo)) return SIMBOLO_EQUIPAMIENTO.cercanias;
  return SIMBOLO_NODO[tipo] ?? SIMBOLO_DESCONOCIDO;
}

export const cantidad = (n: number, simbolo: Pick<Simbolo, "singular" | "plural">) => `${n} ${n === 1 ? simbolo.singular : simbolo.plural}`;

// ---------------------------------------------------------------- insignias (divIcon)

export type CuboZoom = "lejos" | "medio" | "cerca";

export const cuboZoom = (zoom: number): CuboZoom => (zoom <= 12 ? "lejos" : zoom <= 14 ? "medio" : "cerca");

/** Diámetro de la insignia en px según el zoom (el mismo que fija ESTILOS_CIUDAD en CapasCiudad). */
export function diametroInsignia(zoom: number, grande: boolean, tenue = false) {
  const tabla: Record<CuboZoom, [number, number, number]> = { lejos: [14, 9, 7], medio: [18, 14, 12], cerca: [22, 18, 16] };
  const [g, n, t] = tabla[cuboZoom(zoom)];
  return grande ? g : tenue ? t : n;
}

const escaparAtributo = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export interface OpcionesInsignia {
  grande?: boolean;
  /** Entorno de contexto (no afectado): más pequeño y algo transparente, por detrás del grafo. */
  tenue?: boolean;
  /** Vértice del grafo: aro del color del texto. */
  grafo?: boolean;
  /** Bajo el penacho: aro rojo discontinuo. */
  humo?: boolean;
  domino?: boolean;
  /** Atributos data-* extra (data-osm-id, data-capa…) para pruebas y depuración. */
  datos?: Record<string, string | undefined>;
}

export function htmlInsignia(simbolo: Simbolo, o: OpcionesInsignia = {}) {
  const atributos = [
    o.grande && "data-grande",
    o.tenue && "data-tenue",
    o.grafo && "data-grafo",
    o.humo && "data-humo",
    o.domino && "data-domino",
    ...Object.entries(o.datos ?? {}).map(([k, v]) => (v === undefined ? null : `data-${k}="${escaparAtributo(v)}"`)),
  ]
    .filter(Boolean)
    .join(" ");
  return `<span class="atalaya-insignia" ${atributos} style="--c:${simbolo.color}">${escaparAtributo(simbolo.glifo)}</span>`;
}

/** Familia de equipamiento de un vértice del grafo (para agrupar el resumen "Bajo el humo"). */
export function equipamientoDeNodo(tipo: string, subtipo?: string): TipoEquipamiento | null {
  switch (tipo) {
    case "Hospital":
      return "hospital";
    case "Residencia":
      return "residencia";
    case "Colegio":
      return "colegio";
    case "Refugio":
      return "refugio";
    case "Subestacion":
      return "subestacion";
    case "Gasolinera":
      return "gasolinera";
    case "Estacion":
      return subtipo && !/subway|metro|light_rail/i.test(subtipo) ? "cercanias" : "metro";
    default:
      return null;
  }
}
