// =====================================================================
// Entorno OSM de un incendio vía Overpass. DUEÑO: constructor B.
// ---------------------------------------------------------------------
// Verificado hoy (docs/investigacion-fuentes-datos.md §5.1):
//   POST https://overpass-api.de/api/interpreter  (User-Agent OBLIGATORIO:
//   sin él devuelve 406). Alternativa sin límite de slots:
//   https://overpass.kumi.systems/api/interpreter
//   Radio 30 km en Ávila: 275 elementos, 113 KB, 4,4 s.
//
// TRES consultas SEPARADAS (constructor M, 2026-09-19). Antes eran dos y los
// pueblos viajaban con los parques: si la consulta gorda fallaba o tardaba, el
// foco se quedaba SIN unidades Y SIN pueblos a la vez, y el ataque inicial no
// salía. Ahora cada una falla y se cachea por su cuenta:
//   1) PUEBLOS    `out center tags`: places + ayuntamientos (de donde sale el
//      teléfono de cada pueblo). Medido: 2,5-5,3 s en 30 km.
//   2) MEDIOS     `out center tags`: bomberos, policía, hospitales, centros de
//      salud, colegios, residencias, campings y puntos de agua. De aquí salen
//      LAS UNIDADES, así que es la que se pide PRIMERO. Medido: 3,7-7,4 s.
//   3) SUPERFICIES `out geom` en 5 km: polígonos de combustible. La fracción
//      de cada tipo se calcula sumando el ÁREA APROXIMADA de cada polígono
//      (fórmula del cordón de zapato sobre una proyección equirrectangular
//      local: exacta a estas escalas) y normalizando. Si no sale ningún
//      polígono con geometría se recurre a contar elementos.
// Caché en memoria por (clave redondeada, radio); el mundo físico no cambia
// durante la demo. Si ambos servidores fallan se LANZA el error.
// =====================================================================
import type { Combustible, Hospital, Poblacion, Punto, TipoUnidad } from "../dominio/tipos";
import { haversine } from "./geo";

export type PoblacionBase = Pick<Poblacion, "id" | "nombre" | "centro" | "tipo" | "habitantes" | "municipio" | "telefono" | "email">;
export interface BaseMedios { id: string; nombre: string; punto: Punto; tipo: TipoUnidad; telefono?: string }
export interface EntornoIncendio {
  poblaciones: PoblacionBase[];
  parquesBomberos: BaseMedios[];
  policia: BaseMedios[];
  hospitales: Hospital[];
  vulnerables: { tipo: string; nombre: string; punto: Punto }[];
  aguas: { nombre: string; punto: Punto }[];
  combustible: Combustible;
  url: string;
}

// MEDIDO 2026-09-19 por el constructor M, desde la red de la demo:
//   overpass-api.de  → **CONNECTION REFUSED** en las dos IP (65.109.112.52 y
//                      162.55.144.139). Ni DNS ni firewall local: el servidor
//                      rechaza la conexión. Es la causa raíz de los fallos
//                      (a), (b), (f) y (g) de la última pasada de integración.
//   kumi.systems     → conecta pero no responde (>60 s) a ninguna consulta.
//   private.coffee   → 504 a los 32 s en la consulta pequeña; >90 s en las grandes.
//   osm.ch           → responde 200 en 0,4 s pero con la BASE DE DATOS VACÍA
//                      (`timestamp_osm_base: "117119"`, `elements: []`). Es el
//                      peor caso posible: parece que funciona y devuelve cero
//                      pueblos. Por eso `validar()` rechaza toda respuesta cuyo
//                      `timestamp_osm_base` no sea una fecha reciente.
//   maps.mail.ru     → 200 con datos reales: pueblos 2,5-5,3 s · medios 3,7-7,4 s
//                      · superficies 2,6 s. Es el único espejo sano hoy.
// Se conserva overpass-api.de el PRIMERO (es el de referencia y cuando vuelve
// es el mejor): cuando está caído falla en 0,2 s, así que no cuesta nada.
const SERVIDORES = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const UA = "atalaya-incendios/1.0 (HackSpain 2026; contacto javimorgalis@gmail.com)";
/** Tope por consulta. Ninguna consulta sana pasa de 8 s: a 25 s ya es un servidor roto. */
const TIMEOUT_MS = 25_000;
/** Vueltas completas a la lista de servidores, con retroceso entre ellas. */
const VUELTAS = 2;
const RETROCESO_MS = 2_000;
const RADIO_COMBUSTIBLE_KM = 5;

