"use client";

import { useState } from "react";
import {
  ChevronRight,
  FileCheck2,
  FileSignature,
  Gavel,
  Lock,
  LoaderCircle,
  Radio,
  ScrollText,
  X,
} from "lucide-react";
import type { Informe } from "@/lib/tipos-sistema";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";

type TipoInforme = Informe["tipo"];

export const TIPO_INFORME_UI: Record<
  TipoInforme,
  { etiqueta: string; plural: string; Icono: typeof Gavel; texto: string; caja: string }
> = {
  post_mortem: {
    etiqueta: "Post-mortem",
    plural: "Post-mortem",
    Icono: FileCheck2,
    texto: "text-success",
    caja: "border-success/30 bg-success/10 text-success",
  },
  sitrep: {
    etiqueta: "SITREP",
    plural: "SITREP",
    Icono: Radio,
    texto: "text-brand",
    caja: "border-brand/30 bg-brand/10 text-brand",
  },
  acta_decision: {
    etiqueta: "Acta de decisión",
    plural: "Actas",
    Icono: Gavel,
    texto: "text-warning",
    caja: "border-warning/30 bg-warning/10 text-warning",
  },
};

// Qué es cada tipo de informe (tooltip de la píldora y de la fila).
const TIPO_AYUDA: Record<TipoInforme, string> = {
  post_mortem: "Informe final de la incidencia: decisiones, evidencias y aprendizajes, listo para firma.",
  sitrep: "Parte de situación periódico: foto del estado de la crisis en ese momento.",
  acta_decision: "Acta de una decisión concreta, con la evidencia en la que se apoyó y quién la firmó.",
};

const ORDEN_FILTROS: TipoInforme[] = ["post_mortem", "sitrep", "acta_decision"];
type Filtro = "todos" | TipoInforme;

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function fechaCompleta(iso: string) {
  return new Date(iso).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" });
}

interface Props {
  informes: Informe[];
  incidenteActivo: boolean;
  onAbrir: (id: string) => void;
  /** Sin callback no se ofrece el cierre (rol sin permiso firmar_informes). */
  onCerrarIncidente?: () => Promise<void>;
}

