"use client";

// Resultados en tiempo real: qué ha producido cada evento inyectado (impacto,
// categoría detectada, decisión creada, error) y si acierta lo que esperaba el
// dataset. Lee EstadoSimulacion.ultimos (llega por el SSE de /api/estado).

import { useMemo, useState } from "react";
import { ArrowUpRight, CircleCheck, CircleX, History, Target } from "lucide-react";
import type { EventoIngesta } from "@/lib/types";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { aciertaCategoria, etiquetaCategoria } from "./catalogo";
import { ErrorInline, hora, PildoraImpacto, PildoraVeracidad } from "./ui";
import type { MemoriaInyeccion, ResultadoSim } from "./tipos";

type Filtro = "todos" | "decision" | "errores";

interface Props {
  resultados: ResultadoSim[];
  memoria: Record<string, MemoriaInyeccion>;
  eventos?: Pick<EventoIngesta, "id" | "titulo" | "categoria">[];
  onSeleccionarDecision?: (id: string) => void;
}

/** Id del evento del dataset sin el sufijo de relanzamiento (-r…). */
const idBase = (id: string) => id.replace(/-r[0-9a-z]{6,}$/, "");

export function Resultados({ resultados, memoria, eventos, onSeleccionarDecision }: Props) {
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const porId = useMemo(() => new Map((eventos ?? []).map((e) => [e.id, e])), [eventos]);

  const filas = useMemo(
    () =>
      resultados.map((r) => {
        const mem = memoria[r.eventoId] ?? memoria[idBase(r.eventoId)];
        const ev = porId.get(r.eventoId);
        const categoria = r.categoria ?? ev?.categoria;
        const esperado = mem?.esperadoCategoria;
        const acierto = esperado && categoria ? aciertaCategoria(esperado, categoria) : undefined;
        return { r, mem, titulo: mem?.titulo ?? ev?.titulo, categoria, esperado, acierto };
      }),
    [resultados, memoria, porId],
  );

  const conDecision = filas.filter((f) => f.r.decisionId).length;
  const conError = filas.filter((f) => f.r.error || f.r.impacto === "error").length;
  const evaluados = filas.filter((f) => f.acierto !== undefined);
  const aciertos = evaluados.filter((f) => f.acierto).length;

  const visibles = filas.filter((f) =>
    filtro === "decision" ? f.r.decisionId : filtro === "errores" ? f.r.error || f.r.impacto === "error" : true,
  );

  if (resultados.length === 0) {
    return (
      <div className="rounded-[10px] border border-dashed border-panel-border-strong bg-panel-2 px-4 py-5 text-center">
        <History className="mx-auto size-5 text-subtle" aria-hidden />
        <p className="mt-1.5 text-[13px] font-semibold text-foreground">Aún no se ha inyectado nada</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Lanza un escenario o inyecta un evento: aquí verás en directo qué produce cada uno (impacto, categoría detectada y
          decisión creada).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar resultados">
          <button type="button" className="chip" aria-pressed={filtro === "todos"} onClick={() => setFiltro("todos")}>
            Todos <span className="font-mono">{filas.length}</span>
          </button>
          <button type="button" className="chip" aria-pressed={filtro === "decision"} disabled={conDecision === 0} onClick={() => setFiltro("decision")}>
            Con decisión <span className="font-mono">{conDecision}</span>
          </button>
          <button type="button" className="chip" aria-pressed={filtro === "errores"} disabled={conError === 0} onClick={() => setFiltro("errores")}>
            Errores <span className="font-mono">{conError}</span>
          </button>
          <Ayuda
            titulo="Qué hay en esta lista"
            texto="Cada fila es un evento que ha pasado por el pipeline: los que inyectas aquí y los que va soltando el escenario en marcha. Llegan por el estado del servidor (EstadoSimulacion.ultimos) y el panel los conserva aunque se relance la reproducción."
          />
        </div>
        {evaluados.length > 0 && (
          <Tooltip
            titulo="Aciertos de clasificación"
            contenido="Eventos cuyo dataset traía una categoría esperada y en los que el pipeline ha detectado esa categoría (o una de su familia: humo ≈ incendio)."
          >
            <span className="flex items-center gap-1 text-[11px] text-muted" tabIndex={0}>
              <Target className="size-3" aria-hidden />
              <span className="font-mono text-foreground">
                {aciertos}/{evaluados.length}
              </span>
              aciertos
            </span>
          </Tooltip>
        )}
      </div>

      <ol className="space-y-1.5" aria-live="polite" aria-relevant="additions">
        {visibles.map(({ r, mem, titulo, categoria, esperado, acierto }) => (
          <li key={`${r.eventoId}|${r.timestamp}`} className="rounded-[10px] border border-panel-border bg-panel px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Tooltip titulo="Hora de inyección" contenido="Cuándo entró el evento en el pipeline (hora de Madrid).">
                <span className="font-mono text-[11px] text-subtle" tabIndex={0}>
                  {hora(r.timestamp)}
                </span>
              </Tooltip>
              <PildoraImpacto impacto={r.impacto} error={r.error} />
              {categoria && (
                <Tooltip titulo="Categoría detectada" contenido="Lo que el pipeline (visión o texto) ha entendido que es la observación.">
                  <span className="pildora" tabIndex={0}>
                    {etiquetaCategoria(categoria)}
                  </span>
                </Tooltip>
              )}
              {mem?.veracidad && <PildoraVeracidad veracidad={mem.veracidad} ocultarReal />}
              {esperado && (
                <span className="ml-auto">
                  {acierto === undefined ? (
                    <Tooltip
                      titulo="Sin categoría detectada"
                      contenido={`El dataset esperaba «${etiquetaCategoria(esperado)}», pero el pipeline no ha devuelto categoría (el motor de respaldo no clasifica).`}
                    >
                      <span className="flex items-center gap-1 text-[11px] text-subtle" tabIndex={0}>
                        <Target className="size-3" aria-hidden /> esperaba {etiquetaCategoria(esperado)}
                      </span>
                    </Tooltip>
                  ) : acierto ? (
                    <Tooltip titulo="Acierta" contenido={`Esperado «${etiquetaCategoria(esperado)}» y detectado «${etiquetaCategoria(categoria!)}».`}>
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-success" tabIndex={0}>
                        <CircleCheck className="size-3.5" aria-hidden /> acierta
                      </span>
                    </Tooltip>
                  ) : (
                    <Tooltip titulo="No acierta" contenido={`El dataset esperaba «${etiquetaCategoria(esperado)}» y el pipeline ha detectado «${etiquetaCategoria(categoria!)}».`}>
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-danger" tabIndex={0}>
                        <CircleX className="size-3.5" aria-hidden /> esperaba {etiquetaCategoria(esperado)}
                      </span>
                    </Tooltip>
                  )}
                </span>
              )}
            </div>
            {titulo && <p className="mt-1 line-clamp-2 text-xs font-medium leading-snug text-foreground">{titulo}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-subtle">
              <Tooltip titulo="Id del evento" contenido="Id con el que el evento quedó en el feed de ingesta.">
                <span className="max-w-[16rem] truncate font-mono" tabIndex={0}>
                  {r.eventoId}
                </span>
              </Tooltip>
              <Tooltip
                titulo="Origen"
                contenido={
                  r.datasetId === "manual"
                    ? "Compuesto a mano en este panel."
                    : r.datasetId === "sueltos"
                      ? "Evento suelto del dataset, inyectado a mano."
                      : `Escenario ${r.datasetId} reproducido por el servidor.`
                }
              >
                <span tabIndex={0}>· {r.datasetId}</span>
              </Tooltip>
              {r.decisionId &&
                (onSeleccionarDecision ? (
                  <Tooltip
                    titulo="Ver la decisión"
                    contenido="Abre en la consola la decisión que la IA ha propuesto a partir de este evento."
                    className="ml-auto"
                  >
                    <button
                      type="button"
                      className="boton boton-fantasma boton-sm gap-0.5 px-1.5 text-[11px] text-brand"
                      onClick={() => onSeleccionarDecision(r.decisionId!)}
                    >
                      Ver decisión <ArrowUpRight className="size-3" aria-hidden />
                    </button>
                  </Tooltip>
                ) : (
                  <Tooltip titulo="Decisión creada" contenido="La IA ha propuesto una decisión a partir de este evento. Búscala en la cola de decisiones.">
                    <span className="ml-auto font-mono text-muted" tabIndex={0}>
                      {r.decisionId}
                    </span>
                  </Tooltip>
                ))}
            </div>
            {r.error && <ErrorInline mensaje={r.error} className="mt-1" />}
          </li>
        ))}
      </ol>
    </div>
  );
}