interface ElementoOsm {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

// Caché por CELDA y por tipo de consulta: la clave redondea a 0,01° (~1 km),
// así que dos focos del mismo valle comparten entorno y no repiten la consulta.
// Cada tipo se cachea por separado para que el fallo de una no invalide a las otras.
type Global = typeof globalThis & { __atalayaOverpassCeldas?: Map<string, { en: number; datos: unknown }> };
const g = globalThis as Global;
const celdas = () => (g.__atalayaOverpassCeldas ??= new Map());
const CACHE_MS = 6 * 60 * 60_000;

/** Envuelve una consulta con caché por celda. */
async function cacheado<T>(tipo: string, centro: Punto, radioKm: number, calcular: () => Promise<T>): Promise<T> {
  const clave = `${tipo}|${centro.lat.toFixed(2)},${centro.lon.toFixed(2)}@${Math.round(radioKm)}`;
  const c = celdas().get(clave);
  if (c && Date.now() - c.en < CACHE_MS) return c.datos as T;
  const datos = await calcular();
  celdas().set(clave, { en: Date.now(), datos });
  return datos;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Rechaza a los espejos que responden 200 con una base de datos vacía o
 * congelada (caso real: overpass.osm.ch devuelve `timestamp_osm_base:"117119"`
 * y cero elementos). Una respuesta así es PEOR que un error: se tomaría por
 * buena y el foco se quedaría sin pueblos ni parques sin que nadie lo note.
 */
function validar(j: { elements?: ElementoOsm[]; osm3s?: { timestamp_osm_base?: string } }): ElementoOsm[] {
  const sello = j.osm3s?.timestamp_osm_base;
  const t = sello ? Date.parse(sello) : NaN;
  if (!Number.isFinite(t)) throw new Error(`respuesta sin sello de base válido (timestamp_osm_base="${sello ?? "—"}"): espejo no fiable`);
  const dias = (Date.now() - t) / 86_400_000;
  if (dias > 30) throw new Error(`base de datos desfasada ${Math.round(dias)} días (${sello}): espejo no fiable`);
  return j.elements ?? [];
}

/**
 * Lanza la consulta contra los servidores por orden hasta que uno responda.
 * Dos vueltas completas con retroceso: un 429 o un corte de red puntual no
 * puede dejar un foco sin entorno.
 */
async function consultar(query: string, etiqueta: string): Promise<{ elementos: ElementoOsm[]; url: string }> {
  let ultimo: unknown;
  for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
    for (const url of SERVIDORES) {
      const t0 = Date.now();
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain; charset=utf-8", "User-Agent": UA, Accept: "application/json" },
          body: query,
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const elementos = validar((await res.json()) as { elements?: ElementoOsm[]; osm3s?: { timestamp_osm_base?: string } });
        console.log(`[overpass] ${etiqueta} · ${new URL(url).host} · ${Date.now() - t0} ms · ${elementos.length} elementos`);
        return { elementos, url };
      } catch (e) {
        ultimo = e;
        console.warn(`[overpass] ${etiqueta} falló en ${new URL(url).host} tras ${Date.now() - t0} ms:`, e instanceof Error ? e.message : e);
      }
    }
    if (vuelta < VUELTAS - 1) await dormir(RETROCESO_MS * (vuelta + 1));
  }
  throw new Error(`Overpass no disponible en ningún servidor (${etiqueta}): ${ultimo instanceof Error ? ultimo.message : ultimo}`);
}

const punto = (e: ElementoOsm): Punto | undefined => {
  const lat = e.lat ?? e.center?.lat;
  const lon = e.lon ?? e.center?.lon;
  return typeof lat === "number" && typeof lon === "number" ? { lat, lon } : undefined;
};
const idDe = (e: ElementoOsm) => `osm:${e.type}/${e.id}`;
const telefonoDe = (t: Record<string, string> = {}) => t["phone"] ?? t["contact:phone"] ?? t["contact:mobile"] ?? undefined;
const emailDe = (t: Record<string, string> = {}) => t["email"] ?? t["contact:email"] ?? undefined;

