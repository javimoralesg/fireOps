"use client";
// =====================================================================
// ATALAYA INCENDIOS · Visor interactivo del grafo de conocimiento
// ---------------------------------------------------------------------
// DUEÑO: constructor I.
// Lo que pidió Javi: que el grafo se pueda tocar. Se arrastran los vértices
// con ratón y con dedo, se hace zoom, se desplaza el fondo y el nodo que
// sueltas se queda donde lo dejas (clavado) mientras el resto sigue vivo.
//
// Decisiones:
//   · Canvas 2D en vez de SVG: con 300-600 nodos el DOM no aguanta el arrastre.
//   · La simulación (./simulacion.ts) vive FUERA de React: ni un renderizado
//     por fotograma. React solo se entera de la selección, los filtros y el
//     buscador.
//   · Pointer events (no mouse/touch por separado): el mismo código sirve para
//     ratón, dedo y lápiz, y el pellizco hace zoom.
//   · Las posiciones clavadas se recuerdan por documento en localStorage.
//   · Con `prefers-reduced-motion` no hay animación: se resuelve el layout de
//     golpe al cargar y solo se repinta cuando algo cambia.
// =====================================================================

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { Crosshair, Copy, Loader2, Maximize2, MessageSquareQuote, Minus, Pin, PinOff, Plus, RotateCcw, Search, X } from "lucide-react";
import type { Chunk, GrafoConocimiento as Grafo } from "@/lib/dominio/tipos";
import { Boton } from "@/components/ui";
import { radioDe, Simulacion, TIPOS_ARISTA, TIPOS_NODO, type NodoSim, type PosicionGuardada, type TipoArista, type TipoNodo } from "./simulacion";
import { dibujar, rectanguloMinimapa, vistaQueEncaja, ZOOM_ETIQUETAS_CHUNK, type MarcaConsulta, type Transformacion } from "./dibujo";
import { ETIQUETA_ARISTA, ETIQUETA_NODO, useColoresGrafo, useMovimientoReducido } from "./tema";

export interface DestacadoGrafo {
  chunkId: string;
  /** 1 = el más parecido a la pregunta. */
  orden: number;
  motivo: "vector" | "referencia" | "siguiente";
  similitud: number;
  documento: string;
  seccion?: string;
  cita: string;
}

export interface VisorGrafoApi {
  /** Centra el grafo en un nodo y lo selecciona (lo usan las citas). */
  centrarNodo: (id: string) => void;
}

export interface VisorGrafoProps {
  grafo?: Grafo;
  cargando: boolean;
  /** Ámbito con el que se recuerdan las posiciones clavadas. */
  claveMemoria: string;
  destacados?: DestacadoGrafo[];
  pregunta?: string;
  /** Rellena el buscador de la página (botón "Consultar con esta pregunta"). */
  onPreguntar?: (texto: string) => void;
  ref?: Ref<VisorGrafoApi>;
}

const MOTIVO_TEXTO: Record<DestacadoGrafo["motivo"], string> = {
  vector: "similitud semántica",
  referencia: "referencia cruzada",
  siguiente: "fragmento siguiente",
};

const CLAVE_ALMACEN = "atalaya.grafo.posiciones";
const ZOOM_MIN = 0.12;
const ZOOM_MAX = 4;

/**
 * Copia en estado de lo que el panel necesita del nodo elegido: los refs (la
 * simulación) no se leen durante el renderizado.
 */
interface FichaNodo {
  id: string;
  tipo: TipoNodo;
  etiqueta: string;
  grado: number;
  fijado: boolean;
}

/**
 * Los fragmentos citados se dibujan más gordos: además de verse, las
 * colisiones los separan entre sí y sus números no se montan unos sobre otros
 * (suelen ser artículos contiguos, o sea vecinos en el grafo).
 */
function marcarTamanos(simulacion: Simulacion, marcas: Map<string, MarcaConsulta>): void {
  for (const n of simulacion.nodos) {
    const base = radioDe(n.tipo, n.grado);
    n.radio = marcas.has(n.id) ? Math.max(base, 11) : base;
  }
}

function limitar(valor: number, minimo: number, maximo: number): number {
  return Math.max(minimo, Math.min(maximo, valor));
}

function leerPosiciones(clave: string): { posiciones: Map<string, PosicionGuardada>; fijadas: Set<string> } {
  const posiciones = new Map<string, PosicionGuardada>();
  const fijadas = new Set<string>();
  try {
    const crudo = window.localStorage.getItem(`${CLAVE_ALMACEN}.${clave}`);
    if (!crudo) return { posiciones, fijadas };
    const datos = JSON.parse(crudo) as Record<string, [number, number]>;
    for (const [id, par] of Object.entries(datos)) {
      if (!Array.isArray(par) || par.length !== 2) continue;
      posiciones.set(id, { x: par[0], y: par[1] });
      fijadas.add(id);
    }
  } catch {
    // Modo privado, cuota llena o JSON corrupto: el grafo se coloca solo.
  }
  return { posiciones, fijadas };
}

function guardarPosiciones(clave: string, nodos: NodoSim[]): void {
  try {
    const datos: Record<string, [number, number]> = {};
    for (const n of nodos) if (n.fijado) datos[n.id] = [Math.round(n.x), Math.round(n.y)];
    const ruta = `${CLAVE_ALMACEN}.${clave}`;
    if (Object.keys(datos).length) window.localStorage.setItem(ruta, JSON.stringify(datos));
    else window.localStorage.removeItem(ruta);
  } catch {
    // Sin almacenamiento el grafo funciona igual: solo no recuerda.
  }
}

