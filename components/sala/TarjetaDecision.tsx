"use client";
// Tarjeta de una decisión que requiere al humano: qué se propone, por qué, qué
// se va a hacer, qué dice el supervisor y los botones grandes de Aprobar/Denegar.
// DUEÑO: constructor E.

import { memo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BookOpen, Bot, Check, Crosshair, ExternalLink, FileText, Gavel, MapPin, Scale, ScrollText, ThumbsDown, X } from "lucide-react";
import type { Accion, Decision, Incendio, Informe } from "@/lib/dominio/tipos";
import { aprobarDecision, denegarDecision, mensajeDeError } from "@/lib/cliente/api";
import { fechaHora, haceCuanto, numero, recortar } from "@/lib/cliente/formato";
import { urlConocimiento } from "@/lib/cliente/enlaces";
import { EnlaceExterno, EnlaceInterno } from "@/components/ui/Enlace";
import { Boton } from "@/components/ui/Boton";
import { Desplegable } from "@/components/ui/Desplegable";
import { Dialogo } from "@/components/ui/Dialogo";
import {
  Insignia,
  TEXTO_COMPETENCIA,
  TEXTO_ESTADO_DECISION,
  tonoCompetencia,
  tonoEstadoDecision,
  tonoPrioridad,
} from "@/components/ui/Insignia";
import { useToast } from "@/components/ui/Toast";
import { ICONO_ACCION, TEXTO_ACCION, TEXTO_ESTADO_ACCION, tonoEstadoAccion } from "./acciones";
import { DialogoInforme } from "./DialogoInforme";

/** Quién firma las aprobaciones desde esta pantalla. */
export const QUIEN = "Sala de mando";

/** Objetivo de una acción (pueblo avisado, cámara, unidad o punto) que se puede llevar al mapa. */
export type ObjetivoAccion = NonNullable<Accion["objetivo"]>;

/** true si el objetivo de la acción tiene algo que centrar en el mapa. */
export function objetivoLocalizable(o: Accion["objetivo"]): o is ObjetivoAccion {
  return Boolean(o && (o.punto || o.poblacionId || o.camaraId || o.unidadId));
}

const MOTIVOS_RAPIDOS = [
  "Los medios propuestos no están disponibles",
  "El pueblo ya ha sido avisado por otra vía",
  "No procede: el frente no va en esa dirección",
  "Falta coordinación con el mando autonómico",
  "Demasiado agresivo para el nivel actual",
];

/** `memo` (constructor R): una línea de acción solo se repinta si cambia SU acción. */
function LineaAccionBase({
  accion,
  onAbrirActa,
  onCentrarUnidad,
  onCentrarObjetivo,
}: {
  accion: Accion;
  onAbrirActa?: (informeId: string) => void;
  /** "Ver en el mapa": centra en la unidad que mueve esta acción. */
  onCentrarUnidad?: (unidadId: string) => void;
  /** "Ver en el mapa" para el resto de objetivos: pueblo avisado, cámara o punto. */
  onCentrarObjetivo?: (objetivo: ObjetivoAccion) => void;
}) {
  const Icono = ICONO_ACCION[accion.tipo] ?? AlertTriangle;
  const r = accion.resultado;
  const unidadId = accion.objetivo?.unidadId;
  const objetivo = accion.objetivo;
  /** Qué hace "Ver en el mapa" en esta línea: la unidad si la hay; si no, el pueblo/cámara/punto. */
  const verEnMapa =
    unidadId && onCentrarUnidad
      ? () => onCentrarUnidad(unidadId)
      : objetivoLocalizable(objetivo) && onCentrarObjetivo
        ? () => onCentrarObjetivo(objetivo)
        : undefined;
  return (
    <li className="flex items-start gap-2 py-1">
      <Icono className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-foreground">{accion.descripcion}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-subtle">
          <Insignia pequena tono={tonoEstadoAccion(accion.estado)}>{TEXTO_ESTADO_ACCION[accion.estado]}</Insignia>
          <span>{TEXTO_ACCION[accion.tipo] ?? accion.tipo}</span>
          {accion.autorizadaPor ? <span>· autorizada por {accion.autorizadaPor}</span> : null}
          {accion.ordenadaEn ? <span>· ordenada {haceCuanto(accion.ordenadaEn)}</span> : null}
          {accion.ejecutadaEn ? <span>· ejecutada {haceCuanto(accion.ejecutadaEn)}</span> : null}
        </p>
        {r ? (
          <p className={`mt-0.5 text-[11.5px] leading-snug ${r.exito ? "text-success" : "text-danger"}`}>
            {r.proveedor}: {r.resumen}
            {r.referencia ? <span className="text-subtle"> · ref. {r.referencia}</span> : null}
          </p>
        ) : null}
        {verEnMapa ? (
          <button
            type="button"
            onClick={verEnMapa}
            className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-brand/45 bg-brand/10 px-2 py-0.5 text-[10.5px] font-medium text-brand hover:bg-brand/20"
          >
            <Crosshair className="size-3" aria-hidden /> Ver en el mapa
          </button>
        ) : null}
      </div>
      {accion.informeId && onAbrirActa ? (
        <button
          type="button"
          onClick={() => onAbrirActa(accion.informeId as string)}
          title="Ver el acta de esta acción"
          className="-m-1 shrink-0 rounded-lg p-1 text-muted hover:bg-panel-2 hover:text-brand"
        >
          <FileText className="size-4" aria-hidden />
          <span className="solo-lectores">Ver el acta de esta acción</span>
        </button>
      ) : null}
    </li>
  );
}

