"use client";

import { useState } from "react";
import { ChevronDown, Languages, Megaphone, Radio, Smartphone, Volume2, VolumeOff, type LucideIcon } from "lucide-react";
import type { AudioAlerta, EstadoDecision } from "@/lib/tipos-sistema";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { IDIOMA_UI } from "./ui";

const DESTINO_UI: Record<AudioAlerta["destino"], { etiqueta: string; icono: LucideIcon }> = {
  radio_efectivos: { etiqueta: "Radio efectivos", icono: Radio },
  megafonia: { etiqueta: "Megafonía", icono: Megaphone },
  push: { etiqueta: "Push ciudadanía", icono: Smartphone },
};

interface Props {
  /** undefined = sin alertas (se oculta); [] en decisión ejecutada = ElevenLabs no generó audio. */
  audios?: AudioAlerta[];
  /** Texto de plan.mensajeAlerta: se muestra como vista previa mientras la decisión no se ha ejecutado. */
  mensajePropuesto?: string;
  estado: EstadoDecision;
}

/** Alertas de voz multilingües (ElevenLabs → R2): una fila por idioma con su destino y reproductor. */
export function AudiosAlerta({ audios, mensajePropuesto, estado }: Props) {
  const [abiertos, setAbiertos] = useState<Set<number>>(() => new Set());
  const ejecutada = estado === "ejecutada" || estado === "auto";

  if (!audios || audios.length === 0) {
    // [] en una decisión ejecutada = se intentó y no hay síntesis (ElevenLabs sin configurar).
    if (audios && ejecutada) {
      return (
        <div>
          <Cabecera />
          <p className="flex items-center gap-1.5 rounded-[10px] border border-dashed border-panel-border px-3 py-2 text-[11px] text-muted">
            <VolumeOff className="size-3.5 shrink-0 text-subtle" aria-hidden /> Alertas de voz no generadas (ElevenLabs no
            configurado)
            <Ayuda texto="Sin credenciales de ElevenLabs no hay síntesis de voz: el texto de la alerta sigue en el acta para difundirlo por los canales habituales." />
          </p>
        </div>
      );
    }
    if (!mensajePropuesto || (estado !== "pendiente" && estado !== "ejecutando")) return null;
    return (
      <div>
        <Cabecera />
        <div className="rounded-[10px] border border-panel-border bg-panel-2 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
            <Volume2 className="size-3.5 text-subtle" aria-hidden /> Alerta que se difundirá al aprobar
            <Ayuda texto="Texto que se leerá a la población y a los efectivos. Si algo en él te chirría, deniega e indícalo: la IA lo reescribe." />
          </p>
          <p className="mt-1 text-xs italic leading-relaxed text-muted">&ldquo;{mensajePropuesto}&rdquo;</p>
          <p className="mt-1 text-[11px] text-subtle">ElevenLabs la sintetizará y traducirá al ejecutar.</p>
        </div>
      </div>
    );
  }

  const alternar = (i: number) =>
    setAbiertos((prev) => {
      const s = new Set(prev);
      if (s.has(i)) s.delete(i);
      else s.add(i);
      return s;
    });

  return (
    <div>
      <Cabecera n={audios.length} />
      <ul className="space-y-1.5">
        {audios.map((a, i) => {
          const destino = DESTINO_UI[a.destino] ?? { etiqueta: a.destino, icono: Volume2 };
          const IconoDestino = destino.icono;
          const tieneAudio = Boolean(a.url);
          const abierto = abiertos.has(i);
          return (
            <li key={`${a.idioma}-${i}`} className="rounded-[10px] border border-panel-border bg-panel-2 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <Tooltip
                  titulo={IDIOMA_UI[a.idioma] ?? a.idioma}
                  contenido="Idioma en el que se sintetizó la alerta, elegido por el perfil lingüístico de la zona afectada."
                >
                  <span className="pildora pildora-marca font-mono uppercase">{a.idioma}</span>
                </Tooltip>
                <span className="text-xs font-medium text-foreground">{IDIOMA_UI[a.idioma] ?? a.idioma}</span>
                <Tooltip
                  titulo={destino.etiqueta}
                  contenido="Canal por el que sale esta alerta: radio de efectivos, megafonía en calle o notificación push a la ciudadanía."
                >
                  <span className="flex items-center gap-1 text-[11px] text-muted">
                    <IconoDestino className="size-3" aria-hidden /> {destino.etiqueta}
                  </span>
                </Tooltip>
                <span className="ml-auto flex items-center gap-2">
                  {a.duracionSeg !== undefined && (
                    <Tooltip contenido="Duración del audio sintetizado.">
                      <span className="font-mono text-[11px] text-subtle">{a.duracionSeg} s</span>
                    </Tooltip>
                  )}
                  {tieneAudio && (
                    <button
                      type="button"
                      onClick={() => alternar(i)}
                      aria-expanded={abierto}
                      className="boton boton-fantasma boton-sm"
                    >
                      Texto
                      <ChevronDown className={`size-3 transition-transform ${abierto ? "rotate-180" : ""}`} aria-hidden />
                    </button>
                  )}
                </span>
              </div>

              {tieneAudio ? (
                <audio controls preload="none" src={a.url} className="mt-1.5 h-8 w-full" />
              ) : (
                <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-warning">
                  <Volume2 className="size-3" aria-hidden /> Audio pendiente de síntesis
                </p>
              )}
              {(!tieneAudio || abierto) && (
                <p className="mt-1 text-[11px] italic leading-relaxed text-muted">&ldquo;{a.texto}&rdquo;</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Cabecera({ n }: { n?: number }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        <Languages className="size-4 text-brand" aria-hidden /> Alertas multilingües
        <Ayuda
          titulo="Aviso a la población"
          texto="ElevenLabs sintetiza y traduce el mensaje a los idiomas más hablados en la zona afectada, y cada versión sale por su canal (radio, megafonía o push)."
        />
      </h4>
      <span className="text-[11px] text-muted">
        ElevenLabs{n ? <> · <span className="font-mono text-foreground">{n}</span> idiomas</> : null}
      </span>
    </div>
  );
}
