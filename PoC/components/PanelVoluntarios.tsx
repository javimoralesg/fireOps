"use client";

import { useState } from "react";
import { Ban, CircleCheck, HandHeart, LoaderCircle, MapPin, ShieldCheck, Smartphone, Sparkles, Users, X } from "lucide-react";
import type { TareaVoluntarios } from "@/lib/tipos-sistema";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";

type EstadoTarea = TareaVoluntarios["estado"];

const ORDEN: Record<EstadoTarea, number> = { propuesta: 0, abierta: 1, cubierta: 2, cancelada: 3 };

// Estado de la tarea como píldora de la identidad v2: tinte + icono, y un
// tooltip que dice qué significa y qué pasa a continuación.
const ESTADO_UI: Record<EstadoTarea, { texto: string; clase: string; ayuda: string }> = {
  propuesta: {
    texto: "Propuesta por la IA",
    clase: "pildora-marca",
    ayuda: "La IA la sugiere; todavía no es visible para la ciudadanía. Decide el mando.",
  },
  abierta: {
    texto: "Abierta en la app",
    clase: "pildora-aviso",
    ayuda: "Publicada en la app ciudadana: se están recibiendo respuestas ahora mismo.",
  },
  cubierta: {
    texto: "Cubierta",
    clase: "pildora-exito",
    ayuda: "Se alcanzó el cupo de voluntarios y la petición se detuvo sola.",
  },
  cancelada: {
    texto: "Cancelada",
    clase: "",
    ayuda: "Retirada por el mando: ya no aparece en la app ciudadana.",
  },
};

const BARRA_UI: Record<EstadoTarea, string> = {
  propuesta: "bg-brand/50",
  abierta: "bg-warning",
  cubierta: "bg-success",
  cancelada: "bg-panel-border-strong",
};

interface Props {
  tareas: TareaVoluntarios[];
  /** Sin callbacks el panel es de solo lectura (rol sin permiso gestionar_voluntarios). */
  onPublicar?: (id: string) => Promise<void>;
  onCancelar?: (id: string) => Promise<void>;
}

