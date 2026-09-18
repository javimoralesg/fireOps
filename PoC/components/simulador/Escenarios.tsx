"use client";

// Escenarios del dataset (data/dataset/*.json + guion de respaldo): buscador,
// filtro por tipo de emergencia y lanzamiento a x1 / x5 / x10.

import { useMemo, useState } from "react";
import { Clapperboard, Clock, Layers, LoaderCircle, Play, Search, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api-cliente";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { tinte, uiTipo } from "./catalogo";
import { enProceso, ESCENARIO_GUION, VELOCIDADES } from "./Reproduccion";
import { AVISO_PROCESANDO, AVISO_SIN_PERMISO, ChipTipo, duracion, ErrorInline, IconoTipo, mensajeError, sinTildes } from "./ui";
import type { EstadoSim, ResumenEscenarioSim } from "./tipos";

interface Props {
  escenarios: ResumenEscenarioSim[];
  sim?: EstadoSim;
  puedeControlar: boolean;
  onLanzado: (estado: EstadoSim, desde: number | undefined) => void;
  onCambio?: () => void;
}


export function Escenarios({ escenarios, sim, puedeControlar, onLanzado, onCambio }: Props) {
  const [busqueda, setBusqueda] = useState("");
  const [tipo, setTipo] = useState<string | null>(null);

  const tipos = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of escenarios) m.set(e.tipo, (m.get(e.tipo) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [escenarios]);

  const visibles = useMemo(() => {
    const q = sinTildes(busqueda.trim());
    return escenarios.filter(
      (e) =>
        (!tipo || e.tipo === tipo) &&
        (!q || sinTildes(`${e.nombre} ${e.descripcion ?? ""} ${e.id} ${uiTipo(e.tipo).etiqueta}`).includes(q)),
    );
  }, [escenarios, busqueda, tipo]);

  return (
    <div className="space-y-2.5">
      <label className="relative block">
        <span className="sr-only">Buscar escenario</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, lugar o tipo…"
          className="w-full rounded-[10px] border border-panel-border-strong bg-panel py-1.5 pl-8 pr-3 text-[13px] text-foreground outline-none transition placeholder:text-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </label>

      {tipos.length > 1 && (
        <div className="scroll-thin -mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="group" aria-label="Filtrar por tipo de emergencia">
          <button type="button" className="chip" aria-pressed={tipo === null} onClick={() => setTipo(null)}>
            Todos <span className="font-mono">{escenarios.length}</span>
          </button>
          {tipos.map(([t, n]) => {
            const ui = uiTipo(t);
            const Icono = ui.icon;
            return (
              <button key={t} type="button" className="chip" aria-pressed={tipo === t} onClick={() => setTipo(tipo === t ? null : t)}>
                <Icono className="size-3" style={{ color: `var(${ui.color})` }} aria-hidden />
                {ui.etiqueta} <span className="font-mono">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {escenarios.length > 0 && (
        <p className="flex items-center gap-1 text-[11px] text-subtle">
          <span className="font-mono text-muted">{visibles.length}</span> de <span className="font-mono">{escenarios.length}</span> escenarios
          <Ayuda
            titulo="De dónde salen"
            texto="El servidor lee los guiones de data/dataset/*.json al arrancar, más el guion guiado de respaldo del motor. El botón de recarga de la cabecera vuelve a leerlos."
          />
        </p>
      )}

      {visibles.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-panel-border-strong bg-panel-2 px-4 py-5 text-center">
          <Clapperboard className="mx-auto size-5 text-subtle" aria-hidden />
          <p className="mt-1.5 text-[13px] font-semibold text-foreground">
            {escenarios.length === 0 ? "Sin escenarios en el dataset" : "Ningún escenario coincide"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {escenarios.length === 0
              ? "El servidor lee data/dataset/*.json. Cuando el generador los exporte aparecerán aquí."
              : "Prueba con otro texto o quita el filtro de tipo."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visibles.map((e) => (
            <TarjetaEscenario
              key={e.id}
              escenario={e}
              sim={sim}
              puedeControlar={puedeControlar}
              onLanzado={onLanzado}
              onCambio={onCambio}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TarjetaEscenario({
  escenario: e,
  sim,
  puedeControlar,
  onLanzado,
  onCambio,
}: {
  escenario: ResumenEscenarioSim;
  sim?: EstadoSim;
  puedeControlar: boolean;
  onLanzado: Props["onLanzado"];
  onCambio?: () => void;
}) {
  const [lanzando, setLanzando] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Lanzar con otra reproducción en marcha la detiene (el reproductor es único y compartido): confirmación inline.
  const [confirmar, setConfirmar] = useState<number | null>(null);

  const enCurso = Boolean(sim?.activa && sim.escenarioId === e.id);
  const otroEnCurso = Boolean(sim?.activa && sim.escenarioId !== e.id);
  const esGuion = e.id === ESCENARIO_GUION;
  // Un evento de la reproducción activa en vuelo: relanzar ahora duplicaría la cadena en el servidor.
  const enVuelo = Boolean(
    sim?.activa && (enProceso(sim) || (sim.escenarioId !== ESCENARIO_GUION && sim.indice < sim.total && !sim.siguienteEnSeg)),
  );
  const bloqueo = !puedeControlar ? AVISO_SIN_PERMISO : enVuelo ? AVISO_PROCESANDO : undefined;

  const lanzar = async (v: number) => {
    setConfirmar(null);
    setLanzando(v);
    setError(null);
    try {
      const r = await api.iniciarSimulacion(e.id, v);
      onLanzado(r, 0);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setLanzando(null);
      onCambio?.();
    }
  };

  return (
    <li
      className={`rounded-[10px] border px-3 py-2.5 ${enCurso ? "fila-interactiva-activa" : "border-panel-border bg-panel"}`}
      aria-current={enCurso ? "true" : undefined}
    >
      <div className="flex gap-2.5">
        <IconoTipo tipo={e.tipo} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <ChipTipo tipo={e.tipo} />
            {esGuion && (
              <Tooltip
                titulo="Guion guiado"
                contenido="Escenario de respaldo del motor: avanza por pasos (ticks) con giro de viento. Sigue desde el paso actual del incidente; si ya terminó, reinicia el escenario desde la cabecera."
              >
                <span className="pildora pildora-marca" tabIndex={0}>
                  Guion
                </span>
              </Tooltip>
            )}
            {enCurso && (
              <span className="pildora pildora-exito">
                <Play className="size-3" aria-hidden /> En curso · x{sim?.velocidad}
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] font-semibold leading-snug text-foreground">{e.nombre}</p>
          {e.descripcion && <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">{e.descripcion}</p>}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-subtle">
            <Tooltip titulo="Duración del guion" contenido="Tiempo de guion a x1. A x5 dura la quinta parte y a x10 la décima.">
              <span className="flex items-center gap-1" tabIndex={0}>
                <Clock className="size-3" aria-hidden />
                <span className="font-mono text-muted">{duracion(e.duracionSeg)}</span>
              </span>
            </Tooltip>
            <Tooltip titulo="Eventos del escenario" contenido={esGuion ? "Pasos del guion guiado." : "Observaciones que el servidor inyectará por el pipeline, cada una a su segundo del guion."}>
              <span className="flex items-center gap-1" tabIndex={0}>
                <Layers className="size-3" aria-hidden />
                <span className="font-mono text-muted">{e.eventos}</span> {esGuion ? "pasos" : "eventos"}
              </span>
            </Tooltip>
            <Tooltip titulo="Id del escenario" contenido="Identificador en el dataset. Es el que queda en cada evento inyectado, en Resultados y en la auditoría.">
              <span className="min-w-0 truncate font-mono" tabIndex={0}>
                {e.id}
              </span>
            </Tooltip>
          </p>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] text-subtle">
          {otroEnCurso
            ? `Detendrá «${sim?.nombre ?? sim?.escenarioId}»`
            : enCurso
              ? esGuion
                ? "Relanzar sigue desde el paso actual"
                : "Relanzar empieza desde el principio"
              : "Lanzar"}
        </span>
        <div className="flex shrink-0 gap-1" role="group" aria-label={`Lanzar ${e.nombre}`}>
          {VELOCIDADES.map((v) => (
            <Tooltip
              key={v}
              titulo={bloqueo ? undefined : `Lanzar a x${v}`}
              contenido={
                bloqueo ??
                `${v === 1 ? "Tiempo real" : `${v} veces más rápido`}: dura ${duracion(e.duracionSeg !== undefined ? e.duracionSeg / v : undefined)} más lo que tarde el pipeline en cada evento. Todas las consolas lo ven en directo.`
              }
            >
              <button
                type="button"
                className="boton boton-secundario boton-sm font-mono"
                disabled={Boolean(bloqueo) || lanzando !== null}
                onClick={() => (otroEnCurso ? setConfirmar(v) : void lanzar(v))}
                aria-label={`Lanzar ${e.nombre} a velocidad x${v}`}
              >
                {lanzando === v ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3" aria-hidden />}
                x{v}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>
      {confirmar !== null && otroEnCurso && (
        <div role="alert" className="mt-2 rounded-[10px] border px-3 py-2 text-xs leading-snug" style={tinte("--warning")}>
          <p className="flex items-start gap-1.5 text-foreground">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
            <span>
              Hay otra reproducción en marcha: <b className="font-semibold">«{sim?.nombre ?? sim?.escenarioId}»</b>. El reproductor es único y lo
              comparten todas las consolas: lanzar esta la detendrá.
            </span>
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="boton boton-peligro boton-sm" onClick={() => void lanzar(confirmar)}>
              Detener y lanzar a x{confirmar}
            </button>
            <button type="button" className="boton boton-fantasma boton-sm" onClick={() => setConfirmar(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      <ErrorInline mensaje={error} className="mt-1.5" />
    </li>
  );
}
