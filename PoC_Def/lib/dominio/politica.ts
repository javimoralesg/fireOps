// Evaluación de competencia según la política de autonomía. DUEÑO: constructor D (puede afinar).
// Principios: lista blanca (acción fuera de catálogo → humano), manda la acción más restrictiva,
// la IA nunca se rebaja el riesgo, los umbrales globales y el nivel de gravedad solo pueden subirlo.
import type { Accion, Decision, Incendio, ModoCompetencia, PoliticaAutonomia } from "./tipos";

const ORDEN: Record<ModoCompetencia, number> = { autonoma: 0, supervisada: 1, humano: 2 };

export interface EvaluacionCompetenciaAccion {
  accion: Accion;
  competencia: ModoCompetencia;
  riesgo: number;
  motivo: string;
}

/** Evalúa cada acción por separado. Los campos declarados por el agente son suelos, nunca techos. */
export function evaluarCompetenciasAcciones(decision: Decision, politica: PoliticaAutonomia, incendio?: Incendio): EvaluacionCompetenciaAccion[] {
  return decision.acciones.map((accion) => {
    let competencia: ModoCompetencia = accion.competencia ?? "autonoma";
    // Compatibilidad: las decisiones antiguas solo tienen riesgo global. En el
    // contrato nuevo cada acción aporta el suyo para no contagiar a sus hermanas.
    // Durante una migración parcial, una acción aún no anotada conserva el global.
    const riesgoBase = accion.riesgo ?? (accion.competencia !== undefined ? 0 : decision.riesgo || 0);
    let riesgo = Math.max(0, Math.min(100, riesgoBase));
    const motivos: string[] = [];
    const regla = politica.reglas.find((r) => r.tipoAccion === accion.tipo);
    if (!regla) {
      competencia = "humano";
      riesgo = Math.max(riesgo, 90);
      motivos.push(`"${accion.tipo}" no está en el catálogo: decide un humano`);
    } else {
      if (ORDEN[regla.modo] > ORDEN[competencia]) {
        competencia = regla.modo;
        motivos.push(`${regla.descripcion} → ${regla.modo}`);
      }
      riesgo = Math.max(riesgo, regla.riesgoMinimo);
    }
    if (decision.alertasLegales?.length) { competencia = "humano"; motivos.push("hay alertas legales del asesor"); }
    if (incendio && incendio.nivelGravedad >= politica.nivelGravedadHumano && competencia !== "humano") {
      competencia = "humano";
      motivos.push(`nivel de gravedad ${incendio.nivelGravedad}`);
    }
    if (riesgo >= politica.umbralHumano && competencia !== "humano") {
      competencia = "humano";
      motivos.push(`riesgo ${riesgo} ≥ ${politica.umbralHumano}`);
    } else if (riesgo >= politica.umbralSupervisada && competencia === "autonoma") {
      competencia = "supervisada";
      motivos.push(`riesgo ${riesgo} ≥ ${politica.umbralSupervisada}`);
    }
    return { accion: { ...accion, competencia, riesgo }, competencia, riesgo, motivo: motivos.join("; ") };
  });
}

export function evaluarCompetencia(decision: Decision, politica: PoliticaAutonomia, incendio?: Incendio): { competencia: ModoCompetencia; riesgo: number; motivo: string; acciones: Accion[] } {
  let competencia: ModoCompetencia = "autonoma";
  let riesgo = Math.max(0, Math.min(100, decision.riesgo || 0));
  const motivos: string[] = [];
  const evaluadas = evaluarCompetenciasAcciones(decision, politica, incendio);
  for (const evaluada of evaluadas) {
    if (ORDEN[evaluada.competencia] > ORDEN[competencia]) competencia = evaluada.competencia;
    riesgo = Math.max(riesgo, evaluada.riesgo);
    if (evaluada.motivo && !motivos.includes(evaluada.motivo)) motivos.push(evaluada.motivo);
  }
  return { competencia, riesgo, motivo: motivos.join("; ") || "todas las acciones son autónomas según la política", acciones: evaluadas.map((e) => e.accion) };
}
