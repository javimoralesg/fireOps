"use client";
// Pestaña "Agentes": todos los agentes agrupados por categoría, con su última
// traza y sus controles. DUEÑO: constructor E.

import { memo, useMemo } from "react";
import { Bot } from "lucide-react";
import type { EstadoAgenteApp } from "@/lib/dominio/tipos";
import { Vacio } from "@/components/ui/Vacio";
import { ORDEN_CATEGORIAS, TEXTO_CATEGORIA, TarjetaAgente, useAccionesAgente } from "./TarjetaAgente";

/** Lista vacía compartida: evita crear un array nuevo (y romper memos) por render. */
const VACIO: never[] = [];

function PestanaAgentesBase({
  agentes: lista,
  onTrasAccion,
  mundoPausado = false,
  amplio = false,
}: {
  agentes?: readonly EstadoAgenteApp[];
  onTrasAccion?: () => void;
  /** Con el mundo en pausa TODOS se pintan como pausados, no solo los suyos. */
  mundoPausado?: boolean;
  /** Panel ampliado a pantalla completa: rejilla de tarjetas como en la vista de agentes. */
  amplio?: boolean;
}) {
  const { ejecutar, ocupado } = useAccionesAgente(onTrasAccion);
  const agentes = lista ?? VACIO;
  /** Agrupación por categoría: una pasada memoizada en vez de un filtro por grupo. */
  const grupos = useMemo(() => {
    const mapa = new Map<string, EstadoAgenteApp[]>();
    for (const a of agentes) {
      const grupo = mapa.get(a.categoria);
      if (grupo) grupo.push(a);
      else mapa.set(a.categoria, [a]);
    }
    return mapa;
  }, [agentes]);

  if (agentes.length === 0) {
    return (
      <Vacio
        icono={<Bot />}
        titulo="Los agentes aún no se han registrado"
        guia="El orquestador los publica al arrancar. Si esto no cambia en unos segundos, revisa el estado de los servicios en la barra superior."
      />
    );
  }

  return (
    <div className="space-y-3">
      {mundoPausado ? (
        <p className="rounded-xl border border-warning/50 bg-warning/12 px-2.5 py-2 text-[12.5px] font-medium leading-snug text-warning">
          Mundo en pausa: los {agentes.length} agentes están detenidos y no se hace ninguna llamada a la IA. Pulsa Reanudar o la barra
          espaciadora.
        </p>
      ) : null}
      {ORDEN_CATEGORIAS.map((categoria) => {
        const grupo = grupos.get(categoria);
        if (!grupo || grupo.length === 0) return null;
        return (
          <section key={categoria}>
            <h3 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-subtle">
              {TEXTO_CATEGORIA[categoria]}
              <span className="tabular font-normal">{grupo.length}</span>
            </h3>
            <div className={amplio ? "grid gap-2 @min-[40rem]:grid-cols-2 @7xl:grid-cols-3 @min-[96rem]:grid-cols-4" : "space-y-1.5"}>
              {grupo.map((a) => (
                <TarjetaAgente key={a.id} agente={a} ejecutar={ejecutar} ocupado={ocupado} mundoPausado={mundoPausado} destacado={amplio} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export const PestanaAgentes = memo(PestanaAgentesBase);
