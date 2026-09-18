"use client";

import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Bot, Cpu, FileSearch, LoaderCircle, Lock, ScrollText, ShieldCheck } from "lucide-react";
import type { Decision, EstadoSistema, Evidencia } from "@/lib/tipos-sistema";
import type { DefinicionRol } from "@/lib/roles";
import type { MensajeChat } from "./tipos";
import { ESTADO_UI, focoUI, formatearHora, fuenteUI, modeloDe } from "./ui";

const SUGERENCIAS_DECISION = [
  "¿Por qué esta acción?",
  "¿Qué evidencia la respalda?",
  "¿Qué reglas de doctrina aplicaste?",
  "¿Qué pasa si no actuamos?",
  "¿Qué alternativas descartaste?",
];

const SUGERENCIAS_GENERAL = [
  "Resume la actividad de la IA en este incidente",
  "¿Qué reglas de doctrina has aprendido?",
  "¿Qué modelos han intervenido?",
];

interface Props {
  decision: Decision | null;
  decisionPerdida: string | null;
  estado: EstadoSistema | null;
  definicion: DefinicionRol;
  mensajes: MensajeChat[];
  enviando: boolean;
  onEnviar: (pregunta: string) => void;
  citaActiva: string | null;
  onCita: (evidenciaId: string) => void;
}

