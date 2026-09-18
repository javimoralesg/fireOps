"use client";

// Muro de la red social simulada: lo que publica el jurado desde /periferico y
// los comunicados oficiales que el Gabinete aprueba en la consola. El estado de
// verificación es lo importante: una foto reciclada marcada "sospechoso" es lo
// que dispara la decisión de desmentido.

import { BadgeCheck, MessagesSquare } from "lucide-react";
import type { Publicacion } from "@/lib/tipos-perifericos";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { ChipVerificacion, EstadoRecurso, Panel, Vacio, hora } from "./ui-sala";

export interface MuroPublicacionesProps {
  publicaciones: Publicacion[];
  cargando?: boolean;
  ausente?: boolean;
  error?: string | null;
  className?: string;
}

const ORIGEN_ETIQUETA: Record<string, string> = {
  periferico: "Periférico",
  exa: "Exa · web",
  gabinete: "Comunicado oficial",
};

function ms(ts: string) {
  const t = Date.parse(ts);
  return Number.isNaN(t) ? 0 : t;
}

export function MuroPublicaciones({ publicaciones, cargando = false, ausente = false, error = null, className = "" }: MuroPublicacionesProps) {
  const ordenadas = [...publicaciones].sort((a, b) => ms(b.timestamp) - ms(a.timestamp));

  return (
    <Panel
      titulo="Muro de publicaciones"
      icono={MessagesSquare}
      className={className}
      extra={
        <>
          <span className="pildora font-mono">{publicaciones.length}</span>
          <Ayuda
            titulo="Red social simulada"
            texto="Cada publicación pasa por el verificador: se agrupan las repetidas («N menciones») y se marca como sospechosa la que reutiliza material anterior al incidente. Tres sospechosas seguidas piden un desmentido al Gabinete."
          />
        </>
      }
    >
      <EstadoRecurso
        cargando={cargando}
        ausente={ausente}
        error={error}
        que="el muro de publicaciones"
        endpoint="GET /api/ingesta/publicaciones"
        hayDatos={publicaciones.length > 0}
      />

      {!cargando && !ausente && publicaciones.length === 0 && (
        <Vacio>Nadie ha publicado nada. Desde el móvil: /periferico › Publicar.</Vacio>
      )}

      <ul className="divide-y divide-panel-border">
        {ordenadas.map((p) => {
          const oficial = p.origen === "gabinete";
          const sospechosa = p.verificacion?.estado === "sospechoso";
          return (
            <li key={p.id} className={`px-3 py-2.5 ${oficial ? "border-l-2 border-l-brand bg-brand/6" : ""}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                {oficial && <BadgeCheck className="size-3.5 shrink-0 text-brand" aria-hidden />}
                <span className="truncate text-[12.5px] font-semibold text-foreground">{p.autor}</span>
                <span className="font-mono text-[10.5px] text-subtle">{hora(p.timestamp)}</span>
                <span className={`pildora ${oficial ? "pildora-marca" : ""}`}>{ORIGEN_ETIQUETA[p.origen] ?? p.origen}</span>
                {p.menciones > 1 && (
                  <Tooltip contenido="Publicaciones casi idénticas agrupadas bajo esta: el verificador las cuenta una sola vez.">
                    <span className="pildora font-mono">{p.menciones} menciones</span>
                  </Tooltip>
                )}
                {p.verificacion?.motivo ? (
                  <Tooltip titulo="Por qué" contenido={p.verificacion.motivo}>
                    <ChipVerificacion verificacion={p.verificacion} />
                  </Tooltip>
                ) : (
                  <ChipVerificacion verificacion={p.verificacion} />
                )}
              </div>

              <div className="mt-1.5 flex gap-2">
                {p.imagenUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element -- miniatura remota (R2 / data/uploads), sin optimizar */
                  <img
                    src={p.imagenUrl}
                    alt={`Imagen de la publicación de ${p.autor}`}
                    loading="lazy"
                    className={`size-16 shrink-0 rounded-lg border border-panel-border object-cover ${sospechosa ? "opacity-60 saturate-50" : ""}`}
                  />
                )}
                <p className={`min-w-0 flex-1 whitespace-pre-wrap text-[12.5px] leading-snug ${sospechosa ? "text-muted" : "text-foreground"}`}>
                  {p.texto}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
