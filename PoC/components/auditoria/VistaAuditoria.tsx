"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download, Repeat2 } from "lucide-react";
import { Logo } from "@/components/marca/Logo";
import { puede } from "@/lib/roles";
import { useRol } from "@/lib/useRol";
import { useEstado, type Conexion } from "@/lib/useEstado";
import { AccesoDenegado } from "./AccesoDenegado";
import { ChatInterrogatorio } from "./ChatInterrogatorio";
import { exportarRegistro } from "./exportar";
import { ListaDecisiones } from "./ListaDecisiones";
import { PanelTraza } from "./PanelTraza";
import { preguntarAgente } from "./preguntar";
import { ResumenIA } from "./ResumenIA";
import { GENERAL, type MensajeChat } from "./tipos";

let contador = 0;
const nuevoId = () => `m-${Date.now().toString(36)}-${(contador++).toString(36)}`;

export function VistaAuditoria() {
  const { rol, definicion } = useRol();
  const { estado, conexion } = useEstado();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const idUrl = params.get("decision");

  const [conversaciones, setConversaciones] = useState<Record<string, MensajeChat[]>>({});
  const [enviando, setEnviando] = useState(false);
  const [cita, setCita] = useState<{ clave: string; id: string } | null>(null);
  const enVuelo = useRef(false);

  const decision = useMemo(() => (idUrl ? estado?.decisiones.find((d) => d.id === idUrl) ?? null : null), [estado, idUrl]);
  const decisionPerdida = idUrl && estado && !decision ? idUrl : null;
  const clave = decision?.id ?? GENERAL;
  const mensajes = useMemo(() => conversaciones[clave] ?? [], [conversaciones, clave]);
  const citaActiva = cita?.clave === clave ? cita.id : null;

  const ultimaIA = useMemo(() => [...mensajes].reverse().find((m) => m.autor === "ia" && m.origen !== "denegado"), [mensajes]);
  const numerosCita = useMemo(() => new Map((ultimaIA?.citas ?? []).map((c, i) => [c.id, i + 1])), [ultimaIA]);
  const reglasCitadas = useMemo(() => new Set(ultimaIA?.reglasAplicadas ?? []), [ultimaIA]);
  const conPreguntas = useMemo(() => new Set(Object.keys(conversaciones).filter((k) => conversaciones[k].length)), [conversaciones]);

  const seleccionar = useCallback(
    (id: string | null) => {
      const q = new URLSearchParams(params.toString());
      if (id) q.set("decision", id);
      else q.delete("decision");
      const s = q.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const enviar = useCallback(
    async (pregunta: string) => {
      if (enVuelo.current) return;
      enVuelo.current = true;
      setEnviando(true);
      const k = clave;
      const anadir = (m: MensajeChat) => setConversaciones((c) => ({ ...c, [k]: [...(c[k] ?? []), m] }));
      anadir({ id: nuevoId(), autor: "supervisor", texto: pregunta, timestamp: new Date().toISOString(), decisionId: decision?.id ?? null, rol });
      try {
        const r = await preguntarAgente({ pregunta, decision, estado, rol });
        const base = { id: nuevoId(), autor: "ia" as const, timestamp: new Date().toISOString(), decisionId: decision?.id ?? null };
        if (r.tipo === "denegado") {
          anadir({ ...base, texto: r.error, origen: "denegado", escalarA: r.escalarA });
        } else {
          anadir({
            ...base,
            texto: r.datos.respuesta,
            origen: r.tipo,
            motivoTraza: r.tipo === "traza" ? r.motivo : undefined,
            citas: r.datos.citas,
            reglasAplicadas: r.datos.reglasAplicadas,
            modelo: r.datos.modelo,
            latenciaMs: r.datos.latenciaMs,
          });
        }
      } finally {
        enVuelo.current = false;
        setEnviando(false);
      }
    },
    [clave, decision, estado, rol],
  );

  const permitido = puede(rol, "interrogar_ia");
  const hayRegistro = conPreguntas.size > 0 || !!decision;

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:min-h-0">
      <BarraSuperior
        nombreRol={definicion.nombre}
        iniciales={definicion.iniciales}
        conexion={conexion}
        organismo={estado?.organismo?.nombre}
        onExportar={permitido ? () => exportarRegistro({ estado, conversaciones, seleccion: decision?.id ?? null, rol }) : undefined}
        exportarDeshabilitado={!hayRegistro}
      />

      {!permitido ? (
        <AccesoDenegado definicion={definicion} />
      ) : (
        <main className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 pt-3 sm:px-4 lg:gap-3">
          <ResumenIA estado={estado} />
          <div className="grid grid-cols-1 gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[300px_minmax(0,1fr)_360px] xl:grid-cols-[330px_minmax(0,1fr)_400px]">
            <div className="flex h-[400px] min-h-0 flex-col lg:h-auto">
              <ListaDecisiones
                decisiones={estado?.decisiones ?? []}
                seleccion={decision?.id ?? null}
                onSeleccionar={seleccionar}
                conPreguntas={conPreguntas}
                cargando={!estado}
              />
            </div>
            <div className="flex h-[640px] min-h-0 flex-col lg:h-auto">
              <ChatInterrogatorio
                decision={decision}
                decisionPerdida={decisionPerdida}
                estado={estado}
                definicion={definicion}
                mensajes={mensajes}
                enviando={enviando}
                onEnviar={enviar}
                citaActiva={citaActiva}
                onCita={(id) => setCita((c) => (c?.clave === clave && c.id === id ? null : { clave, id }))}
              />
            </div>
            <div className="flex h-[640px] min-h-0 flex-col lg:h-auto">
              <PanelTraza
                decision={decision}
                estado={estado}
                numerosCita={numerosCita}
                citaActiva={citaActiva}
                reglasCitadas={reglasCitadas}
              />
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

const CONEXION_UI: Record<Conexion, { texto: string; punto: string }> = {
  conectando: { texto: "Conectando", punto: "bg-subtle" },
  en_vivo: { texto: "En vivo", punto: "bg-success" },
  fixture: { texto: "Datos de demostración", punto: "bg-warning" },
};

function BarraSuperior({
  nombreRol,
  iniciales,
  conexion,
  organismo,
  onExportar,
  exportarDeshabilitado,
}: {
  nombreRol: string;
  iniciales: string;
  conexion: Conexion;
  organismo?: string;
  onExportar?: () => void;
  exportarDeshabilitado: boolean;
}) {
  const c = CONEXION_UI[conexion];
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-panel-border bg-panel/80 px-3 py-2.5 backdrop-blur sm:px-4">
      <Link href="/" aria-label="Atalaya, volver a la consola" className="shrink-0">
        <Logo descriptor={false} />
      </Link>
      <div className="hidden h-7 w-px bg-panel-border sm:block" />
      <div className="min-w-0">
        <h1 className="text-[15px] font-semibold leading-tight text-foreground">Supervisión de la IA</h1>
        <p className="truncate text-[11px] text-muted">
          {organismo ? `${organismo} · ` : ""}Reglamento UE 2024/1689 · art. 14
        </p>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-md border border-panel-border px-2 py-1 text-[11px] text-muted md:flex">
          <span className={`size-1.5 rounded-full ${c.punto}`} /> {c.texto}
        </span>
        {onExportar && (
          <button
            type="button"
            onClick={onExportar}
            disabled={exportarDeshabilitado}
            title={exportarDeshabilitado ? "Selecciona una decisión o haz una pregunta para exportar" : "Descarga la conversación y la traza en JSON"}
            className="flex items-center gap-1.5 rounded-md border border-panel-border-strong bg-panel-2 px-2.5 py-1 text-[12px] text-foreground transition hover:border-accent/50 disabled:cursor-not-allowed disabled:text-subtle"
          >
            <Download className="size-3.5" /> <span className="hidden sm:inline">Exportar registro de supervisión</span>
            <span className="sm:hidden">Exportar</span>
          </button>
        )}
        <Link
          href="/"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted transition hover:bg-panel-2 hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Volver a la consola
        </Link>
        <div className="flex items-center gap-2 rounded-lg border border-panel-border bg-panel-2/60 py-1 pl-1 pr-1">
          <span className="flex size-6 items-center justify-center rounded-md bg-accent/20 font-mono text-[10px] font-semibold text-accent">{iniciales}</span>
          <span className="max-w-[180px] truncate text-[12px] text-foreground">{nombreRol}</span>
          <Link
            href="/acceso"
            title="Cambiar perfil"
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition hover:bg-panel-border hover:text-foreground"
          >
            <Repeat2 className="size-3.5" /> <span className="hidden xl:inline">Cambiar perfil</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
