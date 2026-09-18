"use client";

// La decisión que hay que tomar ahora: qué propone la IA, por qué, qué pasará
// si no se actúa, qué se hará y los botones para firmar o corregir. Una sola
// tarjeta, en lenguaje llano; el expediente completo queda en /auditoria.

import Link from "next/link";
import { ArrowRight, BookMarked, Clock3, FileText, Flame, ListChecks, ScanSearch, ShieldCheck, Signature, TriangleAlert } from "lucide-react";
import type { Decision, ReglaDoctrina } from "@/lib/tipos-sistema";
import { escalarA, etiquetaRol, puede } from "@/lib/permisos";
import { ROLES, type RolId } from "@/lib/roles";
import { BannerEstado } from "@/components/decision/BannerEstado";
import { Countdown } from "@/components/decision/Indicadores";
import { ESTADO_UI, URGENCIA_UI } from "@/components/decision/ui";
import { ZonaAccion } from "@/components/decision/ZonaAccion";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { SelloCompetencia } from "@/components/politica/SelloCompetencia";
import { veredictoDe } from "@/components/politica/ui";
import { POLITICA_VACIA, type PoliticaAutonomia } from "@/lib/politica-autonomia";
import { formatearDuracion, msHasta } from "@/components/decision/ui";
import { fuentePlano, haceTiempo, recortar } from "./texto";

interface Props {
  decision?: Decision;
  /** Pendientes ordenadas por urgencia (la primera es la que se muestra por defecto). */
  pendientes: Decision[];
  doctrina: ReglaDoctrina[];
  rol: RolId;
  ahora: number;
  umbralAutonomia: number;
  /** Política de autonomía (quién gestiona cada tipo de actuación); sin ella se usa el catálogo por defecto. */
  politica?: PoliticaAutonomia | null;
  onSeleccionar: (id: string) => void;
  onAprobar: () => Promise<void>;
  onDenegar: (feedback: string, ambito: "incidente" | "global") => Promise<void>;
  onEscalar?: (a: RolId) => Promise<void>;
  onVerInforme?: (informeId: string) => void;
  onVerHistorial: () => void;
}

function palabraRiesgo(r: number) {
  if (r >= 75) return { texto: "muy alto", cls: "text-danger" };
  if (r >= 50) return { texto: "alto", cls: "text-warning" };
  if (r >= 25) return { texto: "medio", cls: "text-foreground" };
  return { texto: "bajo", cls: "text-success" };
}

