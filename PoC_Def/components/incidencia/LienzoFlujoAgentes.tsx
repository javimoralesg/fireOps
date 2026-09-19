"use client";
// =====================================================================
// ATALAYA INCENDIOS · Lienzo del flujo de agentes de una incidencia
// ---------------------------------------------------------------------
// DUEÑO: constructor G. Canvas 2D propio, sin librerías de grafos.
//
// Qué se ve: SIEMPRE los agentes de la aplicación, cada uno en la columna de
// su categoría; los que ahora mismo no hacen nada sobre esta incidencia salen
// en gris, a rayas y atenuados ("inactivo"), y los que trabajan en color pleno
// (con halo si están razonando). Alrededor, el mando humano, las decisiones
// autónomas, las unidades asignadas, las poblaciones avisadas y los canales
// externos (HappyRobot, Telegram, email), unidos por los traspasos que de
// verdad han ocurrido. Los pulsos recorren solo las aristas con actividad en
// los últimos 30 s.
//
// Interacción: pinchar un AGENTE abre su panel (qué está haciendo ahora, traza
// en curso con sus llamadas de IA en vivo, lo que tiene abierto aquí, historial
// y controles pausar/reanudar/forzar ciclo); pinchar un ENLACE abre el panel
// con lo que se compartió por él (observación, decisión, resultado real de la
// llamada o la ruta OSRM, con enlace a su acta). Además: arrastrar nodos (ratón
// o dedo), arrastrar el fondo para desplazar, rueda para acercar y «Reordenar».
// Las posiciones se guardan en localStorage por incendio.
// Respeta los tokens del tema (getComputedStyle) y `prefers-reduced-motion`.
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, Maximize2, Minus, MousePointerClick, Plus } from "lucide-react";
import type { EstadoAgenteApp, Informe, Snapshot, TrazaCiclo } from "@/lib/dominio/tipos";
import { duracion, fechaHora, haceCuanto, hora, recortar } from "@/lib/cliente/formato";
import { Boton } from "@/components/ui/Boton";
import { Insignia } from "@/components/ui/Insignia";
import { ControlesAgente, TEXTO_ESTADO_AGENTE, tonoEstadoAgente, useAccionesAgente } from "@/components/sala/TarjetaAgente";
import { DialogoInforme } from "@/components/sala/DialogoInforme";
import {
  construirGrafo,
  disposicionAutomatica,
  trazasDeAgenteEnIncendio,
  ultimaTrazaDe,
  MINUTOS_MUNDO_ACTIVIDAD,
  TITULOS_COLUMNA,
  type AristaFlujo,
  type GrafoFlujo,
  type HitoArista,
  type NodoColocable,
  type NodoFlujo,
  type TonoNodo,
} from "./grafoFlujo";
import { idsDeFoco } from "./hilo";

const ANCHO_NODO = 172;
const ALTO_NODO = 58;
/** Ventana de actividad que se anima (requisito: últimos 30 s). */
const VENTANA_PULSOS_MS = 30_000;
const DURACION_PULSO_MS = 1800;
const MAX_PULSOS_POR_ARISTA = 4;

interface Punto2D {
  x: number;
  y: number;
}

interface Tokens {
  panel: string;
  panel2: string;
  borde: string;
  bordeFuerte: string;
  texto: string;
  suave: string;
  marca: string;
  fuego: string;
  info: string;
  exito: string;
  aviso: string;
  peligro: string;
  neutro: string;
}

function leerTokens(): Tokens {
  const vacio: Tokens = {
    panel: "#ffffff",
    panel2: "#f5f8fa",
    borde: "#e3e9ee",
    bordeFuerte: "#c9d3dc",
    texto: "#16222e",
    suave: "#5a6b7c",
    marca: "#14707f",
    fuego: "#d94a2b",
    info: "#2a6db3",
    exito: "#1e7d4e",
    aviso: "#a95c0c",
    peligro: "#c4404a",
    neutro: "#6f7e8d",
  };
  if (typeof window === "undefined") return vacio;
  const estilo = getComputedStyle(document.documentElement);
  const v = (nombre: string, alterno: string) => estilo.getPropertyValue(nombre).trim() || alterno;
  return {
    panel: v("--panel", vacio.panel),
    panel2: v("--panel-2", vacio.panel2),
    borde: v("--panel-border", vacio.borde),
    bordeFuerte: v("--panel-border-strong", vacio.bordeFuerte),
    texto: v("--foreground", vacio.texto),
    suave: v("--muted", vacio.suave),
    marca: v("--brand", vacio.marca),
    fuego: v("--fuego", vacio.fuego),
    info: v("--info", vacio.info),
    exito: v("--success", vacio.exito),
    aviso: v("--warning", vacio.aviso),
    peligro: v("--danger", vacio.peligro),
    neutro: v("--subtle", vacio.neutro),
  };
}

function colorDeTono(tono: TonoNodo, t: Tokens): string {
  switch (tono) {
    case "marca":
      return t.marca;
    case "fuego":
      return t.fuego;
    case "info":
      return t.info;
    case "exito":
      return t.exito;
    case "aviso":
      return t.aviso;
    case "peligro":
      return t.peligro;
    default:
      return t.neutro;
  }
}

/** #rrggbb (o cualquier color css resuelto) con transparencia. */
function conAlfa(color: string, alfa: number): string {
  const limpio = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(limpio)) {
    const r = parseInt(limpio.slice(1, 3), 16);
    const g = parseInt(limpio.slice(3, 5), 16);
    const b = parseInt(limpio.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alfa})`;
  }
  if (/^#[0-9a-f]{3}$/i.test(limpio)) {
    const r = parseInt(limpio[1] + limpio[1], 16);
    const g = parseInt(limpio[2] + limpio[2], 16);
    const b = parseInt(limpio[3] + limpio[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${alfa})`;
  }
  return limpio;
}

