// Construcción del grafo de ciudad a partir de elementos de OpenStreetMap.
// Todo es determinista y explicable: mapeo de etiquetas → tipo, filtros por
// distancia y aristas derivadas de la geometría (nada de IA aquí).

import { bajoPenacho, destino, distanciaM, penachoDesdeViento } from "@/components/mapa/geo";
import { COORDS_OSM } from "@/lib/server/geo/nodos-osm";
import type { AristaGrafo, NodoGrafo, TipoNodo } from "@/lib/types";
import type { ElementoOsm } from "./osm";

export interface Viento {
  direccionGrados: number;
  velocidadKmh: number;
}

export interface OpcionesConstruccion {
  /** Radio de referencia (m). Los límites por tipo se escalan con él. */
  radioM?: number;
  incidente?: { id: string; nombre: string };
  viento?: Viento;
}

export interface GrafoBase {
  nodos: NodoGrafo[];
  aristas: AristaGrafo[];
}

export const RADIO_BASE = 1200;

/** Distancia máxima al centro por tipo, para un radio de referencia de 1200 m. */
const LIMITES: Partial<Record<TipoNodo, number>> = {
  Hospital: 3000,
  Bomberos: 3000,
  Subestacion: 3000,
  Residencia: 3000,
  Estacion: 3000,
  Policia: 1200,
  Carretera: 1200,
  Refugio: 1000,
  Colegio: 800,
  Gasolinera: 700,
};

/** Tope de vértices por tipo (los más cercanos) para no pasar de ~65 nodos. */
const TOPES: Partial<Record<TipoNodo, number>> = {
  Residencia: 12,
  Estacion: 10,
  Carretera: 10,
  Refugio: 6,
  Colegio: 6,
  Hospital: 6,
  Bomberos: 4,
  Subestacion: 4,
  Policia: 3,
  Gasolinera: 3,
};

const TIPOS_EFECTIVOS: TipoNodo[] = ["Bomberos", "Policia", "Sanitarios"];
/** Subtipos de Hospital que son centros de salud, no hospitales: radio corto. */
const SUBTIPOS_AMBULATORIO = ["clinic", "doctors"];

const RE_RESIDENCIA = /mayor|residencia|centro de d[ií]a|comedor/i;
const RE_GREGORIO = /gregorio\s+mara/i;
const RE_M30 = /\bm-?30\b|calle\s*30|avenida de la paz/i;
const RE_MENDEZ = /m[ée]ndez\s+[áa]lvaro/i;

const SUFIJO: Partial<Record<TipoNodo, string>> = {
  Hospital: "hospital",
  Bomberos: "bomberos",
  Policia: "policia",
  Residencia: "residencia",
  Colegio: "colegio",
  Subestacion: "subestacion",
  Estacion: "estacion",
  Refugio: "refugio",
  Gasolinera: "gasolinera",
  Carretera: "via",
};

interface Candidato {
  tipo: TipoNodo;
  subtipo: string;
  nombre: string;
  lat: number;
  lon: number;
  osmId: string;
  detalle?: string;
  distancia: number;
  clave: string;
}

/** Mapeo de etiquetas OSM → tipo del grafo. null = no nos interesa. */
export function tipoDesdeTags(tags: Record<string, string>): { tipo: TipoNodo; subtipo: string } | null {
  const nombre = tags.name ?? "";
  const amenity = tags.amenity;
  if (amenity === "hospital") return { tipo: "Hospital", subtipo: amenity };
  // Centros de salud y ambulatorios: cuentan como Hospital para el dominó, con subtipo propio.
  if (amenity === "clinic" || amenity === "doctors") return { tipo: "Hospital", subtipo: amenity };
  if (amenity === "fire_station") return { tipo: "Bomberos", subtipo: amenity };
  if (amenity === "police") return { tipo: "Policia", subtipo: amenity };
  if (amenity === "school") return { tipo: "Colegio", subtipo: tags["isced:level"] ?? amenity };
  if (amenity === "social_facility") return { tipo: "Residencia", subtipo: tags["social_facility:for"] ?? tags.social_facility ?? amenity };
  if (amenity === "fuel") return { tipo: "Gasolinera", subtipo: amenity };
  if (amenity === "community_centre") return { tipo: RE_RESIDENCIA.test(nombre) ? "Residencia" : "Refugio", subtipo: amenity };
  if (tags.power === "substation") return { tipo: "Subestacion", subtipo: tags.substation ?? tags.power };
  if (tags.railway === "station") return { tipo: "Estacion", subtipo: tags.station ?? tags.railway };
  if (tags.leisure === "sports_centre") return { tipo: "Refugio", subtipo: tags.leisure };
  if (tags.highway === "motorway" || tags.highway === "trunk" || tags.highway === "primary") {
    return { tipo: "Carretera", subtipo: tags.highway };
  }
  return null;
}

