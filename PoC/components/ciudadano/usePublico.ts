"use client";

import { useEffect, useState } from "react";
import { adaptarEstado } from "./adaptador";
import type { VistaPublica } from "./tipos";
import type { EstadoSistema } from "@/lib/tipos-sistema";

const INTERVALO_MS = 5000;

export type OrigenDatos = "publico" | "estado" | null;

export interface EstadoPortal {
  vista: VistaPublica | null;
  origen: OrigenDatos;
  cargando: boolean;
  /** Última respuesta correcta (reloj del cliente), para "Actualizado hace Ns". */
  recibidoEn: number | null;
  error: boolean;
}

async function pedirPublico(signal: AbortSignal): Promise<VistaPublica | null> {
  const r = await fetch("/api/publico", {
    cache: "no-store",
    headers: { "x-atalaya-rol": "ciudadano" },
    signal,
  });
  if (!r.ok) return null;
  return (await r.json()) as VistaPublica;
}

// Fallback mientras /api/publico no exista. Se pide sin cookie de rol (credentials: omit)
// porque /api/estado es de la consola; todo lo interno se filtra en el adaptador.
async function pedirEstado(signal: AbortSignal): Promise<VistaPublica | null> {
  const r = await fetch("/api/estado", { cache: "no-store", credentials: "omit", signal });
  if (!r.ok) return null;
  return adaptarEstado((await r.json()) as EstadoSistema);
}

export function usePublico(): EstadoPortal {
  const [st, setSt] = useState<EstadoPortal>({ vista: null, origen: null, cargando: true, recibidoEn: null, error: false });

  useEffect(() => {
    let vivo = true;
    let ctrl: AbortController | null = null;

    async function ciclo() {
      ctrl?.abort();
      ctrl = new AbortController();
      const signal = ctrl.signal;
      let vista: VistaPublica | null = null;
      let origen: OrigenDatos = null;
      try {
        // Fuente principal en cada ciclo; /api/estado + adaptador solo si falla.
        vista = await pedirPublico(signal).catch(() => null);
        if (vista) origen = "publico";
        if (!vista) {
          vista = await pedirEstado(signal).catch(() => null);
          if (vista) origen = "estado";
        }
      } catch {
        vista = null;
      }
      if (!vivo || signal.aborted) return;
      setSt((prev) =>
        vista
          ? { vista, origen, cargando: false, recibidoEn: Date.now(), error: false }
          : { ...prev, cargando: false, error: true },
      );
    }

    ciclo();
    const id = window.setInterval(ciclo, INTERVALO_MS);
    return () => {
      vivo = false;
      ctrl?.abort();
      window.clearInterval(id);
    };
  }, []);

  return st;
}

/** Reloj de 1 s para los textos "hace Ns". */
export function useAhora(): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return ahora;
}
