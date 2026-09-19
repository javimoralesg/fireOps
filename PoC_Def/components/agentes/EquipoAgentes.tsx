"use client";
// Centro de agentes: conserva el inventario operativo completo en una lista
// compacta y concentra el detalle accionable en un inspector seleccionado.

import { useState } from "react";
import { AlertTriangle, Bot, Clock3, Cpu, ShieldCheck, TimerReset } from "lucide-react";
import type { EstadoAgenteApp, Incendio } from "@/lib/dominio/tipos";
import { haceCuanto, numero } from "@/lib/cliente/formato";
import { ControlesAgente, TEXTO_CATEGORIA, TEXTO_ESTADO_AGENTE, tonoEstadoAgente, useAccionesAgente } from "@/components/sala/TarjetaAgente";
import { ResumenTraza } from "@/components/sala/TrazaAgente";
import { Insignia } from "@/components/ui/Insignia";
import { Vacio } from "@/components/ui/Vacio";

export interface EquipoAgentesProps {
  /** Inventario completo que publica el orquestador; no se filtra ni se reduce. */
  agentes: EstadoAgenteApp[];
  /** Permite mostrar el nombre del incendio asignado sin duplicar su estado. */
  incendios?: Pick<Incendio, "id" | "nombre">[];
  /** La pausa global detiene todos los ciclos, aunque el estado propio no cambie. */
  mundoPausado?: boolean;
  onTrasAccion?: () => void;
}

function estadoVisible(agente: EstadoAgenteApp, mundoPausado: boolean) {
  if (mundoPausado) return "Pausado (mundo)";
  if (agente.pausado) return "Pausado";
  // Fuente apagada por el escenario del mando: no lo ha pausado nadie, pero no corre.
  if (agente.desactivadoPorEscenario) return "Sin ciclos";
  return TEXTO_ESTADO_AGENTE[agente.estado];
}

function tonoVisible(agente: EstadoAgenteApp, mundoPausado: boolean) {
  return mundoPausado || agente.pausado || agente.desactivadoPorEscenario ? "aviso" : tonoEstadoAgente(agente.estado);
}

function referenciaIncidente(agente: EstadoAgenteApp, incendios: Pick<Incendio, "id" | "nombre">[]) {
  if (!agente.incendioId) return "Sin incidente asignado";
  return incendios.find((incendio) => incendio.id === agente.incendioId)?.nombre ?? agente.incendioId;
}

function Metadato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-medium uppercase tracking-wide text-subtle">{etiqueta}</dt>
      <dd className="mt-0.5 break-words text-[12.5px] leading-snug text-foreground">{children}</dd>
    </div>
  );
}

