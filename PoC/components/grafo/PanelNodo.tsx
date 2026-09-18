"use client";

// Detalle fijo de un vértice (clic en el grafo): qué es, de dónde sale el dato
// (OpenStreetMap), cómo se relaciona y si está bajo el humo o en el dominó.

import { ArrowLeft, ArrowRight, CloudFog, ExternalLink, TriangleAlert, X } from "lucide-react";
import type { AristaGrafo, NodoGrafo } from "@/lib/types";
import { rumboTexto } from "@/components/mapa/geo";
import { Tooltip } from "@/components/ui/Tooltip";
import { MuestraTipo, descripcionTipo, estiloArista, estiloNodo } from "./estilo";
import { formatoDistancia, subtipoLegible, tieneGeo, type FueraDeEscala } from "./geometria";

export interface VecinoPanel {
  arista: AristaGrafo;
  otro?: NodoGrafo;
  enDomino: boolean;
}

export interface EstadoNodoPanel {
  enHumo: boolean;
  humoFuente: "servidor" | "local";
  enDomino: boolean;
  riesgo?: number;
  enRiesgo: boolean;
  conEvidencia: boolean;
  fuera?: FueraDeEscala;
  /** Distancia y rumbo reales desde la incidencia principal. */
  distanciaFocoM?: number;
  rumboFoco?: number;
  esFoco: boolean;
}

const ORIGEN: Record<string, string> = {
  OSM: "OpenStreetMap",
  manual: "Guion del ejercicio",
  periferico: "Periférico (móvil o cámara)",
};

function urlOsm(n: NodoGrafo): string | undefined {
  if (n.osmId && /^(node|way|relation)\/\d+$/.test(n.osmId)) return `https://www.openstreetmap.org/${n.osmId}`;
  if (tieneGeo(n)) return `https://www.openstreetmap.org/?mlat=${n.lat}&mlon=${n.lon}#map=18/${n.lat}/${n.lon}`;
  return undefined;
}

