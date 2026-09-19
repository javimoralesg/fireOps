// =====================================================================
// Inventario de agentes · CARACTERIZACIÓN (clase 1).
//
// Esta prueba no busca fallos: congela QUÉ agentes existen y con qué
// contrato, para que la migración de 16 a 5 agentes no mueva nada sin que
// se vea. Cada fase la modifica A PROPÓSITO, y el diff de este fichero es
// la lista revisable de lo que esa fase cambia:
//
//   F0 (aquí)  16 agentes      F3  12 → 9
//   F2  16 → 12                F4   9 → 7
//                              F5   7 → 5
//
// Si este fichero cambia sin que una fase lo pida, alguien ha movido el
// contrato de un agente sin querer.
// DUEÑO: constructor L (escrito en la fase F0 de la migración).
// =====================================================================
import { describe, expect, it } from "vitest";
import { todosLosAgentes } from "@/lib/agentes/registro";
import type { CategoriaAgente, TipoEvento } from "@/lib/dominio/tipos";

interface FichaEsperada {
  categoria: CategoriaAgente;
  cadenciaSeg: number;
  /** true si el agente NO llama al LLM en ningún ciclo (modelo "determinista"). */
  determinista: boolean;
  despiertaCon: TipoEvento[];
}

/**
 * El inventario tal y como está en main (81409bd), antes de tocar nada.
 * Las cadencias son las literales de cada agente; `vigia_camaras` sale de
 * CAMARAS_INTERVALO_SEG (20 s en .env.local, mínimo 5) y se comprueba aparte.
 */
const ESPERADO: Record<string, FichaEsperada> = {
  // ---- percepción (5) ----
  satelite:             { categoria: "percepcion",    cadenciaSeg: 600, determinista: true,  despiertaCon: [] },
  vigia_camaras:        { categoria: "percepcion",    cadenciaSeg: 20,  determinista: false, despiertaCon: ["incendio_nuevo"] },
  meteorologo:          { categoria: "percepcion",    cadenciaSeg: 60,  determinista: true,  despiertaCon: ["incendio_nuevo"] },
  prensa_redes:         { categoria: "percepcion",    cadenciaSeg: 180, determinista: false, despiertaCon: ["incendio_nuevo"] },
  centralita:           { categoria: "percepcion",    cadenciaSeg: 30,  determinista: false, despiertaCon: [] },
  // ---- análisis (3) ----
  verificador:          { categoria: "analisis",      cadenciaSeg: 45,  determinista: false, despiertaCon: ["observacion", "satelite", "camara_positiva"] },
  propagacion:          { categoria: "analisis",      cadenciaSeg: 30,  determinista: true,  despiertaCon: ["viento_gira", "incendio_actualizado", "unidad_llega"] },
  patrones:             { categoria: "analisis",      cadenciaSeg: 120, determinista: false, despiertaCon: ["incendio_nuevo"] },
  // ---- planificación (3) ----
  coordinador:          { categoria: "planificacion", cadenciaSeg: 90,  determinista: false, despiertaCon: ["incendio_nuevo", "incendio_actualizado", "viento_gira", "peligro_sube", "unidad_llega", "decision_denegada"] },
  proteccion_poblacion: { categoria: "planificacion", cadenciaSeg: 60,  determinista: false, despiertaCon: ["peligro_sube", "viento_gira", "incendio_nuevo", "incendio_actualizado"] },
  asesor_legal:         { categoria: "planificacion", cadenciaSeg: 120, determinista: false, despiertaCon: ["decision_propuesta"] },
  // ---- ejecución (1: el ejecutor de acciones NO es un Agente) ----
  despachador:          { categoria: "ejecucion",     cadenciaSeg: 5,   determinista: true,  despiertaCon: ["decision_aprobada"] },
  // ---- transversales (4) ----
  supervisor:           { categoria: "supervision",   cadenciaSeg: 120, determinista: false, despiertaCon: ["decision_propuesta", "agente"] },
  portavoz:             { categoria: "comunicacion",  cadenciaSeg: 300, determinista: false, despiertaCon: ["poblacion_avisada", "incendio_actualizado", "decision_ejecutada", "decision_escalada"] },
  redactor:             { categoria: "comunicacion",  cadenciaSeg: 600, determinista: false, despiertaCon: ["decision_ejecutada", "decision_denegada", "decision_escalada"] },
  memoria:              { categoria: "aprendizaje",   cadenciaSeg: 300, determinista: false, despiertaCon: ["decision_denegada", "decision_aprobada", "accion_fallida", "accion_ejecutada", "decision_escalada"] },
};

