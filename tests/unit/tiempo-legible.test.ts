// Pruebas de lib/dominio/tiempo-legible.ts · lo que lee una persona en un SMS: horas y minutos, no
// «2972 minutos»; distancias con coma; hora local de España. DUEÑO: sesión fireops-00 (2026-09-19).
import { describe, expect, it } from "vitest";
import { duracionLegible, horaLegible, kmLegible } from "@/lib/dominio/tiempo-legible";

describe("duracionLegible · minutos → horas y minutos", () => {
  it("cubre minutos sueltos, horas exactas, horas con minutos y valores raros", () => {
    expect(duracionLegible(0.4)).toBe("menos de 1 min");
    expect(duracionLegible(45)).toBe("45 min");
    expect(duracionLegible(59.6)).toBe("1 h");
    expect(duracionLegible(60)).toBe("1 h");
    expect(duracionLegible(90)).toBe("1 h 30 min");
    expect(duracionLegible(2972)).toBe("49 h 32 min"); // el SMS real de las 18:0x decía «2972 minutos»
    expect(duracionLegible(-5)).toBe("tiempo desconocido");
    expect(duracionLegible(Number.NaN)).toBe("tiempo desconocido");
  });
});

describe("horaLegible · hora local de España", () => {
  it("convierte un ISO en UTC a HH:MM de Madrid y deja pasar lo que no es fecha", () => {
    expect(horaLegible("2026-09-19T16:04:00.000Z")).toBe("18:04"); // CEST = UTC+2
    expect(horaLegible("2026-01-15T16:04:00.000Z")).toBe("17:04"); // CET = UTC+1
    expect(horaLegible("no es una fecha")).toBe("no es una fecha");
  });
});

describe("kmLegible · distancias como las lee un vecino", () => {
  it("metros por debajo de 1 km, un decimal con coma hasta 10 km y enteros a partir de ahí", () => {
    expect(kmLegible(0.42)).toBe("420 m");
    expect(kmLegible(1.23)).toBe("1,2 km");
    expect(kmLegible(2.1)).toBe("2,1 km");
    expect(kmLegible(12.4)).toBe("12 km");
    expect(kmLegible(-1)).toBe("distancia desconocida");
  });
});
