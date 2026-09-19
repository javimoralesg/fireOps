"use client";
// Pestañas accesibles (role=tablist con flechas del teclado). DUEÑO: constructor E.
// Controlado desde fuera: el padre decide la pestaña activa.

import { useRef, type ReactNode } from "react";

export interface Pestana {
  id: string;
  etiqueta: string;
  /** Número a la derecha del nombre (decisiones pendientes, focos…). */
  cuenta?: number;
  icono?: ReactNode;
  /** Pinta el contador en rojo (algo requiere atención). */
  urgente?: boolean;
}

export interface PestanasProps {
  pestanas: Pestana[];
  activa: string;
  onCambiar: (id: string) => void;
  /** Para enlazar aria-controls con el panel. */
  idBase?: string;
  className?: string;
}

export function Pestanas({ pestanas, activa, onCambiar, idBase = "pestanas", className = "" }: PestanasProps) {
  const contenedor = useRef<HTMLDivElement>(null);

  function alTeclado(e: React.KeyboardEvent) {
    const i = pestanas.findIndex((p) => p.id === activa);
    if (i < 0) return;
    let siguiente = -1;
    if (e.key === "ArrowRight") siguiente = (i + 1) % pestanas.length;
    else if (e.key === "ArrowLeft") siguiente = (i - 1 + pestanas.length) % pestanas.length;
    else if (e.key === "Home") siguiente = 0;
    else if (e.key === "End") siguiente = pestanas.length - 1;
    if (siguiente < 0) return;
    e.preventDefault();
    onCambiar(pestanas[siguiente].id);
    contenedor.current?.querySelector<HTMLElement>(`#${idBase}-tab-${pestanas[siguiente].id}`)?.focus();
  }

  return (
    <div
      ref={contenedor}
      role="tablist"
      aria-label="Secciones del panel"
      onKeyDown={alTeclado}
      className={`flex gap-1 overflow-x-auto scroll-fino ${className}`}
    >
      {pestanas.map((p) => {
        const esActiva = p.id === activa;
        return (
          <button
            key={p.id}
            id={`${idBase}-tab-${p.id}`}
            role="tab"
            type="button"
            aria-selected={esActiva}
            aria-controls={`${idBase}-panel-${p.id}`}
            tabIndex={esActiva ? 0 : -1}
            onClick={() => onCambiar(p.id)}
            className={[
              "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors",
              esActiva
                ? "border-brand bg-brand/12 text-brand"
                : "border-transparent text-muted hover:bg-panel-2 hover:text-foreground",
            ].join(" ")}
          >
            {p.icono ? <span className="[&>svg]:size-4" aria-hidden>{p.icono}</span> : null}
            <span className="whitespace-nowrap">{p.etiqueta}</span>
            {typeof p.cuenta === "number" ? (
              <span
                className={[
                  "tabular rounded-full px-1.5 py-px text-[11px] font-semibold",
                  p.urgente && p.cuenta > 0 ? "bg-danger text-white dark:text-[#2a0d10]" : "bg-panel-2 text-muted",
                ].join(" ")}
              >
                {p.cuenta}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Contenedor del contenido de una pestaña (enlaza aria con `Pestanas`). */
export function PanelPestana({ id, activa, idBase = "pestanas", className = "", children }: { id: string; activa: string; idBase?: string; className?: string; children: ReactNode }) {
  if (id !== activa) return null;
  return (
    <div id={`${idBase}-panel-${id}`} role="tabpanel" aria-labelledby={`${idBase}-tab-${id}`} tabIndex={0} className={className}>
      {children}
    </div>
  );
}
