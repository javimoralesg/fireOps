"use client";

import { useState, useSyncExternalStore } from "react";
import { BookMarked, Crosshair, Globe, LoaderCircle, Repeat, Trash2 } from "lucide-react";
import type { ReglaDoctrina } from "@/lib/tipos-sistema";
import { etiquetaRol } from "@/lib/permisos";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";

// Ámbito de la regla como píldora de la identidad v2 (docs/identidad.md):
// tinte + icono, nunca color a secas. Global = marca (la IA la aplica siempre),
// solo este incidente = aviso (caduca al cerrar la incidencia).
const AMBITO_UI: Record<
  ReglaDoctrina["ambito"],
  { texto: string; clase: string; Icono: typeof Globe; ayuda: string }
> = {
  global: {
    texto: "Global",
    clase: "pildora-marca",
    Icono: Globe,
    ayuda: "La IA la aplica en cualquier incidencia, también en las futuras.",
  },
  incidente: {
    texto: "Solo este incidente",
    clase: "pildora-aviso",
    Icono: Crosshair,
    ayuda: "La IA solo la aplica en esta incidencia; al cerrarla deja de tenerla en cuenta.",
  },
};

// Reloj compartido para los "hace N min": se actualiza cada 30 s y en el
// render del servidor (y la hidratación) vale 0, así no hay desajustes.
const PASO_RELOJ = 30_000;
function suscribirReloj(aviso: () => void) {
  const id = setInterval(aviso, PASO_RELOJ);
  return () => clearInterval(id);
}
const leerReloj = () => Math.floor(Date.now() / PASO_RELOJ) * PASO_RELOJ;
const leerRelojServidor = () => 0;

function fechaCompleta(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" });
}

