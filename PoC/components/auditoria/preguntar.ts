// Cliente de POST /api/agentes/preguntar con caída a la traza (respuestaLocal).

import { CABECERA_ROL, ROLES, normalizarRol, type RolId } from "@/lib/roles";
import type { Decision, EstadoSistema } from "@/lib/tipos-sistema";
import { respuestaLocal, type RespuestaIA } from "./respuestaLocal";

export type ResultadoPregunta =
  | { tipo: "modelo"; datos: RespuestaIA }
  | { tipo: "traza"; datos: RespuestaIA; motivo: string }
  | { tipo: "denegado"; error: string; permiso?: string; escalarA?: string };

const TIMEOUT_MS = 30_000;

function esRespuesta(x: unknown): x is RespuestaIA {
  return !!x && typeof x === "object" && typeof (x as RespuestaIA).respuesta === "string";
}

export async function preguntarAgente(opts: {
  pregunta: string;
  decision: Decision | null;
  estado: EstadoSistema | null;
  rol: RolId;
}): Promise<ResultadoPregunta> {
  const { pregunta, decision, estado, rol } = opts;
  const local = (motivo: string): ResultadoPregunta => ({ tipo: "traza", datos: respuestaLocal(pregunta, decision, estado), motivo });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const res = await fetch("/api/agentes/preguntar", {
      method: "POST",
      headers: { "Content-Type": "application/json", [CABECERA_ROL]: rol },
      body: JSON.stringify({ pregunta, decisionId: decision?.id }),
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (res.status === 403) {
      const b = (await res.json().catch(() => ({}))) as { error?: string; permiso?: string; escalarA?: string };
      const destino = b.escalarA ? ROLES[normalizarRol(b.escalarA)]?.nombre ?? b.escalarA : undefined;
      return { tipo: "denegado", error: b.error ?? "Tu rol no tiene permiso para interrogar a la IA.", permiso: b.permiso, escalarA: destino };
    }
    if (res.status === 404 || res.status === 405) return local("El servicio de interrogatorio aún no está disponible en el servidor");
    if (!res.ok) return local(`El servidor respondió ${res.status}`);
    const cuerpo: unknown = await res.json().catch(() => null);
    if (!esRespuesta(cuerpo)) return local("Respuesta del servidor con formato inesperado");
    return {
      tipo: "modelo",
      datos: {
        respuesta: cuerpo.respuesta,
        citas: Array.isArray(cuerpo.citas) ? cuerpo.citas : [],
        reglasAplicadas: Array.isArray(cuerpo.reglasAplicadas) ? cuerpo.reglasAplicadas : [],
        modelo: cuerpo.modelo || "desconocido",
        latenciaMs: typeof cuerpo.latenciaMs === "number" ? cuerpo.latenciaMs : Math.round(performance.now() - t0),
      },
    };
  } catch (e) {
    return local(ctrl.signal.aborted ? "El modelo no respondió a tiempo" : `Sin conexión con el servidor${e instanceof Error ? ` (${e.message})` : ""}`);
  } finally {
    clearTimeout(timer);
  }
}
