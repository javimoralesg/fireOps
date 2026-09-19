// =====================================================================
// F2 · agente que razona vs. entrada determinista.
// Prueba de CLASE 1: sin red, sin IA.
//
// La distinción se enseña en la sala, así que más vale que sea exacta: si
// un agente que llama al modelo apareciera como "entrada determinista",
// quien manda pensaría que no hay nada que supervisar ahí.
//
// Se comprueba contra el registro REAL de agentes, no contra una lista
// escrita a mano: así, si mañana alguien cambia el modelo de un agente, esta
// prueba lo dice.
// DUEÑO: constructor L (escrito en la fase F2 de la migración).
// =====================================================================
import { describe, expect, it } from "vitest";
import { AYUDA_CLASE, claseDeAgente, esServicioDeterminista, TEXTO_CLASE } from "@/lib/dominio/clase-agente";
import { todosLosAgentes } from "@/lib/agentes/registro";

describe("claseDeAgente · la regla", () => {
  it("«determinista» es una entrada, no un agente", () => {
    expect(claseDeAgente("determinista")).toBe("servicio");
    expect(esServicioDeterminista("determinista")).toBe(true);
  });

  it("cualquier modelo de IA es un agente", () => {
    for (const modelo of ["glm5.3-flash", "qwen3.6", "rapido", "razonamiento", "vision"]) {
      expect(claseDeAgente(modelo)).toBe("agente");
      expect(esServicioDeterminista(modelo)).toBe(false);
    }
  });

  it("no se deja engañar por mayúsculas ni espacios", () => {
    expect(claseDeAgente("  DETERMINISTA ")).toBe("servicio");
  });

  it("sin modelo declarado se asume agente: más vale supervisar de más que de menos", () => {
    expect(claseDeAgente(undefined)).toBe("agente");
    expect(claseDeAgente("")).toBe("agente");
  });

  it("tiene etiqueta y explicación para las dos clases", () => {
    for (const clase of ["agente", "servicio"] as const) {
      expect(TEXTO_CLASE[clase].length).toBeGreaterThan(0);
      expect(AYUDA_CLASE[clase].length).toBeGreaterThan(20);
    }
  });
});

describe("F2 · cómo queda el inventario real al aplicar la regla", () => {
  const agentes = todosLosAgentes();
  const servicios = agentes.filter((a) => esServicioDeterminista(a.modelo));
  const razonan = agentes.filter((a) => !esServicioDeterminista(a.modelo));

  it("son 4 las entradas deterministas, y son estas", () => {
    expect(servicios.map((a) => a.id).sort()).toEqual(["despachador", "meteorologo", "propagacion", "satelite"]);
  });

  it("el tablero enseña 16 fichas, pero solo 12 razonan", () => {
    expect(agentes).toHaveLength(16);
    expect(razonan).toHaveLength(12);
    expect(servicios).toHaveLength(4);
  });

  it("ninguna entrada determinista declara un modelo de IA", () => {
    for (const s of servicios) expect(s.modelo.trim().toLowerCase()).toBe("determinista");
  });

  it("todo agente que razona declara con qué modelo, para poder auditarlo", () => {
    for (const a of razonan) {
      expect(a.modelo.trim().length).toBeGreaterThan(0);
      expect(a.modelo.trim().toLowerCase()).not.toBe("determinista");
    }
  });
});
