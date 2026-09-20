"use client";
// Conmutador de tema (sistema / claro / oscuro). DUEÑO: constructor E.
// Tres botones con icono Y texto accesible; el activo se marca con aria-pressed.

import { Monitor, Moon, Sun } from "lucide-react";
import { useTema, type Tema } from "@/lib/cliente/useTema";

const OPCIONES: { valor: Tema; etiqueta: string; icono: typeof Sun }[] = [
  { valor: "sistema", etiqueta: "Tema del sistema", icono: Monitor },
  { valor: "claro", etiqueta: "Tema claro", icono: Sun },
  { valor: "oscuro", etiqueta: "Tema oscuro", icono: Moon },
];

export function SelectorTema({ compacto = false }: { compacto?: boolean }) {
  const { tema, cambiarTema } = useTema();
  return (
    <div role="group" aria-label="Tema de la pantalla" className="inline-flex items-center gap-0.5 rounded-xl border border-panel-border bg-panel p-0.5">
      {OPCIONES.map(({ valor, etiqueta, icono: Icono }) => {
        const activo = tema === valor;
        return (
          <button
            key={valor}
            type="button"
            aria-pressed={activo}
            title={etiqueta}
            onClick={() => cambiarTema(valor)}
            className={[
              "inline-flex items-center justify-center rounded-lg transition-colors",
              compacto ? "size-8" : "size-9",
              activo ? "bg-brand/15 text-brand" : "text-muted hover:bg-panel-2 hover:text-foreground",
            ].join(" ")}
          >
            <Icono className="size-4" aria-hidden />
            <span className="solo-lectores">{etiqueta}</span>
          </button>
        );
      })}
    </div>
  );
}
