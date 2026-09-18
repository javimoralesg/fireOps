"use client";

// Zoom y desplazamiento del grafo sin librerías: la vista (centro + escala) se
// traduce a viewBox del SVG. Rueda y pellizco del trackpad acercan hacia el
// puntero, arrastrar mueve, doble clic acerca. Mientras el usuario no toca la
// vista, se encuadra sola (al redimensionar o si cambia el grafo).

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { encuadrar, type Caja, type Margen, type Vista } from "./geometria";

export interface Tam {
  w: number;
  h: number;
}

/** Zoom relativo al encuadre: de la mitad a 40 veces. */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 40;
const UMBRAL_ARRASTRE_PX = 4;

interface Arrastre {
  id: number;
  x0: number;
  y0: number;
  v0: Vista;
  activo: boolean;
}

export function useVistaGrafo(caja: Caja, margen: Margen) {
  const contRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [tam, setTam] = useState<Tam>({ w: 640, h: 400 });

  useEffect(() => {
    const el = contRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entradas) => {
      const r = entradas[0]?.contentRect;
      if (!r || r.width < 1 || r.height < 1) return;
      setTam((prev) => (Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5 ? prev : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const auto = useMemo(() => encuadrar(caja, tam.w, tam.h, margen), [caja, tam, margen]);
  const [manual, setManual] = useState<Vista | null>(null);
  const vista = manual ?? auto;
  const limites = useMemo(() => ({ min: auto.s * ZOOM_MIN, max: auto.s * ZOOM_MAX }), [auto.s]);

  // Copia viva para los manejadores nativos (rueda) y los que llegan varias veces por fotograma.
  const vivo = useRef({ vista, tam, limites });
  useLayoutEffect(() => {
    vivo.current = { vista, tam, limites };
  }, [vista, tam, limites]);

  const aplicar = useCallback((v: Vista) => {
    vivo.current = { ...vivo.current, vista: v };
    setManual(v);
  }, []);

  /** Multiplica la escala manteniendo fijo el punto (px, py) del contenedor (por defecto, el centro). */
  const zoom = useCallback(
    (factor: number, px?: number, py?: number) => {
      const { vista: v, tam: t, limites: l } = vivo.current;
      const s = Math.min(l.max, Math.max(l.min, v.s * factor));
      if (Math.abs(s - v.s) < 1e-9) return;
      const qx = (px ?? t.w / 2) - t.w / 2;
      const qy = (py ?? t.h / 2) - t.h / 2;
      const wx = v.cx + qx / v.s;
      const wy = v.cy + qy / v.s;
      aplicar({ s, cx: wx - qx / s, cy: wy - qy / s });
    },
    [aplicar],
  );

  /** Desplaza la vista en píxeles de pantalla. */
  const mover = useCallback(
    (dx: number, dy: number) => {
      const v = vivo.current.vista;
      aplicar({ ...v, cx: v.cx + dx / v.s, cy: v.cy + dy / v.s });
    },
    [aplicar],
  );

  /** Centra un punto del mundo; `desfasePx` > 0 lo deja a la izquierda del centro (p. ej. si hay un panel a la derecha). */
  const centrarEn = useCallback(
    (x: number, y: number, desfasePx = 0) => {
      const v = vivo.current.vista;
      aplicar({ ...v, cx: x + desfasePx / v.s, cy: y });
    },
    [aplicar],
  );

  const encuadrarTodo = useCallback(() => setManual(null), []);

  /** Encaja una caja concreta del mundo (p. ej. el entorno del foco). */
  const encuadrarCaja = useCallback(
    (c: Caja) => {
      const { tam: t, limites: l } = vivo.current;
      const v = encuadrar(c, t.w, t.h, margen);
      aplicar({ ...v, s: Math.min(l.max, Math.max(l.min, v.s)) });
    },
    [aplicar, margen],
  );

  // Rueda: listener nativo no pasivo para que la página no haga scroll mientras se acerca.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const alRodar = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * rect.height : e.deltaY;
      // ctrlKey = pellizco del trackpad: deltas pequeños, más sensibilidad
      zoom(Math.exp(-d * (e.ctrlKey ? 0.012 : 0.0018)), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", alRodar, { passive: false });
    return () => el.removeEventListener("wheel", alRodar);
  }, [zoom]);

  // Arrastre: solo se captura el puntero al superar el umbral, para que un clic simple llegue al vértice.
  const arrastre = useRef<Arrastre | null>(null);
  const huboArrastre = useRef(false);
  const [arrastrando, setArrastrando] = useState(false);

  const onPointerDown = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || !e.isPrimary) return;
    huboArrastre.current = false;
    arrastre.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, v0: vivo.current.vista, activo: false };
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const a = arrastre.current;
      if (!a || a.id !== e.pointerId) return;
      const dx = e.clientX - a.x0;
      const dy = e.clientY - a.y0;
      if (!a.activo) {
        if (Math.hypot(dx, dy) < UMBRAL_ARRASTRE_PX) return;
        a.activo = true;
        huboArrastre.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        setArrastrando(true);
      }
      aplicar({ ...a.v0, cx: a.v0.cx - dx / a.v0.s, cy: a.v0.cy - dy / a.v0.s });
    },
    [aplicar],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    const a = arrastre.current;
    if (!a || a.id !== e.pointerId) return;
    arrastre.current = null;
    if (a.activo) {
      setArrastrando(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  /** true si el último gesto fue un arrastre (para ignorar el clic que llega al soltar). */
  const fueArrastre = useCallback(() => huboArrastre.current, []);

  return {
    contRef,
    svgRef,
    tam,
    vista,
    auto,
    manual: manual !== null,
    zoom,
    mover,
    centrarEn,
    encuadrarTodo,
    encuadrarCaja,
    arrastrando,
    fueArrastre,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    limites,
  };
}

/**
 * Devuelve siempre la misma referencia mientras la firma no cambie. El estado llega
 * por SSE como un objeto nuevo en cada cambio; con esto los cálculos memoizados del
 * grafo solo se repiten cuando cambian de verdad sus datos.
 */
export function useEstable<T>(valor: T, firma: string): T {
  const [guardado, setGuardado] = useState({ firma, valor });
  if (guardado.firma !== firma) {
    setGuardado({ firma, valor });
    return valor;
  }
  return guardado.valor;
}
