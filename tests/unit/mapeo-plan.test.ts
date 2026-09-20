// =====================================================================
// La frontera zod · conversión Plan → acciones (lib/agentes/planificacion/mapeo-plan.ts).
// Prueba de CLASE 1: sin red, sin proveedor de IA, sin estado vivo.
//
// Aquí NO se simula ninguna respuesta del modelo: se le pasa a una función
// pura un `Plan`, que es un dato de su tipo declarado. El propio sistema hace
// exactamente esto en producción —`planAtaqueInicial()` construye un Plan a
// mano y lo pasa por esta misma conversión— así que probarla así no inventa
// nada que el código no haga ya.
//
// Esta es la red de no regresión de la fase F3: cuando el coordinador, la
// protección de población y el analista de patrones se fundan en una sola
// llamada, el Plan cambiará de forma pero ESTA conversión debe seguir
// produciendo las mismas acciones para las mismas entradas.
// DUEÑO: constructor L (escrito en la fase F0 de la migración).
// =====================================================================
import { describe, expect, it } from "vitest";
import { accionesDelPlan, puntoDeSector, RUMBO_SECTOR, type EntornoPlan, type Plan } from "@/lib/agentes/planificacion/mapeo-plan";
import { haversine } from "@/lib/fuentes/geo";
import { incendio, unidad } from "./ayudas/dominio";

/** Plan vacío y válido: cada prueba cambia solo lo suyo. */
function plan(p: Partial<Plan> = {}): Plan {
  return {
    titulo: "Dispositivo de prueba",
    resumen: "Resumen",
    razonamiento: "Razonamiento",
    prioridad: 2,
    riesgo: 40,
    sectores: [{ nombre: "A", rumbo: "cabeza", descripcion: "Cabeza del incendio" }],
    despliegues: [],
    reasignaciones: [],
    retiradas: [],
    mediosAereos: { solicitar: false, tipo: "", motivo: "" },
    nivelPropuesto: 0,
    motivoNivel: "",
    ...p,
  };
}

/** Entorno mínimo: un foco con frente al NE y las unidades que se le pasen. */
function entorno(unidades: ReturnType<typeof unidad>[], p: Partial<EntornoPlan> = {}): EntornoPlan {
  return {
    incendio: incendio({ frente: { rumboGrados: 45, rumboTexto: "NE", velocidadMmin: 3, calculadoEn: "2026-09-19T14:00:00.000Z" } }),
    unidades: new Map(unidades.map((u) => [u.id, u])),
    candidatas: [],
    unidadesComprometidas: new Set(),
    hayMediosAereosVivos: false,
    hayElevarNivelVivo: false,
    ataqueInicial: false,
    ...p,
  };
}

const libre = (id: string) => unidad("bomberos", { id, nombre: `Bomberos ${id}`, estado: "disponible", incendioId: undefined });

describe("sectores · el rumbo se calcula sobre el frente, no sobre el norte", () => {
  it("la cabeza apunta al rumbo del frente", () => {
    const r = accionesDelPlan(plan(), entorno([]));
    expect(r.sectores).toEqual([{ nombre: "A", rumboGrados: 45 }]);
  });

  it("cada sector se desvía del frente lo que dice RUMBO_SECTOR", () => {
    const r = accionesDelPlan(
      plan({
        sectores: [
          { nombre: "A", rumbo: "cabeza", descripcion: "" },
          { nombre: "B", rumbo: "flanco_derecho", descripcion: "" },
          { nombre: "C", rumbo: "flanco_izquierdo", descripcion: "" },
          { nombre: "D", rumbo: "cola", descripcion: "" },
        ],
      }),
      entorno([]),
    );
    expect(r.sectores).toEqual([
      { nombre: "A", rumboGrados: 45 },
      { nombre: "B", rumboGrados: 135 },
      { nombre: "C", rumboGrados: 315 }, // 45 - 90 normalizado
      { nombre: "D", rumboGrados: 225 },
    ]);
    expect(RUMBO_SECTOR.cabeza).toBe(0);
  });

  it("sin frente conocido el rumbo de referencia es 0 (norte)", () => {
    const sinFrente = entorno([]);
    sinFrente.incendio = incendio({ frente: undefined });
    expect(accionesDelPlan(plan(), sinFrente).sectores).toEqual([{ nombre: "A", rumboGrados: 0 }]);
  });
});