/** "Infraestructuras" para equipamiento, "Efectivos" para medios desplegables. */
export function coleccionDe(tipo: TipoNodo): string {
  if (tipo === "Incidencia") return "Incidencias";
  return TIPOS_EFECTIVOS.includes(tipo) ? "Efectivos" : "Infraestructuras";
}

function detalleDe(tags: Record<string, string>): string | undefined {
  const partes: string[] = [];
  const calle = tags["addr:street"];
  if (calle) partes.push([calle, tags["addr:housenumber"]].filter(Boolean).join(" "));
  if (tags.operator) partes.push(tags.operator);
  const tel = tags.phone ?? tags["contact:phone"];
  if (tel) partes.push(tel);
  return partes.length > 0 ? partes.join(" · ") : undefined;
}

function nombreDe(tags: Record<string, string>, tipo: TipoNodo): string {
  const nombre = (tags.name ?? "").trim().replace(/\.$/, "");
  if (nombre) return nombre;
  // Sin nombre solo se salvan las vías con referencia ("M-30", "A-3").
  return tipo === "Carretera" ? (tags.ref ?? "").trim() : "";
}

function candidatos(elementos: ElementoOsm[], centro: { lat: number; lon: number }): Candidato[] {
  const salida: Candidato[] = [];
  for (const el of elementos) {
    const clasificado = tipoDesdeTags(el.tags);
    if (!clasificado) continue;
    const nombre = nombreDe(el.tags, clasificado.tipo);
    if (!nombre) continue;
    const clave =
      clasificado.tipo === "Carretera"
        ? `via|${(el.tags.ref ?? nombre).toLowerCase()}`
        : `${clasificado.tipo}|${nombre.toLowerCase()}`;
    salida.push({
      tipo: clasificado.tipo,
      subtipo: clasificado.subtipo,
      nombre,
      lat: el.lat,
      lon: el.lon,
      osmId: `${el.tipo}/${el.id}`,
      detalle: detalleDe(el.tags),
      distancia: Math.round(distanciaM([centro.lat, centro.lon], [el.lat, el.lon])),
      clave,
    });
  }
  return salida;
}

/** Deduplica (una vía = un vértice: el tramo más cercano) y aplica límites y topes. */
function seleccionar(lista: Candidato[], radioM: number, forzados: Set<string>): Candidato[] {
  const factor = radioM / RADIO_BASE;
  const porClave = new Map<string, Candidato>();
  for (const c of lista) {
    const previo = porClave.get(c.clave);
    if (!previo || c.distancia < previo.distancia) porClave.set(c.clave, c);
  }
  const unicos = [...porClave.values()].sort((a, b) => a.distancia - b.distancia);
  const cuenta = new Map<TipoNodo, number>();
  const salida: Candidato[] = [];
  for (const c of unicos) {
    const forzado = forzados.has(c.clave);
    const base = SUBTIPOS_AMBULATORIO.includes(c.subtipo) ? RADIO_BASE : (LIMITES[c.tipo] ?? RADIO_BASE);
    const limite = base * factor;
    if (!forzado && c.distancia > limite) continue;
    const usados = cuenta.get(c.tipo) ?? 0;
    if (!forzado && usados >= (TOPES[c.tipo] ?? 6)) continue;
    cuenta.set(c.tipo, usados + 1);
    salida.push(c);
  }
  return salida;
}

function aNodo(c: Candidato, id: string, nombre = c.nombre): NodoGrafo {
  return {
    id,
    nombre,
    tipo: c.tipo,
    x: 50,
    y: 50,
    lat: c.lat,
    lon: c.lon,
    subtipo: c.subtipo,
    origen: "OSM",
    osmId: c.osmId,
    detalle: c.detalle,
  };
}

/**
 * Vértice fijo del guion. Si poc-55 resolvió sus coordenadas reales en
 * lib/server/geo/nodos-osm.ts se usan esas (con su osmId); si no, las de
 * respaldo que se le pasan, indicándolo en `detalle`.
 */
