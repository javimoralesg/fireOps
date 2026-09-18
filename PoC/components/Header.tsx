"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ChevronDown,
  FlaskConical,
  Gauge,
  Pause,
  Play,
  Plug,
  RotateCcw,
  SkipForward,
  UserRound,
} from "lucide-react";
import { Logo } from "@/components/marca/Logo";
import { SelectorTema } from "@/components/marca/SelectorTema";
import { BotonGuia } from "@/components/ui/Guia";
import { Tooltip } from "@/components/ui/Tooltip";
import type { Conexion } from "@/lib/useEstado";
import type { EstadoSistema } from "@/lib/tipos-sistema";
import { limiteRiesgo, puede } from "@/lib/permisos";
import { AMBITO_ETIQUETA, ROLES, type RolId } from "@/lib/roles";

const FASE: Record<EstadoSistema["incidente"]["fase"], { texto: string; cls: string; ayuda: string }> = {
  deteccion: { texto: "Detección", cls: "pildora pildora-info", ayuda: "Se está confirmando el incidente con sensores, llamadas y visión." },
  respuesta: { texto: "Respuesta", cls: "pildora pildora-marca", ayuda: "Incidente confirmado: la IA propone y el mando firma el despliegue." },
  escalada: { texto: "Escalada", cls: "pildora pildora-peligro", ayuda: "El escenario empeora (viento, dominó): decisiones de mayor riesgo." },
  estabilizacion: { texto: "Estabilización", cls: "pildora pildora-aviso", ayuda: "La situación está contenida; se consolidan acciones y avisos." },
  cierre: { texto: "Cierre", cls: "pildora pildora-exito", ayuda: "Incidente cerrado: se compila el post-mortem para firma." },
};

const CONEXION_UI: Record<Conexion, { color: string; texto: string; cls: string; ayuda: string }> = {
  conectando: { color: "bg-subtle", texto: "Conectando", cls: "pildora", ayuda: "Esperando la primera respuesta del orquestador." },
  en_vivo: { color: "bg-success", texto: "En vivo", cls: "pildora pildora-exito", ayuda: "Estado sincronizado con el servidor cada 2 s; los relojes usan la hora del servidor." },
  fixture: { color: "bg-warning", texto: "Sin backend", cls: "pildora pildora-aviso", ayuda: "El servidor no responde: se muestra un estado de demostración y las acciones fallarán." },
};

const MODO_DATOS: Record<EstadoSistema["modoDatos"], string> = {
  real: "Datos reales",
  mixto: "Datos mixtos",
  sin_datos: "Sin datos abiertos",
};
const modoDatosTexto = (m: EstadoSistema["modoDatos"]) => MODO_DATOS[m] ?? "Sin datos abiertos";

/** "T+mm:ss" o "T+h:mm:ss" desde el inicio del incidente. */
function transcurrido(desdeIso: string, ahora: number) {
  const s = Math.max(0, Math.floor((ahora - Date.parse(desdeIso)) / 1000));
  if (!Number.isFinite(s)) return "T+--:--";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `T+${h}:${String(m).padStart(2, "0")}:${ss}` : `T+${String(m).padStart(2, "0")}:${ss}`;
}

/** Popover mínimo: se cierra con clic fuera o Escape. */
function Menu({
  boton,
  children,
  etiqueta,
}: {
  boton: (abierto: boolean) => ReactNode;
  children: (cerrar: () => void) => ReactNode;
  etiqueta: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAbierto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [abierto]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label={etiqueta}
        className="flex items-center gap-1.5 rounded-lg border border-transparent px-2 py-1.5 transition hover:border-panel-border hover:bg-panel-2 aria-expanded:border-panel-border-strong aria-expanded:bg-panel-2"
      >
        {boton(abierto)}
      </button>
      {abierto && (
        <div
          role="menu"
          className="absolute right-0 top-full z-[1200] mt-1.5 w-72 rounded-xl border border-panel-border bg-panel p-1.5 shadow-[var(--sombra-flotante)]"
        >
          {children(() => setAbierto(false))}
        </div>
      )}
    </div>
  );
}

interface Props {
  estado: EstadoSistema;
  conexion: Conexion;
  ahora: number; // epoch ms sincronizado con el servidor
  rol: RolId; // rol activo del navegador (lib/useRol.ts)
  onUmbral: (umbral: number) => Promise<void>;
  onAutoAvance: (activo: boolean) => void;
  onTick: () => void;
  onReset: () => void;
}

