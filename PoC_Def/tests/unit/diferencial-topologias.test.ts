import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compararDecisiones, normalizarDecision } from "@/lib/agentes/migracion/comparador";
import { seleccionarRegistroAgentes } from "@/lib/agentes/registro";
import type { CategoriaAgente, Decision, TipoEvento } from "@/lib/dominio/tipos";
import { accion, decision } from "./ayudas/dominio";
import contratoLegacyJson from "../fixtures/contrato-capacidades-legacy.json";

interface CadenciaVariable {
  variable: "CAMARAS_INTERVALO_SEG";
  valorPorDefecto: number;
  minimo: number;
}

interface CapacidadLegacyEsperada {
  id: string;
  agenteCanonicoId: string;
  categoria: CategoriaAgente;
  cadenciaSeg: number | CadenciaVariable;
  despiertaCon: TipoEvento[];
  cicloSha256: string;
}

const contratoLegacy = contratoLegacyJson as {
  version: number;
  origen: { commit: string; descripcion: string };
  capacidades: CapacidadLegacyEsperada[];
};

function cadenciaEsperada(valor: number | CadenciaVariable): number {
  if (typeof valor === "number") return valor;
  return Math.max(valor.minimo, Number(process.env[valor.variable] ?? valor.valorPorDefecto));
}

function huellaCiclo(ciclo: (...args: never[]) => unknown): string {
  return createHash("sha256").update(ciclo.toString()).digest("hex");
}

/**
 * Sonda estructurada: ids, prosa y fechas difieren deliberadamente entre
 * topologías. El comparador solo puede declararlas iguales si conserva el
 * productor lógico y la intención de la acción.
 */
function sondaSemantica(
  capacidadId: string,
  agenteId: string,
  indice: number,
  topologia: "legacy" | "five",
): Decision {
  return decision([
    accion("abrir_ticket", {
      id: `accion-${topologia}-${indice}`,
      descripcion: topologia === "legacy" ? "Descripción anterior" : "Redacción nueva",
      parametros: {
        capacidad: capacidadId,
        ordinal: indice,
        carga: Number((indice / 7).toFixed(8)),
        motivo: topologia === "legacy" ? "prosa antigua" : "prosa nueva",
      },
    }),
  ], {
    id: `decision-${topologia}-${indice}`,
    ejecucionId: `ejecucion-${topologia}`,
    agenteId,
    incendioId: `incendio-${indice % 3}`,
    titulo: topologia === "legacy" ? `Resultado previo ${capacidadId}` : `Resultado migrado ${capacidadId}`,
    resumen: topologia === "legacy" ? "Resumen previo" : "Resumen migrado",
    razonamiento: topologia === "legacy" ? "Razonamiento previo" : "Razonamiento migrado",
    prioridad: ((indice % 5) + 1) as Decision["prioridad"],
    riesgo: indice * 3.125,
    competencia: indice % 3 === 0 ? "humano" : "autonoma",
    creadaEn: topologia === "legacy" ? "2026-09-19T10:00:00.000Z" : "2030-01-01T12:00:00.000Z",
    creadaEnMundo: topologia === "legacy" ? "2026-09-19T10:00:00.000Z" : "2030-01-01T12:00:00.000Z",
  });
}