export function EquipoAgentes({ agentes, incendios = [], mundoPausado = false, onTrasAccion }: EquipoAgentesProps) {
  const [seleccionadoId, setSeleccionadoId] = useState<string>();
  const { ejecutar, ocupado } = useAccionesAgente(onTrasAccion);
  const seleccionado = agentes.find((agente) => agente.id === seleccionadoId) ?? agentes[0];

  if (agentes.length === 0) {
    return (
      <Vacio
        icono={<Bot />}
        titulo="Los agentes aún no se han registrado"
        guia="El orquestador publicará el equipo completo al arrancar."
      />
    );
  }

  const ultimaTraza = seleccionado.trazas?.[seleccionado.trazas.length - 1];
  const incidente = referenciaIncidente(seleccionado, incendios);
  const estadoPropio = seleccionado.pausado ? "Pausado por un humano" : TEXTO_ESTADO_AGENTE[seleccionado.estado];

  return (
    <section className="space-y-3" aria-label="Equipo de agentes">
      {mundoPausado ? (
        <p className="rounded-xl border border-warning/50 bg-warning/12 px-3 py-2 text-[12.5px] font-medium leading-snug text-warning">
          Mundo en pausa: los {numero(agentes.length)} agentes no ejecutan ciclos ni llamadas a la IA. Sus estados propios se conservan en el inspector.
        </p>
      ) : null}

      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.82fr)]">
        <section className="overflow-hidden rounded-xl border border-panel-border bg-panel" aria-label={`Inventario de ${agentes.length} agentes`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-panel-border px-3 py-2.5">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Equipo operativo</h2>
              <p className="text-[12px] text-muted">{numero(agentes.length)} agentes registrados · selecciona uno para inspeccionarlo</p>
            </div>
            <span className="text-[11px] text-subtle">Estado · tarea · incidente · actividad</span>
          </div>

          <ul className="divide-y divide-panel-border" aria-label="Lista completa de agentes">
            {agentes.map((agente) => {
              const seleccionadoAhora = agente.id === seleccionado.id;
              const parado = mundoPausado || agente.pausado || agente.estado === "pausado" || Boolean(agente.desactivadoPorEscenario);
              return (
                <li key={agente.id}>
                  <button
                    type="button"
                    onClick={() => setSeleccionadoId(agente.id)}
                    aria-pressed={seleccionadoAhora}
                    className={[
                      "grid w-full gap-x-3 gap-y-1 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                      "sm:grid-cols-[minmax(11rem,0.8fr)_minmax(0,1.25fr)_minmax(8rem,0.7fr)_auto] sm:items-center",
                      seleccionadoAhora ? "bg-brand/10" : "hover:bg-panel-2",
                    ].join(" ")}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className={[
                            "size-2 shrink-0 rounded-full",
                            agente.estado === "error" ? "bg-danger" : parado ? "bg-warning" : agente.estado === "razonando" ? "bg-brand" : agente.estado === "actuando" ? "bg-info" : "bg-success",
                          ].join(" ")}
                        />
                        <span className="truncate text-[13px] font-semibold text-foreground">{agente.nombre}</span>
                      </span>
                      <span className="mt-0.5 block truncate pl-3.5 text-[11px] text-subtle">{TEXTO_CATEGORIA[agente.categoria]}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] text-foreground">{agente.tareaActual || agente.descripcion}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted">{referenciaIncidente(agente, incendios)}</span>
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-1">
                      <Insignia pequena tono={tonoVisible(agente, mundoPausado)} punto>
                        {estadoVisible(agente, mundoPausado)}
                      </Insignia>
                      {mundoPausado ? <span className="text-[10.5px] text-subtle">{TEXTO_ESTADO_AGENTE[agente.estado]}</span> : null}
                      {agente.desactivadoPorEscenario && !agente.pausado ? (
                        <Insignia pequena tono="info" title="El mando apagó esta fuente de detección en el desplegable de ejecución (modo desarrollo)">
                          Fuente apagada: {agente.desactivadoPorEscenario}
                        </Insignia>
                      ) : null}
                    </span>
                    <span className="tabular text-[11px] text-subtle sm:text-right" title={agente.ultimaActividad}>
                      {haceCuanto(agente.ultimaActividad)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="rounded-xl border border-panel-border bg-panel p-3" aria-label={`Inspector de ${seleccionado.nombre}`}>
          <header className="border-b border-panel-border pb-2.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Inspector del agente</p>
                <h2 className="mt-0.5 text-base font-semibold text-foreground">{seleccionado.nombre}</h2>
                <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{seleccionado.descripcion}</p>
              </div>
              <Insignia tono={tonoVisible(seleccionado, mundoPausado)} punto>
                {estadoVisible(seleccionado, mundoPausado)}
              </Insignia>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Insignia pequena tono="marca">{TEXTO_CATEGORIA[seleccionado.categoria]}</Insignia>
              {seleccionado.controlHumano ? <Insignia pequena tono="aviso">Control humano</Insignia> : null}
              <Insignia pequena tono="neutro">{seleccionado.modelo}</Insignia>
            </div>
          </header>

          <div className="space-y-3 pt-3">
            <section aria-labelledby="agente-tarea">
              <h3 id="agente-tarea" className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Operación actual</h3>
              <p className="mt-1 text-[13px] leading-snug text-foreground">{seleccionado.tareaActual || "Sin tarea asignada."}</p>
              <p className="mt-1 text-[12px] text-muted">Incidente: <span className="font-medium text-foreground">{incidente}</span></p>
            </section>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-panel-2 p-2.5 sm:grid-cols-3">
              <Metadato etiqueta="Estado propio">{estadoPropio}</Metadato>
              <Metadato etiqueta="Última actividad">{haceCuanto(seleccionado.ultimaActividad)}</Metadato>
              <Metadato etiqueta="Modelo"><span className="inline-flex items-center gap-1"><Cpu className="size-3.5 text-subtle" aria-hidden />{seleccionado.modelo}</span></Metadato>
              <Metadato etiqueta="Cadencia"><span className="inline-flex items-center gap-1"><Clock3 className="size-3.5 text-subtle" aria-hidden />Cada {numero(seleccionado.cadenciaSeg)} s</span></Metadato>
              <Metadato etiqueta="Tiempo máximo"><span className="inline-flex items-center gap-1"><TimerReset className="size-3.5 text-subtle" aria-hidden />{seleccionado.tiempoMaximoSeg === undefined ? "—" : `${numero(seleccionado.tiempoMaximoSeg)} s`}</span></Metadato>
              <Metadato etiqueta="Autonomía"><span className="inline-flex items-center gap-1"><ShieldCheck className="size-3.5 text-subtle" aria-hidden />{seleccionado.controlHumano ? "Control humano" : "Autónoma"}</span></Metadato>
            </dl>

            <section aria-labelledby="agente-contadores">
              <h3 id="agente-contadores" className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Actividad acumulada</h3>
              <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {[
                  ["Ciclos", seleccionado.contadores.ciclos],
                  ["Decisiones", seleccionado.contadores.decisiones],
                  ["Acciones", seleccionado.contadores.acciones],
                  ["Errores", seleccionado.contadores.errores],
                ].map(([etiqueta, valor]) => (
                  <div key={etiqueta} className="rounded-lg border border-panel-border px-2 py-1.5">
                    <p className="text-[10.5px] uppercase tracking-wide text-subtle">{etiqueta}</p>
                    <p className={`tabular text-sm font-semibold ${etiqueta === "Errores" && Number(valor) > 0 ? "text-danger" : "text-foreground"}`}>{numero(Number(valor))}</p>
                  </div>
                ))}
              </div>
            </section>

            <section aria-labelledby="agente-traza">
              <h3 id="agente-traza" className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Última traza</h3>
              <div className="mt-1 rounded-lg border border-panel-border px-2.5 py-2">
                <ResumenTraza traza={ultimaTraza} />
              </div>
            </section>

            {seleccionado.ultimoError ? (
              <p className="flex items-start gap-1.5 rounded-lg border border-danger/45 bg-danger/10 px-2.5 py-2 text-[12.5px] leading-snug text-danger">
                <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                <span><span className="font-semibold">Último error: </span>{seleccionado.ultimoError}</span>
              </p>
            ) : null}

            <section aria-labelledby="agente-controles">
              <h3 id="agente-controles" className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">Controles</h3>
              <ControlesAgente agente={seleccionado} ejecutar={ejecutar} ocupado={ocupado} />
            </section>
          </div>
        </aside>
      </div>
    </section>
  );
}
