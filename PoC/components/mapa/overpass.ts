// Entorno real de OpenStreetMap consultado DESDE EL CLIENTE (Overpass).
//
// Es el respaldo del backend: el servidor manda estado.mapa.pois y el grafo real
// (nodos con lat/lon y osmId), que son la fuente de verdad para las decisiones.
// Esto solo completa el mapa con lo que el servidor no trae:
//   - modo "completo": equipamientos sensibles en 2 km + vías principales en 600 m;
//   - modo "vias": solo las vías principales (el servidor ya trae su entorno).
//
// Una sola petición por centro, con caché de 24 h en localStorage (clave por centro
// redondeado a ~100 m). Nunca se guarda en caché una respuesta vacía ni fallida.

import { distanciaM, normalizarNombre, recortarTramos, type LatLon } from "./geo";

export const ENDPOINTS_OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
] as const;

/** Tiempo máximo por servidor: si no responde, se pasa al siguiente. */
const TIMEOUT_MS = 14_000;
export const RADIO_EQUIPAMIENTOS_M = 2000;
export const RADIO_VIAS_M = 600;
/** Las vías se recortan a este radio para que no crucen medio Madrid. */
const RADIO_RECORTE_VIAS_M = 1000;
const TTL_CACHE_MS = 24 * 60 * 60 * 1000;
const PREFIJO_CACHE = "atalaya.osm.v1";

export type ModoConsulta = "completo" | "vias";

export type TipoEquipamiento =
  | "hospital"
  | "centro_salud"
  | "clinica"
  | "bomberos"
  | "policia"
  | "colegio"
  | "residencia"
  | "refugio"
  | "metro"
  | "cercanias"
  | "subestacion"
  | "gasolinera";

export interface EquipamientoOsm {
  /** Identificador OSM "node/123" | "way/456" | "relation/789". */
  id: string;
  tipo: TipoEquipamiento;
  nombre: string;
  lat: number;
  lon: number;
  distanciaM: number;
  /** Matiz legible del tipo: "Instituto", "Metro ligero", "45 kV"… */
  detalle?: string;
  direccion?: string;
  operador?: string;
}

export type ClaseVia = "motorway" | "trunk" | "primary";

export interface ViaOsm {
  id: string; // "way/123"
  nombre: string;
  ref?: string;
  clase: ClaseVia;
  /** Tramos [lat, lon] recortados alrededor del incidente. */
  tramos: LatLon[][];
}

export interface EntornoOsm {
  equipamientos: EquipamientoOsm[];
  vias: ViaOsm[];
  /** Cuándo se hizo la consulta (ISO). Si viene de caché, la hora original. */
  consultadoEn: string;
  /** Servidor que respondió ("overpass-api.de"). */
  servidor: string;
  modo: ModoConsulta;
}

export interface Centro {
  lat: number;
  lon: number;
}

// ---------------------------------------------------------------- consulta

const coord = (n: number) => n.toFixed(6);

export function construirConsulta(centro: Centro, modo: ModoConsulta): string {
  const alrededor = (r: number) => `(around:${r},${coord(centro.lat)},${coord(centro.lon)})`;
  const eq = alrededor(RADIO_EQUIPAMIENTOS_M);
  const equipamientos =
    modo === "completo"
      ? `(
  nwr["amenity"~"^(hospital|clinic|fire_station|police|school|nursing_home|fuel)$"]${eq};
  nwr["healthcare"~"^(hospital|clinic|centre)$"]${eq};
  nwr["amenity"="doctors"]["name"~"centro de salud|consultorio",i]${eq};
  nwr["social_facility"="nursing_home"]${eq};
  nwr["railway"~"^(station|halt)$"]${eq};
  nwr["power"="substation"]["substation"!="minor_distribution"]${eq};
);
out center tags;
`
      : "";
  return `[out:json][timeout:25];
${equipamientos}way["highway"~"^(motorway|trunk|primary)$"]${alrededor(RADIO_VIAS_M)};
out geom;`;
}

// ---------------------------------------------------------------- parseo

interface PuntoOverpass {
  lat: number;
  lon: number;
}

interface ElementoOverpass {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: PuntoOverpass;
  geometry?: (PuntoOverpass | null)[];
  tags?: Record<string, string>;
}

interface RespuestaOverpass {
  elements: ElementoOverpass[];
  remark?: string;
}

const esNumero = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Nombre genérico cuando el elemento no tiene `name`. */
export const NOMBRE_GENERICO: Record<TipoEquipamiento, string> = {
  hospital: "Hospital",
  centro_salud: "Centro de salud",
  clinica: "Clínica",
  bomberos: "Parque de bomberos",
  policia: "Policía",
  colegio: "Centro educativo",
  residencia: "Residencia de mayores",
  refugio: "Refugio",
  metro: "Estación de metro",
  cercanias: "Estación de tren",
  subestacion: "Subestación eléctrica",
  gasolinera: "Gasolinera",
};

