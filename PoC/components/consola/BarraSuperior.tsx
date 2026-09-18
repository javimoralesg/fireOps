"use client";

// Barra superior de la consola simplificada: qué incidente es, en qué fase está,
// cuánto tiempo lleva y si estamos en directo. Los controles de simulación y el
// umbral de autonomía quedan detrás de dos botones discretos.
// Todo cabe en UNA línea: el bloque del incidente se encoge y trunca, y las
// etiquetas de los chips y de los botones solo aparecen cuando hay sitio de
// sobra (≥ 1760 px); por debajo quedan icono + recuento, con tooltip.

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { BookMarked, ChevronDown, FileText, FlaskConical, History, Pause, Play, Radio, RotateCcw, ShieldCheck, SkipForward, Smartphone, Users } from "lucide-react";
import { Logo } from "@/components/marca/Logo";
import { SelectorTema } from "@/components/marca/SelectorTema";
import { BotonGuia } from "@/components/ui/Guia";
import { Tooltip } from "@/components/ui/Tooltip";
import type { Conexion } from "@/lib/useEstado";
import type { EstadoSistema } from "@/lib/tipos-sistema";
import { limiteRiesgo, puede } from "@/lib/permisos";
import { ROLES, type RolId } from "@/lib/roles";
import { pareceCoordenadas, tituloLimpio } from "./texto";

export type Panel = "decisiones" | "doctrina" | "informes" | "voluntarios" | "simulacion" | "perifericos";

const FASE: Record<EstadoSistema["incidente"]["fase"], { texto: string; cls: string; ayuda: string }> = {
  deteccion: { texto: "Detección", cls: "pildora pildora-info", ayuda: "Se está confirmando el incidente con avisos, sensores e imágenes." },
  respuesta: { texto: "Respuesta", cls: "pildora pildora-marca", ayuda: "Incidente confirmado: la IA propone y el mando firma el despliegue." },
  escalada: { texto: "Escalada", cls: "pildora pildora-peligro", ayuda: "La situación empeora: decisiones de mayor riesgo." },
  estabilizacion: { texto: "Estabilización", cls: "pildora pildora-aviso", ayuda: "La situación está contenida; se consolidan acciones y avisos." },
  cierre: { texto: "Cierre", cls: "pildora pildora-exito", ayuda: "Incidente cerrado: se prepara el informe final." },
};

// Estado de la conexión en directo (SSE): píldora con icono de punto, nunca solo color.
const CONEXION: Record<Conexion, { texto: string; cls: string; punto: string; titulo: string; ayuda: string }> = {
  conectando: {
    texto: "Conectando",
    cls: "pildora",
    punto: "bg-subtle",
    titulo: "Conectando con el centro de mando",
    ayuda: "Esperando la primera respuesta del servidor. En cuanto llegue, la consola se actualiza sola.",
  },
  en_vivo: {
    texto: "En directo",
    cls: "pildora pildora-exito",
    punto: "bg-success",
    titulo: "En directo",
    ayuda: "Conexión abierta con el servidor: cada aviso, propuesta o firma llega al instante, sin recargar ni pulsar nada.",
  },
  fixture: {
    texto: "Sin conexión",
    cls: "pildora pildora-aviso",
    punto: "bg-warning",
    titulo: "Sin conexión con el servidor",
    ayuda: "El servidor no responde: se muestra un estado de ejemplo y las acciones fallarán hasta que vuelva.",
  },
};

