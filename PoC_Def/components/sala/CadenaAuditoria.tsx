"use client";
// Cadena de auditoría de una decisión: de lo que vio el agente a lo que pasó de
// verdad, paso a paso y sin huecos. DUEÑO: constructor E.
//
// Intenta GET /api/auditoria?decisionId=… (lo sirve el núcleo, con el historial
// completo); si esa ruta aún no existe, arma la cadena con lo que hay en el
// Snapshot para que la pantalla nunca se quede en blanco.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Download, FileText, History, Loader2 } from "lucide-react";
import type { Decision, Informe, Snapshot } from "@/lib/dominio/tipos";
import { obtenerAuditoria, urlExportarAuditoria, type CadenaAuditoria as Cadena } from "@/lib/cliente/api";
import { fechaHora, haceCuanto, hora } from "@/lib/cliente/formato";
import { Boton } from "@/components/ui/Boton";
import { Desplegable } from "@/components/ui/Desplegable";
import { Insignia, TEXTO_ESTADO_DECISION, tonoEstadoDecision } from "@/components/ui/Insignia";
import { useToast } from "@/components/ui/Toast";
import { CabeceraInforme, DialogoInforme, Markdown } from "./DialogoInforme";
import { LineaAccion, TarjetaDecision } from "./TarjetaDecision";
import { TarjetaTraza } from "./TrazaAgente";

/** Cadena reconstruida solo con el Snapshot, por si el núcleo aún no expone /api/auditoria. */
function cadenaDelSnapshot(decision: Decision, snapshot?: Snapshot): Cadena {
  const informes = (snapshot?.informes ?? []).filter(
    (i) => i.decisionId === decision.id || (decision.informeIds ?? []).includes(i.id) || i.id === decision.informeId,
  );
  const agente = snapshot?.agentes.find((a) => a.id === decision.agenteId);
  const traza = decision.trazaId
    ? agente?.trazas?.find((t) => t.id === decision.trazaId)
    : agente?.trazas?.find((t) => t.decisiones.includes(decision.id));
  return {
    decision,
    traza,
    acciones: decision.acciones.map((a) => ({ accion: a, informe: informes.find((i) => i.accionId === a.id) })),
    informes,
    eventos: (snapshot?.eventos ?? []).filter((e) => e.datos?.decisionId === decision.id || e.mensaje.includes(decision.id)),
    evidencias: decision.evidencias,
    fundamentos: decision.fundamentos,
    lecciones: (snapshot?.lecciones ?? []).filter((l) => (decision.leccionesAplicadas ?? []).some((x) => x.leccionId === l.id)),
  };
}

