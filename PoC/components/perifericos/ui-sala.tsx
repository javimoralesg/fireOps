"use client";

// Piezas comunes de la sala de periféricos (poc-07 · subagente D).
// Colores solo con tokens de app/globals.css y recetas de identidad (.pildora,
// .chip, .boton, .superficie). Todo mapeo por categoría/tipo lleva fallback:
// lib/tipos-perifericos.ts sigue creciendo y la UI no puede quedarse en blanco.

import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import {
  Camera,
  Cctv,
  CircleHelp,
  CloudFog,
  Copy,
  Cpu,
  Droplets,
  Flame,
  LoaderCircle,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Smartphone,
  TriangleAlert,
  Truck,
  Users,
  Webhook,
  Zap,
} from "lucide-react";
import type { CategoriaObservacion, Periferico, TipoPeriferico } from "@/lib/tipos-perifericos";
import type { Verificacion } from "@/lib/types";

export type Icono = typeof CircleHelp;

/* ------------------------------------------------------------------ tiempo */

const cero = () => 0;

/**
 * Reloj compartido que avanza a saltos de `intervaloMs` (el valor está cuantizado,
 * así que getSnapshot es estable y no hay bucle de render). Se lee por suscripción
 * en vez de con setState dentro de un efecto, y en servidor vale 0 para que la
 * hidratación coincida.
 */
export function useReloj(intervaloMs: number): number {
  const suscribir = useCallback(
    (avisar: () => void) => {
      const id = setInterval(avisar, intervaloMs);
      return () => clearInterval(id);
    },
    [intervaloMs],
  );
  const leer = useCallback(() => Math.floor(Date.now() / intervaloMs) * intervaloMs, [intervaloMs]);
  return useSyncExternalStore(suscribir, leer, cero);
}

/** Hora local de Madrid, tolerante a timestamps raros (devuelve el texto original si no se puede leer). */
export function hora(ts: string | undefined | null, segundos = false): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    ...(segundos ? { second: "2-digit" as const } : {}),
    timeZone: "Europe/Madrid",
  });
}

/** "hace 12 s" / "hace 4 min". Para el último latido. */
export function hace(ts: string | undefined | null): string {
  if (!ts) return "—";
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return ts;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `hace ${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.floor(min / 60)} h`;
}

/* -------------------------------------------------------------- periférico */

export const PERIFERICO_UI: Record<TipoPeriferico, { icon: Icono; etiqueta: string }> = {
  movil_ciudadano: { icon: Smartphone, etiqueta: "Móvil ciudadano" },
  camara_fija: { icon: Camera, etiqueta: "Cámara fija" },
  efectivo: { icon: Siren, etiqueta: "Efectivo" },
  pma: { icon: Truck, etiqueta: "Puesto de mando" },
  camara_trafico: { icon: Cctv, etiqueta: "Cámara de tráfico" },
  sensor: { icon: Cpu, etiqueta: "Sensor" },
  webhook: { icon: Webhook, etiqueta: "Webhook" },
};

export const PERIFERICO_DESCONOCIDO = { icon: Radio, etiqueta: "Periférico" };

export const uiPeriferico = (tipo: string) =>
  PERIFERICO_UI[tipo as TipoPeriferico] ?? PERIFERICO_DESCONOCIDO;

/* --------------------------------------------------------------- categoría */

interface CategoriaUI {
  etiqueta: string;
  /** Token de color sin prefijo: se usa como text-<tono> / bg-<tono>/10. */
  tono: "danger" | "warning" | "info" | "success" | "muted";
  icon: Icono;
}

