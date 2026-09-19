// =====================================================================
// ATALAYA INCENDIOS · Repositorio (Supabase REST)
// ---------------------------------------------------------------------
// Propósito: leer/escribir el estado en Postgres sin bloquear nunca al
// motor. Todas las funciones son TOLERANTES: si no hay cliente (faltan
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) devuelven sin hacer nada y el
// que llama marca el servicio en rojo. La app sigue funcionando en memoria.
// DUEÑO: constructor A. Dependencias: @supabase/supabase-js, lib/db/schema.sql.
// =====================================================================

import type {
  Camara,
  Comunicado,
  Decision,
  Ejecucion,
  Evento,
  Incendio,
  Informe,
  Observacion,
  Poblacion,
  TrazaCiclo,
  Unidad,
} from "../dominio/tipos";
import { hostname } from "node:os";
import { Estado } from "../motor/estado";
import { obtenerClienteSupabase } from "./cliente";

/**
 * AISLAMIENTO POR INSTANCIA (2026-09-19): el proyecto Supabase lo comparten
 * varios `next dev` del equipo. Antes cada servidor recuperaba al arrancar la
 * ejecución «activa» más reciente de CUALQUIERA, y los ids deterministas
 * (`firms:…`, `exa:…`, `dgt:…`) de uno pisaban por upsert las filas del otro.
 * Ahora cada instancia marca su ejecución (`datos.instancia`), solo recupera y
 * lista las suyas, antepone su nombre al id de cada fila y guarda su propia
 * política. Nombre: `ATALAYA_INSTANCIA`; si no, el servicio de Railway (estable
 * entre despliegues) o el nombre del equipo. No se usa la IP: cambia al pasar
 * de la WiFi de la UPM al hotspot y el servidor no la conoce sin preguntar fuera.
 * Lecciones y conocimiento (RAG) siguen siendo comunes a propósito.
 */
export function nombreInstancia(): string {
  const bruto =
    process.env.ATALAYA_INSTANCIA?.trim() ||
    (process.env.RAILWAY_SERVICE_ID ? `railway-${process.env.RAILWAY_SERVICE_ID}` : "") ||
    hostname();
  return bruto.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 60) || "local";
}

/**
 * SOLO UNA INSTANCIA ESCRIBE (2026-09-19): con cuatro `next dev` volcando cada
 * tick en el mismo proyecto pequeño, la base se colapsó dos veces. Por eso la
 * ejecución (estado, trazas, informes, política) solo se guarda donde se pide:
 * `SUPABASE_PERSISTIR=1` la enciende y `=0` la apaga; sin la variable, solo
 * persiste Railway. Los demás servidores viven en memoria sin tocar la base
 * de nadie; lecciones y conocimiento se siguen leyendo de Supabase.
 */
export function persistenciaActivada(): boolean {
  const valor = process.env.SUPABASE_PERSISTIR?.trim().toLowerCase();
  if (valor) return ["1", "true", "si", "sí"].includes(valor);
  return !!process.env.RAILWAY_SERVICE_ID;
}

/** Cliente para la ejecución: null si falta configuración o esta instancia no persiste. */
function clienteEjecucion() {
  return persistenciaActivada() ? obtenerClienteSupabase() : null;
}

/** Id de la fila en la base: el de la entidad con la instancia delante. */
function idFila(id: string): string {
  return `${nombreInstancia()}/${id}`;
}

/** Tablas genéricas (id, ejecucion_id, incendio_id, datos jsonb, actualizado_en). */
export type TablaEntidad =
  | "incendios"
  | "unidades"
  | "poblaciones"
  | "observaciones"
  | "decisiones"
  | "informes"
  | "comunicados"
  | "eventos"
  | "camaras_analisis";

export interface OpcionesGuardado {
  ejecucionId: string;
  incendioId?: string;
}

/**
 * Trazas de ciclo: tabla propia porque llevan `agente_id` (las genéricas no).
 * Se guardan una sola vez, cuando el ciclo se cierra.
 */
export async function guardarTrazas(
  trazas: { traza: TrazaCiclo; agenteId: string; incendioId?: string }[],
  ejecucionId: string,
): Promise<number> {
  const cliente = clienteEjecucion();
  if (!cliente || trazas.length === 0) return 0;
  const filas = trazas.map(({ traza, agenteId, incendioId }) => ({
    id: idFila(traza.id),
    ejecucion_id: ejecucionId,
    agente_id: agenteId,
    incendio_id: incendioId ?? null,
    datos: traza,
    actualizado_en: new Date().toISOString(),
  }));
  const { error } = await cliente.from("trazas").upsert(filas, { onConflict: "id" });
  if (error) throw new Error(`trazas: ${error.message}`);
  return filas.length;
}

