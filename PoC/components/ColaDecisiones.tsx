"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Database, History, ListChecks, ShieldCheck } from "lucide-react";
import type { Decision } from "@/lib/tipos-sistema";
import { BarraRiesgo, Countdown } from "./decision/Indicadores";
import { ESTADO_UI, formatearHora, momentoDecision, msHasta, ORDEN_URGENCIA, URGENCIA_UI } from "./decision/ui";
import { Ayuda, Tooltip } from "./ui/Tooltip";

interface Props {
  decisiones: Decision[];
  /** epoch ms sincronizado con el reloj del servidor */
  ahora: number;
  seleccionadaId: string | null;
  onSeleccionar: (id: string) => void;
  umbralAutonomia: number;
}

export function ColaDecisiones({ decisiones, ahora, seleccionadaId, onSeleccionar, umbralAutonomia }: Props) {
  const [historialAbierto, setHistorialAbierto] = useState(true);

  const { pendientes, historial } = useMemo(() => {
    const pendientes = decisiones
      .filter((d) => d.estado === "pendiente")
      .sort(
        (a, b) =>
          ORDEN_URGENCIA[a.urgencia] - ORDEN_URGENCIA[b.urgencia] ||
          (Date.parse(a.plazo) || 0) - (Date.parse(b.plazo) || 0),
      );
    const historial = decisiones
      .filter((d) => d.estado !== "pendiente")
      .sort((a, b) => momentoDecision(b) - momentoDecision(a));
    return { pendientes, historial };
  }, [decisiones]);

  const criticas = pendientes.filter((d) => d.urgencia === "critica").length;

  return (
    <section className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-panel-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <ListChecks className="size-4 text-brand" /> Cola de decisiones
          <Ayuda
            texto="Propuestas de la IA pendientes de firma, ordenadas por urgencia y por plazo; debajo, el historial de las ya resueltas."
            titulo="Qué muestra este panel"
          />
        </h2>
        <span className="text-[11px] text-muted">
          <span className="font-mono font-semibold text-foreground">{pendientes.length}</span>{" "}
          {pendientes.length === 1 ? "pendiente" : "pendientes"} ·{" "}
          <span className={`font-mono font-semibold ${criticas > 0 ? "text-danger" : "text-foreground"}`}>{criticas}</span>{" "}
          {criticas === 1 ? "crítica" : "críticas"}
        </span>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto p-2">
        {pendientes.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 rounded-[10px] border border-dashed border-success/30 bg-success/10 px-3 py-6 text-center">
            <ShieldCheck className="size-5 text-success" aria-hidden />
            <p className="text-sm font-medium text-success">Sin decisiones pendientes</p>
            <p className="text-[11px] text-muted">La IA avisará aquí cuando necesite una firma.</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {pendientes.map((d) => (
              <li key={d.id}>
                <FilaDecision
                  decision={d}
                  ahora={ahora}
                  seleccionada={d.id === seleccionadaId}
                  onSeleccionar={onSeleccionar}
                  umbralAutonomia={umbralAutonomia}
                />
              </li>
            ))}
          </ul>
        )}

        {historial.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setHistorialAbierto((v) => !v)}
              aria-expanded={historialAbierto}
              className="chip flex w-full items-center gap-1.5 px-2 py-1.5"
            >
              <ChevronRight className={`size-3.5 transition-transform ${historialAbierto ? "rotate-90" : ""}`} aria-hidden />
              <History className="size-3.5" aria-hidden /> Historial
              <span className="ml-auto font-mono font-normal">{historial.length}</span>
            </button>
            {historialAbierto && (
              <ul className="mt-1 space-y-1.5">
                {historial.map((d) => (
                  <li key={d.id}>
                    <FilaDecision
                      decision={d}
                      ahora={ahora}
                      seleccionada={d.id === seleccionadaId}
                      onSeleccionar={onSeleccionar}
                      umbralAutonomia={umbralAutonomia}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function FilaDecision({
  decision: d,
  ahora,
  seleccionada,
  onSeleccionar,
  umbralAutonomia,
}: {
  decision: Decision;
  ahora: number;
  seleccionada: boolean;
  onSeleccionar: (id: string) => void;
  umbralAutonomia: number;
}) {
  const urg = URGENCIA_UI[d.urgencia] ?? URGENCIA_UI.media;
  const est = ESTADO_UI[d.estado] ?? ESTADO_UI.pendiente;
  const IconoEstado = est.icono;
  const pendiente = d.estado === "pendiente";
  const inminente = pendiente && msHasta(d.plazo, ahora) < 60_000;
  const cerrada = d.estado === "denegada" || d.estado === "invalidada";

  return (
    <button
      type="button"
      data-decision-id={d.id}
      onClick={() => onSeleccionar(d.id)}
      aria-current={seleccionada ? "true" : undefined}
      className={`fila-interactiva group relative flex w-full cursor-pointer flex-col gap-1.5 overflow-hidden py-2 pl-3.5 pr-3 text-left ${
        !seleccionada && inminente ? "border-danger/40 bg-danger/5" : ""
      }`}
    >
      {/* franja de urgencia */}
      <span className={`absolute inset-y-0 left-0 w-1 ${urg.franja} ${cerrada ? "opacity-30" : ""}`} />

      <div className="flex items-start gap-2">
        <span className={`pildora mt-px shrink-0 ${urg.badge} ${cerrada ? "opacity-60" : ""}`}>{urg.etiqueta}</span>
        <Tooltip contenido={d.tarjeta.titulo} className="min-w-0 flex-1" lado="arriba" retardo={400}>
          <span
            className={`line-clamp-2 text-[13px] font-medium leading-snug ${cerrada ? "text-muted line-through decoration-muted/50" : "text-foreground"}`}
          >
            {d.tarjeta.titulo}
          </span>
        </Tooltip>
        <span className="shrink-0 text-xs leading-5">
          {pendiente ? (
            <Countdown plazo={d.plazo} ahora={ahora} />
          ) : (
            <Tooltip contenido="Hora en la que se resolvió la decisión (reloj del servidor)." lado="izquierda">
              <span className="font-mono text-[11px] text-muted">
                {formatearHora(d.decididaPor?.timestamp ?? d.creadaEn, false)}
              </span>
            </Tooltip>
          )}
        </span>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-muted">
        <Tooltip contenido={`Estado de la decisión: ${est.etiqueta.toLowerCase()}.`} titulo="Estado">
          <span className={`flex items-center gap-1 ${est.color}`}>
            <IconoEstado className={`size-3.5 ${est.girar ? "animate-spin" : ""}`} aria-hidden />
            <span>{est.etiqueta}</span>
          </span>
        </Tooltip>
        <Tooltip
          titulo="Riesgo de la acción"
          contenido={
            <>
              Riesgo <strong>{d.riesgo}/100</strong> · umbral de autonomía <strong>{umbralAutonomia}</strong>: por encima del
              umbral necesita firma humana.
            </>
          }
          className="ml-auto"
        >
          <span className="flex items-center gap-1.5">
            <BarraRiesgo riesgo={d.riesgo} umbral={umbralAutonomia} className="w-14" />
            <span className="w-5 text-right font-mono text-foreground">{d.riesgo}</span>
          </span>
        </Tooltip>
        <Tooltip
          titulo="Evidencia"
          contenido={`${d.evidencia.length} ${d.evidencia.length === 1 ? "dato" : "datos"} que sostienen la propuesta (sensores, llamadas, grafo…).`}
        >
          <span className="flex items-center gap-1">
            <Database className="size-3" aria-hidden />
            <span className="font-mono">{d.evidencia.length}</span>
          </span>
        </Tooltip>
      </div>
    </button>
  );
}
