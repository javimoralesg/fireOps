// Pruebas de lib/motor/traza.ts · trazas de ciclo por agente. DUEÑO: constructor L.
import { describe, expect, it } from "vitest";
import type { EstadoAgenteApp } from "@/lib/dominio/tipos";
import { Estado } from "@/lib/motor/estado";
import { agenteActual, anotarLlamadaIA, anotarTraza, ejecutarConTraza, resumir, sinTraza, trazaActual } from "@/lib/motor/traza";

const AGENTE = "coordinador";

function estadoConAgente(): Estado {
  const e = new Estado();
  const agente: EstadoAgenteApp = {
    id: AGENTE,
    nombre: "Coordinador",
    categoria: "planificacion",
    descripcion: "Prueba",
    modelo: "modelo-de-prueba",
    estado: "observando",
    cadenciaSeg: 90,
    contadores: { ciclos: 0, decisiones: 0, acciones: 0, errores: 0 },
    pausado: false,
    controlHumano: false,
  };
  e.agentes.set(AGENTE, agente);
  return e;
}

const trazas = (e: Estado) => e.agentes.get(AGENTE)?.trazas ?? [];

/** Llamada a la IA mínima según el contrato `LlamadaIA`. */
const llamada = (modelo: string) => ({
  proveedor: "helmcode",
  modelo,
  papel: "razonamiento" as const,
  latenciaMs: 1200,
  promptResumen: "prompt",
  respuestaResumen: "respuesta",
});

describe("ejecutarConTraza", () => {
  it("publica la traza al empezar (en_curso) y la cierra en ok", async () => {
    const e = estadoConAgente();
    let enMedio: string | undefined;
    await ejecutarConTraza(e, AGENTE, "cadencia", async () => {
      enMedio = trazas(e)[0]?.estado;
      return 42;
    });
    expect(enMedio).toBe("en_curso");
    const t = trazas(e)[0];
    expect(t.estado).toBe("ok");
    expect(t.motivo).toBe("cadencia");
    expect(t.fin).toBeTruthy();
    expect(t.duracionMs).toBeGreaterThanOrEqual(0);
  });

  it("devuelve el valor de la función", async () => {
    const e = estadoConAgente();
    await expect(ejecutarConTraza(e, AGENTE, "cadencia", async () => "hola")).resolves.toBe("hola");
  });

  it("un fallo cierra la traza en error, guarda el mensaje y relanza", async () => {
    const e = estadoConAgente();
    await expect(
      ejecutarConTraza(e, AGENTE, "evento", async () => {
        throw new Error("se cayó Overpass");
      }),
    ).rejects.toThrow("se cayó Overpass");
    const t = trazas(e)[0];
    expect(t.estado).toBe("error");
    expect(t.error).toBe("se cayó Overpass");
    expect(t.fin).toBeTruthy();
  });

  it("un AbortError cierra la traza como cancelado, no como error", async () => {
    const e = estadoConAgente();
    await expect(
      ejecutarConTraza(e, AGENTE, "evento", async () => {
        throw Object.assign(new Error("Mundo en pausa"), { name: "AbortError" });
      }),
    ).rejects.toThrow();
    expect(trazas(e)[0].estado).toBe("cancelado");
  });

  it("no se guardan más de 20 trazas por agente", async () => {
    const e = estadoConAgente();
    for (let i = 0; i < 25; i++) await ejecutarConTraza(e, AGENTE, `ciclo ${i}`, async () => i);
    expect(trazas(e)).toHaveLength(20);
    expect(trazas(e)[19].motivo).toBe("ciclo 24");
  });

  it("agenteActual y trazaActual solo existen dentro del ciclo", async () => {
    const e = estadoConAgente();
    expect(agenteActual()).toBeUndefined();
    expect(trazaActual()).toBeUndefined();
    await ejecutarConTraza(e, AGENTE, "cadencia", async (traza) => {
      expect(agenteActual()).toBe(AGENTE);
      expect(trazaActual()?.id).toBe(traza.id);
    });
    expect(agenteActual()).toBeUndefined();
  });
});