/** Recupera una traza ya persistida (la auditoría la busca cuando ya no está en memoria). */
export async function buscarTrazaPersistida(trazaId: string): Promise<TrazaCiclo | undefined> {
  const cliente = clienteEjecucion();
  if (!cliente) return undefined;
  const { data, error } = await cliente.from("trazas").select("datos").eq("id", idFila(trazaId)).limit(1);
  if (error) throw new Error(`trazas: ${error.message}`);
  return (data?.[0]?.datos as TrazaCiclo) ?? undefined;
}

/** Cuántas trazas e informes hay guardados de una ejecución (para /api/salud). */
export async function contarPersistidos(ejecucionId: string): Promise<{ trazas: number; informes: number }> {
  const cliente = clienteEjecucion();
  if (!cliente) return { trazas: 0, informes: 0 };
  const [t, i] = await Promise.all([
    cliente.from("trazas").select("id", { count: "exact", head: true }).eq("ejecucion_id", ejecucionId),
    cliente.from("informes").select("id", { count: "exact", head: true }).eq("ejecucion_id", ejecucionId),
  ]);
  return { trazas: t.count ?? 0, informes: i.count ?? 0 };
}

export function hayPersistencia(): boolean {
  return clienteEjecucion() !== null;
}

function fila(entidad: { id: string }, opciones: OpcionesGuardado) {
  return {
    id: idFila(entidad.id),
    ejecucion_id: opciones.ejecucionId,
    incendio_id: opciones.incendioId ?? null,
    datos: entidad,
    actualizado_en: new Date().toISOString(),
  };
}

/** Upsert de una entidad. Lanza si Supabase responde con error (el que llama decide). */
export async function guardarEntidad(tabla: TablaEntidad, entidad: { id: string }, opciones: OpcionesGuardado): Promise<void> {
  const cliente = clienteEjecucion();
  if (!cliente) return;
  const { error } = await cliente.from(tabla).upsert(fila(entidad, opciones), { onConflict: "id" });
  if (error) throw new Error(`${tabla}: ${error.message}`);
}

/** Upsert en lote (una sola petición por tabla). */
export async function guardarLote(tabla: TablaEntidad, entidades: { id: string }[], opciones: OpcionesGuardado): Promise<number> {
  const cliente = clienteEjecucion();
  if (!cliente || entidades.length === 0) return 0;
  const filas = entidades.map((e) => fila(e, { ...opciones, incendioId: (e as { incendioId?: string }).incendioId ?? opciones.incendioId }));
  const { error } = await cliente.from(tabla).upsert(filas, { onConflict: "id" });
  if (error) throw new Error(`${tabla}: ${error.message}`);
  return filas.length;
}

/**
 * Borrado en lote por id (tolerante: sin cliente no hace nada). Lo usa el
 * descarte de un foco para sus pueblos: si solo se quitaran de memoria, el
 * siguiente arranque los volvería a cargar con su riesgo viejo.
 */
export async function borrarLote(tabla: TablaEntidad, ids: string[]): Promise<number> {
  const cliente = clienteEjecucion();
  if (!cliente || ids.length === 0) return 0;
  const { error } = await cliente.from(tabla).delete().in("id", ids.map(idFila));
  if (error) throw new Error(`${tabla}: ${error.message}`);
  return ids.length;
}