/** Categorías conocidas hoy. Cualquier otra cae en CATEGORIA_DESCONOCIDA. */
export const CATEGORIA_UI: Record<string, CategoriaUI> = {
  incendio: { etiqueta: "Incendio", tono: "danger", icon: Flame },
  explosion: { etiqueta: "Explosión", tono: "danger", icon: Flame },
  humo: { etiqueta: "Humo", tono: "warning", icon: CloudFog },
  fuga_gas: { etiqueta: "Fuga de gas", tono: "danger", icon: CloudFog },
  inundacion: { etiqueta: "Inundación", tono: "info", icon: Droplets },
  vertido: { etiqueta: "Vertido", tono: "warning", icon: Droplets },
  accidente: { etiqueta: "Accidente", tono: "warning", icon: TriangleAlert },
  accidente_ferroviario: { etiqueta: "Accidente ferroviario", tono: "danger", icon: TriangleAlert },
  derrumbe: { etiqueta: "Derrumbe", tono: "danger", icon: TriangleAlert },
  terremoto: { etiqueta: "Terremoto", tono: "danger", icon: TriangleAlert },
  amenaza: { etiqueta: "Amenaza", tono: "danger", icon: ShieldAlert },
  aglomeracion: { etiqueta: "Aglomeración", tono: "warning", icon: Users },
  persona_en_peligro: { etiqueta: "Persona en peligro", tono: "danger", icon: Users },
  corte_electrico: { etiqueta: "Corte eléctrico", tono: "warning", icon: Zap },
  ola_calor: { etiqueta: "Ola de calor", tono: "warning", icon: Flame },
  nevada: { etiqueta: "Nevada", tono: "info", icon: CloudFog },
  sin_novedad: { etiqueta: "Sin novedad", tono: "success", icon: ShieldCheck },
  otro: { etiqueta: "Otro", tono: "muted", icon: CircleHelp },
};

export const CATEGORIA_DESCONOCIDA: CategoriaUI = { etiqueta: "Sin clasificar", tono: "muted", icon: CircleHelp };

export function uiCategoria(categoria: CategoriaObservacion | string | undefined): CategoriaUI {
  if (!categoria) return CATEGORIA_DESCONOCIDA;
  return CATEGORIA_UI[categoria] ?? { ...CATEGORIA_DESCONOCIDA, etiqueta: categoria.replace(/_/g, " ") };
}

const CLASE_TONO: Record<CategoriaUI["tono"], string> = {
  danger: "text-danger bg-danger/10 border-danger/25",
  warning: "text-warning bg-warning/10 border-warning/25",
  info: "text-info bg-info/10 border-info/25",
  success: "text-success bg-success/10 border-success/25",
  muted: "text-muted bg-panel-2 border-panel-border",
};

/** Chip de categoría con icono (el color nunca es el único canal). */
export function ChipCategoria({ categoria, className = "" }: { categoria?: string; className?: string }) {
  const ui = uiCategoria(categoria);
  const Icono = ui.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-semibold leading-4 ${CLASE_TONO[ui.tono]} ${className}`}
    >
      <Icono className="size-3" aria-hidden />
      {ui.etiqueta}
    </span>
  );
}

/* ------------------------------------------------------------ verificación */

export const VERIFICACION_UI: Record<Verificacion["estado"], { icon: Icono; cls: string; etiqueta: string; spin?: boolean }> = {
  verificado: { icon: ShieldCheck, cls: "pildora-exito", etiqueta: "Verificado" },
  duplicado: { icon: Copy, cls: "", etiqueta: "Duplicado" },
  sospechoso: { icon: ShieldAlert, cls: "pildora-peligro", etiqueta: "Sospechoso" },
  pendiente: { icon: LoaderCircle, cls: "pildora-aviso", etiqueta: "Verificando", spin: true },
};

export function ChipVerificacion({ verificacion }: { verificacion?: Verificacion }) {
  if (!verificacion) return null;
  const ui = VERIFICACION_UI[verificacion.estado] ?? VERIFICACION_UI.pendiente;
  const Icono = ui.icon;
  return (
    <span className={`pildora ${ui.cls}`}>
      <Icono className={`size-3 ${ui.spin ? "animate-spin" : ""}`} aria-hidden />
      {ui.etiqueta}
    </span>
  );
}

/** Marca discreta para los eventos del simulador (etiqueta "simulacro"). */
export function ChipSimulacro() {
  return <span className="pildora text-subtle">simulacro</span>;
}

/** ¿Es un evento del reproductor de escenarios y no un input real? */
export const esSimulacro = (etiquetas: string[] | undefined, titulo?: string) =>
  Boolean(etiquetas?.includes("simulacro") || titulo?.startsWith("[Simulacro]"));

/* ------------------------------------------------------------ estructurales */

interface PanelProps {
  titulo: string;
  icono?: Icono;
  /** Contadores o acciones a la derecha del título. */
  extra?: ReactNode;
  /** Línea fina bajo el título. */
  subtitulo?: ReactNode;
  className?: string;
  /** Clases del cuerpo (por defecto con scroll fino). */
  cuerpoClassName?: string;
  children: ReactNode;
}

/** Panel de la sala: mismo envoltorio que la consola (superficie + borde + fondo). */
export function Panel({ titulo, icono: Icono, extra, subtitulo, className = "", cuerpoClassName = "", children }: PanelProps) {
  return (
    <section className={`superficie flex min-h-0 flex-col overflow-hidden rounded-xl border border-panel-border bg-panel ${className}`}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-panel-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {Icono && <Icono className="size-4 shrink-0 text-brand" aria-hidden />}
          <h2 className="truncate text-[13px] font-bold text-foreground">{titulo}</h2>
        </div>
        {extra && <div className="flex shrink-0 items-center gap-1.5">{extra}</div>}
      </header>
      {subtitulo && <p className="shrink-0 border-b border-panel-border px-3 py-1.5 text-[11px] text-muted">{subtitulo}</p>}
      <div className={`min-h-0 flex-1 overflow-y-auto scroll-thin ${cuerpoClassName}`}>{children}</div>
    </section>
  );
}

/** Aviso en línea: ámbar por defecto, neutro con `tono="neutro"`. */
export function Aviso({ tono = "aviso", children }: { tono?: "aviso" | "neutro" | "peligro"; children: ReactNode }) {
  const cls =
    tono === "peligro"
      ? "border-danger/30 bg-danger/10 text-danger"
      : tono === "neutro"
        ? "border-panel-border bg-panel-2 text-muted"
        : "border-warning/30 bg-warning/10 text-warning";
  return (
    <p className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] leading-snug ${cls}`}>
      <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