describe("despliegues · solo se ordena lo que de verdad se puede ordenar", () => {
  it("despliega una unidad disponible al sector pedido", () => {
    const u = libre("uni-1");
    const r = accionesDelPlan(plan({ despliegues: [{ unidadId: "uni-1", sector: "A", motivo: "la más rápida" }] }), entorno([u]));

    expect(r.despliegue).toHaveLength(1);
    expect(r.despliegue[0].tipo).toBe("desplegar_unidad");
    expect(r.despliegue[0].objetivo?.unidadId).toBe("uni-1");
    expect(r.despliegue[0].parametros?.sector).toBe("A");
    expect(r.despliegue[0].parametros?.motivo).toBe("la más rápida");
  });

  it("ignora una unidad que el modelo se ha inventado", () => {
    const r = accionesDelPlan(plan({ despliegues: [{ unidadId: "no-existe", sector: "A", motivo: "x" }] }), entorno([]));
    expect(r.despliegue).toEqual([]);
  });

  it("ignora una unidad que ya no está disponible", () => {
    const ocupada = unidad("bomberos", { id: "uni-1", estado: "en_intervencion" });
    const r = accionesDelPlan(plan({ despliegues: [{ unidadId: "uni-1", sector: "A", motivo: "x" }] }), entorno([ocupada]));
    expect(r.despliegue).toEqual([]);
  });

  it("no pide dos veces una unidad ya comprometida por otra decisión viva", () => {
    const u = libre("uni-1");
    const r = accionesDelPlan(
      plan({ despliegues: [{ unidadId: "uni-1", sector: "A", motivo: "x" }] }),
      entorno([u], { unidadesComprometidas: new Set(["uni-1"]) }),
    );
    expect(r.despliegue).toEqual([]);
  });

  it("el tiempo real por carretera entra en la descripción cuando se conoce", () => {
    const u = libre("uni-1");
    const con = accionesDelPlan(
      plan({ despliegues: [{ unidadId: "uni-1", sector: "A", motivo: "x" }] }),
      entorno([u], { candidatas: [{ unidadId: "uni-1", minutosCarretera: 17 }] }),
    );
    expect(con.despliegue[0].descripcion).toContain("17 min por carretera");
    expect(con.despliegue[0].parametros?.minutosCarretera).toBe(17);

    const sin = accionesDelPlan(plan({ despliegues: [{ unidadId: "uni-1", sector: "A", motivo: "x" }] }), entorno([u]));
    expect(sin.despliegue[0].descripcion).not.toContain("por carretera");
  });

  it("marca el ataque inicial en los parámetros: de ahí depende la vía rápida de la política", () => {
    const u = libre("uni-1");
    const r = accionesDelPlan(
      plan({ despliegues: [{ unidadId: "uni-1", sector: "A", motivo: "x" }] }),
      entorno([u], { ataqueInicial: true }),
    );
    expect(r.despliegue[0].parametros?.ataqueInicial).toBe(true);
  });

  it("el destino cae fuera del perímetro, en el rumbo del sector", () => {
    const u = libre("uni-1");
    const e = entorno([u]);
    const r = accionesDelPlan(plan({ despliegues: [{ unidadId: "uni-1", sector: "A", motivo: "x" }] }), e);
    const destino = r.despliegue[0].parametros?.destino as { lat: number; lon: number };

    expect(destino).toEqual(puntoDeSector(e.incendio, 45));
    // Se trabaja desde el borde: nunca en el centro del fuego.
    expect(haversine(destino, e.incendio.centro)).toBeGreaterThan(0.1);
  });

  it("un sector que el modelo no declaró se trata como cabeza", () => {
    const u = libre("uni-1");
    const e = entorno([u]);
    const r = accionesDelPlan(plan({ despliegues: [{ unidadId: "uni-1", sector: "Z", motivo: "x" }] }), e);
    expect(r.despliegue[0].parametros?.destino).toEqual(puntoDeSector(e.incendio, 45));
  });
});

describe("reasignaciones · traer una unidad de otro foco", () => {
  it("reasigna una unidad que está en otro incendio", () => {
    const otra = unidad("brif", { id: "uni-2", incendioId: "inc-otro" });
    const r = accionesDelPlan(plan({ reasignaciones: [{ unidadId: "uni-2", sector: "A", motivo: "hace más falta aquí" }] }), entorno([otra]));

    expect(r.despliegue).toHaveLength(1);
    expect(r.despliegue[0].tipo).toBe("reasignar_unidad");
    expect(r.despliegue[0].parametros?.desdeIncendioId).toBe("inc-otro");
  });

  it("no reasigna una unidad que ya es de este foco", () => {
    const mia = unidad("brif", { id: "uni-2", incendioId: "inc-prueba" });
    const r = accionesDelPlan(plan({ reasignaciones: [{ unidadId: "uni-2", sector: "A", motivo: "x" }] }), entorno([mia]));
    expect(r.despliegue).toEqual([]);
  });
});

