"use client";

// Quién está conectado: móviles del jurado, cámaras fijas, efectivos, sensores.
// Una fila por periférico con lo que el mando necesita de un vistazo: si está
// vivo, qué es, en qué modo, qué vio por última vez, cuánto se fía el sistema
// de él y a qué distancia del incidente está.

import { useState } from "react";
import { Eye, EyeOff, Radio, Trash2 } from "lucide-react";
import type { Periferico } from "@/lib/tipos-perifericos";
import { distanciaM, formatearDistancia } from "@/components/mapa/geo";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import {
  BarraConfianza,
  ChipCategoria,
  EstadoRecurso,
  Panel,
  PuntoEstado,
  Vacio,
  hace,
  hora,
  textoModo,
  uiPeriferico,
} from "./ui-sala";

export interface PanelPerifericosProps {
  perifericos: Periferico[];
  /** Posición del incidente activo, para la distancia de cada periférico. */
  incidente?: { lat: number; lon: number };
  cargando?: boolean;
  ausente?: boolean;
  error?: string | null;
  /** Da de baja el periférico. Si no se pasa, no se ofrece la acción. */
  onEliminar?: (id: string) => void | Promise<void>;
  /** Cambia manual ↔ vigilancia (el intervalo por defecto es 15 s). */
  onCambiarModo?: (id: string, modo: Periferico["modo"], intervaloVigilanciaSeg?: number) => void | Promise<void>;
  /** Fila resaltada (sincronía con el mapa). */
  seleccionId?: string | null;
  onSeleccionar?: (id: string) => void;
  className?: string;
}

const INTERVALO_VIGILANCIA_SEG = 15;

export function PanelPerifericos({
  perifericos,
  incidente,
  cargando = false,
  ausente = false,
  error = null,
  onEliminar,
  onCambiarModo,
  seleccionId = null,
  onSeleccionar,
  className = "",
}: PanelPerifericosProps) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const enLinea = perifericos.filter((p) => p.enLinea).length;

  const ejecutar = async (id: string, fn: () => void | Promise<void>) => {
    setOcupado(id);
    try {
      await fn();
    } catch {
      /* el fallo se ve porque la lista no cambia; no bloqueamos la sala */
    } finally {
      setOcupado(null);
    }
  };

  return (
    <Panel
      titulo="Periféricos"
      icono={Radio}
      className={className}
      extra={
        <>
          <span className="pildora pildora-exito font-mono">{enLinea} en línea</span>
          <span className="pildora font-mono">{perifericos.length} total</span>
          <Ayuda
            titulo="Periféricos conectados"
            texto="Un periférico está «en línea» si ha mandado latido en los últimos 30 s. La confianza es su reputación: sube con observaciones fiables y baja con duplicados o bulos."
          />
        </>
      }
    >
      <EstadoRecurso
        cargando={cargando}
        ausente={ausente}
        error={error}
        que="el registro de periféricos"
        endpoint="GET /api/perifericos"
        hayDatos={perifericos.length > 0}
      />

      {!cargando && !ausente && perifericos.length === 0 && <Vacio>Nadie conectado todavía. Enseña el QR.</Vacio>}

      <ul className="divide-y divide-panel-border">
        {perifericos.map((p) => {
          const ui = uiPeriferico(p.tipo);
          const Icono = ui.icon;
          const dist =
            incidente && p.posicion ? distanciaM([incidente.lat, incidente.lon], [p.posicion.lat, p.posicion.lon]) : null;
          const vigilando = p.modo === "vigilancia";
          const activo = seleccionId === p.id;
          return (
            <li
              key={p.id}
              aria-current={activo || undefined}
              className={`px-3 py-2 transition-colors ${activo ? "bg-brand/6" : "hover:bg-panel-2"} ${onSeleccionar ? "cursor-pointer" : ""}`}
              onClick={onSeleccionar ? () => onSeleccionar(p.id) : undefined}
            >
              <div className="flex items-start gap-2">
                <PuntoEstado enLinea={p.enLinea} />
                <Icono className={`mt-px size-4 shrink-0 ${p.enLinea ? "text-brand" : "text-subtle"}`} aria-hidden />

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-foreground">{p.nombre}</span>
                    <span className="shrink-0 text-[11px] text-subtle">{ui.etiqueta}</span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={`pildora ${vigilando ? "pildora-marca" : ""}`}>{textoModo(p)}</span>
                    {dist !== null && (
                      <Tooltip contenido="Distancia en línea recta entre el periférico y el incidente activo." lado="derecha">
                        <span className="pildora font-mono">{formatearDistancia(dist)}</span>
                      </Tooltip>
                    )}
                    {!p.enLinea && <span className="pildora text-subtle">{hace(p.ultimoLatido)}</span>}
                    <BarraConfianza valor={p.confianza} />
                  </div>

                  {p.ultimaObservacion ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <ChipCategoria categoria={p.ultimaObservacion.categoria} />
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">{p.ultimaObservacion.resumen}</span>
                      <span className="shrink-0 font-mono text-[10.5px] text-subtle">{hora(p.ultimaObservacion.timestamp)}</span>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[11.5px] text-subtle">Sin observaciones todavía · {p.observaciones} enviadas</p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  {onCambiarModo && (
                    <Tooltip
                      titulo={vigilando ? "Volver a manual" : "Poner en vigilancia"}
                      contenido={
                        vigilando
                          ? "Deja de mandar fotogramas automáticos: solo enviará lo que el usuario pulse."
                          : `Manda un fotograma cada ${INTERVALO_VIGILANCIA_SEG} s y solo genera evento cuando la escena cambia.`
                      }
                    >
                      <button
                        type="button"
                        className="boton boton-fantasma boton-sm px-1.5"
                        disabled={ocupado === p.id}
                        aria-label={vigilando ? `Quitar vigilancia de ${p.nombre}` : `Poner ${p.nombre} en vigilancia`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void ejecutar(p.id, () =>
                            onCambiarModo(p.id, vigilando ? "manual" : "vigilancia", INTERVALO_VIGILANCIA_SEG),
                          );
                        }}
                      >
                        {vigilando ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
                      </button>
                    </Tooltip>
                  )}
                  {onEliminar && (
                    <Tooltip titulo="Quitar" contenido="Da de baja el periférico. Tendrá que volver a escanear el QR para emparejarse.">
                      <button
                        type="button"
                        className="boton boton-fantasma boton-sm px-1.5 hover:text-danger"
                        disabled={ocupado === p.id}
                        aria-label={`Quitar ${p.nombre}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void ejecutar(p.id, () => onEliminar(p.id));
                        }}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </Tooltip>
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