export const LineaAccion = memo(LineaAccionBase);

/**
 * `memo` (constructor R): con el contrato de identidad del cliente, una tarjeta
 * cuya decisión no ha cambiado no se repinta aunque llegue un snapshot nuevo.
 */
function TarjetaDecisionBase({
  decision,
  incendio,
  informes,
  onTrasDecidir,
  onCentrarIncendio,
  onCentrarUnidad,
  onCentrarObjetivo,
  conEnlaceAuditoria = true,
}: {
  decision: Decision;
  incendio?: Incendio;
  /** Informes de la ejecución, para abrir el acta de cada acción sin salir de la sala. */
  informes?: Informe[];
  onTrasDecidir?: () => void;
  onCentrarIncendio?: (id: string) => void;
  onCentrarUnidad?: (id: string) => void;
  /** Centra el mapa en el objetivo de una acción (pueblo avisado, cámara, unidad o punto). */
  onCentrarObjetivo?: (objetivo: ObjetivoAccion) => void;
  conEnlaceAuditoria?: boolean;
}) {
  const toast = useToast();
  const [acta, setActa] = useState<Informe | null>(null);
  const abrirActa = (informeId: string) => {
    const encontrado = (informes ?? []).find((i) => i.id === informeId);
    if (encontrado) setActa(encontrado);
    else toast.aviso("El acta todavía no está disponible", "El redactor la genera justo después de ejecutar la acción.");
  };
  const [ocupado, setOcupado] = useState<"aprobar" | "denegar" | null>(null);
  /** Estado optimista: el SSE lo corrige en cuanto llegue el snapshot. */
  const [resueltaComo, setResueltaComo] = useState<"aprobada" | "denegada" | null>(null);
  const [dialogoDenegar, setDialogoDenegar] = useState(false);
  const [motivo, setMotivo] = useState("");

  const pendiente = decision.estado === "pendiente_humano" || decision.estado === "escalada";
  /**
   * Decisión que el sistema ha tomado y ejecutado SOLO, dentro de la autonomía
   * que le ha dado el mando: hay que verlo, no esconderlo.
   */
  const autonomaEnMarcha =
    decision.competencia === "autonoma" && ["ejecutando", "ejecutada", "aprobada"].includes(decision.estado);

  async function aprobar() {
    setOcupado("aprobar");
    setResueltaComo("aprobada");
    try {
      await aprobarDecision(decision.id, QUIEN);
      toast.exito("Decisión aprobada", decision.titulo);
      onTrasDecidir?.();
    } catch (e) {
      setResueltaComo(null);
      toast.error("No se ha podido aprobar", mensajeDeError(e));
    } finally {
      setOcupado(null);
    }
  }

  async function denegar() {
    const texto = motivo.trim();
    if (texto.length < 4) {
      toast.aviso("Hace falta un motivo", "El motivo es lo que el sistema aprende: escribe al menos una frase.");
      return;
    }
    setOcupado("denegar");
    setResueltaComo("denegada");
    try {
      await denegarDecision(decision.id, QUIEN, texto);
      toast.exito("Decisión denegada", "El motivo se guarda como lección para los agentes.");
      setDialogoDenegar(false);
      setMotivo("");
      onTrasDecidir?.();
    } catch (e) {
      setResueltaComo(null);
      toast.error("No se ha podido denegar", mensajeDeError(e));
    } finally {
      setOcupado(null);
    }
  }

  const evaluacion = decision.evaluacion;

  /**
   * "Dónde": el foco de la decisión o, si no tiene foco, el objetivo de la
   * primera acción que se pueda situar (pueblo avisado, cámara, unidad, punto).
   */
  const objetivoSituable = decision.acciones.map((a) => a.objetivo).find(objetivoLocalizable);
  const centrarEnMapa =
    incendio && onCentrarIncendio
      ? () => onCentrarIncendio(incendio.id)
      : objetivoSituable && onCentrarObjetivo
        ? () => onCentrarObjetivo(objetivoSituable)
        : undefined;

  return (
    <article
      className={[
        "rounded-xl border bg-panel",
        decision.estado === "escalada" ? "border-l-4 border-l-danger border-panel-border" : "border-panel-border",
        resueltaComo ? "opacity-60" : "",
      ].join(" ")}
    >
      <header className="px-3 pt-3">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-[14px] font-semibold leading-tight text-foreground">{decision.titulo}</h3>
          <span className="shrink-0 text-[10.5px] text-subtle">{haceCuanto(decision.creadaEn)}</span>
        </div>
        <p className="mt-1 text-[13px] leading-snug text-muted">{decision.resumen}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {autonomaEnMarcha ? (
            <Insignia
              pequena
              tono="marca"
              punto
              title="El sistema lo ha decidido y ejecutado dentro de la autonomía que le has dado, sin esperar a nadie."
            >
              <Bot className="mr-0.5 inline size-3" aria-hidden /> Autónoma: ataque inicial
            </Insignia>
          ) : null}
          <Insignia pequena tono={tonoPrioridad(decision.prioridad)} punto>
            Prioridad {decision.prioridad}
          </Insignia>
          <Insignia pequena tono={decision.riesgo >= 70 ? "peligro" : decision.riesgo >= 40 ? "aviso" : "exito"}>
            Riesgo {numero(decision.riesgo)}
          </Insignia>
          <Insignia pequena tono={tonoCompetencia(decision.competencia)}>{TEXTO_COMPETENCIA[decision.competencia]}</Insignia>
          <Insignia pequena tono={tonoEstadoDecision(resueltaComo ? (resueltaComo === "aprobada" ? "aprobada" : "denegada") : decision.estado)}>
            {resueltaComo
              ? resueltaComo === "aprobada"
                ? "Aprobada"
                : "Denegada"
              : TEXTO_ESTADO_DECISION[decision.estado]}
          </Insignia>
          {conEnlaceAuditoria ? (
            <Link
              href={`/auditoria?decision=${encodeURIComponent(decision.id)}`}
              className="inline-flex items-center gap-1 rounded-full border border-brand/45 bg-brand/10 px-2 py-0.5 text-[10.5px] font-medium text-brand hover:bg-brand/20"
            >
              <ScrollText className="size-3" aria-hidden /> Ver auditoría
            </Link>
          ) : null}
        </div>

        {/* Dónde es: el foco (o el objetivo de la acción) y el botón que lleva el mapa allí. */}
        {incendio || centrarEnMapa ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-panel-border bg-panel-2 px-2 py-1.5">
            <MapPin className="size-4 shrink-0 text-brand" aria-hidden />
            <p className="min-w-0 flex-1 text-[12px] leading-snug text-muted">
              <span className="font-semibold text-foreground">Dónde:</span> {incendio ? incendio.nombre : "el objetivo de la acción"}
            </p>
            {centrarEnMapa ? (
              <Boton tamano="sm" variante="primario" icono={<Crosshair />} onClick={centrarEnMapa} title="Lleva el mapa a este punto" className="shrink-0">
                Centrar en el mapa
              </Boton>
            ) : incendio ? (
              <Link
                href={`/?foco=${encodeURIComponent(incendio.id)}`}
                title="Abrir la sala con el mapa centrado en este foco"
                className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-panel-border-strong bg-panel px-2.5 text-[13px] font-medium text-foreground hover:bg-panel-2"
              >
                <ExternalLink className="size-3.5" aria-hidden /> Ver en el mapa
              </Link>
            ) : null}
          </div>
        ) : null}
      </header>

      {decision.alertasLegales?.length ? (
        <div className="mx-3 mt-2 rounded-lg border border-danger/45 bg-danger/10 p-2">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-danger">
            <Scale className="size-3.5" aria-hidden /> Alerta legal
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] leading-snug text-danger">
            {decision.alertasLegales.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="px-3 pt-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Qué se va a hacer</h4>
        <ul className="mt-0.5 divide-y divide-panel-border">
          {decision.acciones.length === 0 ? (
            <li className="py-1 text-[13px] text-muted">Sin acciones asociadas.</li>
          ) : (
            decision.acciones.map((a) => (
              <LineaAccion key={a.id} accion={a} onAbrirActa={abrirActa} onCentrarUnidad={onCentrarUnidad} onCentrarObjetivo={onCentrarObjetivo} />
            ))
          )}
        </ul>
      </div>

      <div className="space-y-1.5 px-3 pt-2">
        <Desplegable titulo="Por qué lo propone">
          <p className="whitespace-pre-line">{decision.razonamiento || "El agente no ha dejado razonamiento para esta decisión."}</p>
          {decision.motivoReplanificacion ? (
            <p className="mt-1.5 font-medium text-warning">Replanificación: {decision.motivoReplanificacion}</p>
          ) : null}
          {decision.leccionesAplicadas?.length ? (
            <p className="mt-1.5">
              <span className="font-medium text-foreground">Lecciones aplicadas:</span>{" "}
              {decision.leccionesAplicadas.map((l) => l.texto).join(" · ")}
            </p>
          ) : null}
        </Desplegable>

        {evaluacion ? (
          <Desplegable
            titulo={
              <span className="flex items-center gap-1.5">
                <Gavel className="size-3.5" aria-hidden />
                Supervisor: {numero(evaluacion.puntuacion)}/100 · {evaluacion.aprueba ? "aprueba" : "suspende"}
              </span>
            }
          >
            {evaluacion.motivoEscalado ? <p className="mb-1 font-medium text-warning">{evaluacion.motivoEscalado}</p> : null}
            <ul className="space-y-1">
              {evaluacion.criterios.map((c, i) => (
                <li key={i}>
                  <span className="font-medium text-foreground">
                    {c.nombre} · {numero(c.puntuacion)}
                  </span>{" "}
                  — {c.comentario}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-subtle">Evaluado con {evaluacion.modelo} · {fechaHora(evaluacion.en)}</p>
          </Desplegable>
        ) : null}

        {decision.evidencias.length > 0 ? (
          <Desplegable titulo="Evidencias" cuenta={decision.evidencias.length}>
            <ul className="space-y-1">
              {decision.evidencias.map((ev) => (
                <li key={ev.id}>
                  {/* Si la evidencia trae URL, el NOMBRE de la fuente la abre. */}
                  <EnlaceExterno href={ev.url} titulo={`Abrir la fuente: ${ev.fuente}`}>
                    {ev.fuente}
                  </EnlaceExterno>{" "}
                  — {ev.resumen}
                  <span className="text-subtle"> · {haceCuanto(ev.en)}</span>
                </li>
              ))}
            </ul>
          </Desplegable>
        ) : null}

        {decision.fundamentos.length > 0 ? (
          <Desplegable
            titulo={
              <span className="flex items-center gap-1.5">
                <BookOpen className="size-3.5" aria-hidden /> Fundamentos legales
              </span>
            }
            cuenta={decision.fundamentos.length}
          >
            <ul className="space-y-1.5">
              {decision.fundamentos.map((f) => (
                <li key={f.chunkId}>
                  {/* El fragmento citado se abre en la biblioteca de conocimiento. */}
                  <EnlaceInterno
                    href={urlConocimiento(f.chunkId, f.documento)}
                    titulo="Abrir este fragmento en la biblioteca de conocimiento"
                    icono={<BookOpen className="size-3" aria-hidden />}
                    className="font-medium"
                  >
                    {f.documento}
                    {f.seccion ? ` · ${f.seccion}` : ""}
                  </EnlaceInterno>
                  <br />
                  <span className="italic">«{recortar(f.cita, 240)}»</span>
                </li>
              ))}
            </ul>
          </Desplegable>
        ) : null}
      </div>

      {pendiente && !resueltaComo ? (
        <div className="mt-2.5 flex gap-2 border-t border-panel-border p-3">
          <Boton variante="primario" tamano="lg" icono={<Check />} className="flex-1" cargando={ocupado === "aprobar"} onClick={aprobar}>
            Aprobar
          </Boton>
          <Boton
            variante="peligro"
            tamano="lg"
            icono={<ThumbsDown />}
            className="flex-1"
            cargando={ocupado === "denegar"}
            onClick={() => setDialogoDenegar(true)}
          >
            Denegar
          </Boton>
        </div>
      ) : (
        <div className="px-3 pb-3 pt-2">
          {decision.comentarioHumano ? (
            <p className="text-[12px] leading-snug text-muted">
              <span className="font-medium text-foreground">Motivo:</span> {decision.comentarioHumano}
            </p>
          ) : null}
          {decision.decididaPor ? (
            <p className="mt-0.5 text-[11px] text-subtle">
              Decidida por {decision.decididaPor} · {fechaHora(decision.decididaEn)}
            </p>
          ) : null}
        </div>
      )}

      <Dialogo
        abierto={dialogoDenegar}
        onCerrar={() => setDialogoDenegar(false)}
        titulo="Denegar la decisión"
        descripcion="El motivo es obligatorio: los agentes lo guardan como lección y no vuelven a proponer lo mismo."
        ancho="sm"
        pie={
          <>
            <Boton variante="fantasma" icono={<X />} onClick={() => setDialogoDenegar(false)}>
              Cancelar
            </Boton>
            <Boton variante="peligro" icono={<ThumbsDown />} cargando={ocupado === "denegar"} onClick={denegar}>
              Denegar
            </Boton>
          </>
        }
      >
        <p className="mb-2 text-[13px] font-medium text-foreground">{decision.titulo}</p>
        <label htmlFor={`motivo-${decision.id}`} className="mb-1 block text-[13px] font-medium text-foreground">
          ¿Por qué la deniegas?
        </label>
        <textarea
          id={`motivo-${decision.id}`}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          required
          placeholder="Ej.: el pueblo ya está avisado por la Guardia Civil"
          className="w-full rounded-lg border border-panel-border-strong bg-panel-2 p-2 text-sm text-foreground placeholder:text-subtle"
        />
        <p className="mt-2 text-[11.5px] font-medium text-subtle">Motivos frecuentes</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {MOTIVOS_RAPIDOS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMotivo(m)}
              className="rounded-full border border-panel-border-strong bg-panel-2 px-2.5 py-1 text-[12px] text-muted hover:border-brand hover:text-brand"
            >
              {m}
            </button>
          ))}
        </div>
      </Dialogo>

      <DialogoInforme informe={acta} onCerrar={() => setActa(null)} />
    </article>
  );
}

export const TarjetaDecision = memo(TarjetaDecisionBase);