interface EstadoRecursoProps {
  cargando: boolean;
  /** El endpoint devolvió 404: lo sirve otra sesión y aún no está. */
  ausente: boolean;
  error: string | null;
  /** Qué falta, en una línea: "el registro de periféricos". */
  que: string;
  /** Ruta del endpoint, para que quien depure sepa dónde mirar. */
  endpoint: string;
  /** Hay datos antiguos en pantalla: el aviso se vuelve discreto. */
  hayDatos?: boolean;
}

/** Aviso discreto de carga / endpoint que todavía no existe / error de red. */
export function EstadoRecurso({ cargando, ausente, error, que, endpoint, hayDatos = false }: EstadoRecursoProps) {
  if (ausente) {
    return (
      <p className="px-3 py-2 text-[11px] text-subtle">
        <span className="font-semibold">Aún no hay {que}</span> · <code className="font-mono">{endpoint}</code> todavía no
        responde (lo sirve otra sesión).
      </p>
    );
  }
  if (error && !hayDatos) {
    return <p className="px-3 py-2 text-[11px] text-danger">No se pudo leer {que}: {error}</p>;
  }
  if (cargando && !hayDatos) {
    return (
      <p className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-muted">
        <LoaderCircle className="size-3 animate-spin" aria-hidden /> Cargando {que}…
      </p>
    );
  }
  return null;
}

/** Barra fina 0..1 (confianza / reputación). */
export function BarraConfianza({ valor, className = "" }: { valor: number; className?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, valor)) * 100);
  const color = pct >= 70 ? "bg-success" : pct >= 40 ? "bg-warning" : "bg-danger";
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className="h-1 w-12 overflow-hidden rounded-full bg-panel-2"
        role="img"
        aria-label={`Confianza ${pct} %`}
      >
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-[10.5px] text-subtle">{pct} %</span>
    </span>
  );
}

/** Punto de estado en línea / fuera de línea. */
export function PuntoEstado({ enLinea }: { enLinea: boolean }) {
  return (
    <span
      className={`size-2 shrink-0 rounded-full ${enLinea ? "bg-success" : "bg-subtle"}`}
      role="img"
      aria-label={enLinea ? "En línea" : "Fuera de línea"}
    />
  );
}

/** Texto del modo de un periférico: "manual" o "vigilancia cada 15 s". */
export const textoModo = (p: Pick<Periferico, "modo" | "intervaloVigilanciaSeg">) =>
  p.modo === "vigilancia" ? `vigilancia cada ${p.intervaloVigilanciaSeg || 15} s` : "manual";

/** Estado vacío centrado dentro de un panel. */
export function Vacio({ children }: { children: ReactNode }) {
  return <p className="px-3 py-6 text-center text-[12px] text-subtle">{children}</p>;
}
