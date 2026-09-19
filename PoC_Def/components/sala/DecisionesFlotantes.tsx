"use client";
// Decisiones pendientes como ventanas flotantes sobre el mapa mientras el panel
// está plegado: se aprueban o deniegan sin abrir el panel, para no perder
// operatividad. DUEÑO: constructor E.
//
// Se apilan arriba a la derecha del mapa (la esquina que no usa ningún control
// del mapa), en el mismo orden que la pestaña "Requiere tu decisión". Se
// enseñan como mucho MAXIMO; el resto se cuenta y abre el panel. La pila se
// puede recoger, pero una decisión NUEVA la vuelve a desplegar sola.

import { memo, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Inbox, PanelRightOpen } from "lucide-react";
import type { Decision, Incendio, Informe } from "@/lib/dominio/tipos";
import { Boton } from "@/components/ui/Boton";
import { TarjetaDecision, type ObjetivoAccion } from "./TarjetaDecision";

/** Ventanas visibles a la vez: más taparían el mapa. */
const MAXIMO = 3;

const VACIO: never[] = [];

function pendiente(d: Decision): boolean {
  return d.estado === "pendiente_humano" || d.estado === "escalada";
}

function DecisionesFlotantesBase({
  decisiones,
  incendios,
  informes,
  onTrasDecidir,
  onCentrarIncendio,
  onCentrarUnidad,
  onCentrarObjetivo,
  onAbrirPanel,
}: {
  decisiones?: readonly Decision[];
  incendios?: readonly Incendio[];
  /** Informes de la ejecución, para abrir el acta de cada acción desde la ventana. */
  informes?: Informe[];
  onTrasDecidir?: () => void;
  onCentrarIncendio?: (id: string) => void;
  onCentrarUnidad?: (id: string) => void;
  /** Centra el mapa en el objetivo de una acción (pueblo avisado, cámara, punto). */
  onCentrarObjetivo?: (objetivo: ObjetivoAccion) => void;
  /** Abre el panel en "Requiere tu decisión". */
  onAbrirPanel: () => void;
}) {
  const pendientes = useMemo(
    () =>
      (decisiones ?? VACIO)
        .filter(pendiente)
        .sort((a, b) => a.prioridad - b.prioridad || a.creadaEn.localeCompare(b.creadaEn)),
    [decisiones],
  );

  /**
   * Ids que había cuando el mando recogió la pila. Sigue recogida solo mientras
   * no llegue ninguna decisión nueva: lo nuevo siempre se ve.
   */
  const [recogidaCon, setRecogidaCon] = useState<ReadonlySet<string> | null>(null);
  const recogida = recogidaCon !== null && pendientes.every((d) => recogidaCon.has(d.id));

  if (pendientes.length === 0) return null;

  const visibles = pendientes.slice(0, MAXIMO);
  const resto = pendientes.length - visibles.length;

  return (
    <section
      aria-label="Decisiones pendientes"
      className="absolute right-3 top-3 z-[1000] flex w-[26.25rem] max-w-[calc(100%-1.5rem)] max-h-[min(72vh,calc(100%-5.5rem))] flex-col gap-2 lg:right-[5.5rem] lg:max-h-[min(80vh,calc(100%-1.5rem))]"
    >
      <header className="flex shrink-0 items-center gap-1.5 rounded-xl border border-danger/45 bg-panel px-2.5 py-1.5 shadow-[var(--sombra-flotante)]">
        <Inbox className="size-4 shrink-0 text-danger" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
          Requiere tu decisión
          <span className="tabular latido ml-1.5 rounded-full bg-danger px-1.5 py-px text-[11px] text-white dark:text-[#2a0d10]">{pendientes.length}</span>
        </p>
        <Boton tamano="sm" variante="fantasma" icono={<PanelRightOpen />} onClick={onAbrirPanel} title="Abrir el panel en «Requiere tu decisión»">
          Abrir
        </Boton>
        <Boton
          tamano="sm"
          variante="fantasma"
          icono={recogida ? <ChevronDown /> : <ChevronUp />}
          aria-expanded={!recogida}
          onClick={() => setRecogidaCon(recogida ? null : new Set(pendientes.map((d) => d.id)))}
        >
          {recogida ? "Mostrar" : "Recoger"}
        </Boton>
      </header>

      {recogida ? null : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5 scroll-fino">
          {visibles.map((d) => (
            <div key={d.id} className="rounded-xl shadow-[var(--sombra-flotante)]">
              <TarjetaDecision
                decision={d}
                incendio={incendios?.find((i) => i.id === d.incendioId)}
                informes={informes}
                onTrasDecidir={onTrasDecidir}
                onCentrarIncendio={onCentrarIncendio}
                onCentrarUnidad={onCentrarUnidad}
                onCentrarObjetivo={onCentrarObjetivo}
              />
            </div>
          ))}
          {resto > 0 ? (
            <Boton ancho icono={<PanelRightOpen />} onClick={onAbrirPanel} className="shadow-[var(--sombra-flotante)]">
              {resto} más en el panel
            </Boton>
          ) : null}
        </div>
      )}
    </section>
  );
}

export const DecisionesFlotantes = memo(DecisionesFlotantesBase);