const TIPO_PLACE: Record<string, PoblacionBase["tipo"]> = {
  city: "ciudad",
  town: "pueblo",
  village: "pueblo",
  hamlet: "aldea",
};

/** Área aproximada de un anillo en m² (cordón de zapato en proyección local). */
function areaM2(geom: { lat: number; lon: number }[]): number {
  if (!geom || geom.length < 3) return 0;
  const lat0 = (geom[0].lat * Math.PI) / 180;
  const mLon = 111_320 * Math.cos(lat0);
  const mLat = 110_540;
  let s = 0;
  for (let i = 0; i < geom.length; i++) {
    const a = geom[i];
    const b = geom[(i + 1) % geom.length];
    s += (a.lon * mLon) * (b.lat * mLat) - (b.lon * mLon) * (a.lat * mLat);
  }
  return Math.abs(s) / 2;
}

function clasificarCombustible(t: Record<string, string> = {}): keyof Omit<Combustible, "dominante"> | undefined {
  if (t.landuse === "forest" || t.natural === "wood") return "bosque";
  if (t.natural === "scrub" || t.natural === "heath") return "matorral";
  if (t.natural === "grassland" || t.landuse === "meadow") return "pasto";
  if (t.landuse === "farmland" || t.landuse === "orchard" || t.landuse === "vineyard") return "agricola";
  if (t.landuse === "residential") return "urbano";
  return undefined;
}

const alrededor = (c: Punto, radioM: number) => `(around:${radioM},${c.lat.toFixed(5)},${c.lon.toFixed(5)})`;

/** (1) Pueblos + ayuntamientos: de aquí salen las POBLACIONES y sus teléfonos. */
function consultaPueblos(c: Punto, radioM: number): string {
  const a = alrededor(c, radioM);
  return `[out:json][timeout:25][maxsize:67108864];
(
  node["place"~"^(city|town|village|hamlet)$"]${a};
  nwr["amenity"="townhall"]${a};
);
out center tags;`;
}

/** (2) Medios y puntos sensibles: de aquí salen las UNIDADES (parques, policía, hospitales). */
function consultaMedios(c: Punto, radioM: number): string {
  const a = alrededor(c, radioM);
  // Un solo `nwr` con expresión regular para los amenity: agrupar baja el
  // tiempo de 14 s a 4-7 s frente a una línea por etiqueta (medido).
  return `[out:json][timeout:25][maxsize:67108864];
(
  nwr["amenity"~"^(fire_station|police|hospital|clinic|doctors|school|kindergarten)$"]${a};
  nwr["social_facility"]${a};
  nwr["tourism"="camp_site"]${a};
  nwr["man_made"="water_tower"]${a};
  nwr["landuse"="reservoir"]${a};
);
out center tags;`;
}

/** (3) Superficies de combustible en 5 km. */
function consultaSuperficies(c: Punto, radioM: number): string {
  const a = alrededor(c, radioM);
  return `[out:json][timeout:25][maxsize:67108864];
(
  way["landuse"~"^(forest|farmland|orchard|vineyard|meadow|residential)$"]${a};
  way["natural"~"^(wood|scrub|heath|grassland)$"]${a};
);
out geom;`;
}

function combustibleDe(elementos: ElementoOsm[]): Combustible {
  const areas = { bosque: 0, matorral: 0, pasto: 0, agricola: 0, urbano: 0 };
  const cuentas = { ...areas };
  for (const e of elementos) {
    const clase = clasificarCombustible(e.tags);
    if (!clase) continue;
    cuentas[clase] += 1;
    areas[clase] += areaM2(e.geometry ?? []);
  }
  const totalArea = Object.values(areas).reduce((a, b) => a + b, 0);
  const totalCuenta = Object.values(cuentas).reduce((a, b) => a + b, 0);
  const base = totalArea > 0 ? areas : cuentas;
  const total = totalArea > 0 ? totalArea : totalCuenta;
  if (total <= 0) {
    // Sin datos OSM de uso del suelo: no inventamos: matorral/pasto a partes iguales
    // es una suposición, así que devolvemos ceros y dominante "pasto" (el más neutro).
    return { bosque: 0, matorral: 0, pasto: 0, agricola: 0, urbano: 0, dominante: "pasto" };
  }
  const f = {
    bosque: +(base.bosque / total).toFixed(3),
    matorral: +(base.matorral / total).toFixed(3),
    pasto: +(base.pasto / total).toFixed(3),
    agricola: +(base.agricola / total).toFixed(3),
    urbano: +(base.urbano / total).toFixed(3),
  };
  const dominante = (Object.entries(f).sort((a, b) => b[1] - a[1])[0][0]) as Combustible["dominante"];
  return { ...f, dominante };
}

