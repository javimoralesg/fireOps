"use client";
// Catálogo completo de cámaras de España para el mapa. DUEÑO: constructor H.
//
// Se pide UNA vez al abrir la sala y se refresca cada 10 minutos (el catálogo
// de la DGT cambia muy poco y el servidor ya lo cachea una hora). Si falla, se
// dice con todas las letras: nunca se inventa una lista.
//
// La caché vive en el módulo, no en un `useRef`: en desarrollo React monta cada
// efecto dos veces, y con un guardia por referencia la primera petición se
// cancelaba y la segunda no llegaba a lanzarse (la capa se quedaba vacía y
// "cargando" para siempre). Así los remontajes reaprovechan lo ya descargado.

import { useEffect, useState } from "react";
import type { Camara } from "@/lib/dominio/tipos";
import { listarTodasLasCamaras, mensajeDeError } from "@/lib/cliente/api";

const REFRESCO_MS = 10 * 60_000;

let cache: Camara[] = [];
let cacheEn = 0;
/** Petición en vuelo compartida: dos montajes a la vez no piden dos veces. */
let enVuelo: Promise<Camara[]> | null = null;

function descargar(): Promise<Camara[]> {
  if (cache.length && Date.now() - cacheEn < REFRESCO_MS) return Promise.resolve(cache);
  if (enVuelo) return enVuelo;
  enVuelo = listarTodasLasCamaras()
    .then(({ camaras }) => {
      cache = camaras ?? [];
      cacheEn = Date.now();
      return cache;
    })
    .finally(() => {
      enVuelo = null;
    });
  return enVuelo;
}

export interface CatalogoCamaras {
  camaras: Camara[];
  cargando: boolean;
  error?: string;
}

export function useCamarasEspana(activa: boolean): CatalogoCamaras {
  const [camaras, setCamaras] = useState<Camara[]>(() => cache);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!activa) return;
    let cancelado = false;

    const cargar = () => {
      if (cancelado) return;
      setCargando(true);
      descargar()
        .then((lista) => {
          if (cancelado) return;
          setCamaras(lista);
          setError(undefined);
        })
        .catch((e: unknown) => {
          if (!cancelado) setError(mensajeDeError(e));
        })
        .finally(() => {
          if (!cancelado) setCargando(false);
        });
    };

    // `descargar()` resuelve al instante si la caché está fresca, así que esto
    // no repite la petición al volver a encender la capa.
    cargar();

    const id = setInterval(cargar, REFRESCO_MS);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [activa]);

  return { camaras, cargando, error };
}
