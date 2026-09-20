"use client";
// Auditoría: línea de tiempo con TODO lo que ha pasado en la ejecución y, al
// pulsar una decisión, su cadena completa. DUEÑO: constructor E.
//
// Nada se resume ni se pierde: cada entrada dice qué pasó, cuándo (hora de
// mundo), quién lo hizo y con qué resultado real.

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Brain,
  CheckCircle2,
  Eye,
  FileText,
  Flame,
  Megaphone,
  Search,
  ShieldCheck,
  Truck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { Decision, Snapshot } from "@/lib/dominio/tipos";
import { useEstado } from "@/lib/cliente/useEstado";
import { fechaHora, hora, recortar } from "@/lib/cliente/formato";
import { Boton } from "@/components/ui/Boton";
import { Insignia, TEXTO_ESTADO_DECISION } from "@/components/ui/Insignia";
import { Vacio } from "@/components/ui/Vacio";
import { Marca } from "@/components/marca/Logo";
import { SelectorTema } from "@/components/marca/SelectorTema";
import { CadenaAuditoria } from "@/components/sala/CadenaAuditoria";
import { DialogoInforme } from "@/components/sala/DialogoInforme";
import type { Informe } from "@/lib/dominio/tipos";

type TipoEntrada = "decision" | "estado" | "accion" | "informe" | "observacion" | "evento";

interface Entrada {
  id: string;
  en: string;
  enMundo: string;
  tipo: TipoEntrada;
  titulo: string;
  detalle?: string;
  quien?: string;
  incendioId?: string;
  agenteId?: string;
  decisionId?: string;
  informeId?: string;
  /** Rojo si algo falló o se denegó. */
  alerta?: boolean;
  /** Texto adicional en el que también busca el buscador. */
  busqueda: string;
}

const ICONOS: Record<TipoEntrada, LucideIcon> = {
  decision: Brain,
  estado: ShieldCheck,
  accion: Truck,
  informe: FileText,
  observacion: Megaphone,
  evento: Flame,
};

const TEXTO_TIPO: Record<TipoEntrada, string> = {
  decision: "Decisión",
  estado: "Cambio de estado",
  accion: "Acción ejecutada",
  informe: "Acta",
  observacion: "Observación",
  evento: "Evento crítico",
};

