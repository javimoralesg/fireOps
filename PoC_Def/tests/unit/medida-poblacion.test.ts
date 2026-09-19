// =====================================================================
// F3 · la frontera zod de protección de población.
// Prueba de CLASE 1: sin red, sin proveedor de IA.
//
// `decisionDeMedida` convierte lo que el modelo decide para UN pueblo en la
// Decision del dominio. Lo que se comprueba aquí es la parte que NO puede
// cambiar al agrupar las llamadas: la calibración del riesgo por medida, que
// es lo que decide si algo lo hace la máquina sola o lo firma una persona.
//
// Un aviso preventivo se recorta a riesgo 20 (autónomo por política) y el
// modelo NO puede inflarlo; un confinamiento o una evacuación se elevan a 70
// como mínimo (humano por política) y el modelo NO puede rebajarlo. Si esto
// se rompiera, una evacuación podría ejecutarse sola.
// DUEÑO: constructor L (escrito en la fase F3 de la migración).
// =====================================================================
import { describe, expect, it } from "vitest";
import { decisionDeMedida, type MedidaPoblacion } from "@/lib/agentes/planificacion/proteccion-poblacion";
import type { ContextoAgente } from "@/lib/motor/contratos";
import { Estado } from "@/lib/motor/estado";
import { incendio as fabricaIncendio, poblacion as fabricaPoblacion } from "./ayudas/dominio";

function contexto(): ContextoAgente {
  const estado = new Estado();
  return {
    estado,
    snapshot: estado.snapshot(),
    ahoraMundo: "2026-09-19T14:00:00.000Z",
    minutosMundoDesdeUltimoCiclo: 1,
    registrar: () => {},
    informarTarea: () => {},
    lecciones: [],
    abortSignal: new AbortController().signal,
  };
}

function medida(p: Partial<MedidaPoblacion> = {}): MedidaPoblacion {
  return {
    poblacionId: "osm:node/Navalacruz",
    medida: "avisar",
    titulo: "Aviso preventivo a Navalacruz",
    resumen: "El frente está a 40 minutos.",
    razonamiento: "Conviene que el ayuntamiento esté sobre aviso.",
    prioridad: 2,
    riesgo: 15,
    guionLlamada: "Buenos días, le llamo del centro de coordinación…",
    textoSms: "Incendio forestal cerca. Mantente informado y no te acerques.",
    ...p,
  };
}

const PUEBLO = fabricaPoblacion("Navalacruz", 3, 45, { id: "osm:node/Navalacruz", habitantes: 1200, telefono: "+34900000000" });
const FOCO = fabricaIncendio({ id: "inc-1", nombre: "Incendio de Navalacruz" });

describe("calibración del riesgo · lo que decide quién firma", () => {
  it("un aviso preventivo se recorta a 20 aunque el modelo pida más", () => {
    const d = decisionDeMedida(medida({ medida: "avisar", riesgo: 95 }), PUEBLO, FOCO, contexto(), []);
    expect(d.riesgo).toBeLessThanOrEqual(20);
    expect(d.competencia).toBe("autonoma");
  });

  it("un confinamiento sube a 70 como mínimo aunque el modelo diga 1", () => {
    const d = decisionDeMedida(medida({ medida: "confinar", riesgo: 1 }), PUEBLO, FOCO, contexto(), []);
    expect(d.riesgo).toBeGreaterThanOrEqual(70);
    expect(d.competencia).toBe("humano");
  });

  it("una evacuación siempre acaba en manos de una persona", () => {
    const d = decisionDeMedida(medida({ medida: "evacuar", riesgo: 0 }), PUEBLO, FOCO, contexto(), []);
    expect(d.riesgo).toBeGreaterThanOrEqual(70);
    expect(d.competencia).toBe("humano");
  });
});

