"use client";
// Barra superior de la sala: marca, reloj de mundo con sus controles, ejecución,
// salud de servicios, accesos a las demás pantallas y tema. DUEÑO: constructor E.
//
// OPERACIÓN (siempre visible): la hora de mundo con su factor (solo estado, sin
// botones); la insignia de fuentes apagadas («SIMULACRO…»); "Unir un móvil"; la segunda fila (salud, enlaces, atajos, tema).
// DESARROLLO (solo con el conmutador «</>» de la segunda fila, preferencia del
// navegador en `useModoDesarrollo`): Pausar, ×N y "+1 h" del reloj; el
// desplegable de ejecución con las fuentes de detección; PARAR TODO; Declarar
// foco y Viento global. Los atajos de teclado (F, Espacio…) funcionan igual en
// los dos modos: sin modo dev, la pausa se lleva con la barra espaciadora y el
// foco se declara con F + clic en el mapa.
//
// RENDIMIENTO (constructor R): va envuelta en `memo`, así que un cambio de
// pestaña, un diálogo o el plegado del panel ya no la repintan. Sí se repinta
// con cada snapshot (el reloj de mundo avanza), pero el filtro de focos está
// memoizado sobre su porción.

import { memo, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Bot,
  ChevronDown,
  CirclePlay,
  Flame,
  FlaskConical,
  GraduationCap,
  HelpCircle,
  Megaphone,
  OctagonX,
  Pause,
  Play,
  Plus,
  Radar,
  ScrollText,
  Settings2,
  ShieldCheck,
  Smartphone,
  Square,
  Wind,
} from "lucide-react";
import type { FuenteDeteccion, Snapshot } from "@/lib/dominio/tipos";
import { CATALOGO_FUENTES, IDS_FUENTES, SUELO_SIMULACRO, esSimulacro, fuentesDesactivadas, resumenFuentes } from "@/lib/dominio/fuentes-deteccion";
import { ajustarReloj, cambiarFuentesDeteccion, ejecucion as accionEjecucion, mensajeDeError } from "@/lib/cliente/api";
import { hora, numero } from "@/lib/cliente/formato";
import { useModoDesarrollo } from "@/lib/cliente/useModoDesarrollo";
import { Boton } from "@/components/ui/Boton";
import { Dialogo } from "@/components/ui/Dialogo";
import { Insignia } from "@/components/ui/Insignia";
import { Interruptor } from "@/components/ui/Interruptor";
import { Tooltip } from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import { Marca } from "@/components/marca/Logo";
import { SelectorTema } from "@/components/marca/SelectorTema";
import { ConmutadorDesarrollo } from "./ConmutadorDesarrollo";
import { debugActivado } from "@/lib/cliente/configuracion";
import { ControlViento } from "./ControlViento";
import { PuntosSalud } from "./PuntosSalud";

const FACTORES = [6, 12, 30];

const ENLACES = [
  { href: "/agentes", etiqueta: "Agentes", icono: Bot },
  { href: "/conocimiento", etiqueta: "Conocimiento", icono: BookOpen },
  { href: "/politica", etiqueta: "Política", icono: Settings2 },
  { href: "/informes", etiqueta: "Informes", icono: ScrollText },
  { href: "/auditoria", etiqueta: "Auditoría", icono: ShieldCheck },
  { href: "/aprendizaje", etiqueta: "Aprendizaje", icono: GraduationCap },
  { href: "/publico", etiqueta: "Portal ciudadano", icono: Megaphone },
];

/** Estados de incendio que ya no cuentan para el viento del ejercicio. */
const NO_ACTIVOS = ["extinguido", "descartado", "controlado"];

