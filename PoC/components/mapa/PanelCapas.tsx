"use client";

// Panel superpuesto del mapa de la consola: botón "Capas" plegable, "Encuadrar",
// aviso discreto de OSM y, desplegado, dos pestañas: Capas (interruptores con su
// número de elementos) y Leyenda (solo de las capas visibles).
//
// Identidad v2 (docs/identidad.md): botones .boton-secundario .boton-sm, pestañas
// .chip, avisos .pildora-aviso y nada de `title=`: todo lo que explica algo va en
// un <Tooltip> (se abre con ratón y con el tabulador, se cierra con Escape).

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, Crosshair, Layers, Loader2, RotateCw, TriangleAlert } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import type { Simbolo } from "./simbologia";

export type Capa =
  | "grafo"
  | "efectivos"
  | "humo"
  | "rutas"
  | "eventos"
  | "perifericos"
  | "trafico"
  | "camaras"
  | "osm"
  | "vias";

export interface FilaCapa {
  id: Capa;
  etiqueta: string;
  /** null: cargando. */
  cuenta: number | null;
  activa: boolean;
  disponible: boolean;
  /** Explicación del tooltip: qué muestra o de dónde vendrán los datos si aún no hay. */
  ayuda: string;
  /** Línea corta bajo el nombre ("Overpass · 21:45", "sin coordenadas aún"). */
  nota?: string;
}

export interface AvisoMapa {
  texto: string;
  detalle?: string;
  onReintentar?: () => void;
  reintentando?: boolean;
}

interface Props {
  filas: FilaCapa[];
  leyendas: Partial<Record<Capa, ReactNode>>;
  abierto: boolean;
  onAlternarPanel: () => void;
  onAlternarCapa: (id: Capa) => void;
  onEncuadrar: () => void;
  aviso?: AvisoMapa | null;
}

/** Botón flotante sobre el mapa: secundario pequeño, translúcido para no tapar las calles. */
const BOTON = "boton boton-secundario boton-sm cursor-pointer bg-panel/95 shadow-sm backdrop-blur";

/** "12 elementos cargados · Overpass · 21:45": qué hay en la capa y de dónde salió. */
function detalleCuenta(f: FilaCapa) {
  if (f.cuenta === null) return "Cargando datos de OpenStreetMap…";
  const n = `${f.cuenta} ${f.cuenta === 1 ? "elemento cargado" : "elementos cargados"}`;
  return f.nota ? `${n} · ${f.nota}` : n;
}

