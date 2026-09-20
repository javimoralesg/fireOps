// =====================================================================
// ATALAYA INCENDIOS · Contratos del motor (CONTRATO compartido)
// ---------------------------------------------------------------------
// Interfaz que implementan TODOS los agentes de la aplicación y el
// contexto que el orquestador les entrega en cada ciclo. Los agentes
// constructores no cambian estas firmas; si necesitan algo nuevo lo
// piden a la sesión orquestadora.
// =====================================================================

import type {
  Accion,
  CategoriaAgente,
  Decision,
  Evento,
  Incendio,
  Leccion,
  Observacion,
  Snapshot,
  TipoEvento,
} from "../dominio/tipos";
import type { Estado } from "./estado";

/** Lo que un agente puede devolver tras un ciclo. Todo es opcional. */
export interface ResultadoCiclo {
  /** Frase para la pantalla ("Analizadas 6 cámaras, sin humo"). */
  resumen?: string;
  /** Decisiones nuevas (el orquestador las pasa por política y supervisor). */
  decisiones?: Decision[];
  /** Observaciones nuevas (el orquestador las pasa por el verificador). */
  observaciones?: Observacion[];
  /** Eventos para el registro vivo. */
  eventos?: Omit<Evento, "id" | "en" | "enMundo">[];
  /** Lecciones nuevas. */
  lecciones?: Leccion[];
}

/**
 * Contexto que recibe un agente en cada ciclo. `estado` es el almacén vivo
 * (mutable, en memoria, con persistencia asíncrona); los agentes lo
 * modifican SOLO a través de sus métodos, nunca tocando arrays a mano.
 */
export interface ContextoAgente {
  estado: Estado;
  /** Snapshot inmutable tomado al inicio del ciclo. */
  snapshot: Snapshot;
  /** ISO de mundo actual. */
  ahoraMundo: string;
  /** Minutos de mundo transcurridos desde el ciclo anterior de este agente. */
  minutosMundoDesdeUltimoCiclo: number;
  /** Registra un evento inmediatamente (para no esperar al final del ciclo). */
  registrar: (tipo: TipoEvento, mensaje: string, extra?: Partial<Pick<Evento, "incendioId" | "nivel" | "datos">>) => void;
  /** Actualiza la frase "tarea actual" del agente en la pantalla. */
  informarTarea: (tarea: string, incendioId?: string) => void;
  /** Lecciones relevantes ya recuperadas para este agente (inyectar en prompts). */
  lecciones: Leccion[];
  /** Señal de cancelación (pausa/apagado). */
  abortSignal: AbortSignal;
}

/**
 * Metadatos de una ficha visible en la sala. Una ficha puede representar una
 * capacidad ejecutable o un agente lógico compuesto por varias capacidades.
 */
export interface FichaAgente {
  id: string;
  nombre: string;
  categoria: CategoriaAgente;
  descripcion: string;
  /** Modelo de IA que usa, o "determinista". */
  modelo: string;
  /** Segundos entre ciclos (el orquestador puede forzar un ciclo antes con `despertar`). */
  cadenciaSeg: number;
  /**
   * Eventos que despiertan al agente antes de su cadencia
   * (p. ej. el coordinador se despierta con "viento_gira" o "incendio_nuevo").
   */
  despiertaCon?: TipoEvento[];
  /** Tiempo máximo de un ciclo en segundos (por defecto 90 s los de razonamiento, 30 s el resto). */
  tiempoMaximoSeg?: number;
}

/** Capacidad que el motor puede ejecutar. */
export interface Agente extends FichaAgente {
  /** Un ciclo de trabajo. Debe ser idempotente y tolerar fallos externos. */
  ciclo(ctx: ContextoAgente): Promise<ResultadoCiclo | void>;
}

/** Evento del bus interno (no confundir con Evento del dominio, que es el registro visible). */
export type MensajeBus =
  | { tipo: "evento"; evento: Evento }
  | { tipo: "snapshot"; version: number }
  | { tipo: "decision"; decision: Decision }
  | { tipo: "incendio"; incendio: Incendio }
  | { tipo: "accion"; accion: Accion; decisionId: string };

export type Suscriptor = (mensaje: MensajeBus) => void;

/** Ejecutor de acciones reales: lo implementa lib/agentes/ejecucion/*, lo invoca el orquestador. */
export interface EjecutorAcciones {
  /** Ejecuta una acción concreta de una decisión aprobada. Nunca simula: si no hay proveedor, falla con mensaje claro. */
  ejecutar(accion: Accion, decision: Decision, ctx: ContextoAgente): Promise<Accion>;
  /** Tipos de acción que sabe ejecutar. */
  soporta(tipo: Accion["tipo"]): boolean;
}
