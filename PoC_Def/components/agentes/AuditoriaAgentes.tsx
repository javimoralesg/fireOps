"use client";

// Auditoría de agentes para la futura ruta /agentes. Esta vista no genera ni
// reconstruye datos: presenta únicamente el Snapshot que recibe por SSE.

import { useMemo, useState } from "react";
import { AlertTriangle, Bot, CalendarClock, FileSearch, History, Radio, ScrollText } from "lucide-react";
import type { Decision, EstadoAgenteApp, Evento, Observacion, Snapshot, TrazaCiclo } from "@/lib/dominio/tipos";
import { duracion, fechaHora, hora, numero } from "@/lib/cliente/formato";
import { Desplegable } from "@/components/ui/Desplegable";
import { Insignia } from "@/components/ui/Insignia";
import { Tarjeta } from "@/components/ui/Tarjeta";
import { Vacio } from "@/components/ui/Vacio";
import { TarjetaDecision } from "@/components/sala/TarjetaDecision";
import { TarjetaTraza } from "@/components/sala/TrazaAgente";

type Tono = "neutro" | "peligro" | "aviso" | "exito" | "info" | "marca" | "fuego";

const TEXTO_TRAZA: Record<TrazaCiclo["estado"], string> = {
  en_curso: "En curso",
  ok: "Completado",
  error: "Con error",
  cancelado: "Cancelado",
};

function tonoTraza(estado: TrazaCiclo["estado"]): Tono {
  if (estado === "ok") return "exito";
  if (estado === "error") return "peligro";
  if (estado === "en_curso") return "marca";
  return "neutro";
}

function eventosDeAgente(snapshot: Snapshot | undefined, agenteId: string | undefined): Evento[] {
  if (!snapshot || !agenteId) return [];
  return snapshot.eventos.filter((evento) => evento.agenteId === agenteId).sort((a, b) => b.en.localeCompare(a.en));
}

function FilaId({ etiqueta, id }: { etiqueta: string; id: string }) {
  return (
    <p className="min-w-0 text-[11.5px] leading-snug text-muted">
      <span className="font-medium text-subtle">{etiqueta}: </span>
      <code className="break-all font-mono text-[11px] text-foreground">{id}</code>
    </p>
  );
}

function EnlacesObservaciones({ ids, snapshot }: { ids: string[]; snapshot?: Snapshot }) {
  const observaciones = useMemo(
    () => ids.map((id) => ({ id, observacion: snapshot?.observaciones.find((observacion) => observacion.id === id) })),
    [ids, snapshot?.observaciones],
  );

  if (observaciones.length === 0) return null;

  return (
    <section aria-labelledby="observaciones-traza">
      <h3 id="observaciones-traza" className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-subtle">
        Observaciones vinculadas
      </h3>
      <div className="space-y-1.5">
        {observaciones.map(({ id, observacion }) => (
          <ObservacionVinculada key={id} id={id} observacion={observacion} />
        ))}
      </div>
    </section>
  );
}

function ObservacionVinculada({ id, observacion }: { id: string; observacion?: Observacion }) {
  if (!observacion) {
    return (
      <div className="rounded-lg border border-dashed border-panel-border-strong bg-panel-2/40 p-2">
        <FilaId etiqueta="Observación" id={id} />
        <p className="mt-1 text-[12px] text-muted">La observación vinculada no está disponible en este Snapshot.</p>
      </div>
    );
  }

  return (
    <Desplegable titulo={<span className="font-mono text-[11px]">{observacion.id}</span>}>
      <div className="space-y-1.5 text-[12px] leading-snug">
        <p className="text-foreground">{observacion.texto}</p>
        <p>
          <span className="font-medium text-foreground">Canal:</span> {observacion.canal}
          {observacion.remitente ? ` · ${observacion.remitente}` : ""}
          {observacion.impacto ? ` · ${observacion.impacto}` : ""}
        </p>
        {observacion.extraccion?.resumen ? <p>{observacion.extraccion.resumen}</p> : null}
        {observacion.verificacion ? <p>{observacion.verificacion}</p> : null}
        {observacion.referenciaExterna ? <FilaId etiqueta="Referencia externa" id={observacion.referenciaExterna} /> : null}
        <p className="text-subtle">Recibida {fechaHora(observacion.recibidaEn)}</p>
      </div>
    </Desplegable>
  );
}

