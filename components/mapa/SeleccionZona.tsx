"use client";
// Selección de zona sobre el mapa: un recuadro o un lazo dibujado con el ratón
// o con el dedo, la zona activa pintada (con el exterior atenuado) y los
// botones para dibujar y para quitar el filtro. SOLO CLIENTE (Leaflet).
// DUEÑO: constructor E. Dependencias: leaflet, react-leaflet, lucide-react.
//
// El filtrado en sí NO vive aquí: la sala (app/page.tsx) recorta el snapshot
// con `filtrarSnapshotPorZona` (lib/cliente/zona.ts) y el mapa y el panel
// reciben ya solo lo que cae dentro. Aquí solo se dibuja y se devuelve el
// polígono; el mapa lo pinta mientras exista.

import { useEffect, useMemo, useRef, useState } from "react";
import L, { type PathOptions } from "leaflet";
import { Polygon, useMap } from "react-leaflet";
import { BoxSelect, Funnel, FunnelX, Lasso } from "lucide-react";
import type { TipoZona, ZonaSeleccion } from "@/lib/cliente/zona";
import type { ColoresTema } from "./useColoresTema";

/** Un recuadro más estrecho que esto (px) se toma por un clic sin querer. */
const MINIMO_PX = 8;
/** Distancia mínima (px) entre vértices del lazo mientras se arrastra. */
const PASO_LAZO_PX = 3;
/** Tolerancia (px) con la que se simplifica el lazo antes de guardarlo. */
const TOLERANCIA_PX = 1.5;
/** Anillo exterior de la máscara que atenúa todo lo que queda fuera de la zona. */
const MUNDO: [number, number][] = [
  [-85, -180],
  [-85, 180],
  [85, 180],
  [85, -180],
];

const TEXTO_TIPO: Record<TipoZona, string> = { recuadro: "recuadro", lazo: "lazo" };

/** [lat, lon] con 5 decimales (≈ 1 m): suficiente y compacto para guardarlo. */
function aPar(ll: L.LatLng): [number, number] {
  return [Number(ll.lat.toFixed(5)), Number(ll.lng.toFixed(5))];
}

/** Las cuatro esquinas del recuadro entre dos puntos de pantalla. */
function esquinas(map: L.Map, a: L.Point, b: L.Point): [number, number][] {
  const p1 = map.containerPointToLatLng(a);
  const p2 = map.containerPointToLatLng(b);
  const [la1, lo1] = aPar(p1);
  const [la2, lo2] = aPar(p2);
  return [
    [la1, lo1],
    [la1, lo2],
    [la2, lo2],
    [la2, lo1],
  ];
}

// ---------------------------------------------------------------------------
// Dibujo (dentro del MapContainer)
// ---------------------------------------------------------------------------

/**
 * Mientras `modo` no sea null, el arrastre sobre el mapa dibuja (en vez de
 * mover el mapa) y al soltar entrega la zona. Funciona con ratón, lápiz y
 * dedo (eventos de puntero con captura). Esc cancela y sale del modo.
 */
