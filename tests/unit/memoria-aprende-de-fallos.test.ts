// =====================================================================
// PRUEBA DE INTENCIÓN de la fase F1, componente 1b.
//
// Falla ANTES del cambio y pasa DESPUÉS.
//
// Qué se exige: `memoria` deja de gastar razonamiento aprendiendo de que
// todo salió bien. Su propia cabecera ya lo decía —una lección sale de
// "una denegación con su comentario humano, una llamada sin respuesta, una
// puntuación baja del supervisor"— pero escuchaba además `decision_aprobada`
// y `accion_ejecutada`, que es el curso normal de las cosas.
//
// Medido en la instancia de desarrollo el 2026-09-19, con UNA decisión de 2
// acciones aprobada y ejecutada con éxito: `memoria` hizo 3 llamadas de
// razonamiento y gastó 7.605 tokens de salida. Fue el mayor consumidor del
// sistema, por encima del coordinador (2 llamadas, 1.519 tokens).
//
// Lo que NO se toca: de una denegación, de una acción fallida, de una
// escalada y de una decisión que el supervisor aprobó raspando se sigue
// aprendiendo igual. Eso es lo que hay que comprobar aquí.
// DUEÑO: constructor L (escrito en la fase F1 de la migración).
// =====================================================================
import { describe, expect, it } from "vitest";
import { agenteMemoria, esAprendible, TIPOS_APRENDIBLES } from "@/lib/agentes/aprendizaje/memoria";
import type { Decision, EvaluacionSupervisor, Evento } from "@/lib/dominio/tipos";

/** Evaluación completa del supervisor: lo único que varía entre casos es la nota. */
function evaluacion(puntuacion: number): EvaluacionSupervisor {
  return {
    en: "2026-09-19T14:05:00.000Z",
    puntuacion,
    aprueba: true,
    criterios: [{ nombre: "fundamentacion", puntuacion, comentario: "" }],
    modelo: "glm5.3-flash",
  };
}

const PUNTUACION_MINIMA = 70;

function evento(tipo: Evento["tipo"], p: Partial<Evento> = {}): Evento {
  return {
    id: `ev-${tipo}`,
    en: "2026-09-19T14:00:00.000Z",
    enMundo: "2026-09-19T14:00:00.000Z",
    tipo,
    mensaje: `Evento de prueba ${tipo}`,
    nivel: "info",
    ...p,
  };
}

function decision(p: Partial<Decision> = {}): Decision {
  return {
    id: "dec-1",
    ejecucionId: "ejec-1",
    agenteId: "coordinador",
    titulo: "Decisión de prueba",
    resumen: "",
    razonamiento: "",
    prioridad: 3,
    riesgo: 20,
    competencia: "autonoma",
    estado: "ejecutada",
    acciones: [],
    evidencias: [],
    fundamentos: [],
    creadaEn: "2026-09-19T14:00:00.000Z",
    creadaEnMundo: "2026-09-19T14:00:00.000Z",
    ...p,
  };
}

describe("F1 · de qué despierta memoria", () => {
  it("ya NO despierta con cada acción ejecutada con éxito", () => {
    expect(agenteMemoria.despiertaCon).not.toContain("accion_ejecutada");
  });

  it("sigue despertando con lo que de verdad enseña", () => {
    expect(agenteMemoria.despiertaCon).toEqual(
      expect.arrayContaining(["decision_denegada", "accion_fallida", "decision_escalada"]),
    );
  });

  it("`accion_ejecutada` sale del catálogo de eventos aprendibles", () => {
    expect(TIPOS_APRENDIBLES).not.toContain("accion_ejecutada");
  });
});

describe("F1 · esAprendible · de qué se saca lección y de qué no", () => {
  it("una denegación humana siempre enseña: es la mejor evidencia que hay", () => {
    expect(esAprendible(evento("decision_denegada"), decision({ comentarioHumano: "demasiados medios" }), PUNTUACION_MINIMA)).toBe(true);
  });

  it("una acción que no salió siempre enseña", () => {
    expect(esAprendible(evento("accion_fallida"), decision(), PUNTUACION_MINIMA)).toBe(true);
  });

  it("una escalada siempre enseña", () => {
    expect(esAprendible(evento("decision_escalada"), decision(), PUNTUACION_MINIMA)).toBe(true);
  });

  it("una decisión aprobada con buena nota NO enseña: es el curso normal", () => {
    const buena = decision({ evaluacion: evaluacion(88) });
    expect(esAprendible(evento("decision_aprobada"), buena, PUNTUACION_MINIMA)).toBe(false);
  });

  it("una decisión aprobada RASPANDO sí enseña: el supervisor vio algo", () => {
    const justa = decision({ evaluacion: evaluacion(72) });
    expect(esAprendible(evento("decision_aprobada"), justa, PUNTUACION_MINIMA)).toBe(true);
  });

  it("una decisión aprobada sin evaluación no enseña: no hay de qué", () => {
    expect(esAprendible(evento("decision_aprobada"), decision(), PUNTUACION_MINIMA)).toBe(false);
    expect(esAprendible(evento("decision_aprobada"), undefined, PUNTUACION_MINIMA)).toBe(false);
  });

  it("una decisión denegada enseña aunque no se encuentre su decisión", () => {
    expect(esAprendible(evento("decision_denegada"), undefined, PUNTUACION_MINIMA)).toBe(true);
  });

  it("el caso medido: decisión aprobada con nota alta y 2 acciones ejecutadas → 0 lecciones", () => {
    const buena = decision({ evaluacion: evaluacion(91) });
    const eventos = [evento("decision_aprobada"), evento("accion_ejecutada"), evento("accion_ejecutada")];
    const aprendibles = eventos.filter((e) => TIPOS_APRENDIBLES.includes(e.tipo) && esAprendible(e, buena, PUNTUACION_MINIMA));
    expect(aprendibles).toHaveLength(0);
  });
});