describe("diferencial determinista legacy ↔ five", () => {
  it("contrasta las 16 tareas reales contra un contrato independiente pre-cambio", () => {
    expect(contratoLegacy.version).toBe(1);
    expect(contratoLegacy.origen.commit).toBe("4649a5f");

    const legacy = seleccionarRegistroAgentes("legacy");
    const five = seleccionarRegistroAgentes("five");
    const porIdLegacy = new Map(legacy.tareas.map((tarea) => [tarea.capacidadId, tarea]));
    const porIdFive = new Map(five.tareas.map((tarea) => [tarea.capacidadId, tarea]));

    expect(legacy.tareas).toHaveLength(16);
    expect(five.tareas).toHaveLength(16);
    const idsEsperados = contratoLegacy.capacidades.map(({ id }) => id).sort();
    expect([...porIdLegacy.keys()].sort()).toEqual(idsEsperados);
    expect([...porIdFive.keys()].sort()).toEqual(idsEsperados);

    for (const esperado of contratoLegacy.capacidades) {
      const antes = porIdLegacy.get(esperado.id);
      const despues = porIdFive.get(esperado.id);
      expect(antes, `falta ${esperado.id} en legacy`).toBeDefined();
      expect(despues, `falta ${esperado.id} en five`).toBeDefined();

      // Es la misma implementación real, no una reescritura ni un mega-agente.
      expect(despues!.capacidad, `${esperado.id}: objeto ejecutable`).toBe(antes!.capacidad);
      expect(despues!.capacidad.ciclo, `${esperado.id}: función de ciclo`).toBe(antes!.capacidad.ciclo);

      // La huella evita que ambos lados puedan cambiar juntos y hacer pasar una
      // comparación tautológica: se contrasta con el cuerpo capturado pre-corte.
      expect(huellaCiclo(despues!.capacidad.ciclo), `${esperado.id}: cuerpo de ciclo`).toBe(esperado.cicloSha256);
      expect(despues!.capacidad.categoria, `${esperado.id}: categoría`).toBe(esperado.categoria);
      expect(despues!.capacidad.cadenciaSeg, `${esperado.id}: cadencia`).toBe(cadenciaEsperada(esperado.cadenciaSeg));
      expect(despues!.capacidad.despiertaCon ?? [], `${esperado.id}: disparadores`).toEqual(esperado.despiertaCon);
      expect(despues!.agenteId, `${esperado.id}: atribución`).toBe(esperado.agenteCanonicoId);
      expect(despues!.tareaId).toBe(`${esperado.agenteCanonicoId}/${esperado.id}`);
    }
  });

  it("reproduce un resultado semántico por capacidad y conserva su atribución lógica", () => {
    const legacy = seleccionarRegistroAgentes("legacy").tareas.map((tarea, indice) =>
      sondaSemantica(tarea.capacidadId, tarea.capacidadId, indice, "legacy"),
    );
    const five = seleccionarRegistroAgentes("five").tareas.map((tarea, indice) =>
      sondaSemantica(tarea.capacidadId, tarea.agenteId, indice, "five"),
    );

    const comparacion = compararDecisiones(legacy, five);
    expect(comparacion).toEqual({ equivalentes: true, faltan: [], sobran: [], cambios: [] });

    const padreEsperado = new Map(contratoLegacy.capacidades.map(({ id, agenteCanonicoId }) => [id, agenteCanonicoId]));
    const atribuciones = five.map((resultado, indice) => ({
      capacidadId: seleccionarRegistroAgentes("five").tareas[indice].capacidadId,
      agenteLogicoId: normalizarDecision(resultado).agenteLogicoId,
    }));
    expect(atribuciones).toEqual(
      seleccionarRegistroAgentes("five").tareas.map(({ capacidadId }) => ({
        capacidadId,
        agenteLogicoId: padreEsperado.get(capacidadId),
      })),
    );
  });

  it("el oráculo falla ante una pérdida real de semántica o una atribución incorrecta", () => {
    const tarea = seleccionarRegistroAgentes("five").tareas[0];
    const antes = sondaSemantica(tarea.capacidadId, tarea.capacidadId, 0, "legacy");

    const semanticaAlterada = sondaSemantica(tarea.capacidadId, tarea.agenteId, 0, "five");
    semanticaAlterada.acciones[0].parametros.ordinal = 999;
    expect(compararDecisiones([antes], [semanticaAlterada]).equivalentes).toBe(false);

    const atribucionAlterada = sondaSemantica(tarea.capacidadId, "guardian", 0, "five");
    const comparacion = compararDecisiones([antes], [atribucionAlterada]);
    expect(comparacion.equivalentes).toBe(false);
    expect(comparacion.faltan).toHaveLength(1);
    expect(comparacion.sobran).toHaveLength(1);
  });
});
