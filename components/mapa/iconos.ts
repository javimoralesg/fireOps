"use client";
// Caché de iconos (`L.divIcon`) a nivel de módulo. DUEÑO: constructor Q (rendimiento).
//
// POR QUÉ EXISTE: react-leaflet llama a `marker.setIcon()` en cuanto la prop
// `icon` cambia DE REFERENCIA, y `setIcon` destruye y reconstruye el nodo del
// icono (`createIcon`) y con él reinicia la animación `atalaya-latido`. Con
// ~2.000 marcadores y un snapshot cada 1,4 s eso eran ~2.000 reconstrucciones de
// DOM por snapshot (y el goteo de nodos desprendidos que las acompaña).
//
// Aquí se devuelve SIEMPRE la misma instancia para el mismo HTML y tamaño, así
// que mientras un elemento no cambie de aspecto Leaflet no toca su nodo.
// Compartir una instancia de icono entre varios marcadores es el uso normal de
// Leaflet: `createIcon` crea un nodo nuevo en cada llamada y el icono no guarda
// estado del marcador.

import L from "leaflet";

/** Tope de la caché: por encima se expulsa lo usado hace más tiempo. */
const MAXIMO = 4000;

const cache = new Map<string, L.DivIcon>();

export interface OpcionesIcono {
  /** HTML ya construido (p. ej. por `marcadorHtml`). */
  html: string;
  /** [ancho, alto] en píxeles. */
  tamano: [number, number];
  /** Ancla; por defecto, el centro. */
  ancla?: [number, number];
  clase?: string;
}

/** `L.divIcon` reutilizado: misma clave → misma instancia → Leaflet no repinta. */
export function iconoDiv({ html, tamano, ancla, clase = "icono-atalaya" }: OpcionesIcono): L.DivIcon {
  const clave = `${clase}|${tamano[0]}x${tamano[1]}|${ancla ? `${ancla[0]},${ancla[1]}` : "centro"}|${html}`;
  const guardado = cache.get(clave);
  if (guardado) {
    // LRU pobre pero suficiente: al usarlo vuelve al final de la cola.
    cache.delete(clave);
    cache.set(clave, guardado);
    return guardado;
  }
  const icono = L.divIcon({
    className: clase,
    html,
    iconSize: tamano,
    iconAnchor: ancla ?? [tamano[0] / 2, tamano[1] / 2],
  });
  cache.set(clave, icono);
  if (cache.size > MAXIMO) {
    const llaves = cache.keys();
    for (let i = cache.size - MAXIMO; i > 0; i -= 1) {
      const k = llaves.next().value;
      if (k !== undefined) cache.delete(k);
    }
  }
  return icono;
}

/**
 * Rumbo redondeado a tramos de 15° para la flecha de sentido del icono. Sin
 * esto, cada snapshot cambiaría un decimal del HTML y la caché no serviría de
 * nada; con 15° la flecha se ve igual y el icono se reutiliza mientras la
 * unidad avanza en línea recta.
 */
export function rumboRedondeado(grados: number | null | undefined): number | undefined {
  if (typeof grados !== "number" || !Number.isFinite(grados)) return undefined;
  return (Math.round(grados / 15) * 15) % 360;
}

/** Solo para pruebas y diagnóstico. */
export function tamanoCacheIconos(): number {
  return cache.size;
}

/** Solo para pruebas. */
export function vaciarCacheIconos(): void {
  cache.clear();
}
