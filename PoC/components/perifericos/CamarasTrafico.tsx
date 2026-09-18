"use client";

// Cámaras públicas de tráfico del Ayuntamiento de Madrid (informo.madrid.es).
// Las descubre el backend desde el KML y nos manda las más cercanas al incidente.
// La miniatura se refresca cada minuto con un parámetro ?v=<minuto> que rompe la
// caché del navegador sin machacar el servidor municipal.

import { useState } from "react";
import { Cctv, LoaderCircle, ScanEye } from "lucide-react";
import type { CamaraTrafico } from "@/lib/tipos-perifericos";
import { formatearDistancia } from "@/components/mapa/geo";
import { Ayuda } from "@/components/ui/Tooltip";
import { BarraConfianza, ChipCategoria, EstadoRecurso, Panel, Vacio, hora, useReloj } from "./ui-sala";

export interface CamarasTraficoProps {
  camaras: CamaraTrafico[];
  cargando?: boolean;
  ausente?: boolean;
  error?: string | null;
  /** Pide el análisis de visión de una cámara. */
  onAnalizar?: (id: string) => void | Promise<unknown>;
  className?: string;
}

const MINUTO_MS = 60_000;

const conVersion = (url: string, v: number) => `${url}${url.includes("?") ? "&" : "?"}v=${v}`;

export function CamarasTrafico({ camaras, cargando = false, ausente = false, error = null, onAnalizar, className = "" }: CamarasTraficoProps) {
  const minuto = useReloj(MINUTO_MS);
  const [analizando, setAnalizando] = useState<string | null>(null);
  const [rotas, setRotas] = useState<Record<string, boolean>>({});

  const analizar = async (id: string) => {
    if (!onAnalizar) return;
    setAnalizando(id);
    try {
      await onAnalizar(id);
    } catch {
      /* el fallo se ve porque no aparece análisis nuevo */
    } finally {
      setAnalizando(null);
    }
  };

  return (
    <Panel
      titulo="Cámaras municipales"
      icono={Cctv}
      className={className}
      cuerpoClassName="p-2.5"
      extra={
        <>
          <span className="pildora font-mono">{camaras.length}</span>
          <Ayuda
            titulo="Cámaras de tráfico"
            texto="Cámaras reales del Ayuntamiento de Madrid, las más cercanas al incidente. La imagen se refresca cada minuto; «Analizar» pasa el fotograma por visión y, si ve algo, genera un evento."
          />
        </>
      }
      subtitulo="Ayuntamiento de Madrid · informo.madrid.es"
    >
      <EstadoRecurso
        cargando={cargando}
        ausente={ausente}
        error={error}
        que="las cámaras de tráfico"
        endpoint="GET /api/perifericos/camaras"
        hayDatos={camaras.length > 0}
      />

      {!cargando && !ausente && camaras.length === 0 && <Vacio>Sin cámaras cercanas al incidente.</Vacio>}

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {camaras.map((c) => {
          const ocupada = analizando === c.id;
          const a = c.ultimoAnalisis;
          return (
            <li key={c.id} className="fila-interactiva overflow-hidden">
              <div className="relative aspect-[4/3] w-full bg-panel-2">
                {rotas[c.id] ? (
                  <span className="flex h-full items-center justify-center px-2 text-center text-[10.5px] text-subtle">
                    Cámara sin señal
                  </span>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element -- JPEG en vivo del Ayuntamiento, no se optimiza */
                  <img
                    src={conVersion(c.imagenUrl, minuto)}
                    alt={`Cámara de tráfico ${c.nombre}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    onError={() => setRotas((r) => ({ ...r, [c.id]: true }))}
                  />
                )}
                <span className="absolute bottom-1 right-1 rounded bg-panel/90 px-1 font-mono text-[10px] text-muted">
                  {formatearDistancia(c.distanciaM)}
                </span>
              </div>

              <div className="p-2">
                <p className="truncate text-[11.5px] font-semibold text-foreground" title={c.nombre}>
                  {c.nombre}
                </p>

                {a && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <ChipCategoria categoria={a.categoria} />
                    <BarraConfianza valor={a.confianza} />
                    <span className="font-mono text-[10px] text-subtle">{hora(a.timestamp)}</span>
                  </div>
                )}

                {onAnalizar && (
                  <button
                    type="button"
                    className="boton boton-secundario boton-sm mt-1.5 w-full"
                    disabled={ocupada}
                    onClick={() => void analizar(c.id)}
                    aria-label={`Analizar la cámara ${c.nombre}`}
                  >
                    {ocupada ? (
                      <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <ScanEye className="size-3.5" aria-hidden />
                    )}
                    {ocupada ? "Analizando…" : "Analizar"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
