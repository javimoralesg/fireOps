"use client";
// Acta (informe) en un diálogo, sin salir de la sala: Markdown renderizado y la
// huella SHA-256 que garantiza que no se ha alterado. DUEÑO: constructor E.
// Dependencias: react-markdown, remark-gfm.

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Fingerprint } from "lucide-react";
import type { Informe } from "@/lib/dominio/tipos";
import { fechaHora } from "@/lib/cliente/formato";
import { Boton } from "@/components/ui/Boton";
import { Dialogo } from "@/components/ui/Dialogo";
import { Insignia } from "@/components/ui/Insignia";

export const TEXTO_TIPO_INFORME: Record<string, string> = {
  decision: "Acta de decisión",
  accion: "Acta de acción",
  situacion: "Parte de situación",
  postmortem: "Post-mortem",
  ciclo: "Acta de ciclo",
};

/** Markdown con los estilos de la sala (no hay plugin de tipografía en Tailwind 4). */
export function Markdown({ texto }: { texto: string }) {
  return (
    <div className="space-y-2 text-[13.5px] leading-relaxed text-foreground [&_a]:text-brand [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-panel-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_code]:rounded [&_code]:bg-panel-2 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px] [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:text-[14px] [&_h3]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_ol_li]:list-decimal [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-panel-2 [&_pre]:p-2 [&_table]:w-full [&_table]:text-[12.5px] [&_td]:border [&_td]:border-panel-border [&_td]:px-1.5 [&_td]:py-1 [&_th]:border [&_th]:border-panel-border [&_th]:bg-panel-2 [&_th]:px-1.5 [&_th]:py-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{texto}</ReactMarkdown>
    </div>
  );
}

export function CabeceraInforme({ informe }: { informe: Informe }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Insignia pequena tono="marca">{TEXTO_TIPO_INFORME[informe.tipo] ?? informe.tipo}</Insignia>
      {informe.estadoDecision ? <Insignia pequena tono="neutro">{informe.estadoDecision.replace(/_/g, " ")}</Insignia> : null}
      <Insignia pequena tono={informe.conNarrativaIA ? "info" : "neutro"}>
        {informe.conNarrativaIA ? `Narrativa de ${informe.modelo}` : "Acta determinista"}
      </Insignia>
      {informe.agenteId ? <Insignia pequena tono="neutro">{informe.agenteId}</Insignia> : null}
      <span className="text-[11px] text-subtle">{fechaHora(informe.generadoEn)}</span>
      {informe.huella ? (
        <span className="inline-flex items-center gap-1 text-[10.5px] text-subtle" title={`Huella SHA-256: ${informe.huella}`}>
          <Fingerprint className="size-3" aria-hidden /> {informe.huella.slice(0, 12)}…
        </span>
      ) : null}
    </div>
  );
}

/**
 * El Snapshot solo trae un extracto de cada acta (≤ 400 caracteres) para no inflar el SSE;
 * el Markdown completo se pide a /api/informes/[id] al abrir el diálogo.
 */
function useContenidoCompleto(informe: Informe | null): { texto: string; cargando: boolean } {
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);

  // Al cambiar de acta se parte del extracto del Snapshot (ajuste en el render)
  // y solo después llega el Markdown completo por red.
  const [informePrevio, setInformePrevio] = useState(informe);
  if (informe !== informePrevio) {
    setInformePrevio(informe);
    setTexto(informe?.contenido ?? "");
    setCargando(Boolean(informe));
  }

  useEffect(() => {
    let vivo = true;
    if (!informe) return;
    fetch(`/api/informes/${encodeURIComponent(informe.id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { informe?: Informe; contenido?: string }) => {
        const completo = j.informe?.contenido ?? j.contenido;
        if (vivo && completo && completo.length >= (informe.contenido?.length ?? 0)) setTexto(completo);
      })
      .catch(() => undefined)
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [informe]);
  return { texto, cargando };
}

export function DialogoInforme({ informe, onCerrar }: { informe: Informe | null; onCerrar: () => void }) {
  const { texto, cargando } = useContenidoCompleto(informe);
  return (
    <Dialogo
      abierto={informe !== null}
      onCerrar={onCerrar}
      titulo={informe?.titulo ?? ""}
      ancho="lg"
      pie={
        <Boton variante="secundario" onClick={onCerrar}>
          Cerrar
        </Boton>
      }
    >
      {informe ? (
        <>
          <div className="mb-3 border-b border-panel-border pb-2">
            <CabeceraInforme informe={informe} />
          </div>
          {cargando && texto.length <= 400 ? <p className="mb-2 text-[12px] text-subtle">Cargando el acta completa…</p> : null}
          <Markdown texto={texto || "_Este acta no tiene contenido._"} />
        </>
      ) : null}
    </Dialogo>
  );
}
