"use client";
// Estado y controles compartidos por las vistas del Centro de agentes.
// DUEÑO: constructor E.

import { useState } from "react";
import { Hand, Pause, Play, RefreshCw, Unlock } from "lucide-react";
import type { CategoriaAgente, EstadoAgente, EstadoAgenteApp } from "@/lib/dominio/tipos";
import { accionAgente, mensajeDeError, type AccionAgente } from "@/lib/cliente/api";
import { Boton } from "@/components/ui/Boton";
import { useToast } from "@/components/ui/Toast";

export const TEXTO_CATEGORIA: Record<CategoriaAgente, string> = {
  percepcion: "Percepción",
  analisis: "Análisis",
  planificacion: "Planificación",
  ejecucion: "Ejecución",
  comunicacion: "Comunicación",
  supervision: "Supervisión",
  aprendizaje: "Aprendizaje",
};

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
        // Con su fuente apagada por el escenario no corre de todos modos: pausarlo
        // solo confundiría (y reanudarlo no lo arrancaría).
        disabled={Boolean(agente.desactivadoPorEscenario) && !agente.pausado}
        title={agente.desactivadoPorEscenario && !agente.pausado ? `Sin ciclos: la fuente «${agente.desactivadoPorEscenario}» está apagada por el escenario` : undefined}
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
