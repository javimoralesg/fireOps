"use client";

// Portal público para la ciudadanía (rol "ciudadano", docs/roles.md).
// Solo muestra lo verificado y publicado: nunca decisiones pendientes ni eventos sin verificar.

import { MapaZona } from "./MapaZona";
import { CircleCheck, Phone, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/marca/Logo";
import { situacionLegible } from "./interpretar";
import { AireYViento, Avisos, BannerSituacion, NoticiasYBulos, Pie, PuedesAyudar, QueHacer } from "./Secciones";
import { useAhora, usePublico } from "./usePublico";

const CONTENEDOR = "mx-auto w-full max-w-[720px] px-4 lg:max-w-6xl lg:px-8";

function Actualizado({ recibidoEn, error, ahora }: { recibidoEn: number | null; error: boolean; ahora: number }) {
  const seg = recibidoEn ? Math.max(0, Math.round((ahora - recibidoEn) / 1000)) : null;
  const caido = error || (seg !== null && seg > 20);
  return (
    <p className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-panel-border bg-panel px-3 py-1.5 text-[13px] text-muted" role="status">
      <span className="relative flex size-2.5" aria-hidden="true">
        {!caido && seg !== null && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />}
        <span className={`relative inline-flex size-2.5 rounded-full ${caido ? "bg-warning" : seg === null ? "bg-subtle" : "bg-success"}`} />
      </span>
      {seg === null ? (error ? "Sin conexión" : "Conectando…") : caido ? `Reintentando · hace ${seg} s` : `Actualizado hace ${seg} s`}
    </p>
  );
}

function Esqueleto() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando información">
      <div className="h-56 animate-pulse rounded-2xl bg-panel" />
      <div className="h-20 animate-pulse rounded-xl bg-panel" />
      <div className="h-20 animate-pulse rounded-xl bg-panel" />
      <div className="h-20 animate-pulse rounded-xl bg-panel" />
    </div>
  );
}

function SinIncidencias({ municipio, error }: { municipio?: string; error: boolean }) {
  return (
    <section aria-labelledby="sin-incidencias" className="superficie rounded-2xl border border-success/35 bg-panel px-6 py-10 text-center sm:px-10">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/12 text-success ring-1 ring-success/30">
        <CircleCheck className="size-7" aria-hidden="true" />
      </span>
      <h1 id="sin-incidencias" className="mt-5 text-[26px] font-semibold text-foreground">
        Sin incidencias activas{municipio ? ` en ${municipio}` : ""}
      </h1>
      <p className="mx-auto mt-2 max-w-md text-[15.5px] leading-relaxed text-muted">
        {error
          ? "No hay avisos publicados. Estamos reintentando conectar con el servicio cada 5 segundos."
          : "No hay ninguna emergencia en curso. Si ocurre algo, lo publicaremos aquí al momento."}
      </p>
      <a href="tel:112" className="mt-6 inline-flex items-center gap-2 text-[15px] font-medium text-foreground underline decoration-danger/60 underline-offset-4">
        <Phone className="size-4 text-danger" aria-hidden="true" />
        Ante una emergencia, llama al 112
      </a>
    </section>
  );
}

export function PortalCiudadano() {
  const { vista, cargando, recibidoEn, error, origen } = usePublico();
  const ahora = useAhora();
  const organismo = vista?.organismo ?? null;
  const inc = vista?.incidente ?? null;
  const hayIncidente = !!inc && (inc.activo || inc.fase === "cierre");
  const situacion = inc ? situacionLegible(inc, vista?.situacionOperativa) : null;

  return (
    <div className="flex min-h-screen flex-col" data-origen={origen ?? undefined}>
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-panel focus:px-3 focus:py-2">
        Saltar al contenido
      </a>

      {/* Franja oficial (estilo gov.uk / ES-Alert) */}
      <div className="border-b border-panel-border bg-panel">
        <p className={`${CONTENEDOR} flex items-center gap-1.5 py-2 text-[13px] text-muted`}>
          <ShieldCheck className="size-4 shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 truncate">
            Canal oficial de información a la ciudadanía{organismo ? ` · ${organismo.nombre}` : ""}
          </span>
        </p>
      </div>

      <header className="sticky top-0 z-20 border-b border-panel-border bg-background/85 backdrop-blur-md">
        <div className={`${CONTENEDOR} flex items-center justify-between gap-3 py-3`}>
          <div className="flex min-w-0 items-center gap-3">
            <Logo descriptor={false} />
            {organismo && (
              <div className="hidden min-w-0 border-l border-panel-border pl-3 leading-tight sm:block">
                <p className="truncate text-[14px] font-medium text-foreground">{organismo.nombre}</p>
                <p className="truncate text-[12.5px] text-muted">{organismo.servicio}</p>
              </div>
            )}
          </div>
          <Actualizado recibidoEn={recibidoEn} error={error} ahora={ahora} />
        </div>
      </header>

      <main id="contenido" className={`${CONTENEDOR} flex-1 pt-5 sm:pt-8`}>
        {organismo && (
          <p className="mb-4 px-1 text-[14px] text-muted sm:hidden">
            {organismo.nombre} · {organismo.servicio}
          </p>
        )}

        {cargando && !vista ? (
          <Esqueleto />
        ) : !vista || !hayIncidente || !inc || !situacion ? (
          <SinIncidencias municipio={organismo?.municipio} error={error && !vista} />
        ) : (
          <div className="space-y-8 lg:space-y-10">
            <BannerSituacion vista={vista} situacion={situacion} ahora={ahora} />
            <MapaZona vista={vista} />

            <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-10">
              <div className="min-w-0 space-y-8">
                <QueHacer recomendaciones={vista.recomendaciones} />
                <Avisos avisos={vista.avisos} organismo={vista.organismo.nombre} ahora={ahora} />
                <NoticiasYBulos noticias={vista.noticiasVerificadas} bulos={vista.bulosDesmentidos} ahora={ahora} />
              </div>
              <div className="min-w-0 space-y-8">
                <AireYViento entorno={vista.entorno} incidenteTipo={inc.tipo} />
                <PuedesAyudar tareas={vista.tareasVoluntarios ?? []} />
              </div>
            </div>
          </div>
        )}
      </main>

      <Pie organismo={organismo} />
    </div>
  );
}
