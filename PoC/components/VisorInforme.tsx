"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download, FileSignature, Printer, X } from "lucide-react";
import type { Informe } from "@/lib/tipos-sistema";
import { TIPO_INFORME_UI } from "./PanelInformes";
import { Tooltip } from "@/components/ui/Tooltip";

// Tailwind 4 sin plugin typography: estilos del markdown a mano.
const MD: Components = {
  h1: ({ children }) => (
    <h1 className="mb-4 border-b border-panel-border pb-3 text-2xl font-semibold leading-tight tracking-tight text-foreground">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-8 mb-3 flex items-center gap-2 text-lg font-semibold leading-snug text-foreground before:h-4 before:w-1 before:shrink-0 before:rounded-full before:bg-brand print:before:hidden">
      {children}
    </h2>
  ),
  h3: ({ children }) => <h3 className="mt-6 mb-2 text-base font-semibold text-foreground">{children}</h3>,
  h4: ({ children }) => (
    <h4 className="mt-5 mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{children}</h4>
  ),
  // pre-line: los bloques "**Campo:** valor" en líneas seguidas se ven como líneas.
  p: ({ children }) => <p className="my-3 whitespace-pre-line text-sm leading-relaxed text-foreground/90">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground/90 marker:text-subtle">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-decimal space-y-1.5 pl-6 text-sm leading-relaxed text-foreground/90 marker:font-mono marker:text-subtle">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1 [&>ol]:my-1.5 [&>p]:my-1 [&>ul]:my-1.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic text-muted">{children}</em>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-2 hover:brightness-110">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-4 rounded-r-[10px] border-l-2 border-brand/50 bg-brand/6 px-4 py-1 text-muted [&>p]:my-2 [&>p]:italic">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => (
    <code
      className={`rounded border border-panel-border bg-panel-2 px-1 py-px font-mono text-[0.85em] text-brand ${className ?? ""}`}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="scroll-thin my-4 overflow-x-auto rounded-[10px] border border-panel-border bg-panel-2 p-3 text-xs leading-relaxed [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-foreground/90">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-6 border-panel-border" />,
  table: ({ children }) => (
    <div className="scroll-thin my-4 overflow-x-auto rounded-[10px] border border-panel-border">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-panel-2">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-panel-border last:border-b-0">{children}</tr>,
  th: ({ children, style }) => (
    <th
      style={style}
      className="border-r border-panel-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted last:border-r-0"
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-r border-panel-border px-3 py-2 align-top text-foreground/90 last:border-r-0">
      {children}
    </td>
  ),
  input: ({ checked, type }) =>
    type === "checkbox" ? (
      <input type="checkbox" checked={checked} readOnly disabled className="mr-1.5 translate-y-px accent-brand" />
    ) : null,
};

const suscribirNada = () => () => {};

function fechaLarga(iso: string) {
  return new Date(iso).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" });
}

function nombreArchivo(informe: Informe) {
  const base = informe.titulo
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || informe.id}.md`;
}

function descargarMarkdown(informe: Informe) {
  const blob = new Blob([informe.markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo(informe);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

interface Props {
  informe: Informe | null;
  onCerrar: () => void;
}

export function VisorInforme({ informe, onCerrar }: Props) {
  // El portal necesita document: solo tras montar en cliente.
  const enCliente = useSyncExternalStore(suscribirNada, () => true, () => false);
  const abierto = informe !== null;

  useEffect(() => {
    if (!abierto) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("imprimiendo-informe");
    window.addEventListener("keydown", alPulsar);
    return () => {
      window.removeEventListener("keydown", alPulsar);
      document.body.style.overflow = overflowPrevio;
      document.body.classList.remove("imprimiendo-informe");
    };
  }, [abierto, onCerrar]);

  if (!informe || !enCliente) return null;

  const ui = TIPO_INFORME_UI[informe.tipo];

  return createPortal(
    <div
      className="visor-informe fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="visor-informe-titulo"
    >
      <div className="visor-informe-hoja flex h-full max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-panel-border bg-panel shadow-[var(--sombra-flotante)]">
        {/* Cabecera */}
        <div className="visor-informe-cabecera flex flex-wrap items-start justify-between gap-3 border-b border-panel-border px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className={`pildora ${ui.caja}`}>
                <ui.Icono className="size-3" aria-hidden /> {ui.etiqueta}
              </span>
              <span className="text-[11px] text-muted">{fechaLarga(informe.generadoEn)}</span>
              <Tooltip
                titulo="Identificador del informe"
                contenido="Referencia con la que este documento queda registrado; también aparece en el pie de la versión impresa."
              >
                <span className="font-mono text-[11px] text-subtle">{informe.id}</span>
              </Tooltip>
            </div>
            <h2 id="visor-informe-titulo" className="mt-1.5 text-base font-semibold leading-snug text-foreground">
              {informe.titulo}
            </h2>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5 print:hidden">
            {informe.pdfUrl && (
              <Tooltip
                titulo="PDF firmado"
                contenido="Copia sellada del informe, con la firma del mando. Se abre en una pestaña nueva."
              >
                <a
                  href={informe.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="boton boton-primario boton-sm min-h-8"
                >
                  <FileSignature className="size-3.5" aria-hidden /> PDF firmado
                </a>
              </Tooltip>
            )}
            <Tooltip
              titulo="Imprimir o guardar en PDF"
              contenido="Usa el diálogo del navegador: se imprime solo el informe, sin la interfaz del centro de mando."
            >
              <button type="button" onClick={() => window.print()} className="boton boton-secundario boton-sm min-h-8">
                <Printer className="size-3.5" aria-hidden /> Imprimir / Guardar PDF
              </button>
            </Tooltip>
            <Tooltip
              titulo="Descargar .md"
              contenido="Guarda el texto original del informe en Markdown, tal y como lo redactó la IA."
            >
              <button
                type="button"
                onClick={() => descargarMarkdown(informe)}
                className="boton boton-secundario boton-sm min-h-8"
              >
                <Download className="size-3.5" aria-hidden /> Descargar .md
              </button>
            </Tooltip>
            <Tooltip titulo="Cerrar" contenido="Vuelve al centro de mando. También se cierra con la tecla Esc.">
              <button
                type="button"
                onClick={onCerrar}
                aria-label="Cerrar informe (Esc)"
                className="boton boton-fantasma boton-sm ml-1 min-h-8"
              >
                <X className="size-4" aria-hidden />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Documento */}
        <div className="visor-informe-cuerpo scroll-thin flex-1 overflow-y-auto bg-panel-2">
          <article className="mx-auto max-w-3xl px-6 py-7 sm:px-10">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>
              {informe.markdown}
            </ReactMarkdown>
            <p className="mt-10 hidden border-t pt-3 text-[10px] print:block">
              Centro de Mando de Crisis · Documento generado automáticamente a partir del registro de decisiones ·{" "}
              {informe.id}
            </p>
          </article>
        </div>
      </div>
    </div>,
    document.body,
  );
}
