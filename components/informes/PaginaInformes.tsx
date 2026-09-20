"use client";
// =====================================================================
// ATALAYA INCENDIOS · Pantalla de informes (auditoría)
// ---------------------------------------------------------------------
// DUEÑO: constructor C.
// Cada decisión y cada acción de los agentes deja un acta con su huella
// SHA-256. Aquí se filtran por tipo, incendio, agente y estado, se leen en
// markdown y se descargan (una o todas).
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Informe } from "@/lib/dominio/tipos";

type ResumenInforme = Omit<Informe, "contenido"> & { caracteres: number };

const TIPOS: { valor: string; texto: string }[] = [
  { valor: "", texto: "Todos los tipos" },
  { valor: "decision", texto: "Decisiones" },
  { valor: "accion", texto: "Acciones" },
  { valor: "situacion", texto: "Partes de situación" },
  { valor: "postmortem", texto: "Post-mortem" },
  { valor: "ciclo", texto: "Ciclos de agente" },
];

const COLOR_TIPO: Record<string, string> = {
  decision: "bg-blue-100 text-blue-900",
  accion: "bg-teal-100 text-teal-900",
  situacion: "bg-slate-200 text-slate-800",
  postmortem: "bg-purple-100 text-purple-900",
  ciclo: "bg-amber-100 text-amber-900",
};

function fecha(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}

