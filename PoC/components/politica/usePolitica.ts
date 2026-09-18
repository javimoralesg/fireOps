"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizarPolitica, type AjusteCategoria, type CategoriaId, type PoliticaAutonomia } from "@/lib/politica-autonomia";
import { CABECERA_ROL, type RolId } from "@/lib/roles";
import { rolActual } from "@/lib/useRol";

const INTERVALO_MS = 5000;

export interface ErrorPolitica {
  mensaje: string;
  status: number;
  escalarA?: RolId;
}

interface Respuesta {
  politica: PoliticaAutonomia;
  umbralAutonomia: number;
}

async function llamar(metodo: "GET" | "PUT", cuerpo?: unknown): Promise<Respuesta> {
  const res = await fetch("/api/politica", {
    method: metodo,
    headers: { "Content-Type": "application/json", [CABECERA_ROL]: rolActual() },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    cache: "no-store",
  });
  if (!res.ok) {
    let mensaje = `${res.status} ${res.statusText}`;
    let escalarA: RolId | undefined;
    try {
      const b = await res.json();
      if (b?.error) mensaje = String(b.error);
      escalarA = b?.escalarA;
    } catch {
      /* sin cuerpo JSON */
    }
    const err: ErrorPolitica = { mensaje, status: res.status, escalarA };
    throw err;
  }
  const b = (await res.json()) as Respuesta;
  return { politica: normalizarPolitica(b.politica), umbralAutonomia: b.umbralAutonomia };
}

/**
 * Política de autonomía servida por GET /api/politica (sondeo ligero cada 5 s:
 * cambia solo cuando alguien la edita) y mutaciones por PUT. `umbralServidor`
 * es el umbral que vio la última respuesta; el vivo lo da useEstado().
 */
export function usePolitica() {
  const [politica, setPolitica] = useState<PoliticaAutonomia | null>(null);
  const [umbralServidor, setUmbralServidor] = useState<number | null>(null);
  const [error, setError] = useState<ErrorPolitica | null>(null);
  const [sinBackend, setSinBackend] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const enVuelo = useRef(false);

  const cargar = useCallback(async () => {
    if (enVuelo.current) return;
    enVuelo.current = true;
    try {
      const r = await llamar("GET");
      setPolitica(r.politica);
      setUmbralServidor(r.umbralAutonomia);
      setSinBackend(false);
    } catch {
      setSinBackend(true);
      setPolitica((p) => p ?? normalizarPolitica(null));
    } finally {
      enVuelo.current = false;
    }
  }, []);

  useEffect(() => {
    const primera = setTimeout(cargar, 0);
    const id = setInterval(cargar, INTERVALO_MS);
    return () => {
      clearTimeout(primera);
      clearInterval(id);
    };
  }, [cargar]);

  const mutar = useCallback(async (cuerpo: unknown) => {
    setGuardando(true);
    setError(null);
    try {
      const r = await llamar("PUT", cuerpo);
      setPolitica(r.politica);
      setUmbralServidor(r.umbralAutonomia);
    } catch (e) {
      setError(e as ErrorPolitica);
      throw e;
    } finally {
      setGuardando(false);
    }
  }, []);

  const ajustar = useCallback((categoria: CategoriaId, ajuste: AjusteCategoria) => mutar({ categoria, ajuste }), [mutar]);
  const restablecer = useCallback(() => mutar({ restablecer: true }), [mutar]);

  return { politica, umbralServidor, cargando: politica === null, error, sinBackend, guardando, ajustar, restablecer, recargar: cargar, limpiarError: () => setError(null) };
}
