// =====================================================================
// ATALAYA INCENDIOS · Motor de fuerzas del grafo de conocimiento
// ---------------------------------------------------------------------
// DUEÑO: constructor I.
// Simulación de fuerzas FUERA de React: nada de aquí provoca un renderizado.
// El componente la pisa 60 veces por segundo desde requestAnimationFrame y
// dibuja el resultado en un canvas.
//
// Modelo (el de d3-force, escrito a mano para no añadir dependencias):
//   · repulsión  entre todos los nodos, con quadtree de Barnes-Hut cuando hay
//     más de 300 (con menos, la fuerza bruta es más rápida que construir el
//     árbol);
//   · muelles    en las aristas, con la fuerza repartida según el grado para
//     que un documento con 200 fragmentos no arrastre a toda la pantalla;
//   · gravedad   suave hacia el centro, para que nada se escape;
//   · colisiones por rejilla, para que las etiquetas se puedan leer.
// Todas las fuerzas se escalan por `alfa`, que se enfría solo hasta pararse.
// =====================================================================

import type { AristaGrafo, GrafoConocimiento, NodoGrafo } from "@/lib/dominio/tipos";

export type TipoArista = AristaGrafo["tipo"];
export type TipoNodo = NodoGrafo["tipo"];

export const TIPOS_ARISTA: TipoArista[] = ["contiene", "sigue", "referencia", "menciona"];
export const TIPOS_NODO: TipoNodo[] = ["documento", "chunk", "entidad"];

export interface NodoSim {
  id: string;
  tipo: TipoNodo;
  etiqueta: string;
  documentoId?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radio: number;
  /** Nº de aristas del nodo (todas, no solo las visibles). */
  grado: number;
  /** Peso de repulsión: un documento empuja más que un fragmento. */
  fuerza: number;
  /** Clavado por el usuario: la simulación ya no lo mueve. */
  fijado: boolean;
}

export interface AristaSim {
  a: number;
  b: number;
  tipo: TipoArista;
  origen: string;
  destino: string;
  /** Reparto del muelle entre los dos extremos (el más conectado cede menos). */
  sesgo: number;
  fuerza: number;
  distancia: number;
}

/** Distancia de reposo de cada tipo de relación. */
const DISTANCIA: Record<TipoArista, number> = { contiene: 115, sigue: 44, referencia: 150, menciona: 175 };
/**
 * Peso de repulsión por tipo de nodo. Están calibrados contra la gravedad:
 * el grafo se estabiliza cuando `suma(pesos)/R ≈ GRAVEDAD·R`, o sea con un
 * radio de unos 400 px, que es lo que hace falta para que se vea la forma en
 * vez de una bola. Un documento empuja más porque de él cuelga todo.
 */
const REPULSION: Record<TipoNodo, number> = { documento: 70, chunk: 7, entidad: 22 };

const ALFA_MIN = 0.012;
const ALFA_DECAIMIENTO = 0.0165;
const ROZAMIENTO = 0.62; // velocidad que se conserva en cada paso
const GRAVEDAD = 0.016;
const THETA2 = 0.81; // (0,9)²: precisión del Barnes-Hut
const UMBRAL_QUADTREE = 300;
const VELOCIDAD_MAXIMA = 40;

// ---------------------------------------------------------------------
// Quadtree de Barnes-Hut
// ---------------------------------------------------------------------

class Cuadrante {
  masa = 0;
  cx = 0;
  cy = 0;
  hijos: (Cuadrante | null)[] | null = null;
  indice = -1;
  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly x1: number,
    readonly y1: number,
  ) {}
}

const PROFUNDIDAD_MAXIMA = 22;

function subcuadrante(q: Cuadrante, x: number, y: number): number {
  const mx = (q.x0 + q.x1) / 2;
  const my = (q.y0 + q.y1) / 2;
  return (x >= mx ? 1 : 0) + (y >= my ? 2 : 0);
}

function crearHijo(q: Cuadrante, i: number): Cuadrante {
  const mx = (q.x0 + q.x1) / 2;
  const my = (q.y0 + q.y1) / 2;
  const x0 = i % 2 === 0 ? q.x0 : mx;
  const x1 = i % 2 === 0 ? mx : q.x1;
  const y0 = i < 2 ? q.y0 : my;
  const y1 = i < 2 ? my : q.y1;
  return new Cuadrante(x0, y0, x1, y1);
}

