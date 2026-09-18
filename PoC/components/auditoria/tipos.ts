import type { Evidencia } from "@/lib/tipos-sistema";
import type { RolId } from "@/lib/roles";

export type OrigenRespuesta = "modelo" | "traza" | "denegado";

export interface MensajeChat {
  id: string;
  autor: "supervisor" | "ia";
  texto: string;
  timestamp: string;
  decisionId: string | null;
  rol?: RolId; // quién preguntó
  // Solo respuestas de la IA:
  origen?: OrigenRespuesta;
  motivoTraza?: string;
  citas?: Evidencia[];
  reglasAplicadas?: string[];
  modelo?: string;
  latenciaMs?: number;
  escalarA?: string;
}

/** Clave de conversación: id de la decisión o "general". */
export const GENERAL = "general";