export async function guardarEjecucion(ejecucion: Ejecucion): Promise<void> {
  const cliente = clienteEjecucion();
  if (!cliente) return;
  const { error } = await cliente.from("ejecuciones").upsert(
    {
      id: ejecucion.id,
      nombre: ejecucion.nombre,
      inicio: ejecucion.inicio,
      fin: ejecucion.fin ?? null,
      estado: ejecucion.estado,
      metricas: ejecucion.metricas,
      comparativa: ejecucion.comparativa ?? null,
      datos: { ...ejecucion, instancia: nombreInstancia() },
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(`ejecuciones: ${error.message}`);
}

export async function listarEjecuciones(limite = 20): Promise<Ejecucion[]> {
  const cliente = clienteEjecucion();
  if (!cliente) return [];
  const { data, error } = await cliente
    .from("ejecuciones")
    .select("datos")
    .eq("datos->>instancia", nombreInstancia())
    .order("inicio", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`ejecuciones: ${error.message}`);
  return (data ?? []).map((f) => f.datos as Ejecucion).filter(Boolean);
}

/**
 * Carga una tabla de la ejecución, LO MÁS RECIENTE PRIMERO y con tope.
 * RENDIMIENTO (constructor S, 2026-09-19): antes se traían hasta 5000 filas por
 * tabla sin ordenar, así que un reinicio metía en RAM decenas de miles de
 * entidades (incluidos informes con el Markdown entero) y elegía cuáles por
 * azar. Lo que no entre sigue en Supabase y se consulta por su ruta.
 */
async function cargarTabla<T>(tabla: TablaEntidad, ejecucionId: string, limite = 1000): Promise<T[]> {
  const cliente = clienteEjecucion();
  if (!cliente) return [];
  const { data, error } = await cliente
    .from(tabla)
    .select("datos")
    .eq("ejecucion_id", ejecucionId)
    .order("actualizado_en", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`${tabla}: ${error.message}`);
  return (data ?? []).map((f) => f.datos as T).filter(Boolean);
}

/**
 * Rehidrata el estado de la ejecución activa (sobrevive a un reinicio de
 * Railway). Devuelve undefined si no hay cliente o no hay ejecución activa.
 */
export async function cargarEjecucionActiva(): Promise<Estado | undefined> {
  const cliente = clienteEjecucion();
  if (!cliente) return undefined;
  const { data, error } = await cliente
    .from("ejecuciones")
    .select("datos")
    .eq("estado", "activa")
    .eq("datos->>instancia", nombreInstancia())
    .order("inicio", { ascending: false })
    .limit(1);
  if (error) throw new Error(`ejecuciones: ${error.message}`);
  const ejecucion = data?.[0]?.datos as Ejecucion | undefined;
  if (!ejecucion?.id) return undefined;

  const estado = new Estado(ejecucion);
  const [incendios, unidades, poblaciones, observaciones, decisiones, informes, comunicados, eventos] = await Promise.all([
    // Topes alineados con la poda de memoria del orquestador (MEMORIA_MAX_*).
    cargarTabla<Incendio>("incendios", ejecucion.id, 500),
    cargarTabla<Unidad>("unidades", ejecucion.id, 1000),
    cargarTabla<Poblacion>("poblaciones", ejecucion.id, 1000),
    cargarTabla<Observacion>("observaciones", ejecucion.id, 500),
    cargarTabla<Decision>("decisiones", ejecucion.id, 300),
    cargarTabla<Informe>("informes", ejecucion.id, 200),
    cargarTabla<Comunicado>("comunicados", ejecucion.id, 200),
    cargarTabla<Evento>("eventos", ejecucion.id, 1000),
  ]);
  for (const i of incendios) estado.incendios.set(i.id, i);
  for (const u of unidades) estado.unidades.set(u.id, u);
  for (const p of poblaciones) estado.poblaciones.set(p.id, p);
  for (const o of observaciones) estado.observaciones.set(o.id, o);
  for (const d of decisiones) estado.decisiones.set(d.id, d);
  for (const inf of informes) estado.informes.set(inf.id, inf);
  for (const c of comunicados) estado.comunicados.set(c.id, c);
  estado.eventos = eventos.sort((a, b) => a.en.localeCompare(b.en));

  // Política vigente, si se guardó
  const { data: pol } = await cliente.from("politica").select("datos").eq("id", idFila("vigente")).limit(1);
  // Solo se respeta la política guardada si la editó una persona: la de "sistema" es una copia
  // antigua de la de fábrica y pisaría los cambios de lib/dominio/politica-defecto.ts.
  const politicaGuardada = pol?.[0]?.datos as typeof estado.politica | undefined;
  if (politicaGuardada && politicaGuardada.actualizadaPor && politicaGuardada.actualizadaPor !== "sistema") estado.politica = politicaGuardada;

  return estado;
}

/** Guarda la política vigente (la edita el humano desde /politica). */
export async function guardarPolitica(politica: unknown): Promise<void> {
  const cliente = clienteEjecucion();
  if (!cliente) return;
  const { error } = await cliente.from("politica").upsert({ id: idFila("vigente"), datos: politica, actualizada_en: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(`politica: ${error.message}`);
}

/** Vuelca TODO el estado vivo (al cerrar la ejecución o desde scripts). */
export async function volcarTodo(estado: Estado): Promise<void> {
  if (!hayPersistencia()) return;
  const opciones: OpcionesGuardado = { ejecucionId: estado.ejecucion.id };
  const camarasConAnalisis: Camara[] = [...estado.camaras.values()].filter((c) => !!c.ultimoAnalisis);
  await Promise.all([
    guardarLote("incendios", [...estado.incendios.values()], opciones),
    guardarLote("unidades", [...estado.unidades.values()], opciones),
    guardarLote("poblaciones", [...estado.poblaciones.values()], opciones),
    guardarLote("observaciones", [...estado.observaciones.values()], opciones),
    guardarLote("decisiones", [...estado.decisiones.values()], opciones),
    guardarLote("informes", [...estado.informes.values()], opciones),
    guardarLote("comunicados", [...estado.comunicados.values()], opciones),
    guardarLote("camaras_analisis", camarasConAnalisis, opciones),
  ]);
  await guardarPolitica(estado.politica);
  await guardarEjecucion(estado.ejecucion);
}
