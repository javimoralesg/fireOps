"use client";

import Link from "next/link";
import { BookOpen, Brain, FileText, Flame, Gauge, MessageCircleQuestion, Signature, Timer } from "lucide-react";
import type { Decision, ReglaDoctrina } from "@/lib/tipos-sistema";
import { escalarA, etiquetaRol, puede } from "@/lib/permisos";
import { ROLES, type RolId } from "@/lib/roles";
import { AudiosAlerta } from "./decision/AudiosAlerta";
import { BannerEstado } from "./decision/BannerEstado";
import { DoctrinaAplicada } from "./decision/DoctrinaAplicada";
import { BarraRiesgo, Countdown } from "./decision/Indicadores";
import { PanelEvidencia } from "./decision/PanelEvidencia";
import { EfectoDomino, PlanEjecucion } from "./decision/PlanEjecucion";
import { Ayuda, Tooltip } from "./ui/Tooltip";
import { ESTADO_UI, formatearHora, URGENCIA_UI } from "./decision/ui";
import { ZonaAccion } from "./decision/ZonaAccion";
import { SelloCompetencia } from "./politica/SelloCompetencia";
import { veredictoDe } from "./politica/ui";
import { usePolitica } from "./politica/usePolitica";

interface Props {
  decision: Decision;
  doctrina: ReglaDoctrina[];
  rol: RolId;
  /** epoch ms sincronizado con el reloj del servidor */
  ahora: number;
  onAprobar: () => Promise<void>;
  onDenegar: (feedback: string, ambito: "incidente" | "global") => Promise<void>;
  /** Pide la firma de un rol superior (cuando el propio no alcanza el riesgo o no firma). */
  onEscalar?: (a: RolId) => Promise<void>;
  onVerInforme?: (informeId: string) => void;
  /** Opcional: si se pasa, se marca en la barra de riesgo y se cita en el banner de ejecución automática. */
  umbralAutonomia?: number;
}