function transcurrido(desdeIso: string, ahora: number) {
  const s = Math.max(0, Math.floor((ahora - Date.parse(desdeIso)) / 1000));
  if (!Number.isFinite(s)) return "--:--";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

/** Popover mínimo: se cierra con clic fuera o Escape. */
function Menu({ boton, children, etiqueta }: { boton: ReactNode; children: (cerrar: () => void) => ReactNode; etiqueta: string }) {
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
        className="flex min-h-8 items-center gap-1.5 rounded-lg border border-transparent px-2 py-1.5 text-xs font-medium text-muted transition hover:border-panel-border hover:bg-panel-2 hover:text-foreground aria-expanded:border-panel-border-strong aria-expanded:bg-panel-2 aria-expanded:text-foreground"
      >
        {boton}
      </button>
      {abierto && (
        <div role="menu" className="absolute right-0 top-full z-[1250] mt-1.5 w-72 rounded-xl border border-panel-border bg-panel p-1.5 text-xs shadow-[var(--sombra-flotante)]">
          {children(() => setAbierto(false))}
        </div>
      )}
    </div>
  );
}

interface Props {
  estado: EstadoSistema;
  conexion: Conexion;
  ahora: number;
  rol: RolId;
  panel: Panel | null;
  contadores: Partial<Record<Panel, number>>;
  onPanel: (p: Panel | null) => void;
  onAutoAvance: (activo: boolean) => void;
  onTick: () => void;
  onReset: () => void;
  onUmbral: (umbral: number) => Promise<void>;
}

