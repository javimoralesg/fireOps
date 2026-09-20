"use client";
// Estado en vivo de la sala de mando. DUEÑO: constructor E. Sin dependencias.
//
// 1. UN SOLO EventSource por pestaña (constructor P): el canal vive a nivel de
//    módulo y todas las instancias del hook se cuelgan de él con un contador de
//    referencias; cuando nadie lo usa se cierra (con una pequeña gracia para
//    sobrevivir al doble montaje de React en desarrollo y a las navegaciones).
// 2. El snapshot llega por `event: estado` (y `event: latido` solo dice que el
//    canal sigue vivo). El fetch inicial de /api/estado SOLO se hace si el
//    stream no ha entregado nada en 1,5 s: normalmente no se descarga dos veces.
// 3. Si el stream falla o se queda mudo, polling condicional de /api/estado
//    (If-None-Match: si el servidor contesta 304 no se repinta nada) y
//    reconexión con retroceso exponencial (1 s → 30 s).
// 4. Cada snapshot que entra se FUSIONA con el anterior (`fundirSnapshot`):
//    un item con el mismo id y sin cambios conserva la misma referencia, y un
//    array sin cambios conserva su referencia. Es el contrato con el que los
//    componentes del mapa y de la sala construyen sus memos.
//
// `conectado` es lo que pinta la banda de estado: false significa "la pantalla
// puede estar desfasada", nunca se oculta.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Snapshot } from "@/lib/dominio/tipos";
import { mensajeDeError, obtenerEstado, obtenerEstadoSiCambio } from "./api";

/** Cada cuánto se refresca por HTTP cuando el SSE no funciona. */
const INTERVALO_POLLING_MS = 5000;
/** Si no llega nada (ni latido) en este tiempo, se reconecta el stream. */
const SILENCIO_MAX_MS = 45_000;
const ESPERA_MINIMA_MS = 1000;
const ESPERA_MAXIMA_MS = 30_000;
/** Margen que se le da al stream antes de pedir el primer snapshot por HTTP. */
const ESPERA_PRIMER_SNAPSHOT_MS = 1500;
/** Gracia antes de cerrar el canal cuando el último consumidor se va. */
const GRACIA_CIERRE_MS = 2000;

export interface EstadoSala {
  snapshot?: Snapshot;
  /** true si el SSE está entregando datos. */
  conectado: boolean;
  /** Versión del último snapshot aplicado (-1 si aún no hay ninguno). */
  ultimaVersion: number;
  /** Último error de red o del servidor, ya legible. */
  error?: string;
  /** true mientras no ha llegado ni un solo snapshot. */
  cargando: boolean;
  /** Fuerza un refresco por HTTP (tras una acción, para no esperar al tick). */
  refrescar: () => Promise<void>;
}

// =====================================================================
// Fusión de snapshots: conservar identidades
// =====================================================================

/** Sellos de cambio que añade el servidor (lib/motor/estado.ts). */
interface SellosSnapshot {
  coleccion: Record<string, number>;
  item: Record<string, number[]>;
}
type SnapshotSellado = Snapshot & { sellos?: SellosSnapshot };

/** Colecciones del snapshot que se fusionan item a item. */
const COLECCIONES = [
  "incendios",
  "clusters",
  "unidades",
  "poblaciones",
  "hospitales",
  "camaras",
  "focosSatelite",
  "observaciones",
  "decisiones",
  "comunicados",
  "agentes",
  "avisosMeteo",
  "zonasPeligro",
  "eventos",
  "lecciones",
  "informes",
  "tickets",
] as const;

/** Campos sueltos (pequeños) que también conservan referencia si no cambian. */
const CAMPOS_SUELTOS = ["reloj", "ejecucion", "politica", "servicios"] as const;

/** Clave estable de un item (`zonasPeligro` no tiene id: se identifica por nombre). */
function claveDe(item: unknown): string {
  const o = item as { id?: string; nombre?: string } | null;
  return o?.id ?? o?.nombre ?? "";
}