function manual(id: string, nombre: string, tipo: TipoNodo, respaldo: [number, number], detalle: string): NodoGrafo {
  const real = COORDS_OSM[id];
  if (real) {
    return {
      id,
      nombre,
      tipo,
      x: 50,
      y: 50,
      lat: real.lat,
      lon: real.lon,
      origen: "manual",
      osmId: real.osmId,
      detalle: `${detalle} · coordenadas reales de OSM: ${real.nombreOsm} (${real.osmId})`,
    };
  }
  return { id, nombre, tipo, x: 50, y: 50, lat: respaldo[0], lon: respaldo[1], origen: "manual", detalle: `${detalle} · coordenadas aproximadas (sin equivalente en OSM)` };
}

/**
 * Vértices y aristas a partir de los elementos OSM ya descargados.
 * Los ids de los vértices clave se conservan (hosp-gregorio, m30-sur,
 * via-mendez-alvaro, subest-arganzuela, bomberos-p7, policia-u12) para que el
 * guion, las plantillas y nodoDeUbicacion sigan funcionando.
 */
export function construirDesdeElementos(
  elementos: ElementoOsm[],
  centro: { lat: number; lon: number },
  opts: OpcionesConstruccion = {},
): GrafoBase {
  const radioM = opts.radioM ?? RADIO_BASE;
  const lista = candidatos(elementos, centro);

  // El Gregorio Marañón entra aunque exceda el radio (se pide expresamente).
  const gregorio = lista
    .filter((c) => c.tipo === "Hospital" && RE_GREGORIO.test(c.nombre))
    .sort((a, b) => a.distancia - b.distancia)[0];
  const forzados = new Set<string>(gregorio ? [gregorio.clave] : []);

  const elegidos = seleccionar(lista, radioM, forzados);

  // Ids compatibles con el grafo actual.
  const idsFijos = new Map<Candidato, { id: string; nombre?: string }>();
  const primero = (filtro: (c: Candidato) => boolean) => elegidos.filter(filtro).sort((a, b) => a.distancia - b.distancia)[0];

  // Si el elemento con el osmId que fijó poc-55 está en la consulta, ese manda;
  // si no, se usa el criterio de proximidad.
  const porOsmId = (idNodo: string) => {
    const ref = COORDS_OSM[idNodo]?.osmId;
    return ref ? elegidos.find((c) => c.osmId === ref) : undefined;
  };

  const gregorioElegido =
    porOsmId("Infraestructuras/hosp-gregorio") ??
    elegidos.find((c) => c === gregorio) ??
    primero((c) => c.tipo === "Hospital" && RE_GREGORIO.test(c.nombre));
  if (gregorioElegido) idsFijos.set(gregorioElegido, { id: "Infraestructuras/hosp-gregorio" });

  const m30 = porOsmId("Infraestructuras/m30-sur") ?? primero((c) => c.tipo === "Carretera" && (c.clave === "via|m-30" || RE_M30.test(c.nombre)));
  if (m30) idsFijos.set(m30, { id: "Infraestructuras/m30-sur", nombre: "M-30 (tramo sur)" });

  const mendez = porOsmId("Infraestructuras/via-mendez-alvaro") ?? primero((c) => c.tipo === "Carretera" && c !== m30 && RE_MENDEZ.test(c.nombre));
  if (mendez) idsFijos.set(mendez, { id: "Infraestructuras/via-mendez-alvaro", nombre: "C/ Méndez Álvaro" });

  const subestacion = porOsmId("Infraestructuras/subest-arganzuela") ?? primero((c) => c.tipo === "Subestacion");
  if (subestacion) idsFijos.set(subestacion, { id: "Infraestructuras/subest-arganzuela" });

  const bomberos = porOsmId("Efectivos/bomberos-p7") ?? primero((c) => c.tipo === "Bomberos");
  if (bomberos) idsFijos.set(bomberos, { id: "Efectivos/bomberos-p7" });

  const policia = porOsmId("Efectivos/policia-u12") ?? primero((c) => c.tipo === "Policia");
  if (policia) idsFijos.set(policia, { id: "Efectivos/policia-u12" });

  const nodos: NodoGrafo[] = elegidos.map((c) => {
    const fijo = idsFijos.get(c);
    const id = fijo?.id ?? `${coleccionDe(c.tipo)}/osm-${SUFIJO[c.tipo] ?? "poi"}-${c.osmId.split("/")[1]}`;
    return aNodo(c, id, fijo?.nombre ?? c.nombre);
  });

  // Incidencia en el centro.
  const incidencia: NodoGrafo = {
    id: opts.incidente?.id ?? "Incidencias/inc-2049",
    nombre: opts.incidente?.nombre ?? "Incendio Nave Méndez Álvaro",
    tipo: "Incidencia",
    x: 50,
    y: 50,
    lat: centro.lat,
    lon: centro.lon,
    origen: "manual",
    detalle: "Foco declarado del incidente",
  };
  nodos.unshift(incidencia);

  // Vértices manuales que el guion necesita y OSM no da.
  const hospital = nodos.find((n) => n.id === "Infraestructuras/hosp-gregorio") ?? nodos.find((n) => n.tipo === "Hospital");
  const baseSamur: [number, number] = typeof hospital?.lat === "number" && typeof hospital.lon === "number" ? [hospital.lat, hospital.lon] : [centro.lat, centro.lon];
  nodos.push(
    manual("Infraestructuras/ruta-evac-3", "Ruta Evacuación R-3", "Ruta_Evacuacion", destino([centro.lat, centro.lon], 180, 600), "Vértice fijo del guion: corredor de evacuación"),
    manual("Infraestructuras/cecom-112", "Centro Comunicaciones 112", "Centro_Comunicaciones", destino([centro.lat, centro.lon], 45, 400), "Vértice fijo del guion: centro de emergencias 112"),
    manual("Efectivos/samur-a3", "SAMUR Ambulancia A3", "Sanitarios", destino(baseSamur, 225, 120), "Vértice fijo del guion: unidad sanitaria"),
  );

  return { nodos, aristas: derivarAristas(nodos, centro, opts.viento) };
}

