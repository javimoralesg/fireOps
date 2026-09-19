// Pruebas de lib/simulacion/fusion.ts · dos focos que se juntan son uno solo.
// DUEÑO: constructor L (el módulo es del constructor K).
import { describe, expect, it } from "vitest";
import { haversine } from "@/lib/fuentes/geo";
import { areaHa, distanciaEntrePerimetrosM } from "@/lib/simulacion/geometria";
import {
  ESTADOS_FUSIONABLES,
  UMBRAL_FUSION_M,
  elegirSuperviviente,
  nombreFusionado,
  planificarFusiones,
  siguienteFusion,
  unirPerimetros,
} from "@/lib/simulacion/fusion";
import { perimetroInicial } from "@/lib/simulacion/propagacion";
import { destino } from "@/lib/fuentes/geo";
import { incendio } from "./ayudas/dominio";

const CENTRO = { lat: 40.44, lon: -4.99 };

/** Foco con perímetro circular de `radioM` a `distanciaM` al este del centro. */
function focoEn(id: string, distanciaM: number, radioM = 60, extra: Parameters<typeof incendio>[0] = {}) {
  const centro = destino(CENTRO, 90, distanciaM / 1000);
  return incendio({
    id,
    nombre: `Incendio ${id}`,
    centro,
    perimetro: perimetroInicial(centro, radioM),
    ...extra,
  });
}

describe("criterio de fusión", () => {
  it("dos focos lejos no se fusionan", () => {
    const planes = planificarFusiones([focoEn("a", 0), focoEn("b", 5000)]);
    expect(planes).toHaveLength(0);
    expect(siguienteFusion([focoEn("a", 0), focoEn("b", 5000)])).toBeUndefined();
  });

  it("dos focos a menos de 300 m borde a borde se fusionan", () => {
    // 60 m de radio cada uno + 200 m de hueco → separación de centros 320 m.
    const a = focoEn("a", 0);
    const b = focoEn("b", 320);
    expect(distanciaEntrePerimetrosM(a.perimetro, b.perimetro)).toBeLessThan(UMBRAL_FUSION_M);
    const planes = planificarFusiones([a, b]);
    expect(planes).toHaveLength(1);
    expect(planes[0].distanciaBordeM).toBeLessThan(UMBRAL_FUSION_M);
  });

  it("dos perímetros que ya se solapan dan distancia borde 0", () => {
    const planes = planificarFusiones([focoEn("a", 0, 500), focoEn("b", 400, 500)]);
    expect(planes).toHaveLength(1);
    expect(planes[0].distanciaBordeM).toBe(0);
  });

  it("el umbral es configurable y respeta el criterio documentado (300 m)", () => {
    expect(UMBRAL_FUSION_M).toBe(300);
    const a = focoEn("a", 0);
    const b = focoEn("b", 1200); // ~1.080 m de hueco
    expect(planificarFusiones([a, b])).toHaveLength(0);
    expect(planificarFusiones([a, b], 2000)).toHaveLength(1);
  });

  it("un foco extinguido o descartado ya no se fusiona con nada", () => {
    for (const estado of ["extinguido", "descartado", "controlado", "fusionado"] as const) {
      expect(planificarFusiones([focoEn("a", 0), focoEn("b", 320, 60, { estado })])).toHaveLength(0);
    }
    for (const estado of ESTADOS_FUSIONABLES) {
      expect(planificarFusiones([focoEn("a", 0), focoEn("b", 320, 60, { estado })])).toHaveLength(1);
    }
  });

  it("cada foco entra como mucho en una pareja por ciclo (las cadenas se resuelven después)", () => {
    const planes = planificarFusiones([focoEn("a", 0), focoEn("b", 320), focoEn("c", 640)]);
    expect(planes).toHaveLength(1);
    const ids = [planes[0].superviviente.id, planes[0].absorbido.id];
    expect(new Set(ids).size).toBe(2);
  });

  it("planificarFusiones es pura: no muta los focos recibidos", () => {
    const focos = [focoEn("a", 0), focoEn("b", 320)];
    const antes = JSON.stringify(focos);
    planificarFusiones(focos);
    expect(JSON.stringify(focos)).toBe(antes);
  });
});

describe("quién sobrevive", () => {
  it("un foco confirmado absorbe a uno solo detectado", () => {
    const confirmado = focoEn("conf", 0, 60, { estado: "confirmado", detectadoEn: "2026-09-19T15:00:00.000Z" });
    const detectado = focoEn("det", 320, 60, { estado: "detectado", detectadoEn: "2026-09-19T14:00:00.000Z" });
    const r = elegirSuperviviente(confirmado, detectado);
    expect(r.superviviente.id).toBe("conf");
    expect(r.absorbido.id).toBe("det");
  });

  it("a igualdad de consolidación, sobrevive el más antiguo", () => {
    const viejo = focoEn("viejo", 0, 60, { estado: "activo", detectadoEn: "2026-09-19T12:00:00.000Z" });
    const nuevo = focoEn("nuevo", 320, 60, { estado: "activo", detectadoEn: "2026-09-19T14:00:00.000Z" });
    expect(elegirSuperviviente(viejo, nuevo).superviviente.id).toBe("viejo");
    expect(elegirSuperviviente(nuevo, viejo).superviviente.id).toBe("viejo");
  });

  it("el nombre del foco resultante es una frase legible", () => {
    const n = nombreFusionado(focoEn("a", 0), focoEn("b", 320));
    expect(typeof n).toBe("string");
    expect(n.length).toBeGreaterThan(3);
  });
});

describe("perímetro resultante", () => {
  const a = focoEn("a", 0, 300);
  const b = focoEn("b", 900, 300);
  const unido = unirPerimetros(a, b);

  it("el área del foco unido es mayor que la de cada uno por separado", () => {
    expect(unido.areaHa).toBeGreaterThan(areaHa(a.perimetro));
    expect(unido.areaHa).toBeGreaterThan(areaHa(b.perimetro));
  });

  it("incluye el hueco entre los dos frentes (unión por exceso, hipótesis segura)", () => {
    expect(unido.areaHa).toBeGreaterThan(areaHa(a.perimetro) + areaHa(b.perimetro));
  });

  it("el centro nuevo cae entre los dos centros", () => {
    expect(haversine(a.centro, unido.centro)).toBeLessThan(haversine(a.centro, b.centro));
    expect(haversine(b.centro, unido.centro)).toBeLessThan(haversine(a.centro, b.centro));
  });

  it("el perímetro sale con el mismo formato que usa el modelo (polígono cerrado)", () => {
    expect(unido.perimetro.length).toBeGreaterThan(3);
    expect(unido.perimetro[0]).toEqual(unido.perimetro[unido.perimetro.length - 1]);
    for (const [lat, lon] of unido.perimetro) {
      expect(Number.isFinite(lat)).toBe(true);
      expect(Number.isFinite(lon)).toBe(true);
    }
  });

  it("el perímetro unido cubre los dos focos originales", () => {
    const planes = planificarFusiones([focoEn("a", 0, 300), focoEn("b", 700, 300)]);
    expect(planes).toHaveLength(1);
    expect(planes[0].areaHa).toBeGreaterThan(areaHa(planes[0].superviviente.perimetro));
  });
});
