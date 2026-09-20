// =====================================================================
// F1.5 · pulsar "Parar" no es una avería de los agentes.
// Prueba de CLASE 1: sin red, sin IA.
//
// Fallos L-5 y L-6 de docs/PRUEBAS.md, medidos por el constructor L:
//
//   05:12:06 agente   El asesor legal no ha podido revisar "…": Mundo en pausa
//   05:18:55 agente   Pausado Asesor legal por errores repetidos (5)
//   05:20:30 agente   Pausado Vigía de cámaras por errores repetidos (5)
//
// Es decir: pausar el mundo tres veces dejaba la sala sin vigía de cámaras y
// sin asesor legal, y había que reactivarlos a mano. La misma causa dejaba
// escaladas a un humano, de forma permanente, decisiones que la política
// marcaba como autónomas.
//
// El diagnóstico de la documentación era "falta aplicar esAborto()". Al mirar
// el código, la causa real es otra: los tres sitios preguntaban SOLO por
// `estado.reloj.pausado` en el momento del `catch`. El aborto se dispara al
// pausar, pero el `catch` puede correr después de que alguien haya reanudado.
// Es una carrera, y por eso fallaba de forma intermitente.
//
// Lo que NO puede cambiar: un agente que se pasa de su tiempo máximo SÍ tiene
// un problema, y tiene que seguir contando como error. Si esto se relajara,
// un agente colgado dejaría de avisar.
// DUEÑO: constructor L (escrito en la fase F1.5 de la migración).
// =====================================================================
import { describe, expect, it } from "vitest";
import { esPorPausa } from "@/lib/motor/orquestador";
import { Estado } from "@/lib/motor/estado";

function mundo(pausado: boolean): Estado {
  const e = new Estado();
  e.reloj.pausado = pausado;
  return e;
}

/** El error que lanza lib/ia/llm.ts cuando el mundo está parado. */
const ERROR_PAUSA = new Error("Mundo en pausa: no se hacen llamadas a la IA hasta reanudar");

/** El que fabrica el orquestador al agotarse el tiempo máximo de un ciclo. */
function errorTiempoMaximo(segundos = 90): Error {
  const e = new Error(`Tiempo máximo agotado (${segundos} s)`);
  e.name = "AbortError";
  return e;
}

describe("esPorPausa · lo que provoca el mando no es una avería", () => {
  it("con el mundo parado, cualquier fallo del ciclo es por la pausa", () => {
    expect(esPorPausa(new Error("lo que sea"), mundo(true))).toBe(true);
  });

  it("reconoce el error de la capa de IA aunque el mundo YA se haya reanudado", () => {
    // Este es el caso que fallaba: el aborto se disparó al pausar y el catch
    // corre cuando el reloj ya volvía a andar.
    expect(esPorPausa(ERROR_PAUSA, mundo(false))).toBe(true);
  });

  it("no le importan las mayúsculas ni el resto del mensaje", () => {
    expect(esPorPausa(new Error("Cancelado: MUNDO EN PAUSA"), mundo(false))).toBe(true);
  });
});

describe("esPorPausa · lo que sí es un problema del agente sigue contando", () => {
  it("agotar el tiempo máximo NO es una pausa, aunque sea un AbortError", () => {
    expect(esPorPausa(errorTiempoMaximo(), mundo(false))).toBe(false);
  });

  it("un fallo de red de un agente cuenta como error", () => {
    expect(esPorPausa(new Error("fetch failed"), mundo(false))).toBe(false);
  });

  it("un fallo del proveedor de IA cuenta como error", () => {
    expect(esPorPausa(new Error("HelmCode 500: internal error"), mundo(false))).toBe(false);
  });

  it("aguanta lo que no es un Error", () => {
    expect(esPorPausa("texto suelto", mundo(false))).toBe(false);
    expect(esPorPausa(undefined, mundo(false))).toBe(false);
    expect(esPorPausa({ raro: true }, mundo(false))).toBe(false);
  });

  it("pero con el mundo parado, hasta un timeout se perdona", () => {
    // Coherente: si el mando ha parado el mundo, el ciclo se quedó sin tiempo
    // precisamente porque se le canceló todo lo que estaba esperando.
    expect(esPorPausa(errorTiempoMaximo(), mundo(true))).toBe(true);
  });
});

describe("el caso que dejaba la sala sin agentes", () => {
  it("cinco pausas seguidas no suman ni un error al agente", () => {
    // Antes: cada pausa = 1 error; a los 5, el supervisor lo pausaba para siempre.
    const errores = Array.from({ length: 5 }, () => ERROR_PAUSA);
    const contados = errores.filter((e) => !esPorPausa(e, mundo(false))).length;
    expect(contados).toBe(0);
  });
});