export function PanelNodo({
  nodo,
  estado,
  salientes,
  entrantes,
  onIr,
  onCerrar,
}: {
  nodo: NodoGrafo;
  estado: EstadoNodoPanel;
  salientes: VecinoPanel[];
  entrantes: VecinoPanel[];
  onIr: (id: string) => void;
  onCerrar: () => void;
}) {
  const ui = estiloNodo(nodo.tipo);
  const igual = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
  const legible = subtipoLegible(nodo.subtipo);
  const sub = igual(legible, ui.label) ? undefined : legible;
  const crudo = igual(nodo.subtipo, ui.label) || igual(nodo.subtipo, legible) ? undefined : nodo.subtipo;
  const osm = urlOsm(nodo);
  const { enHumo, humoFuente, enDomino, riesgo, enRiesgo, conEvidencia, fuera, distanciaFocoM, rumboFoco, esFoco } = estado;

  return (
    <aside
      className="absolute right-2 top-2 z-20 flex max-h-[calc(100%-3.75rem)] w-72 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-[10px] border border-panel-border-strong bg-panel text-xs text-foreground"
      style={{ boxShadow: "var(--sombra-flotante)" }}
      aria-label={`Detalle: ${nodo.nombre}`}
      aria-live="polite"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCerrar();
        }
      }}
    >
      <div className="flex items-start gap-2 border-b border-panel-border px-3 py-2">
        <Tooltip titulo={ui.label} contenido={descripcionTipo(nodo.tipo)} lado="izquierda" className="mt-0.5 shrink-0">
          <span className="cursor-help">
            <MuestraTipo tipo={nodo.tipo} tam={14} />
          </span>
        </Tooltip>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-muted">
            {ui.label}
            {(sub || crudo) && (
              <>
                {" · "}
                {sub && <span>{sub} </span>}
                {crudo && <span className="font-mono text-subtle">{crudo}</span>}
              </>
            )}
          </p>
          <p className="text-[13px] font-semibold leading-snug text-foreground">{nodo.nombre}</p>
        </div>
        <Tooltip contenido="Cerrar la ficha y volver a ver el grafo completo." lado="izquierda" className="shrink-0">
          <button
            type="button"
            onClick={onCerrar}
            className="boton boton-fantasma -mr-1 grid size-8 cursor-pointer place-items-center rounded-md !p-0"
            aria-label="Cerrar el detalle del vértice"
          >
            <X className="size-4" aria-hidden />
          </button>
        </Tooltip>
      </div>

      <div className="scroll-thin min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5">
        {nodo.detalle && <p className="leading-snug text-muted">{nodo.detalle}</p>}

        {(enHumo || enDomino || enRiesgo || conEvidencia || fuera) && (
          <div className="flex flex-wrap gap-1">
            {riesgo !== undefined && (
              <Tooltip
                titulo="Riesgo del dominó"
                contenido="Riesgo final estimado (0–100) para esta infraestructura si se cumple la propagación de la decisión seleccionada."
                lado="abajo"
              >
                <span className="pildora pildora-aviso cursor-help font-mono">
                  <TriangleAlert className="size-3" aria-hidden /> Dominó · riesgo {riesgo}
                </span>
              </Tooltip>
            )}
            {enDomino && riesgo === undefined && (
              <Tooltip
                titulo="En una ruta del dominó"
                contenido="Este vértice aparece en alguno de los caminos de propagación calculados desde la incidencia."
                lado="abajo"
              >
                <span className="pildora pildora-aviso cursor-help">
                  <TriangleAlert className="size-3" aria-hidden /> En una ruta del dominó
                </span>
              </Tooltip>
            )}
            {enRiesgo && !enDomino && (
              <Tooltip titulo="En riesgo" contenido="La consulta de dominó lo devolvió como afectado, aunque su ruta no esté resaltada ahora." lado="abajo">
                <span className="pildora pildora-aviso cursor-help">En riesgo</span>
              </Tooltip>
            )}
            {enHumo && (
              <Tooltip
                titulo="Bajo el penacho de humo"
                contenido={
                  humoFuente === "servidor"
                    ? "Cae dentro de la cuña de humo calculada en el servidor sobre lat/lon, en metros: el mismo penacho que el mapa."
                    : "Cae dentro de la cuña de humo calculada aquí con la misma geometría que se dibuja."
                }
                lado="abajo"
              >
                <span className="pildora cursor-help">
                  <CloudFog className="size-3" style={{ color: "var(--humo)" }} aria-hidden /> Bajo el humo
                  <span className="font-normal text-subtle">· {humoFuente === "servidor" ? "servidor" : "cálculo local"}</span>
                </span>
              </Tooltip>
            )}
            {conEvidencia && (
              <Tooltip
                titulo="Dato real"
                contenido="Hay evidencia de campo asociada a este vértice: lectura de sensor, llamada o publicación verificada, no guion del ejercicio."
                lado="abajo"
              >
                <span className="pildora pildora-exito cursor-help">Dato real</span>
              </Tooltip>
            )}
            {fuera && (
              <Tooltip
                titulo="Fuera de escala"
                contenido="Está demasiado lejos para entrar en el encuadre: se dibuja en el borde, en su dirección real, con la distancia al lado."
                lado="abajo"
              >
                <span className="pildora cursor-help">Fuera de escala · {formatoDistancia(fuera.distanciaM)}</span>
              </Tooltip>
            )}
          </div>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {!esFoco && distanciaFocoM !== undefined && (
            <>
              <dt className="text-muted">Al foco</dt>
              <dd className="font-mono">
                {formatoDistancia(distanciaFocoM)}
                {rumboFoco !== undefined && distanciaFocoM > 25 && <span className="text-muted"> · al {rumboTexto(rumboFoco)}</span>}
              </dd>
            </>
          )}
          {tieneGeo(nodo) && (
            <>
              <dt className="text-muted">Coordenadas</dt>
              <dd className="font-mono">
                {nodo.lat.toFixed(5)}, {nodo.lon.toFixed(5)}
              </dd>
            </>
          )}
          <dt className="text-muted">Origen</dt>
          <dd>{(nodo.origen && ORIGEN[nodo.origen]) ?? (nodo.osmId ? "OpenStreetMap" : "Guion del ejercicio")}</dd>
          <dt className="text-muted">Id</dt>
          <dd className="min-w-0">
            <Tooltip
              titulo="Identificador del vértice"
              contenido={<span className="font-mono">{nodo.id}</span>}
              lado="izquierda"
              className="max-w-full"
            >
              <span className="min-w-0 cursor-help truncate font-mono text-subtle">{nodo.id}</span>
            </Tooltip>
          </dd>
        </dl>

        {fuera && (
          <p className="rounded-md bg-panel-2 px-2 py-1 text-[11px] leading-snug text-muted">
            Está a {formatoDistancia(fuera.distanciaM)} al {rumboTexto(fuera.rumbo)} del foco: se dibuja en el borde del encuadre, en su
            dirección real, para no encoger el resto del grafo.
          </p>
        )}

        {osm && (
          <a
            href={osm}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"
          >
            Ver en OpenStreetMap <ExternalLink className="size-3" aria-hidden />
            {nodo.osmId && <span className="font-mono font-normal text-subtle">{nodo.osmId}</span>}
          </a>
        )}

        <ListaVecinos titulo="Salen" vacia="Sin aristas salientes" vecinos={salientes} sentido="sale" onIr={onIr} />
        <ListaVecinos titulo="Llegan" vacia="Sin aristas entrantes" vecinos={entrantes} sentido="llega" onIr={onIr} />
      </div>
    </aside>
  );
}

