"use client";

import { useState } from "react";
import { ArrowBigUpDash, Check, Eye, LoaderCircle, Lock, PenLine, ScrollText, Send, TriangleAlert, X } from "lucide-react";
import type { Decision } from "@/lib/tipos-sistema";
import { escalarA, etiquetaRol, limiteRiesgo, puede, puedeDecidir } from "@/lib/permisos";
import { ROLES, type RolId } from "@/lib/roles";
import { ErrorApi } from "@/lib/api-cliente";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { formatearHora } from "./ui";

type Ambito = "incidente" | "global";

type Fase =
  | "inicial"
  | "aprobando" // esperando a onAprobar
  | "formulario" // textarea de feedback abierto
  | "denegando" // esperando a onDenegar
  | "escalando" // esperando a onEscalar
  | "aprobada" // promesa resuelta; esperando a que el estado de la decisión cambie
  | "denegada";

interface Props {
  riesgo: number;
  rol: RolId;
  escaladaA?: Decision["escaladaA"];
  ahora: number;
  onAprobar: () => Promise<void>;
  onDenegar: (feedback: string, ambito: Ambito) => Promise<void>;
  onEscalar?: (a: RolId) => Promise<void>;
}

/** "hace 40 s" / "hace 3 min" relativo al reloj del servidor; null si la fecha no es válida. */
function haceTiempo(iso: string, ahora: number): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.round((ahora - t) / 1000));
  if (s < 60) return `hace ${s} s`;
  const min = Math.round(s / 60);
  return min < 60 ? `hace ${min} min` : `hace ${Math.floor(min / 60)} h ${min % 60} min`;
}

function mensajeError(e: unknown): string {
  if (e instanceof ErrorApi && e.status === 403) {
    const a = e.escalarA ? ` Escala a ${ROLES[e.escalarA].nombre}.` : "";
    return `Tu perfil no tiene permiso para esto.${a}`;
  }
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return "Error desconocido.";
}

/**
 * Zona de firma HITL. El padre debe montarla con key={decision.id}
 * para que el estado interno (texto, ámbito, error) se reinicie al cambiar de decisión.
 */