function EventosAgente({ eventos }: { eventos: Evento[] }) {
  if (eventos.length === 0) {
    return <p className="text-[12.5px] leading-snug text-muted">No hay eventos de este agente en el Snapshot actual.</p>;
  }

  return (
    <ul className="divide-y divide-panel-border rounded-xl border border-panel-border bg-panel">
      {eventos.map((evento) => (
        <li key={evento.id} className="flex gap-2 px-2.5 py-2">
          <span
            aria-hidden
            className={`mt-1.5 size-1.5 shrink-0 rounded-full ${evento.nivel === "critico" ? "bg-danger" : evento.nivel === "aviso" ? "bg-warning" : "bg-muted"}`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] leading-snug text-foreground">{evento.mensaje}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-[11px] text-subtle">
              <span>{evento.tipo}</span>
              <span aria-hidden>·</span>
              <span>{hora(evento.enMundo || evento.en)}</span>
              {evento.incendioId ? (
                <>
                  <span aria-hidden>·</span>
                  <code className="font-mono">{evento.incendioId}</code>
                </>
              ) : null}
            </p>
            <p className="mt-0.5 break-all font-mono text-[10.5px] text-subtle">{evento.id}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Visor de trazabilidad por agente. Recibe el Snapshot real y conserva el
 * detalle de la traza, sus vínculos y los eventos publicados por el agente.
 */
export function AuditoriaAgentes({ snapshot }: { snapshot?: Snapshot }) {
  const [agenteIdSolicitado, setAgenteIdSolicitado] = useState("");
  const [trazaIdSolicitado, setTrazaIdSolicitado] = useState("");
  const [decisionIdAbierta, setDecisionIdAbierta] = useState<string>();

  const agentes = snapshot?.agentes ?? [];
  const agente = agentes.find((candidato) => candidato.id === agenteIdSolicitado) ?? agentes[0];
  const trazas = useMemo(() => [...(agente?.trazas ?? [])].reverse(), [agente?.trazas]);
  const traza = trazas.find((candidata) => candidata.id === trazaIdSolicitado) ?? trazas[0];
  const eventos = useMemo(() => eventosDeAgente(snapshot, agente?.id), [snapshot, agente?.id]);
  const decisionesVinculadas = useMemo(
    () =>
      traza
        ? traza.decisiones
            .map((id) => snapshot?.decisiones.find((decision) => decision.id === id))
            .filter((decision): decision is Decision => Boolean(decision))
        : [],
    [snapshot?.decisiones, traza],
  );
  const decisionAbierta = decisionIdAbierta
    ? decisionesVinculadas.find((decision) => decision.id === decisionIdAbierta)
    : decisionesVinculadas[0];

  if (agentes.length === 0) {
    return (
      <Vacio
        icono={<Bot />}
        titulo="Aún no hay agentes para auditar"
        guia="Esta vista se completa cuando el orquestador publique los agentes y sus ciclos en el Snapshot."
      />
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="titulo-auditoria-agentes">
      <header className="flex flex-wrap items-end gap-2 rounded-[var(--radius-panel)] border border-panel-border bg-panel p-3 shadow-[var(--sombra-panel)]">
        <div className="min-w-0 flex-1">
          <h2 id="titulo-auditoria-agentes" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <FileSearch className="size-4.5 text-brand" aria-hidden /> Auditoría de agentes
          </h2>
          <p className="mt-1 text-[12.5px] leading-snug text-muted">Ciclos, llamadas de IA, decisiones, observaciones y eventos publicados.</p>
        </div>
        <Insignia tono="neutro">{numero(agentes.length)} agentes</Insignia>
        {snapshot ? <Insignia tono="info">Snapshot {numero(snapshot.version)}</Insignia> : null}
      </header>

      <div className="grid gap-3 xl:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.3fr)]">
        <aside className="space-y-3" aria-label="Selección de agente y ciclo">
          <Tarjeta titulo="Seleccionar agente" icono={<Bot />}>
            <label htmlFor="auditoria-agente" className="solo-lectores">Agente</label>
            <select
              id="auditoria-agente"
              value={agente?.id ?? ""}
              onChange={(event) => {
                setAgenteIdSolicitado(event.target.value);
                setTrazaIdSolicitado("");
                setDecisionIdAbierta(undefined);
              }}
              className="min-h-10 w-full rounded-lg border border-panel-border-strong bg-panel px-2.5 text-[13px] text-foreground"
            >
              {agentes.map((candidato) => (
                <option key={candidato.id} value={candidato.id}>{candidato.nombre}</option>
              ))}
            </select>
            <FichaAgente agente={agente} />
          </Tarjeta>

          <Tarjeta titulo="Ciclos registrados" icono={<History />} accion={<Insignia pequena tono="neutro">{numero(trazas.length)}</Insignia>}>
            {trazas.length === 0 ? (
              <p className="text-[12.5px] leading-snug text-muted">Este agente no ha publicado ciclos en el Snapshot actual.</p>
            ) : (
              <div className="space-y-1.5">
                <label htmlFor="auditoria-traza" className="solo-lectores">Seleccionar ciclo</label>
                <select
                  id="auditoria-traza"
                  value={traza?.id ?? ""}
                  onChange={(event) => {
                    setTrazaIdSolicitado(event.target.value);
                    setDecisionIdAbierta(undefined);
                  }}
                  className="min-h-10 w-full rounded-lg border border-panel-border-strong bg-panel px-2.5 text-[12px] text-foreground"
                >
                  {trazas.map((candidata) => (
                    <option key={candidata.id} value={candidata.id}>{`${hora(candidata.inicio)} · ${TEXTO_TRAZA[candidata.estado]} · ${candidata.motivo}`}</option>
                  ))}
                </select>
                <ol className="max-h-72 space-y-1 overflow-auto pr-1 scroll-fino" aria-label="Lista de ciclos">
                  {trazas.map((candidata) => (
                    <li key={candidata.id}>
                      <button
                        type="button"
                        aria-pressed={traza?.id === candidata.id}
                        onClick={() => {
                          setTrazaIdSolicitado(candidata.id);
                          setDecisionIdAbierta(undefined);
                        }}
                        className={`w-full rounded-lg border p-2 text-left transition-colors ${traza?.id === candidata.id ? "border-brand bg-brand/10" : "border-panel-border bg-panel-2/40 hover:border-panel-border-strong"}`}
                      >
                        <p className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium text-foreground">
                          <Insignia pequena tono={tonoTraza(candidata.estado)}>{TEXTO_TRAZA[candidata.estado]}</Insignia>
                          <span>{hora(candidata.inicio)}</span>
                          <span className="text-subtle">· {candidata.motivo}</span>
                        </p>
                        <p className="mt-1 text-[11px] text-muted">{candidata.estado === "en_curso" ? "En curso" : duracion(candidata.duracionMs)} · {numero(candidata.llamadasIA.length)} IA</p>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </Tarjeta>
        </aside>

        <div className="min-w-0 space-y-3">
          {!traza ? (
            <Vacio icono={<ScrollText />} titulo="Selecciona un ciclo para consultar su traza" guia="Los ciclos de este agente aparecerán aquí cuando estén disponibles." />
          ) : (
            <>
              <Tarjeta titulo="Contexto del ciclo" icono={<CalendarClock />}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <FilaId etiqueta="Traza" id={traza.id} />
                  <p className="text-[11.5px] text-muted"><span className="font-medium text-subtle">Inicio: </span>{fechaHora(traza.inicio)}</p>
                  <p className="text-[11.5px] text-muted"><span className="font-medium text-subtle">Fin: </span>{traza.fin ? fechaHora(traza.fin) : "No registrado"}</p>
                  <p className="text-[11.5px] text-muted"><span className="font-medium text-subtle">Eventos producidos: </span>{numero(traza.eventos)}</p>
                </div>
                <p className="mt-2 text-[11.5px] leading-snug text-subtle">El contador de eventos pertenece al ciclo; la lista inferior muestra todos los eventos publicados por el agente en este Snapshot.</p>
              </Tarjeta>

              <TarjetaTraza traza={traza} abiertaPorDefecto onIrADecision={setDecisionIdAbierta} />

              <EnlacesObservaciones ids={traza.observaciones} snapshot={snapshot} />

              <section aria-labelledby="decisiones-traza" className="space-y-1.5">
                <h3 id="decisiones-traza" className="text-[11.5px] font-semibold uppercase tracking-wide text-subtle">Decisiones vinculadas</h3>
                {traza.decisiones.length === 0 ? (
                  <p className="text-[12.5px] leading-snug text-muted">Este ciclo no registra decisiones producidas.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {traza.decisiones.map((id) => {
                        const disponible = decisionesVinculadas.some((decision) => decision.id === id);
                        return (
                          <button
                            key={id}
                            type="button"
                            disabled={!disponible}
                            onClick={() => setDecisionIdAbierta(id)}
                            className={`rounded-full border px-2 py-1 font-mono text-[10.5px] ${decisionAbierta?.id === id ? "border-brand bg-brand/10 text-brand" : "border-panel-border-strong bg-panel text-muted hover:text-foreground"} disabled:cursor-not-allowed disabled:opacity-60`}
                          >
                            {id}
                          </button>
                        );
                      })}
                    </div>
                    {decisionAbierta ? (
                      <TarjetaDecision
                        decision={decisionAbierta}
                        incendio={snapshot?.incendios.find((incendio) => incendio.id === decisionAbierta.incendioId)}
                        informes={snapshot?.informes}
                        conEnlaceAuditoria={false}
                      />
                    ) : (
                      <p className="rounded-lg border border-dashed border-panel-border-strong p-2 text-[12px] text-muted">La decisión vinculada no está disponible en este Snapshot.</p>
                    )}
                  </>
                )}
              </section>
            </>
          )}

          <section aria-labelledby="eventos-agente" className="space-y-1.5">
            <h3 id="eventos-agente" className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-subtle">
              <Radio className="size-3.5" aria-hidden /> Eventos del agente
            </h3>
            <EventosAgente eventos={eventos} />
          </section>
        </div>
      </div>
    </section>
  );
}

function FichaAgente({ agente }: { agente?: EstadoAgenteApp }) {
  if (!agente) return null;
  return (
    <div className="mt-2.5 space-y-1.5">
      <p className="text-[12px] leading-snug text-muted">{agente.descripcion}</p>
      <div className="flex flex-wrap gap-1">
        <Insignia pequena tono="neutro">{agente.modelo}</Insignia>
        <Insignia pequena tono="neutro">Cada {numero(agente.cadenciaSeg)} s</Insignia>
        {agente.tiempoMaximoSeg !== undefined ? <Insignia pequena tono="neutro">Límite {numero(agente.tiempoMaximoSeg)} s</Insignia> : null}
      </div>
      {agente.ultimoError ? (
        <p className="flex gap-1 rounded-lg border border-danger/45 bg-danger/10 p-2 text-[11.5px] leading-snug text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {agente.ultimoError}
        </p>
      ) : null}
    </div>
  );
}

export default AuditoriaAgentes;
