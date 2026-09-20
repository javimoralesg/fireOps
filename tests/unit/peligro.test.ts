// Pruebas de lib/fuentes/peligro.ts · índice FWI simplificado. DUEÑO: constructor L.
import { describe, expect, it } from "vitest";
import { calcularPeligro, factorCombustible, nivelDe, regla30_30_30 } from "@/lib/fuentes/peligro";
import { combustible, meteo } from "./ayudas/dominio";

describe("regla 30-30-30", () => {
  it("se cumple con 31 °C, 29 % de HR y racha de 31 km/h", () => {
    expect(regla30_30_30(meteo({ temperaturaC: 31, humedadPct: 29, vientoKmh: 10, rachasKmh: 31 }))).toBe(true);
  });

  it("es estricta en los tres límites: 30/30/30 exactos NO la cumplen", () => {
    expect(regla30_30_30(meteo({ temperaturaC: 30, humedadPct: 29, vientoKmh: 40, rachasKmh: 40 }))).toBe(false);
    expect(regla30_30_30(meteo({ temperaturaC: 35, humedadPct: 30, vientoKmh: 40, rachasKmh: 40 }))).toBe(false);
    expect(regla30_30_30(meteo({ temperaturaC: 35, humedadPct: 20, vientoKmh: 30, rachasKmh: 30 }))).toBe(false);
  });

  it("basta con que la RACHA pase de 30 aunque el viento medio no llegue", () => {
    expect(regla30_30_30(meteo({ temperaturaC: 35, humedadPct: 20, vientoKmh: 12, rachasKmh: 45 }))).toBe(true);
  });

  it("se anota en el motivo del índice cuando se cumple", () => {
    const p = calcularPeligro(meteo({ temperaturaC: 36, humedadPct: 15, vientoKmh: 35, rachasKmh: 45 }));
    expect(p.motivo).toContain("30-30-30");
  });
});

describe("niveles del índice", () => {
  it("cada corte cae donde dice la documentación", () => {
    expect(nivelDe(0)).toBe("bajo");
    expect(nivelDe(19)).toBe("bajo");
    expect(nivelDe(20)).toBe("moderado");
    expect(nivelDe(39)).toBe("moderado");
    expect(nivelDe(40)).toBe("alto");
    expect(nivelDe(59)).toBe("alto");
    expect(nivelDe(60)).toBe("muy_alto");
    expect(nivelDe(79)).toBe("muy_alto");
    expect(nivelDe(80)).toBe("extremo");
    expect(nivelDe(100)).toBe("extremo");
  });

  it("el nivel del índice calculado es coherente con su valor", () => {
    const p = calcularPeligro(meteo());
    expect(p.nivel).toBe(nivelDe(p.valor));
    expect(p.valor).toBeGreaterThanOrEqual(0);
    expect(p.valor).toBeLessThanOrEqual(100);
  });
});

describe("día de riesgo extremo frente a día tranquilo", () => {
  const extremo = meteo({ temperaturaC: 40, humedadPct: 8, vientoKmh: 50, rachasKmh: 70, precipitacionMm: 0, vpd: 6 });
  const tranquilo = meteo({ temperaturaC: 14, humedadPct: 85, vientoKmh: 4, rachasKmh: 7, precipitacionMm: 0, vpd: 0.2 });

  it("el día extremo da nivel extremo y el tranquilo bajo", () => {
    expect(calcularPeligro(extremo).nivel).toBe("extremo");
    expect(calcularPeligro(tranquilo).nivel).toBe("bajo");
  });

  it("el índice es monótono: más calor y menos humedad nunca bajan el valor", () => {
    const a = calcularPeligro(meteo({ temperaturaC: 25, humedadPct: 45, vientoKmh: 20, rachasKmh: 25 })).valor;
    const b = calcularPeligro(meteo({ temperaturaC: 35, humedadPct: 20, vientoKmh: 20, rachasKmh: 25 })).valor;
    expect(b).toBeGreaterThan(a);
  });
});

describe("efecto del combustible", () => {
  it("el multiplicador se mueve dentro de [0,70 · 1,15]", () => {
    expect(factorCombustible(combustible("matorral"))).toBeCloseTo(1.15, 2);
    expect(factorCombustible(combustible("urbano"))).toBeCloseTo(0.7, 2);
    expect(factorCombustible(combustible("agricola"))).toBeCloseTo(0.85, 2);
    expect(factorCombustible(undefined)).toBe(1);
  });

  it("matorral sube el índice y urbano lo baja frente al mismo día sin combustible", () => {
    const m = meteo({ temperaturaC: 32, humedadPct: 22, vientoKmh: 28, rachasKmh: 35 });
    const sin = calcularPeligro(m).valor;
    const conMatorral = calcularPeligro(m, combustible("matorral")).valor;
    const conUrbano = calcularPeligro(m, combustible("urbano")).valor;
    expect(conMatorral).toBeGreaterThan(sin);
    expect(conUrbano).toBeLessThan(sin);
  });

  it("el combustible dominante aparece en el motivo", () => {
    expect(calcularPeligro(meteo(), combustible("bosque")).motivo).toContain("masa forestal");
    expect(calcularPeligro(meteo(), combustible("pasto")).motivo).toContain("pastizal");
  });
});

describe("efecto de la lluvia", () => {
  const m = meteo({ temperaturaC: 34, humedadPct: 18, vientoKmh: 35, rachasKmh: 45 });

  it("8 mm o más en 24 h reducen el índice al 45 % (factor 0,45)", () => {
    const seco = calcularPeligro(m, undefined, 0).valor;
    const mojado = calcularPeligro(m, undefined, 8).valor;
    expect(mojado).toBeLessThan(seco);
    expect(mojado / seco).toBeCloseTo(0.45, 1);
  });

  it("más lluvia nunca sube el índice y satura a partir de 8 mm", () => {
    const v = [0, 2, 4, 8, 20, 100].map((mm) => calcularPeligro(m, undefined, mm).valor);
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeLessThanOrEqual(v[i - 1]);
    expect(v[3]).toBe(v[4]);
    expect(v[4]).toBe(v[5]);
  });

  it("la lluvia significativa se explica en el motivo", () => {
    expect(calcularPeligro(m, undefined, 3.4).motivo).toContain("3.4 mm de lluvia reciente");
  });

  it("`precipitacion24hMm` manda sobre la precipitación horaria de la meteo", () => {
    const conHoraria = calcularPeligro(meteo({ precipitacionMm: 10 })).valor;
    const forzadaASeco = calcularPeligro(meteo({ precipitacionMm: 10 }), undefined, 0).valor;
    expect(forzadaASeco).toBeGreaterThan(conHoraria);
  });
});

describe("VPD ausente", () => {
  it("sin VPD el peso se reparte y el índice no se hunde (< 15 % de diferencia)", () => {
    const base = { temperaturaC: 33, humedadPct: 20, vientoKmh: 30, rachasKmh: 38 };
    const conVpd = calcularPeligro(meteo({ ...base, vpd: 3.5 })).valor;
    const sinVpd = calcularPeligro(meteo({ ...base, vpd: undefined })).valor;
    expect(Math.abs(conVpd - sinVpd) / conVpd).toBeLessThan(0.15);
  });
});
