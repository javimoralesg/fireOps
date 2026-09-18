"use client";

import { useState } from "react";
import { Gauge } from "lucide-react";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import type { CategoriaAccion } from "@/lib/politica-autonomia";
import { ROLES_FIRMA } from "./ui";

interface Props {
  umbral: number;
  editable: boolean;
  catalogo: CategoriaAccion[];
  onUmbral: (umbral: number) => Promise<void>;
}

/**
 * Umbral de autonomía: riesgo máximo que la IA ejecuta sin firma humana, con la
 * escala de límites de firma por rol debajo. Se arrastra y se aplica al soltar
 * (mismo contrato que el slider del Header, misma llamada POST /api/config).
 */
export function ControlUmbral({ umbral, editable, catalogo, onUmbral }: Props) {
  const [borrador, setBorrador] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const valor = borrador ?? umbral;

  const soltar = async () => {
    if (borrador === null) return;
    if (borrador === umbral) {
      setBorrador(null);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await onUmbral(borrador);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el umbral");
    } finally {
      setGuardando(false);
      setBorrador(null);
    }
  };

  const autonomas = catalogo.filter((c) => c.modo === "autonoma");
  const solas = autonomas.filter((c) => c.riesgoMinimo <= valor);
  const conFirma = autonomas.filter((c) => c.riesgoMinimo > valor);

  return (
    <section className="superficie rounded-2xl border border-panel-border bg-panel">
      <div className="flex items-center justify-between gap-2 border-b border-panel-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <Gauge className="size-4 text-brand" aria-hidden /> Umbral de autonomía
          <Ayuda
            titulo="Qué es el umbral"
            texto="Riesgo máximo (0–100) que la IA puede ejecutar sin firma humana. Solo afecta a las actuaciones en modo autónomo: las supervisadas y las reservadas siempre pasan por una persona. Lo fija la Dirección del Plan."
          />
        </h2>
        <span className="text-[11px] text-muted">{editable ? "Se aplica al soltar" : "Solo la Dirección del Plan puede cambiarlo"}</span>
      </div>

      <div className="grid gap-4 px-4 py-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
        <div className="flex items-baseline gap-2 md:flex-col md:items-start md:gap-0">
          <span className="font-mono text-3xl font-semibold leading-none text-foreground">{valor}</span>
          <span className="text-[11px] text-muted">de 100</span>
        </div>

        <div className="min-w-0">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={valor}
            disabled={!editable || guardando}
            onChange={(e) => setBorrador(Number(e.target.value))}
            onPointerUp={soltar}
            onKeyUp={soltar}
            onBlur={soltar}
            className="w-full accent-brand disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Umbral de autonomía de la IA"
            aria-valuetext={`${valor} de 100`}
          />
          {/* Escala: límites de firma por rol */}
          <div className="relative mt-1 h-9 text-[10.5px] text-muted">
            {ROLES_FIRMA.map((r) => (
              <Tooltip key={r.id} titulo={r.nombre} contenido={`Firma decisiones hasta riesgo ${r.riesgoMaxDecision}. ${r.cargoReal}.`} lado="abajo">
                <span
                  className="absolute top-0 flex -translate-x-1/2 flex-col items-center whitespace-nowrap"
                  style={{ left: `${r.riesgoMaxDecision}%` }}
                >
                  <span className="h-2 w-px bg-panel-border-strong" aria-hidden />
                  <span className="font-mono text-foreground">{r.riesgoMaxDecision}</span>
                  <span className="hidden sm:inline">{r.iniciales}</span>
                </span>
              </Tooltip>
            ))}
          </div>

          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            Con umbral <span className="font-mono text-foreground">{valor}</span>, la IA ejecuta sola{" "}
            {solas.length ? (
              <>
                <strong className="font-medium text-foreground">{solas.map((c) => c.nombre.toLowerCase()).join(", ")}</strong>
              </>
            ) : (
              <strong className="font-medium text-foreground">nada</strong>
            )}
            .{" "}
            {conFirma.length > 0 && (
              <>
                Aunque son autónomas, <strong className="font-medium text-foreground">{conFirma.map((c) => c.nombre.toLowerCase()).join(", ")}</strong> superan el umbral y esperan firma.{" "}
              </>
            )}
            El resto del catálogo pasa siempre por una persona.
          </p>
          {error && (
            <p className="mt-1 text-[12px] text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
