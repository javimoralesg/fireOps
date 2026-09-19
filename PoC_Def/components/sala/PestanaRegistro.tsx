"use client";
// Pestaña "Registro": eventos en vivo con filtro por nivel e incendio.
// DUEÑO: constructor E.

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  Flame,
  Info,
  Mail,
  Megaphone,
  MessageSquare,
  Phone,
  Radio,
  Satellite,
  ScrollText,
  Send,
  Truck,
  User,
  Wind,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { Evento, Snapshot, TipoEvento } from "@/lib/dominio/tipos";
import { hora } from "@/lib/cliente/formato";
import { urlSegura } from "@/lib/cliente/enlaces";
import { EnlaceExterno } from "@/components/ui/Enlace";
import { Vacio } from "@/components/ui/Vacio";

const ICONOS: Partial<Record<TipoEvento, LucideIcon>> = {
  incendio_nuevo: Flame,
  incendio_actualizado: Flame,
  incendio_cerrado: CheckCircle2,
  observacion: MessageSquare,
  camara_positiva: AlertTriangle,
  satelite: Satellite,
  viento_gira: Wind,
  peligro_sube: AlertTriangle,
  decision_propuesta: Brain,
  decision_aprobada: CheckCircle2,
  decision_denegada: XCircle,
  decision_ejecutada: CheckCircle2,
  decision_escalada: AlertTriangle,
  accion_ejecutada: CheckCircle2,
  accion_fallida: XCircle,
  unidad_movida: Truck,
  unidad_llega: Truck,
  poblacion_avisada: Megaphone,
  comunicado: Radio,
  agente: Bot,
  humano: User,
  leccion: Brain,
  sistema: Info,
};

/**
 * Icono de un evento mirando también sus datos: una acción ejecutada que ha
 * llamado o mandado un SMS se ve con un teléfono, y un movimiento de unidad con
 * un camión, que es lo que el mando busca de un vistazo.
 */
function iconoDe(e: Evento): LucideIcon {
  if (e.tipo === "unidad_movida" || e.tipo === "unidad_llega") return Truck;
  const datos = (e.datos ?? {}) as Record<string, unknown>;
  const canal = typeof datos.canal === "string" ? datos.canal : undefined;
  if (canal) {
    if (canal === "llamada") return Phone;
    if (canal === "sms" || canal === "whatsapp") return MessageSquare;
    if (canal === "email") return Mail;
    if (canal === "telegram") return Send;
  }
  if (e.tipo === "accion_ejecutada" && (datos.unidadId || datos.distanciaM)) return Truck;
  if (e.tipo === "accion_ejecutada" && (datos.telefono || datos.referencia)) return Phone;
  return ICONOS[e.tipo] ?? Info;
}

/** Frase con el canal y el resultado real cuando el evento los trae. */
function detalleComunicacion(e: Evento): string | null {
  const datos = (e.datos ?? {}) as Record<string, unknown>;
  const partes: string[] = [];
  if (typeof datos.canal === "string") partes.push(datos.canal);
  if (typeof datos.proveedor === "string") partes.push(datos.proveedor);
  if (typeof datos.referencia === "string") partes.push(`run ${datos.referencia}`);
  if (typeof datos.distanciaM === "number") partes.push(`${(datos.distanciaM / 1000).toFixed(1)} km por carretera`);
  return partes.length ? partes.join(" · ") : null;
}

const NIVELES = [
  { id: "todos", etiqueta: "Todo" },
  { id: "aviso", etiqueta: "Avisos y críticos" },
  { id: "critico", etiqueta: "Solo críticos" },
] as const;