export function BarraSuperior({ estado, conexion, ahora, rol, panel, contadores, onPanel, onAutoAvance, onTick, onReset, onUmbral }: Props) {
  const { incidente } = estado;
  const fase = FASE[incidente.fase];
  const titulo = tituloLimpio(incidente.titulo);
  // Si el lugar llega como coordenadas en crudo, mejor el municipio que un par de números.
  const lugar = pareceCoordenadas(incidente.ubicacion.nombre) ? estado.organismo.municipio : incidente.ubicacion.nombre;
  const con = CONEXION[conexion];
  const def = ROLES[rol];
  const controlaSimulacion = puede(rol, "controlar_simulacion") || rol === "director_plan";
  const fijaUmbral = puede(rol, "fijar_umbral");
  const limite = limiteRiesgo(rol);

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

  // Cada pestaña dice en su tooltip qué cajón abre (docs/identidad.md §5).
  const PANELES: { id: Panel; etiqueta: string; icono: typeof History; ayuda: string }[] = [
    { id: "decisiones", etiqueta: "Decisiones", icono: History, ayuda: "Abre la lista completa: lo que está pendiente de firma y el historial de lo ya resuelto." },
    { id: "doctrina", etiqueta: "Doctrina", icono: BookMarked, ayuda: "Abre las reglas que la IA ha aprendido de tus correcciones y aplica en cada propuesta." },
    { id: "informes", etiqueta: "Informes", icono: FileText, ayuda: "Abre las actas de decisión, los partes de situación y el informe de cierre." },
    { id: "voluntarios", etiqueta: "Voluntarios", icono: Users, ayuda: "Abre las tareas de bajo riesgo que se pueden ofrecer a la ciudadanía." },
    { id: "perifericos", etiqueta: "Periféricos", icono: Smartphone, ayuda: "Abre los móviles y cámaras emparejados que envían fotos, voz y posición desde el terreno." },
    ...(controlaSimulacion
      ? [{ id: "simulacion" as Panel, etiqueta: "Simulador", icono: Radio, ayuda: "Abre el inyector de avisos y escenarios para ver cómo responde la IA." }]
      : []),
  ];

  return (
    <header className="relative z-[1100] flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-panel-border bg-panel/85 px-4 py-2 backdrop-blur xl:flex-nowrap">
      <Logo vivo descriptor={false} />
      <div className="hidden h-8 w-px shrink-0 bg-panel-border sm:block" aria-hidden />

      {/* Incidente en dos líneas: fase + título arriba; directo · tiempo · lugar abajo.
          Así el bloque necesita menos ancho y los chips de la derecha caben con etiqueta desde 1536 px. */}
      <div className="min-w-[220px] flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Tooltip titulo={`Fase: ${fase.texto}`} contenido={fase.ayuda} lado="abajo">
            <span className={`shrink-0 ${fase.cls}`}>{fase.texto}</span>
          </Tooltip>
          <Tooltip className="min-w-0" titulo={titulo} contenido={`Incidente en ${lugar}. Es el caso sobre el que decide toda la consola.`} lado="abajo">
            <h2 className="truncate text-[14px] font-semibold text-foreground">{titulo}</h2>
          </Tooltip>
        </div>
        <p className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-muted">
          <Tooltip titulo={con.titulo} contenido={con.ayuda} lado="abajo">
            <span className={`shrink-0 ${con.cls}`}>
              <span className="relative flex size-1.5">
                {conexion === "en_vivo" && <span className={`absolute inline-flex size-full animate-ping rounded-full ${con.punto} opacity-75`} aria-hidden />}
                <span className={`relative inline-flex size-1.5 rounded-full ${con.punto}`} aria-hidden />
              </span>
              {con.texto}
            </span>
          </Tooltip>
          <Tooltip titulo="Tiempo de incidente" contenido="Lo que lleva abierto el incidente desde que se detectó, con la hora del servidor." lado="abajo">
            <span className="shrink-0 font-mono text-[12px] text-foreground">{incidente.activo ? transcurrido(incidente.iniciadoEn, ahora) : "Cerrado"}</span>
          </Tooltip>
          <span className="hidden shrink-0 text-subtle md:inline" aria-hidden>
            ·
          </span>
          <span className="hidden min-w-0 truncate md:inline">{lugar}</span>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* Simulación: dos botones, nada más */}
        {controlaSimulacion && incidente.activo && (
          <>
            <Tooltip
              titulo={estado.autoAvance ? "Escenario en marcha" : "Escenario en pausa"}
              contenido={estado.autoAvance ? `Cada ${estado.intervaloSeg} s llegan avisos nuevos y la IA propone.` : "El escenario no avanza hasta que lo reanudes o avances un paso."}
              lado="abajo"
            >
              <button
                type="button"
                onClick={() => onAutoAvance(!estado.autoAvance)}
                className="boton boton-secundario boton-sm"
                aria-pressed={estado.autoAvance}
                aria-label={estado.autoAvance ? "Pausar el escenario" : "Reanudar el escenario"}
              >
                {estado.autoAvance ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                <span className="hidden min-[1760px]:inline">{estado.autoAvance ? "Pausar" : "Reanudar"}</span>
              </button>
            </Tooltip>
            <Tooltip titulo="Avanzar un paso" contenido="Provoca el siguiente giro del escenario sin esperar." lado="abajo">
              <button type="button" onClick={onTick} className="boton boton-fantasma boton-sm" aria-label="Avanzar un paso del escenario">
                <SkipForward className="size-3.5" aria-hidden /> <span className="hidden min-[1760px]:inline">Avanzar</span>
              </button>
            </Tooltip>
          </>
        )}

        <div className="mx-1 hidden h-7 w-px bg-panel-border md:block" aria-hidden />

        {/* Paneles secundarios: pestañas del cajón */}
        <nav className="flex items-center gap-1.5" aria-label="Paneles de la consola">
          {PANELES.map((p) => {
            const Icono = p.icono;
            const n = contadores[p.id] ?? 0;
            const activo = panel === p.id;
            return (
              <Tooltip key={p.id} titulo={p.etiqueta} contenido={p.ayuda} lado="abajo">
                <button
                  type="button"
                  onClick={() => onPanel(activo ? null : p.id)}
                  aria-pressed={activo}
                  aria-current={activo ? "true" : undefined}
                  aria-label={n > 0 ? `${p.etiqueta} (${n})` : p.etiqueta}
                  className="chip min-h-8 px-2"
                >
                  <Icono className="size-3.5" aria-hidden />
                  <span className="hidden min-[1536px]:inline">{p.etiqueta}</span>
                  {n > 0 && <span className="rounded-full bg-panel-border px-1.5 font-mono text-[10px] text-foreground">{n}</span>}
                </button>
              </Tooltip>
            );
          })}
        </nav>

        {/* Ajustes: umbral de autonomía y reinicio */}
        {(fijaUmbral || controlaSimulacion) && (
          <Menu
            etiqueta="Ajustes de la IA y del escenario"
            boton={
              <>
                <FlaskConical className="size-3.5" aria-hidden />
                <span className="hidden min-[1760px]:inline">Ajustes</span>
                <ChevronDown className="size-3 text-subtle" aria-hidden />
              </>
            }
          >
            {(cerrar) => (
              <div>
                <Link href="/politica" onClick={cerrar} role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left font-medium text-brand hover:bg-panel-2">
                  <ShieldCheck className="size-3.5 shrink-0" aria-hidden /> Política de la IA: qué gestiona sola y qué no
                </Link>
                <div className="my-1 h-px bg-panel-border" />
                {fijaUmbral && (
                  <div className="px-2 pb-2 pt-1">
                    <p className="font-medium text-foreground">Autonomía de la IA</p>
                    <p className="mt-0.5 leading-snug text-muted">
                      Ejecuta sola las decisiones con riesgo hasta <span className="font-mono font-semibold text-foreground">{umbral}</span>; el resto esperan firma.
                    </p>
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
                      className="mt-2 w-full accent-brand"
                      aria-label="Umbral de autonomía"
                    />
                    <p className="mt-1 text-[10.5px] leading-snug text-subtle">
                      Tu perfil firma hasta riesgo <span className="font-mono">{limite}</span>.
                    </p>
                  </div>
                )}
                {controlaSimulacion && (
                  <>
                    <div className="my-1 h-px bg-panel-border" />
                    <p className="px-2 pb-1 pt-1 text-[10.5px] text-subtle">
                      Escenario · paso {incidente.tick}
                      {estado.autoAvance ? ` · avanza cada ${estado.intervaloSeg} s` : " · en pausa"}
                    </p>
                    {confirmarReset ? (
                      <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/8 px-2 py-1.5">
                        <span className="flex-1 leading-snug text-danger">¿Empezar de cero?</span>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmarReset(false);
                            cerrar();
                            onReset();
                          }}
                          className="boton boton-peligro boton-sm"
                        >
                          Reiniciar
                        </button>
                        <button type="button" onClick={() => setConfirmarReset(false)} className="boton boton-fantasma boton-sm">
                          No
                        </button>
                      </div>
                    ) : (
                      <button type="button" role="menuitem" onClick={() => setConfirmarReset(true)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-muted hover:bg-panel-2 hover:text-danger">
                        <RotateCcw className="size-3.5 shrink-0" aria-hidden /> Reiniciar escenario
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </Menu>
        )}

        <BotonGuia />
        <SelectorTema />

        {/* Perfil: quién firma ahora mismo */}
        <Tooltip
          titulo={def.nombre}
          contenido={limite > 0 ? `${def.cargoReal}. Firma decisiones hasta riesgo ${limite}. Pulsa para cambiar de perfil.` : `${def.cargoReal}. Consulta y escala; no firma. Pulsa para cambiar de perfil.`}
          lado="abajo"
        >
          <Link href="/acceso" className="flex min-h-8 items-center gap-2 rounded-lg border border-transparent px-2 py-1 transition hover:border-panel-border hover:bg-panel-2">
            <span className="hidden text-right leading-tight lg:block">
              <span className="block text-[11px] font-medium text-foreground">{def.nombre}</span>
              <span className="block text-[10px] text-subtle">{estado.organismo.servicio}</span>
            </span>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-brand/30 bg-brand/10 font-mono text-[11px] font-semibold text-brand">{def.iniciales}</span>
          </Link>
        </Tooltip>
      </div>
    </header>
  );
}