function insertar(q: Cuadrante, nodos: NodoSim[], indice: number, profundidad: number): void {
  const n = nodos[indice];
  q.masa += n.fuerza;
  q.cx += n.x * n.fuerza;
  q.cy += n.y * n.fuerza;

  if (q.hijos) {
    const h = subcuadrante(q, n.x, n.y);
    q.hijos[h] = q.hijos[h] ?? crearHijo(q, h);
    insertar(q.hijos[h]!, nodos, indice, profundidad + 1);
    return;
  }
  if (q.indice === -1) {
    q.indice = indice;
    return;
  }
  // Ya había un nodo aquí: se subdivide y bajan los dos. Si están casi
  // encima el uno del otro se deja de subdividir (si no, recursión infinita):
  // su masa ya cuenta, simplemente no se separan como hojas distintas.
  if (profundidad >= PROFUNDIDAD_MAXIMA) return;
  const anterior = q.indice;
  q.indice = -1;
  q.hijos = [null, null, null, null];
  for (const i of [anterior, indice]) {
    const m = nodos[i];
    const h = subcuadrante(q, m.x, m.y);
    q.hijos[h] = q.hijos[h] ?? crearHijo(q, h);
    insertar(q.hijos[h]!, nodos, i, profundidad + 1);
  }
}

/** Divide las sumas acumuladas para dejar el centro de masas real. */
function centrar(q: Cuadrante): void {
  if (q.masa > 0) {
    q.cx /= q.masa;
    q.cy /= q.masa;
  }
  if (q.hijos) for (const h of q.hijos) if (h) centrar(h);
}

function repeler(q: Cuadrante, nodos: NodoSim[], indice: number, alfa: number): void {
  if (q.masa === 0) return;
  const n = nodos[indice];
  let dx = q.cx - n.x;
  let dy = q.cy - n.y;
  let d2 = dx * dx + dy * dy;
  if (d2 < 1) {
    // Coincidentes: se desempata con un empujón determinista y diminuto.
    dx = ((indice % 7) - 3) * 0.3 + 0.1;
    dy = ((indice % 5) - 2) * 0.3 + 0.1;
    d2 = dx * dx + dy * dy;
  }
  const ancho = q.x1 - q.x0;
  if (!q.hijos || (ancho * ancho) / d2 < THETA2) {
    if (q.indice === indice && !q.hijos) return;
    // Magnitud ∝ masa/d (dx ya lleva un factor d): con masa/d² el empuje se
    // apaga tan deprisa que todos los nodos acaban amontonados.
    const w = (q.masa * alfa) / d2;
    n.vx -= dx * w;
    n.vy -= dy * w;
    return;
  }
  for (const h of q.hijos) if (h) repeler(h, nodos, indice, alfa);
}

// ---------------------------------------------------------------------
// Simulación
// ---------------------------------------------------------------------

export interface PosicionGuardada {
  x: number;
  y: number;
}

export class Simulacion {
  nodos: NodoSim[] = [];
  aristas: AristaSim[] = [];
  alfa = 1;
  /** Tipos de relación visibles; los ocultos tampoco tiran. */
  tiposActivos: Set<TipoArista> = new Set(TIPOS_ARISTA);
  readonly indicePorId = new Map<string, number>();
  /** Vecinos por id (solo lectura para el visor). */
  readonly vecinos = new Map<string, Set<string>>();
  centroX: number;
  centroY: number;

