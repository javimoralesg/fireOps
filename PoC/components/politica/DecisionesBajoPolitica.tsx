"use client";

import Link from "next/link";
import { ChevronRight, Inbox, ShieldCheck, TriangleAlert } from "lucide-react";
import { ESTADO_UI } from "@/components/decision/ui";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { CATALOGO, type PoliticaAutonomia } from "@/lib/politica-autonomia";
import { ROLES } from "@/lib/roles";
import type { Decision } from "@/lib/tipos-sistema";
import { SelloCompetencia } from "./SelloCompetencia";
import { MODO_UI, veredictoDe } from "./ui";

interface Props {
  decisiones: Decision[];
  politica: PoliticaAutonomia;
  umbral: number;
  cargando: boolean;
}

const VISIBLES = new Set<Decision["estado"]>(["pendiente", "ejecutando", "auto", "ejecutada"]);

/**
 * Las decisiones vivas de la consola pasadas por la política: qué actuaciones
 * contiene cada una, en qué modo cae y quién debe firmarla. Si una se ejecutó
 * sola y con la política actual no habría podido, se avisa.
 */
export function DecisionesBajoPolitica({ decisiones, politica, umbral, cargando }: Props) {
  const lista = decisiones
    .filter((d) => VISIBLES.has(d.estado))
    .sort((a, b) => Date.parse(b.creadaEn) - Date.parse(a.creadaEn))
    .slice(0, 8);

  return (
    <section className="superficie flex min-h-0 flex-col rounded-2xl border border-panel-border bg-panel">
      <div className="flex items-center justify-between gap-2 border-b border-panel-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <ShieldCheck className="size-4 text-brand" aria-hidden /> Decisiones bajo esta política
          <Ayuda
            titulo="Qué muestra"
            texto="Las propuestas activas de la consola, clasificadas por las actuaciones que contienen. El riesgo efectivo es el mayor entre el que estimó la IA y el suelo de la actuación más grave."
          />
        </h2>
        <span className="text-[11px] text-muted">{lista.length} activas</span>
      </div>

      {cargando ? (
        <p className="px-4 py-6 text-center text-[12px] text-muted">Cargando decisiones…</p>
      ) : lista.length === 0 ? (
        <p className="flex items-center justify-center gap-2 px-4 py-6 text-[12px] text-muted">
          <Inbox className="size-4" aria-hidden /> No hay decisiones activas. Avanza el escenario en la consola.
        </p>
      ) : (
        <ul className="divide-y divide-panel-border">
          {lista.map((d) => {
            const { veredicto: v, origen } = veredictoDe(d, politica, umbral);
            const E = ESTADO_UI[d.estado];
            const IconoEstado = E.icono;
            const nombres = v.categorias.map((id) => CATALOGO.find((c) => c.id === id)?.nombre ?? id);
            const seEjecutoSola = d.estado === "auto";
            const incoherente = seEjecutoSola && v.modo !== "autonoma";
            return (
              <li key={d.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/auditoria?decision=${encodeURIComponent(d.id)}`}
                      className="group flex items-center gap-1 text-[13px] font-semibold text-foreground hover:text-brand"
                    >
                      <span className="truncate">{d.tarjeta.titulo}</span>
                      <ChevronRight className="size-3.5 shrink-0 text-subtle transition group-hover:text-brand" aria-hidden />
                    </Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                      <span className={`flex items-center gap-1 ${E.color}`}>
                        <IconoEstado className={`size-3 ${E.girar ? "animate-spin" : ""}`} aria-hidden /> {E.etiqueta}
                      </span>
                      <span className="text-subtle">·</span>
                      <Tooltip
                        titulo="Riesgo"
                        contenido={
                          v.riesgoEfectivo !== v.riesgoPropuesto
                            ? `La IA estimó ${v.riesgoPropuesto}; la política aplica el suelo ${v.riesgoEfectivo} de "${nombres[0]}".`
                            : "Riesgo estimado por la IA; ninguna actuación del catálogo lo eleva."
                        }
                      >
                        <span>
                          riesgo <span className="font-mono text-foreground">{v.riesgoEfectivo}</span>
                          {v.riesgoEfectivo !== v.riesgoPropuesto && <span className="text-subtle"> (IA: {v.riesgoPropuesto})</span>}
                        </span>
                      </Tooltip>
                      {nombres.length > 0 && (
                        <>
                          <span className="text-subtle">·</span>
                          <span className="truncate">{nombres.join(", ")}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <SelloCompetencia veredicto={v} />
                    <span className="text-[10.5px] text-subtle">{origen === "motor" ? "evaluada por el motor" : "evaluada en cliente"}</span>
                  </div>
                </div>
                {incoherente && (
                  <p className={`mt-2 flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] ${MODO_UI.humano.tinte} text-warning`}>
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>
                      Se ejecutó sola con la política anterior. Con la actual habría esperado la firma de{" "}
                      <strong>{v.firmaMinima ? ROLES[v.firmaMinima].nombre : "una persona"}</strong>.
                    </span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
