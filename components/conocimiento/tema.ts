"use client";
// =====================================================================
// ATALAYA INCENDIOS · Colores del grafo (claro/oscuro)
// ---------------------------------------------------------------------
// DUEÑO: constructor I.
// El canvas no resuelve `var(--token)`, así que los tokens de globals.css se
// leen con getComputedStyle y se vuelven a leer cuando cambia el tema (el
// selector de E escribe `data-theme` en <html>) o la preferencia del sistema.
// Las familias de color de los nodos son las de siempre —documento azul,
// fragmento verde, entidad naranja— con la versión clara para fondo oscuro.
// =====================================================================

import { useEffect, useState } from "react";
import type { TipoArista, TipoNodo } from "./simulacion";

export interface ColoresGrafo {
  oscuro: boolean;
  fondo: string;
  texto: string;
  textoTenue: string;
  borde: string;
  acento: string;
  destacado: string;
  nodo: Record<TipoNodo, { relleno: string; borde: string }>;
  arista: Record<TipoArista, string>;
}

export const ETIQUETA_NODO: Record<TipoNodo, string> = {
  documento: "Documento",
  chunk: "Fragmento",
  entidad: "Entidad",
};

export const ETIQUETA_ARISTA: Record<TipoArista, string> = {
  contiene: "contiene",
  sigue: "sigue a",
  referencia: "referencia cruzada",
  menciona: "menciona",
};

const CLARO: Omit<ColoresGrafo, "fondo" | "texto" | "textoTenue" | "borde" | "acento" | "oscuro"> = {
  destacado: "#d94a2b",
  nodo: {
    documento: { relleno: "#1d4ed8", borde: "#1e3a8a" },
    chunk: { relleno: "#0d9488", borde: "#115e59" },
    entidad: { relleno: "#c2600a", borde: "#7c3d05" },
  },
  arista: { contiene: "#8fa3b5", sigue: "#0d9488", referencia: "#d6336c", menciona: "#b58105" },
};

const OSCURO: typeof CLARO = {
  destacado: "#f2704f",
  nodo: {
    documento: { relleno: "#5b9bff", borde: "#c8ddff" },
    chunk: { relleno: "#2dd4bf", borde: "#a7f3ea" },
    entidad: { relleno: "#f2a14f", borde: "#ffdcae" },
  },
  arista: { contiene: "#5d6b7a", sigue: "#2dd4bf", referencia: "#f472b6", menciona: "#e8cf63" },
};

const POR_DEFECTO: ColoresGrafo = {
  oscuro: false,
  fondo: "#ffffff",
  texto: "#16222e",
  textoTenue: "#5a6b7c",
  borde: "#e3e9ee",
  acento: "#14707f",
  ...CLARO,
};

function luminancia(hex: string): number {
  const c = hex.trim().replace("#", "");
  if (c.length < 3) return 1;
  const n = c.length === 3 ? c.split("").map((h) => h + h) : [c.slice(0, 2), c.slice(2, 4), c.slice(4, 6)];
  const [r, g, b] = n.map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function leerTokens(): ColoresGrafo {
  if (typeof window === "undefined") return POR_DEFECTO;
  const estilo = getComputedStyle(document.documentElement);
  const token = (nombre: string, respaldo: string) => estilo.getPropertyValue(nombre).trim() || respaldo;
  const panel = token("--panel", "#ffffff");
  const oscuro = luminancia(panel) < 0.45;
  const paleta = oscuro ? OSCURO : CLARO;
  return {
    oscuro,
    fondo: panel,
    texto: token("--foreground", oscuro ? "#e7ecf1" : "#16222e"),
    textoTenue: token("--muted", oscuro ? "#9aa8b6" : "#5a6b7c"),
    borde: token("--panel-border", oscuro ? "#263039" : "#e3e9ee"),
    acento: token("--accent", oscuro ? "#5fc6d4" : "#14707f"),
    ...paleta,
  };
}

/** Colores vivos: se refrescan al cambiar de tema sin recargar la página. */
export function useColoresGrafo(): ColoresGrafo {
  const [colores, setColores] = useState<ColoresGrafo>(POR_DEFECTO);

  useEffect(() => {
    let vivo = true;
    const refrescar = () => {
      if (!vivo) return;
      setColores(leerTokens());
    };
    // Fuera del cuerpo del efecto: React 19 no quiere setState síncrono aquí.
    const t = setTimeout(refrescar, 0);
    const observador = new MutationObserver(refrescar);
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    const consulta = window.matchMedia("(prefers-color-scheme: dark)");
    consulta.addEventListener("change", refrescar);
    return () => {
      vivo = false;
      clearTimeout(t);
      observador.disconnect();
      consulta.removeEventListener("change", refrescar);
    };
  }, []);

  return colores;
}

/** ¿El usuario pidió menos movimiento? Entonces el grafo no se anima. */
export function useMovimientoReducido(): boolean {
  const [reducido, setReducido] = useState(false);
  useEffect(() => {
    const consulta = window.matchMedia("(prefers-reduced-motion: reduce)");
    const aplicar = () => setReducido(consulta.matches);
    const t = setTimeout(aplicar, 0);
    consulta.addEventListener("change", aplicar);
    return () => {
      clearTimeout(t);
      consulta.removeEventListener("change", aplicar);
    };
  }, []);
  return reducido;
}
