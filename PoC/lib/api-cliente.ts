// Cliente HTTP de la UI. Contrato acordado con poc-55 (backend en app/api/*).
// Todas las mutaciones devuelven void: tras cada una, useEstado hace refetch.
// El rol activo (lib/useRol.ts) viaja en la cabecera x-atalaya-rol en cada llamada.

import { CABECERA_ROL, type Permiso, type RolId } from "./roles";
import type { EstadoSistema, ReglaDoctrina } from "./tipos-sistema";
import { rolActual } from "./useRol";

export class ErrorApi extends Error {
  constructor(
    message: string,
    public status: number,
    /** Solo en 403: permiso que faltaba y rol al que hay que escalar. */
    public permiso?: Permiso,
    public escalarA?: RolId,
  ) {
    super(message);
  }
}

async function peticion<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", [CABECERA_ROL]: rolActual(), ...init?.headers },
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    let permiso: Permiso | undefined;
    let escalarA: RolId | undefined;
    try {
      const body = await res.json();
      if (body?.error) msg = String(body.error);
      permiso = body?.permiso;
      escalarA = body?.escalarA;
    } catch {
      /* cuerpo no JSON */
    }
    throw new ErrorApi(msg, res.status, permiso, escalarA);
  }
  const txt = await res.text();
  return (txt ? JSON.parse(txt) : undefined) as T;
}

const post = (url: string, body?: unknown) =>
  peticion<unknown>(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  estado: () => peticion<EstadoSistema>("/api/estado"),

  // El rol también va en el cuerpo por compatibilidad con backends que aún no leen la cabecera.
  aprobar: (decisionId: string) => post(`/api/decisiones/${decisionId}/aprobar`, { rol: rolActual() }),

  denegar: (decisionId: string, feedback: string, ambito: ReglaDoctrina["ambito"]) =>
    post(`/api/decisiones/${decisionId}/denegar`, { feedback, rol: rolActual(), ambito }),

  escalar: (decisionId: string, a: RolId) => post(`/api/decisiones/${decisionId}/escalar`, { a }),

  toggleRegla: (reglaId: string, activa: boolean) =>
    peticion<unknown>(`/api/doctrina/${reglaId}`, { method: "PATCH", body: JSON.stringify({ activa }) }),

  eliminarRegla: (reglaId: string) => peticion<unknown>(`/api/doctrina/${reglaId}`, { method: "DELETE" }),

  config: (cambios: Partial<Pick<EstadoSistema, "umbralAutonomia" | "autoAvance">>) => post("/api/config", cambios),

  tick: () => post("/api/escenario", { accion: "tick" }),

  reset: () => post("/api/escenario", { accion: "reset" }),

  cerrarIncidente: () => post("/api/incidente/cerrar"),

  publicarTarea: (tareaId: string) => post(`/api/voluntarios/${tareaId}/publicar`),

  cancelarTarea: (tareaId: string) => post(`/api/voluntarios/${tareaId}/cancelar`),

  // --- Simulador de eventos (components/simulador) · permiso controlar_simulacion o Dirección del Plan ---
  // Tipos en línea a propósito: el dataset (lib/dataset/*) evoluciona y el panel normaliza lo que llegue.

  /** Escenarios de data/dataset/*.json (+ el guion de respaldo) y eventos sueltos para inyectar a mano. */
  simulacionEscenarios: () =>
    peticion<{
      escenarios: { id: string; nombre: string; tipo: string; descripcion?: string; duracionSeg?: number; eventos: number }[];
      sueltos: Record<string, unknown>[];
    }>("/api/simulacion/escenarios"),

  /** Arranca (o reinicia) el reproductor. `desde` = segundo del guion desde el que seguir. */
  iniciarSimulacion: (escenarioId: string, velocidad: number, desde?: number) =>
    peticion<NonNullable<EstadoSistema["simulacion"]>>("/api/simulacion", {
      method: "POST",
      body: JSON.stringify(desde === undefined ? { escenarioId, velocidad } : { escenarioId, velocidad, desde }),
    }),

  pararSimulacion: () => peticion<NonNullable<EstadoSistema["simulacion"]>>("/api/simulacion", { method: "DELETE" }),

  /** Cambia la velocidad en caliente, sin reiniciar la reproducción (el servidor reprograma el siguiente evento). */
  velocidadSimulacion: (velocidad: number) =>
    peticion<NonNullable<EstadoSistema["simulacion"]>>("/api/simulacion", { method: "PATCH", body: JSON.stringify({ velocidad }) }),

  estadoSimulacion: () => peticion<NonNullable<EstadoSistema["simulacion"]>>("/api/simulacion"),

  /** Inyecta un evento (del dataset o compuesto a mano) por el mismo pipeline que los periféricos reales. */
  inyectarEvento: (evento: { observacion: Record<string, unknown> } & Record<string, unknown>) =>
    peticion<NonNullable<EstadoSistema["simulacion"]>["ultimos"][number]>("/api/simulacion/evento", {
      method: "POST",
      body: JSON.stringify(evento),
    }),
};
