import { describe, expect, it } from "vitest";
import {
  AGENTES_LOGICOS,
  agenteLogicoPorId,
  aplanarCapacidades,
  aplanarCapacidadesConPadre,
  capacidadConPadrePorId,
  esCatalogoLogicoCompleto,
} from "@/lib/agentes/logicos";
import { CAPACIDADES_POR_AGENTE, IDS_AGENTES_CANONICOS } from "@/lib/agentes/identidad";

describe("catálogo de cinco agentes lógicos", () => {
  it("representa exactamente los cinco padres y las 16 capacidades del mapeo estable", () => {
    expect(AGENTES_LOGICOS.map((agente) => agente.id)).toEqual(IDS_AGENTES_CANONICOS);
    expect(esCatalogoLogicoCompleto()).toBe(true);
    expect(aplanarCapacidades()).toHaveLength(16);

    for (const agente of AGENTES_LOGICOS) {
      expect(agente.capacidadIds).toEqual(CAPACIDADES_POR_AGENTE[agente.id]);
      expect(agente.capacidades.map((capacidad) => capacidad.id)).toEqual(CAPACIDADES_POR_AGENTE[agente.id]);
    }
  });

  it("reutiliza las capacidades ejecutables, no crea un Agente sintético ni un mega-prompt", () => {
    const planificador = agenteLogicoPorId("planificador_operativo");
    expect(planificador?.capacidades.find((capacidad) => capacidad.id === "propagacion")?.ciclo).toBeTypeOf("function");
    expect("ciclo" in (planificador ?? {})).toBe(false);
    expect(planificador?.modelo.tipo).toBe("composicion_de_capacidades");
  });

  it("deriva unión de eventos y cadencia conservadora de cada capacidad", () => {
    const guardian = agenteLogicoPorId("guardian");
    expect(guardian?.despiertaCon).toEqual(expect.arrayContaining(["decision_propuesta", "agente"]));
    expect(guardian?.cadenciaSeg).toBe(120);
    expect(guardian?.cadenciasPorCapacidad).toEqual([
      { capacidadId: "asesor_legal", cadenciaSeg: 120 },
      { capacidadId: "supervisor", cadenciaSeg: 120 },
    ]);

    const observador = agenteLogicoPorId("observador");
    expect(observador?.cadenciaSeg).toBeLessThanOrEqual(Math.min(...(observador?.capacidades.map((capacidad) => capacidad.cadenciaSeg) ?? [])));
    expect(observador?.despiertaCon).toEqual(expect.arrayContaining(["observacion", "satelite", "camara_positiva", "incendio_nuevo"]));
  });

  it("aplana manteniendo el padre lógico para que el integrador pueda atribuir cada ejecución", () => {
    const planas = aplanarCapacidadesConPadre();
    expect(planas).toHaveLength(16);
    expect(capacidadConPadrePorId("supervisor")).toMatchObject({ agenteId: "guardian", capacidadId: "supervisor" });
    expect(capacidadConPadrePorId("memoria")).toMatchObject({ agenteId: "cronista", capacidadId: "memoria" });
    expect(capacidadConPadrePorId("no-existe")).toBeUndefined();
  });
});