function clave(incendioId: string): string {
  return `atalaya:lienzo:${incendioId}`;
}

function cargarPosiciones(incendioId: string): Record<string, Punto2D> {
  try {
    const bruto = window.localStorage.getItem(clave(incendioId));
    if (!bruto) return {};
    const datos: unknown = JSON.parse(bruto);
    if (!datos || typeof datos !== "object") return {};
    const salida: Record<string, Punto2D> = {};
    for (const [id, valor] of Object.entries(datos as Record<string, unknown>)) {
      if (valor && typeof valor === "object" && typeof (valor as Punto2D).x === "number" && typeof (valor as Punto2D).y === "number") {
        salida[id] = { x: (valor as Punto2D).x, y: (valor as Punto2D).y };
      }
    }
    return salida;
  } catch {
    // Navegación privada o almacenamiento lleno: se usa la disposición automática.
    return {};
  }
}

function guardarPosiciones(incendioId: string, posiciones: Record<string, Punto2D>): void {
  try {
    window.localStorage.setItem(clave(incendioId), JSON.stringify(posiciones));
  } catch {
    // No poder guardar la colocación nunca puede romper la pantalla.
  }
}

/** Punto de una curva de Bézier cúbica horizontal entre dos nodos. */
function puntoCurva(a: Punto2D, b: Punto2D, t: number): Punto2D {
  const dx = Math.max(60, Math.abs(b.x - a.x) * 0.5);
  const c1 = { x: a.x + dx, y: a.y };
  const c2 = { x: b.x - dx, y: b.y };
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  };
}

function textoRecortado(ctx: CanvasRenderingContext2D, texto: string, maxAncho: number): string {
  if (ctx.measureText(texto).width <= maxAncho) return texto;
  let corte = texto;
  while (corte.length > 1 && ctx.measureText(`${corte}…`).width > maxAncho) corte = corte.slice(0, -1);
  return `${corte}…`;
}

function rectanguloRedondeado(ctx: CanvasRenderingContext2D, x: number, y: number, ancho: number, alto: number, radio: number): void {
  ctx.beginPath();
  ctx.moveTo(x + radio, y);
  ctx.arcTo(x + ancho, y, x + ancho, y + alto, radio);
  ctx.arcTo(x + ancho, y + alto, x, y + alto, radio);
  ctx.arcTo(x, y + alto, x, y, radio);
  ctx.arcTo(x, y, x + ancho, y, radio);
  ctx.closePath();
}

