// Pruebas de lib/simulacion/propagacion.ts · modelo elíptico. DUEÑO: constructor L.
// Escenario de referencia: pasto, viento de 35 km/h del SO (225°) → frente al NE (45°).
import { describe, expect, it } from "vitest";
import { haversine } from "@/lib/fuentes/geo";
import { areaHa } from "@/lib/simulacion/geometria";
import {
  RADIO_INICIAL_M,
  SEMICONO_GRADOS,
  condicionesDe,
  evaluarPoblaciones,
  excentricidad,
  factorEstado,
  perimetroInicial,
  predecir,
  propagar,
  relacionLongitudAnchura,
  velocidadCabezaMmin,
  velocidadEnAngulo,
  vientoEfectivoKmh,
} from "@/lib/simulacion/propagacion";
import { combustible, incendio, meteo, poblacion } from "./ayudas/dominio";

/** Radios (m) del perímetro medidos desde el centro, uno por vértice. */
const radiosDe = (centro: { lat: number; lon: number }, perimetro: [number, number][]) =>
  perimetro.map(([lat, lon]) => haversine(centro, { lat, lon }) * 1000);

describe("bloques del modelo", () => {
  it("el viento efectivo es el mayor entre la media y el 85 % de la racha", () => {
    expect(vientoEfectivoKmh({ vientoKmh: 20, rachasKmh: 40 })).toBeCloseTo(34, 6);
    expect(vientoEfectivoKmh({ vientoKmh: 35, rachasKmh: 40 })).toBeCloseTo(35, 6);
    expect(vientoEfectivoKmh({ vientoKmh: 0, rachasKmh: 0 })).toBe(0);
  });

  it("la relación longitud/anchura va de 1 (calma) a 8 (saturada)", () => {
    expect(relacionLongitudAnchura({ vientoKmh: 0, rachasKmh: 0 })).toBe(1);
    expect(relacionLongitudAnchura({ vientoKmh: 10, rachasKmh: 0 })).toBeCloseTo(3, 6);
    expect(relacionLongitudAnchura({ vientoKmh: 100, rachasKmh: 0 })).toBe(8);
  });

  it("sin viento la elipse es un círculo: excentricidad 0 y misma velocidad en todos los ángulos", () => {
    expect(excentricidad(1)).toBe(0);
    expect(velocidadEnAngulo(5, 1, 0)).toBeCloseTo(velocidadEnAngulo(5, 1, 180), 6);
  });

  it("con viento la cabeza va mucho más rápido que la cola", () => {
    const lb = 8;
    expect(velocidadEnAngulo(60, lb, 0)).toBeGreaterThan(velocidadEnAngulo(60, lb, 180) * 20);
  });

  it("el estado del incendio frena o para el avance", () => {
    expect(factorEstado("activo")).toBe(1);
    expect(factorEstado("estabilizado")).toBe(0.2);
    expect(factorEstado("controlado")).toBe(0);
    expect(factorEstado("extinguido")).toBe(0);
    expect(factorEstado("descartado")).toBe(0);
  });

  it("condicionesDe devuelve undefined sin meteo (nada simulado)", () => {
    expect(condicionesDe(incendio({ meteo: undefined }))).toBeUndefined();
  });

  it("pasto arde más rápido que bosque con la misma meteo", () => {
    const c = condicionesDe(incendio())!;
    expect(velocidadCabezaMmin({ ...c, combustible: "pasto" })).toBeGreaterThan(velocidadCabezaMmin({ ...c, combustible: "bosque" }));
    expect(velocidadCabezaMmin({ ...c, combustible: "bosque" })).toBeGreaterThan(velocidadCabezaMmin({ ...c, combustible: "urbano" }));
  });

  it("la pendiente acelera el fuego ladera arriba", () => {
    const c = condicionesDe(incendio())!;
    expect(velocidadCabezaMmin({ ...c, pendientePct: 30 })).toBeGreaterThan(velocidadCabezaMmin({ ...c, pendientePct: 0 }));
  });

  it("la lluvia sobre el foco reduce la velocidad a la mitad", () => {
    const c = condicionesDe(incendio())!;
    const seco = velocidadCabezaMmin({ ...c, precipitacionMm: 0 });
    const lloviendo = velocidadCabezaMmin({ ...c, precipitacionMm: 1.5 });
    expect(lloviendo / seco).toBeCloseTo(0.5, 2);
  });
});