const coords = (n: NodoGrafo): [number, number] | null =>
  typeof n.lat === "number" && typeof n.lon === "number" ? [n.lat, n.lon] : null;

function masCercano(desde: NodoGrafo, candidatos_: NodoGrafo[]): { nodo: NodoGrafo; distancia: number } | null {
  const a = coords(desde);
  if (!a) return null;
  let mejor: { nodo: NodoGrafo; distancia: number } | null = null;
  for (const n of candidatos_) {
    const b = coords(n);
    if (!b || n.id === desde.id) continue;
    const d = distanciaM(a, b);
    if (!mejor || d < mejor.distancia) mejor = { nodo: n, distancia: d };
  }
  return mejor;
}

/** Aristas deterministas: bloqueo por proximidad/penacho, suministro por acceso y despliegues. */
export function derivarAristas(nodos: NodoGrafo[], centro: { lat: number; lon: number }, viento?: Viento): AristaGrafo[] {
  const aristas: AristaGrafo[] = [];
  const vistas = new Set<string>();
  const porId = new Map(nodos.map((n) => [n.id, n]));
  const añadir = (from: string, to: string, tipo: AristaGrafo["tipo"]) => {
    if (from === to || !porId.has(from) || !porId.has(to)) return;
    const clave = `${from}|${to}|${tipo}`;
    if (vistas.has(clave)) return;
    vistas.add(clave);
    aristas.push({ from, to, tipo });
  };

  const de = (tipo: TipoNodo) => nodos.filter((n) => n.tipo === tipo);
  const incidencia = nodos.find((n) => n.tipo === "Incidencia");
  const vias = de("Carretera");
  const subestaciones = de("Subestacion");
  const penacho = viento ? penachoDesdeViento(viento) : null;

  if (incidencia) {
    const foco = coords(incidencia) ?? [centro.lat, centro.lon];
    for (const via of vias) {
      const p = coords(via);
      if (!p) continue;
      const cerca = distanciaM(foco, p) < 350;
      if (cerca || (penacho && bajoPenacho(foco, penacho, p))) añadir(incidencia.id, via.id, "BLOQUEA_A");
    }
    for (const sub of subestaciones) {
      const p = coords(sub);
      if (p && distanciaM(foco, p) < 500) añadir(incidencia.id, sub.id, "BLOQUEA_A");
    }
  }

  // Acceso rodado de cada equipamiento: su vía principal más cercana.
  const servidos: TipoNodo[] = ["Hospital", "Residencia", "Colegio", "Estacion", "Refugio"];
  for (const nodo of nodos) {
    if (!servidos.includes(nodo.tipo)) continue;
    const cerca = masCercano(nodo, vias);
    if (cerca && cerca.distancia < 900) añadir(cerca.nodo.id, nodo.id, "SUMINISTRA_A");
  }

  // Suministro eléctrico de lo crítico.
  const alimentados: TipoNodo[] = ["Hospital", "Centro_Comunicaciones", "Estacion"];
  for (const nodo of nodos) {
    if (!alimentados.includes(nodo.tipo)) continue;
    const cerca = masCercano(nodo, subestaciones);
    if (cerca && cerca.distancia < 1500) añadir(cerca.nodo.id, nodo.id, "SUMINISTRA_A");
  }

  // Despliegue de efectivos (los demás medios quedan sin asignar).
  const m30 = porId.get("Infraestructuras/m30-sur") ?? vias[0];
  const hospital = porId.get("Infraestructuras/hosp-gregorio") ?? de("Hospital")[0];
  if (incidencia) añadir("Efectivos/bomberos-p7", incidencia.id, "DESPLEGADO_EN");
  if (m30) añadir("Efectivos/policia-u12", m30.id, "DESPLEGADO_EN");
  if (hospital) añadir("Efectivos/samur-a3", hospital.id, "DESPLEGADO_EN");

  // Cadena del guion actual (compatibilidad con plantillas e informes).
  añadir("Infraestructuras/m30-sur", "Infraestructuras/ruta-evac-3", "SUMINISTRA_A");
  añadir("Infraestructuras/via-mendez-alvaro", "Infraestructuras/hosp-gregorio", "SUMINISTRA_A");
  añadir("Infraestructuras/hosp-gregorio", "Infraestructuras/cecom-112", "SUMINISTRA_A");

  return aristas;
}