export function PaginaInformes() {
  const [informes, setInformes] = useState<ResumenInforme[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string>();
  const [seleccionado, setSeleccionado] = useState<Informe>();
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  const [tipo, setTipo] = useState("");
  const [incendioId, setIncendioId] = useState("");
  const [agenteId, setAgenteId] = useState("");
  const [estadoDecision, setEstadoDecision] = useState("");

  const cargar = useCallback(async () => {
    // Nada de setState síncrono aquí: el efecto que la llama dispararía
    // renderizados en cascada (regla react-hooks/set-state-in-effect).
    try {
      const r = await fetch("/api/informes", { cache: "no-store" });
      const d = (await r.json()) as { informes?: ResumenInforme[]; error?: string };
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setInformes(d.informes ?? []);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    const inmediato = setTimeout(() => void cargar(), 0);
    const periodico = setInterval(() => void cargar(), 20_000);
    return () => {
      clearTimeout(inmediato);
      clearInterval(periodico);
    };
  }, [cargar]);

  const incendios = useMemo(() => [...new Set(informes.map((i) => i.incendioId).filter(Boolean))] as string[], [informes]);
  const agentes = useMemo(() => [...new Set(informes.map((i) => i.agenteId).filter(Boolean))] as string[], [informes]);
  const estados = useMemo(() => [...new Set(informes.map((i) => i.estadoDecision).filter(Boolean))] as string[], [informes]);

  const filtrados = useMemo(
    () =>
      informes.filter(
        (i) =>
          (!tipo || i.tipo === tipo) &&
          (!incendioId || i.incendioId === incendioId) &&
          (!agenteId || i.agenteId === agenteId) &&
          (!estadoDecision || i.estadoDecision === estadoDecision),
      ),
    [informes, tipo, incendioId, agenteId, estadoDecision],
  );

  const abrir = useCallback(async (id: string) => {
    setCargandoDetalle(true);
    try {
      const r = await fetch(`/api/informes/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (r.ok) setSeleccionado((await r.json()) as Informe);
    } finally {
      setCargandoDetalle(false);
    }
  }, []);

  const descargarTodos = useCallback(async () => {
    // Primero se intenta la exportación de auditoría del núcleo; si no existe
    // todavía, se concatenan aquí los informes filtrados.
    try {
      const r = await fetch("/api/auditoria/exportar", { cache: "no-store" });
      if (r.ok) {
        descargar(await r.text(), `auditoria-${Date.now()}.md`);
        return;
      }
    } catch {
      // Sin endpoint de exportación: seguimos con el plan B.
    }
    const partes: string[] = [];
    for (const i of filtrados) {
      const r = await fetch(`/api/informes/${encodeURIComponent(i.id)}?formato=md`, { cache: "no-store" });
      if (r.ok) partes.push(await r.text());
    }
    descargar(partes.join("\n\n---\n\n"), `informes-${Date.now()}.md`);
  }, [filtrados]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 text-slate-900">
      <header className="mb-5">
        <Link href="/" className="text-sm text-blue-700 underline underline-offset-2 hover:text-blue-900">
          ← Volver a la sala de mando
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Informes y auditoría</h1>
        <p className="text-sm text-slate-600">
          Un acta por cada decisión y por cada acción: qué se sabía, quién lo autorizó, qué se ejecutó de verdad y con qué
          base legal. Cada acta lleva su huella SHA-256.
        </p>
      </header>

      <section className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <Filtro etiqueta="Tipo" valor={tipo} alCambiar={setTipo} opciones={TIPOS} />
        <Filtro
          etiqueta="Incendio"
          valor={incendioId}
          alCambiar={setIncendioId}
          opciones={[{ valor: "", texto: "Todos" }, ...incendios.map((v) => ({ valor: v, texto: v }))]}
        />
        <Filtro
          etiqueta="Agente"
          valor={agenteId}
          alCambiar={setAgenteId}
          opciones={[{ valor: "", texto: "Todos" }, ...agentes.map((v) => ({ valor: v, texto: v }))]}
        />
        <Filtro
          etiqueta="Estado de la decisión"
          valor={estadoDecision}
          alCambiar={setEstadoDecision}
          opciones={[{ valor: "", texto: "Todos" }, ...estados.map((v) => ({ valor: v, texto: v }))]}
        />
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => void cargar()}
            className="min-h-[44px] rounded-lg border border-slate-300 px-4 text-sm hover:border-blue-500"
          >
            Actualizar
          </button>
          <button
            type="button"
            onClick={() => void descargarTodos()}
            disabled={!filtrados.length}
            className="min-h-[44px] rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 disabled:bg-slate-300"
          >
            Descargar todos ({filtrados.length})
          </button>
        </div>
      </section>

      {error && (
        <p className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
          No se pudieron cargar los informes: {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,2fr)_3fr]">
        <section>
          {cargando && !informes.length ? (
            <p className="p-6 text-center text-slate-500">Cargando…</p>
          ) : filtrados.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
              <p className="font-medium text-slate-700">Todavía no hay actas</p>
              <p className="mt-1 text-sm text-slate-500">
                Se generan solas en cuanto un agente propone una decisión o ejecuta una acción. Arranca una ejecución en la
                sala de mando.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {filtrados.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => void abrir(i.id)}
                    className={`w-full rounded-lg border p-3 text-left transition hover:border-blue-500 ${
                      seleccionado?.id === i.id ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded px-1.5 py-0.5 ${COLOR_TIPO[i.tipo] ?? "bg-slate-100"}`}>{i.tipo}</span>
                      {i.estadoDecision && <span className="rounded bg-slate-100 px-1.5 py-0.5">{i.estadoDecision}</span>}
                      {i.agenteId && <span className="text-slate-500">{i.agenteId}</span>}
                      <span className="ml-auto text-slate-400">{fecha(i.generadoEn)}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium leading-snug">{i.titulo}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {i.conNarrativaIA === false ? "Acta determinista (sin IA) · " : ""}
                      {i.caracteres} caracteres
                      {i.huella ? ` · huella ${i.huella.slice(0, 12)}…` : ""}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {cargandoDetalle ? (
            <p className="p-6 text-center text-slate-500">Abriendo el acta…</p>
          ) : !seleccionado ? (
            <div className="p-8 text-center">
              <p className="font-medium text-slate-700">Elige un acta a la izquierda</p>
              <p className="mt-1 text-sm text-slate-500">Se lee entera, con su traza de agente y su huella.</p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 pb-3">
                <div>
                  <h2 className="text-lg font-semibold">{seleccionado.titulo}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {fecha(seleccionado.generadoEn)} · modelo {seleccionado.modelo}
                    {seleccionado.decisionId ? ` · decisión ${seleccionado.decisionId}` : ""}
                    {seleccionado.accionId ? ` · acción ${seleccionado.accionId}` : ""}
                  </p>
                  {seleccionado.huella && (
                    <p className="mt-0.5 break-all font-mono text-[11px] text-slate-400">SHA-256 {seleccionado.huella}</p>
                  )}
                </div>
                <a
                  href={`/api/informes/${encodeURIComponent(seleccionado.id)}?formato=md`}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-4 py-2 text-sm hover:border-blue-500"
                  download
                >
                  Descargar .md
                </a>
              </div>
              <article className="prose-sm max-w-none text-sm leading-relaxed [&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-semibold [&_li]:my-0.5 [&_p]:my-2 [&_table]:my-3 [&_table]:w-full [&_table]:text-xs [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc [&_ul]:pl-5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{seleccionado.contenido}</ReactMarkdown>
              </article>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function Filtro({
  etiqueta,
  valor,
  alCambiar,
  opciones,
}: {
  etiqueta: string;
  valor: string;
  alCambiar: (v: string) => void;
  opciones: { valor: string; texto: string }[];
}) {
  return (
    <label className="text-sm">
      <span className="block text-xs font-medium text-slate-600">{etiqueta}</span>
      <select
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        className="mt-0.5 min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm"
      >
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
    </label>
  );
}

function descargar(texto: string, nombre: string): void {
  const url = URL.createObjectURL(new Blob([texto], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}