  constructor(
    grafo: GrafoConocimiento,
    ancho: number,
    alto: number,
    previas?: Map<string, PosicionGuardada>,
    fijadas?: Set<string>,
  ) {
    this.centroX = ancho / 2;
    this.centroY = alto / 2;

    const grados = new Map<string, number>();
    for (const a of grafo.aristas) {
      grados.set(a.origen, (grados.get(a.origen) ?? 0) + 1);
      grados.set(a.destino, (grados.get(a.destino) ?? 0) + 1);
    }

    // Colocación inicial: anillos concéntricos por tipo (documentos dentro,
    // entidades fuera) para que el primer fotograma ya se lea. Si hay posición
    // guardada o previa, manda esa.
    const porTipo: Record<TipoNodo, number> = { documento: 0, chunk: 0, entidad: 0 };
    const totales: Record<TipoNodo, number> = { documento: 0, chunk: 0, entidad: 0 };
    for (const n of grafo.nodos) totales[n.tipo] += 1;
    const radioAnillo: Record<TipoNodo, number> = {
      documento: Math.min(ancho, alto) * 0.14,
      chunk: Math.min(ancho, alto) * 0.34,
      entidad: Math.min(ancho, alto) * 0.47,
    };

    grafo.nodos.forEach((n) => {
      const grado = grados.get(n.id) ?? 0;
      const previa = previas?.get(n.id);
      const i = porTipo[n.tipo]++;
      const total = Math.max(1, totales[n.tipo]);
      const angulo = (i / total) * Math.PI * 2 + (n.tipo === "chunk" ? 0.4 : 0);
      // Espiral suave para los fragmentos: menos solape de partida.
      const radio = radioAnillo[n.tipo] * (n.tipo === "chunk" ? 0.7 + 0.6 * ((i % 7) / 7) : 1);
      this.indicePorId.set(n.id, this.nodos.length);
      this.nodos.push({
        id: n.id,
        tipo: n.tipo,
        etiqueta: n.etiqueta,
        documentoId: n.documentoId,
        x: previa?.x ?? this.centroX + Math.cos(angulo) * radio,
        y: previa?.y ?? this.centroY + Math.sin(angulo) * radio,
        vx: 0,
        vy: 0,
        radio: radioDe(n.tipo, grado),
        grado,
        fuerza: REPULSION[n.tipo],
        fijado: fijadas?.has(n.id) ?? false,
      });
    });

    for (const a of grafo.aristas) {
      const ia = this.indicePorId.get(a.origen);
      const ib = this.indicePorId.get(a.destino);
      if (ia === undefined || ib === undefined) continue;
      const ga = this.nodos[ia].grado;
      const gb = this.nodos[ib].grado;
      this.aristas.push({
        a: ia,
        b: ib,
        tipo: a.tipo,
        origen: a.origen,
        destino: a.destino,
        // El extremo con más aristas se mueve menos (reparto de d3).
        sesgo: ga / Math.max(1, ga + gb),
        fuerza: Math.max(0.05, Math.min(0.75, 1 / Math.max(1, Math.min(ga, gb)))),
        distancia: DISTANCIA[a.tipo],
      });
      if (!this.vecinos.has(a.origen)) this.vecinos.set(a.origen, new Set());
      if (!this.vecinos.has(a.destino)) this.vecinos.set(a.destino, new Set());
      this.vecinos.get(a.origen)!.add(a.destino);
      this.vecinos.get(a.destino)!.add(a.origen);
    }
  }

  get enMovimiento(): boolean {
    return this.alfa > ALFA_MIN;
  }

  nodo(id: string): NodoSim | undefined {
    const i = this.indicePorId.get(id);
    return i === undefined ? undefined : this.nodos[i];
  }

  recalentar(objetivo = 0.45): void {
    this.alfa = Math.max(this.alfa, objetivo);
  }

  detener(): void {
    this.alfa = 0;
  }

  soltarTodos(): void {
    for (const n of this.nodos) n.fijado = false;
    this.recalentar(0.6);
  }

  /** Vuelve a repartir los nodos y recalienta del todo (botón "Reordenar"). */
  reordenar(): void {
    const totales: Record<TipoNodo, number> = { documento: 0, chunk: 0, entidad: 0 };
    for (const n of this.nodos) totales[n.tipo] += 1;
    const contados: Record<TipoNodo, number> = { documento: 0, chunk: 0, entidad: 0 };
    const base = Math.min(this.centroX, this.centroY);
    const radioAnillo: Record<TipoNodo, number> = { documento: base * 0.28, chunk: base * 0.68, entidad: base * 0.94 };
    for (const n of this.nodos) {
      const i = contados[n.tipo]++;
      const total = Math.max(1, totales[n.tipo]);
      const angulo = (i / total) * Math.PI * 2;
      const radio = radioAnillo[n.tipo] * (n.tipo === "chunk" ? 0.7 + 0.6 * ((i % 7) / 7) : 1);
      n.x = this.centroX + Math.cos(angulo) * radio;
      n.y = this.centroY + Math.sin(angulo) * radio;
      n.vx = 0;
      n.vy = 0;
      n.fijado = false;
    }
    this.alfa = 1;
  }

