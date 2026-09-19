"use client";
// Detalles colapsables (<details>) con cabecera clara. DUEÑO: constructor E.
// Para "por qué", evidencias y fundamentos: nunca delante, siempre a un clic.

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export interface DesplegableProps {
  titulo: ReactNode;
  /** Número entre paréntesis tras el título (3 evidencias…). */
  cuenta?: number;
  abiertoPorDefecto?: boolean;
  className?: string;
  children: ReactNode;
}

export function Desplegable({ titulo, cuenta, abiertoPorDefecto = false, className = "", children }: DesplegableProps) {
  return (
    <details open={abiertoPorDefecto} className={`group rounded-lg border border-panel-border bg-panel-2/60 ${className}`}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-2.5 py-2 text-[13px] font-medium text-foreground marker:content-['']">
        <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-open:rotate-90" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{titulo}</span>
        {typeof cuenta === "number" ? <span className="tabular shrink-0 text-xs text-subtle">{cuenta}</span> : null}
      </summary>
      <div className="border-t border-panel-border px-2.5 py-2 text-[13px] leading-relaxed text-muted">{children}</div>
    </details>
  );
}
