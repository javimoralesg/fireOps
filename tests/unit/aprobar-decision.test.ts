import { describe, expect, it, vi } from "vitest";
import type { Accion } from "@/lib/dominio/tipos";
import { Estado, establecerEstado } from "@/lib/motor/estado";
import { aprobarDecision } from "@/lib/motor/orquestador";
import { accion, decision } from "./ayudas/dominio";

vi.mock("@/lib/motor/actas", () => ({
  generarActaAccion: vi.fn().mockResolvedValue(undefined),
  generarActaDecision: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/agentes/ejecucion/ejecutor", () => ({
  ejecutorAcciones: {
    soporta: () => true,
    ejecutar: async (a: Accion) => ({
      ...a,
      estado: a.id === "falla" ? "fallida" : "ejecutada",
      ejecutadaEn: new Date().toISOString(),
      resultado: { en: new Date().toISOString(), proveedor: "prueba", resumen: "prueba", exito: a.id !== "falla" },
    }),
  },
  ordenarPorDependencias: (acciones: Accion[]) => acciones,
  comprobarDependencias: () => ({ lista: true }),
  validarDependencias: () => ({ valida: true, errores: [] }),
}));

describe("aprobarDecision", () => {
  it("falla una decisión multiacción si cualquiera de sus acciones falla", async () => {
    const estado = new Estado();
    establecerEstado(estado);
    estado.guardar(estado.decisiones, decision([
      accion("abrir_ticket", { id: "ok" }),
      accion("abrir_ticket", { id: "falla" }),
    ]));

    const resultado = await aprobarDecision("dec-prueba", "humano:prueba");

    expect(resultado?.estado).toBe("fallida");
    expect(resultado?.acciones.map((a) => a.estado)).toEqual(["ejecutada", "fallida"]);
  });
});