describe("anotarLlamadaIA", () => {
  it("anota la llamada en la traza del ciclo en curso", async () => {
    const e = estadoConAgente();
    await ejecutarConTraza(e, AGENTE, "cadencia", async () => {
      anotarLlamadaIA(llamada("glm5.3-flash"));
    });
    const llamadas = trazas(e)[0].llamadasIA;
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].modelo).toBe("glm5.3-flash");
    expect(Date.parse(llamadas[0].en)).toBeGreaterThan(0);
  });

  it("FUERA de un ciclo no hace nada y no lanza (requisito del contrato)", () => {
    expect(() => anotarLlamadaIA(llamada("suelta"))).not.toThrow();
  });

  it("se queda con las últimas 30 llamadas de un ciclo", async () => {
    const e = estadoConAgente();
    await ejecutarConTraza(e, AGENTE, "cadencia", async () => {
      for (let i = 0; i < 35; i++) anotarLlamadaIA(llamada(`m${i}`));
    });
    const llamadas = trazas(e)[0].llamadasIA;
    expect(llamadas).toHaveLength(30);
    expect(llamadas[0].modelo).toBe("m5");
    expect(llamadas[29].modelo).toBe("m34");
  });

  it("no se filtra a la traza de otro agente", async () => {
    const e = estadoConAgente();
    e.agentes.set("supervisor", { ...e.agentes.get(AGENTE)!, id: "supervisor", nombre: "Supervisor", trazas: undefined });
    await ejecutarConTraza(e, AGENTE, "cadencia", async () => {
      anotarLlamadaIA(llamada("m"));
    });
    expect(e.agentes.get("supervisor")?.trazas ?? []).toHaveLength(0);
  });

  it("publica la traza de una capacidad histórica en su padre de cinco", async () => {
    const e = estadoConAgente();
    const ficha = e.agentes.get(AGENTE)!;
    e.agentes.delete(AGENTE);
    e.agentes.set("planificador_operativo", { ...ficha, id: "planificador_operativo", nombre: "Planificador operativo" });

    await ejecutarConTraza(e, AGENTE, "evento", async () => {
      anotarLlamadaIA(llamada("migracion"));
      expect(agenteActual()).toBe(AGENTE);
    });

    expect(e.agentes.get("planificador_operativo")?.trazas?.[0]).toMatchObject({ motivo: "evento", estado: "ok" });
  });
});

describe("sinTraza", () => {
  it("el trabajo lanzado en segundo plano NO contamina la traza del agente", async () => {
    const e = estadoConAgente();
    await ejecutarConTraza(e, AGENTE, "cadencia", async () => {
      sinTraza(() => {
        expect(agenteActual()).toBeUndefined();
        anotarLlamadaIA(llamada("supervisor"));
      });
      anotarLlamadaIA(llamada("coordinador"));
    });
    const llamadas = trazas(e)[0].llamadasIA;
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].modelo).toBe("coordinador");
  });
});

describe("anotarTraza y resumir", () => {
  it("anotarTraza completa entradas y resumen del ciclo en curso", async () => {
    const e = estadoConAgente();
    await ejecutarConTraza(e, AGENTE, "cadencia", async () => {
      anotarTraza({ resumen: "2 focos revisados", eventos: 3, decisiones: ["dec-1"] });
    });
    const t = trazas(e)[0];
    expect(t.resumen).toBe("2 focos revisados");
    expect(t.eventos).toBe(3);
    expect(t.decisiones).toEqual(["dec-1"]);
  });

  it("resumir recorta y normaliza espacios", () => {
    expect(resumir("  hola   mundo \n ")).toBe("hola mundo");
    const largo = resumir("x".repeat(1000), 100);
    expect(largo).toHaveLength(101); // 100 caracteres + el puntos suspensivos
    expect(largo.endsWith("…")).toBe(true);
  });
});
