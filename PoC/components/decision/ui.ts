// Constantes visuales y utilidades compartidas por la cola y el detalle de decisiones.

import {
  Activity,
  Ban,
  BookOpen,
  Bot,
  Car,
  Cctv,
  Clapperboard,
  CircleCheck,
  CircleX,
  CloudFog,
  CloudRain,
  Cog,
  Hourglass,
  LoaderCircle,
  Mail,
  Map,
  MessageSquare,
  Network,
  PhoneCall,
  ScanEye,
  Search,
  Smartphone,
  Ticket,
  User,
  Wind,
  Zap,
  type LucideIcon,
  Landmark,
  Newspaper,
  Scale,
} from "lucide-react";
import type { CanalAccion, Decision, EstadoDecision, FuenteDato, Urgencia } from "@/lib/tipos-sistema";

export const ORDEN_URGENCIA: Record<Urgencia, number> = { critica: 0, alta: 1, media: 2, baja: 3 };

// Urgencia: la píldora la pinta la receta compartida (.pildora) para que el
// tinte sea el mismo en la cola, el detalle y la auditoría. La franja lateral
// sigue siendo un color plano porque es una barra de 4 px, no texto.
export const URGENCIA_UI: Record<Urgencia, { etiqueta: string; badge: string; franja: string }> = {
  critica: { etiqueta: "Crítica", badge: "pildora pildora-peligro", franja: "bg-danger" },
  alta: { etiqueta: "Alta", badge: "pildora pildora-aviso", franja: "bg-warning" },
  media: { etiqueta: "Media", badge: "pildora pildora-marca", franja: "bg-brand" },
  baja: { etiqueta: "Baja", badge: "pildora", franja: "bg-panel-border-strong" },
};

export const ESTADO_UI: Record<EstadoDecision, { etiqueta: string; icono: LucideIcon; color: string; girar?: boolean }> = {
  pendiente: { etiqueta: "Pendiente de firma", icono: Hourglass, color: "text-warning" },
  ejecutando: { etiqueta: "Ejecutando", icono: LoaderCircle, color: "text-brand", girar: true },
  ejecutada: { etiqueta: "Ejecutada", icono: CircleCheck, color: "text-success" },
  auto: { etiqueta: "Automática", icono: Bot, color: "text-success" },
  denegada: { etiqueta: "Denegada", icono: CircleX, color: "text-danger" },
  invalidada: { etiqueta: "Invalidada", icono: Ban, color: "text-warning" },
};

export const PRIORIDAD_UI = {
  alta: "text-danger",
  media: "text-warning",
  baja: "text-muted",
} as const;

export const FUENTE_UI: Record<FuenteDato, { etiqueta: string; icono: LucideIcon }> = {
  MadridTrafico: { etiqueta: "Madrid Tráfico", icono: Car },
  OpenMeteo: { etiqueta: "Open-Meteo", icono: Wind },
  Prensa: { etiqueta: "Prensa (RSS)", icono: Newspaper },
  Normativa: { etiqueta: "Normativa (BOE)", icono: Scale },
  Organismo: { etiqueta: "Aviso oficial", icono: Landmark },
  OpenMeteoAire: { etiqueta: "Open-Meteo Aire", icono: CloudFog },
  REE: { etiqueta: "Red Eléctrica", icono: Zap },
  IGN: { etiqueta: "IGN Sismología", icono: Activity },
  AEMET: { etiqueta: "AEMET", icono: CloudRain },
  HappyRobot: { etiqueta: "HappyRobot voz", icono: PhoneCall },
  Ciudadano: { etiqueta: "Ciudadano", icono: User },
  FalAI: { etiqueta: "fal.ai visión", icono: ScanEye },
  Exa: { etiqueta: "Exa búsqueda", icono: Search },
  Grafo: { etiqueta: "Grafo de dependencias", icono: Network },
  QuiverAI: { etiqueta: "Protocolo (Quiver)", icono: BookOpen },
  Periferico: { etiqueta: "Periférico", icono: Smartphone },
  CamaraTrafico: { etiqueta: "Cámara de tráfico", icono: Cctv },
  OSM: { etiqueta: "OpenStreetMap", icono: Map },
  Escenario: { etiqueta: "Guion de la demo", icono: Clapperboard },
};

export function fuenteUI(fuente: string): { etiqueta: string; icono: LucideIcon } {
  return FUENTE_UI[fuente as FuenteDato] ?? { etiqueta: fuente, icono: Search };
}

export const CANAL_UI: Record<CanalAccion, { etiqueta: string; icono: LucideIcon }> = {
  sms: { etiqueta: "SMS", icono: MessageSquare },
  voz: { etiqueta: "Llamada", icono: PhoneCall },
  email: { etiqueta: "Email", icono: Mail },
  ticket: { etiqueta: "Ticket", icono: Ticket },
  interno: { etiqueta: "Interno", icono: Cog },
};

/** Relleno de las barras de riesgo: ≥ 75 crítico, ≥ 50 en aviso, por debajo marca. */
export function riesgoColor(r: number) {
  if (r >= 75) return "bg-danger";
  if (r >= 50) return "bg-warning";
  return "bg-brand";
}

/**
 * Hora HH:MM:SS tolerante: algunos conectores devuelven fechas sin zona
 * ("2026-09-18T20:45") o en formato local ("18/09/2026 20:50:04").
 * Si no se puede parsear, extrae la hora del texto o lo devuelve tal cual.
 */
export function formatearHora(ts: string | undefined, conSegundos = true): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      ...(conSegundos ? { second: "2-digit" } : {}),
    });
  }
  const m = ts.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/);
  return m ? m[0] : ts;
}

/** Entero con separador de miles español siempre (es-ES no agrupa números de 4 cifras). */
export function miles(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Milisegundos → "mm:ss" (o "h:mm:ss" si pasa de una hora). */
export function formatearDuracion(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

export function msHasta(iso: string, ahora: number): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t - ahora;
}

/** Momento de referencia para ordenar el historial (más reciente primero). */
export function momentoDecision(d: Decision): number {
  const candidatos = [
    d.decididaPor?.timestamp,
    ...(d.resultadoEjecucion ?? []).map((r) => r.timestamp),
    d.creadaEn,
  ]
    .map((t) => (t ? Date.parse(t) : Number.NaN))
    .filter((t) => !Number.isNaN(t));
  return candidatos.length ? Math.max(...candidatos) : 0;
}

export const IDIOMA_UI: Record<string, string> = {
  es: "Español",
  en: "English",
  de: "Deutsch",
  fr: "Français",
  it: "Italiano",
  pt: "Português",
  ar: "العربية",
  zh: "中文",
  ro: "Română",
  uk: "Українська",
};
