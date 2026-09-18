"use client";

// Cajón lateral para lo que no hace falta ver siempre: historial de decisiones,
// doctrina, informes, voluntarios (y el simulador de eventos cuando exista).

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";

interface Props {
  abierto: boolean;
  titulo: string;
  descripcion?: string;
  onCerrar: () => void;
  children: ReactNode;
}

export function PanelSecundario({ abierto, titulo, descripcion, onCerrar, children }: Props) {
  useEffect(() => {
    if (!abierto) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <>
      {/* Velo: atenúa la consola sin ocultarla y cierra al pulsar fuera */}
      <button type="button" aria-label="Cerrar panel" onClick={onCerrar} className="fixed inset-0 z-[1200] cursor-pointer bg-foreground/40 backdrop-blur-sm" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="fixed inset-y-0 right-0 z-[1210] flex w-full max-w-[520px] flex-col rounded-l-2xl border-l border-panel-border bg-panel shadow-[var(--sombra-flotante)]"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-panel-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-foreground">{titulo}</h2>
            {descripcion && <p className="mt-0.5 text-[11px] leading-snug text-muted">{descripcion}</p>}
          </div>
          <Tooltip titulo="Cerrar (Esc)" contenido="Vuelve a la consola. También se cierra con la tecla Escape o pulsando fuera." lado="izquierda">
            <button type="button" onClick={onCerrar} className="boton boton-fantasma -mr-1 size-8 shrink-0 p-0" aria-label="Cerrar panel">
              <X className="size-4" aria-hidden />
            </button>
          </Tooltip>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </aside>
    </>
  );
}
