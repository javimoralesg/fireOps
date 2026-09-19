"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Bot,
  BrainCircuit,
  CirclePause,
  ExternalLink,
  Flame,
  RadioTower,
  ShieldCheck,
  UserRoundCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Snapshot, TrazaCiclo } from "@/lib/dominio/tipos";
import { duracion, fechaHora, horaSegundos, recortar } from "@/lib/cliente/formato";
import { Insignia, type TonoInsignia } from "@/components/ui/Insignia";
import { Vacio } from "@/components/ui/Vacio";
import { TEXTO_CATEGORIA, TEXTO_ESTADO_AGENTE } from "@/components/sala/TarjetaAgente";
import {
  construirGrafo,
  trazasDeAgenteEnIncendio,
  TITULOS_COLUMNA,
  type AristaFlujo,
  type GrafoFlujo,
  type HitoArista,
  type NodoFlujo,
  type TipoNodo,
} from "@/components/incidencia/grafoFlujo";

interface FlujoOperacionProps {
  snapshot?: Snapshot;
  incendioId: string;
}

const ICONO_NODO: Record<TipoNodo, LucideIcon> = {
  agente: Bot,
  incendio: Flame,
  humano: UserRoundCheck,
  autonomo: BrainCircuit,
  unidad: ShieldCheck,
  poblaciones: RadioTower,
  canal: ExternalLink,
  motor: Activity,
};

const TEXTO_TIPO: Record<TipoNodo, string> = {
  agente: "Agente Atalaya",
  incendio: "Incidencia",
  humano: "Mando humano",
  autonomo: "Decisión autónoma",
  unidad: "Destino operativo",
  poblaciones: "Población",
  canal: "Canal externo",
  motor: "Motor de ejecución",
};

const TONO_BORDE: Record<NodoFlujo["tono"], string> = {
  marca: "border-brand/45",
  fuego: "border-fuego/50",
  info: "border-info/45",
  exito: "border-success/45",
  aviso: "border-warning/50",
  peligro: "border-danger/50",
  neutro: "border-panel-border",
};

function tonoInsignia(nodo: NodoFlujo): TonoInsignia {
  return nodo.tono;
}

function sumaContadores(nodo: NodoFlujo): number {
  return nodo.contadores.reduce((total, contador) => total + contador.valor, 0);
}

/**
 * El grafo compartido incluye también los agentes callados y algunos posibles
 * destinos. Esta vista operativa conserva únicamente actores con evidencia en
 * la incidencia: un traspaso, contadores propios o actividad atribuida.
 */
function recortarAGrafoOperativo(grafo: GrafoFlujo): GrafoFlujo {
  const conectados = new Set(grafo.aristas.flatMap((arista) => [arista.origen, arista.destino]));
  const nodos = grafo.nodos.filter((nodo) => {
    if (nodo.tipo === "incendio") return true;
    if (conectados.has(nodo.id)) return true;
    if (nodo.tipo === "agente") return nodo.activo || sumaContadores(nodo) > 0;
    return false;
  });
  const ids = new Set(nodos.map((nodo) => nodo.id));
  return {
    nodos,
    aristas: grafo.aristas.filter((arista) => ids.has(arista.origen) && ids.has(arista.destino)),
  };
}

function ultimaSenal(nodo: NodoFlujo, aristas: AristaFlujo[]): number | undefined {
  const momentos = aristas
    .filter((arista) => arista.origen === nodo.id || arista.destino === nodo.id)
    .flatMap((arista) => arista.momentos)
    .filter(Number.isFinite);
  return momentos.length ? Math.max(...momentos) : undefined;
}

function nombreNodo(grafo: GrafoFlujo, id: string): string {
  return grafo.nodos.find((nodo) => nodo.id === id)?.etiqueta ?? id;
}

function ultimaTrazaTerminada(trazas: TrazaCiclo[]): TrazaCiclo | undefined {
  return trazas.find((traza) => traza.estado !== "en_curso") ?? trazas[0];
}

