// =====================================================================
// ATALAYA INCENDIOS · Registro de agentes
// ---------------------------------------------------------------------
// El inventario visible tiene cinco agentes lógicos. Las 16 conductas
// históricas siguen siendo capacidades ejecutables y se seleccionan aparte:
// una ficha no finge tener un `ciclo` ni reúne capacidades en un mega-prompt.
// =====================================================================

import type { EstadoAgenteApp } from "../dominio/tipos";
import type { Agente, FichaAgente } from "../motor/contratos";
import type { Estado } from "../motor/estado";

import { agentesAnalisis } from "./analisis";
import { agentesAprendizaje } from "./aprendizaje";
import { agentesComunicacion } from "./comunicacion";
import { agentesEjecucion } from "./ejecucion";
import { agentesInformes } from "./informes";
import { AGENTES_LOGICOS, obtenerTareasEjecutables, type AgenteLogico, type TareaEjecutableAgente } from "./logicos";
import { agentesPercepcion } from "./percepcion";
import { agentesPlanificacion } from "./planificacion";
import { agentesSupervision } from "./supervision";
import { leerTopologiaAgentes, seleccionarTopologia, type TopologiaAgentes } from "./migracion/topologia";

function capacidadesLegacy(): Agente[] {
  const bruto: Agente[] = [
    ...agentesPercepcion,
    ...agentesAnalisis,
    ...agentesPlanificacion,
    ...agentesEjecucion,
    ...agentesComunicacion,
    ...agentesSupervision,
    ...agentesAprendizaje,
    ...agentesInformes,
  ];
  const porId = new Map<string, Agente>();
  for (const a of bruto) {
    if (!a || typeof a.id !== "string" || typeof a.ciclo !== "function") continue;
    if (!porId.has(a.id)) porId.set(a.id, a);
  }
  return [...porId.values()];
}

/** Los cinco agentes canónicos que se muestran tras el corte de registro. */
export function todosLosAgentes(): AgenteLogico[] {
  return [...AGENTES_LOGICOS];
}

/** Las 16 conductas preexistentes; no son 16 fichas en la topología five. */
export function todasLasCapacidades(): Agente[] {
  return capacidadesLegacy();
}

export interface RegistroSeleccionado {
  topologia: TopologiaAgentes;
  autoridad: "legacy" | "five";
  ejecutarSombra: boolean;
  /** Fichas que deben existir en Estado.agentes. */
  fichas: readonly FichaAgente[];
  /** Trabajo real, conservando conjuntamente padre y capacidad. */
  tareas: readonly TareaEjecutableAgente[];
}

/**
 * Plan único para conectar registro y orquestador sin inferir identidades.
 * `legacy` y `shadow` conservan 16 fichas mientras la autoridad sea legacy;
 * `five` publica cinco. En los tres modos las 16 tareas siguen disponibles.
 */
export function seleccionarRegistroAgentes(topologia: TopologiaAgentes = leerTopologiaAgentes()): RegistroSeleccionado {
  const seleccion = seleccionarTopologia(topologia);
  return Object.freeze({
    topologia,
    ...seleccion,
    fichas: Object.freeze(seleccion.autoridad === "five" ? todosLosAgentes() : todasLasCapacidades()),
    tareas: obtenerTareasEjecutables(),
  });
}

/** Ficha inicial del agente para la sala de mando. */
export function fichaDe(agente: FichaAgente): EstadoAgenteApp {
  return {
    id: agente.id,
    nombre: agente.nombre,
    categoria: agente.categoria,
    descripcion: agente.descripcion,
    estado: "observando",
    modelo: agente.modelo,
    contadores: { ciclos: 0, decisiones: 0, acciones: 0, errores: 0 },
    pausado: false,
    controlHumano: false,
    cadenciaSeg: agente.cadenciaSeg,
    tiempoMaximoSeg: agente.tiempoMaximoSeg,
  };
}

/**
 * Crea/actualiza el EstadoAgenteApp de cada agente en el estado vivo.
 * Conserva pausado/controlHumano/contadores si el agente ya estaba (recarga
 * en caliente o reanudación de una ejecución).
 */
export function registrarAgentes(estado: Estado, topologia: TopologiaAgentes = leerTopologiaAgentes()): Agente[] {
  const seleccion = seleccionarRegistroAgentes(topologia);
  const idsSeleccionados = new Set(seleccion.fichas.map((ficha) => ficha.id));
  const idsGestionados = new Set([
    ...todosLosAgentes().map((agente) => agente.id),
    ...todasLasCapacidades().map((capacidad) => capacidad.id),
  ]);

  // Un cambio de topología en caliente no puede dejar 5 + 16 fichas mezcladas.
  for (const id of idsGestionados) {
    if (!idsSeleccionados.has(id)) estado.eliminar(estado.agentes, id);
  }

  for (const agente of seleccion.fichas) {
    const previo = estado.agentes.get(agente.id);
    const ficha = fichaDe(agente);
    estado.agentes.set(agente.id, previo ? { ...ficha, pausado: previo.pausado, controlHumano: previo.controlHumano, contadores: previo.contadores, ultimaActividad: previo.ultimaActividad, estado: previo.pausado ? "pausado" : ficha.estado } : ficha);
  }
  estado.tocar();
  // Adaptador temporal para el orquestador actual. El integrador consumirá las
  // tareas completas para atribuir cada ciclo al padre en modo five.
  return seleccion.tareas.map((tarea) => tarea.capacidad);
}
