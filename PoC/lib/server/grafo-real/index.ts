// API pública del grafo real (OpenStreetMap → vértices y aristas del grafo de
// ciudad). Orden de respaldo: caché en data/osm → snapshot versionado de
// Méndez Álvaro → Overpass en vivo → solo vértices manuales. NUNCA lanza.
//
// La ruta y fabricaInicial no pueden esperar a Overpass: si hay caché o
// snapshot se responde con eso al instante y se refresca en segundo plano
// (stale-while-revalidate). El resultado se guarda 10 min en memoria.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { distanciaM } from "@/components/mapa/geo";
import type { AristaGrafo, NodoGrafo, TipoNodo } from "@/lib/types";
import { RADIO_BASE, construirDesdeElementos, incidenciaDesdeObservacion, type OpcionesConstruccion, type Viento } from "./construir";
import { consultarOverpass, consultarOverpassDetallado, type ElementoOsm } from "./osm";
import { bboxQueAbarca, nodosCercanos, proyectar, type Bbox } from "./proyeccion";

export interface GrafoReal {
  nodos: NodoGrafo[];
  aristas: AristaGrafo[];
  origen: "overpass" | "cache" | "snapshot" | "manual";
  bbox: Bbox;
  generadoEn: string;
  resumen: Record<string, number>;
}

export interface OpcionesGrafoReal {
  radioM?: number;
  /** true para ignorar la caché en memoria y recalcular. */
  refrescar?: boolean;
  incidente?: { id: string; nombre: string };
  viento?: Viento;
}

interface ArchivoSnapshot {
  generadoEn: string;
  centro: { lat: number; lon: number };
  elementos: ElementoOsm[];
}

/** Equipamiento cercano al foco (radio corto). */
const FILTROS_CERCA = [
  'nwr["amenity"="school"]',
  'nwr["amenity"="clinic"]["name"]',
  'nwr["amenity"="doctors"]["name"]',
  'nwr["amenity"="fuel"]',
  'nwr["amenity"="community_centre"]',
  'nwr["amenity"="police"]',
  'nwr["leisure"="sports_centre"]',
  'way["highway"~"^(motorway|trunk|primary)$"]["name"]',
];
/** Infraestructura crítica: se busca más lejos porque el dominó la necesita. */
const FILTROS_LEJOS = [
  'nwr["amenity"="hospital"]',
  'nwr["amenity"="fire_station"]',
  'nwr["amenity"="social_facility"]',
  'nwr["power"="substation"]',
  'nwr["railway"="station"]',
];
/** El hospital de referencia del guion está a ~2,8 km: se pide aparte. */
const FILTROS_GREGORIO = ['nwr["amenity"="hospital"]["name"~"Gregorio Marañón"]'];

const RUTA_SNAPSHOT = join(process.cwd(), "lib", "server", "grafo-real", "snapshot-mendez-alvaro.json");
const VIGENCIA_MEMORIA_MS = 10 * 60 * 1000;
/** Un grafo casi vacío (Overpass caído y sin snapshot) se reintenta enseguida. */
const VIGENCIA_POBRE_MS = 30 * 1000;
const NODOS_MINIMOS = 8;
const RADIO_SNAPSHOT_M = 3000;

interface EntradaMemoria {
  en: number;
  grafo: GrafoReal;
}

const almacen = globalThis as typeof globalThis & {
  __cacheGrafoReal?: Map<string, EntradaMemoria>;
  __refrescosGrafoReal?: Set<string>;
  __snapshotGrafoReal?: ArchivoSnapshot | null;
  __overpassCaidoHasta?: number;
};

/** Cortacircuitos: si Overpass falla no se reintenta en 5 min (la demo no espera). */
const ESPERA_TRAS_FALLO_MS = 5 * 60 * 1000;
const overpassCaido = () => (almacen.__overpassCaidoHasta ?? 0) > Date.now();
const marcarCaido = () => {
  almacen.__overpassCaidoHasta = Date.now() + ESPERA_TRAS_FALLO_MS;
};

function memoria(): Map<string, EntradaMemoria> {
  if (!almacen.__cacheGrafoReal) almacen.__cacheGrafoReal = new Map<string, EntradaMemoria>();
  return almacen.__cacheGrafoReal;
}

function refrescosEnCurso(): Set<string> {
  if (!almacen.__refrescosGrafoReal) almacen.__refrescosGrafoReal = new Set<string>();
  return almacen.__refrescosGrafoReal;
}

