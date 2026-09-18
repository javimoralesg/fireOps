"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Database, ExternalLink } from "lucide-react";
import type { Evidencia } from "@/lib/tipos-sistema";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { formatearHora, fuenteUI } from "./ui";

/** A partir de cuántos caracteres la descripción se recorta y se puede desplegar. */
const LARGO_RECORTE = 150;

const VISIBLES_POR_DEFECTO = 5;

/** "¿En qué se basa?": los datos reales que la IA usó para proponer, con su fuente, hora y confianza. */
export function PanelEvidencia({ evidencia }: { evidencia: Evidencia[] }) {
  const [verTodas, setVerTodas] = useState(false);
  const [filtro, setFiltro] = useState<string | null>(null);

  const porFuente = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of evidencia) m.set(e.fuente, (m.get(e.fuente) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [evidencia]);

  const ordenadas = useMemo(
    () => [...evidencia].sort((a, b) => (b.confianza ?? 0) - (a.confianza ?? 0)),
    [evidencia],
  );

  const filtradas = filtro ? ordenadas.filter((e) => e.fuente === filtro) : ordenadas;
  const visibles = filtro || verTodas ? filtradas : filtradas.slice(0, VISIBLES_POR_DEFECTO);
  const ocultas = filtradas.length - visibles.length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <Database className="size-4 text-brand" aria-hidden /> ¿En qué se basa?
          <Ayuda
            titulo="Evidencia de la propuesta"
            texto="Los datos concretos que la IA usó para proponer esto, cada uno con su fuente, su hora y la confianza que le da el verificador. Si algo no cuadra, aquí se ve."
          />
        </h4>
        <span className="text-[11px] text-muted">
          <span className="font-mono text-foreground">{evidencia.length}</span> {evidencia.length === 1 ? "dato" : "datos"} ·{" "}
          <span className="font-mono text-foreground">{porFuente.length}</span> {porFuente.length === 1 ? "fuente" : "fuentes"}
        </span>
      </div>

      {evidencia.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-warning/40 bg-warning/8 px-3 py-2 text-xs text-warning">
          La propuesta no aporta evidencia. Desconfía y pide más datos antes de firmar.
        </p>
      ) : (
        <>
          {porFuente.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {porFuente.map(([fuente, n]) => {
                const { etiqueta, icono: Icono } = fuenteUI(fuente);
                const activa = filtro === fuente;
                return (
                  <Tooltip
                    key={fuente}
                    contenido={
                      activa
                        ? `Quitar el filtro y volver a ver los ${evidencia.length} datos.`
                        : `Ver solo ${etiqueta}: ${n} ${n === 1 ? "dato" : "datos"} de esta fuente.`
                    }
                  >
                    <button
                      type="button"
                      onClick={() => setFiltro(activa ? null : fuente)}
                      aria-pressed={activa}
                      aria-label={activa ? `Quitar filtro ${etiqueta}` : `Ver solo ${etiqueta}`}
                      className="chip"
                    >
                      <Icono className="size-3" aria-hidden />
                      {etiqueta}
                      <span className="font-mono">{n}</span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          )}

          <ul className="space-y-1.5">
            {visibles.map((e) => (
              <FilaEvidencia key={e.id} e={e} />
            ))}
          </ul>

          {!filtro && filtradas.length > VISIBLES_POR_DEFECTO && (
            <button
              type="button"
              onClick={() => setVerTodas((v) => !v)}
              aria-expanded={verTodas}
              className="boton boton-fantasma boton-sm mt-1.5 w-full"
            >
              <ChevronDown className={`size-3.5 transition-transform ${verTodas ? "rotate-180" : ""}`} aria-hidden />
              {verTodas ? "Ver solo las más fiables" : `Ver todas (${evidencia.length}) · ${ocultas} más`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function colorConfianza(c: number) {
  if (c >= 0.8) return "bg-success";
  if (c >= 0.5) return "bg-warning";
  return "bg-danger";
}

function formatearValor(v: string | number): string {
  return typeof v === "number" ? v.toLocaleString("es-ES", { maximumFractionDigits: 2 }) : v;
}

function FilaEvidencia({ e }: { e: Evidencia }) {
  const { etiqueta, icono: Icono } = fuenteUI(e.fuente);
  const conf = Math.max(0, Math.min(1, e.confianza ?? 0));
  const guion = e.fuente === "Escenario";
  // Si el "valor" es solo la confianza del evento, ya lo muestra la barra.
  const mostrarValor = e.valor !== undefined && e.valor !== "" && e.unidad !== "confianza";
  // Las descripciones largas se recortan a tres líneas y se despliegan al pulsar.
  const recortable = (e.descripcion ?? "").length > LARGO_RECORTE;
  const [desplegada, setDesplegada] = useState(false);

  return (
    <li
      className={`flex gap-2.5 rounded-[10px] border px-2.5 py-2 ${
        guion ? "border-warning/30 bg-warning/8" : "border-panel-border bg-panel-2"
      }`}
    >
      <Tooltip titulo={etiqueta} contenido="Fuente de la que salió este dato." className="mt-0.5 shrink-0">
        <span
          className={`flex size-6 items-center justify-center rounded-md ${guion ? "bg-warning/15 text-warning" : "bg-brand/10 text-brand"}`}
        >
          <Icono className="size-3.5" aria-hidden />
        </span>
      </Tooltip>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          {recortable ? (
            <button
              type="button"
              onClick={() => setDesplegada((v) => !v)}
              aria-expanded={desplegada}
              className={`min-w-0 flex-1 cursor-pointer text-left text-xs leading-snug text-foreground transition hover:text-brand ${desplegada ? "" : "line-clamp-3"}`}
            >
              {e.descripcion}
              <span className="ml-1 whitespace-nowrap font-medium text-brand">
                {desplegada ? "ver menos" : "ver más"}
              </span>
            </button>
          ) : (
            <p className="min-w-0 flex-1 text-xs leading-snug text-foreground">{e.descripcion}</p>
          )}
          {mostrarValor && (
            <span className="max-w-[40%] shrink-0 text-right font-mono text-sm font-semibold leading-tight text-foreground">
              <span className="break-words">{formatearValor(e.valor)}</span>
              {e.unidad && <span className="block text-[11px] font-normal text-subtle">{e.unidad}</span>}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
          <span className="font-semibold text-muted">{etiqueta}</span>
          {guion && (
            <Tooltip
              titulo="Dato de guion"
              contenido="Dato forzado por el guion de la demo para provocar el giro del escenario; el resto son APIs reales."
            >
              <span className="pildora pildora-aviso">dato de guion</span>
            </Tooltip>
          )}
          <Tooltip contenido="Hora a la que se captó el dato en su fuente.">
            <span className="font-mono text-subtle">{formatearHora(e.timestamp)}</span>
          </Tooltip>
          <Tooltip
            titulo={`Confianza ${Math.round(conf * 100)} %`}
            contenido="Fiabilidad que el verificador asigna al dato. Por debajo del 50 % se pinta en rojo: contrástalo antes de firmar."
          >
            <span className="flex items-center gap-1">
              <span className="h-1 w-10 overflow-hidden rounded-sm bg-panel-border">
                <span className={`block h-full ${colorConfianza(conf)}`} style={{ width: `${conf * 100}%` }} />
              </span>
              <span className="font-mono">{Math.round(conf * 100)} %</span>
            </span>
          </Tooltip>
          {e.url && (
            <a
              href={e.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-0.5 font-medium text-brand hover:underline"
            >
              ver dato original <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </div>
      </div>
    </li>
  );
}
