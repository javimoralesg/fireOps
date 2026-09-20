"use client";
// Interruptor (switch) con etiqueta de texto y estado escrito. DUEÑO: constructor E.

import type { ReactNode } from "react";

export interface InterruptorProps {
  activo: boolean;
  onCambiar: (valor: boolean) => void;
  etiqueta: ReactNode;
  /** Línea secundaria (cuántos elementos, de dónde salen los datos…). */
  nota?: ReactNode;
  desactivado?: boolean;
  /** Punto de color a la izquierda de la etiqueta (leyenda de la capa). */
  color?: string;
  className?: string;
}

export function Interruptor({ activo, onCambiar, etiqueta, nota, desactivado = false, color, className = "" }: InterruptorProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      disabled={desactivado}
      onClick={() => onCambiar(!activo)}
      className={[
        "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
        desactivado ? "cursor-not-allowed opacity-55" : "hover:bg-panel-2",
        className,
      ].join(" ")}
    >
      <span
        aria-hidden
        className={[
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
          activo ? "border-brand bg-brand" : "border-panel-border-strong bg-panel-2",
        ].join(" ")}
      >
        <span className={`absolute size-3.5 rounded-full bg-panel shadow transition-all ${activo ? "left-[1.15rem]" : "left-0.5"}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          {color ? <span className="size-2.5 shrink-0 rounded-sm" style={{ background: color }} aria-hidden /> : null}
          <span className="truncate">{etiqueta}</span>
        </span>
        {nota ? <span className="mt-0.5 block truncate text-[11px] text-subtle">{nota}</span> : null}
      </span>
      <span className="solo-lectores">{activo ? "activada" : "desactivada"}</span>
    </button>
  );
}
