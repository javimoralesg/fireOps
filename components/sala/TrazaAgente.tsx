"use client";
// Visor de la traza de un ciclo de agente: qué vio, qué pensó (llamadas de IA
// con prompt y respuesta) y qué produjo. DUEÑO: constructor E.
//
// Es la pieza que enseña al jurado que el sistema "piensa" de verdad: cada
// llamada lleva proveedor, modelo, papel, latencia y tokens reales.

import { AlertTriangle, Brain, CheckCircle2, CircleDot, Clock, FileOutput, Loader2, Radio } from "lucide-react";
import type { LlamadaIA, TrazaCiclo } from "@/lib/dominio/tipos";
import { duracion, haceCuanto, hora, numero, recortar } from "@/lib/cliente/formato";
import { Desplegable } from "@/components/ui/Desplegable";
import { Insignia } from "@/components/ui/Insignia";

const TEXTO_ESTADO: Record<TrazaCiclo["estado"], string> = {
  en_curso: "Pensando…",
  ok: "Completado",
  error: "Con error",
  cancelado: "Cancelado",
};

function iconoEstado(estado: TrazaCiclo["estado"]) {
  if (estado === "en_curso") return <Loader2 className="size-3.5 animate-spin text-brand" aria-hidden />;
  if (estado === "ok") return <CheckCircle2 className="size-3.5 text-success" aria-hidden />;
  if (estado === "error") return <AlertTriangle className="size-3.5 text-danger" aria-hidden />;
  return <CircleDot className="size-3.5 text-muted" aria-hidden />;
}

/** Resumen de una línea de la última traza, para la lista de agentes. */
export function ResumenTraza({ traza }: { traza?: TrazaCiclo }) {
  if (!traza) {
    return <p className="text-[11.5px] leading-snug text-subtle">Aún no ha completado ningún ciclo.</p>;
  }
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] leading-snug text-muted">
      {iconoEstado(traza.estado)}
      <span className="font-medium text-foreground">{traza.motivo}</span>
      <span aria-hidden>·</span>
      <span>{traza.estado === "en_curso" ? "en curso" : duracion(traza.duracionMs)}</span>
      {traza.llamadasIA.length > 0 ? (
        <>
          <span aria-hidden>·</span>
          <span>
            {traza.llamadasIA.length} {traza.llamadasIA.length === 1 ? "llamada de IA" : "llamadas de IA"}
          </span>
        </>
      ) : null}
      {traza.resumen ? <span className="w-full text-subtle">{recortar(traza.resumen, 110)}</span> : null}
    </p>
  );
}

function BloqueLlamada({ llamada }: { llamada: LlamadaIA }) {
  return (
    <div className="rounded-lg border border-panel-border bg-panel p-2">
      <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
        <Brain className="size-3.5 text-brand" aria-hidden />
        <span className="font-semibold text-foreground">{llamada.modelo}</span>
        <Insignia pequena tono="marca">{llamada.papel}</Insignia>
        <span>{llamada.proveedor}</span>
        <span aria-hidden>·</span>
        <span>{duracion(llamada.latenciaMs)}</span>
        {llamada.tokensEntrada || llamada.tokensSalida ? (
          <>
            <span aria-hidden>·</span>
            <span className="tabular">
              {numero(llamada.tokensEntrada ?? 0)} → {numero(llamada.tokensSalida ?? 0)} tokens
            </span>
          </>
        ) : null}
        <span aria-hidden>·</span>
        <span>{hora(llamada.en)}</span>
      </p>
      {llamada.error ? <p className="mt-1 text-[11.5px] font-medium text-danger">{llamada.error}</p> : null}
      <div className="mt-1.5 space-y-1">
        <Desplegable titulo="Lo que se le preguntó">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted scroll-fino">
            {llamada.promptResumen || "(sin registrar)"}
          </pre>
        </Desplegable>
        <Desplegable titulo="Lo que respondió">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted scroll-fino">
            {llamada.respuestaResumen || "(sin registrar)"}
          </pre>
        </Desplegable>
      </div>
    </div>
  );
}

