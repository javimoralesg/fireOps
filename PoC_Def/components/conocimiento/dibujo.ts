// =====================================================================
// ATALAYA INCENDIOS · Pintado del grafo en canvas 2D
// ---------------------------------------------------------------------
// DUEÑO: constructor I.
// Canvas y no SVG: con 300-600 nodos y 500-1500 aristas, mantener ese número
// de elementos en el DOM hunde el arrastre. Aquí se pinta todo en un solo
// elemento, por lotes de color, y React no se entera de cada fotograma.
//
// Reglas de lectura:
//   · etiqueta SIEMPRE para documentos y entidades; para fragmentos, al pasar
//     el ratón, al seleccionarlos, si están en la respuesta o si hay zoom;
//   · si dos etiquetas chocan se prueba otra posición (derecha, izquierda,
//     arriba, abajo) y, si tampoco cabe, esa etiqueta se calla;
//   · al señalar un nodo, sus vecinos y aristas mantienen el color y el resto
//     se atenúa.
// =====================================================================

import type { ColoresGrafo } from "./tema";
import { limites, type NodoSim, type Simulacion, type TipoArista } from "./simulacion";

export interface Transformacion {
  x: number;
  y: number;
  k: number;
}

export interface MarcaConsulta {
  orden: number;
  /** true = recuperado por similitud; false = alcanzado por el grafo. */
  primario: boolean;
}

export interface ParametrosDibujo {
  ctx: CanvasRenderingContext2D;
  ancho: number;
  alto: number;
  sim: Simulacion;
  vista: Transformacion;
  colores: ColoresGrafo;
  tiposActivos: Set<TipoArista>;
  hover?: string;
  seleccion?: string;
  destacados: Map<string, MarcaConsulta>;
  minimapa: boolean;
}

export const MINIMAPA = { ancho: 148, alto: 104, margen: 12 };

export function rectanguloMinimapa(ancho: number, alto: number) {
  return {
    x: ancho - MINIMAPA.ancho - MINIMAPA.margen,
    y: alto - MINIMAPA.alto - MINIMAPA.margen,
    ancho: MINIMAPA.ancho,
    alto: MINIMAPA.alto,
  };
}

/** Zoom a partir del cual se leen también las etiquetas de los fragmentos. */
export const ZOOM_ETIQUETAS_CHUNK = 1.45;

const anchoTexto = new Map<string, number>();
function medir(ctx: CanvasRenderingContext2D, texto: string, fuente: string): number {
  const clave = `${fuente}|${texto}`;
  const guardado = anchoTexto.get(clave);
  if (guardado !== undefined) return guardado;
  const w = ctx.measureText(texto).width;
  anchoTexto.set(clave, w);
  if (anchoTexto.size > 4000) anchoTexto.clear();
  return w;
}

function recortar(texto: string, maximo: number): string {
  return texto.length > maximo ? `${texto.slice(0, maximo - 1)}…` : texto;
}