export function DecisionAhora({ decision: d, pendientes, doctrina, rol, ahora, umbralAutonomia, politica, onSeleccionar, onAprobar, onDenegar, onEscalar, onVerInforme, onVerHistorial }: Props) {
  if (!d) {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-2.5 p-8 text-center" aria-label="Sin decisiones">
        <span className="flex size-12 items-center justify-center rounded-full bg-brand/10" aria-hidden>
          <ListChecks className="size-6 text-brand" />
        </span>
        <p className="text-[15px] font-semibold text-foreground">No hay decisiones pendientes</p>
        <p className="max-w-sm text-[13px] leading-relaxed text-muted">
          La IA avisará aquí en cuanto necesite una firma: verás la propuesta, en qué se basa y qué se hará. Mientras tanto, la situación y los
          acontecimientos se actualizan solos.
        </p>
        <button type="button" onClick={onVerHistorial} className="boton boton-secundario boton-sm mt-1">
          Ver las decisiones ya resueltas
        </button>
      </section>
    );
  }

  const pendiente = d.estado === "pendiente";
  const urg = URGENCIA_UI[d.urgencia] ?? URGENCIA_UI.media;
  const est = ESTADO_UI[d.estado] ?? ESTADO_UI.pendiente;
  const IconoEstado = est.icono;
  const otras = pendientes.filter((p) => p.id !== d.id);
  const riesgo = palabraRiesgo(d.riesgo);
  const autonoma = d.estado === "auto" || d.riesgo <= umbralAutonomia;
  const firma = d.decididaPor && d.estado !== "auto" ? etiquetaRol(d.decididaPor.rol) : autonoma ? "la propia IA" : ROLES[escalarA(d.riesgo)].nombre;
  const evidencia = d.evidencia.slice(0, 4);
  const restoEvidencia = Math.max(0, d.evidencia.length - evidencia.length);
  const reglas = doctrina.filter((r) => d.reglasAplicadas.includes(r.id));
  const resultados = d.resultadoEjecucion ?? [];
  const { tarjeta } = d;
  const competencia = veredictoDe(d, politica ?? POLITICA_VACIA, umbralAutonomia).veredicto;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={`Decisión: ${tarjeta.titulo}`}>
      {/* Cabecera: qué es esto y cuánto tiempo queda */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-panel-border px-5 py-3">
        <span className="etiqueta flex items-center gap-1.5">
          {pendiente ? (
            <>
              <Signature className="size-3.5 text-brand" aria-hidden /> Decisión pendiente de firma
            </>
          ) : (
            <span className={`flex items-center gap-1.5 normal-case tracking-normal ${est.color}`}>
              <IconoEstado className={`size-3.5 ${est.girar ? "animate-spin" : ""}`} aria-hidden /> {est.etiqueta}
            </span>
          )}
        </span>
        <Tooltip
          titulo={`Urgencia ${urg.etiqueta.toLowerCase()}`}
          contenido="Con qué prioridad hay que mirar esta propuesta. La urgencia ordena; el riesgo decide quién firma."
        >
          <span className={urg.badge}>{urg.etiqueta}</span>
        </Tooltip>
        {pendiente &&
          (msHasta(d.plazo, ahora) > 0 ? (
            <span className="ml-auto flex items-center gap-1.5 text-sm">
              <Tooltip
                titulo="Plazo para decidir"
                contenido="Cuándo deja de tener sentido decidir: pasado el plazo, los datos que sostienen la propuesta ya no describen la situación."
              >
                <span className="flex items-center gap-1.5 text-muted">
                  <Clock3 className="size-4 text-subtle" aria-hidden />
                  quedan
                </span>
              </Tooltip>
              <Countdown plazo={d.plazo} ahora={ahora} className="text-base" />
            </span>
          ) : (
            <Tooltip
              className="ml-auto"
              titulo="Plazo vencido"
              contenido="La ventana en la que esta decisión todavía cambiaba algo ha pasado. Se puede firmar igual, pero conviene revisar antes la evidencia."
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold text-danger">
                <Clock3 className="size-4" aria-hidden />
                Plazo vencido {haceTiempo(d.plazo, ahora)}
              </span>
            </Tooltip>
          ))}
        {!pendiente && (
          <span className="ml-auto text-xs text-subtle">propuesta {haceTiempo(d.creadaEn, ahora)}</span>
        )}
      </header>

      {/* Otras pendientes: para cambiar sin buscar en ninguna lista */}
      {otras.length > 0 && (
        <div className="scroll-thin flex shrink-0 items-center gap-2 overflow-x-auto border-b border-panel-border bg-panel-2/60 px-5 py-2 text-xs">
          <span className="shrink-0 text-muted">{pendiente ? "También pendientes:" : "Pendiente de firma:"}</span>
          {otras.map((p) => {
            const u = URGENCIA_UI[p.urgencia] ?? URGENCIA_UI.media;
            const restante = msHasta(p.plazo, ahora);
            const vencida = restante <= 0;
            const tiempo = Number.isFinite(restante) ? (vencida ? "vencida" : formatearDuracion(restante)) : "—";
            return (
              <Tooltip
                key={p.id}
                className="shrink-0"
                titulo={p.tarjeta.titulo}
                contenido={
                  <>
                    Urgencia {u.etiqueta.toLowerCase()} · {vencida ? "el plazo ya ha vencido" : `quedan ${tiempo} para decidir`}. Pulsa para verla y firmarla.
                  </>
                }
                lado="abajo"
              >
                <button type="button" onClick={() => onSeleccionar(p.id)} className="chip min-h-8 max-w-[260px] gap-2">
                  <span className={`size-2 shrink-0 rounded-full ${u.franja}`} aria-hidden />
                  <span className="min-w-0 truncate">{p.tarjeta.titulo}</span>
                  <Countdown plazo={p.plazo} ahora={ahora} sinTooltip className="shrink-0 text-[10.5px]" />
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}

      <div key={`cuerpo-${d.id}`} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <BannerEstado decision={d} doctrina={doctrina} ahora={ahora} umbralAutonomia={umbralAutonomia} />

        <h1 className="mt-1.5 text-[20px] font-semibold leading-snug text-foreground">{tarjeta.titulo}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          {/* Quién gestiona esta decisión y por qué: sello de la política + enlace a la política completa */}
          <SelloCompetencia veredicto={competencia} />
          <Tooltip
            titulo="Política de la IA"
            contenido="Qué tipo de actuaciones puede ejecutar la IA sola y cuáles necesitan firma humana, con el umbral de riesgo vigente. Ábrela para ver la matriz completa."
          >
            <Link href="/politica" className="pildora hover:border-brand/40 hover:text-brand">
              <ShieldCheck className="size-3" aria-hidden />
              Política de la IA
            </Link>
          </Tooltip>
        </p>
        <p className="mt-2.5 text-[14px] leading-relaxed text-muted">{tarjeta.resumen}</p>

        {d.costeDeNoActuar && (
          <div className="mt-4 flex items-start gap-2.5 rounded-[10px] border border-danger/30 bg-danger/8 px-3.5 py-2.5">
            <Flame className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            <p className="text-sm leading-snug text-foreground">
              <span className="font-semibold text-danger">Si no se actúa: </span>
              {d.costeDeNoActuar}
            </p>
          </div>
        )}

        {d.motivoInvalidacion && (
          <div className="mt-4 flex items-start gap-2.5 rounded-[10px] border border-warning/30 bg-warning/8 px-3.5 py-2.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-sm leading-snug text-foreground">{d.motivoInvalidacion}</p>
          </div>
        )}

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          {/* Por qué */}
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
              <ScanSearch className="size-4 shrink-0 text-brand" aria-hidden /> En qué se basa
              <Ayuda
                titulo="Evidencia de la propuesta"
                texto="Los datos concretos que ha usado la IA: sensores, avisos ciudadanos, imágenes, meteorología o prensa, cada uno con su fuente, su hora y la fiabilidad que le asigna el verificador."
              />
            </h3>
            <ul className="space-y-2">
              {evidencia.map((e) => (
                <li key={e.id} className="rounded-[10px] border border-panel-border bg-panel-2 px-3 py-2">
                  <p className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-semibold text-brand">{fuentePlano(e.fuente)}</span>
                    <Tooltip
                      titulo="Confianza del dato"
                      contenido={`Fiabilidad que el verificador asigna al dato: ${Math.round(e.confianza * 100)} %. Recibido ${haceTiempo(e.timestamp, ahora)}.`}
                      lado="izquierda"
                    >
                      <span className="shrink-0 font-mono text-[11px] text-subtle">{Math.round(e.confianza * 100)} %</span>
                    </Tooltip>
                  </p>
                  <p className="mt-0.5 text-[13px] leading-snug text-foreground">{recortar(e.descripcion, 150)}</p>
                </li>
              ))}
            </ul>
            {puede(rol, "interrogar_ia") && (
              <Link href={`/auditoria?decision=${encodeURIComponent(d.id)}`} className="boton boton-fantasma boton-sm mt-2 text-brand">
                {restoEvidencia > 0 ? `Ver los ${d.evidencia.length} datos y preguntar a la IA` : "Preguntar a la IA por qué"}
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            )}
          </div>

          {/* Qué se hará */}
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
              <ListChecks className="size-4 shrink-0 text-brand" aria-hidden /> Qué se hará
              <Ayuda
                titulo="Plan de actuación"
                texto="Las órdenes que saldrán en cuanto se firme, en orden y con el recurso responsable de cada una. Al ejecutarse, cada acción muestra debajo por qué canal salió y si se confirmó."
              />
            </h3>
            <ol className="space-y-2">
              {tarjeta.plan.acciones.map((a, i) => {
                const r = resultados.find((x) => x.accionId === a.id);
                return (
                  <li key={a.id} className="flex gap-2.5 rounded-[10px] border border-panel-border bg-panel-2 px-3 py-2">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/10 font-mono text-[11px] font-semibold text-brand">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] leading-snug text-foreground">
                        <span className="font-semibold">{a.recurso}</span>: {a.accion}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-subtle">
                        <Tooltip titulo="Tiempo estimado" contenido={`Lo que tardaría ${a.recurso} en estar actuando desde que se firma la orden.`}>
                          <span>en {a.eta}</span>
                        </Tooltip>
                        {r && (
                          <span className={r.ok ? "text-success" : "text-danger"}>
                            {r.ok ? "✓ " : "✗ "}
                            {r.proveedor === "Cuaderno" || r.canal === "interno"
                              ? "Cuaderno de mando"
                              : r.proveedor === "Ninguno"
                                ? "Sin canal · pendiente de envío manual"
                                : `${r.canal} ${r.ok ? "enviado" : "fallido"} · ${r.proveedor}`}
                          </span>
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* Riesgo · firma · protocolo · doctrina en una línea */}
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-panel-border pt-3 text-xs text-muted">
          <Tooltip
            titulo={`Riesgo ${d.riesgo} de 100`}
            contenido={`Daño potencial si la decisión fuera errónea. Hasta ${umbralAutonomia} la IA puede ejecutar sola; por encima firma una persona, y a más riesgo, cargo más alto.`}
          >
            <span>
              <span>Riesgo </span>
              <span className={`font-semibold ${riesgo.cls}`}>
                {riesgo.texto} <span className="font-mono">({d.riesgo})</span>
              </span>
            </span>
          </Tooltip>
          <Tooltip
            titulo="Quién firma"
            contenido={
              autonoma
                ? `Riesgo ${d.riesgo} por debajo del umbral de autonomía (${umbralAutonomia}): la IA puede ejecutarla sin esperar a nadie.`
                : `Riesgo ${d.riesgo} por encima del umbral de autonomía (${umbralAutonomia}), así que no la ejecuta la IA: hace falta la firma de un cargo con autoridad para ese nivel de riesgo.`
            }
          >
            <span>
              <span>{d.decididaPor && d.estado !== "auto" ? "Firmó " : autonoma ? "Firma " : "Firma mínima "}</span>
              <span className="font-semibold text-foreground">{firma}</span>
            </span>
          </Tooltip>
          {tarjeta.protocolo && (
            <Tooltip titulo={`Protocolo ${tarjeta.protocolo.codigo}`} contenido={`${tarjeta.protocolo.nombre}. La IA sigue sus pasos al construir el plan.`}>
              <span>
                <span>Protocolo </span>
                <span className="font-semibold text-foreground">{tarjeta.protocolo.codigo}</span>
              </span>
            </Tooltip>
          )}
          {reglas.length > 0 && (
            <Tooltip titulo="Doctrina aplicada" contenido={reglas.map((r) => `• ${r.reglaNormalizada}`).join("\n")}>
              <span className="flex items-center gap-1">
                <BookMarked className="size-3.5 text-brand" aria-hidden />
                <span className="font-semibold text-foreground">
                  {reglas.length} {reglas.length === 1 ? "regla aprendida" : "reglas aprendidas"}
                </span>
              </span>
            </Tooltip>
          )}
          {d.informeId && onVerInforme && (
            <Tooltip className="ml-auto" titulo="Acta de la decisión" contenido="Documento con lo que se decidió, quién lo firmó, con qué evidencia y qué se ejecutó.">
              <button type="button" onClick={() => onVerInforme(d.informeId!)} className="boton boton-fantasma boton-sm text-brand">
                <FileText className="size-3.5" aria-hidden /> Ver acta
              </button>
            </Tooltip>
          )}
        </div>

        {!pendiente && (
          <div className="mt-4 flex flex-wrap gap-2">
            {pendientes[0] && (
              <button type="button" onClick={() => onSeleccionar(pendientes[0].id)} className="boton boton-primario">
                Ir a la decisión pendiente <ArrowRight className="size-4" aria-hidden />
              </button>
            )}
            <button type="button" onClick={onVerHistorial} className="boton boton-secundario">
              Ver todas las decisiones
            </button>
          </div>
        )}
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
