"use client";
// "Vista de agentes": tablero a pantalla completa con todos los agentes y su
// última traza, para que se vea el sistema pensar en directo. DUEÑO: constructor E.

import { useEffect } from "react";
import { Bot, X } from "lucide-react";
import type { Snapshot } from "@/lib/dominio/tipos";
import { numero } from "@/lib/cliente/formato";
import { Boton } from "@/components/ui/Boton";
import { Insignia } from "@/components/ui/Insignia";
import { Vacio } from "@/components/ui/Vacio";
import { ORDEN_CATEGORIAS, TEXTO_CATEGORIA, TarjetaAgente, useAccionesAgente } from "./TarjetaAgente";

export function VistaAgentes({ snapshot, abierta, onCerrar, onRefrescar }: { snapshot?: Snapshot; abierta: boolean; onCerrar: () => void; onRefrescar?: () => void }) {
  const { ejecutar, ocupado } = useAccionesAgente(onRefrescar);
  const agentes = snapshot?.agentes ?? [];

  useEffect(() => {
    if (!abierta) return;
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", alTeclado);
    return () => document.removeEventListener("keydown", alTeclado);
  }, [abierta, onCerrar]);

  if (!abierta) return null;

  const mundoPausado = Boolean(snapshot?.reloj.pausado);
  const pensando = mundoPausado ? 0 : agentes.filter((a) => a.trazas?.[a.trazas.length - 1]?.estado === "en_curso").length;
  const conError = agentes.filter((a) => a.estado === "error").length;
  const llamadas = agentes.reduce((n, a) => n + (a.trazas ?? []).reduce((m, t) => m + t.llamadasIA.length, 0), 0);

  return (
    <div className="fixed inset-0 z-[1400] flex flex-col bg-background">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-panel-border bg-panel px-3 py-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Bot className="size-5 text-brand" aria-hidden /> Vista de agentes
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Insignia tono="neutro">{numero(agentes.length)} agentes</Insignia>
          {mundoPausado ? (
            <Insignia tono="aviso" punto>
              MUNDO EN PAUSA · los {numero(agentes.length)} están parados
            </Insignia>
          ) : null}
          <Insignia tono={pensando > 0 ? "marca" : "neutro"} punto={pensando > 0}>
            {numero(pensando)} pensando ahora
          </Insignia>
          <Insignia tono="info">{numero(llamadas)} llamadas de IA registradas</Insignia>
          {conError > 0 ? <Insignia tono="peligro">{numero(conError)} con error</Insignia> : null}
        </div>
        <Boton className="ml-auto" icono={<X />} onClick={onCerrar}>
          Cerrar (Esc)
        </Boton>
      </header>

      <div className="flex-1 overflow-y-auto p-3 scroll-fino">
        {agentes.length === 0 ? (
          <Vacio
            icono={<Bot />}
            titulo="Todavía no hay agentes registrados"
            guia="El orquestador los publica al arrancar el proceso. Comprueba la salud de los servicios en la barra superior."
          />
        ) : (
          <div className="space-y-4">
            {ORDEN_CATEGORIAS.map((categoria) => {
              const grupo = agentes.filter((a) => a.categoria === categoria);
              if (grupo.length === 0) return null;
              return (
                <section key={categoria}>
                  <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-subtle">
                    {TEXTO_CATEGORIA[categoria]} · {grupo.length}
                  </h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {grupo.map((a) => (
                      <TarjetaAgente key={a.id} agente={a} ejecutar={ejecutar} ocupado={ocupado} destacado mundoPausado={mundoPausado} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
