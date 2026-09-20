"use client";
// Separador arrastrable entre el mapa y el panel derecho. Solo existe en
// pantallas anchas (lg), donde ambos van lado a lado; en tablet el panel es
// una hoja inferior y este componente no se pinta.
//
// CÓMO FUNCIONA: fija la variable CSS `--ancho-panel` en su contenedor (el
// `<main>` de la sala) y el <aside> del panel la lee como anchura
// (`lg:w-[var(--ancho-panel,26.25rem)]`). El arrastre escribe directamente en
// el DOM, sin pasar por React: ni el mapa ni el panel se re-renderizan y
// Leaflet se entera del nuevo tamaño por su propio ResizeObserver. Al soltar
// se guarda en localStorage para que sobreviva a recargas.
//
// TECLADO: con el foco en el separador, ← ensancha el panel y → lo estrecha;
// Inicio/Fin llevan al mínimo/máximo. Doble clic vuelve al ancho por defecto.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { GripVertical } from "lucide-react";

const CLAVE = "atalaya:ancho-panel";
const VARIABLE = "--ancho-panel";
/** Ancho por defecto del panel (26.25 rem a 16 px), el mismo que tiene sin separador. */
const POR_DEFECTO = 420;
/** Por debajo de esto las tarjetas de decisión ya no caben. */
const MIN_PANEL = 300;
/** Espacio que siempre queda para el mapa, por mucho que se arrastre. */
const MIN_MAPA = 360;
const PASO_TECLA = 24;