/** Snapshot versionado, leído en caliente (si falta o está vacío devuelve null). */
async function leerSnapshot(): Promise<ArchivoSnapshot | null> {
  if (almacen.__snapshotGrafoReal !== undefined) return almacen.__snapshotGrafoReal;
  try {
    const bruto = JSON.parse(await readFile(RUTA_SNAPSHOT, "utf8")) as Partial<ArchivoSnapshot>;
    const elementos = Array.isArray(bruto.elementos) ? bruto.elementos : [];
    almacen.__snapshotGrafoReal =
      elementos.length > 0 && bruto.centro
        ? { generadoEn: bruto.generadoEn ?? "", centro: bruto.centro, elementos }
        : null;
  } catch {
    almacen.__snapshotGrafoReal = null;
  }
  return almacen.__snapshotGrafoReal;
}

function claveMemoria(centro: { lat: number; lon: number }, opts: OpcionesGrafoReal): string {
  const v = opts.viento ? `${Math.round(opts.viento.direccionGrados)}/${Math.round(opts.viento.velocidadKmh)}` : "-";
  return [centro.lat.toFixed(4), centro.lon.toFixed(4), Math.round(opts.radioM ?? RADIO_BASE), opts.incidente?.id ?? "-", v].join("|");
}

function resumenPorTipo(nodos: NodoGrafo[]): Record<string, number> {
  const resumen: Record<string, number> = {};
  for (const n of nodos) resumen[n.tipo] = (resumen[n.tipo] ?? 0) + 1;
  return resumen;
}

function ensamblar(
  elementos: ElementoOsm[],
  centro: { lat: number; lon: number },
  origen: GrafoReal["origen"],
  opts: OpcionesConstruccion,
): GrafoReal {
  const radioM = opts.radioM ?? RADIO_BASE;
  const base = construirDesdeElementos(elementos, centro, opts);
  // La caja se ajusta a los nodos a < 3 km del foco: los muy lejanos (el 112 de
  // Pozuelo, a 11 km) se recortan al borde en vez de aplastar el grafo local.
  const bbox = bboxQueAbarca(centro, base.nodos, radioM / 3);
  const nodos = proyectar(base.nodos, bbox);
  return { nodos, aristas: base.aristas, origen, bbox, generadoEn: new Date().toISOString(), resumen: resumenPorTipo(nodos) };
}

function fusionar(...lotes: ElementoOsm[][]): ElementoOsm[] {
  const porId = new Map<string, ElementoOsm>();
  for (const lote of lotes) for (const el of lote) porId.set(`${el.tipo}/${el.id}`, el);
  return [...porId.values()];
}

/** Descarga (o lee de caché) los tres lotes de elementos alrededor del centro. */
async function descargar(
  centro: { lat: number; lon: number },
  radioM: number,
  soloCache: boolean,
): Promise<{ elementos: ElementoOsm[]; origen: "overpass" | "cache" | "fallo" }> {
  const radioLargo = Math.round(radioM * 2.5);
  const [cerca, lejos, gregorio] = await Promise.all([
    consultarOverpassDetallado(centro, radioM, FILTROS_CERCA, { soloCache }),
    consultarOverpassDetallado(centro, radioLargo, FILTROS_LEJOS, { soloCache }),
    consultarOverpassDetallado(centro, 6000, FILTROS_GREGORIO, { soloCache }),
  ]);
  const elementos = fusionar(cerca.elementos, lejos.elementos, gregorio.elementos);
  if (elementos.length === 0) return { elementos, origen: "fallo" };
  const origenes = [cerca.origen, lejos.origen, gregorio.origen];
  return { elementos, origen: origenes.includes("overpass") ? "overpass" : "cache" };
}

/** ¿Estamos lo bastante cerca de Méndez Álvaro como para usar el snapshot? */
function cercaDe(centro: { lat: number; lon: number }, punto: { lat: number; lon: number }): boolean {
  return distanciaM([centro.lat, centro.lon], [punto.lat, punto.lon]) < RADIO_SNAPSHOT_M;
}

