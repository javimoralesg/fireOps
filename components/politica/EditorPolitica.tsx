"use client";
// =====================================================================
// Editor de la política de autonomía. DUEÑO: constructor D.
// Tailwind directo (no depende de components/ui de E).
// Explica en lenguaje llano qué implica cada modo y guarda con confirmación.
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModoCompetencia, NivelGravedad, PoliticaAutonomia, ReglaAutonomia } from "@/lib/dominio/tipos";

const MODOS: { valor: ModoCompetencia; etiqueta: string; explicacion: string; color: string }[] = [
  { valor: "autonoma", etiqueta: "La hace sola", explicacion: "El agente ejecuta sin preguntar. Queda en el registro y se puede deshacer después.", color: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  { valor: "supervisada", etiqueta: "Avisa y espera", explicacion: "El supervisor la puntúa; si aprueba, se ejecuta. Si suspende, sube a un humano.", color: "bg-amber-100 text-amber-900 border-amber-300" },
  { valor: "humano", etiqueta: "Decide una persona", explicacion: "Nunca se ejecuta sin que alguien pulse Aprobar en la sala de mando.", color: "bg-rose-100 text-rose-900 border-rose-300" },
];

const GRUPOS: { titulo: string; tipos: string[] }[] = [
  { titulo: "Información y registro", tipos: ["vigilar_camara", "solicitar_confirmacion", "abrir_ticket", "enviar_email", "enviar_sms", "enviar_telegram", "llamar"] },
  { titulo: "Medios", tipos: ["desplegar_unidad", "reasignar_unidad", "retirar_unidad", "solicitar_medios_aereos"] },
  { titulo: "Población y vía pública", tipos: ["avisar_poblacion", "confinar_poblacion", "evacuar_poblacion", "cortar_carretera", "publicar_comunicado"] },
  { titulo: "Mando", tipos: ["elevar_nivel", "declarar_controlado"] },
];

interface Cambio {
  en: string;
  quien: string;
  detalle: string[];
  recalculadas: number;
}

export default function EditorPolitica() {
  const [politica, setPolitica] = useState<PoliticaAutonomia | null>(null);
  const [borrador, setBorrador] = useState<PoliticaAutonomia | null>(null);
  const [quien, setQuien] = useState("");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [historial, setHistorial] = useState<Cambio[]>([]);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/politica", { cache: "no-store" });
      const j = (await res.json()) as { politica?: PoliticaAutonomia; error?: string };
      if (!res.ok || !j.politica) throw new Error(j.error ?? `HTTP ${res.status}`);
      setPolitica(j.politica);
      setBorrador(structuredClone(j.politica));
    } catch (e) {
      setAviso({ tono: "error", texto: `No se ha podido cargar la política: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    const temporizador = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(temporizador);
  }, [cargar]);

  const cambios = useMemo(() => {
    if (!politica || !borrador) return [] as string[];
    const lista: string[] = [];
    for (const r of borrador.reglas) {
      const previa = politica.reglas.find((x) => x.tipoAccion === r.tipoAccion);
      if (!previa) continue;
      if (previa.modo !== r.modo) lista.push(`${etiqueta(r.tipoAccion)}: ${nombreModo(previa.modo)} → ${nombreModo(r.modo)}`);
      if (previa.riesgoMinimo !== r.riesgoMinimo) lista.push(`${etiqueta(r.tipoAccion)}: riesgo mínimo ${previa.riesgoMinimo} → ${r.riesgoMinimo}`);
    }
    if (politica.umbralSupervisada !== borrador.umbralSupervisada) lista.push(`Umbral de supervisión ${politica.umbralSupervisada} → ${borrador.umbralSupervisada}`);
    if (politica.umbralHumano !== borrador.umbralHumano) lista.push(`Umbral de decisión humana ${politica.umbralHumano} → ${borrador.umbralHumano}`);
    if (politica.puntuacionMinimaSupervisor !== borrador.puntuacionMinimaSupervisor) lista.push(`Nota mínima del supervisor ${politica.puntuacionMinimaSupervisor} → ${borrador.puntuacionMinimaSupervisor}`);
    if (politica.nivelGravedadHumano !== borrador.nivelGravedadHumano) lista.push(`A partir del nivel ${politica.nivelGravedadHumano} → ${borrador.nivelGravedadHumano} decide siempre una persona`);
    if (politica.minutosCaducidad !== borrador.minutosCaducidad) lista.push(`Caducidad de lo pendiente ${politica.minutosCaducidad} → ${borrador.minutosCaducidad} min`);
    return lista;
  }, [politica, borrador]);

  function cambiarRegla(tipoAccion: string, cambio: Partial<ReglaAutonomia>) {
    setBorrador((b) => (b ? { ...b, reglas: b.reglas.map((r) => (r.tipoAccion === tipoAccion ? { ...r, ...cambio } : r)) } : b));
  }

  async function guardar() {
    if (!borrador) return;
    if (!quien.trim()) {
      setAviso({ tono: "error", texto: "Escribe tu nombre: todo cambio de política queda firmado." });
      setConfirmando(false);
      return;
    }
    setGuardando(true);
    setConfirmando(false);
    try {
      const res = await fetch("/api/politica", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...borrador, actualizadaPor: quien.trim() }),
      });
      const j = (await res.json()) as { politica?: PoliticaAutonomia; cambios?: string[]; recalculadas?: unknown[]; error?: string };
      if (!res.ok || !j.politica) throw new Error(j.error ?? `HTTP ${res.status}`);
      setPolitica(j.politica);
      setBorrador(structuredClone(j.politica));
      setHistorial((h) => [{ en: new Date().toLocaleTimeString("es-ES"), quien: quien.trim(), detalle: cambios, recalculadas: j.recalculadas?.length ?? 0 }, ...h].slice(0, 10));
      setAviso({ tono: "ok", texto: `Política guardada. ${j.recalculadas?.length ?? 0} decisión(es) pendientes han cambiado de competencia. No se ha ejecutado nada.` });
    } catch (e) {
      setAviso({ tono: "error", texto: `No se ha podido guardar: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <p className="text-slate-600">Cargando la política…</p>;
  if (!borrador) return <p className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-rose-900">{aviso?.texto ?? "No hay política disponible."}</p>;

  return (
    <div className="space-y-8">
      {aviso && (
        <div
          role="status"
          className={`rounded-lg border p-4 text-sm ${aviso.tono === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-rose-300 bg-rose-50 text-rose-900"}`}
        >
          {aviso.texto}
        </div>
      )}

      {/* ---- Umbrales globales ---- */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Umbrales generales</h2>
        <p className="mt-1 text-sm text-slate-600">
          Cada decisión lleva un <strong>riesgo de 0 a 100</strong>. Estos topes mandan sobre las reglas de abajo: solo pueden hacer que
          intervenga más gente, nunca menos.
        </p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Deslizador
            etiqueta="A partir de este riesgo, avisa y espera"
            ayuda="Por debajo de este número, las acciones autónomas se ejecutan solas."
            valor={borrador.umbralSupervisada}
            onChange={(v) => setBorrador({ ...borrador, umbralSupervisada: v })}
          />
          <Deslizador
            etiqueta="A partir de este riesgo, decide una persona"
            ayuda="Todo lo que llegue a este riesgo espera a que alguien pulse Aprobar."
            valor={borrador.umbralHumano}
            onChange={(v) => setBorrador({ ...borrador, umbralHumano: v })}
          />
          <Deslizador
            etiqueta="Nota mínima del supervisor"
            ayuda="Si el supervisor puntúa por debajo, la decisión sube a un humano aunque fuera autónoma."
            valor={borrador.puntuacionMinimaSupervisor}
            onChange={(v) => setBorrador({ ...borrador, puntuacionMinimaSupervisor: v })}
          />
          <div>
            <label className="block text-sm font-medium text-slate-800" htmlFor="caducidad">
              Caducidad de lo pendiente (minutos de mundo)
            </label>
            <p className="mb-2 text-xs text-slate-500">Si nadie responde en este tiempo, la propuesta caduca y se registra.</p>
            <input
              id="caducidad"
              type="number"
              min={1}
              max={240}
              value={borrador.minutosCaducidad}
              onChange={(e) => setBorrador({ ...borrador, minutosCaducidad: Number(e.target.value) })}
              className="h-11 w-32 rounded-lg border border-slate-300 px-3 text-slate-900"
            />
          </div>
          <div className="sm:col-span-2">
            <span className="block text-sm font-medium text-slate-800">A partir de este nivel de gravedad decide siempre una persona</span>
            <p className="mb-2 text-xs text-slate-500">
              Niveles de la Directriz Básica: 0 medios ordinarios · 1 puede amenazar bienes no forestales · 2 amenaza seria a poblaciones ·
              3 interés nacional.
            </p>
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setBorrador({ ...borrador, nivelGravedadHumano: n as NivelGravedad })}
                  aria-pressed={borrador.nivelGravedadHumano === n}
                  className={`min-h-11 min-w-16 rounded-lg border px-4 text-sm font-semibold ${borrador.nivelGravedadHumano === n ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  Nivel {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---- Matriz de reglas ---- */}
      <section className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Qué puede hacer cada agente por su cuenta</h2>
          <p className="mt-1 text-sm text-slate-600">
            Una fila por tipo de acción. El <strong>riesgo mínimo</strong> es el suelo que se le asigna a cualquier decisión que incluya esa
            acción: sirve para que algo aparentemente pequeño no se cuele como inocuo.
          </p>
        </div>

        {GRUPOS.map((grupo) => {
          const reglas = borrador.reglas.filter((r) => grupo.tipos.includes(r.tipoAccion));
          if (!reglas.length) return null;
          return (
            <div key={grupo.titulo} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <h3 className="border-b border-slate-200 bg-slate-50 px-5 py-3 text-sm font-semibold uppercase tracking-wide text-slate-700">{grupo.titulo}</h3>
              <ul className="divide-y divide-slate-100">
                {reglas.map((r) => (
                  <li key={r.tipoAccion} className="grid gap-3 p-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{etiqueta(r.tipoAccion)}</p>
                      <p className="mt-0.5 text-sm text-slate-600">{r.descripcion}</p>
                      <label className="mt-3 flex items-center gap-3 text-sm text-slate-700">
                        <span className="whitespace-nowrap">Riesgo mínimo</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={r.riesgoMinimo}
                          onChange={(e) => cambiarRegla(r.tipoAccion, { riesgoMinimo: Number(e.target.value) })}
                          className="h-11 w-48 accent-slate-900"
                          aria-label={`Riesgo mínimo de ${etiqueta(r.tipoAccion)}`}
                        />
                        <span className="w-10 text-right font-mono text-slate-900">{r.riesgoMinimo}</span>
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2 lg:flex-nowrap">
                      {MODOS.map((m) => (
                        <button
                          key={m.valor}
                          type="button"
                          title={m.explicacion}
                          aria-pressed={r.modo === m.valor}
                          onClick={() => cambiarRegla(r.tipoAccion, { modo: m.valor })}
                          className={`min-h-11 rounded-lg border px-3 text-sm font-medium transition ${r.modo === m.valor ? `${m.color} ring-2 ring-slate-900/20` : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
                        >
                          {m.etiqueta}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-5 sm:grid-cols-3">
          {MODOS.map((m) => (
            <div key={m.valor} className={`rounded-lg border p-3 text-sm ${m.color}`}>
              <p className="font-semibold">{m.etiqueta}</p>
              <p className="mt-1">{m.explicacion}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Guardar ---- */}
      <section className="sticky bottom-0 rounded-xl border border-slate-300 bg-white/95 p-5 shadow-lg backdrop-blur">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-56 flex-1">
            <label className="block text-sm font-medium text-slate-800" htmlFor="quien">
              Quién firma el cambio
            </label>
            <input
              id="quien"
              value={quien}
              onChange={(e) => setQuien(e.target.value)}
              placeholder="Nombre y puesto"
              className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-900"
            />
          </div>
          <button
            type="button"
            disabled={!cambios.length || guardando}
            onClick={() => setConfirmando(true)}
            className="min-h-11 rounded-lg bg-slate-900 px-6 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {guardando ? "Guardando…" : cambios.length ? `Guardar ${cambios.length} cambio(s)` : "Sin cambios"}
          </button>
          {cambios.length > 0 && (
            <button type="button" onClick={() => setBorrador(structuredClone(politica as PoliticaAutonomia))} className="min-h-11 rounded-lg border border-slate-300 px-4 text-slate-700 hover:bg-slate-50">
              Descartar
            </button>
          )}
        </div>
        {politica && (
          <p className="mt-3 text-xs text-slate-500">
            Última modificación: {new Date(politica.actualizadaEn).toLocaleString("es-ES")} por {politica.actualizadaPor}.
          </p>
        )}
      </section>

      {confirmando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Confirmar cambio de política</h3>
            <p className="mt-2 text-sm text-slate-600">Vas a cambiar quién decide qué. Las decisiones pendientes se recalculan, pero no se ejecuta nada de forma retroactiva.</p>
            <ul className="mt-4 max-h-56 list-disc space-y-1 overflow-auto pl-5 text-sm text-slate-800">
              {cambios.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmando(false)} className="min-h-11 rounded-lg border border-slate-300 px-4 text-slate-700">
                Cancelar
              </button>
              <button type="button" onClick={() => void guardar()} className="min-h-11 rounded-lg bg-slate-900 px-5 font-semibold text-white">
                Sí, guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {historial.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Cambios de esta sesión</h2>
          <ul className="mt-3 space-y-3 text-sm">
            {historial.map((h, i) => (
              <li key={`${h.en}-${i}`} className="border-l-2 border-slate-300 pl-3">
                <p className="font-medium text-slate-800">
                  {h.en} · {h.quien} · {h.recalculadas} decisión(es) recalculadas
                </p>
                <p className="text-slate-600">{h.detalle.join(" · ") || "sin detalle"}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Deslizador({ etiqueta, ayuda, valor, onChange }: { etiqueta: string; ayuda: string; valor: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-800">{etiqueta}</label>
      <p className="mb-2 text-xs text-slate-500">{ayuda}</p>
      <div className="flex items-center gap-3">
        <input type="range" min={0} max={100} value={valor} onChange={(e) => onChange(Number(e.target.value))} className="h-11 flex-1 accent-slate-900" aria-label={etiqueta} />
        <span className="w-12 rounded border border-slate-200 bg-slate-50 py-1 text-center font-mono text-slate-900">{valor}</span>
      </div>
    </div>
  );
}

const ETIQUETAS: Record<string, string> = {
  llamar: "Llamar por teléfono",
  enviar_sms: "Enviar un SMS",
  enviar_email: "Enviar un correo",
  enviar_telegram: "Enviar un Telegram",
  desplegar_unidad: "Enviar una unidad al incendio",
  reasignar_unidad: "Mover una unidad de un foco a otro",
  retirar_unidad: "Retirar una unidad",
  solicitar_medios_aereos: "Pedir medios aéreos",
  avisar_poblacion: "Avisar a un pueblo",
  confinar_poblacion: "Confinar a un pueblo",
  evacuar_poblacion: "Evacuar un pueblo",
  cortar_carretera: "Pedir el corte de una carretera",
  publicar_comunicado: "Publicar un comunicado",
  elevar_nivel: "Elevar el nivel de gravedad",
  declarar_controlado: "Declarar el incendio controlado",
  abrir_ticket: "Abrir un parte interno",
  vigilar_camara: "Poner una cámara en vigilancia",
  solicitar_confirmacion: "Pedir confirmación a quien avisó",
};

const etiqueta = (tipo: string): string => ETIQUETAS[tipo] ?? tipo;
const nombreModo = (m: ModoCompetencia): string => MODOS.find((x) => x.valor === m)?.etiqueta ?? m;