function clasificar(t: Record<string, string>): { tipo: TipoEquipamiento; detalle?: string } | null {
  const nombre = (t.name ?? "").toLowerCase();
  const amenity = t.amenity;
  const salud = t.healthcare;
  if (amenity === "hospital" || salud === "hospital") return { tipo: "hospital" };
  if (t.social_facility === "nursing_home" || amenity === "nursing_home") return { tipo: "residencia" };
  if (amenity === "fire_station") return { tipo: "bomberos" };
  if (amenity === "police") return { tipo: "policia", detalle: t.operator };
  if (amenity === "school") {
    const detalle = /\b(ies|instituto)\b/.test(nombre)
      ? "Instituto"
      : /escuela infantil|guarder|infantil/.test(nombre)
        ? "Escuela infantil"
        : "Colegio";
    return { tipo: "colegio", detalle };
  }
  const esCentroSalud = salud === "centre" || /centro de salud|consultorio/.test(nombre);
  if (esCentroSalud && (amenity === "clinic" || amenity === "doctors" || salud)) return { tipo: "centro_salud" };
  if (amenity === "clinic" || salud === "clinic") return { tipo: "clinica" };
  if (amenity === "fuel") return { tipo: "gasolinera", detalle: t.brand ?? t.operator };
  if (t.power === "substation") {
    const kv = (t.voltage ?? "")
      .split(";")
      .map(Number)
      .filter((v) => v > 0)
      .map((v) => Math.round(v / 1000));
    return { tipo: "subestacion", detalle: kv.length ? `${Math.max(...kv)} kV` : undefined };
  }
  if (t.railway === "station" || t.railway === "halt") {
    const ligero = t.station === "light_rail" || t.light_rail === "yes";
    const metro = ligero || t.station === "subway" || t.subway === "yes" || /metro/i.test(t.network ?? "");
    if (metro) return { tipo: "metro", detalle: ligero ? "Metro ligero" : "Metro" };
    return { tipo: "cercanias", detalle: /cercan/i.test(t.network ?? "") ? "Cercanías" : "Tren" };
  }
  return null;
}

function direccionDe(t: Record<string, string>) {
  const calle = t["addr:street"];
  if (!calle) return t["addr:full"];
  return [calle, t["addr:housenumber"]].filter(Boolean).join(", ");
}

function nombreDe(t: Record<string, string>, tipo: TipoEquipamiento) {
  const nombre = t.name ?? t["name:es"] ?? t.official_name;
  if (nombre) return nombre;
  if (tipo === "subestacion" && t.operator) return `Subestación ${t.operator}`;
  if (t.ref) return `${NOMBRE_GENERICO[tipo]} ${t.ref}`;
  return NOMBRE_GENERICO[tipo];
}

const CLASES_VIA: ClaseVia[] = ["motorway", "trunk", "primary"];

export function parsearOverpass(json: RespuestaOverpass, centro: Centro, modo: ModoConsulta, servidor: string): EntornoOsm {
  const origen: LatLon = [centro.lat, centro.lon];
  const equipamientos: EquipamientoOsm[] = [];
  const vias: ViaOsm[] = [];
  const vistos = new Set<string>();

  for (const el of json.elements) {
    const tags = el.tags ?? {};
    const id = `${el.type}/${el.id}`;
    if (vistos.has(id)) continue;
    vistos.add(id);

    // Vías principales: vienen con geometría completa (out geom).
    const clase = CLASES_VIA.find((c) => c === tags.highway);
    if (el.type === "way" && clase && el.geometry?.length) {
      // Overpass marca con null los vértices que no puede resolver: se parte la línea ahí.
      const lineas: LatLon[][] = [[]];
      for (const p of el.geometry) {
        if (p && esNumero(p.lat) && esNumero(p.lon)) lineas[lineas.length - 1].push([p.lat, p.lon]);
        else if (lineas[lineas.length - 1].length) lineas.push([]);
      }
      const tramos = lineas.flatMap((l) => recortarTramos(l, origen, RADIO_RECORTE_VIAS_M));
      if (tramos.length) {
        vias.push({
          id,
          nombre: tags.name ?? tags.ref ?? "Vía sin nombre",
          ref: tags.ref,
          clase,
          tramos: tramos.map((t) => t.map(([la, lo]) => [+la.toFixed(6), +lo.toFixed(6)] as LatLon)),
        });
      }
      continue;
    }

    const clasif = clasificar(tags);
    if (!clasif) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!esNumero(lat) || !esNumero(lon)) continue;
    const distancia = distanciaM(origen, [lat, lon]);
    if (distancia > RADIO_EQUIPAMIENTOS_M + 150) continue;
    equipamientos.push({
      id,
      tipo: clasif.tipo,
      nombre: nombreDe(tags, clasif.tipo),
      lat: +lat.toFixed(6),
      lon: +lon.toFixed(6),
      distanciaM: Math.round(distancia),
      detalle: clasif.detalle,
      direccion: direccionDe(tags),
      operador: tags.operator,
    });
  }

  // Un mismo equipamiento suele estar dos veces (nodo de la entrada + edificio):
  // se queda el primero con el mismo tipo y nombre a menos de 150 m (300 m en estaciones).
  const unicos: EquipamientoOsm[] = [];
  for (const e of equipamientos.sort((a, b) => a.distanciaM - b.distanciaM)) {
    const nombre = normalizarNombre(e.nombre);
    const radio = e.tipo === "metro" || e.tipo === "cercanias" ? 300 : 150;
    const repetido = unicos.some(
      (u) => u.tipo === e.tipo && normalizarNombre(u.nombre) === nombre && distanciaM([u.lat, u.lon], [e.lat, e.lon]) < radio,
    );
    if (!repetido) unicos.push(e);
  }

  return { equipamientos: unicos, vias, consultadoEn: new Date().toISOString(), servidor, modo };
}

