"use client";
// Pestaña "Lecciones": qué ha aprendido el sistema y cómo va esta ejecución
// frente a la anterior. DUEÑO: constructor E.

import { GraduationCap, TrendingUp } from "lucide-react";
import type { Snapshot } from "@/lib/dominio/tipos";
import { fechaHora, numero } from "@/lib/cliente/formato";
import { Insignia } from "@/components/ui/Insignia";
import { Vacio } from "@/components/ui/Vacio";

const TEXTO_ORIGEN: Record<string, string> = {
  denegacion_humana: "Aprendida de una denegación tuya",
  aprobacion_humana: "Confirmada por una aprobación tuya",
  supervisor: "Detectada por el supervisor",
  resultado_accion: "Aprendida del resultado real de una acción",
  postmortem: "Extraída del post-mortem",
};

export function PestanaLecciones({ snapshot }: { snapshot?: Snapshot }) {
  const lecciones = [...(snapshot?.lecciones ?? [])].sort((a, b) => b.peso - a.peso);
  const comparativa = snapshot?.ejecucion?.comparativa;

  return (
    <div className="space-y-3">
      {comparativa ? (
        <section className="rounded-xl border border-brand/40 bg-brand/8 p-3">
          <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-brand">
            <TrendingUp className="size-3.5" aria-hidden /> Comparado con la ejecución anterior
          </h3>
          <p className="mt-1 text-[13px] leading-snug text-foreground">{comparativa}</p>
        </section>
      ) : null}

      {lecciones.length === 0 ? (
        <Vacio
          icono={<GraduationCap />}
          titulo="Todavía no hay lecciones"
          guia="Cada vez que deniegas una decisión con un motivo, o que una llamada sale mal, el agente de memoria escribe aquí qué cambiar la próxima vez."
        />
      ) : (
        <ul className="space-y-1.5">
          {lecciones.map((l) => (
            <li key={l.id} className="rounded-xl border border-panel-border bg-panel p-2.5">
              <p className="text-[13px] font-medium leading-snug text-foreground">{l.texto}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <Insignia pequena tono={l.peso >= 0.7 ? "marca" : "neutro"}>Peso {numero(l.peso * 100)} %</Insignia>
                <Insignia pequena tono="info">{l.agenteId === "*" ? "Todos los agentes" : l.agenteId}</Insignia>
                <Insignia pequena tono="neutro">{l.categoria.replace(/_/g, " ")}</Insignia>
                {l.vecesAplicada > 0 ? <Insignia pequena tono="exito">Aplicada {numero(l.vecesAplicada)} veces</Insignia> : null}
              </div>
              <p className="mt-1 text-[12px] leading-snug text-muted">
                <span className="font-medium text-foreground">Qué pasó:</span> {l.evidencia}
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-muted">
                <span className="font-medium text-foreground">Qué cambia:</span> {l.cambio}
              </p>
              <p className="mt-1 text-[11px] text-subtle">
                {TEXTO_ORIGEN[l.origen] ?? l.origen} · {fechaHora(l.creadaEn)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