export function VisorGrafo({ grafo, cargando, claveMemoria, destacados, pregunta, onPreguntar, ref }: VisorGrafoProps) {
  const colores = useColoresGrafo();
  const reducido = useMovimientoReducido();

  const contenedor = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const sim = useRef<Simulacion>(undefined);
  const vista = useRef<Transformacion>({ x: 0, y: 0, k: 1 });
  const tam = useRef({ ancho: 900, alto: 560 });
  const raf = useRef<number | undefined>(undefined);
  const hover = useRef<string | undefined>(undefined);
  const seleccionRef = useRef<string | undefined>(undefined);
  const coloresRef = useRef(colores);
  const reducidoRef = useRef(reducido);
  const tiposRef = useRef<Set<TipoArista>>(new Set(TIPOS_ARISTA));
  const marcasRef = useRef<Map<string, MarcaConsulta>>(new Map());
  const animacionVista = useRef<{ desde: Transformacion; hasta: Transformacion; inicio: number } | undefined>(undefined);
  /** El encuadre automático solo se hace una vez y solo si nadie ha tocado nada. */
  const yaEncajado = useRef(false);
  const tocado = useRef(false);

  const punteros = useRef(new Map<number, { x: number; y: number }>());
  const arrastre = useRef<{ id: string; dx: number; dy: number; movido: boolean; fijadoAntes: boolean } | undefined>(undefined);
  const paneo = useRef<{ sx: number; sy: number; x0: number; y0: number; movido: boolean } | undefined>(undefined);
  const pinza = useRef<{ distancia: number; k: number; cx: number; cy: number; x: number; y: number } | undefined>(undefined);

  const [ficha, setFicha] = useState<FichaNodo | undefined>(undefined);
  const [fragmento, setFragmento] = useState<Chunk | undefined>(undefined);
  const [cargandoFragmento, setCargandoFragmento] = useState(false);
  const [tiposVisibles, setTiposVisibles] = useState<Record<TipoArista, boolean>>({
    contiene: true,
    sigue: true,
    referencia: true,
    menciona: true,
  });
  const [busqueda, setBusqueda] = useState("");
  const [sugerenciasAbiertas, setSugerenciasAbiertas] = useState(false);
  const [indiceSugerencia, setIndiceSugerencia] = useState(0);
  const [fijados, setFijados] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [copiado, setCopiado] = useState(false);

  const seleccion = ficha?.id;
  /** El lienzo solo existe cuando hay grafo que pintar. */
  const listo = !cargando && Boolean(grafo?.nodos.length);
  const nodos = useMemo(() => grafo?.nodos ?? [], [grafo]);
  const idsNodos = useMemo(() => new Set(nodos.map((n) => n.id)), [nodos]);
  const titulosDocumento = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodos) if (n.tipo === "documento") m.set(n.id, n.etiqueta);
    return m;
  }, [nodos]);

  const marcas = useMemo(() => {
    const m = new Map<string, MarcaConsulta>();
    for (const d of destacados ?? []) m.set(d.chunkId, { orden: d.orden, primario: d.motivo === "vector" });
    return m;
  }, [destacados]);

  // ------------------------------------------------------------------
  // Pintado (nada de esto renderiza React)
  // ------------------------------------------------------------------
  const pintar = useCallback(() => {
    const canvas = lienzo.current;
    const simulacion = sim.current;
    if (!canvas || !simulacion) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { ancho, alto } = tam.current;
    dibujar({
      ctx,
      ancho,
      alto,
      sim: simulacion,
      vista: vista.current,
      colores: coloresRef.current,
      tiposActivos: tiposRef.current,
      hover: hover.current,
      seleccion: seleccionRef.current,
      destacados: marcasRef.current,
      minimapa: ancho > 420,
    });
  }, []);

  /**
   * Encuadre por defecto: TODO el grafo. En modo consulta no se hace zoom
   * sobre los fragmentos citados a propósito: lo que cuenta la pantalla es
   * "de todo esto, la IA miró estos seis", y eso solo se ve con el grafo
   * entero delante. Para ir a uno concreto está el clic en la cita.
   */
  const encuadreDe = useCallback(
    (simulacion: Simulacion, ancho: number, alto: number): Transformacion => vistaQueEncaja(simulacion.nodos, ancho, alto),
    [],
  );

  const pedirDibujo = useCallback(() => {
    if (raf.current !== undefined) return;
    const ciclo = () => {
      raf.current = undefined;
      const simulacion = sim.current;
      const anim = animacionVista.current;
      if (anim) {
        const t = limitar((performance.now() - anim.inicio) / 260, 0, 1);
        const e = 1 - Math.pow(1 - t, 3);
        vista.current = {
          x: anim.desde.x + (anim.hasta.x - anim.desde.x) * e,
          y: anim.desde.y + (anim.hasta.y - anim.desde.y) * e,
          k: anim.desde.k + (anim.hasta.k - anim.desde.k) * e,
        };
        if (t >= 1) animacionVista.current = undefined;
      }
      const moviendo = Boolean(simulacion && simulacion.enMovimiento && !reducidoRef.current);
      if (moviendo) simulacion?.paso();
      else if (simulacion?.nodos.length && !yaEncajado.current && !tocado.current) {
        // El reparto inicial es un círculo; cuando las fuerzas terminan, el
        // grafo ocupa otro sitio, así que se vuelve a encuadrar (una sola vez,
        // y nunca si el usuario ya ha movido la vista).
        yaEncajado.current = true;
        const destino = encuadreDe(simulacion, tam.current.ancho, tam.current.alto);
        if (reducidoRef.current) vista.current = destino;
        else animacionVista.current = { desde: { ...vista.current }, hasta: destino, inicio: performance.now() };
        setZoom(destino.k);
      }
      pintar();
      if (moviendo || animacionVista.current) raf.current = requestAnimationFrame(ciclo);
    };
    raf.current = requestAnimationFrame(ciclo);
  }, [encuadreDe, pintar]);

  const irA = useCallback(
    (destino: Transformacion, animar = true) => {
      if (!animar || reducidoRef.current) {
        vista.current = destino;
        animacionVista.current = undefined;
      } else {
        animacionVista.current = { desde: { ...vista.current }, hasta: destino, inicio: performance.now() };
      }
      setZoom(destino.k);
      pedirDibujo();
    },
    [pedirDibujo],
  );

  const encajar = useCallback(
    (animar = true) => {
      const simulacion = sim.current;
      if (!simulacion?.nodos.length) return;
      const { ancho, alto } = tam.current;
      tocado.current = true;
      irA(vistaQueEncaja(simulacion.nodos, ancho, alto), animar);
    },
    [irA],
  );

  // Tamaño del lienzo (con densidad de pantalla).
  useEffect(() => {
    const caja = contenedor.current;
    const canvas = lienzo.current;
    if (!caja || !canvas) return;
    const medir = () => {
      const r = caja.getBoundingClientRect();
      const ancho = Math.max(240, Math.round(r.width));
      const alto = Math.max(260, Math.round(r.height));
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      tam.current = { ancho, alto };
      canvas.width = Math.round(ancho * dpr);
      canvas.height = Math.round(alto * dpr);
      canvas.style.width = `${ancho}px`;
      canvas.style.height = `${alto}px`;
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (sim.current) {
        sim.current.centroX = ancho / 2;
        sim.current.centroY = alto / 2;
      }
      pedirDibujo();
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(caja);
    return () => observador.disconnect();
    // `listo` está en las dependencias porque el lienzo no existe mientras
    // se carga el grafo: sin esto, el observador nunca llegaría a engancharse.
  }, [pedirDibujo, listo]);

  // ------------------------------------------------------------------
  // Construcción de la simulación al cambiar el grafo
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!grafo?.nodos.length) {
      sim.current = undefined;
      return;
    }
    const { ancho, alto } = tam.current;
    const guardadas = leerPosiciones(claveMemoria);
    // Posiciones previas: si solo cambia el filtro, el grafo no salta.
    const previas = new Map(guardadas.posiciones);
    for (const n of sim.current?.nodos ?? []) if (!previas.has(n.id)) previas.set(n.id, { x: n.x, y: n.y });

    const simulacion = new Simulacion(grafo, ancho, alto, previas, guardadas.fijadas);
    simulacion.tiposActivos = tiposRef.current;
    marcarTamanos(simulacion, marcasRef.current);
    sim.current = simulacion;

    yaEncajado.current = false;
    tocado.current = false;
    if (reducidoRef.current) {
      // Sin animación: se resuelve el reparto de golpe y se pinta una vez.
      for (let i = 0; i < 320 && simulacion.enMovimiento; i++) simulacion.paso();
    }
    vista.current = encuadreDe(simulacion, tam.current.ancho, tam.current.alto);
    setZoom(vista.current.k);
    pedirDibujo();

    const t = setTimeout(() => {
      setFijados(simulacion.nodos.filter((n) => n.fijado).length);
      setFicha((actual) => (actual && simulacion.indicePorId.has(actual.id) ? actual : undefined));
    }, 0);
    return () => clearTimeout(t);
  }, [grafo, claveMemoria, encuadreDe, pedirDibujo]);

  // Refs espejo de lo que necesita el pintado.
  useEffect(() => {
    coloresRef.current = colores;
    pedirDibujo();
  }, [colores, pedirDibujo]);

  useEffect(() => {
    reducidoRef.current = reducido;
  }, [reducido]);

  useEffect(() => {
    seleccionRef.current = seleccion;
    pedirDibujo();
  }, [seleccion, pedirDibujo]);

  useEffect(() => {
    marcasRef.current = marcas;
    if (sim.current) marcarTamanos(sim.current, marcas);
    if (!marcas.size) {
      sim.current?.recalentar(0.25);
      pedirDibujo();
      return;
    }
    // Al llegar una respuesta el grafo se coloca sobre lo que miró la IA (y se
    // vuelve a hacer cuando llega el grafo ampliado con esos fragmentos).
    // El grafo se reconstruye con los fragmentos citados dentro: se vuelve a
    // encuadrar entero cuando se enfríe, para que se vean todos los halos.
    tocado.current = false;
    yaEncajado.current = false;
    sim.current?.recalentar(0.35);
    pedirDibujo();
  }, [marcas, pedirDibujo]);

  useEffect(() => {
    const activos = new Set(TIPOS_ARISTA.filter((t) => tiposVisibles[t]));
    tiposRef.current = activos;
    if (sim.current) {
      sim.current.tiposActivos = activos;
      sim.current.recalentar(0.3);
    }
    pedirDibujo();
  }, [tiposVisibles, pedirDibujo]);

  useEffect(() => {
    return () => {
      // El identificador se limpia SIEMPRE: si se quedara puesto, al volver a
      // montar (React en modo estricto lo hace) `pedirDibujo` se creería que
      // ya hay un fotograma pedido y el grafo no se pintaría nunca.
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
      raf.current = undefined;
    };
  }, []);

  // ------------------------------------------------------------------
  // Coordenadas y selección
  // ------------------------------------------------------------------
  const aPantalla = useCallback((clienteX: number, clienteY: number) => {
    const r = lienzo.current?.getBoundingClientRect();
    return { sx: clienteX - (r?.left ?? 0), sy: clienteY - (r?.top ?? 0) };
  }, []);

  const aMundo = useCallback((sx: number, sy: number) => {
    const v = vista.current;
    return { x: (sx - v.x) / v.k, y: (sy - v.y) / v.k };
  }, []);

  const nodoEn = useCallback((sx: number, sy: number): NodoSim | undefined => {
    const simulacion = sim.current;
    if (!simulacion) return undefined;
    const { x, y } = aMundo(sx, sy);
    const k = vista.current.k;
    let mejor: NodoSim | undefined;
    let mejorDistancia = Infinity;
    for (const n of simulacion.nodos) {
      const alcance = Math.max(n.radio, 12 / k); // dedo gordo: nunca menos de 12 px
      const d = Math.hypot(n.x - x, n.y - y);
      if (d <= alcance && d < mejorDistancia) {
        mejorDistancia = d;
        mejor = n;
      }
    }
    return mejor;
  }, [aMundo]);

  const pedirFragmento = useCallback(async (chunkId: string) => {
    setCargandoFragmento(true);
    setFragmento(undefined);
    try {
      const r = await fetch(`/api/conocimiento/grafo?chunkId=${encodeURIComponent(chunkId)}`, { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { chunk: Chunk };
      setFragmento(d.chunk);
    } catch {
      // Se queda el panel con la ficha básica del nodo.
    } finally {
      setCargandoFragmento(false);
    }
  }, []);

  const comoFicha = (n: NodoSim): FichaNodo => ({
    id: n.id,
    tipo: n.tipo,
    etiqueta: n.etiqueta,
    grado: n.grado,
    fijado: n.fijado,
  });

  const seleccionar = useCallback(
    (id: string | undefined) => {
      const nodo = id ? sim.current?.nodo(id) : undefined;
      setFicha(nodo ? comoFicha(nodo) : undefined);
      setCopiado(false);
      if (nodo?.tipo === "chunk") void pedirFragmento(nodo.id);
      else setFragmento(undefined);
    },
    [pedirFragmento],
  );

  /** Vuelve a leer del motor el nodo elegido (tras clavarlo o soltarlo). */
  const refrescarFicha = useCallback(() => {
    setFicha((actual) => {
      if (!actual) return actual;
      const n = sim.current?.nodo(actual.id);
      return n ? comoFicha(n) : undefined;
    });
  }, []);

  const centrarNodo = useCallback(
    (id: string) => {
      const nodo = sim.current?.nodo(id);
      if (!nodo) return;
      const { ancho, alto } = tam.current;
      const k = limitar(Math.max(vista.current.k, 1.2), ZOOM_MIN, ZOOM_MAX);
      irA({ k, x: ancho / 2 - nodo.x * k, y: alto / 2 - nodo.y * k });
      seleccionar(id);
    },
    [irA, seleccionar],
  );

  useImperativeHandle(ref, () => ({ centrarNodo }), [centrarNodo]);

  // ------------------------------------------------------------------
  // Punteros: arrastrar vértices, desplazar el fondo, pellizcar
  // ------------------------------------------------------------------
  const alBajarPuntero = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = lienzo.current;
      if (!canvas) return;
      canvas.setPointerCapture(e.pointerId);
      tocado.current = true;
      punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (punteros.current.size === 2) {
        const [a, b] = [...punteros.current.values()];
        const v = vista.current;
        const medio = aPantalla((a.x + b.x) / 2, (a.y + b.y) / 2);
        pinza.current = { distancia: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: v.k, cx: medio.sx, cy: medio.sy, x: v.x, y: v.y };
        arrastre.current = undefined;
        paneo.current = undefined;
        return;
      }

      const { sx, sy } = aPantalla(e.clientX, e.clientY);
      const { ancho, alto } = tam.current;
      if (ancho > 420 && sim.current?.nodos.length) {
        const m = rectanguloMinimapa(ancho, alto);
        if (sx >= m.x && sx <= m.x + m.ancho && sy >= m.y && sy <= m.y + m.alto) {
          irA(centroDesdeMinimapa(sim.current, sx, sy, ancho, alto, vista.current.k));
          return;
        }
      }

      const nodo = nodoEn(sx, sy);
      if (nodo) {
        const { x, y } = aMundo(sx, sy);
        arrastre.current = { id: nodo.id, dx: nodo.x - x, dy: nodo.y - y, movido: false, fijadoAntes: nodo.fijado };
      } else {
        paneo.current = { sx, sy, x0: vista.current.x, y0: vista.current.y, movido: false };
      }
    },
    [aMundo, aPantalla, irA, nodoEn],
  );

  const alMoverPuntero = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (punteros.current.has(e.pointerId)) punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const { sx, sy } = aPantalla(e.clientX, e.clientY);

      if (pinza.current && punteros.current.size >= 2) {
        const [a, b] = [...punteros.current.values()];
        const p = pinza.current;
        const k = limitar((p.k * Math.hypot(a.x - b.x, a.y - b.y)) / p.distancia, ZOOM_MIN, ZOOM_MAX);
        vista.current = { k, x: p.cx - (p.cx - p.x) * (k / p.k), y: p.cy - (p.cy - p.y) * (k / p.k) };
        setZoom(k);
        pedirDibujo();
        return;
      }

      const a = arrastre.current;
      if (a) {
        const nodo = sim.current?.nodo(a.id);
        if (!nodo) return;
        const { x, y } = aMundo(sx, sy);
        const nx = x + a.dx;
        const ny = y + a.dy;
        if (!a.movido && Math.hypot(nx - nodo.x, ny - nodo.y) > 2 / vista.current.k) a.movido = true;
        nodo.x = nx;
        nodo.y = ny;
        nodo.vx = 0;
        nodo.vy = 0;
        nodo.fijado = true;
        // El resto del grafo sigue reaccionando mientras arrastras.
        sim.current?.recalentar(0.32);
        pedirDibujo();
        return;
      }

      const p = paneo.current;
      if (p) {
        if (!p.movido && Math.hypot(sx - p.sx, sy - p.sy) > 3) p.movido = true;
        vista.current = { ...vista.current, x: p.x0 + (sx - p.sx), y: p.y0 + (sy - p.sy) };
        pedirDibujo();
        return;
      }

      const encima = nodoEn(sx, sy);
      if (encima?.id !== hover.current) {
        hover.current = encima?.id;
        if (lienzo.current) lienzo.current.style.cursor = encima ? "grab" : "default";
        pedirDibujo();
      }
    },
    [aMundo, aPantalla, nodoEn, pedirDibujo],
  );

  const alSoltarPuntero = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      punteros.current.delete(e.pointerId);
      if (punteros.current.size < 2) pinza.current = undefined;
      const a = arrastre.current;
      if (a) {
        arrastre.current = undefined;
        const nodo = sim.current?.nodo(a.id);
        if (nodo) {
          if (a.movido) {
            // Soltar = clavar. Doble clic (o el botón) lo libera.
            nodo.fijado = true;
            guardarPosiciones(claveMemoria, sim.current?.nodos ?? []);
            setFijados(sim.current?.nodos.filter((n) => n.fijado).length ?? 0);
            if (seleccionRef.current === nodo.id) refrescarFicha();
          } else {
            nodo.fijado = a.fijadoAntes;
            seleccionar(nodo.id);
          }
        }
        pedirDibujo();
        return;
      }
      const p = paneo.current;
      paneo.current = undefined;
      if (p && !p.movido) seleccionar(undefined);
    },
    [claveMemoria, pedirDibujo, refrescarFicha, seleccionar],
  );

  const alDobleClic = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { sx, sy } = aPantalla(e.clientX, e.clientY);
      const nodo = nodoEn(sx, sy);
      if (!nodo) return;
      nodo.fijado = false;
      sim.current?.recalentar(0.5);
      guardarPosiciones(claveMemoria, sim.current?.nodos ?? []);
      setFijados(sim.current?.nodos.filter((n) => n.fijado).length ?? 0);
      refrescarFicha();
      pedirDibujo();
    },
    [aPantalla, claveMemoria, nodoEn, pedirDibujo, refrescarFicha],
  );

  // Rueda: hay que registrarla a mano porque React la pone pasiva.
  useEffect(() => {
    const canvas = lienzo.current;
    if (!canvas) return;
    const alRodar = (e: WheelEvent) => {
      e.preventDefault();
      tocado.current = true;
      const r = canvas.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const v = vista.current;
      const k = limitar(v.k * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.03 : 0.0016)), ZOOM_MIN, ZOOM_MAX);
      vista.current = { k, x: sx - (sx - v.x) * (k / v.k), y: sy - (sy - v.y) * (k / v.k) };
      animacionVista.current = undefined;
      setZoom(k);
      pedirDibujo();
    };
    canvas.addEventListener("wheel", alRodar, { passive: false });
    return () => canvas.removeEventListener("wheel", alRodar);
    // `listo`: igual que con el observador de tamaño, el lienzo aparece
    // después de cargar el grafo y hay que volver a engancharse a él.
  }, [pedirDibujo, listo]);

  const zoomPaso = useCallback(
    (factor: number) => {
      tocado.current = true;
      const { ancho, alto } = tam.current;
      const v = vista.current;
      const k = limitar(v.k * factor, ZOOM_MIN, ZOOM_MAX);
      irA({ k, x: ancho / 2 - ((ancho / 2 - v.x) / v.k) * k, y: alto / 2 - ((alto / 2 - v.y) / v.k) * k });
    },
    [irA],
  );

  const soltarTodos = useCallback(() => {
    sim.current?.soltarTodos();
    guardarPosiciones(claveMemoria, sim.current?.nodos ?? []);
    setFijados(0);
    refrescarFicha();
    if (reducidoRef.current) {
      const s = sim.current;
      if (s) for (let i = 0; i < 200 && s.enMovimiento; i++) s.paso();
    }
    pedirDibujo();
  }, [claveMemoria, pedirDibujo, refrescarFicha]);

  const reordenar = useCallback(() => {
    const s = sim.current;
    if (!s) return;
    s.reordenar();
    guardarPosiciones(claveMemoria, s.nodos);
    setFijados(0);
    refrescarFicha();
    if (reducidoRef.current) for (let i = 0; i < 320 && s.enMovimiento; i++) s.paso();
    encajar(false);
    pedirDibujo();
  }, [claveMemoria, encajar, pedirDibujo, refrescarFicha]);

  const liberarSeleccionado = useCallback(() => {
    const nodo = seleccion ? sim.current?.nodo(seleccion) : undefined;
    if (!nodo) return;
    nodo.fijado = false;
    sim.current?.recalentar(0.5);
    guardarPosiciones(claveMemoria, sim.current?.nodos ?? []);
    setFijados(sim.current?.nodos.filter((n) => n.fijado).length ?? 0);
    refrescarFicha();
    pedirDibujo();
  }, [claveMemoria, pedirDibujo, refrescarFicha, seleccion]);

  const alTeclearLienzo = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      const paso = e.shiftKey ? 120 : 45;
      const v = vista.current;
      switch (e.key) {
        case "ArrowLeft":
          irA({ ...v, x: v.x + paso }, false);
          break;
        case "ArrowRight":
          irA({ ...v, x: v.x - paso }, false);
          break;
        case "ArrowUp":
          irA({ ...v, y: v.y + paso }, false);
          break;
        case "ArrowDown":
          irA({ ...v, y: v.y - paso }, false);
          break;
        case "+":
        case "=":
          zoomPaso(1.25);
          break;
        case "-":
          zoomPaso(0.8);
          break;
        case "e":
        case "E":
          encajar();
          break;
        case "r":
        case "R":
          reordenar();
          break;
        case "s":
        case "S":
          soltarTodos();
          break;
        case "l":
        case "L":
          liberarSeleccionado();
          break;
        case "Escape":
          seleccionar(undefined);
          break;
        default:
          return;
      }
      e.preventDefault();
    },
    [encajar, irA, liberarSeleccionado, reordenar, seleccionar, soltarTodos, zoomPaso],
  );

  // ------------------------------------------------------------------
  // Buscador de nodos
  // ------------------------------------------------------------------
  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return [];
    return nodos.filter((n) => n.etiqueta.toLowerCase().includes(q)).slice(0, 60);
  }, [busqueda, nodos]);

  const sugerencias = coincidencias.slice(0, 8);

  // ------------------------------------------------------------------
  // Panel lateral
  // ------------------------------------------------------------------
  const fragmentosDeEntidad = useMemo(() => {
    if (!grafo || ficha?.tipo !== "entidad") return [];
    const ids = new Set<string>();
    for (const a of grafo.aristas) {
      if (a.tipo !== "menciona") continue;
      if (a.destino === ficha.id) ids.add(a.origen);
      else if (a.origen === ficha.id) ids.add(a.destino);
    }
    return grafo.nodos.filter((n) => n.tipo === "chunk" && ids.has(n.id));
  }, [grafo, ficha]);

  const copiarCita = useCallback(async () => {
    if (!fragmento) return;
    const documento = titulosDocumento.get(fragmento.documentoId) ?? fragmento.documentoId;
    const cita = `«${fragmento.texto.replace(/\s+/g, " ").trim()}» — ${documento}${fragmento.seccion ? ` §${fragmento.seccion}` : ""}`;
    try {
      await navigator.clipboard.writeText(cita);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2200);
    } catch {
      setCopiado(false);
    }
  }, [fragmento, titulosDocumento]);

  const preguntarPorFragmento = useCallback(() => {
    if (!fragmento || !onPreguntar) return;
    const documento = titulosDocumento.get(fragmento.documentoId) ?? "";
    const asunto = fragmento.seccion?.trim() || fragmento.texto.replace(/\s+/g, " ").trim().slice(0, 70);
    onPreguntar(`¿Cómo procedo según ${asunto}${documento ? ` (${documento.slice(0, 60)})` : ""}?`);
  }, [fragmento, onPreguntar, titulosDocumento]);

  // ------------------------------------------------------------------
  if (cargando) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-[var(--radius-panel)] border border-panel-border bg-panel-2 text-muted">
        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> Dibujando el grafo…
      </div>
    );
  }
  if (!grafo?.nodos.length) {
    return (
      <div className="rounded-[var(--radius-panel)] border border-dashed border-panel-border-strong p-8 text-center">
        <p className="font-medium text-foreground">Todavía no hay grafo</p>
        <p className="mt-1 text-sm text-muted">
          Sube un documento arriba o ejecuta{" "}
          <code className="rounded bg-panel-2 px-1">npx tsx scripts/sembrar-conocimiento.ts</code>.
        </p>
      </div>
    );
  }

  const listaAccesible = busqueda.trim() ? coincidencias : nodos.slice(0, 80);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        {/* ---------------- barra de herramientas ---------------- */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Boton tamano="sm" icono={<RotateCcw />} onClick={reordenar} title="Rehacer el reparto de los nodos (R)">
            Reordenar
          </Boton>
          <Boton tamano="sm" icono={<PinOff />} onClick={soltarTodos} disabled={fijados === 0} title="Liberar los nodos clavados (S)">
            Soltar todos{fijados ? ` (${fijados})` : ""}
          </Boton>
          <Boton tamano="sm" icono={<Maximize2 />} onClick={() => encajar()} title="Encajar todo el grafo (E)">
            Encajar
          </Boton>
          <div className="flex items-center gap-1">
            <Boton tamano="sm" icono={<Minus />} onClick={() => zoomPaso(0.8)}>
              <span className="sr-only">Alejar</span>
            </Boton>
            <span className="tabular w-12 text-center text-xs text-muted" aria-live="off">
              {Math.round(zoom * 100)}%
            </span>
            <Boton tamano="sm" icono={<Plus />} onClick={() => zoomPaso(1.25)}>
              <span className="sr-only">Acercar</span>
            </Boton>
          </div>

          <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <input
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
                setSugerenciasAbiertas(true);
                setIndiceSugerencia(0);
              }}
              onFocus={() => setSugerenciasAbiertas(true)}
              onBlur={() => setTimeout(() => setSugerenciasAbiertas(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  setIndiceSugerencia((i) => Math.min(sugerencias.length - 1, i + 1));
                  e.preventDefault();
                } else if (e.key === "ArrowUp") {
                  setIndiceSugerencia((i) => Math.max(0, i - 1));
                  e.preventDefault();
                } else if (e.key === "Enter") {
                  const elegido = sugerencias[indiceSugerencia];
                  if (elegido) {
                    centrarNodo(elegido.id);
                    setSugerenciasAbiertas(false);
                  }
                  e.preventDefault();
                } else if (e.key === "Escape") {
                  setSugerenciasAbiertas(false);
                }
              }}
              placeholder="Buscar nodo…"
              aria-label="Buscar un nodo del grafo"
              role="combobox"
              aria-expanded={sugerenciasAbiertas && sugerencias.length > 0}
              aria-controls="sugerencias-grafo"
              className="min-h-9 w-full rounded-lg border border-panel-border-strong bg-panel pl-8 pr-2 text-[13px] text-foreground placeholder:text-subtle focus:border-accent focus:outline-none"
            />
            {sugerenciasAbiertas && sugerencias.length > 0 && (
              <ul
                id="sugerencias-grafo"
                role="listbox"
                className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-panel-border bg-panel p-1 shadow-[var(--sombra-flotante)]"
              >
                {sugerencias.map((n, i) => (
                  <li key={n.id} role="option" aria-selected={i === indiceSugerencia}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        centrarNodo(n.id);
                        setSugerenciasAbiertas(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] ${
                        i === indiceSugerencia ? "bg-panel-2" : ""
                      }`}
                    >
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: colores.nodo[n.tipo].relleno }} aria-hidden />
                      <span className="truncate text-foreground">{n.etiqueta}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-subtle">{ETIQUETA_NODO[n.tipo]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ---------------- lienzo ---------------- */}
        <div
          ref={contenedor}
          className="relative h-[440px] overflow-hidden rounded-[var(--radius-panel)] border border-panel-border bg-panel sm:h-[560px]"
        >
          <canvas
            ref={lienzo}
            tabIndex={0}
            role="application"
            aria-label={`Grafo de conocimiento con ${grafo.nodos.length} nodos y ${grafo.aristas.length} relaciones. Arrastra los vértices para moverlos. Flechas para desplazar, + y − para el zoom, E encaja, R reordena, S suelta los clavados.`}
            className="block touch-none select-none outline-none"
            onPointerDown={alBajarPuntero}
            onPointerMove={alMoverPuntero}
            onPointerUp={alSoltarPuntero}
            onPointerCancel={alSoltarPuntero}
            onPointerLeave={() => {
              if (!arrastre.current && !paneo.current && hover.current) {
                hover.current = undefined;
                pedirDibujo();
              }
            }}
            onDoubleClick={alDobleClic}
            onKeyDown={alTeclearLienzo}
          />
          {/* Leyenda: los tipos de relación se pueden apagar. */}
          <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-panel-border bg-panel/90 px-2 py-1 backdrop-blur">
              {TIPOS_NODO.map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5 text-muted">
                  <span className="inline-block size-2.5 rounded-full" style={{ background: colores.nodo[t].relleno }} aria-hidden />
                  {ETIQUETA_NODO[t]}
                </span>
              ))}
              <span className="text-panel-border-strong" aria-hidden>
                |
              </span>
              {TIPOS_ARISTA.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTiposVisibles((v) => ({ ...v, [t]: !v[t] }))}
                  aria-pressed={tiposVisibles[t]}
                  title={tiposVisibles[t] ? `Ocultar «${ETIQUETA_ARISTA[t]}»` : `Mostrar «${ETIQUETA_ARISTA[t]}»`}
                  className={`inline-flex items-center gap-1.5 rounded px-1 py-0.5 ${
                    tiposVisibles[t] ? "text-foreground" : "text-subtle line-through"
                  } hover:bg-panel-2`}
                >
                  <span
                    className="inline-block h-0.5 w-4"
                    style={{ background: tiposVisibles[t] ? colores.arista[t] : "currentColor", opacity: tiposVisibles[t] ? 1 : 0.5 }}
                    aria-hidden
                  />
                  {ETIQUETA_ARISTA[t]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {grafo.nodos.length} nodos · {grafo.aristas.length} relaciones. Arrastra un vértice para moverlo (se queda clavado);
          doble clic para soltarlo. Rueda o pellizco para el zoom, arrastra el fondo para desplazarte.
          {zoom < ZOOM_ETIQUETAS_CHUNK ? " Acerca para leer las etiquetas de los fragmentos." : ""}
        </p>
      </div>

      {/* ---------------- panel lateral ---------------- */}
      <aside className="scroll-fino max-h-[680px] min-w-0 overflow-y-auto rounded-[var(--radius-panel)] border border-panel-border bg-panel-2 p-3">
        {destacados?.length ? (
          <section className="mb-4">
            <h3 className="text-sm font-semibold text-foreground">Lo que miró la IA</h3>
            {pregunta && <p className="mt-0.5 text-xs italic text-muted">«{pregunta}»</p>}
            <ol className="mt-2 space-y-1.5">
              {destacados.map((d) => (
                <li key={d.chunkId}>
                  <button
                    type="button"
                    onClick={() => centrarNodo(d.chunkId)}
                    className={`flex w-full items-start gap-2 rounded-lg border p-2 text-left hover:border-accent ${
                      seleccion === d.chunkId ? "border-accent bg-panel" : "border-panel-border bg-panel"
                    }`}
                  >
                    <span
                      className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ background: d.motivo === "vector" ? colores.destacado : colores.acento }}
                    >
                      {d.orden}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {d.seccion ?? "Fragmento"}
                      </span>
                      <span className="block truncate text-[11px] text-muted">
                        {d.documento} · {MOTIVO_TEXTO[d.motivo]} · {d.similitud.toFixed(3)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <section className="mb-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Selección</h3>
            {ficha && (
              <button
                type="button"
                onClick={() => seleccionar(undefined)}
                className="text-xs text-muted hover:text-foreground"
                aria-label="Cerrar la selección"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>

          {!ficha && (
            <p className="mt-1 text-xs text-muted">
              Pulsa un vértice para leerlo. Los fragmentos (verde) abren su texto completo; las entidades (naranja), los
              fragmentos que las mencionan.
            </p>
          )}

          {ficha && (
            <div className="mt-2 rounded-lg border border-panel-border bg-panel p-3">
              <p className="text-[11px] uppercase tracking-wide text-subtle">{ETIQUETA_NODO[ficha.tipo]}</p>
              <h4 className="mt-0.5 text-sm font-semibold leading-snug text-foreground">{ficha.etiqueta}</h4>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <Boton tamano="sm" icono={<Crosshair />} onClick={() => centrarNodo(ficha.id)}>
                  Centrar
                </Boton>
                <Boton
                  tamano="sm"
                  icono={ficha.fijado ? <PinOff /> : <Pin />}
                  onClick={() => {
                    const n = sim.current?.nodo(ficha.id);
                    if (!n) return;
                    n.fijado = !n.fijado;
                    sim.current?.recalentar(0.4);
                    guardarPosiciones(claveMemoria, sim.current?.nodos ?? []);
                    setFijados(sim.current?.nodos.filter((x) => x.fijado).length ?? 0);
                    refrescarFicha();
                    pedirDibujo();
                  }}
                >
                  {ficha.fijado ? "Soltar" : "Clavar"}
                </Boton>
              </div>

              {ficha.tipo === "chunk" && (
                <div className="mt-3">
                  {cargandoFragmento && (
                    <p className="flex items-center gap-2 text-xs text-muted">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden /> Cargando el texto…
                    </p>
                  )}
                  {fragmento && (
                    <>
                      <p className="text-[11px] text-subtle">
                        {titulosDocumento.get(fragmento.documentoId) ?? fragmento.documentoId}
                        {fragmento.seccion ? ` §${fragmento.seccion}` : ""}
                      </p>
                      <p className="scroll-fino mt-1.5 max-h-56 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                        {fragmento.texto}
                      </p>
                      {fragmento.entidades.length > 0 && (
                        <p className="mt-2 flex flex-wrap gap-1">
                          {fragmento.entidades.map((e) => {
                            const idEntidad = `ent:${e}`;
                            const existe = idsNodos.has(idEntidad);
                            return existe ? (
                              <button
                                key={e}
                                type="button"
                                onClick={() => centrarNodo(idEntidad)}
                                className="rounded-full border border-panel-border px-2 py-0.5 text-[11px] text-foreground hover:border-accent"
                              >
                                {e}
                              </button>
                            ) : (
                              <span key={e} className="rounded-full border border-panel-border px-2 py-0.5 text-[11px] text-muted">
                                {e}
                              </span>
                            );
                          })}
                        </p>
                      )}
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {onPreguntar && (
                          <Boton tamano="sm" icono={<MessageSquareQuote />} onClick={preguntarPorFragmento}>
                            Consultar con esta pregunta
                          </Boton>
                        )}
                        <Boton tamano="sm" icono={<Copy />} onClick={() => void copiarCita()}>
                          {copiado ? "Cita copiada" : "Copiar cita"}
                        </Boton>
                      </div>
                    </>
                  )}
                </div>
              )}

              {ficha.tipo === "entidad" && (
                <div className="mt-3">
                  <p className="text-xs text-muted">
                    La mencionan {fragmentosDeEntidad.length} fragmento(s) del grafo:
                  </p>
                  <ul className="scroll-fino mt-1.5 max-h-60 space-y-1 overflow-y-auto">
                    {fragmentosDeEntidad.map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() => centrarNodo(f.id)}
                          className="w-full truncate rounded px-1.5 py-1 text-left text-[12px] text-foreground hover:bg-panel-2"
                        >
                          {f.etiqueta}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {onPreguntar && (
                    <Boton
                      tamano="sm"
                      className="mt-2"
                      icono={<MessageSquareQuote />}
                      onClick={() => onPreguntar(`¿Qué dice la normativa sobre ${ficha.etiqueta}?`)}
                    >
                      Consultar con esta pregunta
                    </Boton>
                  )}
                </div>
              )}

              {ficha.tipo === "documento" && (
                <p className="mt-2 text-xs text-muted">
                  {ficha.grado} relaciones en el grafo. Los fragmentos que cuelgan de él son los verdes unidos
                  por «contiene».
                </p>
              )}
            </div>
          )}
        </section>

        {/* Lista navegable con teclado: el grafo también se usa sin ratón. */}
        <section>
          <h3 className="text-sm font-semibold text-foreground">
            Nodos {busqueda.trim() ? `(${coincidencias.length} coinciden)` : `(${nodos.length})`}
          </h3>
          <p className="mt-0.5 text-[11px] text-muted">Tabula por la lista y pulsa Intro para centrar el nodo en el grafo.</p>
          <ul className="scroll-fino mt-1.5 max-h-72 space-y-0.5 overflow-y-auto">
            {listaAccesible.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => centrarNodo(n.id)}
                  onFocus={() => {
                    hover.current = n.id;
                    pedirDibujo();
                  }}
                  onBlur={() => {
                    if (hover.current === n.id) {
                      hover.current = undefined;
                      pedirDibujo();
                    }
                  }}
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-panel ${
                    seleccion === n.id ? "bg-panel font-semibold" : ""
                  }`}
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ background: colores.nodo[n.tipo].relleno }} aria-hidden />
                  <span className="truncate text-foreground">{n.etiqueta}</span>
                </button>
              </li>
            ))}
          </ul>
          {!busqueda.trim() && nodos.length > listaAccesible.length && (
            <p className="mt-1 text-[11px] text-subtle">
              Se listan los {listaAccesible.length} primeros; usa el buscador para llegar al resto.
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}

/** Dónde llevar la vista cuando se pulsa en el minimapa. */
function centroDesdeMinimapa(
  simulacion: Simulacion,
  sx: number,
  sy: number,
  ancho: number,
  alto: number,
  k: number,
): Transformacion {
  const m = rectanguloMinimapa(ancho, alto);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of simulacion.nodos) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x);
    y1 = Math.max(y1, n.y);
  }
  const escala = Math.min((m.ancho - 8) / Math.max(1, x1 - x0), (m.alto - 8) / Math.max(1, y1 - y0));
  const ox = m.x + m.ancho / 2 - ((x0 + x1) / 2) * escala;
  const oy = m.y + m.alto / 2 - ((y0 + y1) / 2) * escala;
  const mundoX = (sx - ox) / escala;
  const mundoY = (sy - oy) / escala;
  return { k, x: ancho / 2 - mundoX * k, y: alto / 2 - mundoY * k };
}
