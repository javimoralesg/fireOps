// Pruebas de lib/agentes/analisis/verificador.ts. DUEÑO: constructor L.
// El agente en sí necesita un ContextoAgente completo (estado, eventos, IA real):
// se prueba de extremo a extremo en tests/integracion/ingesta.test.ts.
// Aquí solo lo que es puro… y ahí está el problema (fallo L-1, más abajo).
import { describe, expect, it } from "vitest";
import { verificador } from "@/lib/agentes/analisis/verificador";

describe("contrato del agente verificador", () => {
  it("se identifica y declara con qué eventos despierta", () => {
    expect(verificador.id).toBe("verificador");
    expect(verificador.categoria).toBe("analisis");
    expect(verificador.despiertaCon).toEqual(expect.arrayContaining(["observacion", "satelite", "camara_positiva"]));
    expect(verificador.cadenciaSeg).toBeGreaterThan(0);
    expect(typeof verificador.ciclo).toBe("function");
  });

  it("usa un modelo de IA declarado (auditable desde la pantalla del agente)", () => {
    expect(typeof verificador.modelo).toBe("string");
    expect(verificador.modelo.length).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------------
// FALLO L-1 (bloqueante para esta prueba, NO para la demo): `familiaCanal`
// es una función de módulo SIN exportar en lib/agentes/analisis/verificador.ts
// (línea 22). La regla de negocio que implementa —"una noticia no confirma
// otra noticia": prensa y rrss son la misma familia, cámara/satélite/sensor
// otra, manual otra, y el resto (llamada/sms/email/telegram/web) es
// "ciudadano"— es de las más importantes del sistema y hoy no se puede
// probar de forma aislada. Petición abierta al constructor D. Hasta que se
// exporte, la regla queda cubierta solo por la
// prueba de integración de ingesta (que sí crea observaciones reales).
// -------------------------------------------------------------------------
describe.skip("familiaCanal · una noticia no confirma otra noticia (bloqueada: no se exporta)", () => {
  it("prensa y rrss son la misma familia", () => {
    // const { familiaCanal } = await import("@/lib/agentes/analisis/verificador");
    // expect(familiaCanal("prensa")).toBe(familiaCanal("rrss"));
  });

  it("cámara, satélite y sensor son la familia de observación instrumental", () => {
    // expect(familiaCanal("camara")).toBe(familiaCanal("satelite"));
    // expect(familiaCanal("satelite")).toBe(familiaCanal("sensor"));
  });

  it("una llamada del 112 SÍ confirma una noticia de prensa (familias distintas)", () => {
    // expect(familiaCanal("llamada")).not.toBe(familiaCanal("prensa"));
  });

  it("el canal manual es su propia familia (lo declara la sala)", () => {
    // expect(familiaCanal("manual")).toBe("humano");
  });
});