export function ChatInterrogatorio({ decision, decisionPerdida, estado, definicion, mensajes, enviando, onEnviar, citaActiva, onCita }: Props) {
  const [texto, setTexto] = useState("");
  const fin = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLOListElement>(null);
  const sugerencias = decision ? SUGERENCIAS_DECISION : SUGERENCIAS_GENERAL;

  // Al llegar una respuesta, se muestra desde su inicio (pueden ser largas); si no, al final.
  useEffect(() => {
    const ultimo = mensajes[mensajes.length - 1];
    if (ultimo?.autor === "ia" && !enviando) {
      const li = lista.current?.lastElementChild as HTMLElement | null | undefined;
      li?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      fin.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [mensajes, enviando]);

  const enviar = (p: string) => {
    const q = p.trim();
    if (!q || enviando) return;
    onEnviar(q);
    setTexto("");
  };

  return (
    <section className="superficie flex min-h-0 flex-1 flex-col rounded-xl border border-panel-border bg-panel lg:min-h-0">
      <CabeceraChat decision={decision} estado={estado} />

      <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-5">
        {decisionPerdida && (
          <p className="mb-3 shrink-0 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            La decisión <span className="font-mono">{decisionPerdida}</span> ya no está en el estado del sistema (el escenario pudo reiniciarse). Mostrando el interrogatorio general.
          </p>
        )}
        {mensajes.length === 0 ? (
          <Bienvenida decision={decision} sugerencias={sugerencias} onElegir={enviar} deshabilitado={enviando} />
        ) : (
          <ol ref={lista} className="space-y-5">
            {mensajes.map((m) =>
              m.autor === "supervisor" ? (
                <Pregunta key={m.id} m={m} definicion={definicion} />
              ) : (
                <Respuesta key={m.id} m={m} citaActiva={citaActiva} onCita={onCita} />
              ),
            )}
            {enviando && (
              <li className="flex items-center gap-2.5 text-[12.5px] text-muted">
                <AvatarIA />
                <LoaderCircle className="size-3.5 animate-spin text-accent" /> Consultando la traza y la evidencia…
              </li>
            )}
          </ol>
        )}
        <div ref={fin} />
      </div>

      <div className="border-t border-panel-border px-4 pb-4 pt-3 sm:px-5">
        {mensajes.length > 0 && (
          <div className="scroll-thin mb-2.5 flex gap-1.5 overflow-x-auto pb-0.5 pr-6 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]">
            {sugerencias.map((s) => (
              <button
                key={s}
                type="button"
                disabled={enviando}
                onClick={() => enviar(s)}
                className="shrink-0 rounded-full border border-panel-border bg-panel-2/60 px-2.5 py-1 text-[11.5px] text-muted transition hover:border-accent/50 hover:text-foreground disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviar(texto);
          }}
          className="flex items-end gap-2 rounded-xl border border-panel-border-strong bg-panel-2 p-1.5 pl-3 focus-within:border-accent/60"
        >
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar(texto);
              }
            }}
            rows={1}
            placeholder={decision ? `Pregunta al agente sobre «${decision.tarjeta?.titulo ?? focoUI(decision.foco)}»…` : "Pregunta al agente sobre el incidente…"}
            aria-label="Pregunta al agente"
            className="max-h-32 min-h-[34px] flex-1 resize-none bg-transparent py-1.5 text-[13.5px] text-foreground outline-none placeholder:text-subtle focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={!texto.trim() || enviando}
            aria-label="Enviar pregunta"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-background transition hover:bg-brand-2 hover:text-foreground disabled:bg-panel-border disabled:text-subtle"
          >
            {enviando ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        </form>
        <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-subtle">
          <Lock className="size-3" /> El agente solo responde con la evidencia, la doctrina y la traza registradas. Cada pregunta queda en el registro de supervisión.
        </p>
      </div>
    </section>
  );
}

function CabeceraChat({ decision, estado }: { decision: Decision | null; estado: EstadoSistema | null }) {
  if (!decision) {
    return (
      <header className="flex items-center justify-between gap-3 border-b border-panel-border px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="etiqueta">Interrogatorio general</p>
          <h2 className="mt-0.5 truncate text-[15px] font-semibold text-foreground">{estado?.incidente.titulo ?? "Incidente"}</h2>
        </div>
        <span className="hidden shrink-0 items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-[11px] text-accent sm:flex">
          <ShieldCheck className="size-3.5" /> Supervisión humana · art. 14 RIA
        </span>
      </header>
    );
  }
  const est = ESTADO_UI[decision.estado] ?? ESTADO_UI.pendiente;
  const modelo = modeloDe(decision);
  return (
    <header className="flex items-start justify-between gap-3 border-b border-panel-border px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <p className="etiqueta">Interrogando a la IA sobre</p>
        <h2 className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">
          {decision.tarjeta?.titulo ?? focoUI(decision.foco)}
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted">
          <span>{focoUI(decision.foco)}</span>
          <span className={est.color}>· {est.corta}</span>
          <span>
            · riesgo <span className="font-mono text-foreground">{decision.riesgo}</span>
          </span>
          {modelo && (
            <span className="flex items-center gap-1">
              · <Cpu className="size-3" /> <span className="font-mono">{modelo}</span>
            </span>
          )}
        </p>
      </div>
      <span className="hidden shrink-0 items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-[11px] text-accent sm:flex">
        <ShieldCheck className="size-3.5" /> art. 14 RIA
      </span>
    </header>
  );
}

function Bienvenida({
  decision,
  sugerencias,
  onElegir,
  deshabilitado,
}: {
  decision: Decision | null;
  sugerencias: string[];
  onElegir: (s: string) => void;
  deshabilitado: boolean;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-1 flex-col items-center justify-center py-8 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
        <Bot className="size-5" />
      </span>
      <h3 className="mt-3 text-[16px] font-semibold text-foreground">
        {decision ? "Cuestiona esta propuesta" : "Cuestiona a los agentes"}
      </h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
        {decision
          ? "Pregunta por qué se propone, con qué datos y bajo qué reglas. Cada afirmación se cita contra la evidencia de la traza, a la derecha."
          : "Pregunta por la actividad de la IA en el incidente, o selecciona una propuesta de la lista para auditarla a fondo."}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-1.5">
        {sugerencias.map((s) => (
          <button
            key={s}
            type="button"
            disabled={deshabilitado}
            onClick={() => onElegir(s)}
            className="rounded-full border border-panel-border-strong bg-panel-2 px-3 py-1.5 text-[12.5px] text-foreground/90 transition hover:border-accent/60 hover:bg-accent/10 disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function AvatarIA() {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
      <Bot className="size-3.5" />
    </span>
  );
}

function Pregunta({ m, definicion }: { m: MensajeChat; definicion: DefinicionRol }) {
  return (
    <li className="flex justify-end gap-2.5">
      <div className="max-w-[85%]">
        <div className="rounded-xl rounded-tr-sm border border-panel-border-strong bg-panel-2 px-3.5 py-2 text-[13.5px] text-foreground">{m.texto}</div>
        <p className="mt-1 text-right text-[10.5px] text-subtle">
          {definicion.nombre} · <span className="font-mono">{formatearHora(m.timestamp)}</span>
        </p>
      </div>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-panel-border-strong font-mono text-[10.5px] font-semibold text-foreground">
        {definicion.iniciales}
      </span>
    </li>
  );
}

/** Convierte las marcas de cita en enlaces #cita-n: [n] y también [id-de-evidencia] (lo que cita el modelo). */
function marcarCitas(texto: string, citas: Evidencia[]): string {
  const indice = new Map(citas.map((c, i) => [c.id, i + 1]));
  return texto.replace(/\[([^\]\n]{1,80})\](?!\()/g, (todo, dentro: string) => {
    const n = /^\d+$/.test(dentro) ? Number(dentro) : indice.get(dentro.trim());
    if (!n || n < 1 || n > citas.length) return todo;
    return `[${n}](#cita-${n})`;
  });
}

function Respuesta({ m, citaActiva, onCita }: { m: MensajeChat; citaActiva: string | null; onCita: (id: string) => void }) {
  const citas = useMemo(() => m.citas ?? [], [m.citas]);
  const cuerpo = useMemo(() => marcarCitas(m.texto, citas), [m.texto, citas]);

  if (m.origen === "denegado") {
    return (
      <li className="flex gap-2.5">
        <AvatarIA />
        <div className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-[13px] text-foreground">
          <p className="font-medium text-danger">Acceso denegado por el servidor</p>
          <p className="mt-1 text-muted">{m.texto}</p>
          {m.escalarA && <p className="mt-1 text-[12px] text-muted">Puede responder: <span className="text-foreground">{m.escalarA}</span></p>}
        </div>
      </li>
    );
  }

  const plantilla = m.origen === "modelo" && !!m.modelo && /plantilla|determinista/i.test(m.modelo);
  const componentes: ComponentProps<typeof ReactMarkdown>["components"] = {
    a: ({ href, children }) => {
      const c = href?.match(/^#cita-(\d+)$/);
      if (c) {
        const ev = citas[Number(c[1]) - 1];
        const activa = ev && citaActiva === ev.id;
        return (
          <button
            type="button"
            onClick={() => ev && onCita(ev.id)}
            title={ev ? `${fuenteUI(ev.fuente).etiqueta}: ${ev.descripcion}` : undefined}
            className={`mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 align-[1px] font-mono text-[10.5px] font-semibold transition ${
              activa ? "bg-accent text-background" : "bg-accent/15 text-accent hover:bg-accent/30"
            }`}
          >
            {c[1]}
          </button>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
          {children}
        </a>
      );
    },
    p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-4 marker:text-subtle">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-4 marker:text-subtle">{children}</ol>,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    em: ({ children }) => <em className="text-foreground/90">{children}</em>,
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-accent/50 bg-accent/[0.04] py-1 pl-3 pr-2 text-foreground/90">{children}</blockquote>
    ),
    code: ({ children }) => <code className="rounded bg-panel-2 px-1 py-px font-mono text-[12px] text-foreground">{children}</code>,
    h1: ({ children }) => <p className="mb-1 mt-3 font-semibold text-foreground">{children}</p>,
    h2: ({ children }) => <p className="mb-1 mt-3 font-semibold text-foreground">{children}</p>,
    h3: ({ children }) => <p className="mb-1 mt-3 font-semibold text-foreground">{children}</p>,
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border-b border-panel-border px-2 py-1 text-left font-semibold text-muted">{children}</th>,
    td: ({ children }) => <td className="border-b border-panel-border px-2 py-1">{children}</td>,
  };

  return (
    <li className="flex gap-2.5">
      <AvatarIA />
      <div className="min-w-0 flex-1">
        {m.origen === "traza" && (
          <p className="mb-1.5 inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning" title={m.motivoTraza}>
            <FileSearch className="size-3" /> Respuesta generada desde la traza (sin modelo)
          </p>
        )}
        {plantilla && (
          <p className="mb-1.5 inline-flex items-center gap-1.5 rounded-md border border-info/40 bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info">
            <FileSearch className="size-3" /> Plantilla del servidor sobre la traza (sin modelo de lenguaje)
          </p>
        )}
        <div className="rounded-xl rounded-tl-sm border border-panel-border bg-panel-2/40 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-foreground/90">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={componentes}>
            {cuerpo}
          </ReactMarkdown>
        </div>

        {citas.length > 0 && (
          <div className="mt-2">
            <p className="etiqueta mb-1 text-[9.5px]!">Evidencia citada</p>
            <div className="flex flex-wrap gap-1">
              {citas.map((c, i) => {
                const { etiqueta, icono: Icono } = fuenteUI(c.fuente);
                const activa = citaActiva === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onCita(c.id)}
                    title={c.descripcion}
                    className={`flex max-w-[260px] items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] transition ${
                      activa ? "border-accent bg-accent/15 text-foreground" : "border-panel-border bg-panel-2/60 text-muted hover:border-accent/50 hover:text-foreground"
                    }`}
                  >
                    <span className="font-mono font-semibold text-accent">[{i + 1}]</span>
                    <Icono className="size-3 shrink-0" />
                    <span className="truncate">{etiqueta}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {(m.reglasAplicadas?.length ?? 0) > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-muted">
            <ScrollText className="size-3" /> Doctrina:
            {m.reglasAplicadas!.map((r) => (
              <span key={r} className="rounded border border-accent/30 bg-accent/[0.06] px-1 font-mono text-[10.5px] text-accent">
                {r}
              </span>
            ))}
          </p>
        )}

        <p className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-subtle">
          <Cpu className="size-3" />
          <span className="font-mono">{m.modelo ?? "—"}</span>
          <span>·</span>
          <span className="font-mono">{m.latenciaMs ?? 0} ms</span>
          <span>·</span>
          <span className="font-mono">{formatearHora(m.timestamp)}</span>
        </p>
      </div>
    </li>
  );
}
