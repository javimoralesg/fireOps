// =====================================================================
// Inventario tras el corte: cinco fichas canónicas y 16 capacidades.
// =====================================================================
import { describe, expect, it } from "vitest";
import { registrarAgentes, seleccionarRegistroAgentes, todasLasCapacidades, todosLosAgentes } from "@/lib/agentes/registro";
import type { CategoriaAgente, TipoEvento } from "@/lib/dominio/tipos";
import { IDS_AGENTES_CANONICOS } from "@/lib/agentes/identidad";
import { Estado } from "@/lib/motor/estado";

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
  // F1b (2026-09-19): fuera `accion_ejecutada`. De que una acción salga bien no se
  // aprende, y disparaba una llamada de razonamiento por acción. Ver
  // tests/unit/memoria-aprende-de-fallos.test.ts.
  memoria:              { categoria: "aprendizaje",   cadenciaSeg: 300, determinista: false, despiertaCon: ["decision_denegada", "decision_aprobada", "accion_fallida", "decision_escalada"] },
};

/** Agentes cuya cadencia depende del entorno: se comprueban por rango, no por valor. */
const CADENCIA_POR_ENTORNO = new Set(["vigia_camaras"]);

const fichas = todosLosAgentes();
const agentes = todasLasCapacidades();
const porId = new Map<string, (typeof agentes)[number]>(agentes.map((a) => [a.id, a]));

describe("inventario de agentes · cuántos y cuáles", () => {
  it("hay exactamente cinco fichas canónicas", () => {
    expect(fichas).toHaveLength(5);
    expect(fichas.map((ficha) => ficha.id)).toEqual(IDS_AGENTES_CANONICOS);
    expect(fichas.every((ficha) => !("ciclo" in ficha))).toBe(true);
  });

  it("las 16 capacidades siguen accesibles, sin sobras ni faltas", () => {
    expect(agentes).toHaveLength(16);
    expect([...porId.keys()].sort()).toEqual(Object.keys(ESPERADO).sort());
  });

  it("selecciona fichas y tareas sin cambiar silenciosamente el modo por defecto", () => {
    expect(seleccionarRegistroAgentes("legacy")).toMatchObject({ autoridad: "legacy", ejecutarSombra: false });
    expect(seleccionarRegistroAgentes("legacy").fichas).toHaveLength(16);
    expect(seleccionarRegistroAgentes("shadow").fichas).toHaveLength(16);
    expect(seleccionarRegistroAgentes("shadow").ejecutarSombra).toBe(true);
    expect(seleccionarRegistroAgentes("five").fichas).toHaveLength(5);
    expect(seleccionarRegistroAgentes("five").tareas).toHaveLength(16);
  });

  it("al cambiar a five elimina las fichas legacy del estado", () => {
    const estado = new Estado();
    registrarAgentes(estado, "legacy");
    expect(estado.agentes.size).toBe(16);
    registrarAgentes(estado, "five");
    expect([...estado.agentes.keys()]).toEqual(IDS_AGENTES_CANONICOS);
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

describe("inventario de capacidades · contrato de cada una", () => {
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
