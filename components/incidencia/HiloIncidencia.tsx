"use client";
// =====================================================================
// ATALAYA INCENDIOS · Hilo de comunicaciones y hechos de una incidencia
// ---------------------------------------------------------------------
// DUEÑO: constructor G. Un hilo de noticias del incendio: lo más reciente
// arriba, en vivo por SSE, con filtros (Comunicaciones · Decisiones ·
// Unidades · Percepción · Actas) y buscador. Cada entrada dice la hora de
// mundo y la real, quién, qué pasó en una frase y con qué resultado real.
// Las actas se abren completas en un diálogo pidiendo /api/informes/[id].
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bell,
  BookOpenCheck,
  Camera,
  FileText,
  Flame,
  Gavel,
  Mail,
  Megaphone,
  MessageSquare,
  Phone,
  Radio,
  Satellite,
  Search,
  Send,
  Truck,
  Wind,
  type LucideIcon,
} from "lucide-react";
import type { Informe, Snapshot } from "@/lib/dominio/tipos";
import { fechaHora, hora, haceCuanto } from "@/lib/cliente/formato";
import { Insignia } from "@/components/ui/Insignia";
import { Vacio } from "@/components/ui/Vacio";
import { DialogoInforme } from "@/components/sala/DialogoInforme";
import { CATEGORIAS_HILO, construirHilo, filtrarHilo, type CategoriaHilo, type EntradaHilo, type IconoHilo } from "./hilo";

const ICONOS: Record<IconoHilo, LucideIcon> = {
  llamada: Phone,
  sms: MessageSquare,
  telegram: Send,
  email: Mail,
  comunicado: Megaphone,
  decision: Gavel,
  estado: BookOpenCheck,
  unidad: Truck,
  poblacion: Bell,
  observacion: Radio,
  camara: Camera,
  satelite: Satellite,
  prensa: Megaphone,
  acta: FileText,
  meteo: Wind,
  incendio: Flame,
  sistema: Radio,
};

/** Cuánto tiempo se marca una entrada como «nuevo». */
const MS_NOVEDAD = 10_000;

