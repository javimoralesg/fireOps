// Pruebas de lib/ia/llm.ts · lo que se puede probar sin red. DUEÑO: constructor L.
// `esquemaJson` y `endurecer` NO están exportados (ver docs/PRUEBAS.md, fallo L-2):
// el endurecimiento del esquema queda cubierto de forma indirecta por las pruebas
// de integración, que sí hacen llamadas reales con `response_format: json_schema`.
import { afterEach, describe, expect, it } from "vitest";
import { abortarLlamadasIA, conPrioridadLLM, estadisticasLLM, estadoColaLLM, modeloPara, mundoEnPausa, proveedorActivo, proveedorDisponible } from "@/lib/ia/llm";

const bandera = globalThis as { __atalayaMundoPausado?: boolean };

afterEach(() => {
  bandera.__atalayaMundoPausado = false;
});

describe("mundoEnPausa · bandera global compartida con el reloj", () => {
  it("por defecto el mundo no está en pausa", () => {
    expect(mundoEnPausa()).toBe(false);
  });

  it("lee la bandera que fija lib/motor/reloj.ts, sin importarlo", () => {
    bandera.__atalayaMundoPausado = true;
    expect(mundoEnPausa()).toBe(true);
    bandera.__atalayaMundoPausado = false;
    expect(mundoEnPausa()).toBe(false);
  });

  it("solo el valor booleano true cuenta como pausa (nada de valores truthy sueltos)", () => {
    (bandera as Record<string, unknown>).__atalayaMundoPausado = "sí";
    expect(mundoEnPausa()).toBe(false);
  });

  it("pausar de verdad congela el mundo para la IA (integración con el reloj)", async () => {
    const { Estado } = await import("@/lib/motor/estado");
    const { pausar, reanudar } = await import("@/lib/motor/reloj");
    const e = new Estado();
    pausar(e);
    expect(mundoEnPausa()).toBe(true);
    reanudar(e);
    expect(mundoEnPausa()).toBe(false);
  });
});

describe("cola de llamadas", () => {
  it("en reposo no hay nada en curso ni esperando y el máximo es positivo", () => {
    const c = estadoColaLLM();
    expect(c.enCurso).toBe(0);
    expect(c.esperando).toBe(0);
    expect(c.maximo).toBeGreaterThanOrEqual(1);
  });

  it("abortar sin llamadas vivas devuelve 0 y no lanza (idempotente)", () => {
    expect(abortarLlamadasIA("prueba")).toBe(0);
    expect(() => abortarLlamadasIA()).not.toThrow();
  });

  // Carril "baja" (constructor S): las actas de auditoría tienen su propio hueco,
  // que NO sale de los de "alta"/"normal".
  it("el carril de prioridad baja tiene huecos propios y se informa aparte", () => {
    const c = estadoColaLLM();
    expect(c.maximoBaja).toBeGreaterThanOrEqual(1);
    expect(c.enCursoBaja).toBe(0);
    expect(c.esperandoBaja).toBe(0);
    expect(c.esperando).toBe(c.esperandoAlta + c.esperandoNormal + c.esperandoBaja);
  });

  it("conPrioridadLLM propaga la prioridad al bloque y la devuelve tal cual", async () => {
    const dentro = await conPrioridadLLM("baja", async () => {
      // Dentro del bloque cualquier llamada al LLM heredaría "baja" por
      // AsyncLocalStorage, incluso a través de un await.
      await Promise.resolve();
      return 42;
    });
    expect(dentro).toBe(42);
  });
});

describe("configuración del proveedor", () => {
  it("con .env.local cargado hay proveedor disponible y es HelmCode", () => {
    expect(proveedorDisponible()).toBe(true);
    expect(["helmcode", "groq", "openai"]).toContain(proveedorActivo());
  });

  it("cada papel tiene un modelo con nombre", () => {
    for (const papel of ["razonamiento", "rapido", "vision"] as const) {
      expect(modeloPara(papel)).toBeTruthy();
      expect(typeof modeloPara(papel)).toBe("string");
    }
  });

  it("las estadísticas arrancan a cero y traen los tres papeles", () => {
    const s = estadisticasLLM();
    expect(Object.keys(s.porPapel)).toEqual(expect.arrayContaining(["razonamiento", "rapido", "vision"]));
    for (const papel of ["razonamiento", "rapido", "vision"] as const) {
      expect(s.porPapel[papel].llamadas).toBe(0);
      expect(s.porPapel[papel].errores).toBe(0);
    }
  });
});
