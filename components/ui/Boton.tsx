"use client";
// Botón de la sala de mando. DUEÑO: constructor E. Dependencias: lucide-react.
// Icono SIEMPRE con texto (el icono nunca es la única señal). Alturas ≥ 44 px
// salvo la variante "sm", pensada para barras densas con ratón.

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

export type VarianteBoton = "primario" | "secundario" | "peligro" | "fantasma";
export type TamanoBoton = "sm" | "md" | "lg";

export interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
  /** Icono a la izquierda del texto (elemento lucide ya dimensionado o no). */
  icono?: ReactNode;
  /** Muestra una rueda y desactiva el botón. */
  cargando?: boolean;
  /** Ocupa todo el ancho disponible. */
  ancho?: boolean;
}

const VARIANTES: Record<VarianteBoton, string> = {
  primario:
    "bg-brand text-accent-contraste border border-brand hover:bg-brand-2 hover:border-brand-2 disabled:bg-brand/50 disabled:border-brand/50",
  secundario:
    "bg-panel text-foreground border border-panel-border-strong hover:bg-panel-2 disabled:text-muted",
  peligro:
    "bg-danger text-white border border-danger hover:brightness-110 disabled:opacity-55 dark:text-[#2a0d10]",
  fantasma:
    "bg-transparent text-foreground border border-transparent hover:bg-panel-2 disabled:text-muted",
};

const TAMANOS: Record<TamanoBoton, string> = {
  sm: "min-h-9 px-2.5 text-[13px] gap-1.5 rounded-lg",
  md: "min-h-11 px-3.5 text-sm gap-2 rounded-xl",
  lg: "min-h-12 px-5 text-base font-semibold gap-2 rounded-xl",
};

export const Boton = forwardRef<HTMLButtonElement, BotonProps>(function Boton(
  { variante = "secundario", tamano = "md", icono, cargando = false, ancho = false, className = "", children, disabled, type = "button", ...resto },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      className={[
        "inline-flex select-none items-center justify-center font-medium transition-colors",
        "disabled:cursor-not-allowed",
        VARIANTES[variante],
        TAMANOS[tamano],
        ancho ? "w-full" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...resto}
    >
      {cargando ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> : icono ? <span className="shrink-0 [&>svg]:size-4" aria-hidden>{icono}</span> : null}
      <span className="truncate">{children}</span>
    </button>
  );
});
