"use client";
// Enlace a una fuente, con UN SOLO estilo en toda la aplicación.
// DUEÑO: constructor N (aditivo sobre components/ui de E).
//
// `EnlaceExterno` abre en pestaña nueva con rel="noopener noreferrer" y lleva
// el icono de enlace externo; si la URL no es abrible NO pinta nada (o pinta
// solo el texto), para que nunca haya un enlace roto en la sala.

import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { dominio, urlSegura } from "@/lib/cliente/enlaces";

/** Estilo único de los enlaces de la sala (mismo en mapa, fichas y auditoría). */
export const CLASE_ENLACE =
  "inline-flex max-w-full items-baseline gap-1 text-brand underline decoration-brand/45 underline-offset-2 hover:decoration-brand focus-visible:decoration-brand";

export interface EnlaceExternoProps {
  href?: string | null;
  children: ReactNode;
  /** Texto del title (si falta, se explica a dónde lleva). */
  titulo?: string;
  className?: string;
  /** Qué pintar si no hay URL utilizable: por defecto, solo el texto. */
  siNoHayUrl?: "texto" | "nada";
  /** Clases del texto cuando NO hay enlace (para que la frase no se descoloque). */
  claseTexto?: string;
  /** Oculta el icono (para enlaces dentro de una frase muy apretada). */
  sinIcono?: boolean;
}

export function EnlaceExterno({
  href,
  children,
  titulo,
  className = "",
  siNoHayUrl = "texto",
  claseTexto = "font-medium text-foreground",
  sinIcono = false,
}: EnlaceExternoProps) {
  const url = urlSegura(href);
  if (!url) {
    if (siNoHayUrl === "nada") return null;
    return <span className={claseTexto}>{children}</span>;
  }
  const donde = dominio(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={titulo ?? (donde ? `Abrir en ${donde} (pestaña nueva)` : "Abrir la fuente en una pestaña nueva")}
      className={`${CLASE_ENLACE} ${className}`.trim()}
    >
      <span className="min-w-0 truncate">{children}</span>
      {sinIcono ? null : <ExternalLink className="size-3 shrink-0 translate-y-px" aria-hidden />}
      <span className="solo-lectores"> (se abre en una pestaña nueva)</span>
    </a>
  );
}

export interface EnlaceInternoProps {
  href: string;
  children: ReactNode;
  titulo?: string;
  className?: string;
  icono?: ReactNode;
}

/** Enlace dentro de Atalaya (mismo estilo, sin icono de "pestaña nueva"). */
export function EnlaceInterno({ href, children, titulo, className = "", icono }: EnlaceInternoProps) {
  return (
    <Link href={href} title={titulo} className={`${CLASE_ENLACE} ${className}`.trim()}>
      {icono ? <span className="shrink-0 translate-y-px">{icono}</span> : null}
      <span className="min-w-0 truncate">{children}</span>
    </Link>
  );
}