export function PanelCapas({ filas, leyendas, abierto, onAlternarPanel, onAlternarCapa, onEncuadrar, aviso }: Props) {
  const [pestana, setPestana] = useState<"capas" | "leyenda">("capas");
  const idPestanas = useId();
  const activas = filas.filter((f) => f.activa && f.disponible);
  const conLeyenda = activas.filter((f) => leyendas[f.id]);

  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-[1000] flex max-h-[calc(100%-4.25rem)] flex-col items-start gap-1.5">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5">
        <Tooltip
          titulo={abierto ? "Ocultar el panel de capas" : "Capas del mapa"}
          contenido={`Qué se pinta sobre las calles reales: grafo, efectivos, humo, rutas, avisos y entorno de OpenStreetMap. ${activas.length} de ${filas.length} capas activas.`}
          lado="abajo"
        >
          <button type="button" onClick={onAlternarPanel} aria-expanded={abierto} aria-controls="panel-capas-mapa" className={BOTON}>
            <Layers className="size-3.5 text-brand" aria-hidden /> Capas
            <span className="font-mono text-[10.5px] font-normal text-muted">
              {activas.length}/{filas.length}
            </span>
            <ChevronDown className={`size-3.5 text-muted transition ${abierto ? "rotate-180" : ""}`} aria-hidden />
          </button>
        </Tooltip>
        <Tooltip
          titulo="Encuadrar el incidente"
          contenido="Vuelve a ajustar el mapa al foco, el penacho de humo, el grafo, las rutas y el dominó (lo que esté a menos de 5 km)."
          lado="abajo"
        >
          <button type="button" onClick={onEncuadrar} className={BOTON}>
            <Crosshair className="size-3.5 text-brand" aria-hidden /> Encuadrar
          </button>
        </Tooltip>
        {aviso && (
          <>
            <Tooltip titulo="Entorno de OpenStreetMap" contenido={aviso.detalle || aviso.texto} lado="abajo" className="max-w-full">
              {/* Fondo de panel debajo del tinte del aviso: sobre las teselas no se lee un tinte translúcido. */}
              <span className="inline-flex max-w-full rounded-full bg-panel/95 shadow-sm backdrop-blur">
                <span role="status" className="pildora pildora-aviso max-w-full">
                  <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                  <span className="max-w-[24rem] truncate">{aviso.texto}</span>
                </span>
              </span>
            </Tooltip>
            {aviso.onReintentar && (
              <Tooltip
                titulo="Reintentar"
                contenido="Vuelve a pedir el entorno real a Overpass (OpenStreetMap). El resto del mapa sigue funcionando mientras tanto."
                lado="abajo"
              >
                <button type="button" onClick={aviso.onReintentar} disabled={aviso.reintentando} className={BOTON}>
                  <RotateCw className={`size-3 text-brand ${aviso.reintentando ? "animate-spin" : ""}`} aria-hidden />
                  {aviso.reintentando ? "Reintentando…" : "Reintentar"}
                </button>
              </Tooltip>
            )}
          </>
        )}
      </div>

      {abierto && (
        <div
          id="panel-capas-mapa"
          className="pointer-events-auto flex min-h-0 w-[16.5rem] max-w-full flex-col overflow-hidden rounded-xl border border-panel-border bg-panel/95 shadow-[var(--sombra-flotante)] backdrop-blur"
        >
          <div className="flex shrink-0 gap-1 border-b border-panel-border p-1.5" role="tablist" aria-label="Panel del mapa">
            {(
              [
                ["capas", "Capas"],
                ["leyenda", "Leyenda"],
              ] as const
            ).map(([id, texto]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`${idPestanas}-${id}`}
                aria-selected={pestana === id}
                aria-controls={`${idPestanas}-panel`}
                onClick={() => setPestana(id)}
                className="chip min-h-8 flex-1 cursor-pointer justify-center"
              >
                {texto}
              </button>
            ))}
          </div>

          <div
            id={`${idPestanas}-panel`}
            role="tabpanel"
            aria-labelledby={`${idPestanas}-${pestana}`}
            className="min-h-0 overflow-y-auto p-1"
          >
            {pestana === "capas" ? (
              <ul className="flex flex-col" aria-label="Capas del mapa">
                {filas.map((f) => (
                  <li key={f.id}>
                    <Tooltip
                      titulo={f.etiqueta}
                      contenido={
                        <>
                          {f.ayuda}
                          <span className="mt-1 block font-mono text-[11px] text-subtle">{detalleCuenta(f)}</span>
                        </>
                      }
                      lado="derecha"
                      className="w-full"
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={f.activa && f.disponible}
                        aria-disabled={!f.disponible}
                        data-capa={f.id}
                        onClick={() => f.disponible && onAlternarCapa(f.id)}
                        className={`group flex min-h-8 w-full items-start gap-2 rounded-lg px-1.5 py-1.5 text-left transition ${
                          f.disponible ? "cursor-pointer hover:bg-panel-2" : "cursor-not-allowed opacity-55"
                        }`}
                      >
                        <span
                          className={`mt-[2px] flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border transition ${
                            f.activa && f.disponible
                              ? "border-brand bg-brand"
                              : "border-panel-border-strong bg-panel group-hover:border-brand"
                          }`}
                          aria-hidden
                        >
                          {f.activa && f.disponible && (
                            <svg viewBox="0 0 12 12" className="size-2.5 text-panel">
                              <path d="M2.5 6.2 5 8.6l4.6-5.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] leading-4 text-foreground">
                            <span className="font-medium">{f.etiqueta}</span>{" "}
                            {f.cuenta === null ? (
                              <Loader2 className="inline size-3 animate-spin text-muted" aria-label="cargando" />
                            ) : (
                              <span className="font-mono text-[11px] text-muted">· {f.cuenta}</span>
                            )}
                          </span>
                          {f.nota && <span className="block truncate text-[10.5px] leading-4 text-subtle">{f.nota}</span>}
                        </span>
                      </button>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            ) : conLeyenda.length ? (
              <div className="flex flex-col gap-2 px-1.5 py-1">
                {conLeyenda.map((f) => (
                  <section key={f.id}>
                    <h4 className="etiqueta mb-0.5">{f.etiqueta}</h4>
                    {leyendas[f.id]}
                  </section>
                ))}
              </div>
            ) : (
              <p className="px-1.5 py-2 text-[11px] text-muted">Activa alguna capa con datos para ver su leyenda.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- piezas de leyenda

export function ListaLeyenda({ children, pie }: { children: ReactNode; pie?: ReactNode }) {
  return (
    <div>
      <ul className="flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] leading-4 text-muted">{children}</ul>
      {pie && <p className="mt-1 text-[10.5px] leading-4 text-subtle">{pie}</p>}
    </div>
  );
}

/**
 * Entrada de leyenda: muestra + texto. Con `ayuda`, la entrada es enfocable y
 * explica el símbolo al pasar el ratón o al llegar con el tabulador (misma
 * receta que la leyenda del grafo).
 */
export function ItemLeyenda({
  muestra,
  titulo,
  ayuda,
  children,
}: {
  muestra: ReactNode;
  titulo?: string;
  ayuda?: ReactNode;
  children: ReactNode;
}) {
  const contenido = (
    <>
      {muestra}
      <span>{children}</span>
    </>
  );
  return (
    <li className="flex items-center">
      {ayuda ? (
        <Tooltip titulo={titulo} contenido={ayuda} lado="arriba">
          <span
            tabIndex={0}
            className="flex cursor-help items-center gap-1 rounded-[6px] px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {contenido}
          </span>
        </Tooltip>
      ) : (
        <span className="flex items-center gap-1">{contenido}</span>
      )}
    </li>
  );
}

export function MuestraInsignia({ simbolo, grande, grafo, humo }: { simbolo: Simbolo; grande?: boolean; grafo?: boolean; humo?: boolean }) {
  return (
    <span
      className="atalaya-insignia"
      data-estatica=""
      data-grande={grande ? "" : undefined}
      data-grafo={grafo ? "" : undefined}
      data-humo={humo ? "" : undefined}
      style={{ "--c": simbolo.color } as CSSProperties}
      aria-hidden
    >
      {simbolo.glifo}
    </span>
  );
}

export function MuestraPunto({ color, hueco }: { color: string; hueco?: boolean }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full border-2"
      style={{ borderColor: color, background: hueco ? "transparent" : color }}
      aria-hidden
    />
  );
}

export function MuestraLinea({ color, discontinua, grosor = 2 }: { color: string; discontinua?: string; grosor?: number }) {
  return (
    <svg viewBox="0 0 18 6" className="h-1.5 w-[18px] shrink-0 overflow-visible" aria-hidden>
      <line x1="1" y1="3" x2="17" y2="3" stroke={color} strokeWidth={grosor} strokeDasharray={discontinua} strokeLinecap="round" />
    </svg>
  );
}

export function MuestraAbanico() {
  return (
    <svg viewBox="0 0 18 12" className="h-3 w-[18px] shrink-0" aria-hidden>
      <path d="M1 6 L17 1 A 9 9 0 0 1 17 11 Z" fill="var(--humo)" fillOpacity="0.45" stroke="var(--humo-nucleo)" strokeWidth="0.8" strokeDasharray="2 1.5" />
    </svg>
  );
}

export function MuestraCuadro({ color }: { color: string }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-[2px] border border-panel" style={{ background: color }} aria-hidden />;
}
