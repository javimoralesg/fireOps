// =====================================================================
// ATALAYA INCENDIOS · Reloj de mundo
// ---------------------------------------------------------------------
// Propósito: convertir tiempo real en tiempo de mundo acelerado.
//   ahoraMundo = inicioMundo + minutos de mundo acumulados
// Los minutos de mundo se acumulan tick a tick: mientras el reloj no está
// pausado, cada milisegundo real suma `factor` milisegundos de mundo. Al
// pausar no se acumula nada, así que el mundo se congela de verdad.
// DUEÑO: constructor A (núcleo). Sin dependencias externas.
// =====================================================================

import type { Reloj } from "../dominio/tipos";
import type { Estado } from "./estado";

/**
 * Ancla del reloj: lo que no cabe en el contrato `Reloj` pero hace falta
 * para acumular sin derivas. Se guarda fuera del estado (WeakMap) para no
 * tocar el contrato compartido ni ensuciar el snapshot que viaja por SSE.
 */
interface AnclaReloj {
  /** Marca real (Date.now) de la última actualización contabilizada. */
  ultimoReal: number;
  /** Milisegundos de mundo acumulados desde `inicioMundo`. */
  acumuladoMundoMs: number;
}

/**
 * El registro de anclas vive en globalThis, no en el módulo: Next recarga en
 * caliente y puede tener DOS instancias vivas de este archivo a la vez. Con un
 * WeakMap por módulo, el bucle del orquestador y las rutas de la API llevarían
 * relojes distintos y los saltos de "+1 h" se perderían.
 */
declare global {
  // eslint-disable-next-line no-var
  var __atalayaAnclasReloj: WeakMap<Estado, AnclaReloj> | undefined;
}

function registroAnclas(): WeakMap<Estado, AnclaReloj> {
  if (!globalThis.__atalayaAnclasReloj) globalThis.__atalayaAnclasReloj = new WeakMap<Estado, AnclaReloj>();
  return globalThis.__atalayaAnclasReloj;
}

/**
 * Recupera (o reconstruye) el ancla. Si el estado viene rehidratado de la
 * base de datos, el acumulado se deduce de `ahoraMundo - inicioMundo`, así
 * que un reinicio en Railway no retrocede el mundo.
 */
function ancla(estado: Estado): AnclaReloj {
  const registro = registroAnclas();
  let a = registro.get(estado);
  if (!a) {
    const inicio = Date.parse(estado.reloj.inicioMundo);
    const ahora = Date.parse(estado.reloj.ahoraMundo);
    a = {
      ultimoReal: Date.now(),
      acumuladoMundoMs: Number.isFinite(inicio) && Number.isFinite(ahora) ? Math.max(0, ahora - inicio) : 0,
    };
    registro.set(estado, a);
  }
  return a;
}

/** Recalcula `ahoraMundo` en función del tiempo real transcurrido. Toca el estado. */
export function actualizarReloj(estado: Estado): Reloj {
  const a = ancla(estado);
  const ahoraReal = Date.now();
  const transcurridoReal = Math.max(0, ahoraReal - a.ultimoReal);
  a.ultimoReal = ahoraReal;
  if (!estado.reloj.pausado) {
    a.acumuladoMundoMs += transcurridoReal * estado.reloj.factor;
  }
  estado.reloj.ahoraMundo = new Date(Date.parse(estado.reloj.inicioMundo) + a.acumuladoMundoMs).toISOString();
  estado.tocar();
  return estado.reloj;
}

/**
 * Cambia la aceleración. Consolida antes lo acumulado con el factor viejo
 * para que el cambio no reescriba el pasado.
 */
export function establecerFactor(estado: Estado, factor: number): Reloj {
  actualizarReloj(estado);
  estado.reloj.factor = Math.max(0.1, Math.min(600, factor));
  estado.tocar();
  return estado.reloj;
}

/** Congela el mundo (los agentes siguen vivos, pero el tiempo de mundo no avanza). */
export function pausar(estado: Estado): Reloj {
  if (estado.reloj.pausado) return estado.reloj;
  actualizarReloj(estado); // contabiliza hasta este instante
  estado.reloj.pausado = true;
  (globalThis as { __atalayaMundoPausado?: boolean }).__atalayaMundoPausado = true;
  // "Parar" para de verdad: además de no lanzar llamadas nuevas, se cortan las
  // que ya están en el aire (import dinámico y tolerante: si la capa de IA no
  // está cargada, pausar sigue funcionando igual).
  void import("../ia/llm")
    .then((m) => m.abortarLlamadasIA?.("Mundo en pausa"))
    .catch(() => undefined);
  estado.tocar();
  return estado.reloj;
}

/** Reanuda. El tiempo real transcurrido durante la pausa no cuenta. */
export function reanudar(estado: Estado): Reloj {
  if (!estado.reloj.pausado) return estado.reloj;
  ancla(estado).ultimoReal = Date.now();
  estado.reloj.pausado = false;
  (globalThis as { __atalayaMundoPausado?: boolean }).__atalayaMundoPausado = false;
  estado.tocar();
  return estado.reloj;
}

/** Salto instantáneo hacia delante ("avanzar 1 h"). Funciona también en pausa. */
export function avanzarMinutos(estado: Estado, minutos: number): Reloj {
  actualizarReloj(estado);
  const a = ancla(estado);
  a.acumuladoMundoMs += Math.max(0, minutos) * 60_000;
  estado.reloj.ahoraMundo = new Date(Date.parse(estado.reloj.inicioMundo) + a.acumuladoMundoMs).toISOString();
  estado.tocar();
  return estado.reloj;
}

/** Minutos de mundo entre dos instantes ISO de mundo (negativo si b < a). */
export function minutosMundoEntre(a: string | undefined, b: string | undefined): number {
  if (!a || !b) return 0;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return (tb - ta) / 60_000;
}

/** Reinicia el ancla (al crear una ejecución nueva). */
export function reiniciarAncla(estado: Estado): void {
  registroAnclas().set(estado, { ultimoReal: Date.now(), acumuladoMundoMs: 0 });
}
