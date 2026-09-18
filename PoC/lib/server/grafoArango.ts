// ProveedorGrafo sobre ArangoDB (Ciudad_Graph), en local con Docker
// (`docker run -p 8529:8529 arangodb:3.12`). Si ARANGO_URL no está definida o la
// base no responde, el motor usa GrafoMemoria (misma interfaz) y lo muestra en
// estado.origenGrafo = "memoria"; el fallo se registra en el log, no se oculta.

import { Database, aql } from "arangojs";
import type { AristaGrafo, ImpactoDomino, NodoGrafo } from "../types";
import { GrafoMemoria, type ProveedorGrafo } from "./grafo";

const env = (k: string) => process.env[k]?.trim() || undefined;
export const arangoConfigurado = () => Boolean(env("ARANGO_URL"));

const cacheDomino = new Map<string, ImpactoDomino[]>();

type G = typeof globalThis & { __crisisArango?: Database; __crisisArangoDbOk?: boolean };
function db(): Database {
  const g = globalThis as G;
  if (!g.__crisisArango) {
    g.__crisisArango = new Database({ url: env("ARANGO_URL")!, databaseName: env("ARANGO_DB") || "crisis", auth: { username: env("ARANGO_USER") || "root", password: env("ARANGO_PASSWORD") || "" } });
  }
  return g.__crisisArango;
}

/** Crea la base de datos si no existe (una instancia recién levantada en Docker solo trae `_system`). */
async function asegurarBaseDeDatos(): Promise<void> {
  const g = globalThis as G;
  if (g.__crisisArangoDbOk) return;
  const nombre = env("ARANGO_DB") || "crisis";
  const sistema = new Database({ url: env("ARANGO_URL")!, databaseName: "_system", auth: { username: env("ARANGO_USER") || "root", password: env("ARANGO_PASSWORD") || "" } });
  try {
    const existentes = await sistema.listDatabases();
    if (!existentes.includes(nombre)) {
      await sistema.createDatabase(nombre);
      console.info(`[arango] base de datos ${nombre} creada`);
    }
    g.__crisisArangoDbOk = true;
  } finally {
    sistema.close();
  }
}

/** Crea colecciones, grafo y carga los vértices/aristas si están vacíos (o siempre, con forzar). Guarda lat/lon/subtipo/origen y geo [lon, lat] con índice geo. */
export async function sembrarArango(nodos: NodoGrafo[], aristas: AristaGrafo[], opts: { forzar?: boolean } = {}) {
  await asegurarBaseDeDatos();
  const d = db();
  for (const c of ["Incidencias", "Infraestructuras", "Efectivos"]) {
    const col = d.collection(c);
    if (!(await col.exists())) await col.create();
  }
  const edges = d.collection("Relaciones");
  if (!(await edges.exists())) await edges.create({ type: 3 });
  const graph = d.graph("Ciudad_Graph");
  if (!(await graph.exists())) {
    await graph.create([{ collection: "Relaciones", from: ["Incidencias", "Infraestructuras", "Efectivos"], to: ["Incidencias", "Infraestructuras", "Efectivos"] }]);
  }
  const n = (await (await d.query(aql`RETURN LENGTH(Relaciones)`)).next()) as number;
  if (n > 0 && !opts.forzar) return;
  if (opts.forzar) {
    for (const c of ["Incidencias", "Infraestructuras", "Efectivos", "Relaciones"]) await d.collection(c).truncate();
    cacheDomino.clear();
  }
  for (const c of ["Incidencias", "Infraestructuras", "Efectivos"]) {
    await d.collection(c).ensureIndex({ type: "geo", fields: ["geo"], geoJson: false }).catch(() => undefined);
  }
  for (const v of nodos) {
    const [col, key] = v.id.split("/");
    const doc: Record<string, unknown> = { _key: key, nombre: v.nombre, tipo: v.tipo, x: v.x, y: v.y, subtipo: v.subtipo, origen: v.origen, osmId: v.osmId, detalle: v.detalle };
    if (typeof v.lat === "number" && typeof v.lon === "number") Object.assign(doc, { lat: v.lat, lon: v.lon, geo: [v.lat, v.lon] });
    await d.collection(col).save(doc, { overwriteMode: "replace" });
  }
  for (const a of aristas) await edges.save({ _from: a.from, _to: a.to, tipo: a.tipo });
}

export class GrafoArango implements ProveedorGrafo {
  constructor(private readonly nodosCache: NodoGrafo[], private readonly aristasCache: AristaGrafo[]) {}
  nodos() {
    return this.nodosCache;
  }
  aristas() {
    return this.aristasCache;
  }
  vecinosDesplegados(nodoId: string) {
    return new GrafoMemoria(this.nodosCache, this.aristasCache).vecinosDesplegados(nodoId);
  }
  /** Versión síncrona exigida por la interfaz: usa el último resultado de la query AQL (ver impactoDominoAsync). */
  impactoDomino(incidenteId: string): ImpactoDomino[] {
    return cacheDomino.get(incidenteId) ?? new GrafoMemoria(this.nodosCache, this.aristasCache).impactoDomino(incidenteId);
  }
}

/** Query AQL de la spec (docs/spec.md §3). Guarda el resultado para impactoDomino(). */
export async function impactoDominoAsync(incidenteId: string, profundidad = 3): Promise<ImpactoDomino[]> {
  const d = db();
  const cursor = await d.query(aql`
    FOR v, e, p IN 1..${profundidad} OUTBOUND ${incidenteId} GRAPH 'Ciudad_Graph'
      FILTER e.tipo != 'DESPLEGADO_EN'
      FILTER v.tipo IN ['Hospital', 'Centro_Comunicaciones', 'Ruta_Evacuacion', 'Residencia', 'Colegio', 'Subestacion', 'Estacion']
      LET nivel_gravedad = (4 - LENGTH(p.edges)) * 25
      SORT nivel_gravedad DESC
      RETURN { infraestructura: v.nombre, riesgo: nivel_gravedad, ruta: p.vertices[*].nombre }
  `);
  const filas = (await cursor.all()) as ImpactoDomino[];
  cacheDomino.set(incidenteId, filas);
  return filas;
}

/** Devuelve el proveedor real si Arango responde; si no, memoria. */
export async function proveedorGrafo(nodos: NodoGrafo[], aristas: AristaGrafo[], incidenteId: string): Promise<{ grafo: ProveedorGrafo; origen: "ArangoDB" | "memoria" }> {
  if (!arangoConfigurado()) return { grafo: new GrafoMemoria(nodos, aristas), origen: "memoria" };
  try {
    await sembrarArango(nodos, aristas);
    await impactoDominoAsync(incidenteId);
    return { grafo: new GrafoArango(nodos, aristas), origen: "ArangoDB" };
  } catch (err) {
    console.warn("[arango] no disponible, uso grafo en memoria:", err instanceof Error ? err.message : err);
    return { grafo: new GrafoMemoria(nodos, aristas), origen: "memoria" };
  }
}
