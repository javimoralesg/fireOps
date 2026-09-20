"use client";
// Panel compacto de capas del mapa + leyenda plegable. DUEÑO: constructor E.

import { useState, type ReactNode } from "react";
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
  | "fueraEspana";

export interface FilaCapa {
  id: ClaveCapa;
  etiqueta: string;
  cuenta: number;
  color?: string;
  /** Qué se ve cuando está activada, o de dónde saldrán los datos si aún no hay. */
  ayuda: string;
  /**
   * Casilla "solo en incendios" bajo la capa (unidades, bases, hospitales).
   * `cuenta` es lo que queda en el mapa con el filtro puesto.
   */
  filtro?: { etiqueta: string; titulo: string; activo: boolean; cuenta: number; onCambiar: () => void };
}

/** Línea secundaria de cada capa: cuántos hay (y cuántos quedan con el filtro), o de dónde saldrán. */
function notaCapa(f: FilaCapa): string {
  if (f.cuenta === 0) return f.ayuda;
  if (f.filtro?.activo) return `${f.filtro.cuenta} de ${f.cuenta} en el mapa`;
  return `${f.cuenta} en el mapa`;
}

export function PanelCapas({
  filas,
  activas,
  onAlternar,
  onEncuadrar,
  extra,
}: {
  filas: FilaCapa[];
  activas: Record<ClaveCapa, boolean>;
  onAlternar: (id: ClaveCapa) => void;
  onEncuadrar: () => void;
  /** Botones adicionales en la misma fila (p. ej. el filtro por zona). */
  extra?: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const numActivas = filas.filter((f) => activas[f.id]).length;

  return (
    <div className="pointer-events-none absolute left-2 top-2 z-[900] flex max-h-[calc(100%-5rem)] w-[15.5rem] max-w-[calc(100vw-1rem)] flex-col items-start gap-1.5">
        {/* `w-max`: la fila puede ser más ancha que la columna del desplegable sin partirse en varias líneas. */}
      <div className="pointer-events-auto flex w-max max-w-[calc(100vw-1rem)] flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          aria-controls="panel-capas"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-panel-border-strong bg-panel px-2.5 text-[13px] font-medium text-foreground shadow-sm hover:bg-panel-2"
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
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-panel-border-strong bg-panel px-2.5 text-[13px] font-medium text-foreground shadow-sm hover:bg-panel-2"
        >
          <Maximize2 className="size-3.5 text-brand" aria-hidden /> Ver todo
          <kbd className="rounded border border-panel-border-strong bg-panel-2 px-1 text-[10px] font-semibold text-muted">V</kbd>
        </button>
        {extra}
      </div>

      {abierto ? (
        <div
          id="panel-capas"
          className="pointer-events-auto w-full overflow-y-auto rounded-xl border border-panel-border bg-panel p-1.5 shadow-[var(--sombra-flotante)] scroll-fino"
        >
          {filas.map((f) => (
            <div key={f.id}>
              <Interruptor
                activo={activas[f.id]}
                onCambiar={() => onAlternar(f.id)}
                etiqueta={f.etiqueta}
                color={f.color}
                nota={notaCapa(f)}
              />
              {/* Filtro "solo en incendios": casilla bajo la capa, solo con la capa encendida. */}
              {f.filtro && activas[f.id] ? (
                <label
                  title={f.filtro.titulo}
                  className="mb-1 ml-[3.4rem] flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[11.5px] text-muted hover:bg-panel-2"
                >
                  <input type="checkbox" checked={f.filtro.activo} onChange={f.filtro.onCambiar} className="size-3.5 shrink-0 accent-brand" />
                  <span className="truncate">{f.filtro.etiqueta}</span>
                </label>
              ) : null}
            </div>
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
    <div className="pointer-events-auto absolute bottom-7 left-2 z-[900] max-w-[16rem] rounded-xl border border-panel-border bg-panel shadow-[var(--sombra-panel)]">
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
