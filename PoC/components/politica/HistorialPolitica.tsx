"use client";

import { useState } from "react";
import { ScrollText } from "lucide-react";
import { Ayuda } from "@/components/ui/Tooltip";
import type { PoliticaAutonomia } from "@/lib/politica-autonomia";
import { formatearMomento, nombreRol } from "./ui";

const VISIBLES = 5;

/** Quién cambió qué y cuándo. Cada cambio queda también en la timeline de la consola. */
export function HistorialPolitica({ politica }: { politica: PoliticaAutonomia }) {
  const [todo, setTodo] = useState(false);
  const lista = todo ? politica.historial : politica.historial.slice(0, VISIBLES);
  return (
    <section className="superficie flex min-h-0 flex-col rounded-2xl border border-panel-border bg-panel">
      <div className="flex items-center justify-between gap-2 border-b border-panel-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <ScrollText className="size-4 text-brand" aria-hidden /> Cambios de la política
          <Ayuda texto="Registro de quién cambió la política y cuándo. Cada cambio se anota también en la timeline del incidente para la auditoría." />
        </h2>
        <span className="text-[11px] text-muted">{politica.historial.length}</span>
      </div>
      {politica.historial.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-muted">Sin cambios: rige el catálogo por defecto.</p>
      ) : (
        <>
          <ol className="divide-y divide-panel-border">
            {lista.map((h, i) => (
              <li key={`${h.timestamp}-${i}`} className="px-4 py-2.5">
                <p className="text-[12.5px] text-foreground">{h.texto}</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  <span className="font-mono">{formatearMomento(h.timestamp)}</span> · {nombreRol(h.rol)}
                </p>
              </li>
            ))}
          </ol>
          {politica.historial.length > VISIBLES && (
            <button type="button" className="boton boton-fantasma boton-sm m-2 self-start" onClick={() => setTodo((t) => !t)}>
              {todo ? "Ver menos" : `Ver los ${politica.historial.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