export function LienzoFlujoAgentes({
  incendioId,
  snapshot,
  alto = 560,
  onTrasCambio,
}: {
  incendioId: string;
  snapshot?: Snapshot;
  alto?: number;
  /** Se llama tras pausar/reanudar/forzar el ciclo de un agente. */
  onTrasCambio?: () => void;
}) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const contenedor = useRef<HTMLDivElement>(null);

  const grafo: GrafoFlujo = useMemo(() => construirGrafo(snapshot, incendioId), [snapshot, incendioId]);

  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [enlaceSeleccionado, setEnlaceSeleccionado] = useState<string | null>(null);
  const [acta, setActa] = useState<Informe | null>(null);
  const [movimientoReducido, setMovimientoReducido] = useState(false);
  const [tokens, setTokens] = useState<Tokens>(() => leerTokens());
  const [escala, setEscala] = useState(1);

  const vista = useRef({ x: 0, y: 0, escala: 1 });
  const arrastre = useRef<{ tipo: "nodo" | "fondo"; id?: string; dx: number; dy: number } | null>(null);
  // Las posiciones viven en una referencia: se mueven docenas de veces por
  // segundo al arrastrar y no deben provocar un renderizado por cada píxel.
  const posicionesRef = useRef<Record<string, Punto2D>>({});
  /** Firma del último encuadre automático, para no reencuadrar en cada tick. */
  const encuadrado = useRef<string>("");
  /** Última colocación ya aplicada a la referencia. */
  const aplicadas = useRef<Record<string, Punto2D> | null>(null);

  // --- Posiciones: automáticas, corregidas con las guardadas ------------
  // El grafo se recalcula con CADA snapshot del SSE, pero la colocación solo
  // tiene que rehacerse cuando cambia el conjunto de nodos (no sus contadores):
  // si no, un arrastre en curso se perdería en cada tick. De ahí la firma.
  const firmaDisposicion = JSON.stringify(
    grafo.nodos
      .map((n) => ({ id: n.id, columna: n.columna, orden: n.orden, etiqueta: n.etiqueta }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
  const posicionesIniciales = useMemo(() => {
    const colocables = JSON.parse(firmaDisposicion) as NodoColocable[];
    const automaticas = disposicionAutomatica(colocables);
    const guardadas = typeof window === "undefined" ? {} : cargarPosiciones(incendioId);
    const combinadas: Record<string, Punto2D> = {};
    for (const n of colocables) combinadas[n.id] = guardadas[n.id] ?? automaticas[n.id] ?? { x: 120, y: 260 };
    return combinadas;
  }, [firmaDisposicion, incendioId]);

  // --- Tema y movimiento reducido ---------------------------------------
  useEffect(() => {
    const refrescarTokens = () => setTokens(leerTokens());
    // La primera lectura va diferida: durante el render del servidor no hay
    // `document` y hacerla en el cuerpo del efecto encadenaría renderizados.
    const primeraLectura = window.setTimeout(refrescarTokens, 0);
    const observador = new MutationObserver(refrescarTokens);
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    const oscuro = window.matchMedia("(prefers-color-scheme: dark)");
    oscuro.addEventListener("change", refrescarTokens);
    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)");
    const aplicarReducido = () => setMovimientoReducido(reducido.matches);
    const primeraPreferencia = window.setTimeout(aplicarReducido, 0);
    reducido.addEventListener("change", aplicarReducido);
    return () => {
      window.clearTimeout(primeraLectura);
      window.clearTimeout(primeraPreferencia);
      observador.disconnect();
      oscuro.removeEventListener("change", refrescarTokens);
      reducido.removeEventListener("change", aplicarReducido);
    };
  }, []);

  // --- Dibujo ------------------------------------------------------------
  const dibujar = useCallback(() => {
    const canvas = lienzo.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const t = tokens;
    const g = grafo;
    const pos = posicionesRef.current;
    const ahora = Date.now();
    const dpr = window.devicePixelRatio || 1;
    const anchoCSS = canvas.clientWidth;
    const altoCSS = canvas.clientHeight;
    if (canvas.width !== Math.round(anchoCSS * dpr) || canvas.height !== Math.round(altoCSS * dpr)) {
      canvas.width = Math.round(anchoCSS * dpr);
      canvas.height = Math.round(altoCSS * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, anchoCSS, altoCSS);
    ctx.fillStyle = t.panel;
    ctx.fillRect(0, 0, anchoCSS, altoCSS);

    ctx.save();
    ctx.translate(vista.current.x, vista.current.y);
    ctx.scale(vista.current.escala, vista.current.escala);

    // Rótulos de columna (contexto: de dónde viene y a dónde va cada cosa).
    const columnas = [...new Set(g.nodos.map((n) => n.columna))].sort((a, b) => a - b);
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const c of columnas) {
      const deLaColumna = g.nodos.filter((n) => n.columna === c).map((n) => pos[n.id]).filter(Boolean);
      if (!deLaColumna.length) continue;
      const x = deLaColumna.reduce((s, p) => s + p.x, 0) / deLaColumna.length;
      const y = Math.min(...deLaColumna.map((p) => p.y)) - ALTO_NODO / 2 - 26;
      ctx.fillStyle = conAlfa(t.suave, 0.85);
      ctx.fillText((TITULOS_COLUMNA[c] ?? `Fase ${c}`).toUpperCase(), x, y);
    }

    // Aristas
    for (const a of g.aristas) {
      const o = pos[a.origen];
      const d = pos[a.destino];
      if (!o || !d) continue;
      const salida = { x: o.x + (d.x >= o.x ? ANCHO_NODO / 2 : -ANCHO_NODO / 2), y: o.y };
      const llegada = { x: d.x + (d.x >= o.x ? -ANCHO_NODO / 2 : ANCHO_NODO / 2), y: d.y };
      const elegida = enlaceSeleccionado === a.id;
      const color = elegida ? t.marca : a.exito === false ? t.peligro : a.exito === true ? t.exito : t.bordeFuerte;
      const resaltada = elegida || (seleccionado !== null && (a.origen === seleccionado || a.destino === seleccionado));

      ctx.strokeStyle = conAlfa(color, resaltada ? 0.95 : 0.5);
      ctx.lineWidth = elegida ? 3.2 : resaltada ? 2.2 : Math.min(3, 1 + Math.log2(a.cuenta + 1) * 0.6);
      const dx = Math.max(60, Math.abs(llegada.x - salida.x) * 0.5);
      ctx.beginPath();
      ctx.moveTo(salida.x, salida.y);
      ctx.bezierCurveTo(salida.x + dx, salida.y, llegada.x - dx, llegada.y, llegada.x, llegada.y);
      ctx.stroke();

      // Punta de flecha
      const antes = puntoCurva(salida, llegada, 0.96);
      const angulo = Math.atan2(llegada.y - antes.y, llegada.x - antes.x);
      ctx.fillStyle = conAlfa(color, resaltada ? 0.95 : 0.7);
      ctx.beginPath();
      ctx.moveTo(llegada.x, llegada.y);
      ctx.lineTo(llegada.x - 9 * Math.cos(angulo - 0.35), llegada.y - 9 * Math.sin(angulo - 0.35));
      ctx.lineTo(llegada.x - 9 * Math.cos(angulo + 0.35), llegada.y - 9 * Math.sin(angulo + 0.35));
      ctx.closePath();
      ctx.fill();

      // Etiqueta del traspaso
      if (a.etiqueta && vista.current.escala > 0.75) {
        const medio = puntoCurva(salida, llegada, 0.5);
        ctx.font = "500 10px ui-sans-serif, system-ui, sans-serif";
        const etiqueta = textoRecortado(ctx, a.cuenta > 1 ? `${a.etiqueta} ×${a.cuenta}` : a.etiqueta, 150);
        const ancho = ctx.measureText(etiqueta).width + 8;
        ctx.fillStyle = conAlfa(t.panel, 0.92);
        rectanguloRedondeado(ctx, medio.x - ancho / 2, medio.y - 8, ancho, 16, 8);
        ctx.fill();
        ctx.fillStyle = conAlfa(t.suave, 0.95);
        ctx.fillText(etiqueta, medio.x, medio.y);
      }

      // Pulsos: solo lo ocurrido en los últimos 30 s (y nunca con movimiento reducido).
      if (!movimientoReducido) {
        const recientes = a.momentos.filter((m) => ahora - m >= 0 && ahora - m < VENTANA_PULSOS_MS).slice(-MAX_PULSOS_POR_ARISTA);
        for (const m of recientes) {
          const fase = ((ahora - m) % DURACION_PULSO_MS) / DURACION_PULSO_MS;
          const p = puntoCurva(salida, llegada, fase);
          const desvanecido = 1 - (ahora - m) / VENTANA_PULSOS_MS;
          ctx.fillStyle = conAlfa(a.exito === false ? t.peligro : t.marca, 0.35 + 0.55 * desvanecido);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Nodos
    for (const n of g.nodos) {
      const p = pos[n.id];
      if (!p) continue;
      const color = colorDeTono(n.tono, t);
      const x = p.x - ANCHO_NODO / 2;
      const y = p.y - ALTO_NODO / 2;
      const elegido = seleccionado === n.id;
      // Un agente que ahora mismo no hace nada sobre ESTA incidencia se atenúa:
      // así se ve el dispositivo entero y quién está callado.
      ctx.globalAlpha = n.activo ? 1 : 0.42;

      if (n.pensando && !movimientoReducido) {
        const latido = 0.5 + 0.5 * Math.sin(ahora / 320);
        ctx.strokeStyle = conAlfa(color, 0.15 + 0.35 * latido);
        ctx.lineWidth = 6 + 5 * latido;
        rectanguloRedondeado(ctx, x - 5, y - 5, ANCHO_NODO + 10, ALTO_NODO + 10, 16);
        ctx.stroke();
      } else if (n.pensando) {
        ctx.strokeStyle = conAlfa(color, 0.35);
        ctx.lineWidth = 6;
        rectanguloRedondeado(ctx, x - 5, y - 5, ANCHO_NODO + 10, ALTO_NODO + 10, 16);
        ctx.stroke();
      }

      rectanguloRedondeado(ctx, x, y, ANCHO_NODO, ALTO_NODO, 12);
      ctx.fillStyle = t.panel2;
      ctx.fill();
      ctx.strokeStyle = elegido ? t.marca : conAlfa(color, n.activo ? 0.75 : 0.5);
      ctx.lineWidth = elegido ? 2.6 : n.activo ? 1.6 : 1.1;
      if (!n.activo) ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Franja de categoría a la izquierda (el color nunca es la única señal).
      ctx.fillStyle = color;
      rectanguloRedondeado(ctx, x, y, 4, ALTO_NODO, 2);
      ctx.fill();

      ctx.textAlign = "left";
      ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = t.texto;
      ctx.fillText(textoRecortado(ctx, n.etiqueta, ANCHO_NODO - 22), x + 12, y + 16);

      ctx.font = "400 10px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = conAlfa(t.suave, 0.95);
      if (n.sub) ctx.fillText(textoRecortado(ctx, n.sub, ANCHO_NODO - 22), x + 12, y + 31);

      const contadores = n.contadores.filter((c) => c.valor > 0).map((c) => `${c.valor} ${c.etiqueta}`).join(" · ");
      if (contadores) {
        ctx.font = "500 10px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = conAlfa(color, 0.95);
        ctx.fillText(textoRecortado(ctx, contadores, ANCHO_NODO - 22), x + 12, y + 46);
      }
      if (n.pensando) {
        ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = color;
        ctx.textAlign = "right";
        ctx.fillText("razonando", x + ANCHO_NODO - 8, y + 16);
        ctx.textAlign = "left";
      } else if (!n.activo) {
        ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = conAlfa(t.suave, 0.9);
        ctx.textAlign = "right";
        ctx.fillText("inactivo", x + ANCHO_NODO - 8, y + 16);
        ctx.textAlign = "left";
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }, [grafo, tokens, seleccionado, enlaceSeleccionado, movimientoReducido]);

  // --- Bucle de dibujo ---------------------------------------------------
  useEffect(() => {
    let vivo = true;
    let peticion = 0;
    const bucle = () => {
      if (!vivo) return;
      dibujar();
      peticion = window.requestAnimationFrame(bucle);
    };
    if (movimientoReducido) {
      dibujar();
    } else {
      peticion = window.requestAnimationFrame(bucle);
    }
    return () => {
      vivo = false;
      if (peticion) window.cancelAnimationFrame(peticion);
    };
  }, [dibujar, movimientoReducido]);

  // --- Tamaño ------------------------------------------------------------
  useEffect(() => {
    const canvas = lienzo.current;
    if (!canvas) return;
    const observador = new ResizeObserver(() => dibujar());
    observador.observe(canvas);
    return () => observador.disconnect();
  }, [dibujar]);

  // --- Interacción -------------------------------------------------------
  const aMundo = useCallback((clienteX: number, clienteY: number): Punto2D => {
    const caja = lienzo.current?.getBoundingClientRect();
    if (!caja) return { x: 0, y: 0 };
    return {
      x: (clienteX - caja.left - vista.current.x) / vista.current.escala,
      y: (clienteY - caja.top - vista.current.y) / vista.current.escala,
    };
  }, []);

  const nodoEn = useCallback(
    (punto: Punto2D): NodoFlujo | undefined => {
    const pos = posicionesRef.current;
    // De arriba a abajo en el orden de pintado: el último dibujado manda.
    for (let i = grafo.nodos.length - 1; i >= 0; i -= 1) {
      const n = grafo.nodos[i];
      const p = pos[n.id];
      if (!p) continue;
      if (Math.abs(punto.x - p.x) <= ANCHO_NODO / 2 && Math.abs(punto.y - p.y) <= ALTO_NODO / 2) return n;
    }
    return undefined;
    },
    [grafo],
  );

  /** Arista más cercana al punto (muestreando la curva), si está lo bastante cerca. */
  const aristaEn = useCallback(
    (punto: Punto2D): AristaFlujo | undefined => {
      const pos = posicionesRef.current;
      const margen = 12 / Math.max(0.35, vista.current.escala);
      let mejor: { arista: AristaFlujo; distancia: number } | undefined;
      for (const a of grafo.aristas) {
        const o = pos[a.origen];
        const d = pos[a.destino];
        if (!o || !d) continue;
        const salida = { x: o.x + (d.x >= o.x ? ANCHO_NODO / 2 : -ANCHO_NODO / 2), y: o.y };
        const llegada = { x: d.x + (d.x >= o.x ? -ANCHO_NODO / 2 : ANCHO_NODO / 2), y: d.y };
        for (let i = 0; i <= 28; i += 1) {
          const q = puntoCurva(salida, llegada, i / 28);
          const distancia = Math.hypot(q.x - punto.x, q.y - punto.y);
          if (distancia < margen && (!mejor || distancia < mejor.distancia)) mejor = { arista: a, distancia };
        }
      }
      return mejor?.arista;
    },
    [grafo],
  );

  function alPulsar(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const punto = aMundo(e.clientX, e.clientY);
    const nodo = nodoEn(punto);
    if (nodo) {
      const p = posicionesRef.current[nodo.id];
      arrastre.current = { tipo: "nodo", id: nodo.id, dx: punto.x - p.x, dy: punto.y - p.y };
      setSeleccionado(nodo.id);
      setEnlaceSeleccionado(null);
      return;
    }
    // Sin nodo debajo: ¿hay un enlace? Si lo hay se abre su panel; si no, se desplaza.
    const arista = aristaEn(punto);
    if (arista) {
      setEnlaceSeleccionado(arista.id);
      setSeleccionado(null);
      return;
    }
    setEnlaceSeleccionado(null);
    arrastre.current = { tipo: "fondo", dx: e.clientX - vista.current.x, dy: e.clientY - vista.current.y };
  }

  function alMover(e: React.PointerEvent<HTMLCanvasElement>) {
    const estado = arrastre.current;
    if (!estado) return;
    if (estado.tipo === "fondo") {
      vista.current.x = e.clientX - estado.dx;
      vista.current.y = e.clientY - estado.dy;
      dibujar();
      return;
    }
    if (!estado.id) return;
    const punto = aMundo(e.clientX, e.clientY);
    posicionesRef.current = {
      ...posicionesRef.current,
      [estado.id]: { x: punto.x - estado.dx, y: punto.y - estado.dy },
    };
    dibujar();
  }

  function alSoltar(e: React.PointerEvent<HTMLCanvasElement>) {
    const estado = arrastre.current;
    arrastre.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // El puntero ya se había liberado (salida de la ventana): sin consecuencias.
    }
    if (estado?.tipo === "nodo") guardarPosiciones(incendioId, posicionesRef.current);
  }

  // La rueda se registra a mano para poder cancelar el desplazamiento de la página.
  useEffect(() => {
    const canvas = lienzo.current;
    if (!canvas) return;
    const alRodar = (e: WheelEvent) => {
      e.preventDefault();
      const caja = canvas.getBoundingClientRect();
      const cx = e.clientX - caja.left;
      const cy = e.clientY - caja.top;
      const anterior = vista.current.escala;
      const siguiente = Math.min(2.5, Math.max(0.35, anterior * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      vista.current.x = cx - ((cx - vista.current.x) / anterior) * siguiente;
      vista.current.y = cy - ((cy - vista.current.y) / anterior) * siguiente;
      vista.current.escala = siguiente;
      setEscala(siguiente);
      dibujar();
    };
    canvas.addEventListener("wheel", alRodar, { passive: false });
    return () => canvas.removeEventListener("wheel", alRodar);
  }, [dibujar]);

  const ajustarZoom = useCallback(
    (factor: number) => {
      const canvas = lienzo.current;
      if (!canvas) return;
      const cx = canvas.clientWidth / 2;
      const cy = canvas.clientHeight / 2;
      const anterior = vista.current.escala;
      const siguiente = Math.min(2.5, Math.max(0.35, anterior * factor));
      vista.current.x = cx - ((cx - vista.current.x) / anterior) * siguiente;
      vista.current.y = cy - ((cy - vista.current.y) / anterior) * siguiente;
      vista.current.escala = siguiente;
      setEscala(siguiente);
      dibujar();
    },
    [dibujar],
  );

  const encuadrar = useCallback(() => {
    const canvas = lienzo.current;
    const pos = posicionesRef.current;
    const nodos = grafo.nodos;
    if (!canvas || !nodos.length) return;
    const xs = nodos.map((n) => pos[n.id]?.x).filter((x): x is number => typeof x === "number");
    const ys = nodos.map((n) => pos[n.id]?.y).filter((y): y is number => typeof y === "number");
    if (!xs.length) return;
    const minX = Math.min(...xs) - ANCHO_NODO;
    const maxX = Math.max(...xs) + ANCHO_NODO;
    const minY = Math.min(...ys) - ALTO_NODO - 30;
    const maxY = Math.max(...ys) + ALTO_NODO;
    const escalaNueva = Math.min(2, Math.max(0.35, Math.min(canvas.clientWidth / (maxX - minX), canvas.clientHeight / (maxY - minY))));
    vista.current.escala = escalaNueva;
    vista.current.x = canvas.clientWidth / 2 - ((minX + maxX) / 2) * escalaNueva;
    vista.current.y = canvas.clientHeight / 2 - ((minY + maxY) / 2) * escalaNueva;
    setEscala(escalaNueva);
    dibujar();
  }, [dibujar, grafo]);

  // La referencia se sincroniza en un efecto (nunca durante el render) y se
  // repinta: así el lienzo sigue al grafo sin un estado paralelo.
  useEffect(() => {
    // Nunca durante un arrastre: se perdería el nodo que el usuario tiene cogido.
    if (aplicadas.current !== posicionesIniciales && !arrastre.current) {
      aplicadas.current = posicionesIniciales;
      posicionesRef.current = posicionesIniciales;
      // Un solo encuadre automático por incidencia, cuando ya hay algo que ver.
      if (encuadrado.current !== incendioId && Object.keys(posicionesIniciales).length > 1) {
        encuadrado.current = incendioId;
        encuadrar();
        return;
      }
    }
    dibujar();
  }, [posicionesIniciales, dibujar, encuadrar, incendioId]);

  function reordenar() {
    const automaticas = disposicionAutomatica(grafo.nodos);
    posicionesRef.current = automaticas;
    aplicadas.current = automaticas;
    guardarPosiciones(incendioId, automaticas);
    encuadrar();
  }

  const nodoSeleccionado = grafo.nodos.find((n) => n.id === seleccionado);
  const aristaSeleccionada = grafo.aristas.find((a) => a.id === enlaceSeleccionado);
  const activos = grafo.nodos.filter((n) => n.tipo === "agente" && n.activo).length;
  const totalAgentes = grafo.nodos.filter((n) => n.tipo === "agente").length;
  const abrirActa = (informeId?: string) => {
    if (!informeId) return;
    const encontrado = (snapshot?.informes ?? []).find((i) => i.id === informeId);
    if (encontrado) setActa(encontrado);
  };

  return (
    <div ref={contenedor} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Boton tamano="sm" icono={<LayoutGrid />} onClick={reordenar}>
          Reordenar
        </Boton>
        <Boton tamano="sm" variante="fantasma" icono={<Maximize2 />} onClick={encuadrar}>
          Encuadrar
        </Boton>
        <Boton tamano="sm" variante="fantasma" icono={<Plus />} onClick={() => ajustarZoom(1.15)} aria-label="Acercar">
          Acercar
        </Boton>
        <Boton tamano="sm" variante="fantasma" icono={<Minus />} onClick={() => ajustarZoom(1 / 1.15)} aria-label="Alejar">
          Alejar
        </Boton>
        <span className="tabular ml-auto text-[11px] text-subtle">
          {activos} de {totalAgentes} agentes trabajando aquí · {grafo.aristas.length} traspasos · ×{escala.toFixed(2)}
        </span>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-panel-border bg-panel">
        <canvas
          ref={lienzo}
          role="img"
          aria-label={`Flujo de agentes que intervienen en la incidencia: ${grafo.nodos.map((n) => n.etiqueta).join(", ") || "todavía sin intervención"}`}
          style={{ height: alto, touchAction: "none" }}
          className="block w-full cursor-grab active:cursor-grabbing"
          onPointerDown={alPulsar}
          onPointerMove={alMover}
          onPointerUp={alSoltar}
          onPointerCancel={alSoltar}
        />
        {grafo.aristas.length === 0 ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[12px] text-subtle">
            Los agentes están en su sitio pero todavía no ha habido ningún traspaso en esta incidencia. En cuanto lleguen observaciones o
            decisiones, los enlaces se encenderán.
          </p>
        ) : null}
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-subtle">
        <MousePointerClick className="size-3.5 shrink-0" aria-hidden />
        Pincha un agente para ver qué está haciendo ahora y controlarlo, o un enlace para ver qué se compartió por él. Arrastra los nodos
        para colocarlos (se recuerdan en este navegador), arrastra el fondo para desplazar y usa la rueda para acercar. Los pulsos marcan lo
        ocurrido en los últimos 30 segundos; en gris y a rayas, los agentes que ahora mismo no hacen nada sobre esta incidencia (sin ciclo en
        curso ni señal en los últimos {MINUTOS_MUNDO_ACTIVIDAD} minutos de mundo).
        {movimientoReducido ? " Animación desactivada: tu sistema pide movimiento reducido." : ""}
      </p>

      {nodoSeleccionado ? (
        <PanelNodo
          nodo={nodoSeleccionado}
          grafo={grafo}
          snapshot={snapshot}
          incendioId={incendioId}
          onCerrar={() => setSeleccionado(null)}
          onSeleccionarEnlace={(id) => {
            setEnlaceSeleccionado(id);
            setSeleccionado(null);
          }}
          onTrasCambio={onTrasCambio}
        />
      ) : null}

      {aristaSeleccionada ? (
        <PanelEnlace
          arista={aristaSeleccionada}
          grafo={grafo}
          onCerrar={() => setEnlaceSeleccionado(null)}
          onAbrirActa={abrirActa}
        />
      ) : null}

      <DialogoInforme informe={acta} onCerrar={() => setActa(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------
// Panel de un nodo: qué está haciendo AHORA y qué ha hecho aquí
// ---------------------------------------------------------------------

function PanelNodo({
  nodo,
  grafo,
  snapshot,
  incendioId,
  onCerrar,
  onSeleccionarEnlace,
  onTrasCambio,
}: {
  nodo: NodoFlujo;
  grafo: GrafoFlujo;
  snapshot?: Snapshot;
  incendioId: string;
  onCerrar: () => void;
  onSeleccionarEnlace: (id: string) => void;
  onTrasCambio?: () => void;
}) {
  const { ejecutar, ocupado } = useAccionesAgente(onTrasCambio);
  const ficha: EstadoAgenteApp | undefined = nodo.agenteId ? snapshot?.agentes.find((a) => a.id === nodo.agenteId) : undefined;

  const idsFoco = useMemo(() => idsDeFoco(snapshot, incendioId), [snapshot, incendioId]);
  const decisionesSuyas = useMemo(
    () =>
      (snapshot?.decisiones ?? [])
        .filter((d) => d.agenteId === nodo.agenteId && d.incendioId && idsFoco.has(d.incendioId))
        .sort((a, b) => b.creadaEn.localeCompare(a.creadaEn)),
    [snapshot, nodo.agenteId, idsFoco],
  );
  const pendientes = decisionesSuyas.filter((d) => ["propuesta", "pendiente_humano", "escalada", "aprobada", "ejecutando"].includes(d.estado));
  const accionesEnMarcha = decisionesSuyas.flatMap((d) =>
    d.acciones.filter((a) => a.estado === "pendiente" || a.estado === "ejecutando").map((a) => ({ a, d })),
  );
  const historial = useMemo(
    () => (nodo.agenteId ? trazasDeAgenteEnIncendio(snapshot, nodo.agenteId, incendioId) : []),
    [snapshot, nodo.agenteId, incendioId],
  );
  const enCurso: TrazaCiclo | undefined = (ficha?.trazas ?? []).find((t) => t.estado === "en_curso");
  const ultima = ultimaTrazaDe(snapshot, nodo.agenteId ?? "", incendioId);
  const aristas: AristaFlujo[] = grafo.aristas.filter((a) => a.origen === nodo.id || a.destino === nodo.id);

  return (
    <section className="rounded-xl border border-panel-border bg-panel-2 p-3" aria-live="polite">
      <header className="flex flex-wrap items-center gap-1.5">
        <h4 className="text-[13px] font-semibold text-foreground">{nodo.etiqueta}</h4>
        {ficha ? (
          <Insignia pequena tono={tonoEstadoAgente(ficha.estado)} punto>
            {TEXTO_ESTADO_AGENTE[ficha.estado]}
          </Insignia>
        ) : (
          <Insignia pequena tono="neutro">{nodo.tipo}</Insignia>
        )}
        <Insignia pequena tono={nodo.activo ? "exito" : "neutro"}>
          {nodo.activo ? "trabajando en esta incidencia" : "inactivo ahora en esta incidencia"}
        </Insignia>
        {ficha?.controlHumano ? <Insignia pequena tono="marca">Control humano</Insignia> : null}
        {nodo.contadores
          .filter((c) => c.valor > 0)
          .map((c) => (
            <Insignia key={c.etiqueta} pequena tono="neutro">
              {c.valor} {c.etiqueta}
            </Insignia>
          ))}
        <button type="button" className="ml-auto text-[11.5px] text-brand underline underline-offset-2" onClick={onCerrar}>
          Cerrar
        </button>
      </header>

      {ficha ? (
        <>
          <p className="mt-2 text-[12.5px] leading-snug text-foreground">
            <span className="font-medium">Ahora mismo:</span> {ficha.tareaActual || "sin tarea anotada"}
            {ficha.incendioId ? ` · sobre ${snapshot?.incendios.find((i) => i.id === ficha.incendioId)?.nombre ?? ficha.incendioId}` : ""}
            {ficha.ultimaActividad ? ` · última actividad ${haceCuanto(ficha.ultimaActividad)}` : ""}
          </p>
          <p className="mt-0.5 text-[11.5px] text-subtle">
            {ficha.descripcion} · modelo {ficha.modelo} · un ciclo cada {ficha.cadenciaSeg} s
          </p>
          {ficha.ultimoError ? <p className="mt-1 text-[12px] text-danger">Último error: {ficha.ultimoError}</p> : null}

          <div className="mt-2">
            <ControlesAgente agente={ficha} ejecutar={ejecutar} ocupado={ocupado} />
          </div>

          {enCurso ? (
            <div className="mt-2 rounded-lg border border-brand/45 bg-brand/8 px-2 py-1.5 text-[12px] text-muted">
              <p className="font-medium text-foreground">
                Ciclo en curso · motivo «{enCurso.motivo}» · empezó {haceCuanto(enCurso.inicio)}
              </p>
              <p>Qué está mirando: {enCurso.entradas ?? "no anotado"}</p>
              <p>
                Llamadas de IA en vivo ({enCurso.llamadasIA.length}):{" "}
                {enCurso.llamadasIA.length
                  ? enCurso.llamadasIA.map((l) => `${l.proveedor}/${l.modelo} (${l.papel}, ${l.latenciaMs} ms)`).join(" · ")
                  : "ninguna todavía"}
              </p>
              {enCurso.llamadasIA.slice(-2).map((l, i) => (
                <p key={`${l.en}-${i}`} className="mt-1 rounded border border-panel-border bg-panel px-2 py-1 text-[11.5px]">
                  <span className="font-medium text-foreground">Pregunta:</span> {recortar(l.promptResumen, 220)}
                  <br />
                  <span className="font-medium text-foreground">Respuesta:</span> {recortar(l.respuestaResumen, 220)}
                  {l.error ? <span className="block text-danger">Error: {l.error}</span> : null}
                </p>
              ))}
            </div>
          ) : null}

          {pendientes.length || accionesEnMarcha.length ? (
            <div className="mt-2 text-[12px] text-muted">
              <p className="font-medium text-foreground">Lo que tiene abierto en esta incidencia</p>
              <ul className="mt-0.5 space-y-0.5">
                {pendientes.slice(0, 5).map((d) => (
                  <li key={d.id}>
                    «{d.titulo}» — {d.estado.replace(/_/g, " ")} · prioridad {d.prioridad}{" "}
                    <a href={`/auditoria?decision=${encodeURIComponent(d.id)}`} className="text-brand underline underline-offset-2">
                      auditar
                    </a>
                  </li>
                ))}
                {accionesEnMarcha.slice(0, 5).map(({ a, d }) => (
                  <li key={a.id}>
                    Acción {a.tipo.replace(/_/g, " ")} — {a.descripcion} ({a.estado}) · de «{d.titulo}»
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-muted">No tiene nada abierto en esta incidencia ahora mismo.</p>
          )}

          <div className="mt-2 border-t border-panel-border pt-2 text-[12px] text-muted">
            <p className="font-medium text-foreground">Historial reciente sobre esta incidencia ({historial.length} ciclos)</p>
            {historial.length ? (
              <ul className="mt-0.5 space-y-0.5">
                {historial.slice(0, 5).map((t) => (
                  <li key={t.id}>
                    <span className="tabular text-subtle">{hora(t.inicio)}</span> · {t.motivo} · {t.estado} · {duracion(t.duracionMs)} ·{" "}
                    {t.resumen ?? "sin resumen"}
                    {t.error ? <span className="text-danger"> · {t.error}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No se conserva ninguna traza de este agente sobre esta incidencia
                {ultima ? "" : " (solo se guardan los últimos ciclos de cada agente)"}.
              </p>
            )}
            <p className="mt-1">
              <a href={`/agentes/${encodeURIComponent(ficha.id)}`} className="text-brand underline underline-offset-2">
                Ver la ficha completa del agente
              </a>
            </p>
          </div>
        </>
      ) : (
        <p className="mt-2 text-[12.5px] leading-snug text-muted">
          {nodo.sub ?? "Nodo del flujo."} {nodo.activo ? "" : "Sin actividad registrada ahora mismo."}
        </p>
      )}

      {aristas.length ? (
        <div className="mt-2 border-t border-panel-border pt-2">
          <p className="text-[12px] font-medium text-foreground">Enlaces de este nodo (pincha para ver qué se compartió)</p>
          <ul className="mt-0.5 space-y-0.5 text-[12px] text-muted">
            {aristas.slice(0, 10).map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => onSeleccionarEnlace(a.id)} className="text-left text-brand underline underline-offset-2">
                  {a.origen === nodo.id ? "→ " : "← "}
                  {grafo.nodos.find((n) => n.id === (a.origen === nodo.id ? a.destino : a.origen))?.etiqueta ?? "?"}
                </button>{" "}
                {a.etiqueta ? `· ${a.etiqueta}` : ""} {a.cuenta > 1 ? `· ×${a.cuenta}` : ""}
                {a.exito === false ? <span className="text-danger"> · falló</span> : a.exito === true ? <span className="text-success"> · con éxito</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------
// Panel de un enlace: lo que se compartió por él
// ---------------------------------------------------------------------

const TEXTO_HITO: Record<HitoArista["tipo"], string> = {
  observacion: "Observación",
  decision: "Decisión",
  evaluacion: "Evaluación del supervisor",
  accion: "Acción ejecutada",
  acta: "Acta",
  analisis: "Análisis",
};

function PanelEnlace({
  arista,
  grafo,
  onCerrar,
  onAbrirActa,
}: {
  arista: AristaFlujo;
  grafo: GrafoFlujo;
  onCerrar: () => void;
  onAbrirActa: (informeId?: string) => void;
}) {
  const origen = grafo.nodos.find((n) => n.id === arista.origen);
  const destino = grafo.nodos.find((n) => n.id === arista.destino);
  const hitos = [...arista.hitos].reverse();

  return (
    <section className="rounded-xl border border-brand/45 bg-panel-2 p-3" aria-live="polite">
      <header className="flex flex-wrap items-center gap-1.5">
        <h4 className="text-[13px] font-semibold text-foreground">
          {origen?.etiqueta ?? arista.origen} → {destino?.etiqueta ?? arista.destino}
        </h4>
        {arista.etiqueta ? <Insignia pequena tono="marca">{arista.etiqueta}</Insignia> : null}
        <Insignia pequena tono="neutro">{arista.cuenta} traspaso(s)</Insignia>
        {arista.exito === false ? (
          <Insignia pequena tono="peligro">Con fallos</Insignia>
        ) : arista.exito === true ? (
          <Insignia pequena tono="exito">Con éxito</Insignia>
        ) : null}
        <button type="button" className="ml-auto text-[11.5px] text-brand underline underline-offset-2" onClick={onCerrar}>
          Cerrar
        </button>
      </header>

      {hitos.length === 0 ? (
        <p className="mt-2 text-[12px] text-muted">
          Este enlace existe por la estructura del flujo, pero todavía no se ha compartido nada concreto por él.
        </p>
      ) : (
        <ol className="mt-2 space-y-2">
          {hitos.map((h, i) => (
            <li key={`${h.en}-${i}`} className="rounded-lg border border-panel-border bg-panel px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Insignia pequena tono="marca">{TEXTO_HITO[h.tipo]}</Insignia>
                {h.canal ? <Insignia pequena tono="info">{h.canal}</Insignia> : null}
                {h.exito === true ? <Insignia pequena tono="exito">Éxito</Insignia> : null}
                {h.exito === false ? <Insignia pequena tono="peligro">Fallo</Insignia> : null}
                <span className="tabular ml-auto text-[10.5px] text-subtle" title={fechaHora(h.en)}>
                  {hora(h.en)} · {haceCuanto(h.en)}
                </span>
              </div>
              <p className="mt-1 text-[12.5px] font-medium leading-snug text-foreground">{h.titulo}</p>
              {h.destino ? (
                <p className="mt-0.5 text-[12px] text-muted">
                  <span className="font-medium text-foreground">Destino:</span> {h.destino}
                </p>
              ) : null}
              {h.ruta ? (
                <p className="mt-0.5 text-[12px] text-muted">
                  <span className="font-medium text-foreground">Ruta:</span> {h.ruta}
                </p>
              ) : null}
              {h.respuesta ? (
                <p className="mt-0.5 whitespace-pre-line text-[12px] text-muted">
                  <span className="font-medium text-foreground">Respuesta:</span> {h.respuesta}
                </p>
              ) : null}
              {h.detalle ? <p className="mt-0.5 whitespace-pre-line text-[12px] leading-snug text-muted">{recortar(h.detalle, 900)}</p> : null}
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                {h.proveedor ? <span className="text-subtle">Proveedor: {h.proveedor}</span> : null}
                {h.referencia ? <span className="text-subtle">Ref. {h.referencia}</span> : null}
                {h.informeId ? (
                  <button type="button" onClick={() => onAbrirActa(h.informeId)} className="text-brand underline underline-offset-2">
                    Abrir su acta
                  </button>
                ) : null}
                {h.decisionId ? (
                  <a href={`/auditoria?decision=${encodeURIComponent(h.decisionId)}`} className="text-brand underline underline-offset-2">
                    Cadena de auditoría
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
