// Pruebas de lib/motor/reloj.ts · tiempo de mundo. DUEÑO: constructor L.
// Se usa tiempo falso de vitest para que sean deterministas y rápidas.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Estado } from "@/lib/motor/estado";
import {
  actualizarReloj,
  avanzarMinutos,
  establecerFactor,
  minutosMundoEntre,
  pausar,
  reanudar,
  reiniciarAncla,
} from "@/lib/motor/reloj";

const mundoMin = (e: Estado) => (Date.parse(e.reloj.ahoraMundo) - Date.parse(e.reloj.inicioMundo)) / 60_000;

function nuevoEstado(factor = 12): Estado {
  const e = new Estado();
  reiniciarAncla(e);
  e.reloj.factor = factor;
  actualizarReloj(e);
  return e;
}

describe("reloj de mundo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { __atalayaMundoPausado?: boolean }).__atalayaMundoPausado = false;
  });

  it("con factor 12, 5 s reales son 1 min de mundo", () => {
    const e = nuevoEstado(12);
    vi.advanceTimersByTime(5_000);
    actualizarReloj(e);
    expect(mundoMin(e)).toBeCloseTo(1, 6);
  });

  it("el tiempo de mundo se acumula sin deriva a lo largo de varios ticks", () => {
    const e = nuevoEstado(12);
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(5_000);
      actualizarReloj(e);
    }
    expect(mundoMin(e)).toBeCloseTo(12, 6);
  });

  it("la pausa congela el mundo de verdad: el tiempo real no cuenta", () => {
    const e = nuevoEstado(12);
    vi.advanceTimersByTime(10_000);
    actualizarReloj(e);
    const antes = e.reloj.ahoraMundo;

    pausar(e);
    expect(e.reloj.pausado).toBe(true);
    vi.advanceTimersByTime(600_000); // 10 minutos reales en pausa
    actualizarReloj(e);
    expect(e.reloj.ahoraMundo).toBe(antes);
  });

  it("al pausar se levanta la bandera global que ve lib/ia/llm.ts", () => {
    const e = nuevoEstado();
    pausar(e);
    expect((globalThis as { __atalayaMundoPausado?: boolean }).__atalayaMundoPausado).toBe(true);
    reanudar(e);
    expect((globalThis as { __atalayaMundoPausado?: boolean }).__atalayaMundoPausado).toBe(false);
  });

  it("al reanudar, el tiempo real de la pausa no se recupera", () => {
    const e = nuevoEstado(12);
    vi.advanceTimersByTime(5_000);
    actualizarReloj(e);
    pausar(e);
    vi.advanceTimersByTime(3_600_000); // una hora real pausado
    reanudar(e);
    vi.advanceTimersByTime(5_000);
    actualizarReloj(e);
    expect(mundoMin(e)).toBeCloseTo(2, 6); // solo los dos tramos en marcha
  });

  it("pausar dos veces seguidas es idempotente", () => {
    const e = nuevoEstado(12);
    vi.advanceTimersByTime(5_000);
    pausar(e);
    const ahora = e.reloj.ahoraMundo;
    vi.advanceTimersByTime(5_000);
    pausar(e);
    expect(e.reloj.ahoraMundo).toBe(ahora);
  });

  it("cambiar el factor no reescribe el pasado", () => {
    const e = nuevoEstado(12);
    vi.advanceTimersByTime(5_000); // +1 min de mundo a ×12
    actualizarReloj(e);
    establecerFactor(e, 60);
    expect(mundoMin(e)).toBeCloseTo(1, 6);
    vi.advanceTimersByTime(5_000); // +5 min de mundo a ×60
    actualizarReloj(e);
    expect(mundoMin(e)).toBeCloseTo(6, 6);
  });

  it("el factor se recorta al rango operativo [0,1 · 600]", () => {
    const e = nuevoEstado();
    expect(establecerFactor(e, 0).factor).toBe(0.1);
    expect(establecerFactor(e, 10_000).factor).toBe(600);
  });

  it("avanzarMinutos salta hacia delante exactamente lo pedido", () => {
    const e = nuevoEstado(12);
    avanzarMinutos(e, 60);
    expect(mundoMin(e)).toBeCloseTo(60, 6);
  });

  it("avanzarMinutos funciona también en pausa y no la levanta", () => {
    const e = nuevoEstado(12);
    pausar(e);
    avanzarMinutos(e, 30);
    expect(mundoMin(e)).toBeCloseTo(30, 6);
    expect(e.reloj.pausado).toBe(true);
  });

  it("avanzarMinutos nunca retrocede el mundo", () => {
    const e = nuevoEstado(12);
    avanzarMinutos(e, 30);
    avanzarMinutos(e, -100);
    expect(mundoMin(e)).toBeCloseTo(30, 6);
  });

  it("cada cambio del reloj sube la versión del estado (para el SSE)", () => {
    const e = nuevoEstado(12);
    const v = e.version;
    avanzarMinutos(e, 10);
    expect(e.version).toBeGreaterThan(v);
  });
});

describe("minutosMundoEntre", () => {
  it("mide minutos entre dos instantes de mundo, con signo", () => {
    expect(minutosMundoEntre("2026-09-19T12:00:00Z", "2026-09-19T13:30:00Z")).toBe(90);
    expect(minutosMundoEntre("2026-09-19T13:30:00Z", "2026-09-19T12:00:00Z")).toBe(-90);
  });

  it("devuelve 0 con entradas ausentes o inválidas (nunca NaN)", () => {
    expect(minutosMundoEntre(undefined, "2026-09-19T12:00:00Z")).toBe(0);
    expect(minutosMundoEntre("no es fecha", "2026-09-19T12:00:00Z")).toBe(0);
  });
});