export function DibujoZona({
  modo,
  colores,
  onTerminar,
  onCancelar,
}: {
  modo: TipoZona | null;
  colores: ColoresTema;
  onTerminar: (zona: ZonaSeleccion) => void;
  onCancelar: () => void;
}) {
  const map = useMap();
  const [trazo, setTrazo] = useState<[number, number][]>([]);
  // Los manejadores viven en refs para que el efecto no se rehaga a cada render
  // de la sala (rehacerlo cortaría un trazo en curso).
  const terminarRef = useRef(onTerminar);
  const cancelarRef = useRef(onCancelar);
  useEffect(() => {
    terminarRef.current = onTerminar;
    cancelarRef.current = onCancelar;
  });

  useEffect(() => {
    if (!modo) return;
    const contenedor = map.getContainer();
    contenedor.classList.add("mapa-dibujando");
    // El arrastre pasa a dibujar: se apagan los gestos que compiten por él y se
    // recuerdan para devolverlos tal cual estaban al salir.
    const gestos = [map.dragging, map.boxZoom, map.doubleClickZoom, map.touchZoom].filter((g) => g?.enabled());
    for (const g of gestos) g.disable();

    let dibujando = false;
    let inicio: L.Point | null = null;
    let pixeles: L.Point[] = [];

    const soltarCaptura = (e: PointerEvent) => {
      try {
        if (contenedor.hasPointerCapture(e.pointerId)) contenedor.releasePointerCapture(e.pointerId);
      } catch {
        /* sin captura: nada que soltar */
      }
    };

    const alBajar = (e: PointerEvent) => {
      if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      e.preventDefault();
      try {
        contenedor.setPointerCapture(e.pointerId);
      } catch {
        /* algún navegador antiguo: sigue funcionando sin captura */
      }
      dibujando = true;
      inicio = map.mouseEventToContainerPoint(e);
      pixeles = [inicio];
      setTrazo([]);
    };

    const alMover = (e: PointerEvent) => {
      if (!dibujando || !inicio) return;
      e.preventDefault();
      const actual = map.mouseEventToContainerPoint(e);
      if (modo === "recuadro") {
        setTrazo(esquinas(map, inicio, actual));
        return;
      }
      if (pixeles[pixeles.length - 1].distanceTo(actual) < PASO_LAZO_PX) return;
      pixeles.push(actual);
      setTrazo(pixeles.map((p) => aPar(map.containerPointToLatLng(p))));
    };

    const alSoltar = (e: PointerEvent) => {
      if (!dibujando || !inicio) return;
      dibujando = false;
      soltarCaptura(e);
      const fin = map.mouseEventToContainerPoint(e);
      let puntos: [number, number][];
      if (modo === "recuadro") {
        // Un arrastre minúsculo es un clic: no se crea nada y se sigue en el modo.
        if (Math.abs(fin.x - inicio.x) < MINIMO_PX || Math.abs(fin.y - inicio.y) < MINIMO_PX) {
          setTrazo([]);
          return;
        }
        puntos = esquinas(map, inicio, fin);
      } else {
        const simples = L.LineUtil.simplify(pixeles, TOLERANCIA_PX);
        const tamano = L.bounds(simples).getSize();
        if (simples.length < 3 || tamano.x < MINIMO_PX || tamano.y < MINIMO_PX) {
          setTrazo([]);
          return;
        }
        puntos = simples.map((p) => aPar(map.containerPointToLatLng(p)));
      }
      setTrazo([]);
      terminarRef.current({ tipo: modo, puntos, creadaEn: Date.now() });
    };

    const alCancelar = (e: PointerEvent) => {
      dibujando = false;
      soltarCaptura(e);
      setTrazo([]);
    };

    const alTeclado = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      dibujando = false;
      setTrazo([]);
      cancelarRef.current();
    };

    contenedor.addEventListener("pointerdown", alBajar);
    contenedor.addEventListener("pointermove", alMover);
    contenedor.addEventListener("pointerup", alSoltar);
    contenedor.addEventListener("pointercancel", alCancelar);
    document.addEventListener("keydown", alTeclado);
    return () => {
      contenedor.removeEventListener("pointerdown", alBajar);
      contenedor.removeEventListener("pointermove", alMover);
      contenedor.removeEventListener("pointerup", alSoltar);
      contenedor.removeEventListener("pointercancel", alCancelar);
      document.removeEventListener("keydown", alTeclado);
      contenedor.classList.remove("mapa-dibujando");
      for (const g of gestos) g.enable();
    };
  }, [map, modo]);

  const estilo = useMemo<PathOptions>(
    () => ({ color: colores.brand, weight: 2, opacity: 0.95, dashArray: "6 4", fillColor: colores.brand, fillOpacity: 0.12, interactive: false }),
    [colores.brand],
  );

  if (!modo || trazo.length < 2) return null;
  return <Polygon positions={trazo} pathOptions={estilo} />;
}

// ---------------------------------------------------------------------------
// Zona activa (dentro del MapContainer)
// ---------------------------------------------------------------------------

