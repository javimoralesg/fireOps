// =====================================================================
// Trazas de ciclo por agente (CONTRATO). Dueño: sesión orquestadora.
// El orquestador (A) envuelve cada ciclo con `ejecutarConTraza`; el
// acceso al LLM (C) llama a `anotarLlamadaIA` tras cada petición; los
// visores de agentes (E) muestran `EstadoAgenteApp.trazas`.
// AsyncLocalStorage propaga el agente actual sin pasar parámetros.
// =====================================================================

import { AsyncLocalStorage } from "node:async_hooks";
import type { LlamadaIA, TrazaCiclo } from "../dominio/tipos";
import { buscarAgenteCompatibleEnMapa, resolverIdAgenteCompatible } from "../agentes/identidad";
import type { Estado } from "./estado";
import { nuevoId } from "./ids";

export const MAX_TRAZAS = 20;

interface ContextoTraza {
  agenteId: string;
  traza: TrazaCiclo;
  estado: Estado;
}

const almacen = new AsyncLocalStorage<ContextoTraza>();

/** Devuelve el agente cuyo ciclo está en curso en este hilo asíncrono (undefined fuera de un ciclo). */
export function agenteActual(): string | undefined {
  return almacen.getStore()?.agenteId;
}

/**
 * Traza del ciclo en curso (undefined fuera de un ciclo). La usa el orquestador
 * para sellar cada decisión con `trazaId` y poder auditar qué vio y qué pensó
 * el agente que la propuso. (Añadido por el constructor A con autorización.)
 */
export function trazaActual(): TrazaCiclo | undefined {
  return almacen.getStore()?.traza;
}

function publicar(ctx: ContextoTraza): void {
  const idOperativo = resolverIdAgenteCompatible(ctx.estado.agentes, ctx.agenteId);
  const agente = buscarAgenteCompatibleEnMapa(ctx.estado.agentes, ctx.agenteId);
  if (!agente || !idOperativo) return;
  const otras = (agente.trazas ?? []).filter((t) => t.id !== ctx.traza.id);
  const trazas = [...otras, { ...ctx.traza, llamadasIA: [...ctx.traza.llamadasIA] }].slice(-MAX_TRAZAS);
  ctx.estado.actualizar(ctx.estado.agentes, idOperativo, { trazas });
}

/**
 * Ejecuta `fn` dentro de una traza nueva del agente. Publica la traza al empezar
 * (estado en_curso) y al terminar (ok/error) en `estado.agentes[id].trazas`.
 */
export async function ejecutarConTraza<T>(
  estado: Estado,
  agenteId: string,
  motivo: string,
  fn: (traza: TrazaCiclo) => Promise<T>,
): Promise<T> {
  const traza: TrazaCiclo = {
    id: nuevoId("traza"),
    inicio: new Date().toISOString(),
    estado: "en_curso",
    motivo,
    llamadasIA: [],
    decisiones: [],
    observaciones: [],
    eventos: 0,
  };
  const ctx: ContextoTraza = { agenteId, traza, estado };
  publicar(ctx);
  const t0 = Date.now();
  try {
    const r = await almacen.run(ctx, () => fn(traza));
    traza.estado = "ok";
    return r;
  } catch (e) {
    traza.estado = e instanceof Error && e.name === "AbortError" ? "cancelado" : "error";
    traza.error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    traza.fin = new Date().toISOString();
    traza.duracionMs = Date.now() - t0;
    publicar(ctx);
  }
}

/** Anota una llamada a un modelo de IA en la traza del ciclo en curso (no hace nada fuera de un ciclo). */
export function anotarLlamadaIA(llamada: Omit<LlamadaIA, "en">): void {
  const ctx = almacen.getStore();
  if (!ctx) return;
  ctx.traza.llamadasIA.push({ en: new Date().toISOString(), ...llamada });
  if (ctx.traza.llamadasIA.length > 30) ctx.traza.llamadasIA.splice(0, ctx.traza.llamadasIA.length - 30);
  publicar(ctx);
}

/** Completa datos de la traza en curso (entradas, resumen, ids producidos). */
export function anotarTraza(cambios: Partial<Pick<TrazaCiclo, "entradas" | "resumen" | "decisiones" | "observaciones" | "eventos">>): void {
  const ctx = almacen.getStore();
  if (!ctx) return;
  Object.assign(ctx.traza, cambios);
  publicar(ctx);
}

/**
 * Ejecuta `fn` FUERA de la traza del ciclo en curso. Lo usa el orquestador para
 * el trabajo que lanza en segundo plano (actas, aprobación autónoma): sin esto,
 * AsyncLocalStorage propaga el contexto al `void promesa` y las llamadas a la IA
 * del supervisor o del redactor se anotaban en la traza del agente que propuso
 * la decisión, falseando la latencia por agente (medido 2026-09-19: el
 * coordinador aparecía con 11 llamadas y el supervisor con 0).
 */
export function sinTraza<T>(fn: () => T): T {
  return almacen.exit(fn);
}

/** Recorta un texto para los resúmenes de las trazas. */
export function resumir(texto: string, max = 400): string {
  const t = texto.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
