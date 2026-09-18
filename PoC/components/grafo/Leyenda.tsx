"use client";

// Leyenda del grafo: solo los tipos presentes, con su recuento, y las marcas
// dinámicas (dominó, humo, dato real, fuera de escala). Plegable. Cada entrada
// explica qué representa al pasar el ratón o al llegar con el tabulador
// (docs/identidad.md · "todo lo interactivo es informativo").

import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { MuestraTipo, descripcionTipo, estiloArista, estiloNodo } from "./estilo";

/** Entrada de leyenda: muestra + texto, enfocable para que el tooltip se abra con teclado. */
function Entrada({
  titulo,
  ayuda,
  className = "",
  children,
}: {
  titulo: string;
  ayuda: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip titulo={titulo} contenido={ayuda} lado="arriba">
      <span
        tabIndex={0}
        className={`flex cursor-help items-center gap-1 rounded-[6px] px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${className}`}
      >
        {children}
      </span>
    </Tooltip>
  );
}

export function Leyenda({
  tipos,
  aristas,
  abierta,
  onAlternar,
  hayEvidencia,
  fueraDeEscala,
  totalNodos,
  totalAristas,
}: {
  tipos: [string, number][];
  aristas: [string, number][];
  abierta: boolean;
  onAlternar: () => void;
  hayEvidencia: boolean;
  fueraDeEscala: number;
  totalNodos: number;
  totalAristas: number;
}) {
  return (
    <div className="flex items-start gap-3 border-t border-panel-border px-4 py-1.5 text-[11px] text-muted">
      <Tooltip
        contenido={
          abierta ? "Ocultar los tipos de vértice y de arista." : "Mostrar los tipos de vértice y de arista presentes, con su recuento."
        }
        lado="arriba"
      >
        <button type="button" onClick={onAlternar} className="chip shrink-0 cursor-pointer" aria-expanded={abierta}>
          {abierta ? <ChevronDown className="size-3" aria-hidden /> : <ChevronRight className="size-3" aria-hidden />}
          Leyenda
          {!abierta && <span className="font-mono font-normal">{tipos.length}</span>}
        </button>
      </Tooltip>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-0.5 py-0.5">
        {abierta && (
          <>
            {tipos.map(([tipo, n]) => (
              <Entrada
                key={tipo}
                titulo={estiloNodo(tipo).plural}
                ayuda={
                  <>
                    {descripcionTipo(tipo)}{" "}
                    <span className="block opacity-80">
                      {n} {n === 1 ? "vértice" : "vértices"} de este tipo en el grafo. Cada familia tiene forma propia además de color.
                    </span>
                  </>
                }
              >
                <MuestraTipo tipo={tipo} />
                {estiloNodo(tipo).plural}
                <span className="font-mono text-foreground/80">{n}</span>
              </Entrada>
            ))}
            <span className="h-3 w-px bg-panel-border" aria-hidden />
            {aristas.map(([tipo, n]) => {
              const ea = estiloArista(tipo);
              return (
                <Entrada key={tipo} titulo={`Arista ${tipo}`} ayuda={ea.texto}>
                  <span className="inline-block h-0.5 w-3 rounded" style={{ background: ea.stroke, opacity: Math.max(0.55, ea.opacidad) }} />
                  <span className="font-mono">{tipo}</span>
                  <span className="font-mono text-foreground/80">{n}</span>
                </Entrada>
              );
            })}
            <span className="h-3 w-px bg-panel-border" aria-hidden />
          </>
        )}
        <Entrada
          titulo="Ruta del dominó"
          ayuda="Tramo por el que se propagaría el efecto de la decisión seleccionada, desde la incidencia hasta la infraestructura afectada."
        >
          <span className="inline-block h-1 w-3 rounded bg-warning" aria-hidden /> Ruta dominó
        </Entrada>
        <Entrada
          titulo="Riesgo del dominó"
          ayuda="Riesgo final estimado para ese vértice, de 0 a 100. A partir de 50 se muestra en aviso y a partir de 75 en peligro."
        >
          <span className="pildora pildora-aviso !px-1.5 font-mono !leading-3" aria-hidden>
            50
          </span>{" "}
          Riesgo
        </Entrada>
        <Entrada
          titulo="Bajo el penacho de humo"
          ayuda="El vértice cae dentro de la cuña de humo calculada con el viento actual: evacuación, filtrado de aire o corte de acceso."
        >
          <span
            className="inline-block size-2.5 rounded-full border border-dashed"
            style={{ borderColor: "var(--humo)", background: "color-mix(in srgb, var(--humo) 20%, transparent)" }}
            aria-hidden
          />
          Bajo el humo
        </Entrada>
        {hayEvidencia && (
          <Entrada
            titulo="Dato real"
            ayuda="Hay evidencia de campo que respalda a ese vértice: una lectura de sensor, una llamada o una publicación verificada."
          >
            <span className="inline-block size-2 rounded-full bg-success" aria-hidden /> Dato real
          </Entrada>
        )}
        {fueraDeEscala > 0 && (
          <Entrada
            titulo="Fuera de escala"
            ayuda="Vértices demasiado lejos para entrar en el encuadre sin encoger el resto: se dibujan en el borde, en su dirección real, con la distancia al lado."
          >
            <span className="inline-block size-2.5 rounded-full border border-dashed border-muted" aria-hidden /> Fuera de escala
            <span className="font-mono text-foreground/80">{fueraDeEscala}</span>
          </Entrada>
        )}
      </div>
      <Tooltip
        titulo="Tamaño del grafo"
        contenido="Vértices y aristas cargados ahora mismo, incluidos los que quedan fuera del encuadre."
        lado="arriba"
        className="shrink-0 max-xl:hidden"
      >
        <span className="cursor-help whitespace-nowrap py-0.5 font-mono text-subtle">
          {totalNodos} vértices · {totalAristas} aristas
        </span>
      </Tooltip>
    </div>
  );
}
