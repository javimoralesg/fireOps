// =====================================================================
// ATALAYA INCENDIOS · Órdenes directas del humano
// ---------------------------------------------------------------------
// Propósito: cuando el mando actúa a mano desde la sala (mover una unidad,
// avisar a un pueblo, publicar algo), su orden entra por el MISMO camino
// que las de los agentes: se crea una Decision con agenteId "humano", ya
// aprobada, y se ejecuta de verdad. Así queda trazada, sale en el registro,
// genera informe y el agente de memoria puede aprender de ella.
// DUEÑO: constructor D.
// =====================================================================
import type { Accion, Decision, TipoAccion } from "../../dominio/tipos";
import { obtenerEstado } from "../../motor/estado";
import { nuevoId } from "../../motor/ids";
import { aprobarDecision, emitir } from "../../motor/orquestador";

export interface AccionManual {
  tipo: TipoAccion;
  descripcion: string;
  objetivo?: Accion["objetivo"];
  parametros?: Record<string, unknown>;
}

export interface OrdenManual {
  quien: string;
  titulo: string;
  razonamiento?: string;
  resumen?: string;
  incendioId?: string;
  prioridad?: Decision["prioridad"];
  acciones: AccionManual[];
}

/**
 * Crea la decisión humana, la registra y la ejecuta. Devuelve la decisión ya
 * ejecutada (con el resultado real de cada acción en `accion.resultado`).
 */
export async function decisionManual(orden: OrdenManual): Promise<Decision> {
  const estado = obtenerEstado();
  const ahora = new Date().toISOString();

  const decision: Decision = {
    id: nuevoId("dec"),
    ejecucionId: estado.ejecucion.id,
    agenteId: "humano",
    incendioId: orden.incendioId,
    titulo: orden.titulo,
    resumen: orden.resumen ?? orden.titulo,
    razonamiento: orden.razonamiento ?? `Orden directa de ${orden.quien} desde la sala de mando.`,
    prioridad: orden.prioridad ?? 2,
    riesgo: 0,
    // La firma humana ES la autorización: no vuelve a pasar por política ni supervisor.
    competencia: "humano",
    estado: "aprobada",
    acciones: orden.acciones.map((a) => ({
      id: nuevoId("acc"),
      tipo: a.tipo,
      descripcion: a.descripcion,
      objetivo: a.objetivo,
      parametros: a.parametros ?? {},
      estado: "pendiente" as const,
    })),
    evidencias: [],
    fundamentos: [],
    creadaEn: ahora,
    creadaEnMundo: estado.reloj.ahoraMundo,
    decididaEn: ahora,
    decididaPor: `humano:${orden.quien}`,
  };

  estado.guardar(estado.decisiones, decision);
  emitir("humano", `${orden.quien} ordena directamente: ${decision.titulo}`, {
    incendioId: decision.incendioId,
    nivel: "aviso",
    datos: { decisionId: decision.id, acciones: decision.acciones.map((a) => a.tipo) },
  });

  const ejecutada = await aprobarDecision(decision.id, `humano:${orden.quien}`, "Orden directa desde la sala de mando");
  return ejecutada ?? estado.decisiones.get(decision.id) ?? decision;
}
