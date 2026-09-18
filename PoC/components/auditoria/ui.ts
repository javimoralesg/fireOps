// Vocabulario visual de la vista de supervisión de la IA (/auditoria).
// Propio de components/auditoria para no depender de archivos que otras sesiones editan.

import {
  Activity,
  Ban,
  Bot,
  Car,
  Cctv,
  FileText,
  Landmark,
  CircleCheck,
  CircleX,
  Clapperboard,
  CloudFog,
  CloudRain,
  Cog,
  Hourglass,
  LoaderCircle,
  Map as MapIcon,
  Mail,
  MessageSquare,
  Network,
  Newspaper,
  PhoneCall,
  ScanEye,
  Scale,
  Search,
  Smartphone,
  Ticket,
  User,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { CanalAccion, Decision, EstadoDecision, Urgencia } from "@/lib/tipos-sistema";
import { normalizarRol, ROLES } from "@/lib/roles";

export const URGENCIA_UI: Record<Urgencia, { etiqueta: string; badge: string; franja: string }> = {
  critica: { etiqueta: "Crítica", badge: "border-danger/40 bg-danger/10 text-danger", franja: "bg-danger" },
  alta: { etiqueta: "Alta", badge: "border-warning/40 bg-warning/10 text-warning", franja: "bg-warning" },
  media: { etiqueta: "Media", badge: "border-info/40 bg-info/10 text-info", franja: "bg-info" },
  baja: { etiqueta: "Baja", badge: "border-panel-border-strong bg-panel-2 text-muted", franja: "bg-subtle" },
};

export const ESTADO_UI: Record<EstadoDecision, { etiqueta: string; corta: string; icono: LucideIcon; color: string; chip: string }> = {
  pendiente: { etiqueta: "Pendiente de firma", corta: "Pendiente", icono: Hourglass, color: "text-warning", chip: "border-warning/40 bg-warning/10 text-warning" },
  ejecutando: { etiqueta: "Ejecutando", corta: "Ejecutando", icono: LoaderCircle, color: "text-info", chip: "border-info/40 bg-info/10 text-info" },
  ejecutada: { etiqueta: "Aprobada y ejecutada", corta: "Ejecutada", icono: CircleCheck, color: "text-success", chip: "border-success/40 bg-success/10 text-success" },
  auto: { etiqueta: "Ejecutada por la IA (autónoma)", corta: "Autónoma", icono: Bot, color: "text-accent", chip: "border-accent/40 bg-accent/10 text-accent" },
  denegada: { etiqueta: "Denegada", corta: "Denegada", icono: CircleX, color: "text-danger", chip: "border-danger/40 bg-danger/10 text-danger" },
  invalidada: { etiqueta: "Invalidada por cambio de escenario", corta: "Invalidada", icono: Ban, color: "text-muted", chip: "border-panel-border-strong bg-panel-2 text-muted" },
};

export const FUENTE_UI: Record<string, { etiqueta: string; icono: LucideIcon }> = {
  MadridTrafico: { etiqueta: "Madrid Tráfico", icono: Car },
  OpenMeteo: { etiqueta: "Open-Meteo", icono: Wind },
  OpenMeteoAire: { etiqueta: "Open-Meteo Aire", icono: CloudFog },
  REE: { etiqueta: "Red Eléctrica", icono: Zap },
  IGN: { etiqueta: "IGN Sismología", icono: Activity },
  AEMET: { etiqueta: "AEMET", icono: CloudRain },
  HappyRobot: { etiqueta: "HappyRobot voz", icono: PhoneCall },
  Ciudadano: { etiqueta: "Ciudadano", icono: User },
  FalAI: { etiqueta: "fal.ai visión", icono: ScanEye },
  Exa: { etiqueta: "Exa búsqueda", icono: Search },
  Grafo: { etiqueta: "Grafo de dependencias", icono: Network },
  QuiverAI: { etiqueta: "QuiverAI documentos", icono: FileText },
  Periferico: { etiqueta: "Dispositivo periférico", icono: Smartphone },
  CamaraTrafico: { etiqueta: "Cámara de tráfico", icono: Cctv },
  OSM: { etiqueta: "OpenStreetMap", icono: MapIcon },
  Prensa: { etiqueta: "Prensa (Google Noticias)", icono: Newspaper },
  Normativa: { etiqueta: "Normativa BOE", icono: Scale },
  Organismo: { etiqueta: "Aviso de organismo oficial", icono: Landmark },
  Escenario: { etiqueta: "Guion de la demo", icono: Clapperboard },
};

export function fuenteUI(fuente: string) {
  return FUENTE_UI[fuente] ?? { etiqueta: fuente, icono: Search };
}

export const CANAL_UI: Record<CanalAccion, { etiqueta: string; icono: LucideIcon }> = {
  sms: { etiqueta: "SMS", icono: MessageSquare },
  voz: { etiqueta: "Llamada", icono: PhoneCall },
  email: { etiqueta: "Email", icono: Mail },
  ticket: { etiqueta: "Ticket", icono: Ticket },
  interno: { etiqueta: "Interno", icono: Cog },
};

const FOCOS: Record<string, string> = {
  despliegue_inicial: "Despliegue inicial",
  corte_m30: "Corte de la M-30",
  hospital: "Hospital",
  evacuacion: "Evacuación",
  replanificacion_viento: "Replanificación por viento",
  comunicado: "Comunicado a la población",
};

export function focoUI(foco: string): string {
  if (FOCOS[foco]) return FOCOS[foco];
  const t = foco.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const TAREA_UI: Record<string, string> = {
  plan: "Plan",
  clasificacion: "Clasificación",
  extraccion_entidades: "Extracción de entidades",
  vision: "Visión",
  verificacion: "Verificación",
};

/** Modelo que generó el plan de la decisión (tarea "plan"), o el primero registrado. */
export function modeloDe(d: Decision): string | null {
  const p = d.procesadoPor ?? [];
  return (p.find((x) => x.tarea === "plan") ?? p[0])?.modelo ?? null;
}

export function nombreRol(rol: string | undefined): string {
  if (!rol) return "—";
  return ROLES[normalizarRol(rol)]?.nombre ?? rol;
}

export function riesgoColor(r: number) {
  if (r >= 75) return "bg-danger";
  if (r >= 50) return "bg-warning";
  return "bg-info";
}

export function riesgoTexto(r: number) {
  if (r >= 75) return "text-danger";
  if (r >= 50) return "text-warning";
  return "text-info";
}

export function confianzaColor(c: number) {
  if (c >= 0.8) return "bg-success";
  if (c >= 0.5) return "bg-warning";
  return "bg-danger";
}

export function formatearHora(ts: string | undefined, conSegundos = true): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", ...(conSegundos ? { second: "2-digit" } : {}) });
  }
  const m = ts.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/);
  return m ? m[0] : ts;
}

export function formatearValor(v: string | number | undefined, unidad?: string): string {
  if (v === undefined || v === null || v === "") return "—";
  const base = typeof v === "number" ? v.toLocaleString("es-ES", { maximumFractionDigits: 2 }) : v;
  return unidad ? `${base} ${unidad}` : String(base);
}

/** Aprobada por un humano (no autónoma). */
export function esAprobada(d: Decision) {
  return (d.estado === "ejecutada" || d.estado === "ejecutando") && !!d.decididaPor;
}
