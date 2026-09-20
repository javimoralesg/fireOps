// =====================================================================
// F5 · supervisor por muestreo.
// Prueba de CLASE 1: sin red, sin IA.
//
// El supervisor evaluaba TODAS las decisiones, y su llamada va en el camino
// crítico: ~25 s medidos. Para un aviso preventivo de riesgo 20 que la
// política ya declara autónomo, esa espera no compra nada.
//
// ESTA ES LA PRUEBA DE GOBIERNO DE LA FASE. Lo que no puede pasar nunca es
// que una evacuación, un confinamiento o un corte de carretera se ejecuten
// sin que alguien independiente los haya mirado. Si alguna de estas pruebas
// hay que relajarla, la decisión de "por muestreo" está mal implementada.
// DUEÑO: constructor L (escrito en la fase F5 de la migración).
// =====================================================================
import { describe, expect, it } from "vitest";
import { accionesReservadasAPersona, requiereSupervisorIndependiente } from "@/lib/dominio/supervision";
import { politicaPorDefecto } from "@/lib/dominio/politica-defecto";
import type { Decision, TipoAccion } from "@/lib/dominio/tipos";
import { accion, decision } from "./ayudas/dominio";

const POLITICA = politicaPorDefecto();

function conAcciones(tipos: TipoAccion[], p: Partial<Decision> = {}): Decision {
  return decision(tipos.map((t) => accion(t)), { competencia: "autonoma", riesgo: 20, ...p });
}

describe("lo irreversible SIEMPRE lo mira el supervisor", () => {
  for (const tipo of ["evacuar_poblacion", "confinar_poblacion", "cortar_carretera", "elevar_nivel", "declarar_controlado"] as TipoAccion[]) {
    it(`${tipo} exige evaluación independiente`, () => {
      // Se fuerza el peor caso: aunque algo la hubiera dejado autónoma y de
      // riesgo bajo, la acción por sí sola basta para exigir supervisor.
      const r = requiereSupervisorIndependiente(conAcciones([tipo]), POLITICA);
      expect(r.procede).toBe(true);
      expect(r.motivo).toContain(tipo);
    });
  }

  it("basta con que UNA acción del plan sea irreversible", () => {
    const r = requiereSupervisorIndependiente(conAcciones(["enviar_sms", "evacuar_poblacion"]), POLITICA);
    expect(r.procede).toBe(true);
  });

  it("una acción fuera del catálogo cuenta como reservada: lista blanca", () => {
    const rara = { ...POLITICA, reglas: POLITICA.reglas.filter((x) => x.tipoAccion !== "enviar_sms") };
    expect(accionesReservadasAPersona(conAcciones(["enviar_sms"]), rara)).toEqual(["enviar_sms"]);
    expect(requiereSupervisorIndependiente(conAcciones(["enviar_sms"]), rara).procede).toBe(true);
  });
});

describe("lo que va a una persona también lo mira", () => {
  it("una decisión supervisada: la nota es la recomendación que lee el mando", () => {
    const r = requiereSupervisorIndependiente(conAcciones(["enviar_sms"], { competencia: "supervisada" }), POLITICA);
    expect(r.procede).toBe(true);
    expect(r.motivo).toContain("persona");
  });

  it("una decisión de competencia humana, igual", () => {
    expect(requiereSupervisorIndependiente(conAcciones(["enviar_sms"], { competencia: "humano" }), POLITICA).procede).toBe(true);
  });

  it("con alertas legales, siempre", () => {
    const d = conAcciones(["enviar_sms"], { alertasLegales: ["Falta la firma del Director del Plan"] });
    const r = requiereSupervisorIndependiente(d, POLITICA);
    expect(r.procede).toBe(true);
    expect(r.motivo).toContain("legales");
  });

  it("al llegar al umbral de supervisión, también", () => {
    const d = conAcciones(["enviar_sms"], { riesgo: POLITICA.umbralSupervisada });
    expect(requiereSupervisorIndependiente(d, POLITICA).procede).toBe(true);
  });
});

describe("la rutina autónoma se revisa después, no antes", () => {
  it("un aviso preventivo de riesgo 20 no espera al supervisor", () => {
    const r = requiereSupervisorIndependiente(conAcciones(["avisar_poblacion", "enviar_telegram"], { riesgo: 20 }), POLITICA);
    expect(r.procede).toBe(false);
    expect(r.motivo).toContain("a posteriori");
  });

  it("los avisos y registros de bajo riesgo tampoco", () => {
    for (const tipo of ["vigilar_camara", "abrir_ticket", "enviar_email", "enviar_telegram"] as TipoAccion[]) {
      expect(requiereSupervisorIndependiente(conAcciones([tipo], { riesgo: 15 }), POLITICA).procede).toBe(false);
    }
  });

  it("justo por debajo del umbral se salta, justo en el umbral no", () => {
    const debajo = conAcciones(["enviar_sms"], { riesgo: POLITICA.umbralSupervisada - 1 });
    const justo = conAcciones(["enviar_sms"], { riesgo: POLITICA.umbralSupervisada });
    expect(requiereSupervisorIndependiente(debajo, POLITICA).procede).toBe(false);
    expect(requiereSupervisorIndependiente(justo, POLITICA).procede).toBe(true);
  });

  it("siempre explica por qué, se salte o no: nada ocurre en silencio", () => {
    for (const d of [conAcciones(["enviar_sms"], { riesgo: 10 }), conAcciones(["evacuar_poblacion"])]) {
      expect(requiereSupervisorIndependiente(d, POLITICA).motivo.length).toBeGreaterThan(10);
    }
  });
});

describe("el muestreo sigue a la política, no al revés", () => {
  it("si el mando endurece la política, el muestreo se endurece solo", () => {
    const d = conAcciones(["publicar_comunicado"], { riesgo: 25 });
    expect(requiereSupervisorIndependiente(d, POLITICA).procede).toBe(false);

    // El mando decide en /politica que los comunicados los firma una persona.
    const dura = { ...POLITICA, reglas: POLITICA.reglas.map((r) => (r.tipoAccion === "publicar_comunicado" ? { ...r, modo: "humano" as const } : r)) };
    expect(requiereSupervisorIndependiente(d, dura).procede).toBe(true);
  });

  it("bajar el umbral de supervisión mete más decisiones en el muestreo", () => {
    const d = conAcciones(["enviar_sms"], { riesgo: 20 });
    expect(requiereSupervisorIndependiente(d, POLITICA).procede).toBe(false);
    expect(requiereSupervisorIndependiente(d, { ...POLITICA, umbralSupervisada: 10 }).procede).toBe(true);
  });
});
