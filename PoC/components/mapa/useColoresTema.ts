"use client";

import { useMemo } from "react";
import { useTema } from "@/components/marca/SelectorTema";

// Leaflet pinta en SVG con atributos (stroke/fill) que no resuelven var(--token),
// así que leemos los valores reales de los tokens y los recalculamos al cambiar de tema.
// Clave = nombre del token en camelCase ("--nodo-hospital" → nodoHospital).
//
// El recálculo lo dispara useTema (components/marca/SelectorTema.tsx), que escucha el
// evento "atalaya:tema" y el "storage" de otras pestañas: al cambiar data-theme, este
// hook vuelve a leer los tokens y el mapa se repinta con los colores del tema nuevo.
// Todo lo demás (popups, controles, insignias) es CSS con tokens y cambia solo.

const TOKENS = {
  danger: "danger",
  warning: "warning",
  success: "success",
  info: "info",
  accent: "accent",
  brand: "brand",
  muted: "muted",
  subtle: "subtle",
  foreground: "foreground",
  panel: "panel",
  panel2: "panel-2",
  panelBorder: "panel-border",
  background: "background",
  nodoHospital: "nodo-hospital",
  nodoComunicaciones: "nodo-comunicaciones",
  nodoRuta: "nodo-ruta",
  nodoVia: "nodo-via",
  nodoBomberos: "nodo-bomberos",
  nodoPolicia: "nodo-policia",
  nodoSanitarios: "nodo-sanitarios",
  humo: "humo",
  humoNucleo: "humo-nucleo",
} as const;

export type TokenColor = keyof typeof TOKENS;
export type ColoresTema = Record<TokenColor, string>;

export function useColoresTema(): { colores: ColoresTema; oscuro: boolean } {
  const [tema] = useTema();
  const colores = useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      Object.entries(TOKENS).map(([clave, token]) => [clave, css.getPropertyValue(`--${token}`).trim() || "#888888"]),
    ) as ColoresTema;
    // `tema` fuerza la relectura cuando cambia data-theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tema]);
  return { colores, oscuro: tema === "dark" };
}
