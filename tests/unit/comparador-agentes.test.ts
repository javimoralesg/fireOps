import { describe, expect, it } from "vitest";
import { compararDecisiones, normalizarDecision } from "@/lib/agentes/migracion/comparador";
import { accion, decision } from "./ayudas/dominio";

function planLegacy() {
  return decision([
    accion("desplegar_unidad", {
      id: "acc-aleatoria-1",
      descripcion: "Enviar BRIF ahora",
      objetivo: { unidadId: "unidad-7" },
      parametros: { sector: "A", incendioId: "inc-1", motivo: "El modelo dice que conviene" },
      resultado: { en: "2026-01-01T10:00:00Z", proveedor: "motor", referencia: "run-1", resumen: "OK", exito: true },
    }),
  ], {
    id: "dec-1",
    ejecucionId: "ejec-1",
    agenteId: "coordinador",
    incendioId: "inc-1",
    titulo: "Ataque inicial",
    resumen: "Enviar una unidad",
    razonamiento: "Texto legacy",
    riesgo: 20,
    competencia: "autonoma",
    evidencias: [{ id: "ev-1", fuente: "Open-Meteo", resumen: "Viento fuerte", en: "2026-01-01T10:00:00Z", confianza: 0.9 }],
    fundamentos: [{ chunkId: "ch-1", documento: "Plan INFO", seccion: "4", cita: "Texto legal", similitud: 0.8 }],
  });
}

function planFive() {
  return decision([
    accion("desplegar_unidad", {
      id: "acc-distinta",
      descripcion: "Desplegar recurso terrestre",
      objetivo: { unidadId: "unidad-7" },
      parametros: { sector: "A", incendioId: "inc-1", motivo: "Otra prosa" },
      resultado: { en: "2030-05-05T08:30:00Z", proveedor: "motor", referencia: "run-999", resumen: "Realizado", exito: true },
    }),
  ], {
    id: "dec-distinta",
    ejecucionId: "ejec-distinta",
    agenteId: "planificador_operativo",
    incendioId: "inc-1",
    titulo: "Plan operativo",
    resumen: "Prosa diferente",
    razonamiento: "Texto five",
    riesgo: 20,
    competencia: "autonoma",
    creadaEn: "2030-05-05T08:30:00Z",
    creadaEnMundo: "2030-05-05T08:30:00Z",
    evidencias: [{ id: "ev-otra", fuente: "Open-Meteo", resumen: "Otra redacción", en: "2030-05-05T08:30:00Z", confianza: 0.9 }],
    fundamentos: [{ chunkId: "otro", documento: "Plan INFO", seccion: "4", cita: "Otra cita", similitud: 0.8 }],
  });
}

describe("comparador semántico pre/post", () => {
  it("ignora ids, tiempos, orden y texto libre pero conserva la intención", () => {
    const antes = planLegacy();
    const despues = planFive();
    expect(compararDecisiones([antes], [despues])).toEqual({ equivalentes: true, faltan: [], sobran: [], cambios: [] });
    expect(compararDecisiones([antes, antes], [despues, despues]).equivalentes).toBe(true);
  });

  it("detecta cambios de competencia, riesgo y parámetros estructurados", () => {
    const antes = planLegacy();
    const despues = planFive();
    despues.competencia = "humano";
    despues.riesgo = 80;
    despues.acciones[0].parametros.sector = "B";

    const comparacion = compararDecisiones([antes], [despues]);

    expect(comparacion.equivalentes).toBe(false);
    expect(comparacion.cambios).toHaveLength(1);
    expect(comparacion.cambios[0].campos).toEqual(expect.arrayContaining(["competencia", "riesgo", "acciones.0.parametros.sector"]));
  });

  it("no oculta un cambio de objetivo ni de tipo de acción", () => {
    const antes = planLegacy();
    const despues = planFive();
    despues.acciones[0].objetivo = { unidadId: "unidad-8" };

    const comparacion = compararDecisiones([antes], [despues]);
    expect(comparacion.equivalentes).toBe(false);
    expect(comparacion.faltan).toHaveLength(1);
    expect(comparacion.sobran).toHaveLength(1);
  });

  it("normaliza redondeos numéricos configurables", () => {
    const d = planLegacy();
    d.riesgo = 20.0000004;
    expect(normalizarDecision(d).riesgo).toBe(20);
  });
});

