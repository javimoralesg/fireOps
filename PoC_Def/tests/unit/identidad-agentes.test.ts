import { describe, expect, it } from "vitest";
import {
  AGENTE_CANONICO_POR_LEGACY,
  CAPACIDADES_POR_AGENTE,
  IDS_AGENTES_CANONICOS,
  agenteCanonicoDe,
  buscarAgenteCompatible,
  capacidadDeAgente,
  idsHistoricosDeAgente,
  perteneceAlMismoAgente,
  resolverIdentidadAgente,
} from "@/lib/agentes/identidad";

describe("identidad compatible de agentes", () => {
  it("agrupa exactamente las 16 identidades antiguas en cinco agentes", () => {
    expect(IDS_AGENTES_CANONICOS).toHaveLength(5);
    expect(Object.keys(AGENTE_CANONICO_POR_LEGACY)).toHaveLength(16);
    expect(new Set(Object.values(AGENTE_CANONICO_POR_LEGACY))).toEqual(new Set(IDS_AGENTES_CANONICOS));
    expect(Object.values(CAPACIDADES_POR_AGENTE).flat()).toHaveLength(16);
  });

  it("resuelve agente y capacidad de un id antiguo", () => {
    expect(resolverIdentidadAgente("vigia_camaras")).toEqual({
      agenteId: "observador",
      capacidadId: "vigia_camaras",
      solicitadoId: "vigia_camaras",
      esAlias: true,
    });
    expect(agenteCanonicoDe("asesor_legal")).toBe("guardian");
    expect(capacidadDeAgente("redactor")).toBe("redactor");
  });

  it("reconoce ids canónicos sin inventar una capacidad", () => {
    expect(resolverIdentidadAgente("cronista")).toEqual({
      agenteId: "cronista",
      solicitadoId: "cronista",
      esAlias: false,
    });
    expect(capacidadDeAgente("cronista")).toBeUndefined();
    expect(resolverIdentidadAgente("desconocido")).toBeUndefined();
  });

  it("relaciona registros históricos de capacidades hermanas", () => {
    expect(idsHistoricosDeAgente("guardian")).toEqual(["guardian", "asesor_legal", "supervisor"]);
    expect(perteneceAlMismoAgente("supervisor", "asesor_legal")).toBe(true);
    expect(perteneceAlMismoAgente("portavoz", "asesor_legal")).toBe(false);
    expect(perteneceAlMismoAgente("id-externo", "id-externo")).toBe(true);
  });

  it("prefiere la ficha exacta mientras la topología legacy siga activa", () => {
    const agentes = [{ id: "observador" }, { id: "vigia_camaras" }];
    expect(buscarAgenteCompatible(agentes, "vigia_camaras")?.id).toBe("vigia_camaras");
  });

  it("hace caer un enlace antiguo al agente canónico tras el corte", () => {
    expect(buscarAgenteCompatible([{ id: "observador" }], "vigia_camaras")?.id).toBe("observador");
    expect(buscarAgenteCompatible([{ id: "vigia_camaras" }], "observador")).toBeUndefined();
    expect(buscarAgenteCompatible([{ id: "observador" }], "desconocido")).toBeUndefined();
  });
});
