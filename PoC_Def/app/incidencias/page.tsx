"use client";
// =====================================================================
// ATALAYA INCENDIOS · Índice de incidencias
// ---------------------------------------------------------------------
// DUEÑO: constructor G. La lista de focos de la ejecución (activos primero)
// con lo justo para elegir: estado, nivel, superficie, frente, pueblos en
// riesgo, medios y qué espera al mando. Cada tarjeta abre su visor.
// =====================================================================

import Link from "next/link";
import { ArrowLeft, ArrowRight, Download, Flame } from "lucide-react";
import type { EstadoIncendio, Incendio, Snapshot } from "@/lib/dominio/tipos";
import { useEstado } from "@/lib/cliente/useEstado";
import { urlExpedienteIncidencia } from "@/lib/cliente/api";
import { distancia, haceCuanto, hectareas, minutos, numero, rumboFrase, viento } from "@/lib/cliente/formato";
import { Boton } from "@/components/ui/Boton";
import {
  Insignia,
  TEXTO_ESTADO_INCENDIO,
  TEXTO_PELIGRO,
  TEXTO_RIESGO,
  tonoEstadoIncendio,
  tonoPeligro,
  tonoRiesgo,
} from "@/components/ui/Insignia";
import { Vacio } from "@/components/ui/Vacio";
import { Marca } from "@/components/marca/Logo";
import { SelectorTema } from "@/components/marca/SelectorTema";

/** Cuanto más bajo, más arriba en la lista: lo que arde manda. */
const PESO_ESTADO: Record<EstadoIncendio, number> = {
  activo: 0,
  confirmado: 1,
  detectado: 2,
  estabilizado: 3,
  controlado: 4,
  extinguido: 5,
  descartado: 6,
  fusionado: 7,
};

export default function Incidencias() {
  const { snapshot, cargando } = useEstado();
  const incendios = [...(snapshot?.incendios ?? [])].sort(
    (a, b) => PESO_ESTADO[a.estado] - PESO_ESTADO[b.estado] || b.nivelGravedad - a.nivelGravedad || b.detectadoEn.localeCompare(a.detectadoEn),
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-3 border-b border-panel-border pb-2">
        <Link href="/" className="rounded-lg">
          <Marca organismo="Incidencias · un visor por foco" />
        </Link>
        <Link href="/" className="ml-auto">
          <Boton icono={<ArrowLeft />}>Volver a la sala</Boton>
        </Link>
        <SelectorTema compacto />
      </header>

      <p className="text-[13px] leading-snug text-muted">
        Cada incidencia tiene su visor: el flujo de los agentes que están interviniendo, el hilo en vivo de comunicaciones y decisiones, el
        informe en vivo y el expediente completo para auditarlo.
      </p>

      {incendios.length === 0 ? (
        <Vacio
          icono={<Flame />}
          titulo={cargando ? "Cargando las incidencias…" : "Ninguna incidencia declarada"}
          guia="Declara un foco desde la sala de mando (tecla F o clic en el mapa) y aparecerá aquí en cuanto el núcleo lo enriquezca."
          accion={
            <Link href="/">
              <Boton variante="primario" icono={<Flame />}>
                Ir a la sala de mando
              </Boton>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {incendios.map((i) => (
            <li key={i.id}>
              <FichaIncidencia incendio={i} snapshot={snapshot} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FichaIncidencia({ incendio: inc, snapshot }: { incendio: Incendio; snapshot?: Snapshot }) {
  const unidades = (snapshot?.unidades ?? []).filter((u) => u.incendioId === inc.id);
  const poblaciones = (snapshot?.poblaciones ?? []).filter((p) => p.incendioId === inc.id).sort((a, b) => (a.etaFrenteMin ?? 1e9) - (b.etaFrenteMin ?? 1e9));
  const decisiones = (snapshot?.decisiones ?? []).filter((d) => d.incendioId === inc.id);
  const pendientes = decisiones.filter((d) => d.estado === "pendiente_humano" || d.estado === "escalada");
  const comunicaciones = decisiones.flatMap((d) => d.acciones).filter((a) => a.resultado);
  const fallos = comunicaciones.filter((a) => a.resultado && !a.resultado.exito).length;

  return (
    <article className="rounded-xl border border-panel-border bg-panel p-3">
      <header className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold leading-tight text-foreground">{inc.nombre}</h2>
          <p className="mt-0.5 text-[11.5px] text-muted">
            {inc.municipio || "Municipio por determinar"}
            {inc.provincia ? ` · ${inc.provincia}` : ""} · detectado {haceCuanto(inc.detectadoEn)} por {inc.origen}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <a href={urlExpedienteIncidencia(inc.id)} download>
            <Boton tamano="sm" variante="fantasma" icono={<Download />}>
              Expediente
            </Boton>
          </a>
          <Link href={`/incidencias/${encodeURIComponent(inc.id)}`}>
            <Boton tamano="sm" variante="primario" icono={<ArrowRight />}>
              Abrir visor
            </Boton>
          </Link>
        </div>
      </header>

      <div className="mt-1.5 flex flex-wrap gap-1">
        <Insignia pequena tono={tonoEstadoIncendio(inc.estado)} punto>
          {TEXTO_ESTADO_INCENDIO[inc.estado]}
        </Insignia>
        <Insignia pequena tono={inc.nivelGravedad >= 2 ? "peligro" : "neutro"}>Nivel {inc.nivelGravedad}</Insignia>
        <Insignia pequena tono="neutro">{hectareas(inc.areaHa)}</Insignia>
        {inc.peligro ? (
          <Insignia pequena tono={tonoPeligro(inc.peligro.nivel)} title={inc.peligro.motivo}>
            {TEXTO_PELIGRO[inc.peligro.nivel]} ({numero(inc.peligro.valor)})
          </Insignia>
        ) : null}
        <Insignia pequena tono="neutro">{unidades.length} unidades</Insignia>
        <Insignia pequena tono="neutro">{decisiones.length} decisiones</Insignia>
        <Insignia pequena tono={fallos ? "peligro" : "neutro"}>
          {comunicaciones.length} acciones ejecutadas{fallos ? ` · ${fallos} con fallo` : ""}
        </Insignia>
        {pendientes.length ? (
          <Insignia pequena tono="aviso" punto>
            {pendientes.length} esperando al mando
          </Insignia>
        ) : null}
      </div>

      {inc.frente ? (
        <p className="mt-1.5 text-[12.5px] leading-snug text-muted">
          Frente {rumboFrase(inc.frente.rumboGrados, inc.frente.rumboTexto)} a {numero(inc.frente.velocidadMmin, 1)} m/min
          {inc.meteo ? ` · viento ${viento(inc.meteo.direccionGrados, inc.meteo.vientoKmh, inc.meteo.rachasKmh, inc.meteo.direccionTexto)}` : ""}
        </p>
      ) : null}

      {poblaciones.length ? (
        <p className="mt-1 flex flex-wrap items-center gap-1 text-[12px] text-muted">
          {poblaciones.slice(0, 4).map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1">
              <Insignia pequena tono={tonoRiesgo(p.riesgo)}>{TEXTO_RIESGO[p.riesgo]}</Insignia>
              {p.nombre} a {distancia(p.distanciaKm)}
              {p.etaFrenteMin !== undefined ? ` (${minutos(p.etaFrenteMin)})` : ""}
            </span>
          ))}
          {poblaciones.length > 4 ? <span className="text-subtle">y {poblaciones.length - 4} más</span> : null}
        </p>
      ) : null}
    </article>
  );
}
