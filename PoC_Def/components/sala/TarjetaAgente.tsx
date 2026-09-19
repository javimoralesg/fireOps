"use client";
// Tarjeta de un agente: estado, tarea actual, contadores, última traza y
// controles (pausar / asumir el control / forzar ciclo). DUEÑO: constructor E.

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ExternalLink, Hand, Pause, Play, RefreshCw, Unlock } from "lucide-react";
import type { CategoriaAgente, EstadoAgente, EstadoAgenteApp } from "@/lib/dominio/tipos";
import { accionAgente, mensajeDeError, type AccionAgente } from "@/lib/cliente/api";
import { haceCuanto, numero } from "@/lib/cliente/formato";
import { Boton } from "@/components/ui/Boton";
import { Insignia } from "@/components/ui/Insignia";
import { useToast } from "@/components/ui/Toast";
import { ResumenTraza } from "./TrazaAgente";

export const TEXTO_CATEGORIA: Record<CategoriaAgente, string> = {
  percepcion: "Percepción",
  analisis: "Análisis",
  planificacion: "Planificación",
  ejecucion: "Ejecución",
  comunicacion: "Comunicación",
  supervision: "Supervisión",
  aprendizaje: "Aprendizaje",
};

/** Orden en el que se muestran las categorías: como fluye el trabajo. */
export const ORDEN_CATEGORIAS: CategoriaAgente[] = [
  "percepcion",
  "analisis",
  "planificacion",
  "ejecucion",
  "comunicacion",
  "supervision",
  "aprendizaje",
];

export const TEXTO_ESTADO_AGENTE: Record<EstadoAgente, string> = {
  inactivo: "En espera",
  observando: "Observando",
  razonando: "Razonando",
  actuando: "Actuando",
  esperando_humano: "Esperando a un humano",
  pausado: "Pausado",
  error: "Con error",
};

export function tonoEstadoAgente(e: EstadoAgente): "peligro" | "aviso" | "exito" | "info" | "marca" | "neutro" {
  if (e === "error") return "peligro";
  if (e === "esperando_humano") return "aviso";
  if (e === "razonando") return "marca";
  if (e === "actuando") return "info";
  if (e === "observando") return "exito";
  return "neutro";
}

/** Ejecuta una acción de control sobre un agente y avisa del resultado. */
export function useAccionesAgente(alTerminar?: () => void) {
  const toast = useToast();
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function ejecutar(agente: EstadoAgenteApp, accion: AccionAgente) {
    setOcupado(`${agente.id}:${accion}`);
    try {
      await accionAgente(agente.id, accion);
      const frases: Record<AccionAgente, string> = {
        pausar: `${agente.nombre} en pausa`,
        reanudar: `${agente.nombre} reanudado`,
        asumir: `Has asumido el control de ${agente.nombre}`,
        liberar: `${agente.nombre} vuelve a decidir solo`,
        ciclo: `Ciclo forzado en ${agente.nombre}`,
      };
      toast.exito(frases[accion]);
      alTerminar?.();
    } catch (e) {
      toast.error(`No se pudo ${accion} ${agente.nombre}`, mensajeDeError(e));
    } finally {
      setOcupado(null);
    }
  }

  return { ejecutar, ocupado };
}

export function ControlesAgente({
  agente,
  ejecutar,
  ocupado,
  tamano = "sm",
}: {
  agente: EstadoAgenteApp;
  ejecutar: (a: EstadoAgenteApp, accion: AccionAgente) => void | Promise<void>;
  ocupado: string | null;
  tamano?: "sm" | "md";
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Boton
        tamano={tamano}
        variante="secundario"
        icono={agente.pausado ? <Play /> : <Pause />}
        cargando={ocupado === `${agente.id}:${agente.pausado ? "reanudar" : "pausar"}`}
        onClick={() => ejecutar(agente, agente.pausado ? "reanudar" : "pausar")}
      >
        {agente.pausado ? "Reanudar" : "Pausar"}
      </Boton>
      <Boton
        tamano={tamano}
        variante={agente.controlHumano ? "primario" : "secundario"}
        icono={agente.controlHumano ? <Unlock /> : <Hand />}
        cargando={ocupado === `${agente.id}:${agente.controlHumano ? "liberar" : "asumir"}`}
        onClick={() => ejecutar(agente, agente.controlHumano ? "liberar" : "asumir")}
      >
        {agente.controlHumano ? "Liberar control" : "Asumir control"}
      </Boton>
      <Boton
        tamano={tamano}
        variante="fantasma"
        icono={<RefreshCw />}
        cargando={ocupado === `${agente.id}:ciclo`}
        onClick={() => ejecutar(agente, "ciclo")}
      >
        Forzar ciclo
      </Boton>
    </div>
  );
}

