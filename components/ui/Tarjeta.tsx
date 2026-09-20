"use client";
// Tarjeta: caja de contenido con cabecera opcional. DUEÑO: constructor E.

import type { ReactNode } from "react";

export interface TarjetaProps {
  titulo?: ReactNode;
  /** Línea secundaria bajo el título. */
  subtitulo?: ReactNode;
  /** Icono decorativo a la izquierda del título. */
  icono?: ReactNode;
  /** Contenido alineado a la derecha de la cabecera (insignias, botones). */
  accion?: ReactNode;
  /** Barra de color a la izquierda para señalar urgencia (además del texto). */
  tono?: "neutro" | "peligro" | "aviso" | "exito" | "info";
  className?: string;
  children?: ReactNode;
}

const TONOS: Record<NonNullable<TarjetaProps["tono"]>, string> = {
  neutro: "",
  peligro: "border-l-4 border-l-danger",
  aviso: "border-l-4 border-l-warning",
  exito: "border-l-4 border-l-success",
  info: "border-l-4 border-l-info",
};

export function Tarjeta({ titulo, subtitulo, icono, accion, tono = "neutro", className = "", children }: TarjetaProps) {
  return (
    <section
      className={[
        "rounded-[var(--radius-panel)] border border-panel-border bg-panel shadow-[var(--sombra-panel)]",
        TONOS[tono],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {(titulo || accion) && (
        <header className="flex items-start gap-2 px-3.5 pt-3">
          {icono ? <span className="mt-0.5 shrink-0 text-muted [&>svg]:size-4" aria-hidden>{icono}</span> : null}
          <div className="min-w-0 flex-1">
            {titulo ? <h3 className="text-sm font-semibold leading-tight text-foreground">{titulo}</h3> : null}
            {subtitulo ? <p className="mt-0.5 text-xs leading-snug text-muted">{subtitulo}</p> : null}
          </div>
          {accion ? <div className="flex shrink-0 items-center gap-1.5">{accion}</div> : null}
        </header>
      )}
      <div className={titulo || accion ? "px-3.5 pb-3.5 pt-2.5" : "p-3.5"}>{children}</div>
    </section>
  );
}