export function FlujoOperacion({ snapshot, incendioId }: FlujoOperacionProps) {
  const [seleccionSolicitada, setSeleccionSolicitada] = useState<string | null>("incendio");
  const incendio = snapshot?.incendios.find((item) => item.id === incendioId);
  const mundoPausado = Boolean(snapshot?.reloj.pausado);
  const grafo = useMemo(() => recortarAGrafoOperativo(construirGrafo(snapshot, incendioId)), [snapshot, incendioId]);
  const seleccion =
    (seleccionSolicitada ? grafo.nodos.find((nodo) => nodo.id === seleccionSolicitada) : undefined) ??
    grafo.nodos.find((nodo) => nodo.id === "incendio") ??
    grafo.nodos[0];
  const etapas = TITULOS_COLUMNA.map((titulo, columna) => ({
    titulo,
    columna,
    nodos: grafo.nodos
      .filter((nodo) => nodo.columna === columna)
      .sort((a, b) => a.orden - b.orden || a.etiqueta.localeCompare(b.etiqueta)),
  })).filter((etapa) => etapa.nodos.length > 0);
  const agentes = grafo.nodos.filter((nodo) => nodo.tipo === "agente");
  const canales = grafo.nodos.filter((nodo) => nodo.tipo === "canal");
  const fallos = grafo.aristas.filter((arista) => arista.exito === false).length;

  if (!snapshot) {
    return <Vacio icono={<Activity />} titulo="Cargando el flujo operativo…" guia="La cadena aparecerá cuando llegue el estado de la ejecución." />;
  }

  if (!incendio) {
    return (
      <Vacio
        icono={<Flame />}
        titulo="Incidencia no disponible"
        guia="Selecciona una incidencia presente en esta ejecución para consultar su cadena operativa."
      />
    );
  }

  return (
    <section aria-labelledby="titulo-flujo-operacion" className="min-w-0">
      <header className="flex flex-wrap items-start gap-2 border-b border-panel-border pb-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-subtle">Flujo por incidencia</p>
          <h2 id="titulo-flujo-operacion" className="mt-0.5 text-base font-semibold leading-tight text-foreground">
            {incendio.nombre}
          </h2>
          <p className="mt-1 text-[12px] leading-snug text-muted">
            Solo actores y traspasos respaldados por el estado actual de la ejecución.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5" aria-label="Resumen del flujo">
          <Insignia pequena tono="marca">{agentes.length} agentes</Insignia>
          <Insignia pequena tono="neutro">{grafo.aristas.length} traspasos</Insignia>
          {canales.length ? <Insignia pequena tono="info">{canales.length} canales externos</Insignia> : null}
          {fallos ? <Insignia pequena tono="peligro">{fallos} con fallos</Insignia> : null}
        </div>
      </header>

      {mundoPausado ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2 text-warning" role="status">
          <CirclePause className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="text-[12.5px] font-semibold">Mundo en pausa</p>
            <p className="text-[11.5px] leading-snug">
              Esta es la última cadena registrada. Ningún agente está trabajando ni se están produciendo nuevos traspasos.
            </p>
          </div>
        </div>
      ) : null}

      {grafo.aristas.length === 0 && agentes.length === 0 ? (
        <Vacio
          className="mt-3"
          icono={<Activity />}
          titulo="Todavía no hay intervención registrada"
          guia="La incidencia existe, pero el Snapshot aún no contiene participantes ni traspasos atribuibles a ella."
        />
      ) : (
        <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            <div className="scroll-fino overflow-x-auto pb-2">
              <ol
                className="grid min-w-[52rem] gap-2 lg:min-w-0"
                style={{ gridTemplateColumns: `repeat(${etapas.length}, minmax(9.5rem, 1fr))` }}
                aria-label="Etapas del flujo operativo"
              >
                {etapas.map((etapa, indice) => (
                  <li key={etapa.columna} className="relative min-w-0">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="tabular flex size-5 shrink-0 items-center justify-center rounded-full border border-panel-border-strong bg-panel-2 text-[10px] font-semibold text-muted">
                        {indice + 1}
                      </span>
                      <h3 className="text-[10.5px] font-semibold uppercase tracking-wide text-subtle">{etapa.titulo}</h3>
                      {indice < etapas.length - 1 ? <ArrowRight className="ml-auto size-3.5 text-panel-border-strong" aria-hidden /> : null}
                    </div>
                    <ul className="space-y-2">
                      {etapa.nodos.map((nodo) => {
                        const Icono = ICONO_NODO[nodo.tipo];
                        const estaSeleccionado = seleccion?.id === nodo.id;
                        const aristasNodo = grafo.aristas.filter((arista) => arista.origen === nodo.id || arista.destino === nodo.id);
                        const ultima = ultimaSenal(nodo, aristasNodo);
                        const estado = mundoPausado
                          ? "Último estado registrado"
                          : nodo.tipo === "agente"
                            ? nodo.activo
                              ? "Interviniendo"
                              : "Intervención anterior"
                            : nodo.activo
                              ? "En la cadena"
                              : "Registro anterior";
                        return (
                          <li key={nodo.id}>
                            <button
                              type="button"
                              onClick={() => setSeleccionSolicitada(nodo.id)}
                              aria-pressed={estaSeleccionado}
                              className={`group w-full rounded-xl border bg-panel p-2.5 text-left shadow-[var(--sombra-panel)] transition-colors hover:border-brand/60 hover:bg-panel-2 ${
                                estaSeleccionado ? "border-brand ring-1 ring-brand/30" : TONO_BORDE[nodo.tono]
                              }`}
                            >
                              <span className="flex items-start gap-2">
                                <span className={`mt-0.5 rounded-lg border p-1.5 ${TONO_BORDE[nodo.tono]} bg-panel-2 text-muted`} aria-hidden>
                                  <Icono className="size-3.5" />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[12.5px] font-semibold text-foreground">{nodo.etiqueta}</span>
                                  <span className="mt-0.5 block text-[10.5px] font-medium text-subtle">{TEXTO_TIPO[nodo.tipo]}</span>
                                </span>
                              </span>
                              {mundoPausado && nodo.tipo === "agente" ? (
                                <span className="mt-2 block text-[11px] leading-snug text-muted">Sin actividad en curso · se conserva su último estado.</span>
                              ) : nodo.sub ? (
                                <span className="mt-2 block line-clamp-2 text-[11px] leading-snug text-muted">{nodo.sub}</span>
                              ) : null}
                              <span className="mt-2 flex flex-wrap items-center gap-1">
                                <Insignia pequena tono={mundoPausado ? "aviso" : tonoInsignia(nodo)} punto={!mundoPausado && nodo.activo}>
                                  {estado}
                                </Insignia>
                                {aristasNodo.length ? <span className="tabular text-[10px] text-subtle">{aristasNodo.length} enlaces</span> : null}
                                {ultima ? <span className="tabular ml-auto text-[10px] text-subtle">{horaSegundos(new Date(ultima).toISOString())}</span> : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ol>
            </div>

            {grafo.aristas.length ? <ListaTraspasos grafo={grafo} seleccionId={seleccion?.id} mundoPausado={mundoPausado} /> : null}
          </div>

          {seleccion ? (
            <DetalleNodo nodo={seleccion} grafo={grafo} snapshot={snapshot} incendioId={incendioId} mundoPausado={mundoPausado} onCerrar={() => setSeleccionSolicitada(null)} />
          ) : null}
        </div>
      )}
    </section>
  );
}

function ListaTraspasos({ grafo, seleccionId, mundoPausado }: { grafo: GrafoFlujo; seleccionId?: string; mundoPausado: boolean }) {
  const aristas = [...grafo.aristas].sort((a, b) => Math.max(...b.momentos, 0) - Math.max(...a.momentos, 0));

  return (
    <section className="mt-3 border-t border-panel-border pt-3" aria-labelledby="titulo-traspasos">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 id="titulo-traspasos" className="text-[12px] font-semibold text-foreground">Traspasos reales</h3>
        <p className="text-[11px] text-subtle">Ordenados por la señal más reciente</p>
      </div>
      <ol className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {aristas.map((arista) => {
          const destacada = Boolean(seleccionId && (arista.origen === seleccionId || arista.destino === seleccionId));
          const ultima = arista.hitos[arista.hitos.length - 1];
          return (
            <li
              key={arista.id}
              className={`rounded-lg border px-2.5 py-2 ${destacada ? "border-brand/55 bg-brand/[0.06]" : "border-panel-border bg-panel-2"}`}
            >
              <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-foreground">
                <span className="truncate">{nombreNodo(grafo, arista.origen)}</span>
                <ArrowRight className="size-3 shrink-0 text-subtle" aria-hidden />
                <span className="truncate">{nombreNodo(grafo, arista.destino)}</span>
                {arista.cuenta > 1 ? <span className="tabular ml-auto shrink-0 text-[10px] text-subtle">×{arista.cuenta}</span> : null}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-muted">
                {arista.etiqueta ? <span className="truncate">{arista.etiqueta}</span> : <span>Traspaso</span>}
                {arista.exito === false ? <span className="shrink-0 font-medium text-danger">Falló</span> : null}
                {arista.exito === true ? <span className="shrink-0 font-medium text-success">Confirmado</span> : null}
                {ultima ? <time className="tabular ml-auto shrink-0" dateTime={ultima.en}>{fechaHora(ultima.en)}</time> : null}
              </div>
              {mundoPausado ? <span className="mt-1 block text-[10px] text-warning">Histórico · mundo en pausa</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function DetalleNodo({
  nodo,
  grafo,
  snapshot,
  incendioId,
  mundoPausado,
  onCerrar,
}: {
  nodo: NodoFlujo;
  grafo: GrafoFlujo;
  snapshot: Snapshot;
  incendioId: string;
  mundoPausado: boolean;
  onCerrar: () => void;
}) {
  const Icono = ICONO_NODO[nodo.tipo];
  const ficha = nodo.agenteId ? snapshot.agentes.find((agente) => agente.id === nodo.agenteId) : undefined;
  const trazas = nodo.agenteId ? trazasDeAgenteEnIncendio(snapshot, nodo.agenteId, incendioId) : [];
  const traza = mundoPausado ? ultimaTrazaTerminada(trazas) : trazas[0];
  const conexiones = grafo.aristas
    .filter((arista) => arista.origen === nodo.id || arista.destino === nodo.id)
    .sort((a, b) => Math.max(...b.momentos, 0) - Math.max(...a.momentos, 0));
  const ultimoHito = conexiones
    .flatMap((arista) => arista.hitos)
    .sort((a, b) => b.en.localeCompare(a.en))[0];

  return (
    <aside className="self-start rounded-xl border border-panel-border bg-panel p-3 shadow-[var(--sombra-panel)] xl:sticky xl:top-3" aria-labelledby="titulo-detalle-nodo">
      <header className="flex items-start gap-2">
        <span className={`rounded-lg border p-1.5 ${TONO_BORDE[nodo.tono]} bg-panel-2 text-muted`} aria-hidden>
          <Icono className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-subtle">{TEXTO_TIPO[nodo.tipo]}</p>
          <h3 id="titulo-detalle-nodo" className="truncate text-[14px] font-semibold text-foreground">{nodo.etiqueta}</h3>
        </div>
        <button type="button" onClick={onCerrar} className="rounded-md p-1 text-subtle hover:bg-panel-2 hover:text-foreground" aria-label="Cerrar detalle">
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="mt-2 flex flex-wrap gap-1">
        <Insignia pequena tono={mundoPausado ? "aviso" : tonoInsignia(nodo)}>
          {mundoPausado ? "Último estado" : nodo.activo ? "En la cadena" : "Registro anterior"}
        </Insignia>
        {nodo.contadores.filter((contador) => contador.valor > 0).map((contador) => (
          <Insignia key={contador.etiqueta} pequena tono="neutro">{contador.valor} {contador.etiqueta}</Insignia>
        ))}
      </div>

      {mundoPausado && nodo.tipo === "agente" ? (
        <p className="mt-2 text-[12px] leading-snug text-muted">Sin actividad en curso. Debajo se muestra la última traza terminada.</p>
      ) : nodo.sub ? (
        <p className="mt-2 text-[12px] leading-snug text-muted">{nodo.sub}</p>
      ) : null}

      {ficha ? (
        <div className="mt-3 border-t border-panel-border pt-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px]">
            <dt className="text-subtle">Estado</dt>
            <dd className="text-right font-medium text-foreground">
              {mundoPausado ? "Pausado por el mundo" : ficha.pausado ? "Pausado por el mando" : TEXTO_ESTADO_AGENTE[ficha.estado]}
            </dd>
            <dt className="text-subtle">Categoría</dt>
            <dd className="text-right text-foreground">{TEXTO_CATEGORIA[ficha.categoria]}</dd>
            <dt className="text-subtle">Modelo</dt>
            <dd className="truncate text-right text-foreground" title={ficha.modelo}>{ficha.modelo}</dd>
            <dt className="text-subtle">Cadencia</dt>
            <dd className="tabular text-right text-foreground">{ficha.cadenciaSeg} s</dd>
          </dl>
          {!mundoPausado && ficha.tareaActual ? (
            <p className="mt-2 rounded-lg border border-panel-border bg-panel-2 px-2 py-1.5 text-[11.5px] leading-snug text-muted">
              <span className="font-medium text-foreground">Ahora:</span> {ficha.tareaActual}
            </p>
          ) : null}
          {ficha.ultimoError ? <p className="mt-2 text-[11.5px] leading-snug text-danger">Último error: {ficha.ultimoError}</p> : null}
          <Link href={`/agentes/${encodeURIComponent(ficha.id)}`} className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-brand hover:underline">
            Abrir ficha completa <ExternalLink className="size-3" aria-hidden />
          </Link>
        </div>
      ) : null}

      {traza ? <DetalleTraza traza={traza} mundoPausado={mundoPausado} /> : ultimoHito ? <DetalleHito hito={ultimoHito} /> : null}

      {conexiones.length ? (
        <div className="mt-3 border-t border-panel-border pt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Conexiones verificadas</h4>
          <ul className="mt-1.5 space-y-1.5">
            {conexiones.slice(0, 6).map((arista) => {
              const sale = arista.origen === nodo.id;
              const contraparte = nombreNodo(grafo, sale ? arista.destino : arista.origen);
              return (
                <li key={arista.id} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-muted">
                  <ArrowRight className={`mt-0.5 size-3 shrink-0 text-subtle ${sale ? "" : "rotate-180"}`} aria-hidden />
                  <span>
                    <span className="font-medium text-foreground">{contraparte}</span>
                    {arista.etiqueta ? ` · ${arista.etiqueta}` : ""}
                    {arista.cuenta > 1 ? ` · ×${arista.cuenta}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}

function DetalleTraza({ traza, mundoPausado }: { traza: TrazaCiclo; mundoPausado: boolean }) {
  return (
    <div className="mt-3 border-t border-panel-border pt-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-subtle">
        {mundoPausado ? "Último ciclo registrado" : traza.estado === "en_curso" ? "Ciclo en curso" : "Último ciclo"}
      </h4>
      <p className="mt-1 text-[12px] font-medium leading-snug text-foreground">{traza.motivo}</p>
      <p className="mt-0.5 text-[10.5px] text-subtle">
        {fechaHora(traza.inicio)} · {traza.estado.replace(/_/g, " ")}{traza.duracionMs !== undefined ? ` · ${duracion(traza.duracionMs)}` : ""}
      </p>
      {traza.entradas ? <p className="mt-2 text-[11.5px] leading-snug text-muted"><span className="font-medium text-foreground">Entrada:</span> {recortar(traza.entradas, 220)}</p> : null}
      {traza.resumen ? <p className="mt-1 text-[11.5px] leading-snug text-muted"><span className="font-medium text-foreground">Salida:</span> {recortar(traza.resumen, 220)}</p> : null}
      {traza.error ? <p className="mt-1 text-[11.5px] text-danger">Error: {traza.error}</p> : null}
      {traza.llamadasIA.length ? (
        <p className="mt-2 text-[10.5px] text-subtle">
          {traza.llamadasIA.length} llamada{traza.llamadasIA.length === 1 ? "" : "s"} IA · {traza.llamadasIA.map((llamada) => llamada.modelo).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function DetalleHito({ hito }: { hito: HitoArista }) {
  return (
    <div className="mt-3 border-t border-panel-border pt-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Último hito relacionado</h4>
      <p className="mt-1 text-[12px] font-medium leading-snug text-foreground">{hito.titulo}</p>
      <time className="mt-0.5 block text-[10.5px] text-subtle" dateTime={hito.en}>{fechaHora(hito.en)}</time>
      {hito.detalle ? <p className="mt-2 whitespace-pre-line text-[11.5px] leading-snug text-muted">{recortar(hito.detalle, 320)}</p> : null}
      {hito.respuesta ? <p className="mt-1 text-[11.5px] leading-snug text-muted"><span className="font-medium text-foreground">Resultado:</span> {recortar(hito.respuesta, 220)}</p> : null}
    </div>
  );
}
