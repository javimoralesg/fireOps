"use client";

// Últimos acontecimientos: una sola lista, en orden, en lenguaje llano.
// Sustituye al feed de ingesta y a la cronología técnica de la consola anterior.

import { Ban, BookMarked, Bot, ChevronRight, CircleCheck, CircleX, FileText, Info, Lightbulb, Radio, Zap, type LucideIcon } from "lucide-react";
import type { EntradaTimeline } from "@/lib/tipos-sistema";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { esRelevante, haceTiempo, textoLlano } from "./texto";

// Un color por tipo de acontecimiento, siempre con icono además del color
// (docs/identidad.md §6.7: el color nunca es el único canal).
const TIPO: Record<EntradaTimeline["tipo"], { icono: LucideIcon; cls: string; etiqueta: string }> = {
  evento: { icono: Radio, cls: "text-info bg-info/10", etiqueta: "Aviso" },
  propuesta: { icono: Lightbulb, cls: "text-brand bg-brand/10", etiqueta: "Propuesta" },
  aprobada: { icono: CircleCheck, cls: "text-success bg-success/10", etiqueta: "Aprobada" },
  ejecutada: { icono: Zap, cls: "text-success bg-success/10", etiqueta: "Ejecutada" },
  auto: { icono: Bot, cls: "text-success bg-success/10", etiqueta: "Automática" },
  denegada: { icono: CircleX, cls: "text-danger bg-danger/10", etiqueta: "Denegada" },
  invalidada: { icono: Ban, cls: "text-warning bg-warning/10", etiqueta: "Invalidada" },
  regla: { icono: BookMarked, cls: "text-brand bg-brand/10", etiqueta: "Regla" },
  informe: { icono: FileText, cls: "text-muted bg-panel-2", etiqueta: "Informe" },
  sistema: { icono: Info, cls: "text-muted bg-panel-2", etiqueta: "Sistema" },
};

/** Hora completa del servidor para el tooltip de "hace N min". */
function horaCompleta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "hora desconocida";
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

interface Props {
  timeline: EntradaTimeline[];
  ahora: number;
  /** Qué hacer al pulsar una entrada con referencia (decisión, informe, regla). */
  onIr?: (ref: string) => void;
  limite?: number;
}

export function Acontecimientos({ timeline, ahora, onIr, limite = 16 }: Props) {
  const entradas = timeline.filter(esRelevante).slice(0, limite);

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Últimos acontecimientos">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-panel-border px-4 py-2.5">
        <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-foreground">
          <Radio className="size-4 shrink-0 text-brand" aria-hidden /> Últimos acontecimientos
          <Ayuda
            titulo="Últimos acontecimientos"
            texto="Todo lo que ha pasado en el incidente, con la hora del servidor: avisos recibidos, propuestas de la IA, firmas, ejecuciones e informes. Se actualiza solo, sin recargar."
          />
        </h2>
        <Tooltip titulo="Lista en directo" contenido="Cada acontecimiento aparece aquí en cuanto ocurre, sin recargar la página." lado="izquierda">
          <span className="pildora pildora-exito shrink-0">
            <span className="size-1.5 rounded-full bg-success" aria-hidden />
            se actualiza solo
          </span>
        </Tooltip>
      </header>
      <ol className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {entradas.length === 0 && (
          <li className="flex flex-col items-center gap-1.5 px-2 py-8 text-center">
            <Radio className="size-6 text-subtle" aria-hidden />
            <p className="text-sm font-semibold text-foreground">Todavía no ha pasado nada</p>
            <p className="max-w-xs text-xs text-muted">En cuanto llegue el primer aviso aparecerá aquí, con su hora.</p>
          </li>
        )}
        {entradas.map((e) => {
          const t = TIPO[e.tipo] ?? TIPO.sistema;
          const Icono = t.icono;
          const reciente = ahora - Date.parse(e.timestamp) < 25_000;
          const texto = textoLlano(e);
          const clicable = Boolean(e.ref && onIr);
          const contenido = (
            <>
              <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${t.cls}`} aria-hidden>
                <Icono className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-snug text-foreground">{texto}</span>
                <span className="mt-0.5 block text-[11px] text-subtle">
                  {t.etiqueta} ·{" "}
                  <Tooltip titulo="Hora del servidor" contenido={`Ocurrió a las ${horaCompleta(e.timestamp)}.`} lado="arriba">
                    <span>{haceTiempo(e.timestamp, ahora)}</span>
                  </Tooltip>
                </span>
              </span>
              {clicable && <ChevronRight className="mt-1.5 size-4 shrink-0 text-subtle" aria-hidden />}
            </>
          );
          return (
            <li key={e.id} className={`rounded-lg transition-colors ${reciente ? "bg-brand/6" : ""}`}>
              {clicable ? (
                <button
                  type="button"
                  onClick={() => onIr!(e.ref!)}
                  className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-panel-2"
                >
                  {contenido}
                </button>
              ) : (
                <div className="flex items-start gap-2.5 px-2 py-2">{contenido}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