export function TarjetaAgente({
  agente,
  ejecutar,
  ocupado,
  conEnlace = true,
  destacado = false,
  mundoPausado = false,
}: {
  agente: EstadoAgenteApp;
  ejecutar: (a: EstadoAgenteApp, accion: AccionAgente) => void | Promise<void>;
  ocupado: string | null;
  conEnlace?: boolean;
  destacado?: boolean;
  /** El mundo entero está en pausa: este agente está parado aunque no lo hayan pausado a él. */
  mundoPausado?: boolean;
}) {
  const ultima = agente.trazas?.[agente.trazas.length - 1];
  // Con el mundo en pausa el orquestador cancela los ciclos: nadie está pensando.
  const pensando = !mundoPausado && ultima?.estado === "en_curso";
  const parado = mundoPausado || agente.pausado || agente.estado === "pausado";

  return (
    <article
      className={[
        "rounded-xl border bg-panel p-2.5",
        agente.estado === "error" ? "border-danger/50" : parado ? "border-warning/45" : pensando ? "border-brand/50" : "border-panel-border",
        parado ? "bg-warning/[0.06]" : "",
        destacado ? "shadow-[var(--sombra-panel)]" : "",
      ].join(" ")}
    >
      <header className="flex items-start gap-2">
        <span
          aria-hidden
          className={[
            "mt-1 size-2.5 shrink-0 rounded-full",
            agente.estado === "error"
              ? "bg-danger"
              : parado
                ? "bg-warning"
                : pensando || agente.estado === "razonando"
                  ? "bg-brand latido"
                  : agente.estado === "actuando"
                    ? "bg-info latido"
                    : agente.estado === "esperando_humano"
                      ? "bg-warning latido"
                      : "bg-success",
          ].join(" ")}
        />
        <div className="min-w-0 flex-1">
          <h4 className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-semibold leading-tight text-foreground">
            {conEnlace ? (
              <Link href={`/agentes/${agente.id}`} className="hover:text-brand hover:underline">
                {agente.nombre}
              </Link>
            ) : (
              agente.nombre
            )}
            {conEnlace ? <ExternalLink className="size-3 text-subtle" aria-hidden /> : null}
          </h4>
          <p className={`mt-0.5 text-[12px] leading-snug ${parado ? "font-medium text-warning" : "text-muted"}`}>
            {mundoPausado
              ? "Mundo en pausa: sin ciclos ni llamadas a la IA."
              : agente.tareaActual || agente.descripcion || "Sin tarea asignada ahora mismo."}
          </p>
        </div>
        <span className="shrink-0 text-right text-[10.5px] leading-tight text-subtle">{haceCuanto(agente.ultimaActividad)}</span>
      </header>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Insignia pequena tono={parado ? "aviso" : tonoEstadoAgente(agente.estado)} punto>
          {mundoPausado ? "Pausado (mundo)" : agente.pausado ? "Pausado" : TEXTO_ESTADO_AGENTE[agente.estado]}
        </Insignia>
        {agente.controlHumano ? <Insignia pequena tono="aviso">Control humano</Insignia> : null}
        <Insignia pequena tono="neutro" title="Modelo de IA que usa este agente">
          {agente.modelo}
        </Insignia>
        <span className="tabular text-[10.5px] text-subtle">
          {numero(agente.contadores.ciclos)} ciclos · {numero(agente.contadores.decisiones)} decisiones ·{" "}
          {numero(agente.contadores.acciones)} acciones
          {agente.contadores.errores > 0 ? ` · ${numero(agente.contadores.errores)} errores` : ""}
        </span>
      </div>

      <div className="mt-1.5">
        <ResumenTraza traza={ultima} />
      </div>

      {agente.ultimoError ? (
        <p className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-2 py-1 text-[11.5px] leading-snug text-danger">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden /> {agente.ultimoError}
        </p>
      ) : null}

      <div className="mt-2">
        <ControlesAgente agente={agente} ejecutar={ejecutar} ocupado={ocupado} />
      </div>
    </article>
  );
}
