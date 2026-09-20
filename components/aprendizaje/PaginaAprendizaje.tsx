"use client";
// =====================================================================
// ATALAYA INCENDIOS · Pantalla de aprendizaje
// ---------------------------------------------------------------------
// DUEÑO: constructor C.
// Responde a la pregunta del jurado: "¿esto aprende de verdad?".
//   · Qué cambió esta vez respecto a la ejecución anterior (cifras, no humo).
//   · Tabla de ejecuciones con sus métricas.
//   · Lecciones con su evidencia, su peso, cuántas veces se han aplicado,
//     de dónde salieron y a qué agente afectan.
//   · Uso real de los modelos (llamadas, tokens, latencia, errores).
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Ejecucion, Leccion } from "@/lib/dominio/tipos";

interface ContadorPapel {
  llamadas: number;
  tokensEntrada: number;
  tokensSalida: number;
  errores: number;
  latenciaMediaMs: number;
  ultimoError?: string;
}

interface Datos {
  ejecucionActual: string;
  ejecuciones: Ejecucion[];
  lecciones: Leccion[];
  estadisticasLLM: {
    proveedor: string;
    disponible: boolean;
    modelos: Record<string, string>;
    porPapel: Record<string, ContadorPapel>;
  };
  estadisticasEmbeddings: {
    proveedor: string;
    modelo: string;
    dimensiones: number;
    textos: number;
    latenciaMediaPorTextoMs: number;
    errores: number;
    degradado?: boolean;
    motivoDegradado?: string;
  };
}

const ORIGEN_TEXTO: Record<Leccion["origen"], string> = {
  denegacion_humana: "Denegación del mando",
  aprobacion_humana: "Aprobación comentada",
  supervisor: "Supervisor",
  resultado_accion: "Resultado de una acción",
  postmortem: "Post-mortem",
};

const COLOR_ORIGEN: Record<Leccion["origen"], string> = {
  denegacion_humana: "bg-red-100 text-red-900",
  aprobacion_humana: "bg-emerald-100 text-emerald-900",
  supervisor: "bg-blue-100 text-blue-900",
  resultado_accion: "bg-amber-100 text-amber-900",
  postmortem: "bg-purple-100 text-purple-900",
};

function n(v: number | undefined, sufijo = ""): string {
  if (v === undefined) return "—";
  return `${Number.isInteger(v) ? v : v.toFixed(1)}${sufijo}`;
}

