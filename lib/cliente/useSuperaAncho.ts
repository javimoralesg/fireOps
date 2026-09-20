"use client";
// ¿El elemento observado tiene al menos `umbral` px de ancho de contenido?
// Lo usa el panel derecho para pasar a la maquetación por columnas cuando se
// ensancha con el separador (components/sala/SeparadorPaneles.tsx) sin
// re-renderizar en cada píxel: el estado solo cambia al cruzar el umbral.
//
// Mide el ancho de CONTENIDO (sin padding), el mismo que usan las variantes
// `@container` de Tailwind, para que el booleano y las rejillas CSS cambien en
// el mismo punto. Devuelve un callback ref para que siga funcionando aunque el
// elemento se monte y desmonte (panel plegado ↔ abierto).

import { useEffect, useState } from "react";

export function useSuperaAncho(umbral: number): [supera: boolean, ref: (nodo: HTMLElement | null) => void] {
  const [nodo, setNodo] = useState<HTMLElement | null>(null);
  const [supera, setSupera] = useState(false);

  useEffect(() => {
    if (!nodo || typeof ResizeObserver === "undefined") return;
    // ResizeObserver entrega una primera medida al observar: no hace falta medir a mano.
    const obs = new ResizeObserver((entradas) => {
      const ancho = entradas[0]?.contentRect.width ?? 0;
      setSupera(ancho >= umbral);
    });
    obs.observe(nodo);
    return () => obs.disconnect();
  }, [nodo, umbral]);

  return [supera, setNodo];
}