/** Transformación lineal lat/lon → x,y deducida de los nodos ya proyectados. */
function transformacion(nodos: NodoGrafo[]): ((lat: number, lon: number) => { x: number; y: number }) | null {
  const con = nodos.filter((n) => typeof n.lat === "number" && typeof n.lon === "number");
  if (con.length < 2) return null;
  const lats = con.map((n) => n.lat as number);
  const lons = con.map((n) => n.lon as number);
  const iLonMin = lons.indexOf(Math.min(...lons));
  const iLonMax = lons.indexOf(Math.max(...lons));
  const iLatMin = lats.indexOf(Math.min(...lats));
  const iLatMax = lats.indexOf(Math.max(...lats));
  const dLon = lons[iLonMax] - lons[iLonMin];
  const dLat = lats[iLatMax] - lats[iLatMin];
  if (Math.abs(dLon) < 1e-9 || Math.abs(dLat) < 1e-9) return null;
  const sx = (con[iLonMax].x - con[iLonMin].x) / dLon;
  const sy = (con[iLatMax].y - con[iLatMin].y) / dLat;
  return (lat: number, lon: number) => ({
    x: Math.max(0, Math.min(100, Math.round((con[iLonMin].x + (lon - lons[iLonMin]) * sx) * 10) / 10)),
    y: Math.max(0, Math.min(100, Math.round((con[iLatMin].y + (lat - lats[iLatMin]) * sy) * 10) / 10)),
  });
}

/**
 * Convierte una observación de un periférico en una incidencia nueva del grafo,
 * con sus aristas de bloqueo a vías y subestaciones a < 300 m. El dominó sigue
 * desde esas vías, así que no se crean aristas SUMINISTRA_A.
 */
export function incidenciaDesdeObservacion(
  grafo: GrafoBase,
  obs: { id: string; nombre: string; lat: number; lon: number; categoria: string },
): { nodoNuevo: NodoGrafo; aristasNuevas: AristaGrafo[] } {
  const id = obs.id.includes("/") ? obs.id : `Incidencias/${obs.id}`;
  const aXY = transformacion(grafo.nodos);
  const xy = aXY ? aXY(obs.lat, obs.lon) : { x: 50, y: 50 };
  const nodoNuevo: NodoGrafo = {
    id,
    nombre: obs.nombre,
    tipo: "Incidencia",
    x: xy.x,
    y: xy.y,
    lat: obs.lat,
    lon: obs.lon,
    subtipo: obs.categoria,
    origen: "periferico",
    detalle: `Foco detectado por un periférico (${obs.categoria})`,
  };
  const aristasNuevas: AristaGrafo[] = [];
  for (const n of grafo.nodos) {
    if (n.tipo !== "Carretera" && n.tipo !== "Subestacion") continue;
    const p = coords(n);
    if (p && distanciaM([obs.lat, obs.lon], p) < 300) aristasNuevas.push({ from: id, to: n.id, tipo: "BLOQUEA_A" });
  }
  return { nodoNuevo, aristasNuevas };
}
