// =====================================================================
// PRUEBA DE INTENCIÓN de la fase F1, componente 1a.
//
// Falla ANTES del cambio y pasa DESPUÉS. Eso es lo que demuestra que la
// sustitución ocurrió de verdad; la red de no regresión
// (actas-deterministas.test.ts) demuestra que no se llevó nada por delante.
//
// Qué se exige: el acta de una ACCIÓN no gasta una llamada de razonamiento.
// Antes gastaba una por cada acción, sin condición, con tope de 5.000 tokens
// de salida. Medido en la instancia de desarrollo el 2026-09-19, en la cadena
// de auditoría de una decisión de 2 acciones:
//     tipo=accion   conNarrativaIA=True   modelo=glm5.3-flash
//     tipo=accion   conNarrativaIA=True   modelo=determinista
// Las actas de DECISIÓN en estado final conservan su narrativa: ahí sí hay una
// interpretación que aporta, y es una por decisión, no una por acción.
//
// Esta prueba corre sin red: si el acta de acción volviera a llamar al modelo,
// tardaría ~25 s y reventaría el tiempo máximo del proyecto `unit` (15 s).
// Es decir, la regresión se detecta por dos vías: por la aserción y por el reloj.
// DUEÑO: constructor L (escrito en la fase F1 de la migración).
// =====================================================================
import { afterEach, describe, expect, it } from "vitest";
import { generarActaAccion, generarActaDecision } from "@/lib/motor/actas";
import { establecerEstado, Estado } from "@/lib/motor/estado";
import type { Accion, Decision } from "@/lib/dominio/tipos";
import { incendio as fabricaIncendio, unidad as fabricaUnidad } from "./ayudas/dominio";

const ACCION: Accion = {
  id: "acc-1",
  tipo: "desplegar_unidad",
  descripcion: "Enviar Bomberos de Ávila al sector A",
  objetivo: { unidadId: "uni-1" },
  parametros: { sector: "A", incendioId: "inc-1" },
  estado: "ejecutada",
  autorizadaPor: "ia",
  ordenadaEn: "2026-09-19T14:05:00.000Z",
  ejecutadaEn: "2026-09-19T14:05:03.000Z",
  resultado: { en: "2026-09-19T14:05:03.000Z", proveedor: "OSRM", referencia: "ruta-1", resumen: "En ruta: 18,4 km.", exito: true },
};

function decision(p: Partial<Decision> = {}): Decision {
  return {
    id: "dec-1",
    ejecucionId: "ejec-1",
    agenteId: "coordinador",
    incendioId: "inc-1",
    titulo: "Ataque inicial — Navalacruz",
    resumen: "Enviar bomberos.",
    razonamiento: "Doctrina de ataque inicial.",
    prioridad: 1,
    riesgo: 25,
    competencia: "autonoma",
    estado: "ejecutada",
    acciones: [ACCION],
    evidencias: [],
    fundamentos: [],
    creadaEn: "2026-09-19T14:04:00.000Z",
    creadaEnMundo: "2026-09-19T14:04:00.000Z",
    historial: [{ en: "2026-09-19T14:04:00.000Z", enMundo: "2026-09-19T14:04:00.000Z", estado: "propuesta", quien: "coordinador" }],
    ...p,
  };
}

function montarEstado(d: Decision): Estado {
  const e = new Estado();
  e.guardar(e.incendios, fabricaIncendio({ id: "inc-1", nombre: "Incendio de Navalacruz" }));
  e.guardar(e.unidades, fabricaUnidad("bomberos", { id: "uni-1", nombre: "Bomberos de Ávila", incendioId: "inc-1" }));
  e.guardar(e.decisiones, d);
  establecerEstado(e);
  return e;
}

afterEach(() => {
  // Que una prueba no le deje su estado montado a la siguiente.
  establecerEstado(new Estado());
});

describe("F1 · el acta de una acción no gasta razonamiento", () => {
  it("se genera sin narrativa de IA y lo declara", async () => {
    const e = montarEstado(decision());
    const informe = await generarActaAccion("dec-1", "acc-1");

    expect(informe, "no se generó el acta de la acción").toBeDefined();
    expect(informe!.conNarrativaIA).toBe(false);
    expect(informe!.modelo).toBe("determinista");
    void e;
  });

  it("conserva los hechos y la huella: sigue siendo auditable", async () => {
    montarEstado(decision());
    const informe = await generarActaAccion("dec-1", "acc-1");

    expect(informe!.huella).toMatch(/^[0-9a-f]{64}$/);
    expect(informe!.tipo).toBe("accion");
    expect(informe!.accionId).toBe("acc-1");
    expect(informe!.contenido).toContain("Bomberos de Ávila");
    expect(informe!.contenido).toContain("**Resultado**: ÉXITO");
    expect(informe!.contenido).toContain("**Proveedor**: OSRM");
  });

  it("queda enganchada a su acción y a la decisión (cadena de custodia intacta)", async () => {
    const e = montarEstado(decision());
    const informe = await generarActaAccion("dec-1", "acc-1");

    const d = e.decisiones.get("dec-1")!;
    expect(d.acciones[0].informeId).toBe(informe!.id);
    expect(d.informeIds).toContain(informe!.id);
  });

  it("también levanta acta de una acción FALLIDA, y tampoco gasta razonamiento", async () => {
    const fallida: Accion = {
      ...ACCION,
      estado: "fallida",
      resultado: { en: "2026-09-19T14:05:03.000Z", proveedor: "HappyRobot", resumen: "Falta HAPPYROBOT_WORKFLOW_SLUG_VOZ", exito: false },
    };
    montarEstado(decision({ acciones: [fallida] }));
    const informe = await generarActaAccion("dec-1", "acc-1");

    expect(informe!.conNarrativaIA).toBe(false);
    expect(informe!.contenido).toContain("**Resultado**: FALLO");
    expect(informe!.contenido).toContain("Falta HAPPYROBOT_WORKFLOW_SLUG_VOZ");
  });

  it("es rápida: sin llamada al modelo, el acta se levanta en milisegundos", async () => {
    montarEstado(decision());
    const t0 = Date.now();
    await generarActaAccion("dec-1", "acc-1");
    // Una llamada de razonamiento ronda los 25 s (medido). 3 s es margen de sobra
    // para el trabajo determinista y no deja pasar una regresión.
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe("F1 · las actas de decisión conservan lo suyo", () => {
  it("los estados intermedios siguen sin narrativa, como ya era", async () => {
    montarEstado(decision({ estado: "aprobada" }));
    const informe = await generarActaDecision("dec-1", "aprobada");

    expect(informe!.conNarrativaIA).toBe(false);
    expect(informe!.modelo).toBe("determinista");
    expect(informe!.estadoDecision).toBe("aprobada");
    expect(informe!.huella).toMatch(/^[0-9a-f]{64}$/);
  });
});