export function HiloIncidencia({ incendioId, snapshot }: { incendioId: string; snapshot?: Snapshot }) {
  const [texto, setTexto] = useState("");
  const [categorias, setCategorias] = useState<Set<CategoriaHilo>>(new Set());
  const [acta, setActa] = useState<Informe | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const lista = useRef<HTMLDivElement>(null);

  const todas = useMemo(() => construirHilo(snapshot, incendioId), [snapshot, incendioId]);
  const visibles = useMemo(() => filtrarHilo(todas, categorias, texto), [todas, categorias, texto]);

  // Reloj propio para que «hace 12 s» y la marca «nuevo» caduquen solas.
  useEffect(() => {
    const id = window.setInterval(() => setAhora(Date.now()), 2000);
    return () => window.clearInterval(id);
  }, []);

  function alternar(categoria: CategoriaHilo) {
    setCategorias((previas) => {
      const siguiente = new Set(previas);
      if (siguiente.has(categoria)) siguiente.delete(categoria);
      else siguiente.add(categoria);
      return siguiente;
    });
  }

  const cuentaPorCategoria = useMemo(() => {
    const cuenta = new Map<CategoriaHilo, number>();
    for (const e of todas) cuenta.set(e.categoria, (cuenta.get(e.categoria) ?? 0) + 1);
    return cuenta;
  }, [todas]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <label htmlFor="buscar-hilo" className="solo-lectores">
          Buscar en el hilo de la incidencia
        </label>
        <span className="relative flex min-w-[11rem] flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 size-4 text-subtle" aria-hidden />
          <input
            id="buscar-hilo"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar por teléfono, referencia, unidad, agente…"
            className="min-h-11 w-full rounded-lg border border-panel-border-strong bg-panel pl-8 pr-2 text-sm text-foreground placeholder:text-subtle"
          />
        </span>
      </div>

      <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar el hilo por tipo">
        {CATEGORIAS_HILO.map((c) => {
          const activa = categorias.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={activa}
              onClick={() => alternar(c.id)}
              className={[
                "inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors",
                activa ? "border-brand bg-brand/12 text-brand" : "border-panel-border text-muted hover:bg-panel-2 hover:text-foreground",
              ].join(" ")}
            >
              {c.etiqueta}
              <span className="tabular text-[11px] text-subtle">{cuentaPorCategoria.get(c.id) ?? 0}</span>
            </button>
          );
        })}
        {categorias.size > 0 ? (
          <button type="button" onClick={() => setCategorias(new Set())} className="min-h-9 px-2 text-[12px] text-brand underline underline-offset-2">
            Quitar filtros
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <p className="text-[11.5px] text-subtle">
          {visibles.length} de {todas.length} entradas · lo más reciente arriba
        </p>
        <button
          type="button"
          onClick={() => lista.current?.scrollTo({ top: 0, behavior: "smooth" })}
          className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[12px] text-brand underline underline-offset-2"
        >
          <ArrowUp className="size-3.5" aria-hidden /> Ir al inicio
        </button>
      </div>

      <div ref={lista} className="scroll-fino max-h-[70vh] overflow-y-auto rounded-xl border border-panel-border bg-panel">
        {visibles.length === 0 ? (
          <Vacio
            className="m-3"
            icono={<Radio />}
            titulo={todas.length === 0 ? "Todavía no hay actividad en esta incidencia" : "Nada con esos filtros"}
            guia={
              todas.length === 0
                ? "En cuanto entren observaciones, los agentes decidan o se ejecute una comunicación, aparecerá aquí en tiempo real."
                : "Prueba a quitar filtros o a buscar otra cosa."
            }
          />
        ) : (
          <ol className="divide-y divide-panel-border">
            {visibles.slice(0, 400).map((e) => (
              <FilaHilo
                key={e.id}
                entrada={e}
                ahora={ahora}
                onAbrirActa={() => {
                  const informe = (snapshot?.informes ?? []).find((i) => i.id === e.informeId);
                  if (informe) setActa(informe);
                }}
              />
            ))}
          </ol>
        )}
      </div>

      <DialogoInforme informe={acta} onCerrar={() => setActa(null)} />
    </div>
  );
}

function FilaHilo({ entrada, ahora, onAbrirActa }: { entrada: EntradaHilo; ahora: number; onAbrirActa: () => void }) {
  const Icono = ICONOS[entrada.icono] ?? Radio;
  const marca = Date.parse(entrada.en);
  const nuevo = Number.isFinite(marca) && ahora - marca >= 0 && ahora - marca < MS_NOVEDAD;
  const fallo = entrada.exito === false;

  return (
    <li className={`flex items-start gap-2 px-2.5 py-2 ${nuevo ? "bg-brand/8" : ""}`}>
      <Icono className={`mt-0.5 size-4 shrink-0 ${fallo ? "text-danger" : "text-muted"}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-snug text-foreground">{entrada.titulo}</p>
        {entrada.detalle ? <p className="mt-0.5 break-words text-[12px] leading-snug text-muted">{entrada.detalle}</p> : null}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {nuevo ? (
            <Insignia pequena tono="marca" punto>
              Nuevo
            </Insignia>
          ) : null}
          {entrada.insignias.map((i, indice) => (
            <Insignia key={`${i.texto}-${indice}`} pequena tono={i.tono}>
              {i.texto}
            </Insignia>
          ))}
          {entrada.actor ? <span className="text-[10.5px] text-subtle">{entrada.actor}</span> : null}
          {entrada.informeId ? (
            <button type="button" onClick={onAbrirActa} className="text-[11px] text-brand underline underline-offset-2">
              Abrir acta completa
            </button>
          ) : null}
          {entrada.decisionId ? (
            <a href={`/auditoria?decision=${encodeURIComponent(entrada.decisionId)}`} className="text-[11px] text-brand underline underline-offset-2">
              Cadena de auditoría
            </a>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="tabular text-[11px] text-foreground" title={`Hora de mundo · real: ${fechaHora(entrada.en)}`}>
          {hora(entrada.enMundo)}
        </p>
        <p className="tabular text-[10px] text-subtle" title={fechaHora(entrada.en)}>
          {haceCuanto(entrada.en, ahora)}
        </p>
      </div>
    </li>
  );
}
