"use client";
// Ficha de una unidad en el mapa: quién es, qué lleva, dónde va, cuándo llega
// y —lo que faltaba— QUÉ ORDEN HA RECIBIDO y QUIÉN LA HA AVISADO.
// DUEÑO: constructor H.

import { useState } from "react";
import { Crosshair, MessageSquare, Navigation, PhoneOff, Undo2 } from "lucide-react";
import type { Incendio, Unidad } from "@/lib/dominio/tipos";
import { distancia, fechaHora, haceCuanto, hora, numero } from "@/lib/cliente/formato";
import { urlOsm, urlOsmPunto } from "@/lib/cliente/enlaces";
import { EnlaceExterno } from "@/components/ui/Enlace";
import { Boton } from "@/components/ui/Boton";
import { Insignia, TEXTO_ESTADO_UNIDAD, tonoEstadoUnidad } from "@/components/ui/Insignia";
import { TEXTO_TIPO_UNIDAD } from "./simbologia";

export interface AccionesUnidad {
  /** Entra en modo "clic en el mapa para elegir el destino" de esta unidad. */
  onOrdenarDestino?: (u: Unidad) => void;
  onRetirar?: (u: Unidad) => void | Promise<void>;
  onCentrar?: (u: Unidad) => void;
}

export function FichaUnidad({
  unidad: u,
  incendio,
  onOrdenarDestino,
  onRetirar,
  onCentrar,
}: { unidad: Unidad; incendio?: Incendio } & AccionesUnidad) {
  const [ocupado, setOcupado] = useState(false);
  const enRuta = u.estado === "en_ruta" || u.estado === "regreso";
  const enBase = u.estado === "disponible";

  return (
    <div className="w-[17rem] max-w-full">
      <p className="text-[13px] font-semibold leading-tight text-foreground">{u.nombre}</p>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-[11px] text-muted">
        <span>{TEXTO_TIPO_UNIDAD[u.tipo]} · base:</span>
        {/* La base sale de OpenStreetMap: se puede comprobar el parque real. */}
        <EnlaceExterno
          href={urlOsm(u.base.osmId ?? u.id) ?? urlOsmPunto(u.base.punto.lat, u.base.punto.lon, 17)}
          className="text-[11px]"
          claseTexto=""
          titulo={`Ver ${u.base.nombre} en OpenStreetMap`}
        >
          {u.base.nombre}
        </EnlaceExterno>
      </p>

      <div className="mt-1.5 flex flex-wrap gap-1">
        <Insignia pequena tono={tonoEstadoUnidad(u.estado)} punto>
          {TEXTO_ESTADO_UNIDAD[u.estado]}
        </Insignia>
        <Insignia pequena tono="neutro">
          {numero(u.dotacion.personas)} personas · {numero(u.dotacion.vehiculos)} vehículos
        </Insignia>
        {u.sector ? <Insignia pequena tono="info">Sector {u.sector}</Insignia> : null}
      </div>
      {u.dotacion.descripcion ? <p className="mt-1 text-[11px] leading-snug text-muted">{u.dotacion.descripcion}</p> : null}

      {incendio ? (
        <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
          Asignada a <span className="font-medium text-foreground">{incendio.nombre}</span>
          {incendio.municipio ? ` · ${incendio.municipio}` : ""}
        </p>
      ) : enBase ? (
        <p className="mt-1.5 text-[11.5px] leading-snug text-muted">En su base, disponible: todavía no la ha pedido nadie.</p>
      ) : null}

      {u.ruta && enRuta ? (
        <p className="mt-1 rounded-lg border border-panel-border bg-panel-2 px-2 py-1 text-[11.5px] leading-snug text-foreground">
          {u.estado === "regreso" ? "Vuelve a base" : "En ruta"} · {distancia(u.ruta.distanciaM / 1000)} por carretera ·{" "}
          <span className="font-semibold">llega a las {hora(u.ruta.llegadaPrevista)}</span> (hora de mundo) ·{" "}
          {numero((u.ruta.progreso ?? 0) * 100, 0)} % recorrido
        </p>
      ) : null}

      {/* ---- Órdenes y avisos: la trazabilidad que pedía el mando ---------- */}
      <section className="mt-2 rounded-lg border border-panel-border bg-panel-2 p-2">
        <h4 className="text-[10.5px] font-semibold uppercase tracking-wide text-subtle">Órdenes y avisos</h4>
        {u.ultimaOrden ? (
          <p className="mt-1 text-[11.5px] leading-snug text-foreground">
            <Navigation className="mr-1 inline size-3 text-brand" aria-hidden />
            {u.ultimaOrden.texto}
            <span className="block text-[10.5px] text-subtle">
              Autorizada por {u.ultimaOrden.decisionId === "manual" ? "la sala de mando" : u.ultimaOrden.decisionId} ·{" "}
              {fechaHora(u.ultimaOrden.en)} (hora de mundo)
            </span>
          </p>
        ) : (
          <p className="mt-1 text-[11.5px] leading-snug text-muted">Sin ninguna orden todavía.</p>
        )}

        {u.ultimoContacto ? (
          <p className="mt-1.5 text-[11.5px] leading-snug text-foreground">
            <MessageSquare className="mr-1 inline size-3 text-info" aria-hidden />
            <span className="font-medium capitalize">{u.ultimoContacto.canal}</span>: {u.ultimoContacto.resultado}
            <span className="block text-[10.5px] text-subtle">{haceCuanto(u.ultimoContacto.en)}</span>
          </p>
        ) : (
          <p className="mt-1.5 flex items-start gap-1 text-[11.5px] leading-snug text-warning">
            <PhoneOff className="mt-px size-3 shrink-0" aria-hidden />
            No avisada por ningún canal: solo tiene la orden en el sistema.
          </p>
        )}
      </section>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {onOrdenarDestino ? (
          <Boton tamano="sm" variante="primario" icono={<Navigation />} onClick={() => onOrdenarDestino(u)}>
            Ordenar destino
          </Boton>
        ) : null}
        {onRetirar && u.estado !== "disponible" ? (
          <Boton
            tamano="sm"
            variante="secundario"
            icono={<Undo2 />}
            cargando={ocupado}
            onClick={async () => {
              setOcupado(true);
              try {
                await onRetirar(u);
              } finally {
                setOcupado(false);
              }
            }}
          >
            Retirar
          </Boton>
        ) : null}
        {onCentrar ? (
          <Boton tamano="sm" variante="fantasma" icono={<Crosshair />} onClick={() => onCentrar(u)}>
            Centrar
          </Boton>
        ) : null}
      </div>
    </div>
  );
}