describe("medios aéreos y nivel · no se piden dos veces", () => {
  it("pide medios aéreos cuando el plan lo dice", () => {
    const r = accionesDelPlan(plan({ mediosAereos: { solicitar: true, tipo: "hidroavión", motivo: "pasto y viento" } }), entorno([]));
    expect(r.despliegue).toHaveLength(1);
    expect(r.despliegue[0].tipo).toBe("solicitar_medios_aereos");
    expect(r.despliegue[0].parametros?.tipo).toBe("hidroavión");
  });

  it("no los pide si ya hay una decisión viva pidiéndolos", () => {
    const r = accionesDelPlan(
      plan({ mediosAereos: { solicitar: true, tipo: "hidroavión", motivo: "x" } }),
      entorno([], { hayMediosAereosVivos: true }),
    );
    expect(r.despliegue).toEqual([]);
  });

  it("propone elevar el nivel solo si el propuesto supera al actual", () => {
    const sube = accionesDelPlan(plan({ nivelPropuesto: 1, motivoNivel: "población en riesgo" }), entorno([]));
    expect(sube.mando.map((a) => a.tipo)).toEqual(["elevar_nivel"]);
    expect(sube.mando[0].parametros?.nivel).toBe(1);

    const igual = accionesDelPlan(plan({ nivelPropuesto: 0 }), entorno([]));
    expect(igual.mando).toEqual([]);
  });

  it("no propone elevar el nivel si ya hay una propuesta viva", () => {
    const r = accionesDelPlan(plan({ nivelPropuesto: 2, motivoNivel: "x" }), entorno([], { hayElevarNivelVivo: true }));
    expect(r.mando).toEqual([]);
  });
});

describe("retiradas · seguridad del personal", () => {
  it("retira una unidad que trabaja en este foco", () => {
    const mia = unidad("bomberos", { id: "uni-3", incendioId: "inc-prueba" });
    const r = accionesDelPlan(plan({ retiradas: [{ unidadId: "uni-3", motivo: "el frente rola sobre ella" }] }), entorno([mia]));

    expect(r.mando).toHaveLength(1);
    expect(r.mando[0].tipo).toBe("retirar_unidad");
    expect(r.mando[0].objetivo?.unidadId).toBe("uni-3");
    expect(r.mando[0].parametros?.motivo).toBe("el frente rola sobre ella");
  });

  it("no retira una unidad de otro foco", () => {
    const ajena = unidad("bomberos", { id: "uni-4", incendioId: "inc-otro" });
    const r = accionesDelPlan(plan({ retiradas: [{ unidadId: "uni-4", motivo: "x" }] }), entorno([ajena]));
    expect(r.mando).toEqual([]);
  });
});

describe("la conversión es pura", () => {
  it("no muta el plan ni el entorno que recibe", () => {
    const u = libre("uni-1");
    const p = plan({ despliegues: [{ unidadId: "uni-1", sector: "A", motivo: "x" }], nivelPropuesto: 1 });
    const e = entorno([u]);
    const copiaPlan = structuredClone(p);
    const copiaIncendio = structuredClone(e.incendio);

    accionesDelPlan(p, e);

    expect(p).toEqual(copiaPlan);
    expect(e.incendio).toEqual(copiaIncendio);
    expect(u.estado).toBe("disponible");
  });

  it("dos llamadas iguales producen el mismo resultado", () => {
    const u = libre("uni-1");
    const p = plan({ despliegues: [{ unidadId: "uni-1", sector: "A", motivo: "x" }], nivelPropuesto: 2, motivoNivel: "m" });
    expect(accionesDelPlan(p, entorno([u]))).toEqual(accionesDelPlan(p, entorno([u])));
  });

  it("un plan vacío no propone nada, y no revienta", () => {
    const r = accionesDelPlan(plan({ sectores: [] }), entorno([]));
    expect(r).toEqual({ sectores: [], despliegue: [], mando: [] });
  });
});