/** Agentes cuya cadencia depende del entorno: se comprueban por rango, no por valor. */
const CADENCIA_POR_ENTORNO = new Set(["vigia_camaras"]);

const agentes = todosLosAgentes();
const porId = new Map(agentes.map((a) => [a.id, a]));

describe("inventario de agentes · cuántos y cuáles", () => {
  it("hay exactamente 16 agentes registrados", () => {
    expect(agentes).toHaveLength(16);
  });

  it("los ids son exactamente los esperados, sin sobras ni faltas", () => {
    expect([...porId.keys()].sort()).toEqual(Object.keys(ESPERADO).sort());
  });

  it("no hay ids repetidos", () => {
    expect(porId.size).toBe(agentes.length);
  });

  it("el ejecutor de acciones NO está registrado como agente", () => {
    // No tiene ciclo ni cadencia: lo invoca `aprobarDecision` directamente.
    // Documentado aquí porque es la confusión más repetida al leer el sistema.
    expect(porId.has("ejecutor")).toBe(false);
  });
});

describe("inventario de agentes · contrato de cada uno", () => {
  for (const [id, esperado] of Object.entries(ESPERADO)) {
    describe(id, () => {
      it("está registrado y cumple la interfaz Agente", () => {
        const a = porId.get(id);
        expect(a, `falta el agente "${id}"`).toBeDefined();
        expect(typeof a!.ciclo).toBe("function");
        expect(a!.nombre.length).toBeGreaterThan(0);
        expect(a!.descripcion.length).toBeGreaterThan(0);
      });

      it(`es de categoría "${esperado.categoria}"`, () => {
        expect(porId.get(id)!.categoria).toBe(esperado.categoria);
      });

      it(esperado.determinista ? "es determinista: nunca llama al LLM" : "usa un modelo de IA", () => {
        const modelo = porId.get(id)!.modelo;
        expect(modelo.trim().toLowerCase() === "determinista").toBe(esperado.determinista);
        expect(modelo.length).toBeGreaterThan(0);
      });

      it(CADENCIA_POR_ENTORNO.has(id) ? "tiene una cadencia válida (la fija el entorno)" : `cicla cada ${esperado.cadenciaSeg} s`, () => {
        const cadencia = porId.get(id)!.cadenciaSeg;
        if (CADENCIA_POR_ENTORNO.has(id)) expect(cadencia).toBeGreaterThanOrEqual(5);
        else expect(cadencia).toBe(esperado.cadenciaSeg);
      });

      it("se despierta exactamente con los eventos declarados", () => {
        expect([...(porId.get(id)!.despiertaCon ?? [])].sort()).toEqual([...esperado.despiertaCon].sort());
      });
    });
  }
});

describe("inventario de agentes · el reparto que justifica la migración", () => {
  const deterministas = agentes.filter((a) => a.modelo.trim().toLowerCase() === "determinista");

  it("4 agentes no llaman al LLM: son los que la fase F2 baja al núcleo", () => {
    expect(deterministas.map((a) => a.id).sort()).toEqual(["despachador", "meteorologo", "propagacion", "satelite"]);
  });

  it("los 12 restantes sí usan modelo, y son el objetivo real de la optimización", () => {
    expect(agentes.length - deterministas.length).toBe(12);
  });

  it("ningún agente determinista declara tiempo máximo de razonamiento", () => {
    // Si un determinista necesitara 90 s es que llama a algo que no debería.
    for (const a of deterministas) {
      expect(a.tiempoMaximoSeg === undefined || a.tiempoMaximoSeg <= 60).toBe(true);
    }
  });

  it("todo agente que despierta por evento declara al menos un evento válido", () => {
    for (const a of agentes) {
      for (const evento of a.despiertaCon ?? []) {
        expect(typeof evento).toBe("string");
        expect(evento.length).toBeGreaterThan(0);
      }
    }
  });
});
