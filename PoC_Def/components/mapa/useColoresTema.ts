"use client";
// Lee los tokens de color del CSS y los devuelve como hex para que Leaflet los
// pueda usar en atributos SVG (stroke/fill no resuelven var()).
// DUEÑO: constructor E. Se recalcula al cambiar de tema.

import { useEffect, useState } from "react";

export interface ColoresTema {
  fondo: string;
  panel: string;
  panel2: string;
  borde: string;
  texto: string;
  muted: string;
  brand: string;
  danger: string;
  warning: string;
  success: string;
  info: string;
  fuego: string;
  fuego2: string;
  humo: string;
  naranja: string;
  amarillo: string;
  riesgoBajo: string;
  riesgoMedio: string;
  riesgoAlto: string;
  riesgoInminente: string;
  oscuro: boolean;
}

const POR_DEFECTO: ColoresTema = {
  fondo: "#f2f5f7",
  panel: "#ffffff",
  panel2: "#f5f8fa",
  borde: "#e3e9ee",
  texto: "#16222e",
  muted: "#5a6b7c",
  brand: "#14707f",
  danger: "#c4404a",
  warning: "#a95c0c",
  success: "#1e7d4e",
  info: "#2a6db3",
  fuego: "#d94a2b",
  fuego2: "#e8863a",
  humo: "#6b7480",
  naranja: "#cf6412",
  amarillo: "#9a7a06",
  riesgoBajo: "#1e7d4e",
  riesgoMedio: "#a95c0c",
  riesgoAlto: "#cf5a1c",
  riesgoInminente: "#c4404a",
  oscuro: false,
};

const TOKENS: [keyof ColoresTema, string][] = [
  ["fondo", "--background"],
  ["panel", "--panel"],
  ["panel2", "--panel-2"],
  ["borde", "--panel-border"],
  ["texto", "--foreground"],
  ["muted", "--muted"],
  ["brand", "--brand"],
  ["danger", "--danger"],
  ["warning", "--warning"],
  ["success", "--success"],
  ["info", "--info"],
  ["fuego", "--fuego"],
  ["fuego2", "--fuego-2"],
  ["humo", "--humo"],
  ["naranja", "--naranja"],
  ["amarillo", "--amarillo"],
  ["riesgoBajo", "--riesgo-bajo"],
  ["riesgoMedio", "--riesgo-medio"],
  ["riesgoAlto", "--riesgo-alto"],
  ["riesgoInminente", "--riesgo-inminente"],
];

function leer(): ColoresTema {
  if (typeof window === "undefined") return POR_DEFECTO;
  const estilo = getComputedStyle(document.documentElement);
  const salida = { ...POR_DEFECTO };
  for (const [clave, token] of TOKENS) {
    const v = estilo.getPropertyValue(token).trim();
    if (v) (salida as unknown as Record<string, string>)[clave] = v;
  }
  const atributo = document.documentElement.getAttribute("data-theme");
  salida.oscuro =
    atributo === "dark" || (atributo !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true);
  return salida;
}

export function useColoresTema(): ColoresTema {
  const [colores, setColores] = useState<ColoresTema>(POR_DEFECTO);
  useEffect(() => {
    const refrescar = () => setColores(leer());
    refrescar();
    const observador = new MutationObserver(refrescar);
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener?.("change", refrescar);
    return () => {
      observador.disconnect();
      mq?.removeEventListener?.("change", refrescar);
    };
  }, []);
  return colores;
}
