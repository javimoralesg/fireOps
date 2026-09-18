"use client";

import { useState } from "react";
import {
  Ban,
  BookMarked,
  Bot,
  ChevronRight,
  CircleCheck,
  CircleX,
  Cpu,
  FileText,
  History,
  Lightbulb,
  Radio,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { EntradaTimeline } from "@/lib/tipos-sistema";
import { Ayuda, Tooltip } from "./ui/Tooltip";

type TipoTimeline = EntradaTimeline["tipo"];

// Un tono por tipo de entrada, siempre con icono y etiqueta: el color nunca
// es el único canal (docs/identidad.md).
const TIPO_UI: Record<TipoTimeline, { label: string; icon: LucideIcon; text: string; bg: string; chip: string }> = {
  evento: { label: "Evento", icon: Radio, text: "text-info", bg: "bg-info/10", chip: "border-info/30 bg-info/10 text-info" },
  propuesta: {
    label: "Propuesta",
    icon: Lightbulb,
    text: "text-brand",
    bg: "bg-brand/10",
    chip: "border-brand/30 bg-brand/10 text-brand",
  },
  aprobada: {
    label: "Aprobada",
    icon: CircleCheck,
    text: "text-success",
    bg: "bg-success/10",
    chip: "border-success/30 bg-success/10 text-success",
  },
  denegada: {
    label: "Denegada",
    icon: CircleX,
    text: "text-danger",
    bg: "bg-danger/10",
    chip: "border-danger/30 bg-danger/10 text-danger",
  },
  ejecutada: {
    label: "Ejecutada",
    icon: Zap,
    text: "text-success",
    bg: "bg-success/10",
    chip: "border-success/30 bg-success/10 text-success",
  },
  invalidada: {
    label: "Invalidada",
    icon: Ban,
    text: "text-warning",
    bg: "bg-warning/10",
    chip: "border-warning/30 bg-warning/10 text-warning",
  },
  auto: { label: "Automática", icon: Bot, text: "text-brand-2", bg: "bg-brand-2/10", chip: "border-brand-2/30 bg-brand-2/10 text-brand-2" },
  regla: {
    label: "Doctrina",
    icon: BookMarked,
    text: "text-info",
    bg: "bg-info/10",
    chip: "border-info/30 bg-info/10 text-info",
  },
  informe: {
    label: "Informe",
    icon: FileText,
    text: "text-muted",
    bg: "bg-foreground/5",
    chip: "border-panel-border-strong bg-panel-2 text-foreground",
  },
  sistema: {
    label: "Sistema",
    icon: Cpu,
    text: "text-muted",
    bg: "bg-panel-2",
    chip: "border-panel-border-strong bg-panel-2 text-muted",
  },
};

const ORDEN_TIPOS = Object.keys(TIPO_UI) as TipoTimeline[];
const NUEVA_MS = 20_000; // entradas más recientes que esto se resaltan

function haceCuanto(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 5) return "ahora";
  if (s < 60) return `hace ${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return `hace ${h} h ${min % 60} min`;
}

function hora(ts: number) {
  return new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function Timeline({
  timeline,
  ahora,
  onSeleccionarRef,
}: {
  timeline: EntradaTimeline[];
  ahora: number; // epoch ms sincronizado con el servidor
  onSeleccionarRef?: (ref: string) => void;
}) {
  // Tipos seleccionados en el filtro; vacío = todos
  const [filtro, setFiltro] = useState<Set<TipoTimeline>>(() => new Set());

  // Más reciente primero; sort estable: en empate se respeta el orden recibido
  const ordenadas = timeline.map((e) => ({ e, ts: new Date(e.timestamp).getTime() })).sort((a, b) => b.ts - a.ts);

  const conteo = new Map<TipoTimeline, number>();
  for (const { e } of ordenadas) conteo.set(e.tipo, (conteo.get(e.tipo) ?? 0) + 1);
  const tiposPresentes = ORDEN_TIPOS.filter((t) => conteo.has(t));

  const visibles = filtro.size === 0 ? ordenadas : ordenadas.filter(({ e }) => filtro.has(e.tipo));

  const alternar = (t: TipoTimeline) =>
    setFiltro((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-panel-border px-4 py-2">
        <h2 className="flex shrink-0 items-center gap-2 text-[13px] font-semibold text-foreground">
          <History className="size-4 text-brand" /> Cronología
          <span className="font-mono text-[11px] font-normal text-muted">{timeline.length}</span>
          <Ayuda
            texto="Todo lo que ha pasado, con la hora del servidor; pulsa una entrada para ir a la decisión, el informe o la regla."
            titulo="Qué muestra este panel"
          />
        </h2>
        <div className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
          <div className="ml-auto flex items-center gap-1">
            <Tooltip contenido="Quitar los filtros y ver todas las entradas." lado="abajo">
              <button type="button" onClick={() => setFiltro(new Set())} aria-pressed={filtro.size === 0} className="chip shrink-0">
                Todo
              </button>
            </Tooltip>
            {tiposPresentes.map((t) => {
              const ui = TIPO_UI[t];
              const Icono = ui.icon;
              const activo = filtro.has(t);
              return (
                <Tooltip key={t} contenido={`Filtrar: ${ui.label}`} lado="abajo">
                  <button
                    type="button"
                    onClick={() => alternar(t)}
                    aria-pressed={activo}
                    aria-label={`Filtrar: ${ui.label}`}
                    className={`chip shrink-0 ${activo ? ui.chip : ""}`}
                  >
                    <Icono className={`size-3 ${activo ? "" : ui.text}`} aria-hidden />
                    {activo && <span>{ui.label}</span>}
                    <span className="font-mono">{conteo.get(t)}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>

      <ol className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {visibles.length === 0 && (
          <li className="px-2 py-3 text-center text-xs italic text-muted">
            {timeline.length === 0 ? "Sin actividad todavía" : "Ninguna entrada coincide con el filtro"}
          </li>
        )}
        {visibles.map(({ e, ts }) => {
          const ui = TIPO_UI[e.tipo];
          const Icono = ui.icon;
          const nueva = ahora - ts < NUEVA_MS;
          const clicable = Boolean(e.ref && onSeleccionarRef);
          const contenido = (
            <>
              <span className={`flex size-5 shrink-0 items-center justify-center rounded ${ui.bg}`}>
                <Icono className={`size-3 ${ui.text}`} />
              </span>
              <Tooltip contenido={`${hora(ts)} · tick ${e.tick}`} titulo="Hora del servidor" lado="derecha" className="shrink-0">
                <span className="w-[4.75rem] font-mono text-[11px] text-muted">{haceCuanto(ahora - ts)}</span>
              </Tooltip>
              <span className={`hidden w-[4.5rem] shrink-0 text-[11px] font-semibold sm:inline ${ui.text}`}>{ui.label}</span>
              <Tooltip contenido={e.texto} lado="arriba" retardo={400} className="min-w-0 flex-1">
                <span className="min-w-0 flex-1 truncate text-foreground">{e.texto}</span>
              </Tooltip>
              {nueva && <span className="pildora pildora-marca shrink-0 px-1.5 text-[10px]">Nuevo</span>}
              {e.ref && <span className="hidden shrink-0 font-mono text-[11px] text-subtle lg:inline">{e.ref}</span>}
              {clicable && (
                <ChevronRight className="size-3.5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
              )}
            </>
          );
          const clases = `group flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px] transition-colors ${
            nueva ? "bg-brand/5 ring-1 ring-inset ring-brand/20" : ""
          }`;
          return (
            <li key={e.id}>
              {clicable ? (
                <button
                  type="button"
                  onClick={() => onSeleccionarRef!(e.ref!)}
                  className={`${clases} cursor-pointer hover:bg-panel-2`}
                >
                  {contenido}
                </button>
              ) : (
                <div className={clases}>{contenido}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
