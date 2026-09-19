"use client";
// Detalle de un agente: qué es, qué está haciendo, su línea de tiempo de ciclos
// (con las llamadas de IA), sus eventos y las decisiones que ha propuesto.
// DUEÑO: constructor E.

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot } from "lucide-react";
import { useEstado } from "@/lib/cliente/useEstado";
import { buscarAgenteCompatible, perteneceAlMismoAgente } from "@/lib/agentes/identidad";
import { haceCuanto, hora, numero } from "@/lib/cliente/formato";
import { Boton } from "@/components/ui/Boton";
import { Insignia, TEXTO_ESTADO_DECISION, tonoEstadoDecision } from "@/components/ui/Insignia";
import { Tarjeta } from "@/components/ui/Tarjeta";
import { Vacio } from "@/components/ui/Vacio";
import { Marca } from "@/components/marca/Logo";
import { SelectorTema } from "@/components/marca/SelectorTema";
import {
  ControlesAgente,
  TEXTO_CATEGORIA,
  TEXTO_ESTADO_AGENTE,
  tonoEstadoAgente,
  useAccionesAgente,
} from "@/components/sala/TarjetaAgente";
import { LineaTiempoTrazas } from "@/components/sala/TrazaAgente";
import { TarjetaDecision } from "@/components/sala/TarjetaDecision";