describe("propagar · pasto con 35 km/h durante 60 minutos", () => {
  const foco = incendio();
  const r = propagar(foco, 60);

  it("crece decenas de hectáreas (partiendo de ~1 ha)", () => {
    expect(foco.areaHa).toBeLessThan(2);
    expect(r.areaHa).toBeGreaterThan(20);
    expect(r.areaHa).toBeLessThan(500);
  });

  it("el frente apunta al NE (sotavento del viento del SO)", () => {
    expect(r.frente?.rumboGrados).toBeCloseTo(45, 1);
    expect(r.frente?.rumboTexto).toBe("NE");
    expect(r.frente!.velocidadMmin).toBeGreaterThan(40);
  });

  it("la lengua se alarga hacia el NE: el radio al NE es ≥ 10× el radio al SO", () => {
    const radios = radiosDe(foco.centro, r.perimetro);
    const paso = 360 / (r.perimetro.length - 1); // el último vértice repite el primero
    const iNE = Math.round(45 / paso);
    const iSO = Math.round(225 / paso);
    expect(radios[iNE]).toBeGreaterThan(radios[iSO] * 10);
    expect(radios[iNE]).toBeGreaterThan(2000); // ~60 m/min × 60 min
  });

  it("propagar es puro: no muta el incendio recibido", () => {
    const original = incendio();
    const antes = JSON.stringify(original);
    propagar(original, 120);
    expect(JSON.stringify(original)).toBe(antes);
  });

  it("el área crece de forma monótona con el tiempo", () => {
    const areas = [0, 15, 30, 60, 120].map((m) => propagar(foco, m).areaHa!);
    for (let i = 1; i < areas.length; i++) expect(areas[i]).toBeGreaterThan(areas[i - 1]);
  });
});

describe("propagar · sin viento", () => {
  const enCalma = incendio({ meteo: meteo({ vientoKmh: 0, rachasKmh: 0, direccionGrados: 0, direccionTexto: "N" }) });
  const r = propagar(enCalma, 60);

  it("crece poco comparado con el escenario ventoso (menos de la quinta parte)", () => {
    const ventoso = propagar(incendio(), 60).areaHa!;
    expect(ventoso).toBeGreaterThan(50); // decenas de hectáreas con 35 km/h
    expect(r.areaHa).toBeLessThan(15); // en calma, poco más de un par de manzanas
    expect(r.areaHa).toBeLessThan(ventoso / 5);
  });

  it("el perímetro queda casi circular (radio máximo < 1,05 × el mínimo)", () => {
    const radios = radiosDe(enCalma.centro, r.perimetro);
    expect(Math.max(...radios) / Math.min(...radios)).toBeLessThan(1.05);
  });
});

describe("propagar · el incendio controlado no crece", () => {
  it("un foco controlado conserva su perímetro y su área", () => {
    const foco = incendio({ estado: "controlado" });
    const r = propagar(foco, 360);
    expect(r.frente?.velocidadMmin).toBe(0);
    expect(r.areaHa).toBeCloseTo(areaHa(perimetroInicial(foco.centro)), 1);
    const radios = radiosDe(foco.centro, r.perimetro);
    for (const x of radios) expect(x).toBeCloseTo(RADIO_INICIAL_M, 0);
  });

  it("un foco estabilizado crece, pero cinco veces menos que uno activo", () => {
    const activo = propagar(incendio({ estado: "activo" }), 60).frente!.velocidadMmin;
    const estabilizado = propagar(incendio({ estado: "estabilizado" }), 60).frente!.velocidadMmin;
    expect(estabilizado / activo).toBeCloseTo(0.2, 2);
  });
});

describe("propagar · factor de extinción (constructor K)", () => {
  it("factor 0 congela el avance aunque el foco esté activo", () => {
    const r = propagar(incendio(), 60, 0);
    expect(r.frente?.velocidadMmin).toBe(0);
    expect(r.areaHa).toBeLessThan(2);
  });

  it("factor 0,5 da menos área que factor 1 y más que factor 0,1", () => {
    const a = propagar(incendio(), 60, 1).areaHa!;
    const b = propagar(incendio(), 60, 0.5).areaHa!;
    const c = propagar(incendio(), 60, 0.1).areaHa!;
    expect(b).toBeLessThan(a);
    expect(c).toBeLessThan(b);
  });
});