export function PanelInformes({ informes, incidenteActivo, onAbrir, onCerrarIncidente }: Props) {
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const recientes = [...informes].sort((a, b) => b.generadoEn.localeCompare(a.generadoEn));
  const postMortem = recientes.find((i) => i.tipo === "post_mortem");
  const visibles = filtro === "todos" ? recientes : recientes.filter((i) => i.tipo === filtro);
  const cuenta = (t: TipoInforme) => informes.filter((i) => i.tipo === t).length;

  return (
    <section className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-panel-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <ScrollText className="size-4 text-brand" /> Informes y trazabilidad
          <Ayuda
            titulo="Informes y trazabilidad"
            texto="Actas por decisión, SITREP periódicos y post-mortem al cerrar; todo firmable e imprimible."
          />
        </h2>
        <Tooltip
          titulo="Informes generados"
          contenido={`${informes.length} ${informes.length === 1 ? "informe emitido" : "informes emitidos"} en esta incidencia. Cada uno conserva la evidencia con la que se redactó.`}
        >
          <span className="text-[11px] text-muted">
            <span className="font-mono text-foreground">{informes.length}</span>{" "}
            {informes.length === 1 ? "informe" : "informes"}
          </span>
        </Tooltip>
      </div>

      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto p-4">
        {incidenteActivo ? (
          onCerrarIncidente && <CierreIncidente onCerrarIncidente={onCerrarIncidente} />
        ) : (
          <p className="flex items-center gap-1.5 rounded-[10px] border border-panel-border bg-panel-2 px-3 py-2 text-xs text-muted">
            <Lock className="size-3.5 shrink-0 text-subtle" aria-hidden /> Incidencia cerrada. Los informes quedan
            archivados como registro oficial.
          </p>
        )}

        {postMortem && <DestacadoPostMortem informe={postMortem} onAbrir={onAbrir} />}

        {informes.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar informes por tipo">
            <Chip activo={filtro === "todos"} onClick={() => setFiltro("todos")} etiqueta="Todos" n={informes.length} />
            {ORDEN_FILTROS.map((t) => (
              <Chip
                key={t}
                activo={filtro === t}
                onClick={() => setFiltro(t)}
                etiqueta={TIPO_INFORME_UI[t].plural}
                n={cuenta(t)}
              />
            ))}
          </div>
        )}

        {informes.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-panel-border-strong bg-panel-2 px-4 py-6 text-center">
            <ScrollText className="mx-auto size-6 text-subtle" />
            <p className="mt-2 text-[13px] font-semibold text-foreground">Todavía no hay informes</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Cada decisión aprobada o denegada genera un acta con su evidencia. Los SITREP se emiten periódicamente y, al
              cerrar la incidencia, se compila el post-mortem para firma.
            </p>
          </div>
        ) : visibles.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted">No hay informes de este tipo.</p>
        ) : (
          <ul className="space-y-1.5">
            {visibles.map((inf) => (
              <FilaInforme key={inf.id} informe={inf} onAbrir={onAbrir} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CierreIncidente({ onCerrarIncidente }: { onCerrarIncidente: NonNullable<Props["onCerrarIncidente"]> }) {
  const [paso, setPaso] = useState<"inicial" | "confirmando" | "compilando">("inicial");
  const [error, setError] = useState<string | null>(null);

  const confirmar = async () => {
    setPaso("compilando");
    setError(null);
    try {
      await onCerrarIncidente();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cerrar la incidencia");
    } finally {
      setPaso("inicial");
    }
  };

  if (paso === "inicial") {
    return (
      <div className="space-y-1.5">
        <Tooltip
          titulo="Cerrar la incidencia"
          contenido="Pide confirmación antes de nada. Al confirmar, la IA compila decisiones, evidencias, audios y feedback en el post-mortem oficial."
          className="w-full"
        >
          <button type="button" onClick={() => setPaso("confirmando")} className="boton boton-primario w-full">
            <FileSignature className="size-4" aria-hidden /> Cerrar incidencia y generar post-mortem
          </button>
        </Tooltip>
        {error && (
          <p role="alert" className="text-[11px] text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  const compilando = paso === "compilando";
  return (
    <div
      role="group"
      aria-label="Confirmar el cierre de la incidencia"
      className="rounded-[10px] border border-brand/30 bg-brand/6 p-3"
    >
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        <FileSignature className="size-4 text-brand" aria-hidden /> ¿Cerrar la incidencia?
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Se compilarán decisiones, evidencias, audios y feedback en un informe oficial para firma.
      </p>
      {compilando ? (
        <p
          aria-live="polite"
          className="mt-3 flex items-center justify-center gap-2 rounded-[10px] bg-brand/10 px-3 py-2 text-[13px] font-semibold text-brand"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Compilando con QuiverAI + Claude…
        </p>
      ) : (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={confirmar} className="boton boton-primario flex-1">
            <FileCheck2 className="size-4" aria-hidden /> Cerrar y generar
          </button>
          <button type="button" onClick={() => setPaso("inicial")} className="boton boton-fantasma">
            <X className="size-4" aria-hidden /> Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

function DestacadoPostMortem({ informe, onAbrir }: { informe: Informe; onAbrir: Props["onAbrir"] }) {
  return (
    <div className="rounded-[10px] border border-success/30 bg-success/8 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="pildora pildora-exito">
          <FileCheck2 className="size-3" aria-hidden /> Post-mortem · listo para firma
        </span>
        <Tooltip titulo="Compilado el" contenido={fechaCompleta(informe.generadoEn)}>
          <span className="font-mono text-[11px] text-subtle">{hora(informe.generadoEn)}</span>
        </Tooltip>
      </div>
      <p className="mt-1.5 text-[13px] font-semibold leading-snug text-foreground">{informe.titulo}</p>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={() => onAbrir(informe.id)}
          className="boton boton-primario boton-sm min-h-8 flex-1"
        >
          <ScrollText className="size-3.5" aria-hidden /> Abrir informe
        </button>
        {informe.pdfUrl && (
          <Tooltip
            titulo="PDF firmado"
            contenido="Copia sellada del informe, con la firma del mando. Se abre en una pestaña nueva."
            className="flex-1"
          >
            <a
              href={informe.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="boton boton-secundario boton-sm min-h-8 w-full"
            >
              <FileSignature className="size-3.5" aria-hidden /> PDF firmado
            </a>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function Chip({ activo, onClick, etiqueta, n }: { activo: boolean; onClick: () => void; etiqueta: string; n: number }) {
  return (
    <button type="button" role="tab" aria-selected={activo} onClick={onClick} disabled={n === 0 && !activo} className="chip">
      {etiqueta}
      <span className="font-mono">{n}</span>
    </button>
  );
}

function FilaInforme({ informe, onAbrir }: { informe: Informe; onAbrir: Props["onAbrir"] }) {
  const ui = TIPO_INFORME_UI[informe.tipo];
  return (
    <li>
      <Tooltip
        titulo={ui.etiqueta}
        contenido={
          <>
            {TIPO_AYUDA[informe.tipo]} Generado el {fechaCompleta(informe.generadoEn)}.
            {informe.pdfUrl ? " Tiene PDF firmado." : ""}
          </>
        }
        className="w-full"
        lado="izquierda"
      >
        <button
          type="button"
          onClick={() => onAbrir(informe.id)}
          className="fila-interactiva group flex w-full cursor-pointer items-center gap-3 bg-panel-2 px-3 py-2 text-left"
        >
          <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg border ${ui.caja}`}>
            <ui.Icono className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground">{informe.titulo}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-subtle">
              <span className={`font-semibold ${ui.texto}`}>{ui.etiqueta}</span>·
              <span className="font-mono">{hora(informe.generadoEn)}</span>
              {informe.pdfUrl && (
                <>
                  · <span className="font-semibold text-muted">PDF</span>
                </>
              )}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-muted transition group-hover:text-brand">
            Abrir <ChevronRight className="size-3.5" aria-hidden />
          </span>
        </button>
      </Tooltip>
    </li>
  );
}