// ---------------------------------------------------------------------
// Las tres consultas, cada una cacheada e independiente de las demás
// ---------------------------------------------------------------------

export interface PueblosCercanos { poblaciones: PoblacionBase[]; url: string }
export interface MediosCercanos {
  parquesBomberos: BaseMedios[];
  policia: BaseMedios[];
  hospitales: Hospital[];
  vulnerables: { tipo: string; nombre: string; punto: Punto }[];
  aguas: { nombre: string; punto: Punto }[];
  url: string;
}

/**
 * (1) Poblaciones del radio, ya ordenadas por distancia y con el teléfono del
 * ayuntamiento más cercano (≤ 3 km) cuando OSM lo tiene.
 */
export function poblacionesCercanas(centro: Punto, radioKm: number): Promise<PueblosCercanos> {
  return cacheado("pueblos", centro, radioKm, async () => {
    const radioM = Math.round(Math.max(1, Math.min(60, radioKm)) * 1000);
    const { elementos, url } = await consultar(consultaPueblos(centro, radioM), `pueblos ${radioKm} km`);

    const ayuntamientos: { punto: Punto; nombre: string; telefono?: string; email?: string }[] = [];
    const poblaciones: PoblacionBase[] = [];
    for (const e of elementos) {
      const t = e.tags ?? {};
      const p = punto(e);
      if (!p) continue;
      const nombre = t.name ?? t["official_name"] ?? "";
      if (t.amenity === "townhall") {
        ayuntamientos.push({ punto: p, nombre: nombre || "Ayuntamiento", telefono: telefonoDe(t), email: emailDe(t) });
        continue;
      }
      if (t.place && TIPO_PLACE[t.place] && nombre) {
        const hab = Number(t.population);
        poblaciones.push({
          id: idDe(e),
          nombre,
          centro: p,
          tipo: TIPO_PLACE[t.place],
          habitantes: Number.isFinite(hab) ? hab : undefined,
          municipio: t["is_in:municipality"] ?? undefined,
        });
      }
    }

    // Teléfono del ayuntamiento más cercano a cada pueblo (≤ 3 km).
    for (const pob of poblaciones) {
      let mejor: { d: number; a: (typeof ayuntamientos)[number] } | undefined;
      for (const a of ayuntamientos) {
        const d = haversine(pob.centro, a.punto);
        if (d <= 3 && (!mejor || d < mejor.d)) mejor = { d, a };
      }
      if (mejor) {
        pob.telefono = mejor.a.telefono;
        pob.email = mejor.a.email;
      }
    }
    poblaciones.sort((a, b) => haversine(centro, a.centro) - haversine(centro, b.centro));
    return { poblaciones, url };
  });
}