describe("acciones · lo que se va a ejecutar de verdad", () => {
  it("un aviso lleva la acción de avisar y su difusión por Telegram", () => {
    const d = decisionDeMedida(medida(), PUEBLO, FOCO, contexto(), []);
    expect(d.acciones.map((a) => a.tipo)).toEqual(["avisar_poblacion", "enviar_telegram"]);
  });

  it("cada medida usa su tipo de acción", () => {
    for (const [m, tipo] of [["avisar", "avisar_poblacion"], ["confinar", "confinar_poblacion"], ["evacuar", "evacuar_poblacion"]] as const) {
      const d = decisionDeMedida(medida({ medida: m }), PUEBLO, FOCO, contexto(), []);
      expect(d.acciones[0].tipo).toBe(tipo);
    }
  });

  it("el guion y el SMS llegan a la acción, que es lo que ejecuta HappyRobot", () => {
    const d = decisionDeMedida(medida({ guionLlamada: "GUION", textoSms: "SMS" }), PUEBLO, FOCO, contexto(), []);
    expect(d.acciones[0].parametros?.guion).toBe("GUION");
    expect(d.acciones[0].parametros?.sms).toBe("SMS");
  });

  it("el SMS se recorta a 300 caracteres antes de salir", () => {
    const largo = "x".repeat(500);
    const d = decisionDeMedida(medida({ textoSms: largo }), PUEBLO, FOCO, contexto(), []);
    // El SMS va tal cual al operador de telefonía: 300 es el tope que acepta.
    expect((d.acciones[0].parametros?.sms as string).length).toBe(300);
    // El de Telegram lleva además el aviso y el nombre del pueblo, que es lo que
    // el vecino ve primero en la notificación.
    const telegram = d.acciones[1].parametros?.texto as string;
    expect(telegram.startsWith("⚠️ Navalacruz: ")).toBe(true);
    expect(telegram).toContain("x".repeat(300));
    expect(telegram).not.toContain("x".repeat(301));
  });

  it("usa el teléfono del pueblo si lo hay, y el de demostración si no", () => {
    const con = decisionDeMedida(medida(), PUEBLO, FOCO, contexto(), []);
    expect(con.acciones[0].objetivo?.telefono).toBe("+34900000000");

    const sinTelefono = fabricaPoblacion("Sin Teléfono", 4, 90, { id: "osm:node/ST", telefono: undefined });
    const sin = decisionDeMedida(medida({ poblacionId: "osm:node/ST" }), sinTelefono, FOCO, contexto(), [], "+34999999999");
    expect(sin.acciones[0].objetivo?.telefono).toBe("+34999999999");
  });
});

describe("trazabilidad · la decisión tiene que poder defenderse", () => {
  it("lleva el pueblo, el incendio y el agente", () => {
    const d = decisionDeMedida(medida(), PUEBLO, FOCO, contexto(), []);
    expect(d.agenteId).toBe("proteccion_poblacion");
    expect(d.incendioId).toBe("inc-1");
    expect(d.acciones[0].objetivo?.poblacionId).toBe(PUEBLO.id);
  });

  it("lleva la evidencia del modelo de propagación con distancia y riesgo", () => {
    const d = decisionDeMedida(medida(), PUEBLO, FOCO, contexto(), []);
    const eta = d.evidencias.find((e) => e.id.startsWith("ev-eta-"));
    expect(eta?.resumen).toContain("Navalacruz");
    expect(eta?.resumen).toContain("km");
  });

  it("lleva la evidencia de la meteorología con su fuente y su URL", () => {
    const d = decisionDeMedida(medida(), PUEBLO, FOCO, contexto(), []);
    const meteo = d.evidencias.find((e) => e.id.startsWith("ev-meteo-"));
    expect(meteo?.fuente).toBe("Open-Meteo");
    expect(meteo?.url).toBeTruthy();
  });

  it("arrastra las decisiones previas que se tuvieron en cuenta", () => {
    const d = decisionDeMedida(medida(), PUEBLO, FOCO, contexto(), ["dec-anterior"]);
    expect(d.decisionesPrevias).toEqual(["dec-anterior"]);
  });

  it("si el modelo no pone título, se genera uno que dice qué es", () => {
    const d = decisionDeMedida(medida({ titulo: "", medida: "evacuar" }), PUEBLO, FOCO, contexto(), []);
    expect(d.titulo).toContain("Evacuación");
    expect(d.titulo).toContain("Navalacruz");
  });
});

describe("agrupar no cambia el resultado", () => {
  it("dos pueblos del mismo foco producen decisiones independientes", () => {
    const otro = fabricaPoblacion("Villanueva", 6, 200, { id: "osm:node/Villanueva", habitantes: 300 });
    const a = decisionDeMedida(medida({ medida: "evacuar", riesgo: 90 }), PUEBLO, FOCO, contexto(), []);
    const b = decisionDeMedida(medida({ poblacionId: "osm:node/Villanueva", medida: "avisar", riesgo: 10 }), otro, FOCO, contexto(), []);

    // Que uno se evacúe no arrastra al de al lado: esta es la razón por la que
    // NO se funden en una sola decisión (lo haría la política con la acción más
    // restrictiva, y el aviso dejaría de ser autónomo).
    expect(a.competencia).toBe("humano");
    expect(b.competencia).toBe("autonoma");
    expect(a.id).not.toBe(b.id);
  });

  it("la misma medida produce la misma decisión (los ids son lo único que cambia)", () => {
    const uno = decisionDeMedida(medida(), PUEBLO, FOCO, contexto(), []);
    const dos = decisionDeMedida(medida(), PUEBLO, FOCO, contexto(), []);
    const comparable = (d: typeof uno) => ({
      titulo: d.titulo,
      resumen: d.resumen,
      razonamiento: d.razonamiento,
      prioridad: d.prioridad,
      riesgo: d.riesgo,
      competencia: d.competencia,
      incendioId: d.incendioId,
      acciones: d.acciones.map((a) => ({ tipo: a.tipo, descripcion: a.descripcion, objetivo: a.objetivo, parametros: a.parametros })),
      evidencias: d.evidencias,
    });
    expect(comparable(uno)).toEqual(comparable(dos));
  });
});