describe("predecir · poblaciones en la trayectoria", () => {
  const navalacruz = poblacion("Navalacruz", 3, 45); // a sotavento (NE)
  const robledo = poblacion("Robledo", 3, 315); // al NO
  const lejano = poblacion("Lejano", 25, 45); // en trayectoria pero muy lejos

  it("un pueblo a 3 km a sotavento sale como inminente y con ETA < 60 min", () => {
    const amenazas = evaluarPoblaciones(incendio(), [navalacruz]);
    expect(amenazas[0].riesgo).toBe("inminente");
    expect(amenazas[0].enCono).toBe(true);
    expect(amenazas[0].etaMin).toBeGreaterThan(0);
    expect(amenazas[0].etaMin).toBeLessThan(60);
  });

  it("la predicción lo lista como población en peligro y lo nombra en la explicación", () => {
    const p = predecir(incendio(), [navalacruz, robledo]);
    expect(p.poblacionesEnPeligro[0].nombre).toBe("Navalacruz");
    expect(p.explicacion).toContain("Navalacruz");
    expect(p.explicacion).toContain("NE");
  });

  it("un giro de 90° del viento cambia la lista de pueblos en peligro", () => {
    const antes = predecir(incendio(), [navalacruz, robledo]);
    // Viento del SE (135°) → el frente pasa del NE al NO.
    const despues = predecir(
      incendio({ meteo: meteo({ direccionGrados: 135, direccionTexto: "SE" }) }),
      [navalacruz, robledo],
    );
    expect(antes.poblacionesEnPeligro.map((x) => x.nombre)).toContain("Navalacruz");
    expect(despues.explicacion).toContain("NO");
    expect(despues.poblacionesEnPeligro[0]?.nombre).toBe("Robledo");
    expect(antes.poblacionesEnPeligro[0].nombre).not.toBe(despues.poblacionesEnPeligro[0]?.nombre);
  });

  it("fuera del cono (> 40° del eje) y a más de 2 km el riesgo es bajo", () => {
    const aTrasmano = poblacion("Trasmano", 8, 180);
    const [a] = evaluarPoblaciones(incendio(), [aTrasmano]);
    expect(a.enCono).toBe(false);
    expect(a.anguloGrados).toBeGreaterThan(SEMICONO_GRADOS);
    expect(a.riesgo).toBe("bajo");
  });

  it("fuera del cono pero a menos de 2 km el riesgo sube a medio (un giro lo pondría en trayectoria)", () => {
    const [a] = evaluarPoblaciones(incendio(), [poblacion("Pegado", 1.2, 200)]);
    expect(a.enCono).toBe(false);
    expect(a.riesgo).toBe("medio");
  });

  it("los umbrales de riesgo por ETA son los acordados (< 60 inminente, < 180 alto, < 360 medio)", () => {
    const amenazas = evaluarPoblaciones(incendio(), [navalacruz, lejano]);
    const cercana = amenazas.find((a) => a.nombre === "Navalacruz")!;
    const lejana = amenazas.find((a) => a.nombre === "Lejano")!;
    expect(cercana.etaMin!).toBeLessThan(60);
    expect(cercana.riesgo).toBe("inminente");
    expect(lejana.etaMin!).toBeGreaterThan(cercana.etaMin!);
    expect(["alto", "medio", "bajo"]).toContain(lejana.riesgo);
  });

  it("los perímetros previstos crecen +1 h < +3 h < +6 h", () => {
    const p = predecir(incendio(), [navalacruz]);
    expect(areaHa(p.en1h)).toBeLessThan(areaHa(p.en3h));
    expect(areaHa(p.en3h)).toBeLessThan(areaHa(p.en6h));
  });

  it("sin meteo no se predice nada y se dice por qué (nada simulado)", () => {
    const p = predecir(incendio({ meteo: undefined }), [navalacruz]);
    expect(p.poblacionesEnPeligro).toHaveLength(0);
    expect(p.explicacion).toContain("Sin datos meteorológicos");
  });

  it("el combustible dominante cambia el tiempo de llegada (pasto antes que bosque)", () => {
    const enPasto = evaluarPoblaciones(incendio({ combustible: combustible("pasto") }), [navalacruz])[0];
    const enBosque = evaluarPoblaciones(incendio({ combustible: combustible("bosque") }), [navalacruz])[0];
    expect(enPasto.etaMin!).toBeLessThan(enBosque.etaMin!);
  });
});
