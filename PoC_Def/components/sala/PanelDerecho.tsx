"use client";
// Panel derecho de la sala: pestañas con lo que requiere decisión, los agentes,
// los focos, el registro vivo y las lecciones. En tablet se convierte en hoja
// inferior. DUEÑO: constructor E.
//
// RENDIMIENTO (constructor R): `memo` + memos POR PORCIÓN del snapshot. El
// objeto `snapshot` es nuevo en cada actualización del SSE, pero sus arrays
// (`decisiones`, `incendios`, `agentes`…) conservan la referencia cuando no
// cambian (contrato de lib/cliente/useEstado.ts), así que cada cuenta se
// recalcula solo si cambió SU lista. Un cambio de pestaña o el plegado ya no
// tocan el mapa ni recorren nada.
//
// ESTADOS DEL PANEL (misma superficie y tokens que el resto de la sala: bg-panel,
// borde, ≥ 44 px de toque, icono siempre con texto):
//   · abierto  → columna de 26 rem junto al mapa, ajustable arrastrando el
//                separador (components/sala/SeparadorPaneles.tsx fija --ancho-panel);
//                a partir de 40 rem de contenido pasa a las rejillas por columnas
//                del modo ampliado (variantes @container); hoja inferior en tablet;
//   · plegado  → carril estrecho con una entrada por sección y sus contadores,
//                para abrir el panel ya en la sección que interesa;
//   · ampliado → ocupa toda la zona de trabajo (el mapa se oculta) y cada
//                sección se reparte en columnas para gestionar desde aquí.

import { memo, useCallback, useMemo, type ReactNode } from "react";
import {
  Flame,
  Funnel,
  FunnelX,
  GraduationCap,
  Inbox,
  LayoutPanelLeft,
  Map,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  ScrollText,
} from "lucide-react";
import type { Snapshot } from "@/lib/dominio/tipos";
import { PanelPestana, Pestanas, type Pestana } from "@/components/ui/Pestanas";
import { Boton } from "@/components/ui/Boton";
import { Tooltip } from "@/components/ui/Tooltip";
import { useSuperaAncho } from "@/lib/cliente/useSuperaAncho";
import { DecisionesFlotantes } from "./DecisionesFlotantes";
import type { ObjetivoAccion } from "./TarjetaDecision";
import { PestanaDecisiones } from "./PestanaDecisiones";
import { PestanaFocos } from "./PestanaFocos";
import { PestanaLecciones } from "./PestanaLecciones";
import { PestanaRegistro } from "./PestanaRegistro";

export type ClavePestana = "decisiones" | "focos" | "registro" | "lecciones";

/** Pestaña del panel con la etiqueta corta que cabe en el carril plegado. */
interface PestanaPanel extends Pestana {
  id: ClavePestana;
  corta: string;
}

/** Estados que ya no cuentan como foco activo en el contador de la pestaña. */
const CERRADOS = ["extinguido", "descartado", "fusionado"];

