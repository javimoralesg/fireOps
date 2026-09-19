"use client";
// =====================================================================
// Trozos de la ficha de un foco que se repiten en el mapa y en la
// pestaña "Focos". DUEÑO: constructor H.
// ---------------------------------------------------------------------
// Aquí viven las coherencias que pidió el mando:
//  · "Según la fuente (…)" para `resumenFuente`; "Nota del mando" SOLO
//    para `notas` escritas por una persona.
//  · "Pueblos en peligro" cuenta los de riesgo medio/alto/inminente y
//    dice de cuántos del radio salen.
//  · "Medios que ya actúan según la fuente" para `mediosExternos`, que
//    NO gestiona Atalaya y por eso no son "unidades asignadas".
//  · La confianza explica de dónde viene y si está pendiente de
//    confirmar; un foco "detectado" avisa de que no se despliega nada.
// =====================================================================

import type { Incendio, Poblacion } from "@/lib/dominio/tipos";
import { hora, numero } from "@/lib/cliente/formato";
import { urlSegura } from "@/lib/cliente/enlaces";
import { EnlaceExterno } from "@/components/ui/Enlace";
import { Insignia } from "@/components/ui/Insignia";

/** Riesgos que cuentan como "pueblo en peligro" (los bajos solo son contexto). */
export const RIESGOS_EN_PELIGRO: Poblacion["riesgo"][] = ["medio", "alto", "inminente"];

export const poblacionesEnPeligro = (poblaciones: Poblacion[]): Poblacion[] =>
  poblaciones.filter((p) => RIESGOS_EN_PELIGRO.includes(p.riesgo));

/** true si el foco es una señal todavía sin confirmar. */
export const sinConfirmar = (i: Incendio): boolean => i.estado === "detectado";

/** Frase de confianza con su origen, para que un 100 % no salga de una sola noticia. */
export function fraseConfianza(inc: Incendio): string {
  const pct = `${numero((inc.confianza ?? 0) * 100)} %`;
  const fuentes = inc.observaciones?.length ?? 0;
  const origen =
    inc.fuenteDeteccion ??
    ({ prensa: "prensa", rrss: "redes sociales", satelite: "satélite", camara: "cámara", llamada: "llamada al 112", manual: "declarado por el mando" } as Record<
      string,
      string
    >)[inc.origen] ??
    inc.origen;
  if (fuentes > 1) return `Confianza ${pct} · ${fuentes} fuentes (${origen})`;
  return `Confianza ${pct} · una sola fuente (${origen})${sinConfirmar(inc) ? " · pendiente de confirmar" : ""}`;
}

/** Aviso de foco sin confirmar: por qué no hay medios en camino. */
export function AvisoSinConfirmar({ incendio }: { incendio: Incendio }) {
  if (!sinConfirmar(incendio)) return null;
  return (
    <p className="mt-1.5 rounded-lg border border-warning/45 bg-warning/10 px-2 py-1 text-[11.5px] leading-snug text-warning">
      <span className="font-semibold">Sin confirmar:</span> no se despliegan medios hasta que otra fuente o el mando lo confirme.
    </p>
  );
}

/**
 * Lo que dice la fuente (noticia, red social, satélite), separado de la nota
 * humana. Si la fuente trae URL, su NOMBRE es el enlace: se abre la noticia, el
 * post o la imagen original en una pestaña nueva. Sin URL no hay enlace.
 */
export function SegunLaFuente({ incendio }: { incendio: Incendio }) {
  if (!incendio.resumenFuente) return null;
  const url = urlSegura(incendio.fuenteUrl);
  const nombre = incendio.fuenteDeteccion;
  return (
    <p className="mt-1.5 rounded-lg border border-panel-border bg-panel-2 px-2 py-1 text-[11.5px] leading-snug text-muted">
      <span className="font-medium text-foreground">
        Según la fuente
        {nombre ? (
          <>
            {" ("}
            {url ? (
              <EnlaceExterno href={url} titulo={`Abrir la fuente original: ${nombre}`} className="text-[11.5px] font-medium">
                {nombre}
              </EnlaceExterno>
            ) : (
              nombre
            )}
            {")"}
          </>
        ) : null}
        :
      </span>{" "}
      {incendio.resumenFuente}
      {url && !nombre ? (
        <>
          {" "}
          <EnlaceExterno href={url} className="text-[11.5px]">
            Abrir la fuente
          </EnlaceExterno>
        </>
      ) : null}
    </p>
  );
}

