"use client";
// Ruta /agentes: una sola entrada para operación, equipo y trazabilidad.
// El contenedor conserva el Snapshot como única fuente de verdad y deja cada
// profundidad de información en un componente independiente.

import { useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, FileSearch, PauseOctagon, Users, WifiOff } from "lucide-react";
import { useEstado } from "@/lib/cliente/useEstado";
import { numero } from "@/lib/cliente/formato";
import { Marca } from "@/components/marca/Logo";
import { SelectorTema } from "@/components/marca/SelectorTema";
import { Boton } from "@/components/ui/Boton";
import { Insignia } from "@/components/ui/Insignia";
import { PanelPestana, Pestanas } from "@/components/ui/Pestanas";
import { Vacio } from "@/components/ui/Vacio";
import { AuditoriaAgentes } from "./AuditoriaAgentes";
import { EquipoAgentes } from "./EquipoAgentes";
import { FlujoOperacion } from "./FlujoOperacion";

type VistaCentro = "operacion" | "equipo" | "auditoria";

const ESTADOS_CERRADOS = new Set(["extinguido", "descartado", "fusionado"]);

export function CentroAgentes() {
  const { snapshot, conectado, error, cargando, refrescar } = useEstado();
  const [vista, setVista] = useState<VistaCentro>("operacion");
  const [incendioSolicitado, setIncendioSolicitado] = useState("");

  const incendios = snapshot?.incendios ?? [];
  const incendioPreferente =
    incendios.find((incendio) => incendio.id === incendioSolicitado) ??
    incendios.find((incendio) => !ESTADOS_CERRADOS.has(incendio.estado)) ??
    incendios[0];
  const mundoPausado = Boolean(snapshot?.reloj.pausado);
  const agentes = snapshot?.agentes ?? [];
  const pensando = mundoPausado
    ? 0
    : agentes.filter((agente) => agente.trazas?.some((traza) => traza.estado === "en_curso")).length;
  const conError = agentes.filter((agente) => agente.estado === "error" || Boolean(agente.ultimoError)).length;
  const decisionesPendientes = (snapshot?.decisiones ?? []).filter(
    (decision) => decision.estado === "pendiente_humano" || decision.estado === "escalada",
  ).length;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1480px] flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-3 border-b border-panel-border pb-2">
        <Link href="/" className="rounded-lg">
          <Marca organismo="Centro de agentes · operación y trazabilidad" />
        </Link>
        <Link href="/" className="ml-auto">
          <Boton icono={<ArrowLeft />}>Volver a la sala</Boton>
        </Link>
        <SelectorTema compacto />
      </header>

      <section className="rounded-xl border border-panel-border bg-panel p-3 shadow-[var(--sombra-panel)]">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">Centro de agentes</p>
            <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-foreground">Operación multiagente</h1>
            <p className="mt-1 max-w-3xl text-[12.5px] leading-snug text-muted">
              La cadena activa primero; el equipo completo y la auditoría siguen disponibles sin duplicar ni descartar información.
            </p>
          </div>
          {incendios.length ? (
            <label className="grid min-w-56 gap-1 text-[10.5px] font-medium uppercase tracking-wide text-subtle">
              Incidente del flujo
              <select
                value={incendioPreferente?.id ?? ""}
                onChange={(evento) => setIncendioSolicitado(evento.target.value)}
                className="min-h-10 rounded-lg border border-panel-border-strong bg-panel px-2.5 text-[13px] font-normal normal-case tracking-normal text-foreground"
              >
                {incendios.map((incendio) => (
                  <option key={incendio.id} value={incendio.id}>
                    {incendio.nombre} · {incendio.estado}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Insignia tono="neutro">{numero(agentes.length)} agentes registrados</Insignia>
          <Insignia tono={pensando ? "marca" : "neutro"} punto={pensando > 0}>{numero(pensando)} pensando ahora</Insignia>
          <Insignia tono={decisionesPendientes ? "aviso" : "neutro"}>{numero(decisionesPendientes)} esperando al mando</Insignia>
          {conError ? <Insignia tono="peligro">{numero(conError)} con error</Insignia> : null}
        </div>
      </section>

      {mundoPausado ? (
        <p role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/50 bg-warning/12 px-3 py-2 text-[12.5px] font-medium text-warning">
          <PauseOctagon className="size-4 shrink-0" aria-hidden />
          Mundo en pausa: se muestra la última cadena operativa; ningún agente ni modelo está trabajando ahora.
        </p>
      ) : null}

      {!conectado ? (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-warning/45 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          {cargando ? "Conectando con el núcleo de Atalaya…" : `Sin conexión en vivo; los datos pueden estar desfasados.${error ? ` ${error}` : ""}`}
        </p>
      ) : null}

      <div className="rounded-xl border border-panel-border bg-panel p-1.5">
        <Pestanas
          idBase="centro-agentes"
          activa={vista}
          onCambiar={(id) => setVista(id as VistaCentro)}
          pestanas={[
            { id: "operacion", etiqueta: "Operación", icono: <Activity /> },
            { id: "equipo", etiqueta: "Equipo", icono: <Users />, cuenta: agentes.length, urgente: conError > 0 },
            { id: "auditoria", etiqueta: "Trazas y decisiones", icono: <FileSearch /> },
          ]}
        />
      </div>

      <main className="min-w-0 flex-1">
        <PanelPestana idBase="centro-agentes" id="operacion" activa={vista}>
          {incendioPreferente && snapshot ? (
            <FlujoOperacion snapshot={snapshot} incendioId={incendioPreferente.id} />
          ) : (
            <Vacio
              icono={<Activity />}
              titulo={cargando ? "Cargando la operación…" : "No hay incidencias para construir un flujo"}
              guia="Cuando exista un foco, esta vista mostrará únicamente los participantes y traspasos que hayan ocurrido de verdad."
            />
          )}
        </PanelPestana>
        <PanelPestana idBase="centro-agentes" id="equipo" activa={vista}>
          <EquipoAgentes agentes={agentes} incendios={incendios} mundoPausado={mundoPausado} onTrasAccion={refrescar} />
        </PanelPestana>
        <PanelPestana idBase="centro-agentes" id="auditoria" activa={vista}>
          <AuditoriaAgentes snapshot={snapshot} />
        </PanelPestana>
      </main>
    </div>
  );
}