export default function DetalleAgente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { snapshot, refrescar, cargando } = useEstado();
  const { ejecutar, ocupado } = useAccionesAgente(refrescar);
  const [decisionAbierta, setDecisionAbierta] = useState<string>();

  const agente = buscarAgenteCompatible(snapshot?.agentes ?? [], id);
  // Antes del corte, el id exacto conserva la vista actual. Después del corte,
  // un enlace legacy muestra el agente canónico y recupera también su historia.
  const incluirIdentidadCompleta = Boolean(agente && agente.id !== id);
  const eventos = useMemo(
    () =>
      (snapshot?.eventos ?? [])
        .filter((e) => (incluirIdentidadCompleta ? perteneceAlMismoAgente(e.agenteId, id) : e.agenteId === id))
        .sort((a, b) => b.en.localeCompare(a.en))
        .slice(0, 40),
    [snapshot?.eventos, id, incluirIdentidadCompleta],
  );
  const decisiones = useMemo(
    () =>
      (snapshot?.decisiones ?? [])
        .filter((d) => (incluirIdentidadCompleta ? perteneceAlMismoAgente(d.agenteId, id) : d.agenteId === id))
        .sort((a, b) => b.creadaEn.localeCompare(a.creadaEn))
        .slice(0, 20),
    [snapshot?.decisiones, id, incluirIdentidadCompleta],
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-3 border-b border-panel-border pb-2">
        <Link href="/" className="rounded-lg">
          <Marca organismo="Sala de mando · Incendios forestales" />
        </Link>
        <Boton icono={<ArrowLeft />} onClick={() => history.back()} className="ml-auto">
          Volver a la sala
        </Boton>
        <SelectorTema compacto />
      </header>

      {!agente ? (
        <Vacio
          icono={<Bot />}
          titulo={cargando ? "Cargando el agente…" : `No hay ningún agente con el identificador «${id}»`}
          guia={cargando ? undefined : "Puede que el orquestador aún no lo haya registrado o que el identificador no sea correcto."}
          accion={
            <Link href="/" className="text-brand underline underline-offset-2">
              Volver a la sala de mando
            </Link>
          }
        />
      ) : (
        <>
          <Tarjeta
            titulo={agente.nombre}
            subtitulo={agente.descripcion}
            accion={
              <div className="flex flex-wrap items-center gap-1.5">
                <Insignia tono={agente.desactivadoPorEscenario && !agente.pausado ? "aviso" : tonoEstadoAgente(agente.estado)} punto>
                  {agente.pausado ? "Pausado" : agente.desactivadoPorEscenario ? "Sin ciclos" : TEXTO_ESTADO_AGENTE[agente.estado]}
                </Insignia>
                {agente.controlHumano ? <Insignia tono="aviso">Control humano</Insignia> : null}
                {agente.desactivadoPorEscenario && !agente.pausado ? (
                  <Insignia tono="info" title="El mando apagó esta fuente de detección en el desplegable de ejecución (modo desarrollo)">
                    Fuente apagada: {agente.desactivadoPorEscenario}
                  </Insignia>
                ) : null}
              </div>
            }
          >
            <p className="text-sm leading-snug text-foreground">
              {agente.tareaActual || "Ahora mismo no tiene ninguna tarea en curso."}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Insignia tono="marca">{TEXTO_CATEGORIA[agente.categoria]}</Insignia>
              <Insignia tono="neutro">Modelo: {agente.modelo}</Insignia>
              <Insignia tono="neutro">Cada {numero(agente.cadenciaSeg)} s</Insignia>
              <Insignia tono="neutro">{numero(agente.contadores.ciclos)} ciclos</Insignia>
              <Insignia tono="neutro">{numero(agente.contadores.decisiones)} decisiones</Insignia>
              <Insignia tono="neutro">{numero(agente.contadores.acciones)} acciones</Insignia>
              <Insignia tono={agente.contadores.errores > 0 ? "peligro" : "neutro"}>{numero(agente.contadores.errores)} errores</Insignia>
              <Insignia tono="neutro">Última actividad {haceCuanto(agente.ultimaActividad)}</Insignia>
            </div>
            {agente.ultimoError ? (
              <p className="mt-2 rounded-lg border border-danger/45 bg-danger/10 p-2 text-[13px] leading-snug text-danger">{agente.ultimoError}</p>
            ) : null}
            <div className="mt-3">
              <ControlesAgente agente={agente} ejecutar={ejecutar} ocupado={ocupado} tamano="md" />
            </div>
          </Tarjeta>

          <section>
            <h2 className="mb-1.5 text-sm font-semibold text-foreground">Qué ha hecho, ciclo a ciclo</h2>
            <p className="mb-2 text-[12.5px] text-muted">
              Cada ciclo muestra lo que vio, las llamadas reales a los modelos (con el prompt y la respuesta resumidos) y lo que produjo.
            </p>
            <LineaTiempoTrazas trazas={agente.trazas} limite={20} onIrADecision={setDecisionAbierta} />
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <section>
              <h2 className="mb-1.5 text-sm font-semibold text-foreground">Decisiones que ha propuesto</h2>
              {decisiones.length === 0 ? (
                <Vacio titulo="Ninguna decisión todavía" guia="Este agente aún no ha propuesto nada en esta ejecución." />
              ) : (
                <div className="space-y-2">
                  {decisiones.map((d) =>
                    decisionAbierta === d.id ? (
                      <TarjetaDecision
                        key={d.id}
                        decision={d}
                        incendio={snapshot?.incendios.find((i) => i.id === d.incendioId)}
                        onTrasDecidir={refrescar}
                      />
                    ) : (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setDecisionAbierta(d.id)}
                        className="w-full rounded-xl border border-panel-border bg-panel p-2.5 text-left hover:border-brand"
                      >
                        <p className="text-[13px] font-medium leading-snug text-foreground">{d.titulo}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-1">
                          <Insignia pequena tono={tonoEstadoDecision(d.estado)} punto>
                            {TEXTO_ESTADO_DECISION[d.estado]}
                          </Insignia>
                          <span className="text-[11px] text-subtle">{haceCuanto(d.creadaEn)}</span>
                        </p>
                      </button>
                    ),
                  )}
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-1.5 text-sm font-semibold text-foreground">Sus últimos eventos</h2>
              {eventos.length === 0 ? (
                <Vacio titulo="Sin eventos" guia="Aún no ha registrado nada en el registro vivo." />
              ) : (
                <ul className="divide-y divide-panel-border rounded-xl border border-panel-border bg-panel">
                  {eventos.map((e) => (
                    <li key={e.id} className="flex items-start gap-2 px-2.5 py-1.5">
                      <span
                        aria-hidden
                        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${e.nivel === "critico" ? "bg-danger" : e.nivel === "aviso" ? "bg-warning" : "bg-muted"}`}
                      />
                      <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-foreground">{e.mensaje}</p>
                      <span className="tabular shrink-0 text-[11px] text-subtle">{hora(e.enMundo || e.en)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
