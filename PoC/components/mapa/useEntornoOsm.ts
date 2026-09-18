"use client";

// Hook del entorno real de OpenStreetMap (Overpass desde el cliente, ver overpass.ts).
//
// Almacén a nivel de módulo, por centro y modo: aunque el mapa se monte dos veces
// (StrictMode, cambio de vista Mapa ↔ Grafo) se hace UNA sola petición por centro.
// Si Overpass no responde, se reintenta cada 2,5 min como mucho (máx. 6 intentos,
// solo mientras el mapa está montado) y nunca en bucle.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { consultarOverpass, guardarCache, leerCache, type Centro, type EntornoOsm, type ModoConsulta } from "./overpass";

export type EstadoEntornoOsm =
  | { fase: "inactivo" }
  | { fase: "cargando"; intento: number }
  | { fase: "listo"; datos: EntornoOsm; desdeCache: boolean }
  | { fase: "error"; mensaje: string; detalle: string; intento: number; proximoIntento: number | null };

const REINTENTO_MS = 150_000;
const MAX_INTENTOS = 6;

interface Entrada {
  centro: Centro;
  modo: ModoConsulta;
  estado: EstadoEntornoOsm;
  suscriptores: number;
  intentos: number;
  enVuelo: boolean;
  temporizador: ReturnType<typeof setTimeout> | null;
}

const INACTIVO: EstadoEntornoOsm = { fase: "inactivo" };
const PENDIENTE: EstadoEntornoOsm = { fase: "cargando", intento: 1 };

const entradas = new Map<string, Entrada>();
const oyentes = new Set<() => void>();

const claveDe = (c: Centro, modo: ModoConsulta) => `${modo}:${c.lat.toFixed(3)},${c.lon.toFixed(3)}`;

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

function fijar(e: Entrada, estado: EstadoEntornoOsm) {
  e.estado = estado;
  for (const o of oyentes) o();
}

function programarReintento(e: Entrada) {
  if (e.temporizador) clearTimeout(e.temporizador);
  e.temporizador = setTimeout(() => {
    e.temporizador = null;
    if (e.suscriptores > 0) void cargar(e);
  }, REINTENTO_MS);
}

async function cargar(e: Entrada) {
  if (e.enVuelo) return;

  // 1) Caché: la del mismo modo o, para "vias", la del modo completo (que ya las incluye).
  const enCache = leerCache(e.centro, e.modo) ?? (e.modo === "vias" ? leerCache(e.centro, "completo") : null);
  if (enCache) {
    fijar(e, { fase: "listo", datos: enCache, desdeCache: true });
    return;
  }
  if (e.modo === "vias") {
    const completo = entradas.get(claveDe(e.centro, "completo"));
    if (completo?.estado.fase === "listo") {
      fijar(e, completo.estado);
      return;
    }
  }

  // 2) Red: servidor principal y, si falla, el alternativo (dentro de consultarOverpass).
  e.enVuelo = true;
  e.intentos += 1;
  fijar(e, { fase: "cargando", intento: e.intentos });
  try {
    const datos = await consultarOverpass(e.centro, e.modo);
    guardarCache(e.centro, e.modo, datos);
    fijar(e, { fase: "listo", datos, desdeCache: false });
  } catch (err) {
    const quedan = e.intentos < MAX_INTENTOS && e.suscriptores > 0;
    fijar(e, {
      fase: "error",
      mensaje: "Entorno OSM no disponible ahora: Overpass sin respuesta",
      detalle: err instanceof Error ? err.message : "error de red",
      intento: e.intentos,
      proximoIntento: quedan ? Date.now() + REINTENTO_MS : null,
    });
    if (quedan) programarReintento(e);
  } finally {
    e.enVuelo = false;
  }
}

function registrar(clave: string, centro: Centro, modo: ModoConsulta) {
  let e = entradas.get(clave);
  if (!e) {
    e = { centro, modo, estado: PENDIENTE, suscriptores: 0, intentos: 0, enVuelo: false, temporizador: null };
    entradas.set(clave, e);
  }
  const entrada = e;
  entrada.suscriptores += 1;
  if (entrada.estado === PENDIENTE && !entrada.enVuelo) void cargar(entrada);
  // Al volver a montar tras un error, se retoma la cuenta atrás (no se reintenta en el acto).
  else if (entrada.estado.fase === "error" && !entrada.temporizador && entrada.intentos < MAX_INTENTOS) programarReintento(entrada);
  return () => {
    entrada.suscriptores -= 1;
    if (entrada.suscriptores <= 0 && entrada.temporizador) {
      clearTimeout(entrada.temporizador);
      entrada.temporizador = null;
    }
  };
}

function reintentarAhora(clave: string) {
  const e = entradas.get(clave);
  if (!e || e.enVuelo) return;
  if (e.temporizador) clearTimeout(e.temporizador);
  e.temporizador = null;
  e.intentos = 0;
  void cargar(e);
}

export type ResultadoEntornoOsm = EstadoEntornoOsm & { reintentar: () => void };

/**
 * Entorno real alrededor de `centro`. `activo: false` no consulta nada.
 * `modo: "vias"` pide solo las vías principales (el servidor ya trae los equipamientos).
 */
export function useEntornoOsm(
  centro: Centro | null | undefined,
  { modo = "completo", activo = true }: { modo?: ModoConsulta; activo?: boolean } = {},
): ResultadoEntornoOsm {
  const lat = centro?.lat;
  const lon = centro?.lon;
  const valido = activo && typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon);
  const clave = valido ? claveDe({ lat, lon }, modo) : null;

  const estado = useSyncExternalStore(
    suscribir,
    () => (clave ? (entradas.get(clave)?.estado ?? PENDIENTE) : INACTIVO),
    () => INACTIVO,
  );

  useEffect(() => {
    if (!clave || typeof lat !== "number" || typeof lon !== "number") return;
    return registrar(clave, { lat, lon }, modo);
  }, [clave, lat, lon, modo]);

  const reintentar = useCallback(() => {
    if (clave) reintentarAhora(clave);
  }, [clave]);

  return { ...estado, reintentar };
}