function haceTiempo(iso: string, ahora: number): string {
  if (!ahora) return "";
  const min = Math.floor((ahora - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

interface Props {
  doctrina: ReglaDoctrina[];
  /** Sin onToggle/onEliminar el panel es de solo lectura (rol sin permiso editar_doctrina). */
  onToggle?: (id: string, activa: boolean) => Promise<void>;
  onEliminar?: (id: string) => Promise<void>;
}

export function PanelDoctrina({ doctrina, onToggle, onEliminar }: Props) {
  const ahora = useSyncExternalStore(suscribirReloj, leerReloj, leerRelojServidor);
  const activas = doctrina.filter((r) => r.activa).length;

  // Activas primero (la más reciente arriba); las inactivas, al final.
  const ordenadas = [...doctrina].sort((a, b) => {
    if (a.activa !== b.activa) return a.activa ? -1 : 1;
    return b.origen.timestamp.localeCompare(a.origen.timestamp);
  });

  return (
    <section className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-panel-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <BookMarked className="size-4 text-brand" /> Doctrina aprendida
          <Ayuda
            titulo="Doctrina aprendida"
            texto="Reglas aprendidas de las denegaciones; la IA las respeta en todas las propuestas siguientes; puedes desactivarlas o borrarlas."
          />
        </h2>
        {doctrina.length > 0 && (
          <Tooltip
            titulo="Reglas en vigor"
            contenido={`${activas} de ${doctrina.length} ${doctrina.length === 1 ? "regla está activa" : "reglas están activas"}. La IA solo aplica las activas.`}
          >
            <span className="text-[11px] text-muted">
              <span className="font-mono text-foreground">{activas}</span>
              <span className="font-mono">/{doctrina.length}</span> {activas === 1 ? "activa" : "activas"}
            </span>
          </Tooltip>
        )}
      </div>

      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto p-4">
        {ordenadas.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-panel-border-strong bg-panel-2 px-4 py-6 text-center">
            <BookMarked className="mx-auto size-6 text-subtle" />
            <p className="mt-2 text-[13px] font-semibold text-foreground">Aún no hay doctrina aprendida</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Cuando un cargo deniega una propuesta y explica el motivo (p. ej. &ldquo;No usar helicópteros con este
              viento&rdquo;), la IA reescribe ese mensaje como una regla operativa y la respeta en todas las decisiones
              siguientes. Podrás desactivarla o eliminarla aquí.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {ordenadas.map((r) => (
              <TarjetaRegla key={r.id} regla={r} ahora={ahora} onToggle={onToggle} onEliminar={onEliminar} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TarjetaRegla({
  regla,
  ahora,
  onToggle,
  onEliminar,
}: {
  regla: ReglaDoctrina;
  ahora: number;
  onToggle: Props["onToggle"];
  onEliminar: Props["onEliminar"];
}) {
  // Valor optimista del switch mientras la petición está en vuelo.
  const [activaPendiente, setActivaPendiente] = useState<boolean | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activa = activaPendiente ?? regla.activa;
  const ocupado = activaPendiente !== null || eliminando;
  const ambito = AMBITO_UI[regla.ambito];
  const cuando = haceTiempo(regla.origen.timestamp, ahora);

  const alternar = async () => {
    const nuevo = !regla.activa;
    setActivaPendiente(nuevo);
    setError(null);
    try {
      await onToggle?.(regla.id, nuevo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el estado de la regla");
    } finally {
      setActivaPendiente(null);
    }
  };

  const eliminar = async () => {
    setEliminando(true);
    setError(null);
    try {
      await onEliminar?.(regla.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar la regla");
      setEliminando(false);
      setConfirmando(false);
    }
  };

  return (
    <li
      className={`rounded-[10px] border border-panel-border bg-panel-2 px-3 py-2.5 transition ${
        activa ? "" : "border-dashed"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`min-w-0 flex-1 ${activa ? "" : "opacity-60"}`}>
          <p className="text-[13px] font-semibold leading-snug text-foreground">{regla.reglaNormalizada}</p>
          <blockquote className="mt-1.5 border-l-2 border-panel-border-strong pl-2.5">
            <p className="text-xs italic leading-relaxed text-muted">&ldquo;{regla.texto}&rdquo;</p>
            <p className="mt-0.5 text-[11px] text-subtle">
              Dicho por <span className="text-muted">{etiquetaRol(regla.origen.rol)}</span>
              {cuando && (
                <>
                  ,{" "}
                  <Tooltip titulo="Cuándo se dijo" contenido={fechaCompleta(regla.origen.timestamp)}>
                    <span className="underline decoration-dotted underline-offset-2">{cuando}</span>
                  </Tooltip>
                </>
              )}
            </p>
          </blockquote>
        </div>

        {onToggle && <Interruptor activa={activa} ocupado={ocupado} onClick={alternar} />}
      </div>

      <div className={`mt-2.5 flex items-center justify-between gap-2 text-[11px] ${activa ? "" : "opacity-60"}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Tooltip titulo={`Ámbito: ${ambito.texto.toLowerCase()}`} contenido={ambito.ayuda}>
            <span className={`pildora ${ambito.clase}`}>
              <ambito.Icono className="size-3" aria-hidden /> {ambito.texto}
            </span>
          </Tooltip>
          <Tooltip
            titulo="Veces aplicada"
            contenido="Propuestas de la IA en las que esta regla ha cambiado o descartado una opción."
          >
            <span className="flex items-center gap-1 text-muted">
              <Repeat className="size-3" aria-hidden />
              <span>
                aplicada <span className="font-mono text-foreground">{regla.vecesAplicada}</span>{" "}
                {regla.vecesAplicada === 1 ? "vez" : "veces"}
              </span>
            </span>
          </Tooltip>
          {!activa && <span className="pildora">Inactiva</span>}
        </div>
        {onEliminar && !confirmando && (
          <Tooltip
            titulo="Eliminar la regla"
            contenido="La borra de la doctrina: la IA dejará de aplicarla y desaparece del panel. Si solo quieres pausarla, usa el interruptor."
          >
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              disabled={ocupado}
              className="boton boton-fantasma boton-sm min-h-8 shrink-0 text-danger"
              aria-label="Eliminar regla"
            >
              <Trash2 className="size-3.5" aria-hidden /> Eliminar
            </button>
          </Tooltip>
        )}
      </div>

      {confirmando && (
        <div
          role="group"
          aria-label="Confirmar el borrado de la regla"
          className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-danger/30 bg-danger/8 px-2.5 py-2"
        >
          <p className="text-[11px] leading-snug text-danger">¿Eliminar la regla? La IA dejará de aplicarla.</p>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={eliminar}
              disabled={eliminando}
              className="boton boton-peligro boton-sm min-h-8"
            >
              {eliminando ? (
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="size-3.5" aria-hidden />
              )}
              {eliminando ? "Eliminando…" : "Eliminar"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              disabled={eliminando}
              className="boton boton-fantasma boton-sm min-h-8"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[11px] text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

function Interruptor({ activa, ocupado, onClick }: { activa: boolean; ocupado: boolean; onClick: () => void }) {
  return (
    <Tooltip
      titulo={activa ? "Regla activa" : "Regla inactiva"}
      contenido={activa ? "Activa: la IA la aplica" : "Inactiva: la IA la ignora"}
      className="shrink-0"
    >
      <button
        type="button"
        role="switch"
        aria-checked={activa}
        aria-label={activa ? "Desactivar regla" : "Activar regla"}
        onClick={onClick}
        disabled={ocupado}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition disabled:cursor-wait ${
          activa ? "bg-brand" : "bg-panel-border-strong"
        }`}
      >
        <span
          className={`flex size-3.5 items-center justify-center rounded-full bg-panel shadow transition-transform ${
            activa ? "translate-x-[18px]" : "translate-x-[2px]"
          }`}
        >
          {ocupado && <LoaderCircle className="size-2.5 animate-spin text-brand" aria-hidden />}
        </span>
      </button>
    </Tooltip>
  );
}