/**
 * Una línea con el origen del foco y, si la hay, su URL: sirve también cuando
 * el foco no trae `resumenFuente` (declarado a mano, satélite, cámara…).
 */
export function EnlaceFuenteFoco({ incendio, className = "" }: { incendio: Incendio; className?: string }) {
  const url = urlSegura(incendio.fuenteUrl);
  if (!url) return null;
  return (
    <EnlaceExterno href={url} className={`text-[11.5px] ${className}`.trim()} titulo="Abrir la fuente que detectó este foco">
      Fuente: {incendio.fuenteDeteccion ?? "documento original"}
    </EnlaceExterno>
  );
}

/** Meteo del foco con enlace a la consulta real de Open-Meteo que la produjo. */
export function EnlaceMeteo({ incendio, className = "" }: { incendio: Incendio; className?: string }) {
  const url = urlSegura(incendio.meteo?.url);
  if (!url) return null;
  return (
    <EnlaceExterno href={url} className={`text-[11px] ${className}`.trim()} titulo="Ver la consulta real a Open-Meteo de la que sale este viento">
      {incendio.meteo?.fuente ?? "Open-Meteo"}
    </EnlaceExterno>
  );
}

/** Nota escrita por una persona de la sala (nunca el resumen de una noticia). */
export function NotaDelMando({ incendio }: { incendio: Incendio }) {
  if (!incendio.notas) return null;
  return (
    <p className="mt-1.5 rounded-lg border border-panel-border bg-panel-2 px-2 py-1 text-[11.5px] leading-snug text-muted">
      <span className="font-medium text-foreground">Nota del mando:</span> {incendio.notas}
    </p>
  );
}

/** Medios que ya trabajan según la fuente y que Atalaya no controla. */
export function MediosExternos({ incendio }: { incendio: Incendio }) {
  if (!incendio.mediosExternos) return null;
  return (
    <p className="mt-1 text-[11.5px] leading-snug text-muted">
      <span className="font-medium text-foreground">Medios que ya actúan según la fuente:</span> {incendio.mediosExternos}{" "}
      <span className="text-subtle">(no gestionados por Atalaya)</span>
    </p>
  );
}

/**
 * Contención: cuánto perímetro está ya controlado, a qué ritmo y con qué hitos.
 * Lo calcula el agente de propagación (constructor K); si no viene, no se pinta
 * nada inventado.
 */
export function BarraContencion({ incendio: inc, compacto = false }: { incendio: Incendio; compacto?: boolean }) {
  const c = inc.contencion;
  if (!c) return null;
  const pct = Math.max(0, Math.min(100, Math.round((c.fraccion ?? 0) * 100)));
  const tono = pct >= 100 ? "bg-success" : pct >= 50 ? "bg-info" : "bg-warning";
  const hitos: [string, string | undefined][] = [
    ["Estabilizado", c.estabilizadoEn],
    ["Controlado", c.controladoEn],
    ["Extinguido", c.extinguidoEn],
  ];
  const alcanzados = hitos.filter(([, en]) => Boolean(en));

  return (
    <div className={compacto ? "mt-1.5" : "mt-2"}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] font-medium text-foreground">Perímetro controlado</span>
        <span className="tabular text-[13px] font-semibold text-foreground">{pct} %</span>
      </div>
      <div className="mt-0.5 h-2 w-full overflow-hidden rounded-full bg-panel-2" role="img" aria-label={`Perímetro controlado ${pct} %`}>
        <div className={`h-full rounded-full ${tono}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-muted">
        {numero(c.unidadesTrabajando)} unidad(es) construyendo línea a {numero(c.ritmoMmin, 1)} m/min
        {c.mediosAereos ? " con apoyo aéreo" : ""}
        {c.estimadoControlMin !== undefined ? ` · control estimado en ~${numero(c.estimadoControlMin)} min` : " · sin control a la vista con este ritmo"}
      </p>
      {alcanzados.length > 0 ? (
        <p className="mt-0.5 text-[11px] leading-snug text-subtle">
          {alcanzados.map(([nombre, en]) => `${nombre} ${hora(en)}`).join(" · ")} (hora de mundo)
        </p>
      ) : null}
    </div>
  );
}

/** Insignia ámbar cuando el viento lo ha fijado una persona. */
export function InsigniaVientoForzado({ incendio, pequena = true }: { incendio: Incendio; pequena?: boolean }) {
  if (!incendio.meteoForzada) return null;
  return (
    <Insignia pequena={pequena} tono="aviso" punto title={`Fijado por ${incendio.meteoForzada.fijadoPor}`}>
      Viento forzado por el mando
    </Insignia>
  );
}