  /** Un paso de simulación. No toca React ni el DOM. */
  paso(): void {
    const alfa = this.alfa;
    const n = this.nodos.length;
    if (!n) return;

    // --- repulsión ---
    if (n > UMBRAL_QUADTREE) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const p of this.nodos) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
      const lado = Math.max(x1 - x0, y1 - y0, 1) + 2;
      const raiz = new Cuadrante(x0 - 1, y0 - 1, x0 - 1 + lado, y0 - 1 + lado);
      for (let i = 0; i < n; i++) insertar(raiz, this.nodos, i, 0);
      centrar(raiz);
      for (let i = 0; i < n; i++) repeler(raiz, this.nodos, i, alfa);
    } else {
      for (let i = 0; i < n; i++) {
        const a = this.nodos[i];
        for (let j = i + 1; j < n; j++) {
          const b = this.nodos[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = ((i % 7) - 3) * 0.3 + 0.1;
            dy = ((j % 5) - 2) * 0.3 + 0.1;
            d2 = dx * dx + dy * dy;
          }
          const wa = (b.fuerza * alfa) / d2;
          const wb = (a.fuerza * alfa) / d2;
          a.vx -= dx * wa;
          a.vy -= dy * wa;
          b.vx += dx * wb;
          b.vy += dy * wb;
        }
      }
    }

    // --- muelles ---
    for (const e of this.aristas) {
      if (!this.tiposActivos.has(e.tipo)) continue;
      const a = this.nodos[e.a];
      const b = this.nodos[e.b];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.5;
      const l = ((d - e.distancia) / d) * alfa * e.fuerza;
      b.vx -= dx * l * e.sesgo;
      b.vy -= dy * l * e.sesgo;
      a.vx += dx * l * (1 - e.sesgo);
      a.vy += dy * l * (1 - e.sesgo);
    }

    // --- gravedad ---
    for (const p of this.nodos) {
      p.vx += (this.centroX - p.x) * GRAVEDAD * alfa;
      p.vy += (this.centroY - p.y) * GRAVEDAD * alfa;
    }

    // --- integración ---
    for (const p of this.nodos) {
      if (p.fijado) {
        p.vx = 0;
        p.vy = 0;
        continue;
      }
      p.vx *= ROZAMIENTO;
      p.vy *= ROZAMIENTO;
      const v = Math.hypot(p.vx, p.vy);
      if (v > VELOCIDAD_MAXIMA) {
        p.vx = (p.vx / v) * VELOCIDAD_MAXIMA;
        p.vy = (p.vy / v) * VELOCIDAD_MAXIMA;
      }
      p.x += p.vx;
      p.y += p.vy;
    }

    this.separar();
    this.alfa += (0 - this.alfa) * ALFA_DECAIMIENTO;
    if (this.alfa <= ALFA_MIN) this.alfa = 0;
  }

  /** Colisiones por rejilla: nadie se dibuja encima de nadie. */
  private separar(): void {
    const celda = 56;
    const rejilla = new Map<number, number[]>();
    const clave = (cx: number, cy: number) => (cx + 5000) * 100003 + (cy + 5000);
    this.nodos.forEach((p, i) => {
      const k = clave(Math.floor(p.x / celda), Math.floor(p.y / celda));
      const lista = rejilla.get(k);
      if (lista) lista.push(i);
      else rejilla.set(k, [i]);
    });
    for (let i = 0; i < this.nodos.length; i++) {
      const a = this.nodos[i];
      const cx = Math.floor(a.x / celda);
      const cy = Math.floor(a.y / celda);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const lista = rejilla.get(clave(cx + ox, cy + oy));
          if (!lista) continue;
          for (const j of lista) {
            if (j <= i) continue;
            const b = this.nodos[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const minimo = a.radio + b.radio + 6;
            const d2 = dx * dx + dy * dy;
            if (d2 >= minimo * minimo || d2 === 0) continue;
            const d = Math.sqrt(d2);
            const empuje = ((minimo - d) / d) * 0.5;
            const ex = dx * empuje;
            const ey = dy * empuje;
            if (!b.fijado) {
              b.x += ex;
              b.y += ey;
            }
            if (!a.fijado) {
              a.x -= ex;
              a.y -= ey;
            }
          }
        }
      }
    }
  }
}

export function radioDe(tipo: TipoNodo, grado: number): number {
  if (tipo === "documento") return 13 + Math.min(7, grado * 0.03);
  if (tipo === "entidad") return 6 + Math.min(7, grado * 0.35);
  return 5;
}

/** Caja que ocupan los nodos, para "Encajar" y para el minimapa. */
export function limites(nodos: NodoSim[]): { x0: number; y0: number; x1: number; y1: number } {
  if (!nodos.length) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodos) {
    if (n.x - n.radio < x0) x0 = n.x - n.radio;
    if (n.y - n.radio < y0) y0 = n.y - n.radio;
    if (n.x + n.radio > x1) x1 = n.x + n.radio;
    if (n.y + n.radio > y1) y1 = n.y + n.radio;
  }
  return { x0, y0, x1, y1 };
}
