"use client";
// Conmutador del modo desarrollo (icono «</>»): muestra u oculta en la barra
// superior los controles de ejercicio. Mismo patrón que SelectorTema: botón de
// icono con texto para lectores de pantalla y `aria-pressed`. DUEÑO: sesión actual.

import { CodeXml } from "lucide-react";

export function ConmutadorDesarrollo({ activo, onAlternar, compacto = false }: { activo: boolean; onAlternar: () => void; compacto?: boolean }) {
  const etiqueta = activo ? "Ocultar los controles de desarrollo" : "Mostrar los controles de desarrollo";
  return (
    <button
      type="button"
      aria-pressed={activo}
      title={`${etiqueta} (botones del reloj, ejecución y fuentes, PARAR TODO, Declarar foco, Viento global)`}
      onClick={onAlternar}
      className={[
        "inline-flex items-center justify-center rounded-xl border transition-colors",
        compacto ? "size-8" : "size-9",
        activo ? "border-brand/45 bg-brand/15 text-brand" : "border-panel-border bg-panel text-muted hover:bg-panel-2 hover:text-foreground",
      ].join(" ")}
    >
      <CodeXml className="size-4" aria-hidden />
      <span className="solo-lectores">{etiqueta}</span>
    </button>
  );
}
