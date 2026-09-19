"use client";
// Panel compacto de capas del mapa + leyenda plegable. DUEÑO: constructor E.

import { useState } from "react";
import { ChevronDown, Layers, Maximize2 } from "lucide-react";
import { Interruptor } from "@/components/ui/Interruptor";

export type ClaveCapa =
  | "focos"
  | "prediccion"
  | "unidades"
  | "bases"
  | "pueblos"
  | "hospitales"
  | "camaras"
  | "camarasEspana"
  | "viento"
  | "satelite"
  | "avisos";

export interface FilaCapa {
  id: ClaveCapa;
  etiqueta: string;
  cuenta: number;
  color?: string;
  /** Qué se ve cuando está activada, o de dónde saldrán los datos si aún no hay. */
  ayuda: string;
}

export function PanelCapas({
  filas,
  activas,
  onAlternar,
  onEncuadrar,
}: {
  filas: FilaCapa[];
  activas: Record<ClaveCapa, boolean>;
  onAlternar: (id: ClaveCapa) => void;
  onEncuadrar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const numActivas = filas.filter((f) => activas[f.id]).length;

  return (
    <div className="pointer-events-none absolute left-2 top-2 z-[900] flex max-h-[calc(100%-5rem)] w-[15.5rem] max-w-[calc(100vw-1rem)] flex-col items-start gap-1.5">
      <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          aria-controls="panel-capas"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-panel-border-strong bg-panel/95 px-2.5 text-[13px] font-medium text-foreground shadow-sm backdrop-blur hover:bg-panel-2"
        >
          <Layers className="size-3.5 text-brand" aria-hidden /> Capas
          <span className="tabular text-[11px] font-normal text-muted">
            {numActivas}/{filas.length}
          </span>
          <ChevronDown className={`size-3.5 text-muted transition-transform ${abierto ? "rotate-180" : ""}`} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onEncuadrar}
          title="Encuadrar los focos activos y sus medios. Si el mapa ya está así, sale a España entera. Atajo: V"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-panel-border-strong bg-panel/95 px-2.5 text-[13px] font-medium text-foreground shadow-sm backdrop-blur hover:bg-panel-2"
        >
          <Maximize2 className="size-3.5 text-brand" aria-hidden /> Ver todo
          <kbd className="rounded border border-panel-border-strong bg-panel-2 px-1 text-[10px] font-semibold text-muted">V</kbd>
        </button>
      </div>

      {abierto ? (
        <div
          id="panel-capas"
          className="pointer-events-auto w-full overflow-y-auto rounded-xl border border-panel-border bg-panel/97 p-1.5 shadow-[var(--sombra-flotante)] backdrop-blur scroll-fino"
        >
          {filas.map((f) => (
            <Interruptor
              key={f.id}
              activo={activas[f.id]}
              onCambiar={() => onAlternar(f.id)}
              etiqueta={f.etiqueta}
              color={f.color}
              nota={f.cuenta > 0 ? `${f.cuenta} en el mapa` : f.ayuda}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Leyenda plegable, abajo a la izquierda: color + forma + texto. */
export function Leyenda({ entradas }: { entradas: { color: string; forma: "linea" | "punto" | "area" | "discontinua"; texto: string }[] }) {
  const [abierta, setAbierta] = useState(true);
  if (entradas.length === 0) return null;
  return (
    <div className="pointer-events-auto absolute bottom-7 left-2 z-[900] max-w-[16rem] rounded-xl border border-panel-border bg-panel/95 shadow-[var(--sombra-panel)] backdrop-blur">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className="flex min-h-9 w-full items-center gap-1.5 px-2.5 text-[12px] font-semibold text-foreground"
      >
        <ChevronDown className={`size-3.5 text-muted transition-transform ${abierta ? "" : "-rotate-90"}`} aria-hidden />
        Leyenda
      </button>
      {abierta ? (
        <ul className="max-h-56 space-y-1 overflow-y-auto px-2.5 pb-2 scroll-fino">
          {entradas.map((e) => (
            <li key={e.texto} className="flex items-center gap-2 text-[11.5px] leading-tight text-muted">
              <span aria-hidden className="shrink-0">
                {e.forma === "punto" ? (
                  <span className="block size-2.5 rounded-full" style={{ background: e.color }} />
                ) : e.forma === "area" ? (
                  <span className="block h-2.5 w-4 rounded-sm border" style={{ background: `${e.color}44`, borderColor: e.color }} />
                ) : e.forma === "discontinua" ? (
                  <span className="block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: e.color }} />
                ) : (
                  <span className="block h-0 w-4 border-t-2" style={{ borderColor: e.color }} />
                )}
              </span>
              <span>{e.texto}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