/** Aplana todo lo auditable del Snapshot en una sola línea de tiempo. */
function construirEntradas(snapshot?: Snapshot): Entrada[] {
  if (!snapshot) return [];
  const entradas: Entrada[] = [];

  for (const d of snapshot.decisiones) {
    entradas.push({
      id: `dec-${d.id}`,
      en: d.creadaEn,
      enMundo: d.creadaEnMundo || d.creadaEn,
      tipo: "decision",
      titulo: d.titulo,
      detalle: d.resumen,
      quien: d.agenteId,
      incendioId: d.incendioId,
      agenteId: d.agenteId,
      decisionId: d.id,
      alerta: d.estado === "denegada" || d.estado === "fallida" || d.estado === "escalada",
      busqueda: `${d.titulo} ${d.resumen} ${d.razonamiento} ${d.agenteId} ${d.id}`,
    });

    for (const h of d.historial ?? []) {
      entradas.push({
        id: `est-${d.id}-${h.en}-${h.estado}`,
        en: h.en,
        enMundo: h.enMundo || h.en,
        tipo: "estado",
        titulo: `${d.titulo} → ${TEXTO_ESTADO_DECISION[h.estado]}`,
        detalle: h.motivo,
        quien: h.quien,
        incendioId: d.incendioId,
        agenteId: d.agenteId,
        decisionId: d.id,
        alerta: h.estado === "denegada" || h.estado === "fallida",
        busqueda: `${d.titulo} ${h.estado} ${h.quien} ${h.motivo ?? ""}`,
      });
    }

    for (const a of d.acciones) {
      if (!a.ejecutadaEn && !a.ordenadaEn) continue;
      entradas.push({
        id: `acc-${a.id}`,
        en: a.ejecutadaEn ?? a.ordenadaEn ?? d.creadaEn,
        enMundo: a.ejecutadaEn ?? a.ordenadaEn ?? d.creadaEnMundo,
        tipo: "accion",
        titulo: a.descripcion,
        detalle: a.resultado ? `${a.resultado.proveedor}: ${a.resultado.resumen}` : `Estado: ${a.estado}`,
        quien: a.autorizadaPor ?? d.decididaPor ?? d.agenteId,
        incendioId: d.incendioId,
        agenteId: d.agenteId,
        decisionId: d.id,
        informeId: a.informeId,
        alerta: a.estado === "fallida" || a.resultado?.exito === false,
        busqueda: `${a.descripcion} ${a.tipo} ${a.resultado?.resumen ?? ""} ${a.resultado?.referencia ?? ""}`,
      });
    }
  }

  for (const i of snapshot.informes ?? []) {
    entradas.push({
      id: `inf-${i.id}`,
      en: i.generadoEn,
      enMundo: i.generadoEn,
      tipo: "informe",
      titulo: i.titulo,
      detalle: recortar(i.contenido.replace(/[#*`>_-]/g, " ").replace(/\s+/g, " ").trim(), 180),
      quien: i.agenteId ?? i.modelo,
      incendioId: i.incendioId,
      agenteId: i.agenteId,
      decisionId: i.decisionId,
      informeId: i.id,
      busqueda: `${i.titulo} ${i.contenido}`,
    });
  }

  for (const o of snapshot.observaciones) {
    entradas.push({
      id: `obs-${o.id}`,
      en: o.recibidaEn,
      enMundo: o.recibidaEn,
      tipo: "observacion",
      titulo: `${o.canal}: ${recortar(o.extraccion?.resumen || o.texto, 110)}`,
      detalle: o.verificacion ?? (o.impacto ? `Impacto: ${o.impacto}` : undefined),
      quien: o.remitente,
      incendioId: o.incendioId,
      busqueda: `${o.texto} ${o.remitente ?? ""} ${o.extraccion?.resumen ?? ""} ${o.verificacion ?? ""}`,
    });
  }

  for (const e of snapshot.eventos) {
    if (e.nivel === "info") continue;
    entradas.push({
      id: `ev-${e.id}`,
      en: e.en,
      enMundo: e.enMundo || e.en,
      tipo: "evento",
      titulo: e.mensaje,
      quien: e.agenteId,
      incendioId: e.incendioId,
      agenteId: e.agenteId,
      alerta: e.nivel === "critico",
      busqueda: `${e.mensaje} ${e.tipo} ${e.agenteId ?? ""}`,
    });
  }

  return entradas.sort((a, b) => b.en.localeCompare(a.en));
}

function PaginaAuditoria() {
  const { snapshot, cargando } = useEstado();
  const router = useRouter();
  const parametros = useSearchParams();
  const decisionId = parametros.get("decision") ?? undefined;

  const [texto, setTexto] = useState("");
  const [incendioId, setIncendioId] = useState("todos");
  const [agenteId, setAgenteId] = useState("todos");
  const [tipo, setTipo] = useState<TipoEntrada | "todos">("todos");
  const [desde, setDesde] = useState("");
  const [acta, setActa] = useState<Informe | null>(null);

  const todas = useMemo(() => construirEntradas(snapshot), [snapshot]);

  const filtradas = useMemo(() => {
    const busqueda = texto.trim().toLowerCase();
    const limite = desde ? new Date(desde).getTime() : null;
    return todas.filter((e) => {
      if (incendioId !== "todos" && e.incendioId !== incendioId) return false;
      if (agenteId !== "todos" && e.agenteId !== agenteId) return false;
      if (tipo !== "todos" && e.tipo !== tipo) return false;
      if (limite && new Date(e.en).getTime() < limite) return false;
      if (busqueda && !e.busqueda.toLowerCase().includes(busqueda)) return false;
      return true;
    });
  }, [todas, texto, incendioId, agenteId, tipo, desde]);

  const decision: Decision | undefined = decisionId ? snapshot?.decisiones.find((d) => d.id === decisionId) : undefined;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-3 border-b border-panel-border pb-2">
        <Link href="/" className="rounded-lg">
          <Marca organismo="Auditoría · trazabilidad completa" />
        </Link>
        <Link href="/" className="ml-auto">
          <Boton icono={<ArrowLeft />}>Volver a la sala</Boton>
        </Link>
        <SelectorTema compacto />
      </header>

      <p className="text-[13px] leading-snug text-muted">
        Todo lo que han hecho los agentes y las personas en esta ejecución, en orden y con su acta. Pulsa cualquier decisión para ver su
        cadena completa: qué vio el agente, qué pensó, quién lo autorizó y qué pasó de verdad.
      </p>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Línea de tiempo */}
        <section className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <label htmlFor="buscar" className="solo-lectores">
              Buscar en la auditoría
            </label>
            <span className="relative flex min-w-[12rem] flex-1 items-center">
              <Search className="pointer-events-none absolute left-2 size-4 text-subtle" aria-hidden />
              <input
                id="buscar"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Buscar por texto, teléfono, referencia, agente…"
                className="min-h-11 w-full rounded-lg border border-panel-border-strong bg-panel pl-8 pr-2 text-sm text-foreground placeholder:text-subtle"
              />
            </span>
            <select
              aria-label="Filtrar por foco"
              value={incendioId}
              onChange={(e) => setIncendioId(e.target.value)}
              className="min-h-11 rounded-lg border border-panel-border-strong bg-panel px-2 text-[12.5px] text-foreground"
            >
              <option value="todos">Todos los focos</option>
              {snapshot?.incendios.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtrar por agente"
              value={agenteId}
              onChange={(e) => setAgenteId(e.target.value)}
              className="min-h-11 rounded-lg border border-panel-border-strong bg-panel px-2 text-[12.5px] text-foreground"
            >
              <option value="todos">Todos los agentes</option>
              {snapshot?.agentes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtrar por tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoEntrada | "todos")}
              className="min-h-11 rounded-lg border border-panel-border-strong bg-panel px-2 text-[12.5px] text-foreground"
            >
              <option value="todos">Todo</option>
              {(Object.keys(TEXTO_TIPO) as TipoEntrada[]).map((t) => (
                <option key={t} value={t}>
                  {TEXTO_TIPO[t]}
                </option>
              ))}
            </select>
            <label htmlFor="desde" className="solo-lectores">
              Desde
            </label>
            <input
              id="desde"
              type="datetime-local"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="min-h-11 rounded-lg border border-panel-border-strong bg-panel px-2 text-[12.5px] text-foreground"
            />
          </div>

          <p className="mb-1.5 text-[11.5px] text-subtle">
            {filtradas.length} de {todas.length} entradas
          </p>

          {filtradas.length === 0 ? (
            <Vacio
              icono={<Eye />}
              titulo={cargando ? "Cargando la auditoría…" : "No hay nada que auditar con esos filtros"}
              guia={
                todas.length === 0
                  ? "En cuanto los agentes decidan o actúen, cada paso quedará aquí con su acta."
                  : "Prueba a quitar filtros o a buscar otra cosa."
              }
            />
          ) : (
            <ol className="divide-y divide-panel-border rounded-xl border border-panel-border bg-panel">
              {filtradas.slice(0, 400).map((e) => {
                const Icono = ICONOS[e.tipo];
                const seleccionada = e.decisionId && e.decisionId === decisionId;
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      disabled={!e.decisionId && !e.informeId}
                      onClick={() => {
                        if (e.decisionId) router.push(`/auditoria?decision=${encodeURIComponent(e.decisionId)}`);
                        else if (e.informeId) setActa((snapshot?.informes ?? []).find((i) => i.id === e.informeId) ?? null);
                      }}
                      className={[
                        "flex w-full items-start gap-2 px-2.5 py-2 text-left",
                        e.decisionId || e.informeId ? "hover:bg-panel-2" : "cursor-default",
                        seleccionada ? "bg-brand/10" : "",
                      ].join(" ")}
                    >
                      <Icono className={`mt-0.5 size-4 shrink-0 ${e.alerta ? "text-danger" : "text-muted"}`} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium leading-snug text-foreground">{e.titulo}</span>
                        {e.detalle ? <span className="mt-0.5 block text-[12px] leading-snug text-muted">{e.detalle}</span> : null}
                        <span className="mt-1 flex flex-wrap items-center gap-1">
                          <Insignia pequena tono={e.alerta ? "peligro" : "neutro"}>{TEXTO_TIPO[e.tipo]}</Insignia>
                          {e.quien ? <span className="text-[10.5px] text-subtle">{e.quien}</span> : null}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-[11px] text-subtle" title={fechaHora(e.en)}>
                        {hora(e.enMundo || e.en)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* Cadena de la decisión seleccionada */}
        <section className="min-w-0">
          {decision ? (
            <CadenaAuditoria decision={decision} snapshot={snapshot} />
          ) : decisionId ? (
            <Vacio
              icono={<XCircle />}
              titulo={`No se encuentra la decisión «${decisionId}»`}
              guia="Puede que pertenezca a otra ejecución. El histórico completo está en la base de datos."
            />
          ) : (
            <Vacio
              icono={<CheckCircle2 />}
              titulo="Elige una decisión"
              guia="Pulsa cualquier decisión o acción de la izquierda para ver su cadena de auditoría completa, y expórtala en Markdown si necesitas justificarla."
            />
          )}
        </section>
      </div>

      <DialogoInforme informe={acta} onCerrar={() => setActa(null)} />
    </div>
  );
}

export default function Auditoria() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted">Cargando la auditoría…</p>}>
      <PaginaAuditoria />
    </Suspense>
  );
}