export function DetalleDecision({
  decision: d,
  doctrina,
  rol,
  ahora,
  onAprobar,
  onDenegar,
  onEscalar,
  onVerInforme,
  umbralAutonomia,
}: Props) {
  const { tarjeta, informeId } = d;
  const urg = URGENCIA_UI[d.urgencia] ?? URGENCIA_UI.media;
  const est = ESTADO_UI[d.estado] ?? ESTADO_UI.pendiente;
  const IconoEstado = est.icono;
  const pendiente = d.estado === "pendiente";
  const autonoma = d.estado === "auto" || (umbralAutonomia !== undefined && d.riesgo <= umbralAutonomia);
  // Quién firmó (si ya se decidió) o quién tiene que firmar (si está pendiente).
  // Quién gestiona la decisión según la política de autonomía (poc-c5): el veredicto del motor si existe, o el calculado aquí.
  const { politica } = usePolitica();
  const veredicto = politica ? veredictoDe(d, politica, umbralAutonomia ?? 0).veredicto : undefined;
  const firma = d.decididaPor && d.estado !== "auto"
    ? { etiqueta: "Firmó", valor: etiquetaRol(d.decididaPor.rol) }
    : { etiqueta: "Firma", valor: autonoma ? "IA (autónoma)" : ROLES[escalarA(d.riesgo)].nombre };

  return (
    <section className="flex h-full flex-col" aria-label={`Decisión: ${tarjeta.titulo}`}>
      <div className="flex items-center justify-between gap-2 border-b border-panel-border px-4 py-3">
        <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-foreground">
          <Brain className="size-4 shrink-0 text-brand" /> Decisión
          <span className="truncate font-mono text-[11px] font-normal text-subtle">{d.foco}</span>
          <Ayuda texto="La IA propone; tú firmas, escalas o deniegas con un motivo que se convierte en doctrina." />
        </h2>
        <span className="flex shrink-0 items-center gap-2">
          {pendiente ? (
            <span className="flex items-center gap-1 text-sm">
              <Timer className="size-3.5 text-subtle" aria-hidden />
              <Countdown plazo={d.plazo} ahora={ahora} />
            </span>
          ) : (
            <span className={`flex items-center gap-1 text-[11px] font-medium ${est.color}`}>
              <IconoEstado className={`size-3.5 ${est.girar ? "animate-spin" : ""}`} aria-hidden /> {est.etiqueta}
            </span>
          )}
          <Tooltip
            titulo={`Urgencia ${urg.etiqueta.toLowerCase()}`}
            contenido="Prioridad con la que la IA ha colocado esta propuesta en la cola; ordena qué se mira antes, no quién la firma (eso lo marca el riesgo)."
          >
            <span className={urg.badge}>{urg.etiqueta}</span>
          </Tooltip>
        </span>
      </div>

      <div key={`cuerpo-${d.id}`} className="scroll-thin flex-1 space-y-4 overflow-y-auto p-4">
        <BannerEstado decision={d} doctrina={doctrina} ahora={ahora} umbralAutonomia={umbralAutonomia} />

        {/* Qué se decide */}
        <div>
          <h3 className="text-[17px] font-semibold leading-tight text-foreground">{tarjeta.titulo}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{tarjeta.resumen}</p>
          {tarjeta.protocolo && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
              <BookOpen className="size-3.5 shrink-0 text-subtle" aria-hidden />
              <span>
                Protocolo <span className="font-mono text-foreground">{tarjeta.protocolo.codigo}</span> ·{" "}
                {tarjeta.protocolo.nombre}
              </span>
              <Ayuda texto="Protocolo oficial de emergencias en el que la IA ha encajado esta propuesta; marca qué acciones son admisibles." />
            </p>
          )}
          {puede(rol, "interrogar_ia") && (
            <Tooltip
              className="mt-2.5"
              titulo="Preguntar a la IA"
              contenido="Abre la auditoría de esta decisión: por qué la proponen los agentes, con qué datos y qué reglas de doctrina han aplicado."
            >
              <Link href={`/auditoria?decision=${encodeURIComponent(d.id)}`} className="boton boton-secundario boton-sm">
                <MessageCircleQuestion className="size-3.5" aria-hidden /> Preguntar a la IA
              </Link>
            </Tooltip>
          )}
        </div>

        {/* Riesgo · plazo · firma */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-[10px] border border-panel-border bg-panel-2 px-3 py-2">
            <p className="etiqueta flex items-center gap-1">
              <Gauge className="size-3" aria-hidden /> Riesgo
              <Ayuda
                titulo="Riesgo 0–100"
                texto={
                  umbralAutonomia !== undefined ? (
                    <>
                      Daño potencial de esta decisión según la IA (personas, servicios críticos e irreversibilidad). Por
                      debajo del umbral de autonomía (<strong>{umbralAutonomia}</strong>) la IA puede ejecutar sola; por
                      encima exige firma humana, y a más riesgo, rol más alto.
                    </>
                  ) : (
                    "Daño potencial de esta decisión según la IA (personas, servicios críticos e irreversibilidad). Cuanto más alto, más arriba tiene que estar quien firma."
                  )
                }
              />
            </p>
            <p className="mt-1 flex items-center gap-2">
              <span className="font-mono text-lg font-semibold leading-none text-foreground">{d.riesgo}</span>
              <BarraRiesgo riesgo={d.riesgo} umbral={umbralAutonomia} className="flex-1" />
            </p>
          </div>
          <div className="rounded-[10px] border border-panel-border bg-panel-2 px-3 py-2">
            <p className="etiqueta flex items-center gap-1">
              <Timer className="size-3" aria-hidden /> Plazo
              <Ayuda
                titulo="Plazo para decidir"
                texto="Momento a partir del cual esta decisión deja de tener sentido: el escenario habrá cambiado y la propuesta habrá que recalcularla."
              />
            </p>
            <p className="mt-1 text-lg leading-none">
              {pendiente ? (
                <Countdown plazo={d.plazo} ahora={ahora} />
              ) : (
                <span className="font-mono text-sm text-muted">{formatearHora(d.plazo, false)}</span>
              )}
            </p>
          </div>
          <div className="min-w-0 rounded-[10px] border border-panel-border bg-panel-2 px-3 py-2">
            <p className="etiqueta flex items-center gap-1">
              <Signature className="size-3" aria-hidden /> {firma.etiqueta}
              <Ayuda
                titulo="Quién firma"
                texto="Rol mínimo que la doctrina exige para esta decisión: cada perfil tiene un límite de riesgo que puede firmar, así que a más riesgo, firma más alta. Si el riesgo queda por debajo del umbral de autonomía, firma la propia IA."
              />
            </p>
            <Tooltip
              className="mt-1 w-full"
              titulo={firma.etiqueta === "Firmó" ? "Firmó esta decisión" : "Firma requerida"}
              contenido={firma.valor}
            >
              <span className="line-clamp-2 text-xs font-medium leading-tight text-foreground">{firma.valor}</span>
            </Tooltip>
          </div>
        </div>
        {veredicto && <SelloCompetencia veredicto={veredicto} />}

        {/* Coste de no actuar */}
        {d.costeDeNoActuar && (
          <div className="rounded-[10px] border border-danger/30 bg-danger/8 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-danger">
              <Flame className="size-3.5 shrink-0" aria-hidden /> Si no se actúa
              <Ayuda
                titulo="Coste de no decidir"
                texto="Consecuencia estimada por la IA si esta propuesta se deja vencer sin firmar ni denegar. Es el contrapeso del riesgo: no actuar también cuesta."
              />
            </p>
            <p className="mt-1 text-sm leading-snug text-foreground">{d.costeDeNoActuar}</p>
          </div>
        )}

        <PanelEvidencia evidencia={d.evidencia} />

        <DoctrinaAplicada reglasAplicadas={d.reglasAplicadas} doctrina={doctrina} />

        <EfectoDomino domino={tarjeta.domino} />

        <PlanEjecucion
          plan={tarjeta.plan}
          estado={d.estado}
          resultados={d.resultadoEjecucion}
          procesadoPor={d.procesadoPor}
        />

        <AudiosAlerta audios={d.audiosAlerta} mensajePropuesto={tarjeta.plan.mensajeAlerta} estado={d.estado} />

        {informeId && onVerInforme && (
          <Tooltip
            className="w-full"
            titulo="Acta de decisión"
            contenido="Documento firmado con la propuesta, la evidencia usada, quién decidió y el resultado de cada acción. Sirve como traza para la auditoría posterior."
          >
            <button type="button" onClick={() => onVerInforme(informeId)} className="boton boton-secundario boton-sm w-full">
              <FileText className="size-3.5" aria-hidden /> Ver acta de decisión
            </button>
          </Tooltip>
        )}

        <p className="text-center font-mono text-[11px] text-subtle">
          {d.id} · propuesta {formatearHora(d.creadaEn)}
        </p>
      </div>

      {pendiente && (
        <ZonaAccion
          key={`accion-${d.id}`}
          riesgo={d.riesgo}
          rol={rol}
          escaladaA={d.escaladaA}
          ahora={ahora}
          onAprobar={onAprobar}
          onDenegar={onDenegar}
          onEscalar={onEscalar}
        />
      )}
    </section>
  );
}