interface Caja {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function choca(caja: Caja, ocupadas: Caja[]): boolean {
  for (const o of ocupadas) {
    if (caja.x0 < o.x1 && caja.x1 > o.x0 && caja.y0 < o.y1 && caja.y1 > o.y0) return true;
  }
  return false;
}

export function dibujar(p: ParametrosDibujo): void {
  const { ctx, ancho, alto, sim, vista, colores, tiposActivos, hover, seleccion, destacados } = p;
  const foco = hover ?? seleccion;
  const vecinos = foco ? sim.vecinos.get(foco) : undefined;
  const atenuar = Boolean(foco);

  ctx.save();
  ctx.clearRect(0, 0, ancho, alto);
  ctx.fillStyle = colores.fondo;
  ctx.fillRect(0, 0, ancho, alto);

  const px = (x: number) => x * vista.k + vista.x;
  const py = (y: number) => y * vista.k + vista.y;
  const visible = (n: NodoSim) => {
    const x = px(n.x);
    const y = py(n.y);
    return x > -60 && x < ancho + 60 && y > -60 && y < alto + 60;
  };

  const resaltado = (id: string) => !atenuar || id === foco || Boolean(vecinos?.has(id));

  // ---------- aristas, por lotes de color ----------
  ctx.lineCap = "round";
  for (const tipo of tiposActivos) {
    for (const fuerte of [false, true]) {
      ctx.beginPath();
      let hay = false;
      for (const e of sim.aristas) {
        if (e.tipo !== tipo) continue;
        const a = sim.nodos[e.a];
        const b = sim.nodos[e.b];
        const destaca = resaltado(a.id) && resaltado(b.id);
        if (destaca !== fuerte) continue;
        const x1 = px(a.x);
        const y1 = py(a.y);
        const x2 = px(b.x);
        const y2 = py(b.y);
        if ((x1 < 0 && x2 < 0) || (x1 > ancho && x2 > ancho) || (y1 < 0 && y2 < 0) || (y1 > alto && y2 > alto)) continue;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        hay = true;
      }
      if (!hay) continue;
      ctx.strokeStyle = colores.arista[tipo];
      ctx.globalAlpha = fuerte ? (atenuar ? 0.95 : 0.55) : 0.07;
      ctx.lineWidth = (tipo === "referencia" ? 2 : 1.2) * Math.min(1.6, Math.max(0.7, vista.k));
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // ---------- halos del modo consulta ----------
  if (destacados.size) {
    for (const n of sim.nodos) {
      const marca = destacados.get(n.id);
      if (!marca || !visible(n)) continue;
      const r = Math.max(6, n.radio * vista.k);
      ctx.beginPath();
      ctx.arc(px(n.x), py(n.y), r + (marca.primario ? 9 : 6), 0, Math.PI * 2);
      ctx.strokeStyle = marca.primario ? colores.destacado : colores.acento;
      ctx.lineWidth = marca.primario ? 3 : 2;
      ctx.globalAlpha = marca.primario ? 0.95 : 0.7;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // ---------- nodos ----------
  for (const n of sim.nodos) {
    if (!visible(n)) continue;
    const color = colores.nodo[n.tipo];
    const r = Math.max(2.5, n.radio * vista.k);
    const fuerte = resaltado(n.id);
    ctx.globalAlpha = fuerte ? 1 : 0.18;
    ctx.beginPath();
    ctx.arc(px(n.x), py(n.y), r, 0, Math.PI * 2);
    ctx.fillStyle = color.relleno;
    ctx.fill();
    if (r > 3.2) {
      ctx.strokeStyle = n.id === seleccion ? colores.texto : color.borde;
      ctx.lineWidth = n.id === seleccion ? 3 : 1.2;
      ctx.stroke();
    }
    // Un nodo clavado lleva un punto blanco dentro: se ve que lo movió alguien.
    if (n.fijado && r > 4) {
      ctx.beginPath();
      ctx.arc(px(n.x), py(n.y), Math.max(1.5, r * 0.3), 0, Math.PI * 2);
      ctx.fillStyle = colores.oscuro ? "#0e1319" : "#ffffff";
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- número de orden de la respuesta ----------
  if (destacados.size) {
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const n of sim.nodos) {
      const marca = destacados.get(n.id);
      if (!marca || !visible(n)) continue;
      const r = Math.max(6, n.radio * vista.k);
      const cx = px(n.x) + r + 10;
      const cy = py(n.y) - r - 8;
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.fillStyle = marca.primario ? colores.destacado : colores.acento;
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String(marca.orden), cx, cy + 0.5);
    }
  }

  // ---------- etiquetas ----------
  const ocupadas: Caja[] = [];
  const candidatos = [...sim.nodos]
    .filter((n) => visible(n))
    .sort((a, b) => prioridad(b, foco, seleccion, destacados) - prioridad(a, foco, seleccion, destacados));

  ctx.textBaseline = "middle";
  for (const n of candidatos) {
    const especial = n.id === foco || n.id === seleccion || destacados.has(n.id);
    if (n.tipo === "chunk" && !especial && vista.k < ZOOM_ETIQUETAS_CHUNK) continue;
    if (!resaltado(n.id) && !especial) continue;
    if (n.tipo === "chunk" && vista.k < 0.5 && !especial) continue;

    const tamano = n.tipo === "documento" ? 13 : n.tipo === "entidad" ? 12 : 11;
    const peso = n.tipo === "documento" ? "600" : especial ? "600" : "400";
    const fuente = `${peso} ${tamano}px system-ui, sans-serif`;
    ctx.font = fuente;
    const texto = recortar(n.etiqueta, n.tipo === "documento" ? 42 : 34);
    const w = medir(ctx, texto, fuente);
    const h = tamano + 4;
    const r = Math.max(3, n.radio * vista.k);
    const x = px(n.x);
    const y = py(n.y);

    // Se prueban cuatro posiciones antes de renunciar a la etiqueta.
    const opciones: { cx: number; cy: number; align: CanvasTextAlign }[] = [
      { cx: x + r + 6, cy: y, align: "left" },
      { cx: x - r - 6, cy: y, align: "right" },
      { cx: x, cy: y - r - h * 0.75, align: "center" },
      { cx: x, cy: y + r + h * 0.75, align: "center" },
    ];
    let puesta: { cx: number; cy: number; align: CanvasTextAlign } | undefined;
    for (const o of opciones) {
      const x0 = o.align === "left" ? o.cx : o.align === "right" ? o.cx - w : o.cx - w / 2;
      const caja = { x0: x0 - 2, y0: o.cy - h / 2, x1: x0 + w + 2, y1: o.cy + h / 2 };
      if (choca(caja, ocupadas)) continue;
      ocupadas.push(caja);
      puesta = o;
      break;
    }
    if (!puesta) continue;

    ctx.textAlign = puesta.align;
    // Halo del color del panel: la etiqueta se lee sobre las aristas.
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = colores.fondo;
    ctx.globalAlpha = 0.9;
    ctx.strokeText(texto, puesta.cx, puesta.cy);
    ctx.globalAlpha = resaltado(n.id) ? 1 : 0.4;
    ctx.fillStyle = especial ? colores.texto : n.tipo === "chunk" ? colores.textoTenue : colores.texto;
    ctx.fillText(texto, puesta.cx, puesta.cy);
    ctx.globalAlpha = 1;
  }

  // ---------- minimapa ----------
  if (p.minimapa && sim.nodos.length) {
    const m = rectanguloMinimapa(ancho, alto);
    const caja = limites(sim.nodos);
    const anchoMundo = Math.max(1, caja.x1 - caja.x0);
    const altoMundo = Math.max(1, caja.y1 - caja.y0);
    const escala = Math.min((m.ancho - 8) / anchoMundo, (m.alto - 8) / altoMundo);
    const ox = m.x + m.ancho / 2 - ((caja.x0 + caja.x1) / 2) * escala;
    const oy = m.y + m.alto / 2 - ((caja.y0 + caja.y1) / 2) * escala;

    ctx.globalAlpha = 0.94;
    ctx.fillStyle = colores.fondo;
    ctx.strokeStyle = colores.borde;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(m.x, m.y, m.ancho, m.alto, 8);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(m.x, m.y, m.ancho, m.alto, 8);
    ctx.clip();
    for (const n of sim.nodos) {
      ctx.fillStyle = colores.nodo[n.tipo].relleno;
      ctx.globalAlpha = destacados.has(n.id) ? 1 : 0.65;
      const r = n.tipo === "documento" ? 2.6 : destacados.has(n.id) ? 2.2 : 1.3;
      ctx.beginPath();
      ctx.arc(ox + n.x * escala, oy + n.y * escala, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Rectángulo de lo que se está viendo.
    const vx0 = ox + ((0 - vista.x) / vista.k) * escala;
    const vy0 = oy + ((0 - vista.y) / vista.k) * escala;
    const vw = (ancho / vista.k) * escala;
    const vh = (alto / vista.k) * escala;
    ctx.strokeStyle = colores.acento;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx0, vy0, vw, vh);
    ctx.restore();
  }

  ctx.restore();
}

function prioridad(
  n: NodoSim,
  foco: string | undefined,
  seleccion: string | undefined,
  destacados: Map<string, MarcaConsulta>,
): number {
  if (n.id === foco || n.id === seleccion) return 100;
  if (destacados.has(n.id)) return 90;
  if (n.tipo === "documento") return 80;
  if (n.tipo === "entidad") return 50 + Math.min(20, n.grado);
  return 10;
}

/** Encaje de todos los nodos en el lienzo ("Encajar"). */
export function vistaQueEncaja(nodos: NodoSim[], ancho: number, alto: number, margen = 64): Transformacion {
  if (!nodos.length) return { x: 0, y: 0, k: 1 };
  const c = limites(nodos);
  const k = Math.max(0.12, Math.min(2.4, Math.min((ancho - margen * 2) / Math.max(1, c.x1 - c.x0), (alto - margen * 2) / Math.max(1, c.y1 - c.y0))));
  return {
    k,
    x: ancho / 2 - ((c.x0 + c.x1) / 2) * k,
    y: alto / 2 - ((c.y0 + c.y1) / 2) * k,
  };
}