// ---------------------------------------------------------------- red

async function pedir(url: string, consulta: string): Promise<RespuestaOverpass> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      body: new URLSearchParams({ data: consulta }),
      signal: control.signal,
    });
    if (!res.ok) throw new Error(`respondió ${res.status}`);
    const json = (await res.json()) as RespuestaOverpass;
    if (!json || !Array.isArray(json.elements)) throw new Error("respuesta sin elementos");
    // Overpass devuelve 200 con un "remark" cuando la consulta se queda a medias.
    if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error(json.remark);
    return json;
  } catch (e) {
    if (control.signal.aborted) throw new Error(`sin respuesta en ${TIMEOUT_MS / 1000} s`);
    throw e;
  } finally {
    clearTimeout(temporizador);
  }
}

/** Consulta Overpass con el servidor principal y, si falla, una vez con el alternativo. */
export async function consultarOverpass(centro: Centro, modo: ModoConsulta): Promise<EntornoOsm> {
  const consulta = construirConsulta(centro, modo);
  const fallos: string[] = [];
  for (const url of ENDPOINTS_OVERPASS) {
    const host = new URL(url).host;
    try {
      return parsearOverpass(await pedir(url, consulta), centro, modo, host);
    } catch (e) {
      fallos.push(`${host}: ${e instanceof Error ? e.message : "error de red"}`);
    }
  }
  throw new Error(fallos.join(" · "));
}

// ---------------------------------------------------------------- caché

const claveCache = (c: Centro, modo: ModoConsulta) => `${PREFIJO_CACHE}.${modo}.${c.lat.toFixed(3)},${c.lon.toFixed(3)}`;

export const estaVacio = (d: EntornoOsm) => (d.modo === "completo" ? d.equipamientos.length === 0 : d.vias.length === 0);

export function leerCache(centro: Centro, modo: ModoConsulta): EntornoOsm | null {
  try {
    const crudo = localStorage.getItem(claveCache(centro, modo));
    if (!crudo) return null;
    const v = JSON.parse(crudo) as { guardadoEn?: number; datos?: EntornoOsm };
    const caducado = !v.guardadoEn || Date.now() - v.guardadoEn > TTL_CACHE_MS;
    if (!v.datos || caducado || !Array.isArray(v.datos.equipamientos) || !Array.isArray(v.datos.vias)) {
      localStorage.removeItem(claveCache(centro, modo));
      return null;
    }
    return v.datos;
  } catch {
    return null; // modo privado o JSON corrupto: se vuelve a consultar
  }
}

export function guardarCache(centro: Centro, modo: ModoConsulta, datos: EntornoOsm) {
  if (estaVacio(datos)) return; // una respuesta vacía no se cachea: puede ser un fallo parcial
  try {
    localStorage.setItem(claveCache(centro, modo), JSON.stringify({ guardadoEn: Date.now(), datos }));
  } catch {
    /* cuota llena o almacenamiento bloqueado: el mapa funciona sin caché */
  }
}

// ---------------------------------------------------------------- utilidades

export const urlOsm = (id: string) => `https://www.openstreetmap.org/${id}`;

/** Clave de agrupación de una vía: la M-30 son decenas de "ways", pero es una vía. */
export const claveVia = (v: ViaOsm) => normalizarNombre(v.ref ?? v.nombre);
