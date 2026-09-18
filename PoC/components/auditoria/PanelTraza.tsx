"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  AlertTriangle,
  Ban,
  CircleCheck,
  CircleX,
  Cpu,
  Database,
  ExternalLink,
  FileSearch,
  ScrollText,
  Send,
  UserCheck,
} from "lucide-react";
import type { Decision, EstadoSistema, Evidencia } from "@/lib/tipos-sistema";
import {
  CANAL_UI,
  confianzaColor,
  ESTADO_UI,
  focoUI,
  formatearHora,
  formatearValor,
  fuenteUI,
  nombreRol,
  riesgoColor,
  riesgoTexto,
  TAREA_UI,
} from "./ui";

interface Props {
  decision: Decision | null;
  estado: EstadoSistema | null;
  /** id de evidencia → número de cita en la última respuesta */
  numerosCita: Map<string, number>;
  citaActiva: string | null;
  reglasCitadas: Set<string>;
}

export function PanelTraza({ decision, estado, numerosCita, citaActiva, reglasCitadas }: Props) {
  const cuerpo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!citaActiva || !cuerpo.current) return;
    const el = cuerpo.current.querySelector<HTMLElement>(`[data-ev="${CSS.escape(citaActiva)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [citaActiva]);

  return (
    <section className="superficie flex min-h-0 flex-1 flex-col rounded-xl border border-panel-border bg-panel">
      <header className="flex items-center justify-between border-b border-panel-border px-3.5 py-3">
        <h2 className="etiqueta flex items-center gap-1.5">
          <FileSearch className="size-3.5" /> Traza
        </h2>
        {decision && <span className="max-w-[60%] truncate font-mono text-[10.5px] text-subtle" title={decision.id}>{decision.id}</span>}
      </header>
      <div ref={cuerpo} className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-3.5 py-3.5">
        {decision && estado ? (
          <TrazaDecision d={decision} estado={estado} numerosCita={numerosCita} citaActiva={citaActiva} reglasCitadas={reglasCitadas} />
        ) : (
          <TrazaVacia estado={estado} />
        )}
      </div>
    </section>
  );
}

function Seccion({ titulo, icono, extra, children }: { titulo: string; icono: ReactNode; extra?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="etiqueta flex items-center gap-1.5">
          {icono}
          {titulo}
        </h3>
        {extra}
      </div>
      {children}
    </div>
  );
}

function Vacio({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-panel-border px-2.5 py-2 text-[12px] text-subtle">{children}</p>;
}

function Dato({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] text-subtle">{k}</dt>
      <dd className={`truncate text-[12.5px] text-foreground ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}

