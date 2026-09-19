"use client";
// Estado en vivo de la sala de mando. DUEÑO: constructor E. Sin dependencias.
//
// 1. Un fetch inicial de /api/estado para no mirar una pantalla vacía mientras
//    abre el stream.
// 2. EventSource contra /api/estado/stream: `event: estado` (Snapshot completo)
//    y `event: latido` (solo para saber que el canal sigue vivo).
// 3. Si el stream falla o se queda mudo, polling de /api/estado cada 5 s y
//    reintento de conexión con retroceso exponencial (1 s → 30 s).
//
// `conectado` es lo que pinta la banda de estado: false significa "la pantalla
// puede estar desfasada", nunca se oculta.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot } from "@/lib/dominio/tipos";
import { mensajeDeError, obtenerEstado } from "./api";

/** Cada cuánto se refresca por HTTP cuando el SSE no funciona. */
const INTERVALO_POLLING_MS = 5000;
/** Si no llega nada (ni latido) en este tiempo, se reconecta el stream. */
const SILENCIO_MAX_MS = 45_000;
const ESPERA_MINIMA_MS = 1000;
const ESPERA_MAXIMA_MS = 30_000;

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

export function useEstado(): EstadoSala {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [conectado, setConectado] = useState(false);
  const [error, setError] = useState<string>();
  const [cargando, setCargando] = useState(true);
  const [ultimaVersion, setUltimaVersion] = useState(-1);

  const version = useRef(-1);
  const enVuelo = useRef(false);

  const aplicar = useCallback((s: Snapshot) => {
    // El stream puede reenviar el mismo snapshot: solo repintamos si cambió.
    if (typeof s.version === "number" && s.version === version.current) return;
    version.current = typeof s.version === "number" ? s.version : -1;
    setUltimaVersion(version.current);
    setSnapshot(s);
    setCargando(false);
    setError(undefined);
  }, []);

  const refrescar = useCallback(async () => {
    if (enVuelo.current) return;
    enVuelo.current = true;
    try {
      const s = await obtenerEstado();
      version.current = -1; // un refresco manual siempre pinta
      aplicar(s);
    } catch (e) {
      setError(mensajeDeError(e));
      setCargando(false);
    } finally {
      enVuelo.current = false;
    }
  }, [aplicar]);

  useEffect(() => {
    let cancelado = false;
    let fuente: EventSource | null = null;
    let polling: ReturnType<typeof setInterval> | null = null;
    let reintento: ReturnType<typeof setTimeout> | null = null;
    let vigilante: ReturnType<typeof setInterval> | null = null;
    let espera = ESPERA_MINIMA_MS;
    let ultimoMensaje = Date.now();

    const arrancarPolling = () => {
      if (polling || cancelado) return;
      void refrescar();
      polling = setInterval(() => void refrescar(), INTERVALO_POLLING_MS);
    };
    const pararPolling = () => {
      if (polling) clearInterval(polling);
      polling = null;
    };

    const conectar = () => {
      if (cancelado) return;
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
        setConectado(true);
        pararPolling(); // el stream funciona: el polling sobra
        try {
          aplicar(JSON.parse((ev as MessageEvent).data) as Snapshot);
        } catch {
          /* snapshot ilegible: el siguiente lo arregla */
        }
      });

      fuente.addEventListener("latido", () => {
        ultimoMensaje = Date.now();
        setConectado(true);
      });

      fuente.onerror = () => {
        setConectado(false);
        // Mientras tanto, polling para no quedarnos a ciegas.
        arrancarPolling();
        fuente?.close();
        fuente = null;
        if (reintento) clearTimeout(reintento);
        reintento = setTimeout(conectar, espera);
        espera = Math.min(espera * 2, ESPERA_MAXIMA_MS);
      };
    };

    // Primer snapshot inmediato: no se espera al stream para tener pantalla.
    // `refrescar` es asíncrona (su setState ocurre al resolverse el fetch, no
    // en el cuerpo del efecto); es la suscripción a un sistema externo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refrescar();
    conectar();

    // Si el stream se queda mudo (proxy, portátil suspendido…), se reconecta.
    vigilante = setInterval(() => {
      if (Date.now() - ultimoMensaje > SILENCIO_MAX_MS) {
        setConectado(false);
        conectar();
      }
    }, 10_000);

    return () => {
      cancelado = true;
      if (vigilante) clearInterval(vigilante);
      if (reintento) clearTimeout(reintento);
      pararPolling();
      fuente?.close();
    };
  }, [aplicar, refrescar]);

  return { snapshot, conectado, ultimaVersion, error, cargando, refrescar };
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