export function ZonaAccion({ riesgo, rol, escaladaA, ahora, onAprobar, onDenegar, onEscalar }: Props) {
  const [fase, setFase] = useState<Fase>("inicial");
  const [feedback, setFeedback] = useState("");
  const [ambito, setAmbito] = useState<Ambito>("global");
  const [error, setError] = useState<string | null>(null);

  const firma = puede(rol, "decidir"); // el perfil firma decisiones (con algún límite)
  const permitido = puedeDecidir(rol, riesgo);
  const requerido = escalarA(riesgo);
  const limite = limiteRiesgo(rol);
  const ocupado =
    fase === "aprobando" || fase === "denegando" || fase === "escalando" || fase === "aprobada" || fase === "denegada";

  async function escalar() {
    if (!onEscalar || ocupado) return;
    setError(null);
    setFase("escalando");
    try {
      await onEscalar(requerido);
    } catch (e) {
      setError(`No se pudo escalar: ${mensajeError(e)}`);
    } finally {
      setFase("inicial");
    }
  }

  async function aprobar() {
    if (!permitido || ocupado) return;
    setError(null);
    setFase("aprobando");
    try {
      await onAprobar();
      setFase("aprobada");
    } catch (e) {
      setError(`No se pudo ejecutar: ${mensajeError(e)}`);
      setFase("inicial");
    }
  }

  async function denegar() {
    const texto = feedback.trim();
    if (!texto || ocupado) return;
    setError(null);
    setFase("denegando");
    try {
      await onDenegar(texto, ambito);
      setFase("denegada");
    } catch (e) {
      setError(`No se pudo registrar la denegación: ${mensajeError(e)}`);
      setFase("formulario");
    }
  }

  const bloqueError = error && (
    <div
      role="alert"
      className="mb-2 flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger/8 px-3 py-2 text-xs text-danger"
    >
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span className="flex-1 leading-snug">{error}</span>
      <button
        type="button"
        onClick={() => setError(null)}
        className="boton boton-fantasma -my-1 -mr-1 shrink-0 p-1 text-danger"
        aria-label="Cerrar aviso"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );

  if (fase === "aprobada" || fase === "denegada") {
    return (
      <div className="border-t border-panel-border bg-panel p-3">
        <p className="flex items-center justify-center gap-2 rounded-[10px] border border-panel-border bg-panel-2 px-3 py-2.5 text-sm text-muted">
          <LoaderCircle className="size-4 animate-spin text-brand" aria-hidden />
          {fase === "aprobada" ? "Orden enviada · actualizando estado…" : "Feedback registrado · recalculando propuesta…"}
        </p>
      </div>
    );
  }

  if (fase === "formulario" || fase === "denegando") {
    return (
      <div className="border-t border-panel-border bg-panel p-3">
        {bloqueError}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void denegar();
          }}
          className="space-y-2"
        >
          <label htmlFor="feedback-decision" className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <PenLine className="size-3.5 text-danger" aria-hidden /> ¿Qué debe cambiar?
            <Ayuda
              titulo="El motivo es la doctrina"
              texto="Escríbelo como una instrucción operativa ('no usar helicópteros con viento > 40 km/h'). La IA recalcula la propuesta con ese criterio y, si el ámbito es permanente, lo aplicará también en adelante."
            />
          </label>
          <textarea
            id="feedback-decision"
            autoFocus
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void denegar();
              } else if (e.key === "Escape" && fase === "formulario") {
                setFase("inicial");
                setError(null);
              }
            }}
            disabled={fase === "denegando"}
            rows={3}
            placeholder="p. ej. 'No usar helicópteros con este viento'"
            className="w-full resize-none rounded-[10px] border border-panel-border-strong bg-panel px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-subtle focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
          />

          <fieldset disabled={fase === "denegando"} className="space-y-1.5">
            <legend className="sr-only">Ámbito del feedback</legend>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-panel-2 p-0.5">
              {(
                [
                  ["incidente", "Solo este incidente"],
                  ["global", "Regla permanente (doctrina)"],
                ] as const
              ).map(([valor, etiqueta]) => (
                <label
                  key={valor}
                  className={`flex min-h-8 cursor-pointer items-center justify-center gap-1 rounded-md px-2 py-1.5 text-center text-[11px] font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/30 ${
                    ambito === valor ? "bg-panel text-brand shadow-sm" : "text-muted hover:text-foreground"
                  }`}
                >
                  <input
                    type="radio"
                    name="ambito-feedback"
                    value={valor}
                    checked={ambito === valor}
                    onChange={() => setAmbito(valor)}
                    className="sr-only"
                  />
                  {valor === "global" && <ScrollText className="size-3 shrink-0" aria-hidden />}
                  {etiqueta}
                </label>
              ))}
            </div>
            <p className="text-[11px] leading-snug text-muted">
              {ambito === "global" ? (
                <>
                  Se guardará como <span className="font-medium text-brand">regla de doctrina</span> y realimentará todas
                  las decisiones futuras, en este incidente y en los próximos.
                </>
              ) : (
                <>Solo se tendrá en cuenta al recalcular las propuestas de este incidente.</>
              )}
            </p>
          </fieldset>

          <div className="flex gap-2">
            <button type="submit" disabled={fase === "denegando" || !feedback.trim()} className="boton boton-peligro min-h-9 flex-1">
              {fase === "denegando" ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" aria-hidden /> Recalculando con Claude…
                </>
              ) : (
                <>
                  <Send className="size-4" aria-hidden /> Denegar y recalcular
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setFase("inicial");
                setError(null);
              }}
              disabled={fase === "denegando"}
              className="boton boton-fantasma min-h-9"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    );
  }

  // inicial | aprobando | escalando
  const escalada = escaladaA && (
    <p className="mb-2 flex items-center gap-1.5 rounded-[10px] border border-brand/25 bg-brand/6 px-3 py-1.5 text-[11px] text-muted">
      <ArrowBigUpDash className="size-3.5 shrink-0 text-brand" aria-hidden />
      <span>
        Escalada a <span className="font-medium text-foreground">{etiquetaRol(escaladaA.rol)}</span> por{" "}
        {etiquetaRol(escaladaA.por)} · {haceTiempo(escaladaA.timestamp, ahora) ?? formatearHora(escaladaA.timestamp)}
        {escaladaA.via === "voz" && " · aviso por llamada"}
      </span>
      <Ayuda
        className="ml-auto"
        titulo="Escalado"
        texto="Ya se ha pedido la firma de un rol con más autoridad. La decisión sigue pendiente hasta que esa persona firme o deniegue."
      />
    </p>
  );

  const botonEscalar = onEscalar && (
    <Tooltip
      className="flex-1"
      titulo={`Escalar a ${ROLES[requerido].nombre}`}
      contenido={
        <>
          Avisa a <strong>{ROLES[requerido].cargoReal}</strong> para que firme: es el rol mínimo cuyo límite de riesgo
          cubre esta decisión. La propuesta sigue pendiente mientras tanto.
        </>
      }
    >
      <button type="button" onClick={() => void escalar()} disabled={ocupado} className="boton boton-secundario min-h-9 w-full">
        {fase === "escalando" ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Escalando…
          </>
        ) : (
          <>
            <ArrowBigUpDash className="size-4" aria-hidden /> {escaladaA ? "Volver a avisar" : "Escalar"} a{" "}
            {ROLES[requerido].nombre}
          </>
        )}
      </button>
    </Tooltip>
  );

  // Perfil que no firma decisiones (operación 112, gabinete, comité asesor…): solo puede escalar.
  if (!firma) {
    return (
      <div className="border-t border-panel-border bg-panel p-3">
        {bloqueError}
        {escalada}
        <div className="mb-2 flex items-start gap-2 rounded-[10px] border border-panel-border bg-panel-2 px-3 py-2">
          <Eye className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
          <div className="text-xs leading-snug">
            <p className="flex items-center gap-1.5 font-semibold text-foreground">
              Tu perfil no firma decisiones
              <Ayuda
                titulo="Perfiles de solo consulta"
                texto="Operación 112, gabinete y comité asesor ven todo el expediente pero no tienen firma: su papel es aportar contexto y escalar a quien decide."
              />
            </p>
            <p className="mt-0.5 text-muted">
              Como {ROLES[rol].nombre} puedes consultar y escalar. Esta propuesta la firma{" "}
              <span className="font-medium text-foreground">{ROLES[requerido].nombre}</span>.
            </p>
          </div>
        </div>
        <div className="flex gap-2">{botonEscalar}</div>
      </div>
    );
  }

  return (
    <div className="border-t border-panel-border bg-panel p-3">
      {bloqueError}
      {escalada}
      {!permitido && (
        <div className="mb-2 flex items-start gap-2 rounded-[10px] border border-warning/30 bg-warning/8 px-3 py-2">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          <div className="text-xs leading-snug">
            <p className="flex items-center gap-1.5 font-semibold text-warning">
              Requiere firma de {ROLES[requerido].nombre}
              <Ayuda
                titulo="Límite de riesgo por rol"
                texto={
                  <>
                    Cada perfil firma hasta un riesgo máximo: el tuyo como {ROLES[rol].nombre} es <strong>{limite}</strong>{" "}
                    y esta decisión vale <strong>{riesgo}</strong>. Por encima del límite solo firma un rol con más
                    autoridad, que aquí es {ROLES[requerido].nombre} ({ROLES[requerido].cargoReal}).
                  </>
                }
              />
            </p>
            <p className="mt-0.5 text-muted">
              Riesgo <span className="font-mono text-foreground">{riesgo}</span> supera tu límite como {ROLES[rol].nombre} (
              <span className="font-mono">{limite}</span>). Escálala para que la firme quien tiene autoridad.
            </p>
          </div>
        </div>
      )}
      <p className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>
          Firmas como <span className="font-medium text-foreground">{ROLES[rol].nombre}</span>
        </span>
        <span className="flex items-center gap-1.5">
          límite de riesgo <span className="font-mono text-foreground">{limite}</span>
          <Ayuda
            titulo="Tu autoridad de firma"
            texto={
              <>
                Firmas en nombre de <strong>{ROLES[rol].cargoReal}</strong> y tu firma queda en el acta. Puedes aprobar
                decisiones con riesgo hasta <strong>{limite}</strong>; por encima hay que escalar.
              </>
            }
          />
        </span>
      </p>
      <div className="flex gap-2">
        {permitido ? (
          <>
            <Tooltip
              className="flex-1"
              titulo="Aprobar y ejecutar"
              contenido="Firmas la propuesta con tu rol y las acciones del plan salen de inmediato por sus canales reales. Queda registrado en el acta y en la auditoría."
            >
              <button type="button" onClick={() => void aprobar()} disabled={ocupado} className="boton boton-exito min-h-9 w-full">
                {fase === "aprobando" ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" aria-hidden /> Ejecutando acciones…
                  </>
                ) : (
                  <>
                    <Check className="size-4" aria-hidden /> Aprobar y ejecutar
                  </>
                )}
              </button>
            </Tooltip>
            <Tooltip
              className="flex-1"
              titulo="Denegar o modificar"
              contenido="No ejecuta nada: abre el motivo. Lo que escribas realimenta a la IA para que recalcule la propuesta y, si lo marcas como permanente, se guarda como doctrina."
            >
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setFase("formulario");
                }}
                disabled={ocupado}
                className="boton boton-secundario min-h-9 w-full text-danger border-danger/40 hover:bg-danger/10 hover:border-danger/60 hover:text-danger"
              >
                <X className="size-4" aria-hidden /> Denegar o modificar
              </button>
            </Tooltip>
          </>
        ) : (
          botonEscalar ?? (
            <p className="flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-panel-border bg-panel-2 px-3 py-2.5 text-sm text-muted">
              <Lock className="size-4 shrink-0 text-subtle" aria-hidden /> Pendiente de {ROLES[requerido].nombre}
            </p>
          )
        )}
      </div>
    </div>
  );
}