export function PestanaRegistro({ snapshot }: { snapshot?: Snapshot }) {
  const [nivel, setNivel] = useState<(typeof NIVELES)[number]["id"]>("todos");
  const [incendioId, setIncendioId] = useState("todos");

  /**
   * URL de la fuente de cada observación, para poder abrir la noticia, el post
   * o la imagen de cámara desde la línea del registro. Los eventos solo llevan
   * el id de la observación, así que aquí se resuelve una vez.
   */
  const urlPorObservacion = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const o of snapshot?.observaciones ?? []) {
      const url = urlSegura(o.urlFuente);
      if (url) mapa.set(o.id, url);
    }
    return mapa;
  }, [snapshot?.observaciones]);

  /** Fuente abrible de un evento: la suya propia o la de su observación. */
  const urlDeEvento = (e: Evento): string | undefined => {
    const datos = (e.datos ?? {}) as Record<string, unknown>;
    const propia = urlSegura(typeof datos.url === "string" ? datos.url : undefined);
    if (propia) return propia;
    const obs = typeof datos.observacionId === "string" ? datos.observacionId : undefined;
    return obs ? urlPorObservacion.get(obs) : undefined;
  };

  const eventos = useMemo(() => {
    let lista: Evento[] = snapshot?.eventos ?? [];
    if (nivel === "critico") lista = lista.filter((e) => e.nivel === "critico");
    else if (nivel === "aviso") lista = lista.filter((e) => e.nivel !== "info");
    if (incendioId !== "todos") lista = lista.filter((e) => e.incendioId === incendioId);
    return [...lista].sort((a, b) => b.en.localeCompare(a.en)).slice(0, 250);
  }, [snapshot?.eventos, nivel, incendioId]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="group" aria-label="Filtrar por nivel" className="flex gap-1">
          {NIVELES.map((n) => (
            <button
              key={n.id}
              type="button"
              aria-pressed={nivel === n.id}
              onClick={() => setNivel(n.id)}
              className={[
                "min-h-9 rounded-lg border px-2.5 text-[12px] font-medium",
                nivel === n.id ? "border-brand bg-brand/12 text-brand" : "border-panel-border-strong bg-panel text-muted hover:text-foreground",
              ].join(" ")}
            >
              {n.etiqueta}
            </button>
          ))}
        </div>
        {(snapshot?.incendios.length ?? 0) > 0 ? (
          <>
            <label htmlFor="filtro-incendio" className="solo-lectores">
              Filtrar por incendio
            </label>
            <select
              id="filtro-incendio"
              value={incendioId}
              onChange={(e) => setIncendioId(e.target.value)}
              className="min-h-9 rounded-lg border border-panel-border-strong bg-panel px-2 text-[12px] text-foreground"
            >
              <option value="todos">Todos los focos</option>
              {snapshot?.incendios.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>

      {eventos.length === 0 ? (
        <Vacio
          icono={<ScrollText />}
          titulo="El registro está vacío"
          guia="Aquí aparece en directo todo lo que hacen los agentes y las personas: detecciones, decisiones, llamadas y avisos."
        />
      ) : (
        <ul className="divide-y divide-panel-border rounded-xl border border-panel-border bg-panel">
          {eventos.map((e) => {
            const Icono = iconoDe(e);
            const color = e.nivel === "critico" ? "text-danger" : e.nivel === "aviso" ? "text-warning" : "text-muted";
            const detalle = detalleComunicacion(e);
            const url = urlDeEvento(e);
            return (
              <li key={e.id} className="flex items-start gap-2 px-2.5 py-1.5">
                <Icono className={`mt-0.5 size-4 shrink-0 ${color}`} aria-hidden />
                <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-foreground">
                  {e.mensaje}
                  {e.agenteId ? <span className="text-subtle"> · {e.agenteId}</span> : null}
                  {detalle ? <span className="block text-[11px] text-subtle">{detalle}</span> : null}
                  {/* Si lo que originó el evento tiene fuente, se puede abrir. */}
                  {url ? (
                    <EnlaceExterno href={url} className="mt-0.5 text-[11px]" siNoHayUrl="nada" titulo="Abrir la fuente de esta entrada">
                      Ver la fuente
                    </EnlaceExterno>
                  ) : null}
                </p>
                <span className="tabular shrink-0 text-[11px] text-subtle" title={`Hora de mundo · ${e.enMundo}`}>
                  {hora(e.enMundo || e.en)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
