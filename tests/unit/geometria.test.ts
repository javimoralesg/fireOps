// Pruebas de lib/simulacion/geometria.ts + perimetroDeSuperficie: la
// superficie guardada de un foco es la MEDIDA sobre su polígono, y el
// círculo inicial mide exactamente lo que dice la fuente.
import { describe, expect, it } from "vitest";
import { areaHa, perimetroM } from "@/lib/simulacion/geometria";
import { perimetroDeSuperficie, perimetroInicial, RADIO_INICIAL_M, VERTICES } from "@/lib/simulacion/propagacion";

const CENTRO = { lat: 40.44, lon: -4.99 };

describe("areaHa (cordón de zapato sobre metros locales)", () => {
  it("un cuadrado de 100 m de lado mide 1 ha (±1 %)", () => {
    const dLat = 100 / 110_574;
    const dLon = 100 / (111_320 * Math.cos((CENTRO.lat * Math.PI) / 180));
    const cuadrado: [number, number][] = [
      [CENTRO.lat, CENTRO.lon],
      [CENTRO.lat + dLat, CENTRO.lon],
      [CENTRO.lat + dLat, CENTRO.lon + dLon],
      [CENTRO.lat, CENTRO.lon + dLon],
    ];
    expect(areaHa(cuadrado)).toBeCloseTo(1, 2);
    expect(perimetroM(cuadrado)).toBeCloseTo(400, -1);
  });
  it("abierto o cerrado da lo mismo, y con menos de 3 vértices es 0", () => {
    const p = perimetroInicial(CENTRO, 100);
    expect(areaHa(p.slice(0, -1))).toBeCloseTo(areaHa(p), 4);
    expect(areaHa([])).toBe(0);
    expect(areaHa(p.slice(0, 2))).toBe(0);
  });
});

describe("perimetroDeSuperficie", () => {
  it("el polígono MIDE las hectáreas pedidas (±0,5 %)", () => {
    for (const ha of [0.5, 1.13, 24, 487.43, 5000]) {
      const p = perimetroDeSuperficie(CENTRO, ha);
      expect(p).toHaveLength(VERTICES + 1);
      expect(Math.abs(areaHa(p) - ha) / ha).toBeLessThan(0.005);
    }
  });
  it("sin corregir, el polígono inscrito de radio √(A/π) mide ~1 % MENOS que A", () => {
    const ha = 24;
    const inscrito = perimetroInicial(CENTRO, Math.sqrt((ha * 10_000) / Math.PI));
    expect(areaHa(inscrito)).toBeLessThan(ha * 0.995);
    expect(areaHa(inscrito)).toBeGreaterThan(ha * 0.98);
  });
  it("el foco por defecto (radio 60 m) sigue midiendo ~1,13 ha", () => {
    const ha = (Math.PI * RADIO_INICIAL_M ** 2) / 10_000;
    expect(areaHa(perimetroDeSuperficie(CENTRO, ha))).toBeCloseTo(ha, 2);
  });
  it("con 0 o negativo devuelve un polígono mínimo medible, nunca revienta", () => {
    expect(areaHa(perimetroDeSuperficie(CENTRO, 0))).toBeGreaterThan(0);
    expect(areaHa(perimetroDeSuperficie(CENTRO, -3))).toBeGreaterThan(0);
  });
});
