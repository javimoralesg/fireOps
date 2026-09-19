// Pruebas de lib/fuentes/recencia.ts. DUEÑO: constructor B.
import { describe, expect, it } from "vitest";
import { MAX_DIAS_PRENSA, MAX_HORAS_PRENSA, desdeVentana, esReciente } from "@/lib/fuentes/recencia";

const DIA = 86_400_000;
const ahora = Date.parse("2026-09-19T12:00:00Z");

describe("ventana de recencia de prensa y redes", () => {
  it("la ventana es de 15 días", () => {
    expect(MAX_DIAS_PRENSA).toBe(15);
    expect(MAX_HORAS_PRENSA).toBe(15 * 24);
  });

  it("acepta lo publicado dentro de los últimos 15 días (incluido el límite)", () => {
    expect(esReciente(new Date(ahora).toISOString(), ahora)).toBe(true);
    expect(esReciente(new Date(ahora - 14 * DIA).toISOString(), ahora)).toBe(true);
    expect(esReciente(new Date(ahora - 15 * DIA).toISOString(), ahora)).toBe(true);
  });

  it("descarta lo publicado hace más de 15 días", () => {
    expect(esReciente(new Date(ahora - 15 * DIA - 1000).toISOString(), ahora)).toBe(false);
    expect(esReciente("2026-07-12T08:00:00Z", ahora)).toBe(false);
  });

  it("no descarta lo que no tiene fecha o la tiene ilegible", () => {
    expect(esReciente(undefined, ahora)).toBe(true);
    expect(esReciente("", ahora)).toBe(true);
    expect(esReciente("ayer", ahora)).toBe(true);
  });

  it("desdeVentana devuelve el instante ISO de hace 15 días", () => {
    expect(desdeVentana(ahora)).toBe(new Date(ahora - 15 * DIA).toISOString());
  });
});
