"use client";

// Simulador de eventos (poc-26): desde aquí el mando o el presentador lanza
// escenarios del dataset, inyecta eventos sueltos o compuestos a mano por el mismo
// pipeline que los periféricos reales, y ve en directo qué produce cada uno.
// Pensado para un cajón lateral de 420–480 px y alto completo (scroll interno).
//
// Datos: GET /api/simulacion/escenarios (una vez; botón de recarga) y el estado del
// reproductor por props (EstadoSistema.simulacion, que llega por el SSE). Si el
// padre no lo pasa, sondea GET /api/simulacion cada 3 s.

import { useEffect, useMemo, useState } from "react";
import { CircleStop, Clapperboard, FlaskConical, History, LoaderCircle, PenLine, Play, RotateCcw, Send } from "lucide-react";
import { api } from "@/lib/api-cliente";
import type { EstadoSimulacion } from "@/lib/tipos-sistema";
import type { EventoIngesta } from "@/lib/types";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { Compositor } from "./Compositor";
import { Escenarios } from "./Escenarios";
import { Reproduccion } from "./Reproduccion";
import { Resultados } from "./Resultados";
import { Sueltos } from "./Sueltos";
import { AvisoSoloLectura, ErrorInline, hora, mensajeError } from "./ui";
import {
  normalizarEscenario,
  normalizarEvento,
  type EstadoSim,
  type EventoCrudo,
  type EventoSim,
  type LugarSim,
  type MemoriaInyeccion,
  type ResultadoSim,
  type ResumenEscenarioSim,
} from "./tipos";

export interface PanelSimuladorProps {
  simulacion?: EstadoSimulacion;
  puedeControlar: boolean;
  centro: { lat: number; lon: number; nombre?: string };
  onCambio?: () => void;
  /** Abre una decisión creada por un evento inyectado (cola de decisiones de la consola). */
  onSeleccionarDecision?: (id: string) => void;
  /** Eventos del estado (EstadoSistema.eventos): dan título y categoría a los resultados. */
  eventos?: Pick<EventoIngesta, "id" | "titulo" | "categoria">[];
  /** EstadoSistema.iaDisponible: sin Claude se avisa de que el pipeline local marca el ritmo. */
  iaDisponible?: boolean;
}

type Pestana = "escenarios" | "inyectar" | "resultados";
type ModoInyeccion = "dataset" | "manual";

const MAX_HISTORIAL = 200;
const claveResultado = (r: ResultadoSim) => `${r.eventoId}|${r.timestamp}`;

/** Une listas de resultados sin duplicados, de más reciente a más antiguo. */
function fusionar(...listas: ResultadoSim[][]): ResultadoSim[] {
  const m = new Map<string, ResultadoSim>();
  for (const l of listas) for (const r of l) m.set(claveResultado(r), r);
  return [...m.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, MAX_HISTORIAL);
}

/**
 * ¿`a` es posterior a `b`? EstadoSimulacion no trae versión, pero dentro de una
 * reproducción todo avanza: arranque más tardío → índice mayor → último resultado
 * más reciente → y, a igualdad, parada gana a activa (parar es posterior a correr).
 */
function posterior(a: EstadoSim, b: EstadoSim): boolean {
  const ia = a.iniciadaEn ?? "";
  const ib = b.iniciadaEn ?? "";
  if (ia !== ib) return ia > ib;
  if (a.indice !== b.indice) return a.indice > b.indice;
  const ua = a.ultimos[0]?.timestamp ?? "";
  const ub = b.ultimos[0]?.timestamp ?? "";
  if (ua !== ub) return ua > ub;
  if (a.ultimos.length !== b.ultimos.length) return a.ultimos.length > b.ultimos.length;
  return a.activa !== b.activa && !a.activa;
}

function masReciente(...candidatos: (EstadoSim | undefined)[]): EstadoSim | undefined {
  let mejor: EstadoSim | undefined;
  for (const c of candidatos) if (c && (!mejor || posterior(c, mejor))) mejor = c;
  return mejor;
}