export function CadenaAuditoria({ decision, snapshot }: { decision: Decision; snapshot?: Snapshot }) {
  const toast = useToast();
  const [cadena, setCadena] = useState<Cadena>(() => cadenaDelSnapshot(decision, snapshot));
  const [cargando, setCargando] = useState(false);
  const [acta, setActa] = useState<Informe | null>(null);
  const [aviso, setAviso] = useState<string>();

  const respaldo = useMemo(() => cadenaDelSnapshot(decision, snapshot), [decision, snapshot]);

  // Al cambiar de decisión se parte de la cadena reconstruida con el Snapshot
  // (ajuste en el render) y la del núcleo la completa cuando llega.
  const [decisionPrevia, setDecisionPrevia] = useState(decision.id);
  if (decision.id !== decisionPrevia) {
    setDecisionPrevia(decision.id);
    setCadena(respaldo);
    setCargando(true);
    setAviso(undefined);
  }

  useEffect(() => {
    let cancelado = false;
    obtenerAuditoria(decision.id, decision)
      .then((c) => {
        if (cancelado) return;
        // El núcleo manda la verdad; lo que falte se completa con el snapshot.
        // Ojo: una lista vacía del núcleo NO debe borrar lo que sí tenemos.
        setCadena({
          ...respaldo,
          ...c,
          decision: c.decision ?? decision,
          traza: c.traza ?? respaldo.traza,
          acciones: c.acciones?.length ? c.acciones : respaldo.acciones,
          informes: c.informes?.length ? c.informes : respaldo.informes,
          lecciones: c.lecciones?.length ? c.lecciones : respaldo.lecciones,
        });
      })
      .catch(() => {
        if (!cancelado) setAviso("El servicio de auditoría no responde: se muestra la cadena reconstruida con el estado en vivo.");
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [decision, respaldo]);

  const copiarEnlace = useCallback(async () => {
    const url = `${window.location.origin}/auditoria?decision=${encodeURIComponent(decision.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.exito("Enlace copiado", url);
    } catch {
      toast.aviso("No se ha podido copiar", url);
    }
  }, [decision.id, toast]);

  const historial = cadena.decision?.historial ?? decision.historial ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 className="mr-auto text-sm font-semibold text-foreground">
          Cadena de auditoría
          {cargando ? <Loader2 className="ml-2 inline size-3.5 animate-spin text-muted" aria-hidden /> : null}
        </h2>
        <Boton tamano="sm" icono={<Download />} onClick={() => window.open(urlExportarAuditoria(decision.id), "_blank", "noopener")}>
          Exportar Markdown
        </Boton>
        <Boton tamano="sm" icono={<Copy />} onClick={copiarEnlace}>
          Copiar enlace
        </Boton>
      </div>

      {aviso ? (
        <p className="rounded-lg border border-warning/45 bg-warning/10 px-2.5 py-1.5 text-[12.5px] text-warning">{aviso}</p>
      ) : null}

      <section>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">1 · La decisión</h3>
        <TarjetaDecision
          decision={cadena.decision ?? decision}
          incendio={snapshot?.incendios.find((i) => i.id === decision.incendioId)}
          informes={cadena.informes ?? snapshot?.informes}
          conEnlaceAuditoria={false}
        />
      </section>

      <section>
        <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
          <History className="size-3.5" aria-hidden /> 2 · Cómo ha ido cambiando de estado
        </h3>
        {historial.length === 0 ? (
          <p className="rounded-xl border border-dashed border-panel-border-strong p-3 text-[12.5px] text-muted">
            El núcleo todavía no registra el historial de esta decisión. Se creó {haceCuanto(decision.creadaEn)} y ahora está en «
            {TEXTO_ESTADO_DECISION[decision.estado]}».
          </p>
        ) : (
          <ol className="space-y-1 rounded-xl border border-panel-border bg-panel p-2.5">
            {historial.map((h, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                <span className="tabular text-subtle">{hora(h.enMundo || h.en)}</span>
                <Insignia pequena tono={tonoEstadoDecision(h.estado)} punto>
                  {TEXTO_ESTADO_DECISION[h.estado]}
                </Insignia>
                <span className="font-medium text-foreground">{h.quien}</span>
                {h.motivo ? <span>— {h.motivo}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">3 · Qué vio y qué pensó el agente</h3>
        {cadena.traza ? (
          <TarjetaTraza traza={cadena.traza} abiertaPorDefecto />
        ) : (
          <p className="rounded-xl border border-dashed border-panel-border-strong p-3 text-[12.5px] text-muted">
            No se ha guardado la traza del ciclo que originó esta decisión (agente {decision.agenteId}).
          </p>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">4 · Qué se ejecutó de verdad</h3>
        <ul className="divide-y divide-panel-border rounded-xl border border-panel-border bg-panel px-2.5">
          {(cadena.acciones ?? []).length === 0 ? (
            <li className="py-2 text-[12.5px] text-muted">Esta decisión no llegó a ejecutar ninguna acción.</li>
          ) : (
            (cadena.acciones ?? []).map(({ accion, informe }) => (
              <LineaAccion
                key={accion.id}
                accion={accion}
                onAbrirActa={(id) => setActa(informe ?? (cadena.informes ?? []).find((i) => i.id === id) ?? null)}
              />
            ))
          )}
        </ul>
      </section>

      <section>
        <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
          <FileText className="size-3.5" aria-hidden /> 5 · Actas ({(cadena.informes ?? []).length})
        </h3>
        {(cadena.informes ?? []).length === 0 ? (
          <p className="rounded-xl border border-dashed border-panel-border-strong p-3 text-[12.5px] text-muted">
            Todavía no hay actas de esta decisión. El redactor las genera tras cada cambio de estado y tras cada acción.
          </p>
        ) : (
          <div className="space-y-1.5">
            {(cadena.informes ?? []).map((i) => (
              <Desplegable key={i.id} titulo={i.titulo}>
                <CabeceraInforme informe={i} />
                <div className="mt-2">
                  <Markdown texto={i.contenido || "_Acta sin contenido._"} />
                </div>
              </Desplegable>
            ))}
          </div>
        )}
      </section>

      {(cadena.lecciones ?? []).length > 0 ? (
        <section>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">6 · Lecciones que se tuvieron en cuenta</h3>
          <ul className="space-y-1 rounded-xl border border-panel-border bg-panel p-2.5 text-[12.5px] text-muted">
            {(cadena.lecciones ?? []).map((l) => (
              <li key={l.id}>
                <span className="font-medium text-foreground">{l.texto}</span> — {l.cambio}{" "}
                <span className="text-subtle">({fechaHora(l.creadaEn)})</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <DialogoInforme informe={acta} onCerrar={() => setActa(null)} />
    </div>
  );
}
