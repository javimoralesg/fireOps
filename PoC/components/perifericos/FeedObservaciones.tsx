"use client";

// Lo que han visto los periféricos: eventos de EstadoSistema.eventos que vienen
// de un dispositivo emparejado o de una cámara municipal. Cada fila enseña la
// cadena completa: imagen → categoría y etiquetas de visión → dónde → si el
// verificador lo dejó pasar → y, si generó propuesta, un enlace a la consola.

import { useMemo } from "react";
import Link from "next/link";
import { ExternalLink, MapPin, Radar } from "lucide-react";
import type { EventoIngesta } from "@/lib/types";
import type { Decision } from "@/lib/tipos-sistema";
import type { Periferico } from "@/lib/tipos-perifericos";
import { distanciaM, formatearDistancia } from "@/components/mapa/geo";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { ChipCategoria, ChipSimulacro, ChipVerificacion, EstadoRecurso, Panel, Vacio, esSimulacro, hora, uiPeriferico } from "./ui-sala";

export interface FeedObservacionesProps {
  /** Todos los eventos del sistema: aquí se filtran los de periféricos y cámaras. */
  eventos: EventoIngesta[];
  /** Para enlazar la decisión que nació de cada observación. */
  decisiones?: Decision[];
  /** Para poner el nombre del dispositivo en vez de su id. */
  perifericos?: Periferico[];
  /** Posición del incidente, para la distancia de cada observación. */
  incidente?: { lat: number; lon: number };
  cargando?: boolean;
  className?: string;
}

/** Ventana en la que una decisión con foco `obs_*` se considera hija de la observación. */
const VENTANA_DECISION_MS = 180_000;

const ms = (ts: string) => {
  const t = Date.parse(ts);
  return Number.isNaN(t) ? 0 : t;
};

/** ¿Lo generó un periférico o una cámara municipal? */
export const esObservacion = (ev: EventoIngesta) =>
  Boolean(ev.perifericoId) || ev.fuente === "Periferico" || ev.fuente === "CamaraTrafico";

/**
 * Decisión creada a raíz de una observación: foco `obs_*` y creada justo después
 * (el pipeline pide la decisión en el mismo ciclo que publica el evento).
 */
function decisionDe(ev: EventoIngesta, decisiones: Decision[]): Decision | undefined {
  const t = ms(ev.timestamp);
  return decisiones
    .filter((d) => d.foco.startsWith("obs_") && ms(d.creadaEn) >= t && ms(d.creadaEn) - t <= VENTANA_DECISION_MS)
    .sort((a, b) => ms(a.creadaEn) - ms(b.creadaEn))[0];
}

export function FeedObservaciones({
  eventos,
  decisiones = [],
  perifericos = [],
  incidente,
  cargando = false,
  className = "",
}: FeedObservacionesProps) {
  const nombres = useMemo(() => new Map(perifericos.map((p) => [p.id, p])), [perifericos]);

  const observaciones = useMemo(
    () => eventos.filter(esObservacion).sort((a, b) => ms(b.timestamp) - ms(a.timestamp)),
    [eventos],
  );

  return (
    <Panel
      titulo="Observaciones"
      icono={Radar}
      className={className}
      extra={
        <>
          <span className="pildora font-mono">{observaciones.length}</span>
          <Ayuda
            titulo="Observaciones de periféricos"
            texto="Solo los eventos que han entrado por un dispositivo emparejado o una cámara municipal. El resto del feed (meteorología, tráfico, llamadas) está en la consola."
          />
        </>
      }
    >
      <EstadoRecurso
        cargando={cargando}
        ausente={false}
        error={null}
        que="las observaciones"
        endpoint="GET /api/estado"
        hayDatos={observaciones.length > 0}
      />

      {!cargando && observaciones.length === 0 && (
        <Vacio>Todavía nadie ha mandado nada. Una foto desde el móvil aparece aquí en segundos.</Vacio>
      )}

      <ul className="divide-y divide-panel-border">
        {observaciones.map((ev) => {
          const per = ev.perifericoId ? nombres.get(ev.perifericoId) : undefined;
          const ui = per ? uiPeriferico(per.tipo) : uiPeriferico(ev.fuente === "CamaraTrafico" ? "camara_trafico" : "sensor");
          const Icono = ui.icon;
          const decision = decisionDe(ev, decisiones);
          const dist = incidente && ev.geo ? distanciaM([incidente.lat, incidente.lon], [ev.geo.lat, ev.geo.lon]) : null;
          const simulado = esSimulacro(ev.etiquetas, ev.titulo);
          const etiquetasVision = (ev.etiquetas ?? []).filter((e) => e !== "simulacro");

          return (
            <li key={ev.id} className="px-3 py-2.5">
              <div className="flex gap-2">
                {ev.imagenUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element -- miniatura remota (R2 / data/uploads), sin optimizar */
                  <img
                    src={ev.imagenUrl}
                    alt={ev.titulo}
                    loading="lazy"
                    className="size-14 shrink-0 rounded-lg border border-panel-border object-cover"
                  />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Icono className="size-3.5 shrink-0 text-brand" aria-hidden />
                    <span className="truncate text-[12.5px] font-semibold text-foreground">{ev.titulo}</span>
                    <span className="shrink-0 font-mono text-[10.5px] text-subtle">{hora(ev.timestamp)}</span>
                  </div>

                  <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted">{ev.detalle}</p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <ChipCategoria categoria={ev.categoria} />
                    <ChipVerificacion verificacion={ev.verificacion} />
                    {simulado && <ChipSimulacro />}
                    {per && <span className="pildora">{per.nombre}</span>}
                    {ev.geo && (
                      <Tooltip
                        titulo="Posición de la observación"
                        contenido={`${ev.geo.lat.toFixed(5)}, ${ev.geo.lon.toFixed(5)}${
                          ev.geo.precisionM ? ` · ±${Math.round(ev.geo.precisionM)} m` : ""
                        }${ev.geo.rumboGrados !== undefined ? ` · rumbo ${Math.round(ev.geo.rumboGrados)}°` : ""}`}
                      >
                        <span className="pildora font-mono">
                          <MapPin className="size-3" aria-hidden />
                          {dist !== null ? formatearDistancia(dist) : `${ev.geo.lat.toFixed(4)}, ${ev.geo.lon.toFixed(4)}`}
                        </span>
                      </Tooltip>
                    )}
                    {etiquetasVision.map((e) => (
                      <span key={e} className="pildora font-mono text-subtle">
                        {e}
                      </span>
                    ))}
                  </div>

                  {decision && (
                    <Link
                      href={`/?decision=${encodeURIComponent(decision.id)}`}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand hover:underline"
                    >
                      <ExternalLink className="size-3" aria-hidden />
                      Ver decisión · {decision.tarjeta.titulo}
                    </Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