export function Header({ estado, conexion, ahora, rol, onUmbral, onAutoAvance, onTick, onReset }: Props) {
  const { incidente } = estado;
  const con = CONEXION_UI[conexion];
  const fase = FASE[incidente.fase];
  const def = ROLES[rol];
  const fijaUmbral = puede(rol, "fijar_umbral");
  // La dirección del plan también puede pilotar el simulacro en la demo.
  const controlaSimulacion = puede(rol, "controlar_simulacion") || rol === "director_plan";
  const limite = limiteRiesgo(rol);

  // Servicios reales, externos o locales (poc-c8); lo que falta sale como "sin proveedor".
  const cx = estado.conectores;
  const det = (estado as typeof estado & { conectoresDetalle?: Record<string, string> }).conectoresDetalle ?? {};
  const SIN = "sin proveedor";
  const servicios: { nombre: string; funcion: string; activo: boolean; estado: string }[] = [
    { nombre: "IA", funcion: "Propuestas y planes (router: modelo rápido clasifica, modelo grande planifica)", activo: estado.iaDisponible, estado: det.ia ?? (estado.iaDisponible ? "Claude API" : SIN) },
    { nombre: "Grafo", funcion: "Grafo de ciudad y efecto dominó", activo: estado.origenGrafo === "ArangoDB", estado: det.grafo ?? (estado.origenGrafo === "ArangoDB" ? "ArangoDB · AQL" : "grafo en memoria") },
    { nombre: "Búsqueda", funcion: "Contexto en prensa y redes; detección de imágenes recicladas", activo: !!(cx?.busqueda ?? cx?.exa), estado: det.busqueda ?? (cx?.exa ? "Exa" : SIN) },
    { nombre: "Visión", funcion: "Análisis de imágenes ciudadanas y de cámaras", activo: !!(cx?.vision ?? cx?.fal), estado: det.vision ?? (cx?.fal ? "fal.ai" : SIN) },
    { nombre: "Protocolos", funcion: "Recuperación de protocolos y normativa (RAG)", activo: !!(cx?.rag ?? cx?.quiver), estado: det.protocolos ?? (cx?.quiver ? "QuiverAI" : SIN) },
    { nombre: "Voz", funcion: "Alertas de voz multilingües", activo: !!(cx?.tts ?? cx?.elevenlabs), estado: det.audio ?? (cx?.elevenlabs ? "ElevenLabs" : SIN) },
    { nombre: "Ejecución", funcion: "Llamadas, SMS y órdenes a los servicios", activo: estado.proveedorEjecucion !== "Ninguno", estado: det.ejecucion ?? estado.proveedorEjecucion },
    { nombre: "Datos abiertos", funcion: "Tráfico Madrid, Open-Meteo, REE", activo: estado.modoDatos === "real" || estado.modoDatos === "mixto", estado: modoDatosTexto(estado.modoDatos).toLowerCase() },
  ];
  const conectados = servicios.filter((sv) => sv.activo).length;

  // Mientras se arrastra, el slider muestra un borrador local; al soltar se
  // envía y el borrador se descarta cuando el servidor ya tiene el valor.
  const [borrador, setBorrador] = useState<number | null>(null);
  const [confirmarReset, setConfirmarReset] = useState(false);
  const umbral = borrador ?? estado.umbralAutonomia;

  const soltar = async () => {
    if (borrador === null) return;
    try {
      if (borrador !== estado.umbralAutonomia) await onUmbral(borrador);
    } finally {
      setBorrador(null);
    }
  };

  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-panel-border bg-panel/85 px-5 py-2.5 backdrop-blur">
      <Logo vivo />

      <div className="hidden h-9 w-px bg-panel-border sm:block" aria-hidden />

      {/* Incidente activo */}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Tooltip titulo={`Fase: ${fase.texto}`} contenido={fase.ayuda} lado="abajo">
            <span className={`shrink-0 ${fase.cls}`}>{fase.texto}</span>
          </Tooltip>
          <h2 className="truncate text-[14px] font-semibold text-foreground">{incidente.titulo}</h2>
        </div>
        <p className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-muted">
          <Tooltip
            titulo="Tiempo de incidente"
            contenido="Desde que se detectó el incidente, con la hora del servidor."
            lado="abajo"
          >
            <span className="font-mono text-foreground">{incidente.activo ? transcurrido(incidente.iniciadoEn, ahora) : "Cerrado"}</span>
          </Tooltip>
          <span className="text-subtle">·</span>
          <span className="truncate">{incidente.ubicacion.nombre}</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <Link
          href="/politica"
          className="text-[11px] font-medium text-accent hover:underline"
          title="Política de autonomía: qué gestiona la IA sola y qué necesita firma humana, por categoría de acción"
        >
          Política
        </Link>
        {/* Umbral de autonomía: supervisión, siempre visible; editable solo con fijar_umbral */}
        {fijaUmbral ? (
          <Tooltip
            titulo="Umbral de autonomía de la IA"
            contenido={
              <>
                Las decisiones con riesgo <strong>≤ {umbral}</strong> se ejecutan sin firma humana; el resto esperan a un
                responsable. Arrastra para cambiarlo: se aplica al soltar.
              </>
            }
            lado="abajo"
          >
          <label className="flex items-center gap-2 rounded-lg border border-panel-border bg-panel-2 px-2.5 py-1.5 text-muted">
            <Gauge className="size-3.5 text-brand" />
            <span className="hidden xl:inline">Autonomía IA</span>
            <span className="xl:hidden">IA</span>
            <span className="text-subtle">≤</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={umbral}
              onChange={(e) => setBorrador(Number(e.target.value))}
              onPointerUp={soltar}
              onKeyUp={soltar}
              onBlur={soltar}
              className="w-20 accent-brand"
              aria-label="Umbral de autonomía"
            />
            <span className="w-6 text-right font-mono text-foreground">{umbral}</span>
          </label>
          </Tooltip>
        ) : (
          <Tooltip
            titulo="Umbral de autonomía de la IA"
            contenido={
              <>
                Las decisiones con riesgo <strong>≤ {estado.umbralAutonomia}</strong> se ejecutan sin firma humana. Solo la
                Dirección del Plan puede cambiarlo.
              </>
            }
            lado="abajo"
          >
            <span className="flex items-center gap-2 rounded-lg border border-panel-border bg-panel-2 px-2.5 py-1.5 text-muted">
              <Gauge className="size-3.5 text-brand" />
              <span className="hidden xl:inline">Autonomía IA</span>
              <span className="xl:hidden">IA</span>
              <span className="text-subtle">≤</span>
              <span className="font-mono text-foreground">{estado.umbralAutonomia}</span>
            </span>
          </Tooltip>
        )}

        {/* Servicios de la plataforma: qué integraciones de la spec están conectadas de verdad */}
        <Menu
          etiqueta="Servicios conectados"
          boton={() => (
            <>
              <Plug className="size-3.5 text-muted" />
              <span className="text-muted">
                Servicios <span className="font-mono text-foreground">{conectados}</span>
                <span className="text-subtle">/{servicios.length}</span>
              </span>
              <Tooltip titulo={con.texto} contenido={con.ayuda} lado="abajo">
                <span className={con.cls}>
                  <span className="relative flex size-1.5">
                    {conexion === "en_vivo" && (
                      <span className={`absolute inline-flex size-full animate-ping rounded-full ${con.color} opacity-75`} />
                    )}
                    <span className={`relative inline-flex size-1.5 rounded-full ${con.color}`} />
                  </span>
                  {con.texto}
                </span>
              </Tooltip>
              <ChevronDown className="size-3 text-subtle" />
            </>
          )}
        >
          {() => (
            <div className="text-xs">
              <p className="etiqueta px-2 pb-1.5 pt-1">Integraciones · {modoDatosTexto(estado.modoDatos).toLowerCase()}</p>
              <ul>
                {servicios.map((sv) => (
                  <li key={sv.nombre} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5">
                    <span
                      className={`mt-1 size-2 shrink-0 rounded-full ${sv.activo ? "bg-success" : "bg-subtle"}`}
                      aria-label={sv.activo ? "conectado" : "no conectado"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{sv.nombre}</span>
                        <span className={`text-[10px] ${sv.activo ? "text-success" : "text-subtle"}`}>{sv.estado}</span>
                      </span>
                      <span className="block text-[11px] leading-snug text-muted">{sv.funcion}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 border-t border-panel-border px-2 pb-1 pt-2 text-[10px] leading-snug text-subtle">
                Lo que no está conectado aparece como «sin proveedor» y la acción correspondiente falla de forma visible.
              </p>
            </div>
          )}
        </Menu>

        {/* Simulación (controles de demo, fuera de la vista principal) */}
        {controlaSimulacion && (
        <Menu
          etiqueta="Simulación"
          boton={() => (
            <>
              <FlaskConical className="size-3.5 text-muted" />
              <span className="text-muted">Simulación</span>
              {estado.autoAvance && (
                <Tooltip contenido={`El escenario avanza solo cada ${estado.intervaloSeg} s.`} titulo="Avance automático activo" lado="abajo">
                  <span className="size-1.5 rounded-full bg-success" />
                </Tooltip>
              )}
              <ChevronDown className="size-3 text-subtle" />
            </>
          )}
        >
          {(cerrar) => (
            <div className="text-xs">
              <p className="etiqueta px-2 pb-1.5 pt-1">Escenario · tick {incidente.tick}</p>
              <button
                role="menuitem"
                onClick={() => onAutoAvance(!estado.autoAvance)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-panel-2"
              >
                {estado.autoAvance ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                <span className="flex-1">{estado.autoAvance ? "Pausar avance automático" : "Reanudar avance automático"}</span>
                <span className="font-mono text-subtle">{estado.intervaloSeg}s</span>
              </button>
              <button
                role="menuitem"
                onClick={onTick}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-panel-2"
              >
                <SkipForward className="size-3.5" />
                <span className="flex-1">Avanzar un paso</span>
                <span className="font-mono text-subtle">tick {incidente.tick + 1}</span>
              </button>
              <div className="my-1 h-px bg-panel-border" />
              {confirmarReset ? (
                <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/8 px-2 py-1.5">
                  <span className="flex-1 leading-snug text-danger">¿Reiniciar el escenario desde cero?</span>
                  <button
                    onClick={() => {
                      setConfirmarReset(false);
                      cerrar();
                      onReset();
                    }}
                    className="boton boton-peligro boton-sm"
                  >
                    Reiniciar
                  </button>
                  <button onClick={() => setConfirmarReset(false)} className="boton boton-fantasma boton-sm">
                    No
                  </button>
                </div>
              ) : (
                <button
                  role="menuitem"
                  onClick={() => setConfirmarReset(true)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-muted hover:bg-panel-2 hover:text-danger"
                >
                  <RotateCcw className="size-3.5" />
                  Reiniciar escenario
                </button>
              )}
            </div>
          )}
        </Menu>
        )}

        <div className="hidden h-7 w-px bg-panel-border md:block" aria-hidden />

        <BotonGuia />
        <SelectorTema />

        {/* Organismo + perfil activo */}
        <Menu
          etiqueta="Perfil"
          boton={() => (
            <>
              <span className="hidden text-right leading-tight md:block">
                <span className="block text-[11px] font-medium text-foreground">{def.nombre}</span>
                <span className="block text-[10px] text-subtle">{estado.organismo.servicio} · demo</span>
              </span>
              <span className="flex size-8 items-center justify-center rounded-full border border-brand/30 bg-brand/10 font-mono text-[11px] font-semibold text-brand">
                {def.iniciales}
              </span>
              <ChevronDown className="size-3 text-subtle" />
            </>
          )}
        >
          {(cerrar) => (
            <div className="text-xs">
              <div className="flex items-start gap-2.5 px-2 pb-2 pt-1">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-brand/30 bg-brand/10 font-mono text-xs font-semibold text-brand">
                  {def.iniciales}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{def.nombre}</p>
                  <p className="text-[11px] leading-snug text-muted">{def.cargoReal}</p>
                  <p className="etiqueta mt-1">{AMBITO_ETIQUETA[def.ambito]}</p>
                </div>
              </div>
              <p className="mx-2 mb-2 rounded-lg border border-panel-border bg-panel-2 px-2.5 py-2 text-[11px] leading-snug text-muted">
                {def.descripcion}
                <span className="mt-1.5 block text-foreground">
                  {limite > 0 ? (
                    <>
                      Firma decisiones hasta riesgo <span className="font-mono">{limite}</span>
                    </>
                  ) : (
                    "No firma decisiones: consulta y escala"
                  )}
                </span>
              </p>
              <p className="px-2 pb-2 text-[10.5px] leading-snug text-subtle">Base: {def.base}</p>
              <div className="my-1 h-px bg-panel-border" />
              <p className="px-2 pb-1 pt-1.5 text-[11px] leading-snug text-muted">
                <span className="block font-medium text-foreground">{estado.organismo.nombre}</span>
                {estado.organismo.servicio} · entorno de demostración
              </p>
              <Link
                href="/acceso"
                onClick={cerrar}
                role="menuitem"
                className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left font-medium text-brand hover:bg-panel-2"
              >
                <UserRound className="size-3.5" /> Cambiar de perfil
              </Link>
            </div>
          )}
        </Menu>
      </div>
    </header>
  );
}