export function PanelVoluntarios({ tareas, onPublicar, onCancelar }: Props) {
  const abiertas = tareas.filter((t) => t.estado === "abierta").length;
  const movilizadas = tareas
    .filter((t) => t.estado === "abierta" || t.estado === "cubierta")
    .reduce((s, t) => s + t.aceptados, 0);

  const ordenadas = [...tareas].sort(
    (a, b) => ORDEN[a.estado] - ORDEN[b.estado] || b.creadaEn.localeCompare(a.creadaEn),
  );

  return (
    <section className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-panel-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <HandHeart className="size-4 text-brand" /> Voluntarios
          <Ayuda
            titulo="Voluntarios"
            texto="Tareas de bajo riesgo que la IA propone para la ciudadanía; se cierran solas al cubrir el cupo."
          />
        </h2>
        <span className="flex flex-wrap gap-x-2 text-[11px] text-muted">
          <Tooltip
            titulo="Tareas abiertas"
            contenido="Peticiones publicadas ahora mismo en la app ciudadana y recibiendo respuestas."
          >
            <span className="whitespace-nowrap">
              <span className="font-mono text-foreground">{abiertas}</span>{" "}
              {abiertas === 1 ? "abierta" : "abiertas"}
            </span>
          </Tooltip>
          <Tooltip
            titulo="Personas movilizadas"
            contenido="Voluntarios que ya se han apuntado en las tareas abiertas y cubiertas."
          >
            <span className="whitespace-nowrap">
              · <span className="font-mono text-foreground">{movilizadas}</span>{" "}
              {movilizadas === 1 ? "persona" : "personas"}
            </span>
          </Tooltip>
        </span>
      </div>

      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto p-4">
        {ordenadas.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-panel-border-strong bg-panel-2 px-4 py-6 text-center">
            <Users className="mx-auto size-6 text-subtle" />
            <p className="mt-2 text-[13px] font-semibold text-foreground">Sin tareas para voluntarios</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Cuando haga falta apoyo ciudadano fuera del perímetro de riesgo (acogida, traducción, avisos a vecinos), la IA
              lo propondrá aquí para que el mando decida si se publica.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {ordenadas.map((t) => (
              <TarjetaTarea key={t.id} tarea={t} onPublicar={onPublicar} onCancelar={onCancelar} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TarjetaTarea({
  tarea,
  onPublicar,
  onCancelar,
}: {
  tarea: TareaVoluntarios;
  onPublicar: Props["onPublicar"];
  onCancelar: Props["onCancelar"];
}) {
  const [ocupado, setOcupado] = useState<"publicar" | "cancelar" | null>(null);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { estado } = tarea;
  const ui = ESTADO_UI[estado];
  const pct = tarea.cupo > 0 ? Math.min(100, Math.round((tarea.aceptados / tarea.cupo) * 100)) : 0;
  const faltan = Math.max(0, tarea.cupo - tarea.aceptados);

  const ejecutar = async (accion: "publicar" | "cancelar") => {
    setOcupado(accion);
    setError(null);
    try {
      await (accion === "publicar" ? onPublicar?.(tarea.id) : onCancelar?.(tarea.id));
      setConfirmarCancelar(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción");
    } finally {
      setOcupado(null);
    }
  };

  return (
    <li
      className={`rounded-[10px] border border-panel-border bg-panel-2 px-3 py-2.5 ${
        estado === "propuesta" ? "ring-1 ring-brand/20" : estado === "cancelada" ? "border-dashed opacity-60" : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tooltip titulo={ui.texto} contenido={ui.ayuda}>
          <span className={`pildora ${ui.clase}`}>
            {estado === "propuesta" && <Sparkles className="size-3" aria-hidden />}
            {estado === "abierta" && (
              <span className="relative flex size-2" aria-hidden>
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-warning opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-warning" />
              </span>
            )}
            {estado === "cubierta" && <CircleCheck className="size-3" aria-hidden />}
            {estado === "cancelada" && <Ban className="size-3" aria-hidden />}
            {ui.texto}
          </span>
        </Tooltip>
        <Tooltip
          titulo="Riesgo bajo"
          contenido="Tarea fuera del perímetro de riesgo: la IA solo propone a la ciudadanía trabajos sin exposición."
        >
          <span className="pildora pildora-exito">
            <ShieldCheck className="size-3" aria-hidden /> Riesgo bajo
          </span>
        </Tooltip>
      </div>

      <p
        className={`mt-2 text-[13px] font-semibold leading-snug text-foreground ${
          estado === "cancelada" ? "line-through decoration-subtle" : ""
        }`}
      >
        {tarea.titulo}
      </p>
      <p className="mt-1 flex items-start gap-1 text-[11px] text-subtle">
        <MapPin className="mt-px size-3 shrink-0" aria-hidden /> {tarea.lugar}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">{tarea.descripcion}</p>

      {/* Progreso del cupo */}
      <Tooltip
        titulo="Cupo de voluntarios"
        contenido={`${tarea.aceptados} de ${tarea.cupo} voluntarios · faltan ${faltan}`}
        className="mt-2.5 w-full"
      >
        <div className="w-full">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1 text-muted">
              <Users className="size-3" aria-hidden />
              <span className="font-mono text-foreground">
                {tarea.aceptados}/{tarea.cupo}
              </span>
              voluntarios
            </span>
            <span className="text-subtle">
              {estado === "abierta" && faltan > 0 && (
                <>
                  faltan <span className="font-mono text-muted">{faltan}</span> ·{" "}
                </>
              )}
              <span className="font-mono">{pct}</span> %
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Cupo de voluntarios cubierto"
            aria-valuemin={0}
            aria-valuemax={tarea.cupo}
            aria-valuenow={tarea.aceptados}
            aria-valuetext={`${tarea.aceptados} de ${tarea.cupo} voluntarios`}
            className="h-1.5 overflow-hidden rounded-full bg-panel-border"
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${BARRA_UI[estado]}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </Tooltip>

      {/* Acciones según estado */}
      {estado === "propuesta" && onPublicar && onCancelar && (
        <div className="mt-3 flex gap-2">
          <Tooltip
            titulo="Publicar en app ciudadana"
            contenido="La tarea pasa a estar abierta y visible para la ciudadanía; se cerrará sola al cubrir el cupo."
            className="flex-1"
          >
            <button
              type="button"
              onClick={() => ejecutar("publicar")}
              disabled={ocupado !== null}
              className="boton boton-primario w-full"
            >
              {ocupado === "publicar" ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" aria-hidden /> Publicando…
                </>
              ) : (
                <>
                  <Smartphone className="size-4" aria-hidden /> Publicar en app ciudadana
                </>
              )}
            </button>
          </Tooltip>
          <Tooltip
            titulo="Descartar"
            contenido="Descarta la propuesta de la IA: no llega a publicarse y nadie la ve."
          >
            <button
              type="button"
              onClick={() => ejecutar("cancelar")}
              disabled={ocupado !== null}
              className="boton boton-fantasma"
            >
              {ocupado === "cancelar" ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                <X className="size-4" aria-hidden />
              )}
              Descartar
            </button>
          </Tooltip>
        </div>
      )}

      {estado === "abierta" &&
        onCancelar &&
        (confirmarCancelar ? (
          <div
            role="group"
            aria-label="Confirmar la retirada de la tarea"
            className="mt-3 rounded-[10px] border border-danger/30 bg-danger/8 px-2.5 py-2"
          >
            <p className="text-[11px] leading-snug text-danger">
              ¿Retirar la petición de la app ciudadana?
              {tarea.aceptados > 0 &&
                ` Se avisará a ${tarea.aceptados === 1 ? "la persona apuntada" : `las ${tarea.aceptados} personas apuntadas`}.`}
            </p>
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                onClick={() => ejecutar("cancelar")}
                disabled={ocupado !== null}
                className="boton boton-peligro boton-sm min-h-8"
              >
                {ocupado === "cancelar" ? (
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Ban className="size-3.5" aria-hidden />
                )}
                {ocupado === "cancelar" ? "Cancelando…" : "Sí, cancelar tarea"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmarCancelar(false)}
                disabled={ocupado !== null}
                className="boton boton-fantasma boton-sm min-h-8"
              >
                Mantener
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-[11px] text-subtle">Recibiendo respuestas en la app ciudadana…</span>
            <Tooltip
              titulo="Cancelar la tarea"
              contenido="Retira la petición de la app ciudadana. Pide confirmación porque avisa a quien ya se hubiera apuntado."
            >
              <button
                type="button"
                onClick={() => setConfirmarCancelar(true)}
                className="boton boton-secundario boton-sm min-h-8 shrink-0 text-danger"
              >
                <Ban className="size-3.5" aria-hidden /> Cancelar
              </button>
            </Tooltip>
          </div>
        ))}

      {estado === "cubierta" && (
        <p className="mt-3 flex items-center gap-1.5 rounded-[10px] border border-success/30 bg-success/8 px-2.5 py-1.5 text-xs font-semibold text-success">
          <CircleCheck className="size-3.5 shrink-0" aria-hidden /> Cupo cubierto, petición detenida
        </p>
      )}

      {estado === "cancelada" && <p className="mt-2 text-[11px] text-subtle">Petición retirada por el mando.</p>}

      {error && (
        <p role="alert" className="mt-2 text-[11px] text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
