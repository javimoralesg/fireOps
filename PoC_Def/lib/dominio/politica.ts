// Evaluación de competencia según la política de autonomía. DUEÑO: constructor D (puede afinar).
// Principios: lista blanca (acción fuera de catálogo → humano), manda la acción más restrictiva,
// la IA nunca se rebaja el riesgo, los umbrales globales y el nivel de gravedad solo pueden subirlo.
import type { Decision, Incendio, ModoCompetencia, PoliticaAutonomia } from "./tipos";

const ORDEN: Record<ModoCompetencia, number> = { autonoma: 0, supervisada: 1, humano: 2 };

export function evaluarCompetencia(decision: Decision, politica: PoliticaAutonomia, incendio?: Incendio): { competencia: ModoCompetencia; riesgo: number; motivo: string } {
  let competencia: ModoCompetencia = "autonoma";
  let riesgo = Math.max(0, Math.min(100, decision.riesgo || 0));
  const motivos: string[] = [];
  for (const a of decision.acciones) {
    const regla = politica.reglas.find((r) => r.tipoAccion === a.tipo);
    if (!regla) { competencia = "humano"; riesgo = Math.max(riesgo, 90); motivos.push(`"${a.tipo}" no está en el catálogo: decide un humano`); continue; }
    if (ORDEN[regla.modo] > ORDEN[competencia]) { competencia = regla.modo; motivos.push(`${regla.descripcion} → ${regla.modo}`); }
    riesgo = Math.max(riesgo, regla.riesgoMinimo);
  }
  if (decision.alertasLegales?.length) { competencia = "humano"; motivos.push("hay alertas legales del asesor"); }
  if (incendio && incendio.nivelGravedad >= politica.nivelGravedadHumano && competencia !== "humano") { competencia = "humano"; motivos.push(`nivel de gravedad ${incendio.nivelGravedad}`); }
  if (riesgo >= politica.umbralHumano && competencia !== "humano") { competencia = "humano"; motivos.push(`riesgo ${riesgo} ≥ ${politica.umbralHumano}`); }
  else if (riesgo >= politica.umbralSupervisada && competencia === "autonoma") { competencia = "supervisada"; motivos.push(`riesgo ${riesgo} ≥ ${politica.umbralSupervisada}`); }
  return { competencia, riesgo, motivo: motivos.join("; ") || "todas las acciones son autónomas según la política" };
}
