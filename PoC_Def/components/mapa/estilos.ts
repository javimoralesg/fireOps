"use client";
// Opciones de trazo (`pathOptions`) memoizadas por color. DUEÑO: constructor Q.
//
// POR QUÉ EXISTE: react-leaflet compara `pathOptions` POR REFERENCIA y llama a
// `setStyle()` en cuanto cambia. Un objeto literal dentro del JSX cambia en cada
// render, así que cada snapshot reestilaba las ~1.500 capas de canvas. Los
// colores vienen del tema (media docena de valores), así que con una caché por
// clave el objeto es siempre el mismo.

import type { PathOptions } from "leaflet";

const cache = new Map<string, PathOptions>();

function guardar(clave: string, crear: () => PathOptions): PathOptions {
  const guardado = cache.get(clave);
  if (guardado) return guardado;
  const opciones = crear();
  cache.set(clave, opciones);
  return opciones;
}

// --- Focos -----------------------------------------------------------------

/** Perímetro previsto a +1/+3/+6 h (cada horizonte, más tenue que el anterior). */
export function trazoPrediccion(color: string, horizonte: 1 | 3 | 6): PathOptions {
  const por = { 1: { weight: 1.5, opacity: 0.75, dashArray: "6 5", fillOpacity: 0.12 }, 3: { weight: 1.2, opacity: 0.55, dashArray: "4 6", fillOpacity: 0.08 }, 6: { weight: 1, opacity: 0.4, dashArray: "3 7", fillOpacity: 0.05 } }[horizonte];
  return guardar(`pred${horizonte}|${color}`, () => ({ color, ...por, fillColor: color, interactive: false }));
}

export function trazoPerimetro(color: string, resaltado: boolean, porConfirmar: boolean, oscuro: boolean): PathOptions {
  return guardar(`peri|${color}|${resaltado}|${porConfirmar}|${oscuro}`, () => ({
    color,
    weight: resaltado ? 3.5 : 2.4,
    opacity: 0.95,
    dashArray: porConfirmar ? "7 6" : undefined,
    fillColor: color,
    fillOpacity: porConfirmar ? 0.06 : oscuro ? 0.3 : 0.24,
  }));
}

export function trazoLineaControl(color: string): PathOptions {
  return guardar(`ctrl|${color}`, () => ({ color, weight: 4, opacity: 0.9, dashArray: "9 5", interactive: false }));
}

// --- Unidades --------------------------------------------------------------

export function trazoRutaRestante(color: string): PathOptions {
  return guardar(`rutaR|${color}`, () => ({ color, weight: 2.5, opacity: 0.5, dashArray: "6 7", interactive: false }));
}

export function trazoRutaRecorrida(color: string): PathOptions {
  return guardar(`rutaH|${color}`, () => ({ color, weight: 5, opacity: 0.85, lineCap: "round", interactive: false }));
}

export function trazoPuntaRuta(color: string): PathOptions {
  return guardar(`punta|${color}`, () => ({ color, weight: 3, opacity: 0.95, interactive: false }));
}

// --- Pueblos ---------------------------------------------------------------

export function trazoPuebloBajo(color: string): PathOptions {
  return guardar(`pbajo|${color}`, () => ({ color, weight: 1, opacity: 0.7, fillColor: color, fillOpacity: 0.45 }));
}

export function trazoPueblo(color: string, avisado: boolean): PathOptions {
  return guardar(`pueblo|${color}|${avisado}`, () => ({
    color,
    weight: 2,
    opacity: 0.9,
    fillColor: color,
    fillOpacity: avisado ? 0.1 : 0.22,
    dashArray: avisado ? "5 5" : undefined,
  }));
}

// --- Viento, satélite y focos fusionados ------------------------------------

export function trazoViento(color: string, grosor: number): PathOptions {
  const g = Math.round(grosor * 10) / 10;
  return guardar(`viento|${color}|${g}`, () => ({ color, weight: g, opacity: 0.6, interactive: false }));
}

export function trazoPuntoZona(color: string): PathOptions {
  return guardar(`zona|${color}`, () => ({ color, fillColor: color, fillOpacity: 0.85, weight: 1 }));
}

export function trazoPuntoFusionado(color: string): PathOptions {
  return guardar(`fus|${color}`, () => ({ color, fillColor: color, fillOpacity: 0.5, weight: 1 }));
}

export function trazoPuntoSatelite(color: string): PathOptions {
  return guardar(`sat|${color}`, () => ({ color, fillColor: color, fillOpacity: 0.75, weight: 1 }));
}