/** (2) Parques, policía, hospitales, puntos vulnerables y puntos de agua del radio. */
export function mediosCercanos(centro: Punto, radioKm: number): Promise<MediosCercanos> {
  return cacheado("medios", centro, radioKm, async () => {
    const radioM = Math.round(Math.max(1, Math.min(60, radioKm)) * 1000);
    const { elementos, url } = await consultar(consultaMedios(centro, radioM), `medios ${radioKm} km`);

    const parquesBomberos: BaseMedios[] = [];
    const policia: BaseMedios[] = [];
    const hospitales: Hospital[] = [];
    const vulnerables: { tipo: string; nombre: string; punto: Punto }[] = [];
    const aguas: { nombre: string; punto: Punto }[] = [];

    for (const e of elementos) {
      const t = e.tags ?? {};
      const p = punto(e);
      if (!p) continue;
      const nombre = t.name ?? t["official_name"] ?? "";

      if (t.amenity === "fire_station") {
        parquesBomberos.push({ id: idDe(e), nombre: nombre || "Parque de bomberos", punto: p, tipo: "bomberos", telefono: telefonoDe(t) });
        continue;
      }
      if (t.amenity === "police") {
        const esGuardiaCivil = /guardia civil/i.test(`${nombre} ${t.operator ?? ""}`);
        policia.push({
          id: idDe(e),
          nombre: nombre || "Puesto de policía",
          punto: p,
          tipo: esGuardiaCivil ? "guardia_civil" : "policia",
          telefono: telefonoDe(t),
        });
        continue;
      }
      if (t.amenity === "hospital" || t.amenity === "clinic" || t.amenity === "doctors") {
        hospitales.push({
          id: idDe(e),
          nombre: nombre || (t.amenity === "hospital" ? "Hospital" : "Centro de salud"),
          punto: p,
          tipo: t.amenity === "hospital" ? "hospital" : "centro_salud",
          telefono: telefonoDe(t),
          distanciaKm: +haversine(centro, p).toFixed(2),
        });
        continue;
      }
      if (t.amenity === "school" || t.amenity === "kindergarten") {
        vulnerables.push({ tipo: "colegio", nombre: nombre || "Centro educativo", punto: p });
        continue;
      }
      if (t.social_facility) {
        const residencia = /nursing_home|assisted_living|group_home/.test(t.social_facility);
        vulnerables.push({ tipo: residencia ? "residencia" : "centro social", nombre: nombre || "Centro social", punto: p });
        continue;
      }
      if (t.tourism === "camp_site") {
        vulnerables.push({ tipo: "camping", nombre: nombre || "Camping", punto: p });
        continue;
      }
      if (t.man_made === "water_tower" || t.landuse === "reservoir" || t.natural === "water") {
        aguas.push({ nombre: nombre || (t.man_made === "water_tower" ? "Depósito de agua" : "Masa de agua"), punto: p });
      }
    }

    hospitales.sort((a, b) => (a.distanciaKm ?? 0) - (b.distanciaKm ?? 0));
    parquesBomberos.sort((a, b) => haversine(centro, a.punto) - haversine(centro, b.punto));
    policia.sort((a, b) => haversine(centro, a.punto) - haversine(centro, b.punto));
    aguas.sort((a, b) => haversine(centro, a.punto) - haversine(centro, b.punto));

    return { parquesBomberos, policia, hospitales, vulnerables, aguas: aguas.slice(0, 60), url };
  });
}

/** (3) Combustible dominante en 5 km a partir de los polígonos de uso del suelo. */
export function combustibleCercano(centro: Punto): Promise<Combustible> {
  return cacheado("combustible", centro, RADIO_COMBUSTIBLE_KM, async () => {
    const { elementos } = await consultar(consultaSuperficies(centro, RADIO_COMBUSTIBLE_KM * 1000), "superficies 5 km");
    return combustibleDe(elementos);
  });
}

/**
 * Entorno completo del incendio (las tres consultas EN SERIE). Se conserva
 * para /api/fuentes/entorno y para quien quiera todo de golpe; el
 * enriquecimiento del motor usa las tres funciones por separado para no
 * hacer esperar al ataque inicial.
 */
export async function entornoIncendio(centro: Punto, radioKm: number): Promise<EntornoIncendio> {
  // EN SERIE a propósito: overpass-api.de solo da 2 slots por IP y en paralelo
  // con otras sesiones devuelve 429.
  const medios = await mediosCercanos(centro, radioKm);
  const pueblos = await poblacionesCercanas(centro, radioKm);
  const combustible = await combustibleCercano(centro).catch((e) => {
    console.warn("[overpass] superficies falló, combustible sin datos:", e instanceof Error ? e.message : e);
    return combustibleDe([]);
  });
  return {
    poblaciones: pueblos.poblaciones,
    parquesBomberos: medios.parquesBomberos,
    policia: medios.policia,
    hospitales: medios.hospitales,
    vulnerables: medios.vulnerables,
    aguas: medios.aguas,
    combustible,
    url: medios.url || pueblos.url,
  };
}
