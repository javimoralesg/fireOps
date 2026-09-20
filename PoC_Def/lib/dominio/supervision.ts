// =====================================================================
// ATALAYA INCENDIOS · Cuándo hace falta el supervisor independiente
// ---------------------------------------------------------------------
// Propósito: decidir si una decisión espera a que el supervisor la puntúe
// ANTES de enrutarse, o si se enruta con la política y el supervisor la
// revisa después.
//
// Por qué existe (fase F5 de la migración, 2026-09-19). El supervisor
// evaluaba TODAS las decisiones, y su llamada de razonamiento va en el
// camino crítico: medido, ~25 s por decisión. Para un aviso preventivo de
// riesgo 20 que la política ya declara autónomo, esa espera no compra nada.
//
// La regla NO inventa su propio criterio de "lo importante": lo lee de la
// política de autonomía, que es editable en vivo desde /politica. Si mañana
// alguien decide que publicar un comunicado lo firma una persona, el
// muestreo lo respeta sin tocar este fichero.
//
// LO QUE SE PIERDE, dicho claro: una decisión autónoma y de bajo riesgo se
// ejecuta sin que nadie la haya puntuado antes. Lo que la protege es la
// política —lista blanca determinista, y la IA no puede rebajarse el
// riesgo— y la revisión a posteriori, que sigue puntuándola, la deja en el
// acta y alimenta a `memoria` si sale mal.
// DUEÑO: constructor A. Sin dependencias.
// =====================================================================
import type { Decision, PoliticaAutonomia } from "./tipos";

export interface FalloSupervision {
  /** true = el supervisor evalúa ANTES de enrutar (bloqueante). */
  procede: boolean;
  /** Por qué, en una frase. Va al registro y al acta: nunca se salta en silencio. */
  motivo: string;
}

/**
 * ¿Esta decisión necesita la evaluación del supervisor antes de enrutarse?
 *
 * Sí cuando pasa cualquiera de estas cosas:
 *  · la va a ver una persona (su nota es la recomendación que lee);
 *  · el asesor legal ha levantado una alerta;
 *  · alguna de sus acciones está reservada a una persona por la política
 *    (evacuar, confinar, cortar una carretera, elevar el nivel…), aunque otra
 *    cosa la haya dejado en autónoma;
 *  · su riesgo llega al umbral de supervisión.
 *
 * No cuando es lo que la política considera rutina autónoma de bajo riesgo.
 * Entonces se revisa a posteriori, que es lo que ya se hacía con el ataque
 * inicial desde antes de esta fase.
 */
export function requiereSupervisorIndependiente(decision: Decision, politica: PoliticaAutonomia): FalloSupervision {
  if (decision.competencia !== "autonoma") {
    return { procede: true, motivo: `la decide una persona (competencia ${decision.competencia}): su nota es la recomendación` };
  }
  if (decision.alertasLegales?.length) {
    return { procede: true, motivo: "hay alertas legales del asesor" };
  }
  const reservadas = accionesReservadasAPersona(decision, politica);
  if (reservadas.length) {
    return { procede: true, motivo: `acción irreversible según la política: ${reservadas.join(", ")}` };
  }
  if (decision.riesgo >= politica.umbralSupervisada) {
    return { procede: true, motivo: `riesgo ${decision.riesgo} ≥ umbral de supervisión ${politica.umbralSupervisada}` };
  }
  return {
    procede: false,
    motivo: `rutina autónoma de riesgo ${decision.riesgo} (< ${politica.umbralSupervisada}): se revisa a posteriori`,
  };
}

/**
 * Acciones de la decisión que la política reserva a una persona. Es la lista
 * de "lo irreversible" del sistema, y vive en la política, no aquí.
 * Una acción que NO esté en el catálogo cuenta como reservada: lista blanca.
 */
export function accionesReservadasAPersona(decision: Decision, politica: PoliticaAutonomia): string[] {
  const reservadas: string[] = [];
  for (const a of decision.acciones) {
    const regla = politica.reglas.find((r) => r.tipoAccion === a.tipo);
    if (!regla || regla.modo === "humano") reservadas.push(a.tipo);
  }
  return [...new Set(reservadas)];
}
