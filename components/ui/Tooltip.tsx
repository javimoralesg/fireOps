"use client";
// Tooltip que se abre con el ratón y con el tabulador, y se cierra con Escape.
// DUEÑO: constructor E. El hijo debe poder recibir foco (botón, enlace…).

import { useId, useRef, useState, type ReactNode } from "react";

export interface TooltipProps {
  /** Primera línea, en negrita. */
  titulo?: ReactNode;
  /** Cuerpo del tooltip. */
  contenido: ReactNode;
  lado?: "arriba" | "abajo" | "izquierda" | "derecha";
  className?: string;
  children: ReactNode;
}

const LADOS = {
  arriba: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  abajo: "top-full left-1/2 -translate-x-1/2 mt-2",
  izquierda: "right-full top-1/2 -translate-y-1/2 mr-2",
  derecha: "left-full top-1/2 -translate-y-1/2 ml-2",
} as const;

export function Tooltip({ titulo, contenido, lado = "abajo", className = "", children }: TooltipProps) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  function abrir() {
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setAbierto(true), 120);
  }
  function cerrar() {
    if (temporizador.current) clearTimeout(temporizador.current);
    setAbierto(false);
  }

  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={abrir}
      onMouseLeave={cerrar}
      onFocusCapture={() => setAbierto(true)}
      onBlurCapture={cerrar}
      onKeyDown={(e) => {
        if (e.key === "Escape") cerrar();
      }}
    >
      <span aria-describedby={abierto ? id : undefined} className="contents">
        {children}
      </span>
      {abierto ? (
        <span
          role="tooltip"
          id={id}
          className={`pointer-events-none absolute z-[1400] w-max max-w-[18rem] rounded-lg border border-panel-border bg-panel px-2.5 py-1.5 text-left text-[12px] leading-snug text-muted shadow-[var(--sombra-flotante)] ${LADOS[lado]}`}
        >
          {titulo ? <span className="block font-semibold text-foreground">{titulo}</span> : null}
          <span className="block">{contenido}</span>
        </span>
      ) : null}
    </span>
  );
}