function refrescarEnSegundoPlano(clave: string, centro: { lat: number; lon: number }, opts: OpcionesConstruccion): void {
  const enCurso = refrescosEnCurso();
  if (enCurso.has(clave) || overpassCaido()) return;
  enCurso.add(clave);
  // setTimeout para salir del contexto de la petición: la respuesta NO espera a Overpass.
  setTimeout(() => {
    void (async () => {
      try {
        const { elementos, origen } = await descargar(centro, opts.radioM ?? RADIO_BASE, false);
        if (elementos.length > 0 && origen !== "fallo") {
          memoria().set(clave, { en: Date.now(), grafo: ensamblar(elementos, centro, origen, opts) });
        } else {
          marcarCaido();
        }
      } catch {
        marcarCaido(); // Overpass caído: seguimos con lo que ya teníamos.
      } finally {
        enCurso.delete(clave);
      }
    })();
  }, 50);
}

/**
 * Grafo real alrededor de `centro`. Responde al instante desde memoria, caché
 * de disco o snapshot y refresca Overpass en segundo plano. Nunca lanza: en el
 * peor caso devuelve el grafo manual mínimo (incidencia + vértices del guion).
 */
export async function construirGrafoReal(
  centro: { lat: number; lon: number },
  opts: OpcionesGrafoReal = {},
): Promise<GrafoReal> {
  const radioM = opts.radioM ?? RADIO_BASE;
  const construccion: OpcionesConstruccion = { ...opts, radioM };
  const clave = claveMemoria(centro, opts);

  const guardado = opts.refrescar ? undefined : memoria().get(clave);
  if (guardado) {
    const vigencia = guardado.grafo.nodos.length < NODOS_MINIMOS ? VIGENCIA_POBRE_MS : VIGENCIA_MEMORIA_MS;
    if (Date.now() - guardado.en < vigencia) return guardado.grafo;
    memoria().delete(clave);
    if (guardado.grafo.nodos.length >= NODOS_MINIMOS) {
      memoria().set(clave, guardado);
      refrescarEnSegundoPlano(clave, centro, construccion);
      return guardado.grafo;
    }
  }

  try {
    // 1) Caché en disco y 2) snapshot versionado (si el centro cae cerca de Méndez
    // Álvaro): se ensamblan ambos y gana el más completo. Una descarga parcial de
    // Overpass (consultas troceadas en las que solo alguna respondió) se cachea con
    // menos elementos que el snapshot y no debe imponerse sobre él.
    const deDisco = await descargar(centro, radioM, true);
    const snapshot = await leerSnapshot();
    const candidatos: GrafoReal[] = [];
    if (deDisco.elementos.length > 0) candidatos.push(ensamblar(deDisco.elementos, centro, "cache", construccion));
    if (snapshot && cercaDe(centro, snapshot.centro)) candidatos.push(ensamblar(snapshot.elementos, centro, "snapshot", construccion));
    if (candidatos.length > 0) {
      const grafo = candidatos.reduce((mejor, g) => (g.nodos.length > mejor.nodos.length ? g : mejor));
      if (grafo.origen === "snapshot" && deDisco.elementos.length > 0) {
        console.warn(`[grafo-real] caché de disco parcial (${candidatos[0].nodos.length} vértices) descartada a favor del snapshot (${grafo.nodos.length})`);
      }
      memoria().set(clave, { en: Date.now(), grafo });
      refrescarEnSegundoPlano(clave, centro, construccion);
      return grafo;
    }

    // 3) Overpass en vivo (primera vez en una zona nueva y sin snapshot útil).
    const enVivo = overpassCaido() && !opts.refrescar
      ? { elementos: [] as ElementoOsm[], origen: "fallo" as const }
      : await descargar(centro, radioM, false);
    if (enVivo.origen === "fallo") marcarCaido();
    const grafo =
      enVivo.elementos.length > 0
        ? ensamblar(enVivo.elementos, centro, enVivo.origen === "fallo" ? "cache" : enVivo.origen, construccion)
        : ensamblar([], centro, "manual", construccion);
    memoria().set(clave, { en: Date.now(), grafo });
    return grafo;
  } catch {
    const grafo = ensamblar([], centro, "manual", construccion);
    memoria().set(clave, { en: Date.now(), grafo });
    return grafo;
  }
}

/** Tipos del grafo real que conviene tratar como críticos en el dominó. */
export const TIPOS_REALES: TipoNodo[] = ["Residencia", "Colegio", "Subestacion", "Estacion", "Refugio", "Gasolinera"];

export { consultarOverpass, consultarOverpassDetallado, incidenciaDesdeObservacion, nodosCercanos };
export type { Bbox, ElementoOsm, Viento };
