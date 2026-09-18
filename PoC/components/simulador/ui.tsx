"use client";

// Piezas comunes del panel Simulador: formatos, errores (403 incluido), reloj y
// chips de tipo, veracidad e impacto. Recetas de docs/identidad.md.

import { useEffect, useState } from "react";
import { Lock, TriangleAlert } from "lucide-react";
import { ErrorApi } from "@/lib/api-cliente";
import { ROLES, type RolId } from "@/lib/roles";
import { Tooltip } from "@/components/ui/Tooltip";
import { tinte, uiImpacto, uiTipo, VERACIDAD_UI } from "./catalogo";
import type { Veracidad } from "./tipos";

/* ---------------------------------------------------------------- formatos */

export function hora(ts: string | undefined, segundos = true): string {
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

/** 45 → "45 s" · 360 → "6 min" · 4500 → "1 h 15 min". */
export function duracion(seg: number | undefined): string {
  if (seg === undefined || !Number.isFinite(seg)) return "—";
  const s = Math.max(0, Math.round(seg));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

/** Diacríticos combinantes (U+0300–U+036F) sin escribir escapes en el fuente. */
const DIACRITICOS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

/** "Méndez Álvaro" → "mendez alvaro", para buscar sin tildes. */
export const sinTildes = (s: string) => s.normalize("NFD").replace(DIACRITICOS, "").toLowerCase();

/** 75 → "01:15". */
export function mmss(seg: number): string {
  const s = Math.max(0, Math.round(seg));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ errores */

export const AVISO_SIN_PERMISO = "Solo Dirección del Plan o Administración pueden lanzar simulacros";
export const AVISO_PROCESANDO =
  "El servidor está procesando un evento de la reproducción en curso. Espera a que termine (unos segundos): relanzar ahora duplicaría eventos.";

/** Texto legible de un error de la API; el 403 dice a quién escalar. */
export function mensajeError(e: unknown): string {
  if (e instanceof ErrorApi) {
    if (e.status === 403) {
      const a = e.escalarA && e.escalarA in ROLES ? ROLES[e.escalarA as RolId].nombre : "Dirección del Plan";
      return `Sin permiso (403): ${e.message}. Pídeselo a ${a}.`;
    }
    return `Error ${e.status}: ${e.message}`;
  }
  return e instanceof Error ? e.message : "No se pudo completar la acción";
}

export function ErrorInline({ mensaje, className = "" }: { mensaje: string | null | undefined; className?: string }) {
  if (!mensaje) return null;
  return (
    <p role="alert" className={`flex items-start gap-1.5 text-[11px] leading-snug text-danger ${className}`}>
      <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{mensaje}</span>
    </p>
  );
}

export function AvisoSoloLectura() {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-[10px] border px-3 py-2 text-xs leading-snug"
      style={tinte("--warning")}
    >
      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <b className="font-semibold">{AVISO_SIN_PERMISO}.</b>{" "}
        <span className="text-muted">Puedes ver los escenarios, los eventos y sus resultados, pero no lanzar nada.</span>
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------- reloj */

/** Marca de tiempo local que se refresca cada segundo mientras `activo`. */
export function useReloj(activo: boolean): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!activo) return;
    const id = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [activo]);
  return ahora;
}

/* -------------------------------------------------------------------- chips */

/** Tipo de emergencia: icono tintado + nombre (el color nunca va solo). */
export function ChipTipo({ tipo, className = "" }: { tipo: string; className?: string }) {
  const ui = uiTipo(tipo);
  const Icono = ui.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-semibold leading-4 text-foreground ${className}`}
      style={tinte(ui.color, true)}
    >
      <Icono className="size-3" style={{ color: `var(${ui.color})` }} aria-hidden />
      {ui.etiqueta}
    </span>
  );
}

/** Cuadrado con el icono del tipo, para tarjetas. */
export function IconoTipo({ tipo, className = "size-9" }: { tipo: string; className?: string }) {
  const ui = uiTipo(tipo);
  const Icono = ui.icon;
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-[10px] border ${className}`}
      style={tinte(ui.color)}
      aria-hidden
    >
      <Icono className="size-[18px]" />
    </span>
  );
}

export function PildoraVeracidad({ veracidad, motivo, ocultarReal = false }: { veracidad: Veracidad; motivo?: string; ocultarReal?: boolean }) {
  if (ocultarReal && veracidad === "real") return null;
  const ui = VERACIDAD_UI[veracidad];
  const Icono = ui.icon;
  return (
    <Tooltip
      titulo={`Verdad de campo: ${ui.etiqueta.toLowerCase()}`}
      contenido={
        <>
          {ui.ayuda}
          {motivo && (
            <>
              <br />
              <b>Motivo:</b> {motivo}
            </>
          )}
        </>
      }
    >
      <span className={`pildora ${ui.clase}`} tabIndex={0}>
        <Icono className="size-3" aria-hidden />
        {ui.etiqueta}
      </span>
    </Tooltip>
  );
}

export function PildoraImpacto({ impacto, error }: { impacto: string; error?: string }) {
  const ui = uiImpacto(impacto, Boolean(error) || impacto === "error");
  const Icono = ui.icon;
  return (
    <Tooltip titulo={`Impacto: ${ui.etiqueta}`} contenido={ui.ayuda}>
      <span className={`pildora ${ui.clase}`} tabIndex={0}>
        <Icono className="size-3" aria-hidden />
        {ui.etiqueta}
      </span>
    </Tooltip>
  );
}
