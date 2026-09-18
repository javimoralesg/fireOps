"use client";

// Reproducción en curso: escenario, progreso, velocidad, cuenta atrás y Parar.
// La cuenta atrás se ancla en local al snapshot recibido (el SSE solo manda
// cambios) para que baje segundo a segundo sin sondear.

import { useState } from "react";
import { CircleStop, Gauge, LoaderCircle, Timer } from "lucide-react";
import { api } from "@/lib/api-cliente";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { AVISO_SIN_PERMISO, ErrorInline, hora, mensajeError, mmss, useReloj } from "./ui";
import type { EstadoSim, ResumenEscenarioSim } from "./tipos";

export const VELOCIDADES = [1, 5, 10] as const;
export const ESCENARIO_GUION = "simulacro-mendez-alvaro";

/** Evento que el pipeline está analizando ahora. */
export const enProceso = (sim: EstadoSim | undefined) => sim?.procesando;

interface Props {
  sim: EstadoSim;
  escenario?: ResumenEscenarioSim;
  puedeControlar: boolean;
  /** Segundo del guion desde el que se lanzó esta reproducción (si la lanzó este panel). */
  desdeBase: number;
  onReiniciada: (estado: EstadoSim, desde: number | undefined) => void;
  onParada?: (estado: EstadoSim) => void;
  onCambio?: () => void;
  /** false/undefined → nota de que el análisis local (sin clave de Claude) marca el ritmo. */
  iaDisponible?: boolean;
}

