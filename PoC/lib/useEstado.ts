"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api-cliente";
import { crearEstadoDemo } from "./fixtures/estado-demo";
import type { EstadoSistema } from "./tipos-sistema";

/** Polling de respaldo cuando el stream no está disponible. */
const INTERVALO_MS = 3000;
/** Si el stream no manda nada (ni ping) en este tiempo, se reconecta. */
const SILENCIO_MAX_MS = 40_000;

export type Conexion = "conectando" | "en_vivo" | "fixture";

/**
 * Estado del sistema en tiempo real.
 *
 * 1. Se abre un EventSource contra GET /api/estado/stream: el servidor manda el
 *    snapshot completo al conectar y cada vez que cambia algo (evento "estado").
 * 2. Si el stream falla o el navegador no lo soporta, se cae a polling de
 *    GET /api/estado cada 3 s (el resultado es el mismo, solo más lento).
 * 3. Si el backend no responde en absoluto, se muestra un fixture para que la
 *    UI siga siendo navegable (las acciones fallarán con error visible).
 *
 * `desfaseMs` = reloj servidor − reloj navegador, para countdowns fiables.
 */
export function useEstado() {
  const [estado, setEstado] = useState<EstadoSistema | null>(null);
  const [conexion, setConexion] = useState<Conexion>("conectando");
  const [desfaseMs, setDesfaseMs] = useState(0);
  const enVuelo = useRef(false);
  const ultimaVersion = useRef<number>(-1);
  const recibido = useRef(false);

  const aplicar = useCallback((e: EstadoSistema) => {
    // El stream puede reenviar el mismo snapshot (ping + coalescing): solo repintamos si cambió.
    if (typeof e.version === "number" && e.version === ultimaVersion.current) return;
    ultimaVersion.current = typeof e.version === "number" ? e.version : -1;
    recibido.current = true;
    setEstado(e);
    setDesfaseMs(new Date(e.serverTime).getTime() - Date.now());
    setConexion("en_vivo");
  }, []);

  const refrescar = useCallback(async () => {
    if (enVuelo.current) return;
    enVuelo.current = true;
    try {
      const e = await api.estado();
      // Un refresco manual siempre pinta (aunque la versión coincida): así una acción
      // que falló a medias también se refleja.
      ultimaVersion.current = -1;
      aplicar(e);
    } catch {
      setConexion("fixture");
      setEstado((prev) => prev ?? crearEstadoDemo());
      setDesfaseMs(0);
    } finally {
      enVuelo.current = false;
    }
  }, [aplicar]);

  useEffect(() => {
    let cancelado = false;
    let fuente: EventSource | null = null;
    let polling: ReturnType<typeof setInterval> | null = null;
    let vigilante: ReturnType<typeof setInterval> | null = null;
    let ultimoMensaje = Date.now();

    const arrancarPolling = () => {
      if (polling) return;
      void refrescar();
      polling = setInterval(refrescar, INTERVALO_MS);
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
      fuente = new EventSource("/api/estado/stream");
      ultimoMensaje = Date.now();

      fuente.addEventListener("estado", (ev) => {
        ultimoMensaje = Date.now();
        try {
          aplicar(JSON.parse((ev as MessageEvent).data) as EstadoSistema);
          pararPolling(); // el stream funciona: el polling sobra
        } catch {
          /* snapshot ilegible: el siguiente lo arreglará */
        }
      });
      fuente.addEventListener("ping", () => {
        ultimoMensaje = Date.now();
      });
      fuente.onerror = () => {
        // EventSource reintenta solo; mientras tanto, polling para no quedarnos a ciegas.
        arrancarPolling();
      };
    };

    conectar();
    // Primer snapshot inmediato aunque el stream tarde en abrir.
    const primera = setTimeout(() => {
      if (!cancelado && !recibido.current) void refrescar();
    }, 1200);
    // Si el stream se queda mudo (proxy, suspensión del portátil…), reconectamos.
    vigilante = setInterval(() => {
      if (Date.now() - ultimoMensaje > SILENCIO_MAX_MS) conectar();
    }, 10_000);

    return () => {
      cancelado = true;
      clearTimeout(primera);
      if (vigilante) clearInterval(vigilante);
      pararPolling();
      fuente?.close();
    };
  }, [aplicar, refrescar]);

  /** Envuelve una mutación: la ejecuta y refresca el estado inmediatamente (el stream también lo empujará). */
  const accion = useCallback(
    async (fn: () => Promise<unknown>) => {
      await fn();
      await refrescar();
    },
    [refrescar],
  );

  return { estado, conexion, desfaseMs, refrescar, accion };
}

/** Reloj local sincronizado con el servidor, se actualiza cada segundo. */
export function useAhora(desfaseMs: number) {
  const [ahora, setAhora] = useState(() => Date.now() + desfaseMs);
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now() + desfaseMs), 1000);
    return () => clearInterval(id);
  }, [desfaseMs]);
  return ahora;
}
