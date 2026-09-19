// =====================================================================
// ATALAYA INCENDIOS · Agente de memoria y aprendizaje
// ---------------------------------------------------------------------
// DUEÑO: constructor C.
// Se despierta con los hechos de los que se puede aprender (denegaciones,
// aprobaciones, acciones ejecutadas o fallidas, escalados) y, como mucho, saca
// UNA lección por hecho, descartando las que ya sabía (similitud > 0,92).
//
// En su primer ciclo de cada ejecución escribe `ejecucion.comparativa` («qué
// cambió esta vez») y publica las tres lecciones de más peso que va a aplicar:
// es lo que el jurado tiene que ver para creerse que el sistema aprende.
// =====================================================================

import type { Agente, ContextoAgente, ResultadoCiclo } from "../../motor/contratos";
import type { Evento } from "../../dominio/tipos";
import {
  compararConAnterior,
  extraerLecciones,
  listarLecciones,
  registrarEjecucion,
  registrarLeccion,
} from "../../aprendizaje/memoria";
import { modeloPara } from "../../ia/llm";

/** Eventos de los que merece la pena aprender. */
const TIPOS_APRENDIBLES: Evento["tipo"][] = [
  "decision_denegada",
  "decision_aprobada",
  "accion_fallida",
  "accion_ejecutada",
  "decision_escalada",
];

/** Tope de lecciones por ciclo: extraer cuesta una llamada al modelo cada una. */
const MAX_LECCIONES_POR_CICLO = Number(process.env.APRENDIZAJE_MAX_POR_CICLO ?? 3);

interface EstadoMemoria {
  ultimoEventoProcesado?: string;
  ejecucionArrancada?: string;
}

type ConEstado = typeof globalThis & { __atalayaAgenteMemoria?: EstadoMemoria };
const memoria: EstadoMemoria = ((globalThis as ConEstado).__atalayaAgenteMemoria ??= {});

export const agenteMemoria: Agente = {
  id: "memoria",
  nombre: "Memoria y aprendizaje",
  categoria: "aprendizaje",
  descripcion:
    "Extrae lecciones de lo que el mando deniega o corrige y de las acciones que no salen, las guarda con su evidencia " +
    "y compara cada ejecución con la anterior.",
  modelo: modeloPara("razonamiento"),
  cadenciaSeg: 300,
  // 240 s: extrae varias lecciones por ciclo (razonamiento + embedding cada una) y
  // con el límite por defecto de 90 s la traza moría "cancelado" (medido 2026-09-19).
  tiempoMaximoSeg: 240,
  despiertaCon: ["decision_denegada", "decision_aprobada", "accion_fallida", "accion_ejecutada", "decision_escalada"],

  async ciclo(ctx: ContextoAgente): Promise<ResultadoCiclo> {
    const eventos: ResultadoCiclo["eventos"] = [];
    const nuevasLecciones = [];

    // --- primer ciclo de la ejecución: comparativa y lecciones que se aplican
    if (memoria.ejecucionArrancada !== ctx.snapshot.ejecucion.id) {
      memoria.ejecucionArrancada = ctx.snapshot.ejecucion.id;
      ctx.informarTarea("Recuperando lo aprendido en ejecuciones anteriores");
      await registrarEjecucion(ctx.snapshot.ejecucion);

      const comparativa = await compararConAnterior(ctx.snapshot.ejecucion);
      if (comparativa) {
        ctx.estado.ejecucion = { ...ctx.estado.ejecucion, comparativa };
        ctx.estado.tocar();
      }

      const top = (await listarLecciones()).slice(0, 3);
      for (const l of top) ctx.estado.guardar(ctx.estado.lecciones, l);
      if (top.length) {
        eventos.push({
          tipo: "leccion",
          agenteId: "memoria",
          nivel: "info",
          mensaje: `Aplico ${top.length} lección(es) de ejecuciones anteriores: ${top.map((l) => `«${l.texto}»`).join(" · ")}`,
          datos: { lecciones: top.map((l) => ({ id: l.id, texto: l.texto, peso: l.peso })) },
        });
      }
      if (comparativa) {
        eventos.push({ tipo: "sistema", agenteId: "memoria", nivel: "info", mensaje: comparativa });
      }
    }

    // --- eventos nuevos desde el último ciclo -------------------------
    const todos = ctx.snapshot.eventos;
    const desde = memoria.ultimoEventoProcesado ? todos.findIndex((e) => e.id === memoria.ultimoEventoProcesado) : -1;
    const pendientes = todos.slice(desde + 1).filter((e) => TIPOS_APRENDIBLES.includes(e.tipo));
    if (todos.length) memoria.ultimoEventoProcesado = todos[todos.length - 1].id;

    // Las denegaciones humanas van primero: son la mejor evidencia que hay.
    const ordenados = [...pendientes].sort((a, b) => valor(b) - valor(a)).slice(0, MAX_LECCIONES_POR_CICLO);

    for (const evento of ordenados) {
      if (ctx.abortSignal.aborted) break;
      const decisionId = typeof evento.datos?.decisionId === "string" ? evento.datos.decisionId : undefined;
      const decision = decisionId
        ? ctx.snapshot.decisiones.find((d) => d.id === decisionId)
        : ctx.snapshot.decisiones.find((d) => d.incendioId === evento.incendioId && d.decididaEn);
      ctx.informarTarea(`Aprendiendo de: ${evento.mensaje.slice(0, 70)}`, evento.incendioId);

      const lecciones = await extraerLecciones(evento, decision, decision?.comentarioHumano);
      for (const l of lecciones) {
        await registrarLeccion(l);
        ctx.estado.guardar(ctx.estado.lecciones, l);
        nuevasLecciones.push(l);
        eventos.push({
          tipo: "leccion",
          agenteId: "memoria",
          incendioId: evento.incendioId,
          nivel: "info",
          mensaje: `Aprendido (${l.origen.replace(/_/g, " ")}): ${l.texto}`,
          datos: { leccionId: l.id, cambio: l.cambio, evidencia: l.evidencia },
        });
      }
    }

    const resumen = nuevasLecciones.length
      ? `${nuevasLecciones.length} lección(es) nueva(s) de ${ordenados.length} hecho(s) revisado(s).`
      : pendientes.length
        ? `${pendientes.length} hecho(s) revisado(s), nada nuevo que aprender.`
        : "Sin hechos nuevos de los que aprender.";
    return { resumen, eventos, lecciones: nuevasLecciones };
  },
};

/** Prioridad de un hecho para aprender de él. */
function valor(e: Evento): number {
  switch (e.tipo) {
    case "decision_denegada":
      return 4;
    case "accion_fallida":
      return 3;
    case "decision_escalada":
      return 2;
    case "decision_aprobada":
      return 1;
    default:
      return 0;
  }
}
