// Regresión: dos fotogramas consecutivos de un mismo móvil no deben ejecutar
// análisis de visión simultáneos ni permitir que el más antiguo termine después.
import { beforeEach, describe, expect, it, vi } from "vitest";

const dobles = vi.hoisted(() => ({
  secuencia: 1,
  analizar: vi.fn(),
  estado: {
    camaras: new Map([
      ["movil:campo-1", { id: "movil:campo-1", nombre: "Campo 1", fuente: "Movil", punto: { lat: 40.4, lon: -3.7 } }],
    ]),
  },
}));

vi.mock("@/lib/agentes/percepcion/vigiaCamaras", () => ({
  analizarCamaraAhora: dobles.analizar,
  cupoDisponible: () => 12,
}));
vi.mock("@/lib/ia/llm", () => ({ proveedorDisponible: () => true }));
vi.mock("@/lib/motor/estado", () => ({ obtenerEstado: () => dobles.estado }));
vi.mock("@/lib/motor/orquestador", () => ({ contextoParaSistema: () => ({}) }));
vi.mock("@/lib/fuentes/camarasMovil", () => ({
  fotogramaDe: () => ({ dispositivoId: "campo-1", secuencia: dobles.secuencia }),
}));

import { analizarMovilAlLlegar } from "@/lib/fuentes/analisisMovilInmediato";

describe("análisis inmediato de cámaras móviles", () => {
  beforeEach(() => {
    delete (globalThis as typeof globalThis & { __atalayaAnalisisMovil?: unknown }).__atalayaAnalisisMovil;
    dobles.secuencia = 1;
    dobles.analizar.mockReset();
  });

  it("mantiene como máximo un análisis en curso por cámara aunque llegue otra secuencia", async () => {
    let resolverPrimero: ((valor: { analisis: undefined }) => void) | undefined;
    dobles.analizar
      .mockImplementationOnce(() => new Promise((resolver) => { resolverPrimero = resolver; }))
      .mockResolvedValueOnce({ analisis: undefined });

    const primero = analizarMovilAlLlegar("movil:campo-1");
    dobles.secuencia = 2;
    const segundo = analizarMovilAlLlegar("movil:campo-1");
    const llamadasMientrasPrimeroSigueEnCurso = dobles.analizar.mock.calls.length;

    resolverPrimero?.({ analisis: undefined });
    await Promise.all([primero, segundo]);

    expect(llamadasMientrasPrimeroSigueEnCurso).toBe(1);
  });
});
