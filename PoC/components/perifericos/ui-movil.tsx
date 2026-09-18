"use client";

// Piezas comunes de la pantalla móvil (poc-07, subagente B): botones grandes
// (≥ 48 px), avisos, tarjetas y utilidades de imagen. Todo con los tokens de
// app/globals.css: nada de colores fijos, funciona en tema claro y oscuro.

import type { ReactNode } from "react";
import type { Verificacion } from "@/lib/types";
import type { AnalisisVision, ResultadoIngesta } from "@/lib/tipos-perifericos";

export const LADO_MAX = 1280;
export const CALIDAD_JPEG = 0.72;

/** Entradas de texto a 16 px: por debajo, iOS hace zoom al enfocar. */
export const CLASE_ENTRADA =
  "w-full min-h-[48px] rounded-xl border border-panel-border bg-panel-2 px-3 py-2 text-[16px] text-foreground placeholder:text-subtle focus:border-brand focus:outline-none";

type Tono = "primario" | "secundario" | "peligro" | "exito";

const CLASE_TONO: Record<Tono, string> = {
  primario: "boton-primario",
  secundario: "boton-secundario",
  peligro: "boton-peligro",
  exito: "boton-exito",
};

export function BotonGrande({
  children,
  onClick,
  tono = "primario",
  deshabilitado = false,
  tipoBoton = "button",
  ancho = true,
}: {
  children: ReactNode;
  onClick?: () => void;
  tono?: Tono;
  deshabilitado?: boolean;
  tipoBoton?: "button" | "submit";
  ancho?: boolean;
}) {
  return (
    <button
      type={tipoBoton}
      onClick={onClick}
      disabled={deshabilitado}
      className={`boton ${CLASE_TONO[tono]} min-h-[52px] px-4 text-[15px] ${ancho ? "w-full" : ""}`}
    >
      {children}
    </button>
  );
}

type TonoAviso = "aviso" | "peligro" | "info" | "exito";

const CLASE_AVISO: Record<TonoAviso, string> = {
  aviso: "border-warning/40 bg-warning/10",
  peligro: "border-danger/40 bg-danger/10",
  info: "border-info/40 bg-info/10",
  exito: "border-success/40 bg-success/10",
};

const CLASE_TITULO_AVISO: Record<TonoAviso, string> = {
  aviso: "text-warning",
  peligro: "text-danger",
  info: "text-info",
  exito: "text-success",
};

