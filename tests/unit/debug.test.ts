import { describe, expect, it } from "vitest";
import { debugActivado } from "@/lib/cliente/configuracion";

describe("debug de la interfaz", () => {
  it('solo se activa con el valor exacto "true"', () => {
    expect(debugActivado("true")).toBe(true);
    expect(debugActivado("false")).toBe(false);
    expect(debugActivado(undefined)).toBe(false);
    expect(debugActivado("TRUE")).toBe(false);
  });
});
