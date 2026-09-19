// Pruebas de lib/dominio/politica.ts · evaluarCompetencia. DUEÑO: constructor L.
// Lo que se valida: lista blanca, "manda la más restrictiva", umbrales globales,
// nivel de gravedad, alertas legales y que la IA no pueda rebajarse el riesgo.
import { describe, expect, it } from "vitest";
import { evaluarCompetencia } from "@/lib/dominio/politica";
import { politicaPorDefecto } from "@/lib/dominio/politica-defecto";
import type { TipoAccion } from "@/lib/dominio/tipos";
import { accion, decision, incendio } from "./ayudas/dominio";

const politica = () => politicaPorDefecto();

describe("evaluarCompetencia · lista blanca", () => {
  it("una acción fuera del catálogo la decide un humano y sube el riesgo a 90", () => {
    const d = decision([accion("inventada_por_la_ia" as TipoAccion)]);
    const r = evaluarCompetencia(d, politica());
    expect(r.competencia).toBe("humano");
    expect(r.riesgo).toBeGreaterThanOrEqual(90);
    expect(r.motivo).toContain("no está en el catálogo");
  });

  it("una acción del catálogo con modo autónomo se queda autónoma", () => {
    const r = evaluarCompetencia(decision([accion("vigilar_camara")]), politica());
    expect(r.competencia).toBe("autonoma");
    expect(r.riesgo).toBe(5); // riesgoMinimo de la regla
  });
});

describe("evaluarCompetencia · manda la acción más restrictiva", () => {
  it("autónoma + supervisada → supervisada", () => {
    const r = evaluarCompetencia(decision([accion("vigilar_camara"), accion("desplegar_unidad")]), politica());
    expect(r.competencia).toBe("supervisada");
  });

  it("supervisada + humana → humana (evacuar manda sobre desplegar)", () => {
    const r = evaluarCompetencia(decision([accion("desplegar_unidad"), accion("evacuar_poblacion")]), politica());
    expect(r.competencia).toBe("humano");
  });

  it("el orden de las acciones no cambia el resultado", () => {
    const a = evaluarCompetencia(decision([accion("evacuar_poblacion"), accion("vigilar_camara")]), politica());
    const b = evaluarCompetencia(decision([accion("vigilar_camara"), accion("evacuar_poblacion")]), politica());
    expect(a.competencia).toBe(b.competencia);
    expect(a.riesgo).toBe(b.riesgo);
  });

  it("el riesgo es el máximo de los riesgoMinimo de todas las acciones", () => {
    const r = evaluarCompetencia(decision([accion("abrir_ticket"), accion("solicitar_medios_aereos")]), politica());
    expect(r.riesgo).toBe(50); // solicitar_medios_aereos
  });
});

describe("evaluarCompetencia · la IA no se rebaja el riesgo", () => {
  it("un riesgo declarado bajo no baja del suelo de la regla", () => {
    const r = evaluarCompetencia(decision([accion("evacuar_poblacion")], { riesgo: 1 }), politica());
    expect(r.riesgo).toBe(85);
    expect(r.competencia).toBe("humano");
  });

  it("un riesgo negativo o absurdo se recorta a 0..100 antes de aplicar reglas", () => {
    const bajo = evaluarCompetencia(decision([accion("vigilar_camara")], { riesgo: -500 }), politica());
    expect(bajo.riesgo).toBe(5);
    const alto = evaluarCompetencia(decision([accion("vigilar_camara")], { riesgo: 10_000 }), politica());
    expect(alto.riesgo).toBe(100);
    expect(alto.competencia).toBe("humano");
  });

  it("un riesgo declarado ALTO sí se respeta (solo puede subir)", () => {
    const r = evaluarCompetencia(decision([accion("vigilar_camara")], { riesgo: 95 }), politica());
    expect(r.riesgo).toBe(95);
    expect(r.competencia).toBe("humano");
  });
});

describe("evaluarCompetencia · umbrales globales", () => {
  it("riesgo ≥ umbralSupervisada convierte una autónoma en supervisada", () => {
    const p = politica();
    p.umbralSupervisada = 5; // el suelo de vigilar_camara es exactamente 5
    const r = evaluarCompetencia(decision([accion("vigilar_camara")]), p);
    expect(r.competencia).toBe("supervisada");
    expect(r.motivo).toContain("≥");
  });

  it("riesgo ≥ umbralHumano manda sobre la regla de la acción", () => {
    const p = politica();
    p.umbralHumano = 20;
    const r = evaluarCompetencia(decision([accion("enviar_sms")]), p); // suelo 20
    expect(r.competencia).toBe("humano");
  });

  it("subir mucho los umbrales deja autónoma una decisión de riesgo medio", () => {
    const p = politica();
    p.umbralSupervisada = 99;
    p.umbralHumano = 100;
    const r = evaluarCompetencia(decision([accion("enviar_email")]), p);
    expect(r.competencia).toBe("autonoma");
  });
});

describe("evaluarCompetencia · nivel de gravedad del incendio", () => {
  it("un incendio de nivel ≥ nivelGravedadHumano fuerza competencia humana", () => {
    const p = politica(); // nivelGravedadHumano = 2
    const r = evaluarCompetencia(decision([accion("vigilar_camara")]), p, incendio({ nivelGravedad: 2 }));
    expect(r.competencia).toBe("humano");
    expect(r.motivo).toContain("nivel de gravedad 2");
  });

  it("por debajo del umbral de gravedad no cambia nada", () => {
    const r = evaluarCompetencia(decision([accion("vigilar_camara")]), politica(), incendio({ nivelGravedad: 1 }));
    expect(r.competencia).toBe("autonoma");
  });
});

describe("evaluarCompetencia · alertas legales", () => {
  it("cualquier alerta legal del asesor manda la decisión a un humano", () => {
    const d = decision([accion("vigilar_camara")], { alertasLegales: ["La evacuación compete al director del plan"] });
    const r = evaluarCompetencia(d, politica());
    expect(r.competencia).toBe("humano");
    expect(r.motivo).toContain("alertas legales");
  });

  it("un array de alertas vacío no cambia la competencia", () => {
    const r = evaluarCompetencia(decision([accion("vigilar_camara")], { alertasLegales: [] }), politica());
    expect(r.competencia).toBe("autonoma");
  });
});

describe("evaluarCompetencia · motivo siempre explicado", () => {
  it("sin nada que decir, el motivo lo dice explícitamente", () => {
    const r = evaluarCompetencia(decision([accion("vigilar_camara")]), politica());
    expect(r.motivo).toBe("todas las acciones son autónomas según la política");
  });

  it("una decisión sin acciones no puede ejecutar nada y queda autónoma con riesgo 0", () => {
    const r = evaluarCompetencia(decision([]), politica());
    expect(r.riesgo).toBe(0);
    expect(r.competencia).toBe("autonoma");
  });
});