export function PaginaAprendizaje() {
  const [datos, setDatos] = useState<Datos>();
  const [error, setError] = useState<string>();
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      // Sin `no-store`: la ruta responde con ETag y el navegador manda If-None-Match,
      // así el sondeo de 20 s se resuelve con un 304 vacío cuando no hay cambios.
      const r = await fetch("/api/aprendizaje");
      const d = (await r.json()) as Datos & { error?: string };
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setDatos(d);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    // Con setTimeout 0 la primera carga sale del cuerpo del efecto y no
    // encadena renderizados (regla react-hooks/set-state-in-effect).
    const inmediato = setTimeout(() => void cargar(), 0);
    const periodico = setInterval(() => void cargar(), 20_000);
    return () => {
      clearTimeout(inmediato);
      clearInterval(periodico);
    };
  }, [cargar]);

  const actual = useMemo(() => datos?.ejecuciones.find((e) => e.id === datos.ejecucionActual), [datos]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 text-slate-900">
      <header className="mb-5">
        <Link href="/" className="text-sm text-blue-700 underline underline-offset-2 hover:text-blue-900">
          ← Volver a la sala de mando
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Aprendizaje</h1>
        <p className="text-sm text-slate-600">
          Lo que el sistema ha aprendido de lo que el mando corrigió y de lo que no funcionó. Cada lección lleva su
          evidencia.
        </p>
      </header>

      {error && (
        <p className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
          No se pudo cargar: {error}
        </p>
      )}
      {cargando && !datos && <p className="p-6 text-center text-slate-500">Cargando…</p>}

      {datos && (
        <>
          {/* ---- Qué cambió esta vez ---- */}
          <section className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <h2 className="text-lg font-semibold">Qué cambió esta vez</h2>
            {actual?.comparativa ? (
              <p className="mt-1 text-sm leading-relaxed text-slate-900">{actual.comparativa}</p>
            ) : (
              <p className="mt-1 text-sm text-slate-700">
                {datos.ejecuciones.length > 1
                  ? "La comparativa se escribe en el primer ciclo del agente de memoria de esta ejecución."
                  : "Es la primera ejecución registrada: no hay nada con lo que compararla todavía."}
              </p>
            )}
          </section>

          {/* ---- Ejecuciones ---- */}
          <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Ejecuciones</h2>
            {datos.ejecuciones.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">Sin ejecuciones registradas.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">Ejecución</th>
                      <th className="py-2 pr-3 text-right">Focos</th>
                      <th className="py-2 pr-3 text-right">Decisiones</th>
                      <th className="py-2 pr-3 text-right">Autónomas</th>
                      <th className="py-2 pr-3 text-right">Denegadas</th>
                      <th className="py-2 pr-3 text-right">Escaladas</th>
                      <th className="py-2 pr-3 text-right" title="Minutos de mundo de la detección al primer aviso">
                        Aviso (min)
                      </th>
                      <th className="py-2 pr-3 text-right" title="Minutos de mundo de la detección al primer despliegue">
                        Despliegue (min)
                      </th>
                      <th className="py-2 pr-3 text-right">Pueblos avisados</th>
                      <th className="py-2 pr-3 text-right">Nota supervisor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.ejecuciones.map((e) => {
                      const m = e.metricas;
                      return (
                        <tr
                          key={e.id}
                          className={`border-b border-slate-100 ${e.id === datos.ejecucionActual ? "bg-blue-50/60" : ""}`}
                        >
                          <td className="py-2 pr-3">
                            <span className="font-medium">{e.nombre}</span>
                            <span className="block text-xs text-slate-500">
                              {e.estado === "activa" ? "en curso" : `cerrada ${e.fin?.slice(0, 16).replace("T", " ") ?? ""}`}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">{m.incendios}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{m.decisionesPropuestas}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{m.decisionesAutonomas}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{m.decisionesDenegadas}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{m.escaladasAHumano}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{n(m.minutosDeteccionAviso)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{n(m.minutosDeteccionDespliegue)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {m.poblacionesAvisadas}
                            {m.poblacionesEnPeligroSinAvisar > 0 && (
                              <span className="ml-1 text-xs text-red-700">({m.poblacionesEnPeligroSinAvisar} sin avisar)</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">{n(m.puntuacionSupervisorMedia, "/100")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ---- Lecciones ---- */}
          <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Lecciones aprendidas ({datos.lecciones.length})</h2>
            {datos.lecciones.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-6 text-center">
                <p className="font-medium text-slate-700">Todavía no ha aprendido nada</p>
                <p className="mt-1 text-sm text-slate-500">
                  Deniega una decisión en la sala de mando explicando por qué: el agente de memoria convertirá tu
                  comentario en una lección con su evidencia.
                </p>
              </div>
            ) : (
              <ul className="mt-3 space-y-3">
                {datos.lecciones.map((l) => (
                  <li key={l.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded px-1.5 py-0.5 ${COLOR_ORIGEN[l.origen]}`}>{ORIGEN_TEXTO[l.origen]}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5">{l.categoria.replace(/_/g, " ")}</span>
                      <span className="text-slate-500">
                        aplica a <strong>{l.agenteId === "*" ? "todos los agentes" : l.agenteId}</strong>
                      </span>
                      <span className="ml-auto flex items-center gap-2 text-slate-500">
                        <span title="Peso: cuánto influye en los prompts">
                          peso{" "}
                          <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 align-middle">
                            <span className="block h-full bg-blue-600" style={{ width: `${Math.round(l.peso * 100)}%` }} />
                          </span>{" "}
                          {l.peso.toFixed(2)}
                        </span>
                        <span title="Veces que se ha inyectado en un agente">×{l.vecesAplicada}</span>
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm font-medium">{l.texto}</p>
                    <p className="mt-1 text-sm text-slate-700">
                      <strong className="text-slate-500">Qué pasó:</strong> {l.evidencia}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-700">
                      <strong className="text-slate-500">Qué cambia:</strong> {l.cambio}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---- Uso de los modelos ---- */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Uso de los modelos</h2>
            {!datos.estadisticasLLM.disponible && (
              <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
                No hay proveedor de IA configurado ({datos.estadisticasLLM.proveedor}): los agentes que razonan fallarán de
                forma visible. No se inventa ninguna respuesta.
              </p>
            )}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Papel</th>
                    <th className="py-2 pr-3">Modelo</th>
                    <th className="py-2 pr-3 text-right">Llamadas</th>
                    <th className="py-2 pr-3 text-right">Tokens in/out</th>
                    <th className="py-2 pr-3 text-right">Latencia media</th>
                    <th className="py-2 pr-3 text-right">Errores</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(datos.estadisticasLLM.porPapel).map(([papel, c]) => (
                    <tr key={papel} className="border-b border-slate-100">
                      <td className="py-2 pr-3 font-medium">{papel}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{datos.estadisticasLLM.modelos[papel]}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{c.llamadas}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {c.tokensEntrada}/{c.tokensSalida}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{c.latenciaMediaMs} ms</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {c.errores}
                        {c.ultimoError && <span className="block text-xs text-red-700">{c.ultimoError.slice(0, 80)}</span>}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 pr-3 font-medium">embeddings</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {datos.estadisticasEmbeddings.modelo} ({datos.estadisticasEmbeddings.dimensiones} dims)
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{datos.estadisticasEmbeddings.textos}</td>
                    <td className="py-2 pr-3 text-right text-slate-400">—</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {datos.estadisticasEmbeddings.latenciaMediaPorTextoMs} ms/texto
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{datos.estadisticasEmbeddings.errores}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {datos.estadisticasEmbeddings.degradado && (
              <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
                {datos.estadisticasEmbeddings.motivoDegradado}
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
