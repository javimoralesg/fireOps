"use client";
// "Requiere tu decisión": pendientes y escaladas ordenadas por prioridad y ETA,
// y debajo lo que se está ejecutando y lo recién ejecutado, con resultado real.
// DUEÑO: constructor E.

import { memo, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Inbox, Radio, ScrollText } from "lucide-react";
import type { Decision, Incendio, Informe, Snapshot } from "@/lib/dominio/tipos";
import { haceCuanto, recortar } from "@/lib/cliente/formato";
import { Desplegable } from "@/components/ui/Desplegable";
import { Insignia, TEXTO_ESTADO_DECISION, tonoEstadoDecision } from "@/components/ui/Insignia";
import { Vacio } from "@/components/ui/Vacio";
import { DialogoInforme } from "./DialogoInforme";
import { LineaAccion, TarjetaDecision, type ObjetivoAccion } from "./TarjetaDecision";

/** Lista vacía compartida: evita crear un array nuevo (y romper memos) por render. */
const VACIO: never[] = [];

function PestanaDecisionesBase({
  snapshot,
  onTrasDecidir,
  onCentrarIncendio,
  onCentrarUnidad,
  onCentrarObjetivo,
  amplio = false,
}: {
  snapshot?: Snapshot;
  onTrasDecidir?: () => void;
  onCentrarIncendio?: (id: string) => void;
  onCentrarUnidad?: (id: string) => void;
  /** Centra el mapa en el objetivo de una acción (pueblo avisado, cámara, punto). */
  onCentrarObjetivo?: (objetivo: ObjetivoAccion) => void;
  /** Panel ampliado a pantalla completa: las tarjetas se reparten en columnas. */
  amplio?: boolean;
}) {
  const decisiones = useMemo(() => snapshot?.decisiones ?? VACIO, [snapshot?.decisiones]);

  /**
   * RENDIMIENTO (constructor R): minutos hasta que el frente alcance el pueblo
   * más cercano de cada incendio. Antes esto recorría las 1000 poblaciones
   * DENTRO del comparador del `sort` (O(n log n × 1000)); ahora se calcula una
   * sola vez por porción y el orden es una simple lectura del mapa.
   */
  const etaPorIncendio = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const p of snapshot?.poblaciones ?? VACIO) {
      if (!p.incendioId || p.etaFrenteMin === undefined) continue;
      const previo = mapa.get(p.incendioId);
      if (previo === undefined || p.etaFrenteMin < previo) mapa.set(p.incendioId, p.etaFrenteMin);
    }
    return mapa;
  }, [snapshot?.poblaciones]);
  const etaDe = (d: Decision) => (d.incendioId ? (etaPorIncendio.get(d.incendioId) ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY);

  /** Comunicados que esperan el visto bueno de una persona. */
  const comunicadosPendientes = useMemo(
    () => (snapshot?.comunicados ?? []).filter((c) => c.estado === "pendiente_aprobacion" || c.estado === "borrador"),
    [snapshot?.comunicados],
  );

  const pendientes = useMemo(
    () =>
      decisiones
        .filter((d) => d.estado === "pendiente_humano" || d.estado === "escalada")
        .sort((a, b) => a.prioridad - b.prioridad || etaDe(a) - etaDe(b) || a.creadaEn.localeCompare(b.creadaEn)),
    // `etaDe` solo lee `etaPorIncendio`: depender del mapa basta (y no del snapshot entero).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [decisiones, etaPorIncendio],
  );

  const enEvaluacion = useMemo(() => decisiones.filter((d) => d.estado === "propuesta"), [decisiones]);
  const enMarcha = useMemo(
    () =>
      decisiones
        .filter((d) => ["ejecutando", "aprobada"].includes(d.estado))
        .sort((a, b) => (b.decididaEn ?? b.creadaEn).localeCompare(a.decididaEn ?? a.creadaEn))
        .slice(0, 8),
    [decisiones],
  );

  const recientes = useMemo(
    () =>
      decisiones
        .filter((d) => ["ejecutada", "fallida", "denegada"].includes(d.estado))
        .sort((a, b) => (b.decididaEn ?? b.creadaEn).localeCompare(a.decididaEn ?? a.creadaEn))
        .slice(0, 10),
    [decisiones],
  );

  /** Índice de incendios: una sola pasada en vez de un `find` por tarjeta. */
  const incendioPorId = useMemo(
    () => new Map<string, Incendio>((snapshot?.incendios ?? VACIO).map((i) => [i.id, i])),
    [snapshot?.incendios],
  );
  const informes = snapshot?.informes;

  return (
    <div className="space-y-3">
      {pendientes.length === 0 ? (
        <Vacio
          icono={<CheckCircle2 />}
          titulo="Nada requiere tu decisión"
          guia={
            decisiones.length === 0
              ? "Cuando haya un foco, los agentes propondrán despliegues y avisos; los que superen tu política de autonomía aparecerán aquí."
              : "Los agentes están trabajando dentro de la autonomía que les has dado. Aquí solo aparece lo que te toca a ti."
          }
        />
      ) : (
        <div className={amplio ? "grid items-start gap-2.5 @3xl:grid-cols-2 @min-[96rem]:grid-cols-3" : "space-y-2.5"}>
          {pendientes.map((d) => (
            <TarjetaDecision
              key={d.id}
              decision={d}
              incendio={d.incendioId ? incendioPorId.get(d.incendioId) : undefined}
              informes={informes}
              onTrasDecidir={onTrasDecidir}
              onCentrarIncendio={onCentrarIncendio}
              onCentrarUnidad={onCentrarUnidad}
              onCentrarObjetivo={onCentrarObjetivo}
            />
          ))}
        </div>
      )}

      {/* Lo que ya está en marcha o hecho: en el panel ampliado (o ensanchado ≥ 64 rem), dos columnas. */}
      <div className={amplio ? "grid items-start gap-3 @5xl:grid-cols-2" : "space-y-3"}>
      {comunicadosPendientes.length > 0 ? (
        <section>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
            <Radio className="size-3.5" aria-hidden /> Comunicados pendientes ({comunicadosPendientes.length})
          </h3>
          <div className="space-y-1.5">
            {comunicadosPendientes.map((c) => (
              <article key={c.id} className="rounded-xl border border-panel-border bg-panel p-2.5">
                <p className="text-[13px] font-medium leading-snug text-foreground">{c.titulo}</p>
                <p className="mt-0.5 line-clamp-3 text-[12px] leading-snug text-muted">{recortar(c.cuerpo, 240)}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-subtle">
                  <Insignia pequena tono="aviso">
                    {c.estado === "borrador" ? "Borrador" : "Pendiente de aprobación"}
                  </Insignia>
                  <span>Canales: {c.canales.join(", ") || "portal"}</span>
                  <Link href="/publico" className="text-brand underline underline-offset-2">
                    Ver el portal ciudadano
                  </Link>
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {enMarcha.length > 0 ? (
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">En ejecución</h3>
          <div className="space-y-1.5">
            {enMarcha.map((d) => (
              <ResumenEjecucion key={d.id} decision={d} informes={informes} onCentrarUnidad={onCentrarUnidad} onCentrarObjetivo={onCentrarObjetivo} />
            ))}
          </div>
        </section>
      ) : null}

      {enEvaluacion.length > 0 ? (
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">En evaluación por el supervisor ({enEvaluacion.length})</h3>
          <div className="space-y-1.5">
            {enEvaluacion.map((d) => (
              <div key={d.id} className="rounded-xl border border-panel-border bg-panel p-2.5">
                <p className="text-[13px] font-medium leading-snug text-foreground">{d.titulo}</p>
                <p className="mt-0.5 text-[12px] text-muted">
                  <span className="latido">●</span> {d.agenteId} lo ha propuesto; el supervisor lo está puntuando y el asesor legal buscando fundamentos.
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {recientes.length > 0 ? (
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">Ejecutadas recientemente</h3>
          <div className="space-y-1.5">
            {recientes.map((d) => (
              <ResumenEjecucion key={d.id} decision={d} informes={informes} onCentrarUnidad={onCentrarUnidad} onCentrarObjetivo={onCentrarObjetivo} />
            ))}
          </div>
        </section>
      ) : null}
      </div>

      {decisiones.length === 0 && (snapshot?.incendios.length ?? 0) > 0 ? (
        <Vacio
          icono={<Inbox />}
          titulo="Los agentes aún no han propuesto nada"
          guia="Están recogiendo meteo, entorno y medios del foco. En cuanto tengan una propuesta aparecerá aquí."
        />
      ) : null}
    </div>
  );
}

const PestanaDecisionesMemo = memo(PestanaDecisionesBase);
export { PestanaDecisionesMemo as PestanaDecisiones };

function ResumenEjecucionBase({
  decision,
  informes,
  onCentrarUnidad,
  onCentrarObjetivo,
}: {
  decision: Decision;
  informes?: Informe[];
  onCentrarUnidad?: (id: string) => void;
  onCentrarObjetivo?: (objetivo: ObjetivoAccion) => void;
}) {
  const [acta, setActa] = useState<Informe | null>(null);
  const fallidas = decision.acciones.filter((a) => a.estado === "fallida").length;
  const autonoma = decision.competencia === "autonoma";
  return (
    <div className={`rounded-xl border bg-panel p-2.5 ${decision.estado === "fallida" || fallidas > 0 ? "border-danger/45" : "border-panel-border"}`}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-foreground">{decision.titulo}</p>
        <Link
          href={`/auditoria?decision=${encodeURIComponent(decision.id)}`}
          title="Ver la cadena de auditoría"
          className="shrink-0 rounded-lg p-0.5 text-muted hover:text-brand"
        >
          <ScrollText className="size-3.5" aria-hidden />
          <span className="solo-lectores">Ver la cadena de auditoría</span>
        </Link>
        <span className="shrink-0 text-[10.5px] text-subtle">{haceCuanto(decision.decididaEn ?? decision.creadaEn)}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {autonoma ? (
          <Insignia pequena tono="marca" punto title="Decidida y ejecutada por el sistema dentro de su autonomía">
            Autónoma: ataque inicial
          </Insignia>
        ) : null}
        <Insignia pequena tono={tonoEstadoDecision(decision.estado)} punto>
          {TEXTO_ESTADO_DECISION[decision.estado]}
        </Insignia>
        {decision.decididaPor ? <Insignia pequena tono="neutro">{decision.decididaPor}</Insignia> : null}
        {fallidas > 0 ? <Insignia pequena tono="peligro">{fallidas} acciones fallidas</Insignia> : null}
      </div>
      {decision.comentarioHumano ? (
        <p className="mt-1 text-[12px] leading-snug text-muted">
          <span className="font-medium text-foreground">Motivo:</span> {decision.comentarioHumano}
        </p>
      ) : null}
      {decision.acciones.length > 0 ? (
        <Desplegable
          className="mt-1.5"
          titulo="Resultado de cada acción"
          cuenta={decision.acciones.length}
          abiertoPorDefecto={decision.estado === "ejecutando" || fallidas > 0}
        >
          <ul className="divide-y divide-panel-border">
            {decision.acciones.map((a) => (
              <LineaAccion
                key={a.id}
                accion={a}
                onAbrirActa={(id) => setActa((informes ?? []).find((i) => i.id === id) ?? null)}
                onCentrarUnidad={onCentrarUnidad}
                onCentrarObjetivo={onCentrarObjetivo}
              />
            ))}
          </ul>
        </Desplegable>
      ) : null}
      <DialogoInforme informe={acta} onCerrar={() => setActa(null)} />
    </div>
  );
}

/** `memo`: una fila de "en ejecución"/"reciente" solo se repinta si cambia SU decisión. */
const ResumenEjecucion = memo(ResumenEjecucionBase);
