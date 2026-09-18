"use client";

// Datos de la sala de periféricos (poc-07 · subagente D).
//
// Tres recursos independientes, cada uno con su propio ritmo, su estado de carga
// y su error, para que la caída de uno no apague la pantalla entera:
//   - GET /api/perifericos                      cada  3 s  (quién está conectado + URL del QR)
//   - GET /api/perifericos/camaras?n=8          cada 60 s  (cámaras municipales más cercanas)
//   - GET /api/ingesta/publicaciones?limite=30  cada  5 s  (muro social)
//
// Los endpoints los sirven otras sesiones (B y C) y pueden no existir todavía:
// un 404 no es un error, es "aún no está" (`ausente`), y la UI lo enseña como
// aviso discreto en vez de romperse. El estado del sistema (incidente, grafo,
// eventos, decisiones) NO se pide aquí: para eso está lib/useEstado.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CamaraTrafico, EstadoPerifericos, Periferico, Publicacion, ResultadoIngesta } from "./tipos-perifericos";

/** Respuesta de GET /api/perifericos: `EstadoPerifericos` más pistas sobre la URL del QR. */
export interface RespuestaPerifericos extends EstadoPerifericos {
  /** true si `urlUnion` es https (sin ella el móvil no da cámara ni GPS). */
  urlSegura?: boolean;
  /** De dónde sale la URL: túnel público, IP de la Wi-Fi local, localhost o variable de entorno. */
  origenUrl?: EstadoPerifericos["origenUrl"];
}

/** Estado de un recurso sondeado: datos + carga + error + "el endpoint no existe aún". */
export interface Recurso<T> {
  datos: T;
  cargando: boolean;
  error: string | null;
  /** El endpoint devolvió 404: la sesión que lo implementa todavía no lo ha subido. */
  ausente: boolean;
  refrescar: () => Promise<void>;
}

const MS_PERIFERICOS = 3000;
const MS_CAMARAS = 60_000;
const MS_PUBLICACIONES = 5000;

/** Acepta tanto `T[]` como `{ <clave>: T[] }` (los backends de la demo varían). */
function lista<T>(json: unknown, clave: string): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object") {
    const valor = (json as Record<string, unknown>)[clave];
    if (Array.isArray(valor)) return valor as T[];
  }
  return [];
}

const mapearCamaras = (json: unknown) => lista<CamaraTrafico>(json, "camaras");
const mapearPublicaciones = (json: unknown) => lista<Publicacion>(json, "publicaciones");
const mapearEstado = (json: unknown) => (json && typeof json === "object" ? (json as RespuestaPerifericos) : null);

function mensaje(e: unknown) {
  return e instanceof Error ? e.message : "no se pudo contactar con el servidor";
}

/**
 * Sondea `url` cada `intervaloMs` y mantiene el último valor bueno.
 * `mapear` debe ser estable (función de módulo), no una lambda en línea.
 */
function useRecurso<T>(url: string, inicial: T, intervaloMs: number, mapear: (json: unknown) => T): Recurso<T> {
  const [datos, setDatos] = useState<T>(inicial);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ausente, setAusente] = useState(false);
  const enVuelo = useRef(false);

  const refrescar = useCallback(async () => {
    if (enVuelo.current) return;
    enVuelo.current = true;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 404) {
        setAusente(true);
        setError(null);
        return;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const texto = await res.text();
      setDatos(mapear(texto ? JSON.parse(texto) : null));
      setAusente(false);
      setError(null);
    } catch (e) {
      setError(mensaje(e));
    } finally {
      enVuelo.current = false;
      setCargando(false);
    }
  }, [url, mapear]);

  useEffect(() => {
    // La primera carga va fuera del cuerpo del efecto (setState tras el await).
    const primera = setTimeout(refrescar, 0);
    const id = setInterval(refrescar, intervaloMs);
    return () => {
      clearTimeout(primera);
      clearInterval(id);
    };
  }, [refrescar, intervaloMs]);

  return { datos, cargando, error, ausente, refrescar };
}

async function mutar(url: string, metodo: "POST" | "PATCH" | "DELETE", cuerpo?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = String(body.error);
    } catch {
      /* cuerpo no JSON */
    }
    throw new Error(msg);
  }
  const texto = await res.text();
  return texto ? JSON.parse(texto) : undefined;
}

export interface SalaPerifericos {
  perifericos: Periferico[];
  enLinea: number;
  urlUnion: string;
  urlSegura: boolean;
  origenUrl: string;
  estadoPerifericos: Recurso<RespuestaPerifericos | null>;
  camaras: CamaraTrafico[];
  estadoCamaras: Recurso<CamaraTrafico[]>;
  publicaciones: Publicacion[];
  estadoPublicaciones: Recurso<Publicacion[]>;
  /** Pide un análisis de visión de una cámara municipal y refresca la cuadrícula. */
  analizarCamara: (id: string) => Promise<ResultadoIngesta | undefined>;
  /** Da de baja un periférico (el móvil tendrá que volver a emparejarse). */
  eliminarPeriferico: (id: string) => Promise<void>;
  /** Cambia manual ↔ vigilancia y el intervalo de fotograma. */
  cambiarModo: (id: string, modo: Periferico["modo"], intervaloVigilanciaSeg?: number) => Promise<void>;
}

export function usePerifericos(): SalaPerifericos {
  const estadoPerifericos = useRecurso<RespuestaPerifericos | null>(
    "/api/perifericos",
    null,
    MS_PERIFERICOS,
    mapearEstado,
  );
  const estadoCamaras = useRecurso<CamaraTrafico[]>("/api/perifericos/camaras?n=8", [], MS_CAMARAS, mapearCamaras);
  const estadoPublicaciones = useRecurso<Publicacion[]>(
    "/api/ingesta/publicaciones?limite=30",
    [],
    MS_PUBLICACIONES,
    mapearPublicaciones,
  );

  const refrescarPerifericos = estadoPerifericos.refrescar;
  const refrescarCamaras = estadoCamaras.refrescar;

  const analizarCamara = useCallback(
    async (id: string) => {
      const r = (await mutar(`/api/perifericos/camaras/${encodeURIComponent(id)}/analizar`, "POST")) as
        | ResultadoIngesta
        | undefined;
      await refrescarCamaras();
      return r;
    },
    [refrescarCamaras],
  );

  const eliminarPeriferico = useCallback(
    async (id: string) => {
      await mutar(`/api/perifericos/${encodeURIComponent(id)}`, "DELETE");
      await refrescarPerifericos();
    },
    [refrescarPerifericos],
  );

  const cambiarModo = useCallback(
    async (id: string, modo: Periferico["modo"], intervaloVigilanciaSeg?: number) => {
      await mutar(`/api/perifericos/${encodeURIComponent(id)}`, "PATCH", {
        modo,
        ...(intervaloVigilanciaSeg === undefined ? {} : { intervaloVigilanciaSeg }),
      });
      await refrescarPerifericos();
    },
    [refrescarPerifericos],
  );

  const datos = estadoPerifericos.datos;
  const perifericos = datos?.perifericos ?? [];

  return {
    perifericos,
    enLinea: perifericos.filter((p) => p.enLinea).length,
    urlUnion: datos?.urlUnion ?? "",
    urlSegura: datos?.urlSegura ?? (datos?.urlUnion ?? "").startsWith("https://"),
    origenUrl: datos?.origenUrl ?? "",
    estadoPerifericos,
    camaras: estadoCamaras.datos,
    estadoCamaras,
    publicaciones: estadoPublicaciones.datos,
    estadoPublicaciones,
    analizarCamara,
    eliminarPeriferico,
    cambiarModo,
  };
}