/** Una traza completa, expandible: entradas → llamadas de IA → salidas → error. */
export function TarjetaTraza({
  traza,
  abiertaPorDefecto = false,
  onIrADecision,
}: {
  traza: TrazaCiclo;
  abiertaPorDefecto?: boolean;
  onIrADecision?: (decisionId: string) => void;
}) {
  return (
    <details
      open={abiertaPorDefecto}
      className={`group rounded-xl border bg-panel ${traza.estado === "error" ? "border-danger/45" : "border-panel-border"}`}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-start gap-2 px-3 py-2 marker:content-['']">
        <span className="mt-0.5 shrink-0">{iconoEstado(traza.estado)}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 text-[13px] font-medium text-foreground">
            {traza.motivo}
            <span className="font-normal text-subtle">
              · {hora(traza.inicio)} · {traza.estado === "en_curso" ? TEXTO_ESTADO.en_curso : duracion(traza.duracionMs)}
            </span>
          </span>
          {traza.resumen ? <span className="mt-0.5 block text-[12px] leading-snug text-muted">{traza.resumen}</span> : null}
          <span className="mt-1 flex flex-wrap gap-1">
            {traza.llamadasIA.length > 0 ? (
              <Insignia pequena tono="marca">
                {traza.llamadasIA.length} {traza.llamadasIA.length === 1 ? "llamada de IA" : "llamadas de IA"}
              </Insignia>
            ) : (
              <Insignia pequena tono="neutro">Determinista</Insignia>
            )}
            {traza.decisiones.length > 0 ? <Insignia pequena tono="aviso">{traza.decisiones.length} decisiones</Insignia> : null}
            {traza.observaciones.length > 0 ? <Insignia pequena tono="info">{traza.observaciones.length} observaciones</Insignia> : null}
            {traza.eventos > 0 ? <Insignia pequena tono="neutro">{traza.eventos} eventos</Insignia> : null}
          </span>
        </span>
      </summary>

      <div className="space-y-2 border-t border-panel-border px-3 py-2.5">
        <section>
          <h4 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-subtle">
            <Radio className="size-3.5" aria-hidden /> Lo que vio
          </h4>
          <p className="mt-1 text-[12.5px] leading-snug text-muted">{traza.entradas || "No se registraron entradas para este ciclo."}</p>
        </section>

        <section>
          <h4 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-subtle">
            <Brain className="size-3.5" aria-hidden /> Lo que pensó
          </h4>
          {traza.llamadasIA.length === 0 ? (
            <p className="mt-1 text-[12.5px] leading-snug text-muted">Ciclo determinista: sin llamadas a modelos de lenguaje.</p>
          ) : (
            <div className="mt-1 space-y-1.5">
              {traza.llamadasIA.map((ll, i) => (
                <BloqueLlamada key={`${traza.id}-ia-${i}`} llamada={ll} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h4 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-subtle">
            <FileOutput className="size-3.5" aria-hidden /> Lo que produjo
          </h4>
          {traza.decisiones.length === 0 && traza.observaciones.length === 0 ? (
            <p className="mt-1 text-[12.5px] leading-snug text-muted">Este ciclo no generó decisiones ni observaciones.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-[12.5px] text-muted">
              {traza.decisiones.map((d) => (
                <li key={d}>
                  {onIrADecision ? (
                    <button
                      type="button"
                      onClick={() => onIrADecision(d)}
                      className="text-left font-medium text-brand underline underline-offset-2 hover:opacity-80"
                    >
                      Decisión {d}
                    </button>
                  ) : (
                    <span className="font-medium text-foreground">Decisión {d}</span>
                  )}
                </li>
              ))}
              {traza.observaciones.map((o) => (
                <li key={o}>Observación {o}</li>
              ))}
            </ul>
          )}
        </section>

        {traza.error ? (
          <p className="rounded-lg border border-danger/45 bg-danger/10 p-2 text-[12.5px] leading-snug text-danger">
            <AlertTriangle className="mr-1 inline size-3.5" aria-hidden /> {traza.error}
          </p>
        ) : null}

        <p className="flex items-center gap-1.5 text-[11px] text-subtle">
          <Clock className="size-3" aria-hidden /> Empezó {haceCuanto(traza.inicio)}
          {traza.fin ? ` · terminó ${haceCuanto(traza.fin)}` : ""}
        </p>
      </div>
    </details>
  );
}

/** Línea de tiempo con las últimas trazas de un agente (máximo `limite`). */
export function LineaTiempoTrazas({ trazas, limite = 20, onIrADecision }: { trazas?: TrazaCiclo[]; limite?: number; onIrADecision?: (id: string) => void }) {
  const lista = (trazas ?? []).slice(-limite).reverse();
  if (lista.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-panel-border-strong p-4 text-center text-[13px] text-muted">
        Este agente aún no ha completado ningún ciclo. En cuanto se despierte (por cadencia o por un evento) aparecerá aquí lo que ve,
        lo que piensa y lo que decide.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {lista.map((t, i) => (
        <TarjetaTraza key={t.id} traza={t} abiertaPorDefecto={i === 0 && t.estado === "en_curso"} onIrADecision={onIrADecision} />
      ))}
    </div>
  );
}
