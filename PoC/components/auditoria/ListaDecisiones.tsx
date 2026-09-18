"use client";

import { useMemo, useState } from "react";
import { Cpu, Inbox, MessagesSquare } from "lucide-react";
import type { Decision, EstadoDecision } from "@/lib/tipos-sistema";
import { ESTADO_UI, focoUI, formatearHora, modeloDe, riesgoColor, URGENCIA_UI } from "./ui";

type Filtro = "todas" | "pendiente" | "ejecutada" | "auto" | "denegada" | "invalidada";

const FILTROS: { id: Filtro; etiqueta: string }[] = [
  { id: "todas", etiqueta: "Todas" },
  { id: "pendiente", etiqueta: "Pendientes" },
  { id: "ejecutada", etiqueta: "Ejecutadas" },
  { id: "auto", etiqueta: "Autónomas" },
  { id: "denegada", etiqueta: "Denegadas" },
  { id: "invalidada", etiqueta: "Invalidadas" },
];

function encaja(estado: EstadoDecision, f: Filtro) {
  if (f === "todas") return true;
  if (f === "ejecutada") return estado === "ejecutada" || estado === "ejecutando";
  return estado === f;
}

interface Props {
  decisiones: Decision[];
  seleccion: string | null;
  onSeleccionar: (id: string | null) => void;
  conPreguntas: Set<string>;
  cargando: boolean;
}

export function ListaDecisiones({ decisiones, seleccion, onSeleccionar, conPreguntas, cargando }: Props) {
  const [filtro, setFiltro] = useState<Filtro>("todas");

  const ordenadas = useMemo(
    () => [...decisiones].sort((a, b) => Date.parse(b.creadaEn) - Date.parse(a.creadaEn)),
    [decisiones],
  );
  const cuentas = useMemo(() => {
    const c: Record<Filtro, number> = { todas: 0, pendiente: 0, ejecutada: 0, auto: 0, denegada: 0, invalidada: 0 };
    for (const d of decisiones) for (const f of FILTROS) if (encaja(d.estado, f.id)) c[f.id]++;
    return c;
  }, [decisiones]);
  const visibles = ordenadas.filter((d) => encaja(d.estado, filtro));

  return (
    <section className="superficie flex min-h-0 flex-1 flex-col rounded-xl border border-panel-border bg-panel">
      <header className="border-b border-panel-border px-3.5 pb-3 pt-3">
        <div className="flex items-center justify-between">
          <h2 className="etiqueta">Propuestas de la IA</h2>
          <span className="font-mono text-[11px] text-subtle">{decisiones.length}</span>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1" role="tablist" aria-label="Filtrar por estado">
          {FILTROS.map((f) => {
            const activo = filtro === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={activo}
                onClick={() => setFiltro(f.id)}
                className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition ${
                  activo
                    ? "border-accent/50 bg-accent/10 text-foreground"
                    : "border-panel-border text-muted hover:border-panel-border-strong hover:text-foreground"
                }`}
              >
                {f.etiqueta}
                <span className={`font-mono text-[10px] ${activo ? "text-accent" : "text-subtle"}`}>{cuentas[f.id]}</span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
        <button
          type="button"
          onClick={() => onSeleccionar(null)}
          aria-current={seleccion === null ? "true" : undefined}
          className={`mb-1.5 flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${
            seleccion === null
              ? "border-accent/50 bg-accent/10"
              : "border-transparent hover:border-panel-border hover:bg-panel-2"
          }`}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
            <MessagesSquare className="size-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-foreground">Interrogatorio general</span>
            <span className="block text-[11px] text-muted">Actividad, doctrina y modelos del incidente</span>
          </span>
        </button>

        {cargando && decisiones.length === 0 ? (
          <ul className="space-y-1.5" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="h-[74px] animate-pulse rounded-lg border border-panel-border bg-panel-2/60" />
            ))}
          </ul>
        ) : visibles.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-panel-border px-4 py-8 text-center">
            <Inbox className="size-5 text-subtle" />
            <p className="text-[13px] text-muted">
              {decisiones.length === 0 ? "La IA aún no ha propuesto decisiones" : "Ninguna decisión con este estado"}
            </p>
            <p className="text-[11px] leading-relaxed text-subtle">
              {decisiones.length === 0
                ? "Cada propuesta del agente aparecerá aquí con su traza completa para auditarla."
                : "Cambia el filtro para ver el resto del historial."}
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {visibles.map((d) => (
              <FilaDecision
                key={d.id}
                d={d}
                activa={seleccion === d.id}
                preguntada={conPreguntas.has(d.id)}
                onClick={() => onSeleccionar(d.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function FilaDecision({ d, activa, preguntada, onClick }: { d: Decision; activa: boolean; preguntada: boolean; onClick: () => void }) {
  const est = ESTADO_UI[d.estado] ?? ESTADO_UI.pendiente;
  const urg = URGENCIA_UI[d.urgencia] ?? URGENCIA_UI.media;
  const Icono = est.icono;
  const modelo = modeloDe(d);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={activa ? "true" : undefined}
        className={`group relative flex w-full flex-col gap-1.5 overflow-hidden rounded-lg border py-2 pl-3.5 pr-2.5 text-left transition ${
          activa
            ? "border-accent/50 bg-accent/[0.07]"
            : "border-panel-border bg-panel-2/40 hover:border-panel-border-strong hover:bg-panel-2"
        }`}
      >
        <span className={`absolute inset-y-0 left-0 w-[3px] ${urg.franja}`} aria-hidden="true" />
        <div className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
            {d.tarjeta?.titulo ?? focoUI(d.foco)}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-subtle">{formatearHora(d.creadaEn, false)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <span className="text-muted">{focoUI(d.foco)}</span>
          <span className={`flex items-center gap-1 ${est.color}`}>
            <Icono className={`size-3 ${d.estado === "ejecutando" ? "animate-spin" : ""}`} />
            {est.corta}
          </span>
          {preguntada && (
            <span className="flex items-center gap-0.5 text-accent" title="Ya la has interrogado">
              <MessagesSquare className="size-3" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10.5px]">
          <span className={`rounded border px-1 py-px font-semibold uppercase tracking-wide ${urg.badge}`}>{urg.etiqueta}</span>
          <span className="flex items-center gap-1 text-muted" title={`Riesgo ${d.riesgo}/100`}>
            riesgo
            <span className="h-1 w-8 overflow-hidden rounded-sm bg-panel-border">
              <span className={`block h-full ${riesgoColor(d.riesgo)}`} style={{ width: `${Math.min(100, d.riesgo)}%` }} />
            </span>
            <span className="font-mono text-foreground">{d.riesgo}</span>
          </span>
          {modelo && (
            <span className="ml-auto flex min-w-0 items-center gap-1 text-subtle" title={`Generada por ${modelo}`}>
              <Cpu className="size-3 shrink-0" />
              <span className="truncate font-mono">{modelo}</span>
            </span>
          )}
        </div>
      </button>
    </li>
  );
}