/** Igualdad estructural con cortocircuito (sin serializar). */
function iguales(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!iguales(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ca = a as Record<string, unknown>;
  const cb = b as Record<string, unknown>;
  const claves = Object.keys(ca);
  if (claves.length !== Object.keys(cb).length) return false;
  for (const k of claves) {
    if (!(k in cb)) return false;
    if (!iguales(ca[k], cb[k])) return false;
  }
  return true;
}

/**
 * Funde el snapshot recién recibido con el anterior conservando identidades:
 *   · un item con la misma clave y sin cambios conserva el MISMO objeto;
 *   · un array en el que nada cambió conserva la MISMA referencia.
 * Usa los `sellos` del servidor cuando están (comparación O(1) por item) y cae
 * a comparación estructural cuando no. Modifica `nuevo` en sitio y lo devuelve.
 */
export function fundirSnapshot(nuevo: Snapshot, previo?: Snapshot): Snapshot {
  if (!previo || !nuevo) return nuevo;
  // Otra ejecución: el Estado nuevo arranca versión y sellos desde cero, así que
  // un sello igual no significa nada y ninguna referencia anterior sirve.
  if (previo.ejecucion?.id !== nuevo.ejecucion?.id) return nuevo;
  const sellosN = (nuevo as SnapshotSellado).sellos;
  const sellosP = (previo as SnapshotSellado).sellos;
  const salida = nuevo as unknown as Record<string, unknown>;
  const anterior = previo as unknown as Record<string, unknown>;

  for (const col of COLECCIONES) {
    const arrN = salida[col];
    const arrP = anterior[col];
    if (!Array.isArray(arrN) || !Array.isArray(arrP)) continue;

    // Atajo: la colección entera no ha cambiado → misma referencia de array.
    const selloN = sellosN?.coleccion?.[col];
    const selloP = sellosP?.coleccion?.[col];
    if (selloN !== undefined && selloN === selloP && arrN.length === arrP.length) {
      salida[col] = arrP;
      continue;
    }

    const previos = new Map<string, unknown>();
    const selloPrevioPorClave = new Map<string, number>();
    const itemP = sellosP?.item?.[col];
    for (let i = 0; i < arrP.length; i++) {
      const k = claveDe(arrP[i]);
      previos.set(k, arrP[i]);
      if (itemP) selloPrevioPorClave.set(k, itemP[i]);
    }
    const itemN = sellosN?.item?.[col];

    let todoIgual = arrN.length === arrP.length;
    const fundido = new Array(arrN.length);
    for (let i = 0; i < arrN.length; i++) {
      const item = arrN[i];
      const k = claveDe(item);
      const ant = previos.get(k);
      if (ant === undefined) {
        todoIgual = false;
        fundido[i] = item;
        continue;
      }
      const sN = itemN?.[i];
      const sP = selloPrevioPorClave.get(k);
      const sinCambios = sN !== undefined && sP !== undefined ? sN === sP : iguales(ant, item);
      if (sinCambios) {
        if (arrP[i] !== ant) todoIgual = false; // cambió el orden
        fundido[i] = ant;
      } else {
        todoIgual = false;
        fundido[i] = item;
      }
    }
    salida[col] = todoIgual ? arrP : fundido;
  }

  for (const campo of CAMPOS_SUELTOS) {
    if (anterior[campo] !== undefined && iguales(anterior[campo], salida[campo])) salida[campo] = anterior[campo];
  }
  return nuevo;
}

// =====================================================================
// Canal compartido (un EventSource por pestaña)
// =====================================================================

interface Vista {
  snapshot?: Snapshot;
  conectado: boolean;
  ultimaVersion: number;
  error?: string;
  cargando: boolean;
}

const VISTA_INICIAL: Vista = { conectado: false, ultimaVersion: -1, cargando: true };

let vista: Vista = VISTA_INICIAL;
const oyentes = new Set<() => void>();

let referencias = 0;
let fuente: EventSource | null = null;
let polling: ReturnType<typeof setInterval> | null = null;
let reintento: ReturnType<typeof setTimeout> | null = null;
let vigilante: ReturnType<typeof setInterval> | null = null;
let primerSondeo: ReturnType<typeof setTimeout> | null = null;
let cierreDiferido: ReturnType<typeof setTimeout> | null = null;
let espera = ESPERA_MINIMA_MS;
let ultimoMensaje = 0;
let enVuelo = false;

function publicar(parcial: Partial<Vista>): void {
  let cambio = false;
  for (const [k, v] of Object.entries(parcial)) {
    if ((vista as unknown as Record<string, unknown>)[k] !== v) cambio = true;
  }
  if (!cambio) return;
  vista = { ...vista, ...parcial };
  for (const fn of [...oyentes]) fn();
}

function aplicar(s: Snapshot, forzar = false): void {
  // La versión solo es monotónica DENTRO de una ejecución. Tras reiniciar el
  // servidor puede volver a coincidir con la que conservaba la pestaña; si se
  // ignora ese primer snapshot, la UI sigue mostrando IDs que ya no existen.
  const mismaEjecucion = vista.snapshot?.ejecucion?.id === s.ejecucion?.id;
  if (!forzar && mismaEjecucion && typeof s.version === "number" && s.version === vista.ultimaVersion) return;
  const fundido = fundirSnapshot(s, vista.snapshot);
  publicar({
    snapshot: fundido,
    ultimaVersion: typeof s.version === "number" ? s.version : -1,
    cargando: false,
    error: undefined,
  });
}

/** Sondeo condicional: 304 ⇒ no hay novedades ⇒ no se repinta nada. */
async function sondear(forzar = false): Promise<void> {
  if (enVuelo) return;
  enVuelo = true;
  try {
    if (forzar) {
      aplicar(await obtenerEstado(), true);
    } else {
      const s = await obtenerEstadoSiCambio(vista.ultimaVersion, vista.snapshot?.ejecucion?.id);
      if (s) aplicar(s);
      else if (vista.cargando) publicar({ cargando: false });
    }
  } catch (e) {
    publicar({ error: mensajeDeError(e), cargando: false });
  } finally {
    enVuelo = false;
  }
}

function arrancarPolling(): void {
  if (polling || referencias === 0) return;
  void sondear();
  polling = setInterval(() => void sondear(), INTERVALO_POLLING_MS);
}

function pararPolling(): void {
  if (polling) clearInterval(polling);
  polling = null;
}

function conectar(): void {
  if (referencias === 0) return;
  if (typeof EventSource === "undefined") {
    arrancarPolling();
    return;
  }
  fuente?.close();
  ultimoMensaje = Date.now();
  try {
    fuente = new EventSource("/api/estado/stream");
  } catch {
    arrancarPolling();
    return;
  }

  fuente.addEventListener("open", () => {
    espera = ESPERA_MINIMA_MS;
    ultimoMensaje = Date.now();
  });

  fuente.addEventListener("estado", (ev) => {
    ultimoMensaje = Date.now();
    espera = ESPERA_MINIMA_MS;
    pararPolling(); // el stream funciona: el polling sobra
    if (primerSondeo) {
      clearTimeout(primerSondeo);
      primerSondeo = null;
    }
    publicar({ conectado: true });
    try {
      aplicar(JSON.parse((ev as MessageEvent).data) as Snapshot);
    } catch {
      /* snapshot ilegible: el siguiente lo arregla */
    }
  });

  fuente.addEventListener("latido", () => {
    ultimoMensaje = Date.now();
    publicar({ conectado: true });
  });

  fuente.onerror = () => {
    publicar({ conectado: false });
    arrancarPolling(); // mientras tanto, para no quedarnos a ciegas
    fuente?.close();
    fuente = null;
    if (reintento) clearTimeout(reintento);
    reintento = setTimeout(conectar, espera);
    espera = Math.min(espera * 2, ESPERA_MAXIMA_MS);
  };
}

function abrirCanal(): void {
  conectar();
  // El stream manda el primer snapshot nada más conectar: solo se pide por HTTP
  // si tarda. Así no se descargan dos veces varios megas al abrir la sala.
  if (!vista.snapshot && !primerSondeo) {
    primerSondeo = setTimeout(() => {
      primerSondeo = null;
      if (!vista.snapshot) void sondear();
    }, ESPERA_PRIMER_SNAPSHOT_MS);
  }
  vigilante = setInterval(() => {
    if (Date.now() - ultimoMensaje > SILENCIO_MAX_MS) {
      publicar({ conectado: false });
      conectar();
    }
  }, 10_000);
}

function cerrarCanal(): void {
  if (vigilante) clearInterval(vigilante);
  vigilante = null;
  if (reintento) clearTimeout(reintento);
  reintento = null;
  if (primerSondeo) clearTimeout(primerSondeo);
  primerSondeo = null;
  pararPolling();
  fuente?.close();
  fuente = null;
  publicar({ conectado: false });
}

function retener(): () => void {
  referencias += 1;
  if (cierreDiferido) {
    clearTimeout(cierreDiferido);
    cierreDiferido = null;
  }
  if (referencias === 1 && !fuente && !polling) abrirCanal();
  let soltado = false;
  return () => {
    if (soltado) return;
    soltado = true;
    referencias = Math.max(0, referencias - 1);
    if (referencias > 0) return;
    if (cierreDiferido) clearTimeout(cierreDiferido);
    cierreDiferido = setTimeout(() => {
      cierreDiferido = null;
      if (referencias === 0) cerrarCanal();
    }, GRACIA_CIERRE_MS);
  };
}

function suscribirVista(fn: () => void): () => void {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

const leerVista = (): Vista => vista;
const leerVistaServidor = (): Vista => VISTA_INICIAL;

// =====================================================================
// Hook
// =====================================================================

export function useEstado(): EstadoSala {
  const actual = useSyncExternalStore(suscribirVista, leerVista, leerVistaServidor);

  useEffect(() => retener(), []);

  // Una acción del usuario sí puede forzar el repintado (no espera al tick).
  const refrescar = useCallback(() => sondear(true), []);

  return {
    snapshot: actual.snapshot,
    conectado: actual.conectado,
    ultimaVersion: actual.ultimaVersion,
    error: actual.error,
    cargando: actual.cargando,
    refrescar,
  };
}

/** Reloj local que avanza cada segundo: para que "hace 2 min" se actualice solo. */
export function useAhora(intervaloMs = 1000): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);
  return ahora;
}
