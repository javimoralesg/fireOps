"use client";
// Barra superior de la sala: marca, reloj de mundo con sus controles, ejecución,
// salud de servicios, accesos a las demás pantallas y tema. DUEÑO: constructor E.
//
// Todo lo que cambia el estado del mundo está aquí y siempre visible: pausa,
// factor de aceleración y "+1 h".

import { useState } from "react";
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
  ScrollText,
  Settings2,
  ShieldCheck,
  Smartphone,
  Square,
  Wind,
} from "lucide-react";
import type { Snapshot } from "@/lib/dominio/tipos";
import { ajustarReloj, ejecucion as accionEjecucion, mensajeDeError } from "@/lib/cliente/api";
import { hora, numero } from "@/lib/cliente/formato";
import { Boton } from "@/components/ui/Boton";
import { Dialogo } from "@/components/ui/Dialogo";
import { Tooltip } from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import { Marca } from "@/components/marca/Logo";
import { SelectorTema } from "@/components/marca/SelectorTema";
import { debugActivado } from "@/lib/cliente/configuracion";
import { ControlViento } from "./ControlViento";
import { PuntosSalud } from "./PuntosSalud";

const FACTORES = [6, 12, 30];

const ENLACES = [
  { href: "/conocimiento", etiqueta: "Conocimiento", icono: BookOpen },
  { href: "/politica", etiqueta: "Política", icono: Settings2 },
  { href: "/informes", etiqueta: "Informes", icono: ScrollText },
  { href: "/auditoria", etiqueta: "Auditoría", icono: ShieldCheck },
  { href: "/aprendizaje", etiqueta: "Aprendizaje", icono: GraduationCap },
  { href: "/publico", etiqueta: "Portal ciudadano", icono: Megaphone },
];

export function BarraSuperior({
  snapshot,
  onRefrescar,
  onDeclararFoco,
  declarando,
  onAtajos,
  onVistaAgentes,
  onUnirMovil,
}: {
  snapshot?: Snapshot;
  onRefrescar?: () => void;
  onDeclararFoco: () => void;
  declarando: boolean;
  onAtajos: () => void;
  onVistaAgentes: () => void;
  onUnirMovil: () => void;
}) {
  const toast = useToast();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [menuEjecucion, setMenuEjecucion] = useState(false);
  const [vientoGlobal, setVientoGlobal] = useState(false);

  const reloj = snapshot?.reloj;
  const ejec = snapshot?.ejecucion;
  const pausado = Boolean(reloj?.pausado);
  const mostrarSaludServicios = debugActivado(process.env.NEXT_PUBLIC_DEBUG);
  const focosActivos = (snapshot?.incendios ?? []).filter((i) => !["extinguido", "descartado", "controlado"].includes(i.estado));
  const vientoForzado = focosActivos.find((i) => i.meteoForzada);

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
    const aviso =
      accion === "nueva"
        ? "Se cerrará la ejecución actual (sus focos, unidades y decisiones dejarán de verse en la sala; quedan en la auditoría) y empezará una nueva. ¿Continuar?"
        : "Se cerrará la ejecución actual y se generará el post-mortem con sus lecciones. ¿Continuar?";
    if (typeof window !== "undefined" && !window.confirm(aviso)) return;
    setOcupado(`ejec-${accion}`);
    setMenuEjecucion(false);
    try {
      await accionEjecucion(accion);
      toast.exito(accion === "nueva" ? "Nueva ejecución iniciada" : "Ejecución cerrada", accion === "cerrar" ? "Se generará el post-mortem y las lecciones." : undefined);
      onRefrescar?.();
    } catch (e) {
      toast.error("No se ha podido cambiar la ejecución", mensajeDeError(e));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <header className="z-[1100] flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-panel-border bg-panel px-3 py-2">
      <Link href="/" className="shrink-0 rounded-lg">
        <Marca organismo="Sala de mando · Incendios forestales" />
      </Link>

      {/* Reloj de mundo: lo más grande de la barra. */}
      <div className="flex items-center gap-2 rounded-xl border border-panel-border bg-panel-2 px-2.5 py-1">
        <div className="leading-none">
          <p className={`tabular text-2xl font-semibold tracking-tight ${pausado ? "parpadeo text-warning" : "text-foreground"}`}>
            {hora(reloj?.ahoraMundo)}
          </p>
          <p className={`mt-0.5 text-[10.5px] ${pausado ? "font-semibold text-warning" : "text-muted"}`}>
            Hora de mundo · ×{numero(reloj?.factor ?? 12)} {pausado ? "· EN PAUSA" : ""}
          </p>
        </div>
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
      </div>

      {/* Ejecución */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuEjecucion((v) => !v)}
          aria-expanded={menuEjecucion}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-panel-border-strong bg-panel px-2.5 text-[12.5px] text-foreground hover:bg-panel-2"
        >
          <FlaskConical className="size-3.5 text-brand" aria-hidden />
          <span className="max-w-[10rem] truncate">{ejec?.nombre ?? "Sin ejecución"}</span>
          <span className={`size-1.5 rounded-full ${ejec?.estado === "activa" ? "bg-success" : "bg-muted"}`} aria-hidden />
          <span className="solo-lectores">{ejec?.estado === "activa" ? "activa" : "cerrada"}</span>
          <ChevronDown className="size-3.5 text-muted" aria-hidden />
        </button>
        {menuEjecucion ? (
          <div className="absolute left-0 top-full z-[1200] mt-1 w-56 rounded-xl border border-panel-border bg-panel p-1 shadow-[var(--sombra-flotante)]">
            <button
              type="button"
              onClick={() => cambiarEjecucion("nueva")}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-foreground hover:bg-panel-2"
            >
              <CirclePlay className="size-4 text-brand" aria-hidden /> Nueva ejecución
            </button>
            <button
              type="button"
              onClick={() => cambiarEjecucion("cerrar")}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-foreground hover:bg-panel-2"
            >
              <Square className="size-4 text-muted" aria-hidden /> Cerrar y hacer post-mortem
            </button>
          </div>
        ) : null}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {/* PARAR TODO: siempre visible y siempre en el mismo sitio. Al pulsarlo
            se pausa el mundo entero y ningún agente vuelve a llamar a la IA. */}
        <Tooltip
          lado="abajo"
          titulo={pausado ? "El mundo ya está en pausa" : "Parar todo"}
          contenido="Pausa el mundo: todos los agentes quedan en pausa y no hay ninguna llamada a la IA. Atajo: barra espaciadora."
        >
          <Boton
            variante={pausado ? "secundario" : "peligro"}
            tamano="lg"
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
        <Boton variante={declarando ? "peligro" : "primario"} icono={<Flame />} onClick={onDeclararFoco}>
          {declarando ? "Cancelar (Esc)" : "Declarar foco"}
        </Boton>
        <Boton
          tamano="sm"
          variante={vientoForzado ? "primario" : "secundario"}
          icono={<Wind />}
          onClick={() => setVientoGlobal(true)}
          title="Fijar a mano el viento de todos los focos activos (ejercicio)"
        >
          Viento global
        </Boton>
        <Boton tamano="sm" icono={<Bot />} onClick={onVistaAgentes}>
          Vista de agentes
        </Boton>
        <Boton tamano="sm" icono={<Smartphone />} onClick={onUnirMovil}>
          Unir un móvil
        </Boton>
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
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Boton tamano="sm" variante="fantasma" icono={<HelpCircle />} onClick={onAtajos}>
            Atajos
          </Boton>
          <SelectorTema compacto />
        </div>
      </div>
    </header>
  );
}