function leerGuardado(): number | null {
  try {
    const v = Number(localStorage.getItem(CLAVE));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function guardar(ancho: number | null) {
  try {
    if (ancho === null) localStorage.removeItem(CLAVE);
    else localStorage.setItem(CLAVE, String(Math.round(ancho)));
  } catch {
    // En incógnito puede lanzar: el ancho simplemente no persiste.
  }
}

/** Ancho máximo del panel para un contenedor dado (deja MIN_MAPA al mapa). */
function maximoPara(contenedor: HTMLElement | null): number {
  const total = contenedor?.getBoundingClientRect().width ?? 0;
  return total > 0 ? Math.max(MIN_PANEL, Math.round(total - MIN_MAPA)) : Number.POSITIVE_INFINITY;
}

/** Limita el ancho al rango [MIN_PANEL, ancho del contenedor − MIN_MAPA]. */
function acotar(ancho: number, contenedor: HTMLElement | null): number {
  return Math.round(Math.min(Math.max(ancho, MIN_PANEL), maximoPara(contenedor)));
}

export function SeparadorPaneles() {
  const ref = useRef<HTMLDivElement>(null);
  /** Ancho comprometido (para aria y teclado); durante el arrastre se escribe solo en el DOM. */
  const [ancho, setAncho] = useState(POR_DEFECTO);
  const [arrastrando, setArrastrando] = useState(false);
  const enCurso = useRef(false);

  const contenedor = useCallback(() => ref.current?.parentElement ?? null, []);

  /** Escribe el ancho en la variable CSS del contenedor (o la quita para volver al valor por defecto). */
  const aplicar = useCallback(
    (px: number | null) => {
      const c = contenedor();
      if (!c) return;
      if (px === null) c.style.removeProperty(VARIABLE);
      else c.style.setProperty(VARIABLE, `${px}px`);
      // aria-valuemax depende del ancho de la ventana: se escribe en el DOM
      // desde aquí en vez de leer la ref durante el render.
      const maximo = maximoPara(c);
      if (Number.isFinite(maximo)) ref.current?.setAttribute("aria-valuemax", String(maximo));
    },
    [contenedor],
  );

  const fijar = useCallback(
    (px: number) => {
      const acotado = acotar(px, contenedor());
      aplicar(acotado);
      setAncho(acotado);
      guardar(acotado);
    },
    [aplicar, contenedor],
  );

  const restablecer = useCallback(() => {
    aplicar(null);
    setAncho(POR_DEFECTO);
    guardar(null);
  }, [aplicar]);

  // Al montar: recuperar el ancho guardado antes de pintar, para que no
  // parpadee el ancho por defecto. Al cambiar el tamaño de la ventana, volver
  // a acotarlo para que el mapa no se quede sin sitio.
  useLayoutEffect(() => {
    const guardado = leerGuardado();
    const inicial = guardado === null ? null : acotar(guardado, contenedor());
    aplicar(inicial);
    // Sincronización con un sistema externo (localStorage) que solo existe en el
    // navegador: NO se puede leer en el render sin romper la hidratación.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (inicial !== null) setAncho(inicial);

    const alRedimensionar = () => {
      const actual = leerGuardado();
      if (actual === null) {
        aplicar(null);
        return;
      }
      const acotado = acotar(actual, contenedor());
      if (acotado !== actual) fijar(acotado);
      else aplicar(acotado);
    };
    window.addEventListener("resize", alRedimensionar);
    return () => window.removeEventListener("resize", alRedimensionar);
  }, [aplicar, contenedor, fijar]);

  // Cursor y selección de texto en todo el documento mientras se arrastra.
  useEffect(() => {
    if (!arrastrando) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [arrastrando]);

  /** Ancho del panel que corresponde a la posición X del puntero. */
  const anchoDesde = useCallback(
    (clientX: number) => {
      const c = contenedor();
      if (!c) return POR_DEFECTO;
      const mitad = (ref.current?.getBoundingClientRect().width ?? 0) / 2;
      return acotar(c.getBoundingClientRect().right - clientX - mitad, c);
    },
    [contenedor],
  );

  const alPulsar = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    enCurso.current = true;
    setArrastrando(true);
  };

  const alMover = (e: PointerEvent<HTMLDivElement>) => {
    if (!enCurso.current) return;
    aplicar(anchoDesde(e.clientX));
  };

  const alSoltar = (e: PointerEvent<HTMLDivElement>) => {
    if (!enCurso.current) return;
    enCurso.current = false;
    setArrastrando(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    fijar(anchoDesde(e.clientX));
  };

  const alTeclado = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowLeft":
        fijar(ancho + PASO_TECLA);
        break;
      case "ArrowRight":
        fijar(ancho - PASO_TECLA);
        break;
      case "Home":
        fijar(MIN_PANEL);
        break;
      case "End":
        fijar(Number.MAX_SAFE_INTEGER); // acotar() lo deja en el máximo actual
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label="Ancho del panel de mando: arrastra o usa las flechas; doble clic para restablecer"
      aria-valuemin={MIN_PANEL}
      aria-valuenow={ancho}
      tabIndex={0}
      title="Arrastra para cambiar el reparto entre mapa y panel · doble clic restablece"
      data-arrastrando={arrastrando || undefined}
      onPointerDown={alPulsar}
      onPointerMove={alMover}
      onPointerUp={alSoltar}
      onPointerCancel={alSoltar}
      onKeyDown={alTeclado}
      onDoubleClick={restablecer}
      className={[
        // Solo en pantallas anchas; una franja estrecha con zona de toque mayor (::before).
        "group relative hidden w-2 shrink-0 cursor-col-resize touch-none select-none items-center justify-center bg-panel lg:flex",
        "before:absolute before:inset-y-0 before:-left-2 before:-right-2 before:content-['']",
        "hover:bg-brand/15 focus-visible:bg-brand/15 focus-visible:outline-none data-[arrastrando]:bg-brand/25",
      ].join(" ")}
    >
      <span
        aria-hidden
        className="pointer-events-none flex h-12 w-2 items-center justify-center rounded-full bg-panel-border-strong text-panel group-hover:bg-brand group-focus-visible:bg-brand group-data-[arrastrando]:bg-brand"
      >
        <GripVertical className="size-3" strokeWidth={2.5} />
      </span>
    </div>
  );
}