export function Aviso({ tono = "aviso", titulo, children }: { tono?: TonoAviso; titulo?: string; children: ReactNode }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 text-[13.5px] leading-relaxed ${CLASE_AVISO[tono]}`} role="status">
      {titulo && <p className={`font-semibold ${CLASE_TITULO_AVISO[tono]}`}>{titulo}</p>}
      <div className="text-muted">{children}</div>
    </div>
  );
}

export function Tarjeta({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`superficie rounded-2xl border border-panel-border bg-panel p-4 ${className}`}>{children}</section>;
}

export function Dato({ etiqueta, valor, mono = false }: { etiqueta: string; valor: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-panel-border py-2 last:border-0">
      <span className="text-[13px] text-muted">{etiqueta}</span>
      <span className={`text-right text-[14px] font-semibold text-foreground ${mono ? "font-mono text-[13px]" : ""}`}>{valor}</span>
    </div>
  );
}

const CHIP_VERIFICACION: Record<NonNullable<Verificacion>["estado"], { clase: string; texto: string }> = {
  verificado: { clase: "pildora-exito", texto: "Verificado" },
  sospechoso: { clase: "pildora-peligro", texto: "Sospechoso" },
  duplicado: { clase: "pildora-aviso", texto: "Duplicado" },
  pendiente: { clase: "", texto: "Verificando…" },
};

export function ChipVerificacion({ verificacion }: { verificacion?: Verificacion }) {
  const estado = verificacion?.estado ?? "pendiente";
  const { clase, texto } = CHIP_VERIFICACION[estado];
  return (
    <span className={`pildora ${clase}`} title={verificacion?.motivo}>
      {texto}
    </span>
  );
}

const CLASE_GRAVEDAD: Record<AnalisisVision["gravedad"], string> = {
  critica: "pildora-peligro",
  alta: "pildora-peligro",
  media: "pildora-aviso",
  baja: "pildora-info",
  nula: "",
};

/** Tarjeta con lo que el pipeline contestó a la última observación. */
export function ResumenResultado({ resultado, miniatura }: { resultado: ResultadoIngesta; miniatura?: string | null }) {
  const a = resultado.analisis;
  return (
    <div className="rounded-xl border border-brand/35 bg-brand/8 p-3">
      <p className="etiqueta">Respuesta del sistema</p>
      <div className="mt-2 flex gap-3">
        {miniatura && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={miniatura} alt="Última imagen enviada" className="size-20 shrink-0 rounded-lg border border-panel-border object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {a && <span className="pildora pildora-marca">{a.categoria.replace(/_/g, " ")}</span>}
            {a && <span className="pildora">{porcentaje(a.confianza)} de confianza</span>}
            {a && <span className={`pildora ${CLASE_GRAVEDAD[a.gravedad]}`}>gravedad {a.gravedad}</span>}
          </div>
          <p className="mt-2 text-[13.5px] leading-relaxed text-foreground">{resultado.impacto.motivo}</p>
          {a?.descripcion && <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{a.descripcion}</p>}
          {a?.motor === "ninguno" && <p className="mt-1 text-[12px] text-subtle">Sin claves de visión: la imagen se registró sin analizar.</p>}
        </div>
      </div>
    </div>
  );
}

export function porcentaje(v: number): string {
  return `${Math.round(v * 100)} %`;
}

export function formatearHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function haceSegundos(ms: number | null): string {
  if (ms === null) return "nunca";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`;
}

function escalar(ancho: number, alto: number, ladoMax: number): { ancho: number; alto: number } {
  const lado = Math.max(ancho, alto);
  if (lado <= ladoMax) return { ancho, alto };
  const k = ladoMax / lado;
  return { ancho: Math.round(ancho * k), alto: Math.round(alto * k) };
}

function aBase64(lienzo: HTMLCanvasElement, calidad: number): string {
  return lienzo.toDataURL("image/jpeg", calidad).split(",")[1] ?? "";
}

/** Captura el fotograma actual del vídeo: JPEG base64 sin prefijo + data-URI para la miniatura. */
export function capturarFotograma(
  video: HTMLVideoElement,
  ladoMax = LADO_MAX,
  calidad = CALIDAD_JPEG,
): { base64: string; miniatura: string } | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const { ancho, alto } = escalar(w, h, ladoMax);
  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, ancho, alto);
  const base64 = aBase64(lienzo, calidad);
  return { base64, miniatura: `data:image/jpeg;base64,${base64}` };
}

/** Respaldo sin cámara: <input type="file"> reescalado al mismo formato. */
export async function archivoABase64(
  archivo: File,
  ladoMax = LADO_MAX,
  calidad = CALIDAD_JPEG,
): Promise<{ base64: string; miniatura: string }> {
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    await new Promise<void>((resolver, rechazar) => {
      img.onload = () => resolver();
      img.onerror = () => rechazar(new Error("No se pudo leer la imagen elegida"));
      img.src = url;
    });
    const { ancho, alto } = escalar(img.naturalWidth, img.naturalHeight, ladoMax);
    const lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext("2d");
    if (!ctx) throw new Error("Este navegador no permite procesar la imagen");
    ctx.drawImage(img, 0, 0, ancho, alto);
    const base64 = aBase64(lienzo, calidad);
    return { base64, miniatura: `data:image/jpeg;base64,${base64}` };
  } finally {
    URL.revokeObjectURL(url);
  }
}