function TrazaDecision({
  d,
  estado,
  numerosCita,
  citaActiva,
  reglasCitadas,
}: {
  d: Decision;
  estado: EstadoSistema;
  numerosCita: Map<string, number>;
  citaActiva: string | null;
  reglasCitadas: Set<string>;
}) {
  const est = ESTADO_UI[d.estado] ?? ESTADO_UI.pendiente;
  const IconoEstado = est.icono;
  const evidencia = useMemo(() => [...(d.evidencia ?? [])].sort((a, b) => (b.confianza ?? 0) - (a.confianza ?? 0)), [d.evidencia]);
  const porId = new Map(estado.doctrina.map((r) => [r.id, r]));
  const supera = d.riesgo > estado.umbralAutonomia;

  return (
    <>
      {/* Cabecera de la traza */}
      <div className="rounded-lg border border-panel-border bg-panel-2/50 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${est.chip}`}>
            <IconoEstado className="size-3" /> {est.etiqueta}
          </span>
          <span className="text-[11px] text-muted">{focoUI(d.foco)}</span>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2">
          <Dato k="Creada" v={formatearHora(d.creadaEn)} mono />
          <Dato k="Plazo" v={formatearHora(d.plazo)} mono />
          <Dato k="Urgencia" v={<span className="capitalize">{d.urgencia}</span>} />
        </dl>
        <div className="mt-3">
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="text-muted">Riesgo vs. umbral de autonomía</span>
            <span className="font-mono">
              <span className={riesgoTexto(d.riesgo)}>{d.riesgo}</span>
              <span className="text-subtle"> / umbral {estado.umbralAutonomia}</span>
            </span>
          </div>
          <div className="relative mt-1.5 h-1.5 rounded-full bg-panel-border">
            <div className={`h-full rounded-full ${riesgoColor(d.riesgo)}`} style={{ width: `${Math.min(100, d.riesgo)}%` }} />
            <div
              className="absolute -top-1 h-3.5 w-0.5 rounded bg-foreground"
              style={{ left: `calc(${Math.min(100, estado.umbralAutonomia)}% - 1px)` }}
              title={`Umbral de autonomía: ${estado.umbralAutonomia}`}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-muted">
            {supera ? "Supera el umbral: exige firma humana." : "Bajo el umbral: la IA puede ejecutarla sola."}
          </p>
        </div>
      </div>

      {/* Modelo */}
      <Seccion titulo="Procesado por" icono={<Cpu className="size-3.5" />}>
        {d.procesadoPor?.length ? (
          <ul className="divide-y divide-panel-border rounded-lg border border-panel-border">
            {d.procesadoPor.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[12px]">
                <span className="min-w-0 truncate font-mono text-foreground">{p.modelo}</span>
                <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted">
                  {TAREA_UI[p.tarea] ?? p.tarea}
                  <span className="font-mono text-foreground">{p.latenciaMs} ms</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Vacio>No consta qué modelo generó esta propuesta.</Vacio>
        )}
      </Seccion>

      {/* Evidencia */}
      <Seccion
        titulo="Evidencia"
        icono={<Database className="size-3.5" />}
        extra={
          <span className="text-[11px] text-subtle">
            <span className="font-mono text-muted">{evidencia.length}</span> datos ·{" "}
            <span className="font-mono text-muted">{new Set(evidencia.map((e) => e.fuente)).size}</span> fuentes
          </span>
        }
      >
        {evidencia.length ? (
          <ul className="space-y-1.5">
            {evidencia.map((e) => (
              <FilaEvidencia key={e.id} e={e} n={numerosCita.get(e.id)} activa={citaActiva === e.id} />
            ))}
          </ul>
        ) : (
          <p className="flex items-start gap-1.5 rounded-md border border-dashed border-warning/40 px-2.5 py-2 text-[12px] text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> La propuesta no aporta evidencia.
          </p>
        )}
      </Seccion>

      {/* Doctrina */}
      <Seccion titulo="Doctrina aplicada" icono={<ScrollText className="size-3.5" />}>
        {d.reglasAplicadas.length ? (
          <ul className="space-y-1.5">
            {d.reglasAplicadas.map((id) => {
              const r = porId.get(id);
              const citada = reglasCitadas.has(id);
              return (
                <li
                  key={id}
                  className={`rounded-lg border px-2.5 py-2 ${citada ? "border-accent/50 bg-accent/[0.07]" : "border-panel-border bg-panel-2/40"}`}
                >
                  {r ? (
                    <>
                      <p className="text-[12.5px] leading-snug text-foreground">{r.reglaNormalizada}</p>
                      <p className="mt-1 text-[11px] italic text-muted">“{r.texto}”</p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-subtle">
                        <span className="font-mono">{id}</span>
                        <span>{r.ambito === "global" ? "permanente" : "este incidente"}</span>
                        <span>· {nombreRol(r.origen.rol)}</span>
                        <span>
                          · aplicada <span className="font-mono text-muted">{r.vecesAplicada}</span>×
                        </span>
                        {!r.activa && <span className="text-warning">· desactivada</span>}
                      </p>
                    </>
                  ) : (
                    <p className="text-[12px] text-muted">
                      <span className="font-mono">{id}</span> · ya no está en la doctrina vigente
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Vacio>No se aplicó ninguna regla de doctrina.</Vacio>
        )}
      </Seccion>

      {/* Alternativas descartadas */}
      <Seccion titulo="Alternativas descartadas" icono={<Ban className="size-3.5" />}>
        {d.alternativasDescartadas?.length ? (
          <ul className="space-y-1.5">
            {d.alternativasDescartadas.map((a, i) => (
              <li key={i} className="rounded-lg border border-panel-border bg-panel-2/40 px-2.5 py-2">
                <p className="text-[12.5px] font-medium leading-snug text-foreground line-through decoration-subtle">{a.opcion}</p>
                <p className="mt-1 text-[11.5px] leading-snug text-muted">{a.motivo}</p>
              </li>
            ))}
          </ul>
        ) : (
          <Vacio>El agente no registró alternativas para esta propuesta.</Vacio>
        )}
      </Seccion>

      {/* Decisión humana */}
      <Seccion titulo="Supervisión humana" icono={<UserCheck className="size-3.5" />}>
        {d.decididaPor ? (
          <div className="rounded-lg border border-panel-border bg-panel-2/40 px-2.5 py-2">
            <dl className="grid grid-cols-3 gap-2">
              <Dato k="Rol" v={nombreRol(d.decididaPor.rol)} />
              <Dato k="Vía" v={d.decididaPor.via === "voz" ? "Voz" : "Panel"} />
              <Dato k="Hora" v={formatearHora(d.decididaPor.timestamp)} mono />
            </dl>
            {d.feedback && (
              <p className="mt-2 border-l-2 border-accent/50 pl-2 text-[12px] italic text-foreground/90">“{d.feedback}”</p>
            )}
          </div>
        ) : d.estado === "auto" ? (
          <Vacio>Ejecutada por la IA sin firma: el riesgo estaba bajo el umbral de autonomía.</Vacio>
        ) : (
          <Vacio>Sin firma humana todavía.</Vacio>
        )}
        {!d.decididaPor && d.feedback && (
          <p className="mt-1.5 border-l-2 border-accent/50 pl-2 text-[12px] italic text-foreground/90">“{d.feedback}”</p>
        )}
        {d.motivoInvalidacion && (
          <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-panel-border-strong bg-panel-2 px-2.5 py-2 text-[12px] text-muted">
            <Ban className="mt-0.5 size-3.5 shrink-0" /> {d.motivoInvalidacion}
          </p>
        )}
      </Seccion>

      {/* Ejecución */}
      <Seccion titulo="Ejecución" icono={<Send className="size-3.5" />}>
        {d.resultadoEjecucion?.length ? (
          <ul className="divide-y divide-panel-border rounded-lg border border-panel-border">
            {d.resultadoEjecucion.map((r, i) => {
              const canal = CANAL_UI[r.canal] ?? CANAL_UI.interno;
              const IconoCanal = canal.icono;
              return (
                <li key={`${r.accionId}-${i}`} className="px-2.5 py-2">
                  <div className="flex items-center gap-2 text-[12px]">
                    {r.ok ? <CircleCheck className="size-3.5 text-success" /> : <CircleX className="size-3.5 text-danger" />}
                    <IconoCanal className="size-3.5 text-muted" />
                    <span className="text-foreground">{canal.etiqueta}</span>
                    <span className="text-muted">· {r.proveedor}</span>
                    <span className="ml-auto font-mono text-[10.5px] text-subtle">{formatearHora(r.timestamp)}</span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-muted">{r.detalle}</p>
                  <p className="mt-0.5 truncate font-mono text-[10.5px] text-subtle" title={r.ref}>ref {r.ref}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <Vacio>Sin acciones ejecutadas.</Vacio>
        )}
      </Seccion>
    </>
  );
}

function FilaEvidencia({ e, n, activa }: { e: Evidencia; n?: number; activa: boolean }) {
  const { etiqueta, icono: Icono } = fuenteUI(e.fuente);
  const conf = Math.max(0, Math.min(1, e.confianza ?? 0));
  const guion = e.fuente === "Escenario";
  const valor = e.unidad === "confianza" ? null : formatearValor(e.valor, e.unidad);
  return (
    <li
      data-ev={e.id}
      className={`rounded-lg border px-2.5 py-2 transition ${
        activa
          ? "border-accent bg-accent/10 ring-2 ring-accent/30"
          : n
            ? "border-accent/35 bg-accent/[0.04]"
            : "border-panel-border bg-panel-2/40"
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-px flex size-5 shrink-0 items-center justify-center rounded ${guion ? "bg-warning/15 text-warning" : "bg-panel-2 text-muted"}`}
          title={etiqueta}
        >
          <Icono className="size-3" />
        </span>
        <p className="min-w-0 flex-1 text-[12px] leading-snug text-foreground/90">{e.descripcion}</p>
        {n !== undefined && (
          <span className="shrink-0 rounded bg-accent/15 px-1 font-mono text-[10.5px] font-semibold text-accent">[{n}]</span>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-7 text-[10.5px] text-muted">
        <span className="font-medium text-muted">{etiqueta}</span>
        {guion && <span className="rounded border border-warning/40 px-1 font-semibold uppercase text-warning">guion</span>}
        {valor && valor !== "—" && <span className="font-mono text-foreground">{valor}</span>}
        <span className="flex items-center gap-1" title={`Confianza ${Math.round(conf * 100)} %`}>
          <span className="h-1 w-10 overflow-hidden rounded-sm bg-panel-border">
            <span className={`block h-full ${confianzaColor(conf)}`} style={{ width: `${conf * 100}%` }} />
          </span>
          <span className="font-mono">{Math.round(conf * 100)}%</span>
        </span>
        <span className="font-mono text-subtle">{formatearHora(e.timestamp)}</span>
        {e.url && (
          <a href={e.url} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-0.5 text-accent hover:underline">
            origen <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </li>
  );
}

function TrazaVacia({ estado }: { estado: EstadoSistema | null }) {
  const doctrina = estado?.doctrina ?? [];
  return (
    <>
      <div className="rounded-lg border border-dashed border-panel-border px-4 py-6 text-center">
        <FileSearch className="mx-auto size-5 text-subtle" />
        <p className="mt-2 text-[13px] text-muted">Selecciona una propuesta para ver su traza</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-subtle">
          Evidencia con fuente y confianza, reglas de doctrina aplicadas, modelo que la generó, quién la firmó y qué se ejecutó.
        </p>
      </div>
      <Seccion titulo="Doctrina vigente" icono={<ScrollText className="size-3.5" />} extra={<span className="font-mono text-[11px] text-subtle">{doctrina.length}</span>}>
        {doctrina.length ? (
          <ul className="space-y-1.5">
            {doctrina.map((r) => (
              <li key={r.id} className="rounded-lg border border-panel-border bg-panel-2/40 px-2.5 py-2">
                <p className="text-[12.5px] leading-snug text-foreground">{r.reglaNormalizada}</p>
                <p className="mt-1 text-[10.5px] text-subtle">
                  {r.ambito === "global" ? "permanente" : "este incidente"} · {nombreRol(r.origen.rol)} · aplicada{" "}
                  <span className="font-mono text-muted">{r.vecesAplicada}</span>×{!r.activa && " · desactivada"}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Vacio>La IA aún no ha aprendido reglas: se crean cuando un responsable deniega una propuesta y explica por qué.</Vacio>
        )}
      </Seccion>
    </>
  );
}
