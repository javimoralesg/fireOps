"use client";
// Insignia (badge) con color + TEXTO: el color nunca es la única señal.
// DUEÑO: constructor E. Incluye ayudantes para los enumerados del dominio.

import type { ReactNode } from "react";
import type { EstadoIncendio, ModoCompetencia, NivelPeligro, RiesgoPoblacion, EstadoUnidad, EstadoDecision } from "@/lib/dominio/tipos";

export type TonoInsignia = "neutro" | "peligro" | "aviso" | "exito" | "info" | "marca" | "fuego";

export interface InsigniaProps {
  tono?: TonoInsignia;
  /** Punto de color a la izquierda (para estados vivos). */
  punto?: boolean;
  /** Versión compacta. */
  pequena?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}

const TONOS: Record<TonoInsignia, string> = {
  neutro: "border-panel-border-strong bg-panel-2 text-muted",
  peligro: "border-danger/45 bg-danger/12 text-danger",
  aviso: "border-warning/45 bg-warning/12 text-warning",
  exito: "border-success/45 bg-success/12 text-success",
  info: "border-info/45 bg-info/12 text-info",
  marca: "border-brand/45 bg-brand/12 text-brand",
  fuego: "border-fuego/45 bg-fuego/12 text-fuego",
};

const PUNTOS: Record<TonoInsignia, string> = {
  neutro: "bg-muted",
  peligro: "bg-danger",
  aviso: "bg-warning",
  exito: "bg-success",
  info: "bg-info",
  marca: "bg-brand",
  fuego: "bg-fuego",
};

export function Insignia({ tono = "neutro", punto = false, pequena = false, title, className = "", children }: InsigniaProps) {
  return (
    <span
      title={title}
      className={[
        "inline-flex max-w-full items-center gap-1.5 rounded-full border font-medium",
        pequena ? "px-1.5 py-0.5 text-[10.5px]" : "px-2 py-0.5 text-[11.5px]",
        TONOS[tono],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {punto ? <span className={`size-1.5 shrink-0 rounded-full ${PUNTOS[tono]}`} aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

// --- Traducciones y tonos de los enumerados del dominio ---------------------

export const TEXTO_ESTADO_INCENDIO: Record<EstadoIncendio, string> = {
  detectado: "Detectado",
  confirmado: "Confirmado",
  activo: "Activo",
  estabilizado: "Estabilizado",
  controlado: "Controlado",
  extinguido: "Extinguido",
  descartado: "Descartado",
  fusionado: "Fusionado",
};

export function tonoEstadoIncendio(e: EstadoIncendio): TonoInsignia {
  if (e === "activo") return "peligro";
  if (e === "confirmado") return "fuego";
  if (e === "detectado") return "aviso";
  if (e === "estabilizado") return "info";
  if (e === "controlado" || e === "extinguido") return "exito";
  return "neutro";
}

export const TEXTO_PELIGRO: Record<NivelPeligro, string> = {
  bajo: "Peligro bajo",
  moderado: "Peligro moderado",
  alto: "Peligro alto",
  muy_alto: "Peligro muy alto",
  extremo: "Peligro extremo",
};

export function tonoPeligro(n: NivelPeligro): TonoInsignia {
  if (n === "extremo" || n === "muy_alto") return "peligro";
  if (n === "alto") return "aviso";
  if (n === "moderado") return "info";
  return "exito";
}

export const TEXTO_RIESGO: Record<RiesgoPoblacion, string> = {
  bajo: "Riesgo bajo",
  medio: "Riesgo medio",
  alto: "Riesgo alto",
  inminente: "Riesgo inminente",
};

export function tonoRiesgo(r: RiesgoPoblacion): TonoInsignia {
  if (r === "inminente") return "peligro";
  if (r === "alto") return "aviso";
  if (r === "medio") return "info";
  return "exito";
}

export const TEXTO_COMPETENCIA: Record<ModoCompetencia, string> = {
  autonoma: "Autónoma",
  supervisada: "Supervisada",
  humano: "Decide el humano",
};

export function tonoCompetencia(c: ModoCompetencia): TonoInsignia {
  if (c === "humano") return "peligro";
  if (c === "supervisada") return "aviso";
  return "exito";
}

export const TEXTO_ESTADO_UNIDAD: Record<EstadoUnidad, string> = {
  disponible: "Disponible",
  asignada: "Asignada",
  en_ruta: "En ruta",
  en_intervencion: "En intervención",
  regreso: "De regreso",
  fuera_servicio: "Fuera de servicio",
};

export function tonoEstadoUnidad(e: EstadoUnidad): TonoInsignia {
  if (e === "en_intervencion") return "peligro";
  if (e === "en_ruta") return "aviso";
  if (e === "asignada") return "info";
  if (e === "disponible") return "exito";
  return "neutro";
}

export const TEXTO_ESTADO_DECISION: Record<EstadoDecision, string> = {
  propuesta: "Propuesta",
  pendiente_humano: "Requiere tu decisión",
  aprobada: "Aprobada",
  denegada: "Denegada",
  ejecutando: "Ejecutando",
  ejecutada: "Ejecutada",
  fallida: "Fallida",
  escalada: "Escalada",
  caducada: "Caducada",
};

export function tonoEstadoDecision(e: EstadoDecision): TonoInsignia {
  if (e === "pendiente_humano" || e === "escalada") return "aviso";
  if (e === "fallida" || e === "denegada") return "peligro";
  if (e === "ejecutada" || e === "aprobada") return "exito";
  if (e === "ejecutando") return "info";
  return "neutro";
}

export function tonoPrioridad(p: number): TonoInsignia {
  if (p <= 1) return "peligro";
  if (p === 2) return "aviso";
  if (p === 3) return "info";
  return "neutro";
}
