"use client";
// Estado vacío con icono, una frase que guía y una acción opcional.
// DUEÑO: constructor E. Nunca una caja en blanco: siempre qué hacer ahora.

import type { ReactNode } from "react";

export interface VacioProps {
  icono?: ReactNode;
  titulo: string;
  /** Qué tiene que hacer el usuario o qué falta para que aparezca algo. */
  guia?: ReactNode;
  accion?: ReactNode;
  className?: string;
}

export function Vacio({ icono, titulo, guia, accion, className = "" }: VacioProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-panel-border-strong px-4 py-7 text-center ${className}`}>
      {icono ? <span className="text-subtle [&>svg]:size-7" aria-hidden>{icono}</span> : null}
      <p className="text-sm font-medium text-foreground">{titulo}</p>
      {guia ? <p className="max-w-sm text-[13px] leading-snug text-muted">{guia}</p> : null}
      {accion ? <div className="mt-1">{accion}</div> : null}
    </div>
  );
}