function ListaVecinos({
  titulo,
  vacia,
  vecinos,
  sentido,
  onIr,
}: {
  titulo: string;
  vacia: string;
  vecinos: VecinoPanel[];
  sentido: "sale" | "llega";
  onIr: (id: string) => void;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-muted">
        {titulo} <span className="font-mono">({vecinos.length})</span>
      </p>
      {vecinos.length === 0 ? (
        <p className="mt-0.5 text-[11px] italic text-muted">{vacia}</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {vecinos.map(({ arista, otro, enDomino }) => {
            const idOtro = sentido === "sale" ? arista.to : arista.from;
            const ea = estiloArista(arista.tipo);
            return (
              <li key={`${arista.from}-${arista.to}-${arista.tipo}`}>
                <button
                  type="button"
                  onClick={() => onIr(idOtro)}
                  disabled={!otro}
                  className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1 text-left transition-colors hover:border-panel-border-strong hover:bg-panel-2 disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent"
                  aria-label={`${arista.tipo} ${sentido === "sale" ? "hacia" : "desde"} ${otro?.nombre ?? idOtro}: ir al vértice`}
                >
                  <Tooltip titulo={`Arista ${arista.tipo}`} contenido={ea.texto} lado="izquierda" className="shrink-0">
                    <span className="font-mono text-[10.5px] font-semibold" style={{ color: enDomino ? "var(--warning)" : ea.stroke }}>
                      {arista.tipo}
                    </span>
                  </Tooltip>
                  {sentido === "sale" ? (
                    <ArrowRight className="size-3 shrink-0 text-subtle" aria-hidden />
                  ) : (
                    <ArrowLeft className="size-3 shrink-0 text-subtle" aria-hidden />
                  )}
                  {otro && <MuestraTipo tipo={otro.tipo} tam={10} />}
                  <span className="min-w-0 flex-1 truncate text-foreground">{otro?.nombre ?? idOtro}</span>
                  {enDomino && <TriangleAlert className="size-3 shrink-0 text-warning" role="img" aria-label="Ruta del dominó" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
