import { describe, expect, it } from "vitest";
import { leerTopologiaAgentes, seleccionarTopologia } from "@/lib/agentes/migracion/topologia";

describe("selección de topología de agentes", () => {
  it("activa five cuando no hay configuración y conserva rollback explícito", () => {
    expect(leerTopologiaAgentes(undefined)).toBe("five");
    expect(leerTopologiaAgentes("legacy")).toBe("legacy");
    expect(seleccionarTopologia("legacy")).toEqual({ autoridad: "legacy", ejecutarSombra: false });
  });

  it("mantiene legacy como autoridad en shadow", () => {
    expect(leerTopologiaAgentes(" SHADOW ")).toBe("shadow");
    expect(seleccionarTopologia("shadow")).toEqual({ autoridad: "legacy", ejecutarSombra: true });
  });

  it("solo five concede autoridad a la topología nueva", () => {
    expect(seleccionarTopologia("five")).toEqual({ autoridad: "five", ejecutarSombra: false });
  });

  it("falla de forma segura ante un valor desconocido", () => {
    expect(() => leerTopologiaAgentes("shdow")).toThrow(/AGENT_TOPOLOGY inválida/);
  });
});
