import { describe, expect, it } from "vitest";
import { ejecutarEnSombra, snapshotInmutable, type CapacidadSombra } from "@/lib/agentes/migracion/sombra";
import { Estado } from "@/lib/motor/estado";
import { decision, accion } from "./ayudas/dominio";

describe("ejecución en sombra", () => {
  it("clona y congela profundamente sin congelar el snapshot original", () => {
    const original = new Estado().snapshot();
    const copia = snapshotInmutable(original);

    expect(copia).not.toBe(original);
    expect(Object.isFrozen(copia)).toBe(true);
    expect(Object.isFrozen(copia.reloj)).toBe(true);
    expect(Object.isFrozen(copia.decisiones)).toBe(true);
    expect(Object.isFrozen(original)).toBe(false);
    expect(() => {
      (copia.reloj as { tick: number }).tick = 99;
    }).toThrow(TypeError);
    expect(original.reloj.tick).not.toBe(99);
  });

  it("entrega un contexto sin Estado ni callbacks de efectos", async () => {
    const snapshot = new Estado().snapshot();
    let claves: string[] = [];
    const capacidad: CapacidadSombra = {
      agenteLogicoId: "planificador_operativo",
      capacidadId: "coordinacion",
      async evaluar(ctx) {
        claves = Object.keys(ctx).sort();
        return { decisiones: [decision([accion("desplegar_unidad")])] };
      },
    };

    const plan = await ejecutarEnSombra(capacidad, snapshot);

    expect(claves).toEqual(["abortSignal", "ahoraMundo", "lecciones", "minutosMundoDesdeUltimoCiclo", "snapshot"]);
    expect(plan.aplicable).toBe(false);
    expect(plan.snapshotVersion).toBe(snapshot.version);
    expect(plan.resultado.decisiones).toHaveLength(1);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.resultado.decisiones?.[0].acciones)).toBe(true);
  });
});

