// =====================================================================
// ATALAYA INCENDIOS · Registro de agentes
// ---------------------------------------------------------------------
// Propósito: reunir los ocho índices de agentes (que rellenan los demás
// constructores) en una sola lista y crear su EstadoAgenteApp para la
// pantalla. DUEÑO: constructor A. Sin dependencias externas.
// Los índices existen siempre (arrays vacíos al principio), así que este
// import estático nunca tumba el servidor de desarrollo.
// =====================================================================

import type { EstadoAgenteApp } from "../dominio/tipos";
import type { Agente } from "../motor/contratos";
import type { Estado } from "../motor/estado";

import { agentesAnalisis } from "./analisis";
import { agentesAprendizaje } from "./aprendizaje";
import { agentesComunicacion } from "./comunicacion";
import { agentesEjecucion } from "./ejecucion";
import { agentesInformes } from "./informes";
import { agentesPercepcion } from "./percepcion";
import { agentesPlanificacion } from "./planificacion";
import { agentesSupervision } from "./supervision";

/** Todos los agentes de la aplicación, sin duplicados por id. */
export function todosLosAgentes(): Agente[] {
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

/** Ficha inicial del agente para la sala de mando. */
export function fichaDe(agente: Agente): EstadoAgenteApp {
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
export function registrarAgentes(estado: Estado): Agente[] {
  const agentes = todosLosAgentes();
  for (const agente of agentes) {
    const previo = estado.agentes.get(agente.id);
    const ficha = fichaDe(agente);
    estado.agentes.set(agente.id, previo ? { ...ficha, pausado: previo.pausado, controlHumano: previo.controlHumano, contadores: previo.contadores, ultimaActividad: previo.ultimaActividad, estado: previo.pausado ? "pausado" : ficha.estado } : ficha);
  }
  estado.tocar();
  return agentes;
}