export function PanelSimulador({ simulacion, puedeControlar, centro, onCambio, onSeleccionarDecision, eventos, iaDisponible }: PanelSimuladorProps) {
  /* ---------------------------------------------------------------- dataset */
  const [recarga, setRecarga] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [escenarios, setEscenarios] = useState<ResumenEscenarioSim[]>([]);
  const [sueltos, setSueltos] = useState<EventoSim[]>([]);

  useEffect(() => {
    let vivo = true;
    api
      .simulacionEscenarios()
      .then((r) => {
        if (!vivo) return;
        setEscenarios((r.escenarios ?? []).map((e) => normalizarEscenario(e as unknown as Record<string, unknown>)));
        setSueltos((r.sueltos ?? []).map((e, i) => normalizarEvento(e as EventoCrudo, i)));
        setErrorCarga(null);
      })
      .catch((e) => vivo && setErrorCarga(mensajeError(e)))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [recarga]);

  // Galería de imágenes del dataset (public/dataset/img): se descubre en tiempo de
  // ejecución leyendo la tabla de créditos, sin depender de lib/dataset al compilar.
  const [imagenesPublicas, setImagenesPublicas] = useState<string[]>([]);
  useEffect(() => {
    let vivo = true;
    fetch("/dataset/img/CREDITOS.md", { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => {
        if (!vivo) return;
        const archivos = t
          .split("\n")
          .map((l) => /^\|\s*`([^`/]+\.(?:jpe?g|png|webp))`/i.exec(l)?.[1])
          .filter((x): x is string => Boolean(x));
        setImagenesPublicas(archivos.map((a) => `/dataset/img/${a}`));
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [recarga]);

  const recargar = () => {
    setCargando(true);
    setRecarga((n) => n + 1);
  };

  /* ------------------------------------------------- estado del reproductor */
  // Fuentes: la prop (SSE de /api/estado, puede llegar con retraso porque trae el
  // estado completo), un sondeo ligero de GET /api/simulacion (en memoria) mientras
  // haya reproducción o no haya prop, y la respuesta de la última acción. Se pinta
  // la más reciente de las tres.
  const [simSondeada, setSimSondeada] = useState<EstadoSim | undefined>(undefined);
  const [simAccion, setSimAccion] = useState<EstadoSim | undefined>(undefined);
  // A igualdad, gana el sondeo (como mucho 2 s de antigüedad; trae la cuenta atrás viva).
  const sim = masReciente(simSondeada, simulacion, simAccion);
  const debeSondear = simulacion === undefined || Boolean(sim?.activa);
  useEffect(() => {
    if (!debeSondear) return;
    let vivo = true;
    const leer = () =>
      api
        .estadoSimulacion()
        .then((s) => vivo && setSimSondeada(s))
        .catch(() => {});
    void leer();
    const id = window.setInterval(leer, 2000);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, [debeSondear]);

  // Punto del guion desde el que se lanzó la reproducción actual (para cambiar de velocidad).
  const [arranque, setArranque] = useState<{ iniciadaEn?: string; desde: number } | null>(null);
  const desdeBase = arranque && sim?.iniciadaEn && arranque.iniciadaEn === sim.iniciadaEn ? arranque.desde : 0;

  const alLanzar = (estado: EstadoSim, desde: number | undefined) => {
    setArranque({ iniciadaEn: estado.iniciadaEn, desde: desde ?? 0 });
    setSimAccion(estado);
  };

  /* -------------------------------------------------------------- resultados */
  // El servidor vacía `ultimos` al relanzar: el panel conserva lo ya visto.
  const ultimos = useMemo(() => sim?.ultimos ?? [], [sim]);
  const firmaUltimos = ultimos.length ? `${ultimos.length}|${ultimos[0].timestamp}|${ultimos[ultimos.length - 1].timestamp}` : "0";
  const [historial, setHistorial] = useState<{ firma: string; lista: ResultadoSim[] }>({ firma: "", lista: [] });
  if (historial.firma !== firmaUltimos) {
    setHistorial({ firma: firmaUltimos, lista: fusionar(historial.lista, ultimos) });
  }
  const [locales, setLocales] = useState<ResultadoSim[]>([]);
  const resultados = useMemo(() => fusionar(historial.lista, locales, ultimos), [historial.lista, locales, ultimos]);

  const [memoriaLocal, setMemoriaLocal] = useState<Record<string, MemoriaInyeccion>>({});
  const memoria = useMemo(() => {
    const m: Record<string, MemoriaInyeccion> = {};
    for (const e of sueltos) {
      if (e.id) m[e.id] = { titulo: e.titulo, esperadoCategoria: e.esperadoCategoria, esperadoImpacto: e.esperadoImpacto, veracidad: e.veracidad, origen: "suelto" };
    }
    return { ...m, ...memoriaLocal };
  }, [sueltos, memoriaLocal]);

  const idsUsados = useMemo(() => new Set(resultados.map((r) => r.eventoId)), [resultados]);

  const registrarInyeccion = (r: ResultadoSim, mem: MemoriaInyeccion) => {
    setLocales((l) => fusionar([r], l));
    setMemoriaLocal((m) => ({ ...m, [r.eventoId]: mem }));
  };

  /* ------------------------------------------------------ lugares e imágenes */
  const lugares = useMemo(() => {
    const vistos = new Map<string, LugarSim>();
    for (const e of sueltos) {
      if (!e.lugar) continue;
      const clave = e.lugar.nombre ?? `${e.lugar.lat.toFixed(4)},${e.lugar.lon.toFixed(4)}`;
      const etiqueta = e.lugar.nombre ?? `${e.titulo.length > 60 ? `${e.titulo.slice(0, 58)}…` : e.titulo}`;
      if (!vistos.has(clave)) vistos.set(clave, { ...e.lugar, etiqueta });
    }
    return [...vistos.values()].sort((a, b) => (a.etiqueta ?? "~").localeCompare(b.etiqueta ?? "~", "es")).slice(0, 80);
  }, [sueltos]);
  const imagenes = useMemo(
    () => [...new Set([...sueltos.map((e) => e.imagen).filter((x): x is string => Boolean(x)), ...imagenesPublicas])],
    [sueltos, imagenesPublicas],
  );

  /* ------------------------------------------------------------- pestañas */
  const [pestana, setPestana] = useState<Pestana>("escenarios");
  const [modo, setModo] = useState<ModoInyeccion>("dataset");
  // Resultados "nuevos" = llegados desde que se abrió el panel (o desde la última visita a la pestaña).
  // Se fija al montar (haya o no reproducción), así el contador arranca aunque aún no exista estado.simulacion.
  const [vistos, setVistos] = useState(() => resultados.length);
  const nuevos = pestana === "resultados" ? 0 : Math.max(0, resultados.length - vistos);
  const irA = (p: Pestana) => {
    setVistos(resultados.length);
    setPestana(p);
  };

  const escenarioActivo = escenarios.find((e) => e.id === sim?.escenarioId);
  // Si el backend no tiene nombre del lugar, `nombre` llega como "lat, lon": no repetir coordenadas en el pie.
  const nombreCentro = centro.nombre && !/^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(centro.nombre) ? centro.nombre : "Centro del incidente";
  const centroLugar: LugarSim = { lat: centro.lat, lon: centro.lon, nombre: nombreCentro };

  const PESTANAS: { id: Pestana; etiqueta: string; icon: typeof Play; cuenta?: number; ayuda: string }[] = [
    {
      id: "escenarios",
      etiqueta: "Escenarios",
      icon: Clapperboard,
      cuenta: escenarios.length,
      ayuda: "Guiones completos del dataset (data/dataset/*.json). Al lanzarlos, el servidor inyecta sus eventos uno a uno con el ritmo que elijas. La cifra son los escenarios disponibles.",
    },
    {
      id: "inyectar",
      etiqueta: "Inyectar",
      icon: Send,
      cuenta: sueltos.length || undefined,
      ayuda: "Eventos de uno en uno: los sueltos del dataset o uno compuesto a mano. Entran por el mismo pipeline que los periféricos reales. La cifra son los eventos sueltos del dataset.",
    },
    {
      id: "resultados",
      etiqueta: "Resultados",
      icon: History,
      cuenta: resultados.length,
      ayuda: "Qué ha producido cada evento inyectado: impacto, categoría detectada y decisión creada. La cifra son los resultados vistos desde que se abrió el panel.",
    },
  ];

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Simulador de eventos">
      {/* Cabecera */}
      <div className="flex items-center justify-between gap-2 border-b border-panel-border px-4 py-3">
        {/* El cajón ya pone el título "Simulador de eventos": aquí la cabecera nombra lo que
            controlan estos mandos (el reproductor del servidor y el dataset cargado). */}
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <FlaskConical className="size-4 text-brand" aria-hidden /> Reproductor y dataset
          <Ayuda
            titulo="Simulador de eventos"
            texto="Lanza escenarios del dataset o inyecta eventos sueltos por el mismo pipeline que los periféricos reales. El reproductor vive en el servidor: solo hay uno y lo ven todas las consolas. Todo lo que entra por aquí va marcado como simulacro."
          />
        </h2>
        <div className="flex items-center gap-1.5">
          {sim?.activa ? (
            <Tooltip titulo="Reproductor en marcha" contenido={`${sim.nombre ?? sim.escenarioId} a x${sim.velocidad}, en el servidor.`}>
              <span className="pildora pildora-exito" tabIndex={0}>
                <Play className="size-3" aria-hidden /> En directo · x{sim.velocidad}
              </span>
            </Tooltip>
          ) : (
            <Tooltip
              titulo="Reproductor parado"
              contenido="Nadie está reproduciendo un escenario en el servidor. Los eventos sueltos y los compuestos a mano se pueden inyectar igualmente."
            >
              <span className="pildora" tabIndex={0}>
                <CircleStop className="size-3" aria-hidden /> Parado
              </span>
            </Tooltip>
          )}
          <Tooltip contenido="Vuelve a leer los escenarios y eventos del dataset (data/dataset/*.json).">
            <button type="button" className="boton boton-fantasma boton-sm px-2" onClick={recargar} disabled={cargando} aria-label="Recargar dataset">
              <RotateCcw className={`size-3.5 ${cargando ? "animate-spin" : ""}`} aria-hidden />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Zona fija: permisos, reproducción y pestañas */}
      <div className="space-y-2.5 px-4 pt-3">
        {!puedeControlar && <AvisoSoloLectura />}
        {sim?.activa ? (
          <Reproduccion
            sim={sim}
            escenario={escenarioActivo}
            puedeControlar={puedeControlar}
            desdeBase={desdeBase}
            onReiniciada={alLanzar}
            onParada={setSimAccion}
            onCambio={onCambio}
            iaDisponible={iaDisponible}
          />
        ) : (
          sim?.escenarioId &&
          sim.indice > 0 && (
            <Tooltip
              titulo="Última reproducción"
              contenido={`Escenario que se reprodujo por última vez en el servidor y por qué evento se quedó (${Math.min(sim.indice, sim.total)} de ${sim.total}). Lanzarlo otra vez desde Escenarios empieza de nuevo; los eventos ya inyectados se quedan.`}
              lado="abajo"
              className="w-full"
            >
              <p className="flex w-full flex-wrap items-center gap-x-1.5 text-[11px] text-subtle" tabIndex={0}>
                Última reproducción:
                <span className="font-medium text-muted">{sim.nombre ?? sim.escenarioId}</span>·
                <span className="font-mono">
                  {Math.min(sim.indice, sim.total)}/{sim.total}
                </span>
                · {sim.indice >= sim.total ? "terminada" : "parada"}
                {sim.iniciadaEn && <span className="font-mono">· {hora(sim.iniciadaEn, false)}</span>}
              </p>
            </Tooltip>
          )
        )}

        <div className="grid grid-cols-3 gap-1 rounded-lg bg-panel-2 p-0.5" role="tablist" aria-label="Secciones del simulador">
          {PESTANAS.map((p) => {
            const Icono = p.icon;
            const activa = pestana === p.id;
            return (
              <Tooltip key={p.id} titulo={p.etiqueta} contenido={p.ayuda} lado="abajo" className="w-full">
                <button
                  type="button"
                  role="tab"
                  id={`sim-tab-${p.id}`}
                  aria-selected={activa}
                  aria-controls="sim-panel"
                  onClick={() => irA(p.id)}
                  className={`relative flex min-h-8 w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                    activa ? "bg-panel text-brand shadow-sm" : "text-muted hover:text-foreground"
                  }`}
                >
                  <Icono className="size-3.5" aria-hidden />
                  {p.etiqueta}
                  {p.cuenta !== undefined && <span className="font-mono text-[11px] opacity-70">{p.cuenta}</span>}
                  {p.id === "resultados" && nuevos > 0 && (
                    <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-brand px-1 font-mono text-[10.5px] leading-4 text-panel">
                      <span aria-hidden>{nuevos > 99 ? "99+" : nuevos}</span>
                      <span className="sr-only">{nuevos} resultados nuevos sin ver</span>
                    </span>
                  )}
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {/* Contenido con scroll */}
      <div id="sim-panel" role="tabpanel" aria-labelledby={`sim-tab-${pestana}`} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        {cargando && escenarios.length === 0 && sueltos.length === 0 && pestana !== "resultados" ? (
          <div className="space-y-2" role="status" aria-busy="true">
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Leyendo escenarios y eventos del dataset…
            </p>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-[10px] bg-panel-2" />
            ))}
          </div>
        ) : (
          <>
            {errorCarga && pestana !== "resultados" && (
              <div className="mb-2.5 flex items-start justify-between gap-2 rounded-[10px] border border-danger/30 bg-danger/5 px-3 py-2">
                <ErrorInline mensaje={`No se pudo leer el dataset. ${errorCarga}`} />
                <button type="button" className="boton boton-secundario boton-sm shrink-0" onClick={recargar}>
                  Reintentar
                </button>
              </div>
            )}

            {pestana === "escenarios" && (
              <Escenarios escenarios={escenarios} sim={sim} puedeControlar={puedeControlar} onLanzado={alLanzar} onCambio={onCambio} />
            )}

            {pestana === "inyectar" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-panel-2 p-0.5" role="radiogroup" aria-label="Origen del evento">
                  {(
                    [
                      [
                        "dataset",
                        `Del dataset${sueltos.length ? ` (${sueltos.length})` : ""}`,
                        Send,
                        "Eventos ya escritos en data/dataset/sueltos.json, con su verdad de campo (real, bulo, duplicado o ruido) y el resultado que se espera del pipeline.",
                      ],
                      ["manual", "Componer a mano", PenLine, "Escribe tú el evento (tipo, canal, texto, lugar, gravedad e imagen) y se inyecta como si lo mandara un periférico real."],
                    ] as const
                  ).map(([valor, etiqueta, Icono, ayuda]) => (
                    <Tooltip key={valor} titulo={valor === "dataset" ? "Del dataset" : "Componer a mano"} contenido={ayuda} lado="abajo" className="w-full">
                      <label
                        className={`flex min-h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-center text-[11px] font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/30 ${
                          modo === valor ? "bg-panel text-brand shadow-sm" : "text-muted hover:text-foreground"
                        }`}
                      >
                        <input type="radio" name="sim-modo" value={valor} checked={modo === valor} onChange={() => setModo(valor)} className="sr-only" />
                        <Icono className="size-3.5" aria-hidden />
                        {etiqueta}
                      </label>
                    </Tooltip>
                  ))}
                </div>

                {modo === "dataset" ? (
                  <Sueltos
                    eventos={sueltos}
                    puedeControlar={puedeControlar}
                    idsUsados={idsUsados}
                    onInyectado={(r, e) =>
                      registrarInyeccion(r, {
                        titulo: e.titulo,
                        esperadoCategoria: e.esperadoCategoria,
                        esperadoImpacto: e.esperadoImpacto,
                        veracidad: e.veracidad,
                        origen: "suelto",
                      })
                    }
                    onSeleccionarDecision={onSeleccionarDecision}
                    onIrACompositor={() => setModo("manual")}
                    onCambio={onCambio}
                  />
                ) : (
                  <Compositor
                    centro={centroLugar}
                    lugares={lugares}
                    imagenes={imagenes}
                    puedeControlar={puedeControlar}
                    onInyectado={(r, info) =>
                      registrarInyeccion(r, { titulo: info.titulo, esperadoCategoria: info.esperadoCategoria, veracidad: "real", origen: "manual" })
                    }
                    onSeleccionarDecision={onSeleccionarDecision}
                    onVerResultados={() => irA("resultados")}
                    onCambio={onCambio}
                  />
                )}
              </div>
            )}

            {pestana === "resultados" && (
              <Resultados resultados={resultados} memoria={memoria} eventos={eventos} onSeleccionarDecision={onSeleccionarDecision} />
            )}
          </>
        )}
      </div>
    </section>
  );
}