function PanelDerechoBase({
  snapshot,
  activa,
  onCambiarPestana,
  plegado,
  onPlegar,
  ampliado = false,
  onAmpliar,
  onRefrescar,
  onCentrarIncendio,
  onCentrarUnidad,
  onCentrarObjetivo,
  incendioSeleccionado,
  filtroZona,
  onQuitarZona,
}: {
  snapshot?: Snapshot;
  activa: ClavePestana;
  onCambiarPestana: (p: ClavePestana) => void;
  plegado: boolean;
  onPlegar: () => void;
  /** A pantalla completa: el panel ocupa toda la zona de trabajo y el mapa se oculta. */
  ampliado?: boolean;
  /** Alterna el modo ampliado (atajo P). */
  onAmpliar?: () => void;
  onRefrescar?: () => void;
  onCentrarIncendio?: (id: string) => void;
  onCentrarUnidad?: (id: string) => void;
  /** "Centrar en el mapa" de una decisión sin foco: pueblo avisado, cámara, punto. */
  onCentrarObjetivo?: (objetivo: ObjetivoAccion) => void;
  incendioSeleccionado?: string;
  /** Con una zona dibujada en el mapa: cuántos focos se ven de los que hay. */
  filtroZona?: { dentro: number; total: number };
  onQuitarZona?: () => void;
}) {
  const decisiones = snapshot?.decisiones;
  const incendios = snapshot?.incendios;
  const lecciones = snapshot?.lecciones;

  const pendientes = useMemo(
    () => (decisiones ?? []).filter((d) => d.estado === "pendiente_humano" || d.estado === "escalada").length,
    [decisiones],
  );
  const focosActivos = useMemo(() => (incendios ?? []).filter((i) => !CERRADOS.includes(i.estado)).length, [incendios]);

  /** `Pestanas` habla en `string`: se envuelve una sola vez para no romper su memo. */
  const cambiarPestana = useCallback((id: string) => onCambiarPestana(id as ClavePestana), [onCambiarPestana]);
  /** Desde el carril plegado: abre el panel ya en la sección pulsada. */
  const abrirEn = useCallback(
    (id: ClavePestana) => {
      onCambiarPestana(id);
      onPlegar();
    },
    [onCambiarPestana, onPlegar],
  );
  const abrirDecisiones = useCallback(() => abrirEn("decisiones"), [abrirEn]);

  const pestanas: PestanaPanel[] = useMemo(
    () => [
      { id: "decisiones", etiqueta: "Requiere tu decisión", corta: "Decidir", cuenta: pendientes, icono: <Inbox />, urgente: true },
      { id: "focos", etiqueta: "Focos", corta: "Focos", cuenta: focosActivos, icono: <Flame /> },
      { id: "registro", etiqueta: "Registro", corta: "Registro", icono: <ScrollText /> },
      { id: "lecciones", etiqueta: "Lecciones", corta: "Lecciones", cuenta: lecciones?.length ?? 0, icono: <GraduationCap /> },
    ],
    [focosActivos, lecciones?.length, pendientes],
  );

  // ANCHO REAL del contenido (el separador arrastrable lo cambia): con ≥ 40 rem
  // las pestañas usan las mismas rejillas por columnas que el modo ampliado
  // (variantes @container en cada Pestana*). Solo re-renderiza al cruzar el umbral.
  const [contenidoAncho, contenidoRef] = useSuperaAncho(640);
  const amplio = ampliado || contenidoAncho;

  if (plegado && !ampliado) {
    return (
      <>
        <CarrilPlegado pestanas={pestanas} activa={activa} onAbrir={abrirEn} onAmpliar={onAmpliar} />
        {/* Plegado no significa ciego: lo que requiere decisión sale como
            ventanas sobre el mapa (posicionadas respecto al <main>). */}
        <DecisionesFlotantes
          decisiones={decisiones}
          incendios={incendios}
          informes={snapshot?.informes}
          onTrasDecidir={onRefrescar}
          onCentrarIncendio={onCentrarIncendio}
          onCentrarUnidad={onCentrarUnidad}
          onCentrarObjetivo={onCentrarObjetivo}
          onAbrirPanel={abrirDecisiones}
        />
      </>
    );
  }

  return (
    <aside
      aria-label="Panel de mando"
      className={
        ampliado
          ? "flex min-h-0 w-full flex-1 flex-col bg-panel"
          : "flex max-h-[55vh] w-full shrink-0 flex-col border-t border-panel-border bg-panel lg:max-h-none lg:w-[var(--ancho-panel,26.25rem)] lg:border-l lg:border-t-0"
      }
    >
      <div className={`flex items-center gap-1 border-b border-panel-border py-1 ${ampliado ? "flex-wrap gap-y-1.5 px-3" : "px-1.5"}`}>
        {ampliado ? (
          <h2 className="mr-2 flex shrink-0 items-center gap-2 text-base font-semibold text-foreground">
            <LayoutPanelLeft className="size-5 text-brand" aria-hidden /> Panel de mando
          </h2>
        ) : null}
        <Pestanas
          pestanas={pestanas}
          activa={activa}
          onCambiar={cambiarPestana}
          idBase="panel"
          className="min-w-0 flex-1"
        />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {ampliado ? (
            <Boton icono={<Map />} onClick={onAmpliar}>
              Volver al mapa (Esc)
            </Boton>
          ) : (
            <>
              {onAmpliar ? (
                <Tooltip lado="izquierda" titulo="Ampliar el panel" contenido="A pantalla completa, sin el mapa delante, para gestionar todo desde aquí. Atajo: P.">
                  <Boton variante="fantasma" icono={<Maximize2 />} onClick={onAmpliar}>
                    <span className="solo-lectores">Ampliar el panel a pantalla completa</span>
                  </Boton>
                </Tooltip>
              ) : null}
              <Tooltip lado="izquierda" titulo="Plegar el panel" contenido="Deja un carril con el contador de cada sección; el mapa gana el espacio.">
                <Boton variante="fantasma" icono={<PanelRightClose />} onClick={onPlegar}>
                  <span className="solo-lectores">Plegar el panel</span>
                </Boton>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* El panel enseña solo lo de la zona dibujada en el mapa: se dice siempre. */}
      {filtroZona ? (
        <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-brand/40 bg-brand/10 px-2.5 py-1.5 text-[12px] leading-snug text-brand">
          <Funnel className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            Solo la zona dibujada en el mapa · <span className="tabular font-semibold">{filtroZona.dentro}</span> de {filtroZona.total} focos
          </span>
          <button
            type="button"
            onClick={onQuitarZona}
            className="inline-flex min-h-7 items-center gap-1 rounded-md border border-brand/50 px-1.5 text-[11.5px] font-semibold hover:bg-brand/15"
          >
            <FunnelX className="size-3.5" aria-hidden /> Quitar filtro
          </button>
        </p>
      ) : null}

      <div ref={contenidoRef} className={`@container min-h-0 flex-1 overflow-y-auto scroll-fino ${ampliado ? "p-4" : "p-2.5"}`}>
        {/* En ampliado, un ancho máximo para que las columnas no se estiren sin fin. */}
        <div className={ampliado ? "mx-auto w-full max-w-[110rem]" : undefined}>
          <PanelPestana id="decisiones" activa={activa} idBase="panel">
            <PestanaDecisiones
              snapshot={snapshot}
              onTrasDecidir={onRefrescar}
              onCentrarIncendio={onCentrarIncendio}
              onCentrarUnidad={onCentrarUnidad}
              onCentrarObjetivo={onCentrarObjetivo}
              amplio={amplio}
            />
          </PanelPestana>
          <PanelPestana id="focos" activa={activa} idBase="panel">
            <PestanaFocos
              snapshot={snapshot}
              onCentrar={onCentrarIncendio}
              onTrasCambio={onRefrescar}
              seleccionado={incendioSeleccionado}
              amplio={amplio}
            />
          </PanelPestana>
          <PanelPestana id="registro" activa={activa} idBase="panel">
            <PestanaRegistro eventos={snapshot?.eventos} observaciones={snapshot?.observaciones} incendios={incendios} />
          </PanelPestana>
          <PanelPestana id="lecciones" activa={activa} idBase="panel">
            <PestanaLecciones lecciones={lecciones} comparativa={snapshot?.ejecucion?.comparativa} amplio={amplio} />
          </PanelPestana>
        </div>
      </div>
    </aside>
  );
}

// --- Carril plegado ---------------------------------------------------------

/**
 * Lo que queda cuando el panel se pliega: la misma superficie del panel (no un
 * botón flotante sobre el mapa), una entrada por sección con su contador y el
 * acceso para abrir o ampliar. En escritorio es una columna pegada al borde
 * derecho; en tablet, una barra inferior bajo el mapa.
 */
function CarrilPlegado({
  pestanas,
  activa,
  onAbrir,
  onAmpliar,
}: {
  pestanas: PestanaPanel[];
  activa: ClavePestana;
  onAbrir: (id: ClavePestana) => void;
  onAmpliar?: () => void;
}) {
  return (
    <nav
      aria-label="Panel de mando plegado"
      className="flex w-full shrink-0 items-stretch border-t border-panel-border bg-panel lg:w-[4.75rem] lg:flex-col lg:border-l lg:border-t-0"
    >
      <BotonCarril icono={<PanelRightOpen />} etiqueta="Abrir" titulo="Abrir el panel de mando" onClick={() => onAbrir(activa)} destacado />
      {onAmpliar ? (
        <BotonCarril icono={<Maximize2 />} etiqueta="Ampliar" titulo="Ampliar el panel a pantalla completa (P)" onClick={onAmpliar} />
      ) : null}
      <span aria-hidden className="my-auto h-7 w-px shrink-0 bg-panel-border lg:mx-auto lg:my-1 lg:h-px lg:w-8" />
      {pestanas.map((p) => (
        <BotonCarril
          key={p.id}
          icono={p.icono}
          etiqueta={p.corta}
          titulo={`${p.etiqueta}: abrir el panel en esta sección`}
          cuenta={p.cuenta}
          urgente={p.urgente}
          onClick={() => onAbrir(p.id)}
        />
      ))}
    </nav>
  );
}

function BotonCarril({
  icono,
  etiqueta,
  titulo,
  cuenta,
  urgente = false,
  destacado = false,
  onClick,
}: {
  icono: ReactNode;
  /** Texto visible bajo el icono (el icono nunca es la única señal). */
  etiqueta: string;
  /** Frase completa para el título y los lectores de pantalla. */
  titulo: string;
  cuenta?: number;
  /** Con cuenta > 0 el contador se pinta en rojo y late, como en las pestañas. */
  urgente?: boolean;
  destacado?: boolean;
  onClick: () => void;
}) {
  const conAviso = urgente && (cuenta ?? 0) > 0;
  return (
    <button
      type="button"
      title={titulo}
      aria-label={typeof cuenta === "number" ? `${titulo} (${cuenta})` : titulo}
      onClick={onClick}
      className={[
        "relative flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[10.5px] font-medium leading-none transition-colors",
        "lg:min-h-14 lg:flex-none",
        destacado ? "text-brand hover:bg-brand/12" : conAviso ? "text-danger hover:bg-danger/12" : "text-muted hover:bg-panel-2 hover:text-foreground",
      ].join(" ")}
    >
      <span className="relative [&>svg]:size-5" aria-hidden>
        {icono}
        {typeof cuenta === "number" ? (
          <span
            className={[
              "tabular absolute -right-2.5 -top-1.5 min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4",
              conAviso ? "latido bg-danger text-white dark:text-[#2a0d10]" : "bg-panel-2 text-muted ring-1 ring-panel-border",
            ].join(" ")}
          >
            {cuenta}
          </span>
        ) : null}
      </span>
      <span className="max-w-full truncate">{etiqueta}</span>
    </button>
  );
}

export const PanelDerecho = memo(PanelDerechoBase);