function BarraSuperiorBase({
  snapshot,
  onRefrescar,
  onDeclararFoco,
  declarando,
  onAtajos,
  onUnirMovil,
}: {
  snapshot?: Snapshot;
  onRefrescar?: () => void;
  onDeclararFoco: () => void;
  declarando: boolean;
  onAtajos: () => void;
  onUnirMovil: () => void;
}) {
  const toast = useToast();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [menuEjecucion, setMenuEjecucion] = useState(false);
  const [vientoGlobal, setVientoGlobal] = useState(false);
  const { desarrollo, alternar: alternarDesarrollo } = useModoDesarrollo();

  const reloj = snapshot?.reloj;
  const ejec = snapshot?.ejecucion;
  const pausado = Boolean(reloj?.pausado);
  // Fuentes de detección apagadas por el mando (estado del servidor, viaja en la
  // ejecución): la insignia se ve SIEMPRE, los interruptores solo en modo desarrollo.
  const apagadas = fuentesDesactivadas(ejec);
  const simulacro = esSimulacro(ejec);
  const resumenApagadas = resumenFuentes(ejec);
  /** Forma corta de la insignia para la barra compacta (< 1840 px); el texto completo va en `title`. */
  const resumenCorto = simulacro ? "SIMULACRO" : apagadas.length === 1 ? resumenApagadas : `${apagadas.length} fuentes apagadas`;
  const incendios = snapshot?.incendios;
  const focosActivos = useMemo(() => (incendios ?? []).filter((i) => !NO_ACTIVOS.includes(i.estado)), [incendios]);
  const vientoForzado = useMemo(() => focosActivos.find((i) => i.meteoForzada), [focosActivos]);
  // Salud de servicios: se ve con el modo desarrollo del navegador o con NEXT_PUBLIC_DEBUG=true.
  const mostrarSaludServicios = desarrollo || debugActivado(process.env.NEXT_PUBLIC_DEBUG);
  const agentes = snapshot?.agentes;
  const agentesConError = useMemo(() => (agentes ?? []).filter((a) => a.estado === "error" || Boolean(a.ultimoError)).length, [agentes]);

  async function reloj_(cambio: { factor?: number; pausado?: boolean; avanzarMin?: number }, clave: string, frase: string) {
    setOcupado(clave);
    try {
      await ajustarReloj(cambio);
      toast.info(frase);
      onRefrescar?.();
    } catch (e) {
      toast.error("No se ha podido cambiar el reloj", mensajeDeError(e));
    } finally {
      setOcupado(null);
    }
  }

  async function cambiarEjecucion(accion: "nueva" | "cerrar") {
    const yaCerrada = accion === "cerrar" && ejec?.estado === "cerrada";
    const aviso =
      accion === "nueva"
        ? "Se cerrará la ejecución actual (sus focos, unidades y decisiones dejarán de verse en la sala; quedan en la auditoría) y empezará una nueva. ¿Continuar?"
        : yaCerrada
          ? "La ejecución ya está cerrada pero no tiene post-mortem. ¿Generarlo ahora?"
          : "Se cerrará la ejecución actual y se generará el post-mortem con sus lecciones. ¿Continuar?";
    if (typeof window !== "undefined" && !window.confirm(aviso)) return;
    setOcupado(`ejec-${accion}`);
    setMenuEjecucion(false);
    try {
      await accionEjecucion(accion);
      toast.exito(
        accion === "nueva" ? "Nueva ejecución iniciada" : yaCerrada ? "Post-mortem generado" : "Ejecución cerrada",
        accion === "cerrar" ? "Lo tienes en Informes." : undefined,
      );
      onRefrescar?.();
    } catch (e) {
      toast.error("No se ha podido cambiar la ejecución", mensajeDeError(e));
    } finally {
      setOcupado(null);
    }
  }

  /** Manda la lista COMPLETA de fuentes apagadas; el servidor registra el evento y marca a los agentes. */
  async function cambiarFuentes(lista: FuenteDeteccion[]) {
    setOcupado("fuentes");
    try {
      const { ejecucion: nueva } = await cambiarFuentesDeteccion(lista);
      const texto = resumenFuentes(nueva);
      toast.info(
        texto ? (esSimulacro(nueva) ? "Simulacro activado" : "Fuentes de detección cambiadas") : "Operación real: todas las fuentes activas",
        texto ?? "Satélite, prensa y redes, cámaras fijas y avisos ciudadanos vuelven a crear focos.",
      );
      onRefrescar?.();
    } catch (e) {
      toast.error("No se han podido cambiar las fuentes de detección", mensajeDeError(e));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <header className="z-[1100] flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-panel-border bg-panel px-2 py-2">
      {/* Primera fila: marca, reloj, ejecución, fuentes y botones. Desde 1280 px
          (xl) NO se parte en dos líneas. Medido en modo desarrollo: con todos
          los textos completos hacen falta ~1800 px, así que por debajo de
          1840 px va la forma compacta (marca sin organismo, «Ejecución» sin el
          nombre largo, insignia «SIMULACRO», botones secundarios con texto
          corto; el texto completo queda en `title`) y, si aun así falta sitio,
          solo trunca la insignia. Por debajo de 1280 px envuelve como antes. */}
      <div className="flex w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-2 xl:flex-nowrap">
      <Link href="/" className="shrink-0 rounded-lg">
        <Marca organismo="Sala de mando · Incendios forestales" compacta />
      </Link>

      {/* Reloj de mundo: lo más grande de la barra. La hora es estado y se ve
          siempre; sus botones (Pausar, ×N, +1 h) son de desarrollo. */}
      <div className="flex shrink-0 items-center gap-2 rounded-xl border border-panel-border bg-panel-2 px-2.5 py-1">
        <div className="leading-none">
          <p className={`tabular text-2xl font-semibold tracking-tight ${pausado ? "parpadeo text-warning" : "text-foreground"}`}>
            {hora(reloj?.ahoraMundo)}
          </p>
          {/* En pausa solo dice EN PAUSA (el factor sigue en el botón ×N pulsado);
              por debajo de 1840 px «Mundo · ×12» para que la barra quepa en una línea. */}
          <p className={`mt-0.5 whitespace-nowrap text-[10.5px] ${pausado ? "font-semibold text-warning" : "text-muted"}`}>
            {pausado ? (
              "EN PAUSA"
            ) : (
              <>
                <span className="hidden min-[1840px]:inline">Hora de mundo</span>
                <span className="min-[1840px]:hidden">Mundo</span> · ×{numero(reloj?.factor ?? 12)}
              </>
            )}
          </p>
        </div>
        {desarrollo ? (
        <div className="flex items-center gap-1">
          <Tooltip lado="abajo" titulo={pausado ? "Reanudar el mundo" : "Pausar el mundo"} contenido="Atajo: barra espaciadora.">
            <Boton
              tamano="sm"
              variante={pausado ? "primario" : "secundario"}
              icono={pausado ? <Play /> : <Pause />}
              cargando={ocupado === "pausa"}
              onClick={() => reloj_({ pausado: !pausado }, "pausa", pausado ? "Mundo reanudado" : "Mundo en pausa")}
            >
              {pausado ? "Reanudar" : "Pausar"}
            </Boton>
          </Tooltip>
          <div role="group" aria-label="Velocidad del tiempo de mundo" className="flex overflow-hidden rounded-lg border border-panel-border-strong">
            {FACTORES.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={reloj?.factor === f}
                onClick={() => reloj_({ factor: f }, `factor-${f}`, `Tiempo a ×${f}`)}
                className={[
                  "tabular min-h-9 px-2 text-[12px] font-medium",
                  reloj?.factor === f ? "bg-brand text-accent-contraste" : "bg-panel text-muted hover:bg-panel-2 hover:text-foreground",
                ].join(" ")}
              >
                ×{f}
              </button>
            ))}
          </div>
          <Tooltip lado="abajo" titulo="Avanzar una hora de mundo" contenido="Salta 60 minutos: el viento y el frente se recalculan con la previsión real de esa hora.">
            <Boton tamano="sm" icono={<Plus />} cargando={ocupado === "avanzar"} onClick={() => reloj_({ avanzarMin: 60 }, "avanzar", "Mundo adelantado 1 hora")}>
              1 h
            </Boton>
          </Tooltip>
        </div>
        ) : null}
      </div>

      {/* Ejecución (solo modo desarrollo): nombre, "Nueva ejecución", cierre y
          las fuentes de detección. */}
      {desarrollo ? (
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuEjecucion((v) => !v)}
          aria-expanded={menuEjecucion}
          title={ejec?.nombre ?? "Sin ejecución"}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-panel-border-strong bg-panel px-2.5 text-[12.5px] text-foreground hover:bg-panel-2"
        >
          <FlaskConical className="size-3.5 text-brand" aria-hidden />
          <span className="hidden max-w-[12rem] truncate min-[1840px]:inline">{ejec?.nombre ?? "Sin ejecución"}</span>
          <span className="min-[1840px]:hidden">Ejecución</span>
          <span className={`size-1.5 rounded-full ${ejec?.estado === "activa" ? "bg-success" : "bg-muted"}`} aria-hidden />
          <span className="solo-lectores">{ejec?.estado === "activa" ? "activa" : "cerrada"}</span>
          <ChevronDown className="size-3.5 text-muted" aria-hidden />
        </button>
        {menuEjecucion ? (
          <div className="absolute left-0 top-full z-[1200] mt-1 w-80 rounded-xl border border-panel-border bg-panel p-1 shadow-[var(--sombra-flotante)]">
            <p className="truncate px-2 pb-1 pt-1.5 text-[11.5px] text-muted" title={ejec?.nombre}>
              {ejec?.nombre ?? "Sin ejecución"} · {ejec?.estado === "activa" ? "activa" : "cerrada"}
            </p>
            <button
              type="button"
              onClick={() => cambiarEjecucion("nueva")}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-foreground hover:bg-panel-2"
            >
              <CirclePlay className="size-4 text-brand" aria-hidden /> Nueva ejecución
            </button>
            {ejec?.estado === "cerrada" && ejec.postmortemInformeId ? (
              <Link
                href="/informes"
                onClick={() => setMenuEjecucion(false)}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-foreground hover:bg-panel-2"
              >
                <ScrollText className="size-4 text-muted" aria-hidden /> Ver post-mortem
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => cambiarEjecucion("cerrar")}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-foreground hover:bg-panel-2"
              >
                <Square className="size-4 text-muted" aria-hidden /> {ejec?.estado === "cerrada" ? "Generar post-mortem" : "Cerrar y hacer post-mortem"}
              </button>
            )}

            {/* Fuentes de detección: apagar una NO inventa ni borra nada, solo deja
                de recogerse y sus avisos ya no crean ni confirman focos. La mano y
                la cámara móvil no se apagan nunca (suelo del simulacro). */}
            <div className="my-1 border-t border-panel-border" />
            <p className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">Fuentes de detección</p>
            <div role="group" aria-label="Fuentes de detección activas">
              {CATALOGO_FUENTES.map((fuente) => (
                <Interruptor
                  key={fuente.id}
                  activo={!apagadas.includes(fuente.id)}
                  desactivado={ocupado === "fuentes"}
                  etiqueta={fuente.nombre}
                  nota={fuente.descripcion}
                  onCambiar={(encendida) => cambiarFuentes(encendida ? apagadas.filter((f) => f !== fuente.id) : [...apagadas, fuente.id])}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 px-2 pb-1 pt-1.5">
              <Boton
                tamano="sm"
                variante={simulacro ? "primario" : "secundario"}
                icono={<FlaskConical />}
                cargando={ocupado === "fuentes"}
                disabled={simulacro}
                title={`Apaga satélite, prensa y redes, cámaras fijas y avisos ciudadanos: solo ${SUELO_SIMULACRO} crean focos`}
                onClick={() => cambiarFuentes([...IDS_FUENTES])}
              >
                Simulacro: a mano, móvil y 112
              </Boton>
              <Boton tamano="sm" variante="fantasma" icono={<Radar />} disabled={!apagadas.length || ocupado === "fuentes"} onClick={() => cambiarFuentes([])}>
                Todas las fuentes
              </Boton>
            </div>
          </div>
        ) : null}
      </div>
      ) : null}

      {/* Fuentes apagadas: estado del mundo, así que se ve en los dos modos. */}
      {resumenApagadas ? (
        <div role="status" className="min-w-0">
          <Insignia
            tono="aviso"
            punto
            title={`${resumenApagadas}. Las fuentes apagadas no crean ni confirman focos. Siempre crean focos ${SUELO_SIMULACRO}. Se cambia en el desplegable de ejecución (modo desarrollo).`}
          >
            <span className="hidden min-[1840px]:inline">{resumenApagadas}</span>
            <span className="min-[1840px]:hidden">{resumenCorto}</span>
          </Insignia>
        </div>
      ) : null}

      <div className="ml-auto flex flex-wrap items-center gap-1 xl:shrink-0 xl:flex-nowrap">
        {desarrollo ? (
          <>
            {/* PARAR TODO: siempre en el mismo sitio dentro del modo desarrollo. Al
                pulsarlo se pausa el mundo entero y ningún agente vuelve a llamar a la
                IA. Sin modo desarrollo queda la barra espaciadora (y el botón
                "Reanudar" de la banda de pausa). */}
            <Tooltip
              lado="abajo"
              titulo={pausado ? "El mundo ya está en pausa" : "Parar todo"}
              contenido="Pausa el mundo: todos los agentes quedan en pausa y no hay ninguna llamada a la IA. Atajo: barra espaciadora."
            >
              <Boton
                variante={pausado ? "secundario" : "peligro"}
                tamano="md"
                icono={pausado ? <Play /> : <OctagonX />}
                cargando={ocupado === "parar"}
                onClick={() =>
                  reloj_({ pausado: !pausado }, "parar", pausado ? "Mundo reanudado: los agentes vuelven a trabajar" : "TODO EN PAUSA: ningún agente trabaja")
                }
                className="font-bold"
              >
                {pausado ? "REANUDAR" : "PARAR TODO"}
              </Boton>
            </Tooltip>
          </>
        ) : null}
        {/* Declarar foco: en modo desarrollo siempre; sin él, solo la salida
            "Cancelar (Esc)" cuando el modo declarar se activó con la tecla F. */}
        {desarrollo || declarando ? (
          <Boton tamano="sm" variante={declarando ? "peligro" : "primario"} icono={<Flame />} onClick={onDeclararFoco}>
            {declarando ? "Cancelar (Esc)" : "Declarar foco"}
          </Boton>
        ) : null}
        {desarrollo ? (
          <Boton
            tamano="sm"
            variante={vientoForzado ? "primario" : "secundario"}
            icono={<Wind />}
            onClick={() => setVientoGlobal(true)}
            title="Viento global: fijar a mano el viento de todos los focos activos (ejercicio)"
          >
            <span className="hidden min-[1840px]:inline">Viento global</span>
            <span className="min-[1840px]:hidden">Viento</span>
          </Boton>
        ) : null}
        <Boton tamano="sm" icono={<Smartphone />} onClick={onUnirMovil} title="Unir un móvil">
          <span className="hidden min-[1840px]:inline">Unir un móvil</span>
          <span className="min-[1840px]:hidden">Móvil</span>
        </Boton>
      </div>
      </div>

      <Dialogo
        abierto={vientoGlobal}
        onCerrar={() => setVientoGlobal(false)}
        titulo="Viento del ejercicio · todos los focos activos"
        descripcion={
          focosActivos.length === 0
            ? "Ahora mismo no hay ningún foco activo: declara uno y vuelve a abrir este control."
            : `Se aplicará a los ${focosActivos.length} foco(s) activos. Los agentes de propagación, coordinación y aviso replanificarán con el viento nuevo.`
        }
        ancho="sm"
        pie={
          <Boton variante="fantasma" onClick={() => setVientoGlobal(false)}>
            Cerrar
          </Boton>
        }
      >
        <ControlViento
          inicial={
            vientoForzado?.meteoForzada ??
            (focosActivos[0]?.meteo
              ? { direccionGrados: focosActivos[0].meteo.direccionGrados, vientoKmh: focosActivos[0].meteo.vientoKmh }
              : undefined)
          }
          forzado={vientoForzado?.meteoForzada}
          onCambio={onRefrescar}
        />
      </Dialogo>

      {/* Segunda fila: salud, enlaces y tema. A 1024 px cae debajo sin scroll horizontal. */}
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-panel-border pt-1.5">
        {mostrarSaludServicios ? <PuntosSalud servicios={snapshot?.servicios} /> : null}
        <nav aria-label="Otras pantallas" className="flex flex-wrap items-center gap-0.5">
          {ENLACES.map(({ href, etiqueta, icono: Icono }) => (
            <Link
              key={href}
              href={href}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-muted hover:bg-panel-2 hover:text-foreground"
            >
              <Icono className="size-3.5" aria-hidden /> {etiqueta}
              {href === "/agentes" && agentesConError > 0 ? (
                <span className="rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white dark:text-[#2a0d10]">
                  {agentesConError} con error
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Boton tamano="sm" variante="fantasma" icono={<HelpCircle />} onClick={onAtajos}>
            Atajos
          </Boton>
          <ConmutadorDesarrollo activo={desarrollo} onAlternar={alternarDesarrollo} compacto />
          <SelectorTema compacto />
        </div>
      </div>
    </header>
  );
}

export const BarraSuperior = memo(BarraSuperiorBase);
