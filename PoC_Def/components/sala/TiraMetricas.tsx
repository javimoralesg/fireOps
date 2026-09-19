"use client";
// Tira inferior con las métricas de la ejecución: lo que el jurado mira para
// juzgar si el sistema decide y actúa bien. DUEÑO: constructor E.

import type { Snapshot } from "@/lib/dominio/tipos";
import { minutos, numero } from "@/lib/cliente/formato";
import { Tooltip } from "@/components/ui/Tooltip";

export function TiraMetricas({ snapshot }: { snapshot?: Snapshot }) {
  const m = snapshot?.ejecucion?.metricas;
  if (!m) return null;

  const celdas: { etiqueta: string; valor: string; ayuda: string; alerta?: boolean }[] = [
    { etiqueta: "Focos", valor: numero(m.incendios), ayuda: "Incendios abiertos en esta ejecución." },
    { etiqueta: "Propuestas", valor: numero(m.decisionesPropuestas), ayuda: "Decisiones que han propuesto los agentes." },
    { etiqueta: "Aprobadas", valor: numero(m.decisionesAprobadas), ayuda: "Aprobadas por un humano o por la política." },
    { etiqueta: "Autónomas", valor: numero(m.decisionesAutonomas), ayuda: "Ejecutadas sin pasar por un humano, según tu política de autonomía." },
    { etiqueta: "Escaladas", valor: numero(m.escaladasAHumano), ayuda: "El supervisor las devolvió a una persona.", alerta: m.escaladasAHumano > 0 },
    { etiqueta: "Denegadas", valor: numero(m.decisionesDenegadas), ayuda: "Denegadas por un humano: cada una deja una lección." },
    {
      etiqueta: "Detección → aviso",
      valor: m.minutosDeteccionAviso !== undefined ? minutos(m.minutosDeteccionAviso) : "—",
      ayuda: "Minutos de mundo medios desde que se detecta el foco hasta el primer aviso a un pueblo.",
    },
    {
      etiqueta: "Detección → medios",
      valor: m.minutosDeteccionDespliegue !== undefined ? minutos(m.minutosDeteccionDespliegue) : "—",
      ayuda: "Minutos de mundo medios hasta que la primera unidad sale hacia el foco.",
    },
    { etiqueta: "Pueblos avisados", valor: numero(m.poblacionesAvisadas), ayuda: "Núcleos de población a los que ya se ha avisado." },
    {
      etiqueta: "Sin avisar",
      valor: numero(m.poblacionesEnPeligroSinAvisar),
      ayuda: "Pueblos en peligro a los que todavía no se ha avisado.",
      alerta: m.poblacionesEnPeligroSinAvisar > 0,
    },
    {
      etiqueta: "Llamadas",
      valor: `${numero(m.llamadasContestadas)}/${numero(m.llamadasRealizadas)}`,
      ayuda: "Llamadas contestadas sobre llamadas realizadas de verdad.",
    },
    {
      etiqueta: "Supervisor",
      valor: m.puntuacionSupervisorMedia !== undefined ? `${numero(m.puntuacionSupervisorMedia)}/100` : "—",
      ayuda: "Puntuación media que el supervisor da a las decisiones.",
    },
  ];

  return (
    <div className="flex items-stretch gap-0 overflow-x-auto border-t border-panel-border bg-panel scroll-fino">
      {celdas.map((c) => (
        <Tooltip key={c.etiqueta} lado="arriba" titulo={c.etiqueta} contenido={c.ayuda}>
          <div className="flex min-w-[6.5rem] flex-col justify-center border-r border-panel-border px-3 py-1.5 text-left">
            <span className={`tabular text-[15px] font-semibold leading-tight ${c.alerta ? "text-danger" : "text-foreground"}`}>{c.valor}</span>
            <span className="text-[10.5px] leading-tight text-muted">{c.etiqueta}</span>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}
