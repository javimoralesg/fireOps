"use client";
// Diálogo modal accesible: foco atrapado, Escape cierra, aria-modal, se devuelve
// el foco al elemento que lo abrió. DUEÑO: constructor E.

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export interface DialogoProps {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  descripcion?: string;
  /** Botones del pie, alineados a la derecha. */
  pie?: ReactNode;
  /** "sm" para confirmaciones, "md" por defecto, "lg" para fichas largas. */
  ancho?: "sm" | "md" | "lg";
  children?: ReactNode;
}

const ANCHOS = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" } as const;

const FOCABLES =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export function Dialogo({ abierto, onCerrar, titulo, descripcion, pie, ancho = "md", children }: DialogoProps) {
  const caja = useRef<HTMLDivElement>(null);
  const anterior = useRef<HTMLElement | null>(null);
  const idTitulo = useId();
  const idDesc = useId();

  const alPulsarTecla = useCallback(
    (e: KeyboardEvent) => {
      if (!abierto) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onCerrar();
        return;
      }
      if (e.key !== "Tab" || !caja.current) return;
      const focables = Array.from(caja.current.querySelectorAll<HTMLElement>(FOCABLES)).filter((n) => n.offsetParent !== null);
      if (focables.length === 0) return;
      const primero = focables[0];
      const ultimo = focables[focables.length - 1];
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    },
    [abierto, onCerrar],
  );

  useEffect(() => {
    if (!abierto) return;
    anterior.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const focables = caja.current?.querySelectorAll<HTMLElement>(FOCABLES);
      (focables && focables.length > 1 ? focables[1] : focables?.[0])?.focus();
    }, 30);
    document.addEventListener("keydown", alPulsarTecla, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", alPulsarTecla, true);
      document.body.style.overflow = overflow;
      anterior.current?.focus?.();
    };
  }, [abierto, alPulsarTecla]);

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-[1500] flex items-end justify-center overflow-y-auto bg-black/45 p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0"
        onClick={onCerrar}
        aria-hidden
      />
      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={descripcion ? idDesc : undefined}
        className={`relative z-10 my-0 w-full ${ANCHOS[ancho]} rounded-t-2xl border border-panel-border bg-panel shadow-[var(--sombra-flotante)] sm:my-4 sm:rounded-2xl`}
      >
        <header className="flex items-start gap-3 border-b border-panel-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={idTitulo} className="text-base font-semibold leading-tight text-foreground">
              {titulo}
            </h2>
            {descripcion ? (
              <p id={idDesc} className="mt-1 text-sm leading-snug text-muted">
                {descripcion}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="-m-1.5 shrink-0 rounded-lg p-1.5 text-muted hover:bg-panel-2 hover:text-foreground"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>
        <div className="max-h-[65vh] overflow-y-auto px-4 py-4 scroll-fino">{children}</div>
        {pie ? <footer className="flex flex-wrap justify-end gap-2 border-t border-panel-border px-4 py-3">{pie}</footer> : null}
      </div>
    </div>
  );
}
