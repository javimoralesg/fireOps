// =====================================================================
// ATALAYA INCENDIOS · Armado de la cadena de auditoría
// ---------------------------------------------------------------------
// Propósito: reunir TODO lo que explica una decisión (traza del ciclo que
// la pensó, historial de estados, acciones con su resultado real, actas,
// eventos, evidencias, fundamentos, evaluación y lecciones) en una sola
// estructura. Lo usan /api/auditoria y /api/auditoria/exportar.
// DUEÑO: constructor A. Dependencias: lib/db/repositorio.ts (trazas viejas).
// =====================================================================

import type { Comunicado, Decision, Evento, Incendio, Informe, Observacion, Poblacion, TrazaCiclo, Unidad } from "../dominio/tipos";
import { buscarAgenteCompatibleEnMapa } from "../agentes/identidad";
import { obtenerEstado, type Estado } from "./estado";
import { buscarTraza } from "./actas";

export type OrigenTraza = "memoria" | "supabase" | "no_encontrada" | "sin_traza";

/** Eventos que hablan de esta decisión o de alguna de sus acciones. */
export function eventosDe(estado: Estado, d: Decision): Evento[] {
  return estado.eventos.filter((e) => {
    const datos = e.datos ?? {};
    if (datos.decisionId === d.id) return true;
    if (typeof datos.accionId === "string" && d.acciones.some((a) => a.id === datos.accionId)) return true;
    return false;
  });
}

/** Actas de la decisión, en orden de generación. */
export function informesDe(estado: Estado, d: Decision): Informe[] {
  const porId = new Map<string, Informe>();
  for (const id of d.informeIds ?? []) {
    const i = estado.informes.get(id);
    if (i) porId.set(i.id, i);
  }
  // Red de seguridad: actas que apuntan a la decisión aunque no estén en la lista.
  for (const i of estado.informes.values()) if (i.decisionId === d.id) porId.set(i.id, i);
  return [...porId.values()].sort((a, b) => a.generadoEn.localeCompare(b.generadoEn));
}

/** Traza de origen: primero en memoria y, si ya rotó (solo se guardan 20), en Supabase. */
export async function trazaDe(estado: Estado, d: Decision): Promise<{ traza?: TrazaCiclo; origen: OrigenTraza }> {
  const enMemoria = buscarTraza(estado, d.trazaId);
  if (enMemoria) return { traza: enMemoria, origen: "memoria" };
  if (!d.trazaId) return { origen: "sin_traza" };
  try {
    const { buscarTrazaPersistida } = await import("../db/repositorio");
    const traza = await buscarTrazaPersistida(d.trazaId);
    return { traza, origen: traza ? "supabase" : "no_encontrada" };
  } catch {
    return { origen: "no_encontrada" };
  }
}

/** Cadena completa de auditoría de una decisión. */
export async function cadenaDe(estado: Estado, d: Decision) {
  const { traza, origen } = await trazaDe(estado, d);
  return {
    decision: d,
    agente: buscarAgenteCompatibleEnMapa(estado.agentes, d.agenteId) ?? null,
    incendio: d.incendioId ? estado.incendios.get(d.incendioId) ?? null : null,
    historial: d.historial ?? [],
    trazaOrigen: traza ?? null,
    origenTraza: origen,
    acciones: d.acciones.map((a) => ({
      ...a,
      informe: a.informeId ? estado.informes.get(a.informeId) ?? null : null,
    })),
    informes: informesDe(estado, d),
    eventos: eventosDe(estado, d),
    evidencias: d.evidencias,
    fundamentos: d.fundamentos,
    evaluacion: d.evaluacion ?? null,
    alertasLegales: d.alertasLegales ?? [],
    leccionesAplicadas: (d.leccionesAplicadas ?? []).map((l) => ({
      ...l,
      leccion: estado.lecciones.get(l.leccionId) ?? null,
    })),
  };
}

// ---------------------------------------------------------------------
// Cadena de auditoría de UNA incidencia (AÑADIDO por el constructor G,
// 2026-09-19, para /incidencias/[id] y su expediente exportable).
// No cambia nada de lo anterior: reúne por incendio lo que `cadenaDe` reúne
// por decisión, para poder auditar el foco entero de un vistazo.
// ---------------------------------------------------------------------

export interface CadenaIncendio {
  incendio: Incendio | null;
  decisiones: Awaited<ReturnType<typeof cadenaDe>>[];
  observaciones: Observacion[];
  unidades: Unidad[];
  poblaciones: Poblacion[];
  comunicados: Comunicado[];
  informes: Informe[];
  eventos: Evento[];
}

/**
 * Todo lo auditable de un incendio: cada decisión con su cadena completa
 * (traza, historial, acciones con resultado real, actas, eventos), más las
 * observaciones, unidades, poblaciones, comunicados, actas y eventos del foco.
 */
export async function cadenaDeIncendio(incendioId: string, estado: Estado = obtenerEstado()): Promise<CadenaIncendio> {
  // Un foco absorbido por fusión conserva su propio `incendioId` en todo lo que
  // registró: su rastro forma parte del expediente del foco superviviente.
  const idsFoco = new Set<string>([incendioId]);
  const porVisitar = [incendioId];
  while (porVisitar.length) {
    const actual = porVisitar.pop() as string;
    for (const absorbido of estado.incendios.get(actual)?.focosAbsorbidos ?? []) {
      if (!idsFoco.has(absorbido)) {
        idsFoco.add(absorbido);
        porVisitar.push(absorbido);
      }
    }
  }
  const deEsteFoco = (id?: string) => Boolean(id && idsFoco.has(id));

  const decisiones = [...estado.decisiones.values()]
    .filter((d) => deEsteFoco(d.incendioId))
    .sort((a, b) => a.creadaEn.localeCompare(b.creadaEn));
  const idsDecision = new Set(decisiones.map((d) => d.id));

  return {
    incendio: estado.incendios.get(incendioId) ?? null,
    decisiones: await Promise.all(decisiones.map((d) => cadenaDe(estado, d))),
    observaciones: [...estado.observaciones.values()]
      .filter((o) => deEsteFoco(o.incendioId))
      .sort((a, b) => a.recibidaEn.localeCompare(b.recibidaEn)),
    unidades: [...estado.unidades.values()].filter((u) => deEsteFoco(u.incendioId)),
    poblaciones: [...estado.poblaciones.values()].filter((p) => deEsteFoco(p.incendioId)),
    comunicados: [...estado.comunicados.values()].filter((c) => deEsteFoco(c.incendioId)),
    informes: [...estado.informes.values()]
      .filter((i) => deEsteFoco(i.incendioId) || (i.decisionId && idsDecision.has(i.decisionId)))
      .sort((a, b) => a.generadoEn.localeCompare(b.generadoEn)),
    eventos: estado.eventos.filter((e) => deEsteFoco(e.incendioId)),
  };
}