export function Reproduccion({ sim, puedeControlar, onParada, onCambio, iaDisponible }: Props) {
  const ahora = useReloj(sim.activa);
  const [ocupado, setOcupado] = useState<"parar" | number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Ancla de la cuenta atrás: se re-ancla cada vez que cambia el snapshot.
  const firma = `${sim.escenarioId}|${sim.iniciadaEn}|${sim.indice}|${sim.siguienteEnSeg}|${sim.activa}`;
  const [ancla, setAncla] = useState<{ firma: string; objetivo: number | null }>({
    firma,
    objetivo: sim.siguienteEnSeg !== undefined ? ahora + sim.siguienteEnSeg * 1000 : null,
  });
  if (ancla.firma !== firma) {
    setAncla({ firma, objetivo: sim.siguienteEnSeg !== undefined ? ahora + sim.siguienteEnSeg * 1000 : null });
  }
  const restante = ancla.objetivo !== null ? Math.max(0, Math.ceil((ancla.objetivo - ahora) / 1000)) : null;

  // Evento en el pipeline: se ancla su inicio para que el contador de segundos avance en local.
  const analizando = enProceso(sim);
  const firmaAnalisis = analizando ? `${analizando.eventoId}|${analizando.desdeHaceSeg}` : "";
  const [anclaAnalisis, setAnclaAnalisis] = useState<{ firma: string; inicio: number }>({
    firma: firmaAnalisis,
    inicio: ahora - (analizando?.desdeHaceSeg ?? 0) * 1000,
  });
  if (anclaAnalisis.firma !== firmaAnalisis) {
    setAnclaAnalisis({ firma: firmaAnalisis, inicio: ahora - (analizando?.desdeHaceSeg ?? 0) * 1000 });
  }
  const segAnalisis = analizando ? Math.max(analizando.desdeHaceSeg, Math.round((ahora - anclaAnalisis.inicio) / 1000)) : 0;

  const esGuion = sim.escenarioId === ESCENARIO_GUION;
  const total = Math.max(sim.total, 0);
  const pct = total > 0 ? Math.min(100, Math.round((sim.indice / total) * 100)) : 0;
  const unidad = esGuion ? "paso" : "evento";

  const parar = async () => {
    setOcupado("parar");
    setError(null);
    try {
      onParada?.(await api.pararSimulacion());
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setOcupado(null);
      onCambio?.();
    }
  };

  // PATCH en caliente (poc-55): no reinicia la reproducción ni vacía los resultados.
  const cambiarVelocidad = async (v: number) => {
    if (!sim.escenarioId || v === sim.velocidad) return;
    setOcupado(v);
    setError(null);
    setAviso(null);
    try {
      await api.velocidadSimulacion(v);
      setAviso(`Velocidad cambiada a x${v} sin reiniciar: el siguiente evento se reprograma al nuevo ritmo.`);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setOcupado(null);
      onCambio?.();
    }
  };


  return (
    <section
      aria-label="Reproducción en curso"
      className="rounded-[10px] border px-3 py-2.5"
      style={{
        borderColor: "color-mix(in srgb, var(--brand) 35%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--brand) 6%, var(--panel))",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="etiqueta flex items-center gap-1.5" style={{ color: "var(--brand)" }}>
          <span className="relative flex size-2" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex size-2 rounded-full bg-brand" />
          </span>
          En directo
        </span>
        <Tooltip
          titulo="Hora de arranque"
          contenido="Cuándo se lanzó esta reproducción en el servidor. La ven todas las consolas conectadas."
        >
          <span className="font-mono text-[11px] text-subtle" tabIndex={0}>
            desde {hora(sim.iniciadaEn)}
          </span>
        </Tooltip>
      </div>

      <p className="mt-1 text-[13px] font-semibold leading-snug text-foreground">{sim.nombre ?? sim.escenarioId}</p>
      {sim.escenarioId && (
        <Tooltip titulo="Id del escenario" contenido="Identificador en el dataset. Queda en cada evento inyectado, en Resultados y en la auditoría.">
          <span className="font-mono text-[11px] text-subtle" tabIndex={0}>
            {sim.escenarioId}
          </span>
        </Tooltip>
      )}

      {/* Progreso */}
      <div className="mt-2.5">
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <Tooltip
            titulo={esGuion ? "Pasos del guion" : "Eventos inyectados"}
            contenido={
              esGuion
                ? "Pasos del guion guiado que el motor ya ha aplicado, de los que tiene el escenario."
                : "Eventos del escenario que el servidor ya ha metido por el pipeline, de los que tiene el guion. Lo que produce cada uno se ve en Resultados."
            }
          >
            <span className="text-muted" tabIndex={0} aria-live="polite">
              {esGuion ? "Paso" : "Evento"} <span className="font-mono text-foreground">{sim.indice}</span> de{" "}
              <span className="font-mono text-foreground">{total}</span>
            </span>
          </Tooltip>
          <Tooltip
            titulo={analizando ? "Evento en análisis" : `Siguiente ${unidad}`}
            contenido={
              analizando
                ? "El pipeline está analizando este evento (clasificación, verificación y decisión). El siguiente no se programa hasta que termine."
                : esGuion
                ? "Tiempo hasta el siguiente paso del guion guiado. Lo marca el auto-avance del motor; tras el primer paso el servidor ya no publica la cuenta atrás."
                : "Tiempo real hasta que el servidor inyecte el siguiente evento del dataset, ya dividido por la velocidad."
            }
          >
            <span className="flex items-center gap-1 text-muted" tabIndex={0}>
              {analizando ? (
                <LoaderCircle className="size-3 animate-spin text-brand" aria-hidden />
              ) : (
                <Timer className="size-3" aria-hidden />
              )}
              {analizando ? (
                <span className="max-w-[15rem] truncate text-foreground">
                  Analizando evento <span className="font-mono">{analizando.eventoId}</span>… (<span className="font-mono">{segAnalisis}</span> s)
                </span>
              ) : restante !== null && restante > 0 ? (
                <span className="font-mono text-foreground" aria-live="off">
                  {mmss(restante)}
                </span>
              ) : esGuion && sim.indice < total ? (
                <span className="text-foreground">auto-avance</span>
              ) : sim.indice < total ? (
                <span className="text-foreground">procesando…</span>
              ) : (
                <span>último</span>
              )}
            </span>
          </Tooltip>
        </div>
        <div
          role="progressbar"
          aria-label="Progreso de la reproducción"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={sim.indice}
          aria-valuetext={`${sim.indice} de ${total} ${unidad}s`}
          className="h-1.5 overflow-hidden rounded-full bg-panel-border"
        >
          <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {!esGuion && !iaDisponible && (
        <p className="mt-1.5 text-[11px] leading-snug text-subtle">
          Sin clave de Claude, el análisis local tarda 30-90 s por evento; el ritmo lo marca el pipeline, no la velocidad elegida.
        </p>
      )}

      {/* Controles */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 text-[11px] text-muted">
            <Gauge className="size-3.5" aria-hidden /> Velocidad
            <Ayuda
              titulo="Cambiar la velocidad"
              texto={
                esGuion
                  ? "Reinicia el auto-avance con el nuevo ritmo; el guion sigue desde el paso actual del incidente."
                  : "Cambia el ritmo en caliente, sin reiniciar ni repetir eventos: el servidor reprograma el siguiente."
              }
            />
          </span>
          <div className="flex gap-1" role="group" aria-label="Velocidad de reproducción">
            {VELOCIDADES.map((v) => (
              <Tooltip
                key={v}
                titulo={v === sim.velocidad ? "Velocidad actual" : `Poner a x${v}`}
                contenido={
                  !puedeControlar
                    ? AVISO_SIN_PERMISO
                    : v === sim.velocidad
                      ? "El servidor está inyectando los eventos a este ritmo."
                      : esGuion
                        ? `Cambia el ritmo del auto-avance a x${v}. El guion sigue desde el paso actual.`
                        : `${v === 1 ? "Tiempo real" : `${v} veces más rápido`}: el servidor reprograma el siguiente evento a x${v}, sin reiniciar ni repetir nada.`
                }
              >
                <button
                  type="button"
                  className="chip font-mono"
                  aria-pressed={v === sim.velocidad}
                  disabled={!puedeControlar || ocupado !== null}
                  onClick={() => void cambiarVelocidad(v)}
                >
                  {ocupado === v ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null}x{v}
                </button>
              </Tooltip>
            ))}
            {!VELOCIDADES.includes(sim.velocidad as (typeof VELOCIDADES)[number]) && (
              <Tooltip titulo="Velocidad actual" contenido="La lanzó otra consola con un ritmo que no está entre los botones. Pulsa uno para cambiarlo.">
                <span className="pildora pildora-marca font-mono" tabIndex={0}>
                  <Gauge className="size-3" aria-hidden />x{sim.velocidad}
                </span>
              </Tooltip>
            )}
          </div>
        </div>
        <Tooltip
          titulo="Parar la reproducción"
          contenido={
            (puedeControlar ? undefined : AVISO_SIN_PERMISO) ??
            "Detiene el reproductor en el servidor. Los eventos ya inyectados y las decisiones creadas se quedan; puedes volver a lanzar el escenario."
          }
        >
          <button
            type="button"
            className="boton boton-secundario boton-sm"
            onClick={() => void parar()}
            disabled={!puedeControlar || ocupado !== null}
          >
            {ocupado === "parar" ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <CircleStop className="size-3.5 text-danger" aria-hidden />
            )}
            {ocupado === "parar" ? "Parando…" : "Parar"}
          </button>
        </Tooltip>
      </div>
      {aviso && (
        <p role="status" className="mt-2 text-[11px] leading-snug text-muted">
          {aviso}
        </p>
      )}
      <ErrorInline mensaje={error} className="mt-2" />
    </section>
  );
}