/** La zona vigente: borde discontinuo y todo lo de fuera atenuado. */
export function CapaZona({ zona, colores }: { zona: ZonaSeleccion; colores: ColoresTema }) {
  const mascara = useMemo<PathOptions>(
    () => ({ stroke: false, fillColor: colores.oscuro ? "#000000" : "#16222e", fillOpacity: colores.oscuro ? 0.4 : 0.16, fillRule: "evenodd", interactive: false }),
    [colores.oscuro],
  );
  const borde = useMemo<PathOptions>(
    () => ({ color: colores.brand, weight: 2.5, opacity: 0.95, dashArray: "8 6", fill: false, interactive: false }),
    [colores.brand],
  );
  // Anillo exterior + agujero: la misma referencia mientras no cambie la zona,
  // para que react-leaflet no vuelva a fijar las coordenadas en cada render.
  const anillos = useMemo(() => [MUNDO, zona.puntos], [zona.puntos]);
  return (
    <>
      <Polygon positions={anillos} pathOptions={mascara} />
      <Polygon positions={zona.puntos} pathOptions={borde} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Controles (fuera del MapContainer, en la fila de "Capas · Ver todo")
// ---------------------------------------------------------------------------

const BOTON = "inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium shadow-sm";
const BOTON_NORMAL = `${BOTON} border-panel-border-strong bg-panel text-foreground hover:bg-panel-2`;
const BOTON_PULSADO = `${BOTON} border-brand bg-brand/12 text-brand`;

/**
 * "Recuadro" y "Lazo" entran (o salen) del modo de dibujo. Van en la fila de
 * "Capas · Ver todo"; el botón de quitar el filtro vive en `BandaZona`.
 */
export function ControlesZona({ modo, onElegirModo }: { modo: TipoZona | null; onElegirModo: (modo: TipoZona | null) => void }) {
  return (
    <>
      <button
        type="button"
        aria-pressed={modo === "recuadro"}
        onClick={() => onElegirModo(modo === "recuadro" ? null : "recuadro")}
        title="Dibuja un recuadro sobre el mapa: solo se verá lo que caiga dentro"
        className={modo === "recuadro" ? BOTON_PULSADO : BOTON_NORMAL}
      >
        <BoxSelect className="size-3.5 text-brand" aria-hidden /> Recuadro
      </button>
      <button
        type="button"
        aria-pressed={modo === "lazo"}
        onClick={() => onElegirModo(modo === "lazo" ? null : "lazo")}
        title="Dibuja a mano alzada la zona que quieres ver"
        className={modo === "lazo" ? BOTON_PULSADO : BOTON_NORMAL}
      >
        <Lasso className="size-3.5 text-brand" aria-hidden /> Lazo
      </button>
    </>
  );
}

/**
 * Banda con el filtro puesto: debajo de la fila "Capas · Ver todo · Recuadro ·
 * Lazo", arriba a la izquierda, siempre visible mientras hay zona. Dice cuántos
 * focos se ven de los que hay (mismos números que el panel derecho) y lleva el
 * botón "Quitar filtro", que borra la zona y vuelve a enseñarlo todo. Va por
 * debajo del desplegable de capas (z 900) para no taparlo cuando se abre.
 */
export function BandaZona({ zona, dentro, total, onQuitar }: { zona: ZonaSeleccion; dentro: number; total: number; onQuitar: () => void }) {
  return (
    <div className="pointer-events-none absolute left-2 top-[3.25rem] z-[890] max-w-[calc(100%-1rem)]">
      <p
        role="status"
        className="pointer-events-auto inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-brand bg-panel py-1 pl-3 pr-1 text-[13px] font-semibold text-brand shadow-[var(--sombra-flotante)]"
      >
        <Funnel className="size-4 shrink-0" aria-hidden />
        <span>
          Solo el {TEXTO_TIPO[zona.tipo]} dibujado · <span className="tabular">{dentro}</span> de {total} focos
        </span>
        <button
          type="button"
          onClick={onQuitar}
          title={`Quitar el filtro por ${TEXTO_TIPO[zona.tipo]} y volver a ver todos los focos`}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-brand bg-brand px-2.5 text-[12.5px] font-semibold text-accent-contraste hover:bg-brand-2"
        >
          <FunnelX className="size-3.5" aria-hidden /> Quitar filtro
        </button>
      </p>
    </div>
  );
}

/** Banda superior mientras se dibuja, como la del modo "declarar foco". */
export function AvisoDibujoZona({ modo }: { modo: TipoZona }) {
  const Icono = modo === "recuadro" ? BoxSelect : Lasso;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-[950] flex justify-center px-4">
      <span className="inline-flex items-center gap-2 rounded-full border border-brand bg-panel px-3 py-1.5 text-[13px] font-semibold text-brand shadow-[var(--sombra-flotante)]">
        <Icono className="size-4" aria-hidden /> Arrastra sobre el mapa para dibujar el {TEXTO_TIPO[modo]} · Esc para salir
      </span>
    </div>
  );
}

/** Con zona puesta y ningún foco dentro: se dice, en vez de "declara un foco". */
export function AvisoZonaVacia({ zona, total, onQuitar }: { zona: ZonaSeleccion; total: number; onQuitar: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-20 z-[880] flex justify-center px-4">
      <div className="pointer-events-auto max-w-md rounded-xl border border-panel-border bg-panel px-4 py-3 text-center shadow-[var(--sombra-flotante)]">
        <p className="flex items-center justify-center gap-2 text-sm font-semibold text-foreground">
          <FunnelX className="size-4 text-brand" aria-hidden /> Ningún foco dentro del {TEXTO_TIPO[zona.tipo]}
        </p>
        <p className="mt-1 text-[13px] leading-snug text-muted">
          {total > 0
            ? `Hay ${total} foco${total === 1 ? "" : "s"} fuera de la zona. Dibuja otra zona o quita el filtro para verlos.`
            : "Todavía no hay ningún foco declarado. El filtro se aplicará en cuanto aparezca uno dentro."}
        </p>
        <button
          type="button"
          onClick={onQuitar}
          className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-brand bg-brand/12 px-2.5 text-[12.5px] font-semibold text-brand hover:bg-brand/20"
        >
          <FunnelX className="size-3.5" aria-hidden /> Quitar filtro
        </button>
      </div>
    </div>
  );
}
