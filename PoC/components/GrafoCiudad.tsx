"use client";

// Grafo de la ciudad (vista esquemática en SVG). Los vértices son reales
// (OpenStreetMap): se colocan por lat/lon proyectadas en metros, norte arriba,
// y el penacho de humo usa la misma geometría en metros que el mapa. Zoom y
// desplazamiento sin librerías (viewBox), etiquetas sin solapes, leyenda con
// los tipos presentes y detalle fijo de cada vértice con enlace a OSM.

import { useId, useMemo, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { CloudFog, LocateFixed, Maximize, Minus, Network, Plus, TriangleAlert } from "lucide-react";
import type { AristaGrafo, ImpactoDomino, NodoGrafo, TipoNodo } from "@/lib/types";
import type { CondicionesEntorno, EstadoSistema } from "@/lib/tipos-sistema";
import { distanciaM as distanciaGeo, penachoDesdeViento, rumbo as rumboGeo, rumboTexto } from "@/components/mapa/geo";
import { Ayuda, Tooltip } from "./ui/Tooltip";
import { EFECTIVOS, MuestraTipo, ORDEN_ARISTAS, ORDEN_TIPOS, Simbolo, TIPOS_FONDO, estiloArista, estiloNodo, type EstiloNodo } from "./grafo/estilo";
import {
  abanicoCoincidentes,
  colocarEtiquetas,
  crearResolutor,
  formatoDistancia,
  incluir,
  nombreCorto,
  pasoRedondo,
  proyectarNodos,
  resolverDomino,
  subtipoLegible,
  tieneGeo,
  viewBoxDe,
  type FueraDeEscala,
  type Margen,
  type PeticionEtiqueta,
  type Pt,
} from "./grafo/geometria";
import { Leyenda } from "./grafo/Leyenda";
import { PanelNodo } from "./grafo/PanelNodo";
import { useEstable, useVistaGrafo } from "./grafo/useVistaGrafo";

type Viento = CondicionesEntorno["viento"];

// ---------------------------------------------------------------------------
// Helpers exportados (los importa MapaSituacion). Misma firma y semántica que
// antes: trabajan en el lienzo clásico 160×100 a partir de x/y.
// ---------------------------------------------------------------------------
const W = 160;
const sx = (x: number) => (x * W) / 100;
const radioNodo = (tipo: TipoNodo) => (tipo === "Incidencia" ? 3.2 : 2.2);
const HUMO_SEMIANGULO = 28; // grados a cada lado del eje del penacho

const normalizar = (grados: number) => ((grados % 360) + 360) % 360;
const difAngular = (a: number, b: number) => {
  const d = Math.abs(normalizar(a) - normalizar(b));
  return d > 180 ? 360 - d : d;
};

/** Longitud del penacho (unidades del lienzo 160×100) en función de la velocidad del viento. */
export function longitudPenacho(velocidadKmh: number) {
  return Math.min(95, Math.max(18, 16 + velocidadKmh * 1.9));
}

/** Rumbo hacia el que VA el humo: direccionGrados es de dónde VIENE el viento (convenio meteorológico). */
export function rumboHumo(viento: Viento) {
  return normalizar(viento.direccionGrados + 180);
}

/** Ids de los nodos que quedan bajo el penacho de humo de alguna Incidencia (lienzo 160×100, desde x/y). */
export function nodosAfectadosPorHumo(nodos: NodoGrafo[], viento: Viento | undefined): Set<string> {
  const out = new Set<string>();
  if (!viento) return out;
  const rumbo = rumboHumo(viento);
  const L = longitudPenacho(viento.velocidadKmh);
  for (const inc of nodos.filter((n) => n.tipo === "Incidencia")) {
    for (const n of nodos) {
      if (n.tipo === "Incidencia") continue;
      const dx = sx(n.x) - sx(inc.x);
      const dy = n.y - inc.y;
      const d = Math.hypot(dx, dy);
      const r = radioNodo(n.tipo);
      if (d === 0 || d - r > L) continue;
      const rumboNodo = (Math.atan2(dx, -dy) * 180) / Math.PI;
      const margen = (Math.asin(Math.min(1, r / d)) * 180) / Math.PI;
      if (difAngular(rumboNodo, rumbo) <= HUMO_SEMIANGULO + margen) out.add(n.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dibujo
// ---------------------------------------------------------------------------
const HUMO_REF = 100; // longitud de la cuña de referencia; se escala a la longitud real
const TRANSICION_GIRO = "transform 1.6s cubic-bezier(0.45, 0, 0.2, 1)";
const MARGEN_ENCUADRE: Margen = { t: 64, r: 40, b: 48, l: 40 };
const MARGEN_COMPACTO: Margen = { t: 52, r: 20, b: 40, l: 20 };
/** Radio (m) de la vista "Foco": el incidente y su entorno inmediato. */
const RADIO_FOCO_M = 550;
/** El encuadre incluye como mucho este tramo del penacho (m): el resto se difumina fuera. */
const PENACHO_EN_ENCUADRE_M = 600;
const HALO = { paintOrder: "stroke", stroke: "var(--panel)", strokeWidth: 3.2, strokeLinejoin: "round" } as const;
/** Botón de icono de los controles de vista: receta .boton-fantasma con objetivo táctil de 32 px. */
const BOTON_ICONO = "boton boton-fantasma boton-sm grid size-8 cursor-pointer place-items-center !p-0";
const ANCHO_PANEL = 300;

/** Cuña apuntando a -y (rumbo 0°) con vértice en el origen. */
function cuna(longitud: number, semiangulo: number) {
  const a = (semiangulo * Math.PI) / 180;
  const x = longitud * Math.sin(a);
  const y = -longitud * Math.cos(a);
  return `M 0 0 L ${-x} ${y} A ${longitud} ${longitud} 0 0 1 ${x} ${y} Z`;
}

/** Punta de flecha de `largo` px con la punta en el origen, apuntando a +x. */
const flecha = (largo: number) => `M0 0L${-largo} ${-largo * 0.48}L${-largo} ${largo * 0.48}Z`;

/**
 * Ángulo "desenrollado": si el objetivo cruza 0°/360°, sigue el camino corto
 * para que la transición CSS no dé la vuelta completa.
 */
function useAnguloContinuo(objetivo: number) {
  const [angulo, setAngulo] = useState(objetivo);
  const delta = ((((objetivo - angulo) % 360) + 540) % 360) - 180;
  if (Math.abs(delta) > 0.01) setAngulo(angulo + delta);
  return angulo + delta;
}

function colorRiesgo(riesgo: number) {
  if (riesgo >= 75) return "var(--danger)";
  if (riesgo >= 50) return "var(--warning)";
  return "var(--accent)";
}

const firmaJSON = (v: unknown) => JSON.stringify(v ?? null);
const firmaSet = (s: Set<string> | undefined) => (s ? [...s].sort().join("\u0001") : "");
const firmaViento = (v: Viento | undefined) =>
  v ? `${v.direccionGrados}|${v.velocidadKmh}|${v.direccionTexto}|${v.fuente}|${v.timestamp}` : "";

/** Penacho que calcula el servidor (estado.entorno.penacho), en metros. */
export interface PenachoGrafo {
  rumboGrados?: number;
  longitudM: number;
  semianguloGrados?: number;
  /** Ids de vértice bajo el humo según el servidor. */
  afectados?: string[];
}

interface InfoNodo {
  n: NodoGrafo;
  ui: EstiloNodo;
  rBase: number;
  fondo: boolean;
  enHumo: boolean;
  enDomino: boolean;
  riesgo?: number;
  enRiesgo: boolean;
  conEvidencia: boolean;
  fuera?: FueraDeEscala;
  /** > 0: etiqueta permanente (más alto, antes se coloca). */
  prioridad: number;
  /** Orden de dibujo (lo importante encima). */
  importancia: number;
  etiqueta: string;
  fs: number;
}

export function GrafoCiudad({
  nodos,
  aristas,
  nodosEnRiesgo,
  viento,
  dominoResaltado,
  nodosConEvidencia,
  onSeleccionarNodo,
  origenGrafo,
  penacho,
  foco,
  compacto = false,
  className = "",
}: {
  nodos: NodoGrafo[];
  aristas: AristaGrafo[];
  nodosEnRiesgo: Set<string>; // nombres devueltos por la query de dominó
  viento?: Viento; // direccionGrados = de dónde VIENE el viento (meteorológico)
  dominoResaltado?: ImpactoDomino[]; // dominó de la decisión seleccionada: resalta sus rutas
  nodosConEvidencia?: Set<string>; // ids de nodo apoyados por datos reales (sensor, llamada…)
  onSeleccionarNodo?: (id: string) => void;
  origenGrafo?: EstadoSistema["origenGrafo"]; // "ArangoDB" | "memoria": badge en la cabecera
  /** estado.entorno.penacho: longitud real en metros y afectados calculados en el servidor. */
  penacho?: PenachoGrafo | null;
  /** Centro del incidente activo (estado.incidente.ubicacion): origen del penacho del servidor. */
  foco?: { lat: number; lon: number } | null;
  /** Sin cabecera propia (para incrustarlo en otro panel, p. ej. Situación). */
  compacto?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = { grid: `${uid}-grid`, humo: `${uid}-humo`, humoNucleo: `${uid}-humo-nucleo`, blur: `${uid}-blur` };

  // --- Entradas estables: el estado llega por SSE como objeto nuevo en cada cambio ---
  const nodosE = useEstable(nodos, useMemo(() => firmaJSON(nodos), [nodos]));
  const aristasE = useEstable(aristas, useMemo(() => firmaJSON(aristas), [aristas]));
  const dominoE = useEstable(dominoResaltado, useMemo(() => firmaJSON(dominoResaltado), [dominoResaltado]));
  const enRiesgoE = useEstable(nodosEnRiesgo, useMemo(() => firmaSet(nodosEnRiesgo), [nodosEnRiesgo]));
  const evidenciaE = useEstable(nodosConEvidencia, useMemo(() => firmaSet(nodosConEvidencia), [nodosConEvidencia]));
  const penachoE = useEstable(penacho ?? undefined, useMemo(() => firmaJSON(penacho), [penacho]));
  const vientoE = useEstable(viento, useMemo(() => firmaViento(viento), [viento]));
  const focoE = useEstable(foco ?? undefined, useMemo(() => firmaJSON(foco), [foco]));

  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focoId, setFocoId] = useState<string | null>(null);
  const [leyendaAbierta, setLeyendaAbierta] = useState(!compacto);
  const resaltado = hoverId ?? focoId;

  // --- Cálculos que solo dependen de los datos ---
  const proy = useMemo(() => proyectarNodos(nodosE), [nodosE]);
  const byId = useMemo(() => new Map(nodosE.map((n) => [n.id, n])), [nodosE]);
  const resolver = useMemo(() => crearResolutor(nodosE), [nodosE]);
  const domino = useMemo(() => resolverDomino(dominoE, aristasE, resolver), [dominoE, aristasE, resolver]);
  const enRiesgoIds = useMemo(() => {
    const s = new Set<string>();
    for (const nombre of enRiesgoE) {
      const id = resolver(nombre);
      if (id) s.add(id);
    }
    return s;
  }, [enRiesgoE, resolver]);
  // Foco del penacho: el centro del incidente activo si llega; si no, la incidencia que el
  // servidor da por afectada (está a menos de 25 m del foco); si no, la primera.
  const focoInfo = useMemo(() => {
    const incidencias = nodosE.filter((n) => n.tipo === "Incidencia");
    let punto: Pt | undefined = focoE && proy.aMundo ? proy.aMundo(focoE.lat, focoE.lon) : undefined;
    let nodo: NodoGrafo | undefined;
    if (punto) {
      let mejor = proy.geo ? 80 : 2;
      for (const n of incidencias) {
        const p = proy.real.get(n.id);
        const d = p ? Math.hypot(p.x - punto.x, p.y - punto.y) : Infinity;
        if (d <= mejor) {
          mejor = d;
          nodo = n;
        }
      }
    }
    if (!nodo && penachoE?.afectados) nodo = incidencias.find((n) => penachoE.afectados!.includes(n.id));
    if (!nodo && !punto) nodo = incidencias[0];
    if (!punto && nodo) punto = proy.real.get(nodo.id);
    const geoFoco = focoE ?? (nodo && tieneGeo(nodo) ? { lat: nodo.lat, lon: nodo.lon } : undefined);
    return { nodo, punto, geo: geoFoco };
  }, [nodosE, focoE, proy, penachoE]);

  // Penacho: el del servidor (metros) si llega; si no, el mismo modelo desde el viento.
  const humo = useMemo(() => {
    if (!vientoE && !penachoE) return null;
    const rumbo = normalizar(penachoE?.rumboGrados ?? (vientoE ? rumboHumo(vientoE) : 0));
    const semi = penachoE?.semianguloGrados ?? HUMO_SEMIANGULO;
    if (proy.geo) {
      const L = penachoE?.longitudM ?? (vientoE ? penachoDesdeViento(vientoE).longitudM : 0);
      return { rumbo, semi, L, metros: L as number | undefined, fuente: penachoE ? ("servidor" as const) : ("local" as const) };
    }
    // Sin coordenadas reales no hay escala en metros: longitud relativa al lienzo.
    return { rumbo, semi, L: vientoE ? longitudPenacho(vientoE.velocidadKmh) : 40, metros: penachoE?.longitudM, fuente: "local" as const };
  }, [vientoE, penachoE, proy.geo]);
  const giro = useAnguloContinuo(humo?.rumbo ?? 0);

  // Origen del humo: con metros, el foco del incidente (el penacho del servidor es uno);
  // en el lienzo clásico, cada incidencia (como calcula nodosAfectadosPorHumo).
  const focos = useMemo(() => {
    if (proy.geo) return focoInfo.punto ? [focoInfo.punto] : [];
    const out: Pt[] = [];
    for (const n of nodosE) {
      if (n.tipo !== "Incidencia") continue;
      const p = proy.real.get(n.id);
      if (p && !out.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 2)) out.push(p);
    }
    return out;
  }, [nodosE, proy, focoInfo]);

  const afectados = useMemo(() => {
    const ids = new Set<string>();
    const esIncidencia = (id: string) => byId.get(id)?.tipo === "Incidencia";
    if (penachoE?.afectados) {
      for (const id of penachoE.afectados) if (byId.has(id) && !esIncidencia(id)) ids.add(id);
      return { ids, fuente: "servidor" as const };
    }
    if (!humo) return { ids, fuente: "local" as const };
    if (!proy.geo) {
      for (const id of nodosAfectadosPorHumo(nodosE, vientoE)) ids.add(id);
      return { ids, fuente: "local" as const };
    }
    for (const f of focos) {
      for (const n of nodosE) {
        if (n.tipo === "Incidencia") continue;
        const p = proy.real.get(n.id);
        if (!p) continue;
        const dx = p.x - f.x;
        const dy = p.y - f.y;
        const d = Math.hypot(dx, dy);
        if (d > humo.L) continue;
        // Misma regla que el servidor: a menos de 25 m del foco se da por afectado.
        if (d <= 25 || difAngular((Math.atan2(dx, -dy) * 180) / Math.PI, humo.rumbo) <= humo.semi) ids.add(n.id);
      }
    }
    return { ids, fuente: "local" as const };
  }, [penachoE, humo, proy, nodosE, vientoE, focos, byId]);

  const info = useMemo(() => {
    const m = new Map<string, InfoNodo>();
    for (const n of nodosE) {
      const ui = estiloNodo(n.tipo);
      const esInc = n.tipo === "Incidencia";
      const esFoco = n.id === focoInfo.nodo?.id;
      const enHumo = afectados.ids.has(n.id);
      const enDomino = domino.nodos.has(n.id);
      const riesgo = domino.riesgoFinal.get(n.id);
      const enRiesgo = enRiesgoIds.has(n.id);
      const conEvidencia = evidenciaE?.has(n.id) ?? false;
      const fuera = proy.fuera.get(n.id);
      const efectivo = EFECTIVOS.has(n.tipo);
      const fondo = TIPOS_FONDO.has(n.tipo) && !enHumo && !enDomino && !enRiesgo && !conEvidencia;
      let prioridad = 0;
      if (esInc) prioridad = esFoco ? 100 : enDomino ? 98 : 85;
      else if (riesgo !== undefined) prioridad = 90;
      else if (n.tipo === "Hospital") prioridad = 80;
      else if (efectivo) prioridad = 70;
      else if (enHumo) prioridad = 60;
      else if (enDomino) prioridad = 55;
      else if (enRiesgo) prioridad = 50;
      else if (fuera) prioridad = 40;
      const importancia = esInc ? (esFoco ? 6 : 5) : riesgo !== undefined || n.tipo === "Hospital" ? 4 : efectivo || enDomino ? 3 : enHumo || enRiesgo ? 2 : fondo ? 0 : 1;
      m.set(n.id, {
        n,
        ui,
        rBase: fondo ? Math.min(ui.radio, 3) : esInc && !esFoco ? 6 : ui.radio + (enDomino || enHumo ? 0.4 : 0),
        fondo,
        enHumo,
        enDomino,
        riesgo,
        enRiesgo,
        conEvidencia,
        fuera,
        prioridad,
        importancia,
        etiqueta: nombreCorto(n.nombre, esInc ? 40 : 28) + (fuera ? ` · ${formatoDistancia(fuera.distanciaM)}` : ""),
        fs: esInc ? 12 : 11,
      });
    }
    return m;
  }, [nodosE, afectados, domino, enRiesgoIds, evidenciaE, proy, focoInfo]);

  const ordenDibujo = useMemo(
    () => [...info.values()].sort((a, b) => a.importancia - b.importancia).map((i) => i.n.id),
    [info],
  );

  const abanico = useMemo(
    () => abanicoCoincidentes([...ordenDibujo].reverse(), proy.pos, proy.geo ? 12 : 0.6, (id) => info.get(id)?.rBase ?? 4),
    [ordenDibujo, proy, info],
  );

  const conteoTipos = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of nodosE) c.set(n.tipo, (c.get(n.tipo) ?? 0) + 1);
    const rango = (t: string) => (ORDEN_TIPOS.includes(t) ? ORDEN_TIPOS.indexOf(t) : ORDEN_TIPOS.length);
    return [...c.entries()].sort((a, b) => rango(a[0]) - rango(b[0]) || b[1] - a[1]);
  }, [nodosE]);
  const conteoAristas = useMemo(() => {
    const c = new Map<string, number>();
    for (const a of aristasE) c.set(a.tipo, (c.get(a.tipo) ?? 0) + 1);
    const rango = (t: string) => (ORDEN_ARISTAS.includes(t) ? ORDEN_ARISTAS.indexOf(t) : ORDEN_ARISTAS.length);
    return [...c.entries()].sort((a, b) => rango(a[0]) - rango(b[0]));
  }, [aristasE]);

  // El encuadre incluye el primer tramo del penacho para que el humo cercano no se corte.
  const cajaVista = useMemo(() => {
    let c = proy.caja;
    if (humo && humo.L > 0) {
      const a = (humo.rumbo * Math.PI) / 180;
      const l = proy.geo ? Math.min(humo.L, PENACHO_EN_ENCUADRE_M) : humo.L * 0.6;
      for (const f of focos) c = incluir(c, { x: f.x + Math.sin(a) * l, y: f.y - Math.cos(a) * l });
    }
    return c;
  }, [proy, humo, focos]);

  // --- Vista (zoom / desplazamiento) ---
  const {
    contRef,
    svgRef,
    tam,
    vista,
    auto,
    manual,
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
  } = useVistaGrafo(cajaVista, compacto ? MARGEN_COMPACTO : MARGEN_ENCUADRE);
  const s = vista.s;
  const z = s / auto.s;
  const fz = Math.min(1.5, Math.max(0.85, 1 + 0.18 * Math.log2(z)));
  const vb = viewBoxDe(vista, tam.w, tam.h);
  const radioPx = (id: string) => (info.get(id)?.rBase ?? 4) * fz;

  // Posición mostrada: la real más el abanico de coincidentes (fijo en px).
  const disp = useMemo(() => {
    const m = new Map<string, Pt>();
    for (const [id, p] of proy.pos) {
      const o = abanico.desplazamiento.get(id);
      m.set(id, o ? { x: p.x + o.x / s, y: p.y + o.y / s } : p);
    }
    return m;
  }, [proy, abanico, s]);

  const detalleZoom = z >= 3;
  const lienzoPequeno = compacto && tam.h < 480;
  const etiquetas = useMemo(() => {
    const peticiones: PeticionEtiqueta[] = [];
    const obstaculos: { id: string; x: number; y: number; r: number }[] = [];
    const ox = vb.x * s;
    const oy = vb.y * s;
    for (const [id, i] of info) {
      const p = disp.get(id);
      if (!p) continue;
      const r = i.rBase * fz;
      const x = p.x * s;
      const y = p.y * s;
      obstaculos.push({ id, x, y, r: r + 1 });
      if (id === resaltado) continue; // la del vértice señalado va en la ficha flotante
      if (x < ox - r || y < oy - r || x > ox + tam.w + r || y > oy + tam.h + r) continue; // fuera de la vista
      let prioridad = i.prioridad;
      if (id === seleccionado) prioridad = 120;
      // Al acercar hay sitio: el resto de etiquetas aparece si no pisa nada.
      if (prioridad <= 0 && detalleZoom) prioridad = i.fondo ? 8 : 12;
      // Lienzo pequeño (Situación en la home) sin acercar: los hospitales que no están en el
      // dominó ni bajo el humo compiten como el resto y no se imponen a los vértices.
      if (lienzoPequeno && !detalleZoom && prioridad === 80) prioridad = 45;
      if (prioridad <= 0) continue;
      peticiones.push({ id, x, y, r, texto: i.etiqueta, fs: i.fs, prioridad, ignoraVertices: prioridad >= (lienzoPequeno ? 85 : 80) });
    }
    // Controles flotantes (viento, zoom, escala y ficha abierta): ahí no se ponen etiquetas.
    const zonas = [
      // Arriba a la izquierda: brújula de viento y, en compacto, la fila de píldoras (origen,
      // dominó, humo) y el icono de ayuda, que ahora ocupan una fila más.
      { x: 0, y: 0, w: 248, h: 54 },
      { x: tam.w - 290, y: tam.h - 52, w: 290, h: 52 },
      { x: 0, y: tam.h - 46, w: 150, h: 46 },
      ...(seleccionado && tam.w > 480 ? [{ x: tam.w - ANCHO_PANEL - 12, y: 0, w: ANCHO_PANEL + 12, h: tam.h - 52 }] : []),
    ].map((z) => ({ ...z, x: z.x + ox, y: z.y + oy }));
    // La marca "Foco del incidente" (si el foco no tiene vértice propio) también ocupa sitio.
    if (proy.geo && focoInfo.punto && !focoInfo.nodo) {
      const fx = focoInfo.punto.x * s;
      const fy = focoInfo.punto.y * s;
      obstaculos.push({ id: "__foco", x: fx, y: fy, r: 8 });
      zonas.push({ x: fx - 56, y: fy - 23, w: 112, h: 15 });
    }
    return colocarEtiquetas(peticiones, obstaculos, { x: ox, y: oy, w: tam.w, h: tam.h }, zonas);
  }, [info, disp, s, fz, resaltado, seleccionado, detalleZoom, lienzoPequeno, vb.x, vb.y, tam.w, tam.h, proy.geo, focoInfo]);

  // Contexto: con dominó o con un vértice seleccionado, el resto se atenúa.
  const contexto = useMemo(() => {
    if (!domino.nodos.size && !seleccionado) return null;
    const c = new Set<string>(domino.nodos);
    if (seleccionado) {
      c.add(seleccionado);
      for (const a of aristasE) {
        if (a.from === seleccionado) c.add(a.to);
        if (a.to === seleccionado) c.add(a.from);
      }
    }
    return c;
  }, [domino, seleccionado, aristasE]);

  const opacidadNodo = (id: string) => {
    const i = info.get(id);
    if (!i) return 1;
    if (id === seleccionado || id === resaltado) return 1;
    const base = i.fondo ? 0.6 : 1;
    if (contexto && !contexto.has(id) && i.n.tipo !== "Incidencia") return base * 0.4;
    return base;
  };

  const segmento = (from: string, to: string) => {
    const f = disp.get(from);
    const t = disp.get(to);
    if (!f || !t) return null;
    const dx = t.x - f.x;
    const dy = t.y - f.y;
    const len = Math.hypot(dx, dy);
    const r1 = (radioPx(from) + 1.5) / s;
    const r2 = (radioPx(to) + 2.5) / s;
    if (len <= r1 + r2 + 2 / s) return null;
    const ux = dx / len;
    const uy = dy / len;
    return { x1: f.x + ux * r1, y1: f.y + uy * r1, x2: t.x - ux * r2, y2: t.y - uy * r2, ux, uy, ang: (Math.atan2(dy, dx) * 180) / Math.PI };
  };

  const nodoSel = seleccionado ? byId.get(seleccionado) : undefined;
  const aPantalla = (p: Pt) => ({ x: (p.x - vb.x) * s, y: (p.y - vb.y) * s });

  const seleccionar = (id: string) => {
    setSeleccionado(id);
    onSeleccionarNodo?.(id);
    const p = disp.get(id);
    if (!p) return;
    const q = aPantalla(p);
    const conPanel = tam.w > 480;
    const tapado = conPanel && q.x > tam.w - ANCHO_PANEL - 16;
    if (tapado || q.x < 16 || q.y < 16 || q.x > tam.w - 16 || q.y > tam.h - 16) centrarEn(p.x, p.y, conPanel ? ANCHO_PANEL / 2 : 0);
  };

  const irAlFoco = () => {
    const p = focoInfo.punto;
    if (!p) return;
    const r = proy.geo ? RADIO_FOCO_M : 18;
    encuadrarCaja({ minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r });
  };

  const teclaLienzo = (e: KeyboardEvent<SVGSVGElement>) => {
    const paso = 80;
    switch (e.key) {
      case "f":
      case "F":
        irAlFoco();
        break;
      case "+":
      case "=":
        zoom(1.4);
        break;
      case "-":
      case "_":
        zoom(1 / 1.4);
        break;
      case "0":
        encuadrarTodo();
        break;
      case "ArrowLeft":
        mover(-paso, 0);
        break;
      case "ArrowRight":
        mover(paso, 0);
        break;
      case "ArrowUp":
        mover(0, -paso);
        break;
      case "ArrowDown":
        mover(0, paso);
        break;
      case "Escape":
        if (!seleccionado) return;
        setSeleccionado(null);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const dobleClic = (e: ReactMouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    zoom(e.shiftKey ? 0.5 : 2, e.clientX - r.left, e.clientY - r.top);
  };

  // --- Detalle del vértice seleccionado ---
  const panel = useMemo(() => {
    if (!nodoSel) return null;
    const i = info.get(nodoSel.id);
    let distanciaFocoM: number | undefined;
    let rumboFoco: number | undefined;
    const f = focoInfo.geo;
    if (f && tieneGeo(nodoSel)) {
      distanciaFocoM = distanciaGeo([f.lat, f.lon], [nodoSel.lat, nodoSel.lon]);
      rumboFoco = rumboGeo([f.lat, f.lon], [nodoSel.lat, nodoSel.lon]);
    }
    const vecino = (a: AristaGrafo, otro: string) => ({ arista: a, otro: byId.get(otro), enDomino: domino.aristas.has(`${a.from}->${a.to}`) });
    return {
      estado: {
        enHumo: i?.enHumo ?? false,
        humoFuente: afectados.fuente,
        enDomino: i?.enDomino ?? false,
        riesgo: i?.riesgo,
        enRiesgo: i?.enRiesgo ?? false,
        conEvidencia: i?.conEvidencia ?? false,
        fuera: i?.fuera,
        distanciaFocoM,
        rumboFoco,
        esFoco: nodoSel.id === focoInfo.nodo?.id,
      },
      salientes: aristasE.filter((a) => a.from === nodoSel.id).map((a) => vecino(a, a.to)),
      entrantes: aristasE.filter((a) => a.to === nodoSel.id).map((a) => vecino(a, a.from)),
    };
  }, [nodoSel, info, focoInfo, byId, domino, afectados.fuente, aristasE]);

  // --- Ficha flotante del vértice señalado (ratón o foco de teclado) ---
  const ficha = (() => {
    const id = resaltado;
    if (!id) return null;
    const i = info.get(id);
    const p = disp.get(id);
    if (!i || !p) return null;
    const q = aPantalla(p);
    const r = i.rBase * fz;
    const abajo = q.y < 90;
    return {
      i,
      left: Math.min(tam.w - 136, Math.max(136, q.x)),
      top: abajo ? q.y + r + 10 : q.y - r - 10,
      abajo,
    };
  })();

  const pasoGrid = pasoRedondo(s, proy.geo ? 96 : 64);
  const pasoRegla = pasoRedondo(s, 110);
  const humoIds = [...afectados.ids];
  const hayDomino = Boolean(dominoE && dominoE.length > 0);
  // De dónde sale el grafo: se ve tanto en la cabecera como incrustado (modo compacto),
  // porque es parte de "visibilidad del estado del sistema" (docs/identidad.md).
  const pildorasOrigen = (
    <>
      {origenGrafo === "ArangoDB" && (
        <Tooltip contenido="Las rutas del dominó salen de una consulta AQL de 1..3 saltos sobre el grafo persistido en ArangoDB." titulo="Origen del grafo">
          <span className="pildora pildora-exito shrink-0 cursor-help font-mono">ArangoDB · AQL</span>
        </Tooltip>
      )}
      {origenGrafo === "memoria" && (
        <Tooltip
          contenido="ArangoDB no está disponible: el dominó se calcula con un BFS local equivalente sobre el mismo grafo."
          titulo="Origen del grafo"
        >
          <span className="pildora shrink-0 cursor-help">Grafo en memoria</span>
        </Tooltip>
      )}
    </>
  );
  const ayudaGrafo = (
    <Ayuda
      titulo="Qué muestra este grafo"
      texto={
        <>
          <strong>Vértices</strong>: infraestructuras (hospitales, vías, subestaciones…) y efectivos desplegados, importados de{" "}
          <strong>OpenStreetMap</strong> y colocados por su latitud y longitud reales (norte arriba, escala en metros). <strong>Aristas</strong>:{" "}
          <strong>BLOQUEA_A</strong> (corta o inutiliza), <strong>SUMINISTRA_A</strong> (da acceso o energía) y <strong>DESPLEGADO_EN</strong>{" "}
          (efectivo sobre el terreno). El <strong>efecto dominó</strong> sale de una consulta AQL de 1..3 saltos sobre el grafo persistido en
          ArangoDB; si ArangoDB no está disponible, de un BFS equivalente sobre el grafo en memoria.
          <span className="mt-1 block opacity-80">
            Rueda o +/− para acercar, arrastra o flechas para mover, doble clic para acercar, 0 para encuadrar y F para ir al foco. Clic en un
            vértice para ver su ficha.
          </span>
        </>
      }
    />
  );
  const cabeceraPildoras = (
    <>
      {hayDomino && (
        <Tooltip
          titulo="Efecto dominó"
          contenido={
            <>
              Rutas de propagación de la decisión seleccionada, desde la incidencia hasta las infraestructuras que quedarían afectadas.
              {domino.virtuales.length > 0 && " Los tramos sin arista en el grafo real se dibujan en discontinuo."}
              {domino.sinResolver.length > 0 && ` No están en el grafo actual: ${domino.sinResolver.join(", ")}.`}
            </>
          }
        >
          <span className="pildora pildora-aviso shrink-0">
            <TriangleAlert className="size-3" aria-hidden /> Dominó · {dominoE!.length} {dominoE!.length === 1 ? "ruta" : "rutas"}
          </span>
        </Tooltip>
      )}
      {humoIds.length > 0 && (
        <Tooltip
          titulo="Bajo el penacho de humo"
          contenido={
            <>
              {humoIds.map((id) => byId.get(id)?.nombre ?? id).join(" · ")}
              <span className="mt-1 block opacity-80">
                {afectados.fuente === "servidor"
                  ? "Calculado en el servidor sobre lat/lon, en metros: el mismo penacho que el mapa."
                  : "Cálculo local con la misma geometría que se dibuja."}
              </span>
            </>
          }
        >
          <span className="pildora shrink-0">
            <CloudFog className="size-3" style={{ color: "var(--humo)" }} aria-hidden /> Humo · {humoIds.length}{" "}
            {humoIds.length === 1 ? "vértice" : "vértices"}
          </span>
        </Tooltip>
      )}
    </>
  );

  return (
    <section className={`flex h-full min-h-0 flex-col ${className}`}>
      {!compacto && (
        <div className="flex items-center justify-between gap-3 border-b border-panel-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="flex shrink-0 items-center gap-2 text-[13px] font-semibold text-foreground">
              <Network className="size-4 text-brand" aria-hidden /> Grafo de la ciudad
              {ayudaGrafo}
            </h2>
            {pildorasOrigen}
          </div>
          <div className="-my-1 flex min-w-0 items-center gap-2">{cabeceraPildoras}</div>
        </div>
      )}

      {/* En compacto (Situación de la home) las píldoras van en su propia fila: sobre el lienzo tapaban etiquetas. */}
      {compacto && (
        <div className="flex flex-wrap items-center gap-1 border-b border-panel-border px-2 py-1.5">
          {pildorasOrigen}
          {cabeceraPildoras}
          <span className="grid size-6 place-items-center rounded-full border border-panel-border bg-panel">{ayudaGrafo}</span>
        </div>
      )}

      <div ref={contRef} className="relative min-h-0 flex-1 overflow-hidden" onMouseLeave={() => setHoverId(null)}>
        <svg
          ref={svgRef}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          preserveAspectRatio="xMidYMid meet"
          className={`absolute inset-0 h-full w-full select-none outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${arrastrando ? "cursor-grabbing" : "cursor-grab"}`}
          style={{ touchAction: "none" }}
          role="group"
          aria-label="Grafo de dependencias de la ciudad. Arrastra para mover, rueda o teclas más y menos para acercar, 0 para encuadrar, F para ir al foco."
          tabIndex={0}
          onKeyDown={teclaLienzo}
          onDoubleClick={dobleClic}
          onClick={() => {
            if (!fueArrastre()) setSeleccionado(null);
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <defs>
            <pattern id={ids.grid} width={pasoGrid} height={pasoGrid} patternUnits="userSpaceOnUse" x={0} y={0}>
              <path d={`M ${pasoGrid} 0 L 0 0 0 ${pasoGrid}`} fill="none" stroke="var(--panel-border)" strokeWidth={1 / s} />
            </pattern>
            <radialGradient id={ids.humo} gradientUnits="userSpaceOnUse" cx="0" cy="0" r={HUMO_REF}>
              <stop offset="0" stopColor="var(--humo)" stopOpacity="0.5" />
              <stop offset="0.35" stopColor="var(--humo)" stopOpacity="0.28" />
              <stop offset="0.75" stopColor="var(--humo)" stopOpacity="0.1" />
              <stop offset="1" stopColor="var(--humo)" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={ids.humoNucleo} gradientUnits="userSpaceOnUse" cx="0" cy="0" r={HUMO_REF * 0.9}>
              <stop offset="0" stopColor="var(--humo-nucleo)" stopOpacity="0.45" />
              <stop offset="0.5" stopColor="var(--humo-nucleo)" stopOpacity="0.14" />
              <stop offset="1" stopColor="var(--humo-nucleo)" stopOpacity="0" />
            </radialGradient>
            <filter id={ids.blur} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" />
            </filter>
          </defs>
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={`url(#${ids.grid})`} />

          {/* Penacho de humo: rota alrededor de la incidencia hacia donde VA el humo; longitud real */}
          {humo &&
            humo.L > 0 &&
            focos.map((f, k) => (
              <g key={`humo-${k}`} transform={`translate(${f.x} ${f.y})`} pointerEvents="none">
                <g style={{ transform: `rotate(${giro}deg) scale(${humo.L / HUMO_REF})`, transition: TRANSICION_GIRO }}>
                  <path d={cuna(HUMO_REF, humo.semi)} fill={`url(#${ids.humo})`} filter={`url(#${ids.blur})`} />
                  <path d={cuna(HUMO_REF * 0.9, humo.semi * 0.45)} fill={`url(#${ids.humoNucleo})`} filter={`url(#${ids.blur})`} />
                  {[-humo.semi / 2, 0, humo.semi / 2].map((a) => (
                    <line
                      key={a}
                      x1="0"
                      y1="-8"
                      x2="0"
                      y2={-HUMO_REF * 0.85}
                      transform={`rotate(${a})`}
                      stroke="var(--humo)"
                      strokeOpacity="0.5"
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                      className="edge-flow"
                    />
                  ))}
                  <path
                    d={cuna(HUMO_REF, humo.semi)}
                    fill="none"
                    stroke="var(--humo)"
                    strokeOpacity="0.4"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              </g>
            ))}

          {/* Aristas normales: SUMINISTRA_A finas y atenuadas salvo las del vértice señalado */}
          {aristasE.map((a) => {
            const clave = `${a.from}->${a.to}`;
            if (domino.aristas.has(clave)) return null;
            const seg = segmento(a.from, a.to);
            if (!seg) return null;
            const ea = estiloArista(a.tipo);
            const toca = a.from === seleccionado || a.to === seleccionado || a.from === resaltado || a.to === resaltado;
            const atenuada = contexto !== null && !toca && !(contexto.has(a.from) && contexto.has(a.to));
            const opacidad = toca ? Math.max(0.9, ea.opacidad) : atenuada ? Math.min(0.14, ea.opacidad) : ea.opacidad;
            const largo = a.tipo === "SUMINISTRA_A" && !toca ? 5 : 6.5;
            return (
              <g key={`${clave}-${a.tipo}`} opacity={opacidad} pointerEvents="none" style={{ transition: "opacity 0.3s" }}>
                <line
                  x1={seg.x1}
                  y1={seg.y1}
                  x2={seg.x2 - (seg.ux * largo * 0.8) / s}
                  y2={seg.y2 - (seg.uy * largo * 0.8) / s}
                  stroke={ea.stroke}
                  strokeWidth={toca ? ea.ancho + 0.6 : ea.ancho}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  className={ea.anim && !atenuada ? "edge-flow" : undefined}
                />
                <path d={flecha(largo)} transform={`translate(${seg.x2} ${seg.y2}) rotate(${seg.ang}) scale(${1 / s})`} fill={ea.stroke} />
              </g>
            );
          })}

          {/* Dominó: rutas de propagación de la decisión seleccionada, encima del resto */}
          {[...domino.aristas].map((clave) => {
            const [from, to] = clave.split("->");
            const seg = segmento(from, to);
            if (!seg) return null;
            return (
              <g key={`domino-${clave}`} pointerEvents="none">
                <line
                  x1={seg.x1}
                  y1={seg.y1}
                  x2={seg.x2}
                  y2={seg.y2}
                  stroke="var(--warning)"
                  strokeWidth="8"
                  strokeOpacity="0.12"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={seg.x1}
                  y1={seg.y1}
                  x2={seg.x2 - (seg.ux * 6) / s}
                  y2={seg.y2 - (seg.uy * 6) / s}
                  stroke="var(--warning)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  className="edge-flow"
                />
                <path d={flecha(8.5)} transform={`translate(${seg.x2} ${seg.y2}) rotate(${seg.ang}) scale(${1 / s})`} fill="var(--warning)" />
              </g>
            );
          })}
          {domino.virtuales.map(([from, to]) => {
            const seg = segmento(from, to);
            if (!seg) return null;
            return (
              <g key={`virtual-${from}-${to}`} pointerEvents="none" opacity={0.85}>
                <line
                  x1={seg.x1}
                  y1={seg.y1}
                  x2={seg.x2 - (seg.ux * 6) / s}
                  y2={seg.y2 - (seg.uy * 6) / s}
                  stroke="var(--warning)"
                  strokeWidth="1.6"
                  strokeDasharray="3 4"
                  vectorEffect="non-scaling-stroke"
                />
                <path d={flecha(7)} transform={`translate(${seg.x2} ${seg.y2}) rotate(${seg.ang}) scale(${1 / s})`} fill="var(--warning)" />
              </g>
            );
          })}

          {/* Guías de los vértices coincidentes abiertos en abanico */}
          {[...abanico.ancla].map(([id, ancla]) => {
            const a = disp.get(ancla);
            const b = disp.get(id);
            if (!a || !b) return null;
            return (
              <line
                key={`guia-${id}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--panel-border-strong)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
                opacity={Math.min(opacidadNodo(id), opacidadNodo(ancla))}
              />
            );
          })}

          {/* Vértices (tamaño constante en px: el zoom separa, no agranda) */}
          {(seleccionado ? [...ordenDibujo.filter((id) => id !== seleccionado), seleccionado] : ordenDibujo).map((id) => {
            const i = info.get(id);
            const p = disp.get(id);
            if (!i || !p) return null;
            const r = i.rBase * fz;
            const esInc = i.n.tipo === "Incidencia";
            const sel = id === seleccionado;
            const marcas = [
              i.riesgo !== undefined ? `dominó, riesgo ${i.riesgo}` : i.enDomino ? "en ruta del dominó" : "",
              i.enHumo ? "bajo el humo" : "",
              i.fuera ? `fuera de escala, a ${formatoDistancia(i.fuera.distanciaM)}` : "",
            ].filter(Boolean);
            return (
              <g
                key={id}
                transform={`translate(${p.x} ${p.y}) scale(${1 / s})`}
                opacity={opacidadNodo(id)}
                style={{ transition: "opacity 0.3s", outline: "none" }}
                className="cursor-pointer outline-none focus-visible:[&>circle:first-of-type]:stroke-brand"
                onPointerEnter={(e) => {
                  if (e.pointerType === "mouse") setHoverId(id);
                }}
                onPointerLeave={() => setHoverId((h) => (h === id ? null : h))}
                onFocus={(e) => {
                  let teclado = true;
                  try {
                    teclado = e.currentTarget.matches(":focus-visible");
                  } catch {
                    /* navegador sin :focus-visible */
                  }
                  if (teclado) setFocoId(id);
                }}
                onBlur={() => setFocoId((f) => (f === id ? null : f))}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!fueArrastre()) seleccionar(id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    seleccionar(id);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-pressed={sel}
                aria-label={`${i.ui.label}: ${i.n.nombre}${marcas.length ? ` (${marcas.join(", ")})` : ""}`}
              >
                {/* Área de captura; el foco de teclado la tiñe de marca */}
                <circle r={r + 6} fill="transparent" stroke="none" strokeWidth="1.6" />
                {esInc && <circle r={r} fill="none" stroke="var(--danger)" strokeWidth="1.5" className="pulse-ring" />}
                {i.enHumo && (
                  <circle r={r + 4} fill="var(--humo)" fillOpacity="0.16" stroke="var(--humo)" strokeWidth="1" strokeDasharray="2 1.6" />
                )}
                {i.enDomino && !esInc && <circle r={r + 2.6} fill="none" stroke="var(--warning)" strokeWidth="1.6" />}
                {i.enRiesgo && !i.enDomino && (
                  <circle r={r + 2.6} fill="none" stroke="var(--warning)" strokeWidth="1" strokeDasharray="2.5 2" />
                )}
                {i.fuera && <circle r={r + 3.4} fill="none" stroke="var(--muted)" strokeWidth="1" strokeDasharray="2 2" />}
                {sel && <circle r={r + 5.2} fill="none" stroke="var(--brand)" strokeWidth="2" />}
                <Simbolo forma={i.ui.forma} r={r} color={i.ui.fill} />
                {i.conEvidencia && <circle cx={-r * 0.85} cy={-r * 0.85} r="3" fill="var(--success)" stroke="var(--panel)" strokeWidth="1" />}
                {i.riesgo !== undefined && (
                  <g transform={`translate(${r - 1} ${-r - 12})`}>
                    <rect width="20" height="12" rx="6" fill={colorRiesgo(i.riesgo)} />
                    <text x="10" y="9" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="var(--panel)" className="font-mono">
                      {i.riesgo}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Foco del incidente sin vértice propio: marca discreta para que el humo no salga "de la nada" */}
          {proy.geo && focoInfo.punto && !focoInfo.nodo && (
            <g transform={`translate(${focoInfo.punto.x} ${focoInfo.punto.y}) scale(${1 / s})`} pointerEvents="none">
              <circle r="6" fill="none" stroke="var(--danger)" strokeWidth="1.4" className="pulse-ring" />
              <circle r="6" fill="var(--panel)" stroke="var(--danger)" strokeWidth="2" />
              <path d="M-3.2 0H3.2M0 -3.2V3.2" stroke="var(--danger)" strokeWidth="1.6" strokeLinecap="round" />
              <text y="-10" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--danger)" style={HALO}>
                Foco del incidente
              </text>
            </g>
          )}

          {/* Etiquetas: solo las colocadas sin solape, con halo del color del panel */}
          <g pointerEvents="none">
            {[...etiquetas.entries()].map(([id, e]) => {
              const i = info.get(id);
              const p = disp.get(id);
              if (!i || !p) return null;
              const esInc = i.n.tipo === "Incidencia";
              const fuerte = esInc || i.riesgo !== undefined || id === seleccionado;
              // Tres niveles de texto (identidad v2): incidencia en peligro, vértices con
              // etiqueta permanente en foreground algo rebajado, el resto en muted.
              const principal = i.prioridad > 0 || id === seleccionado;
              return (
                <g key={`et-${id}`} transform={`translate(${p.x} ${p.y}) scale(${1 / s})`} opacity={opacidadNodo(id)}>
                  <text
                    x={e.dx}
                    y={e.dy}
                    textAnchor={e.ancla}
                    fontSize={i.fs}
                    fontWeight={fuerte ? 700 : i.prioridad > 0 ? 600 : 500}
                    fill={esInc ? "var(--danger)" : principal ? "var(--foreground)" : "var(--muted)"}
                    fillOpacity={!esInc && principal ? 0.85 : 1}
                    style={HALO}
                  >
                    {i.etiqueta}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Viento y penacho */}
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-col items-start gap-1">
          {(vientoE || humo) && (
            <Tooltip
              titulo="Viento y penacho de humo"
              contenido={
                <>
                  {vientoE && (
                    <>
                      Viento del {vientoE.direccionTexto} ({Math.round(vientoE.direccionGrados)}°) a {Math.round(vientoE.velocidadKmh)} km/h · fuente{" "}
                      {vientoE.fuente}.{" "}
                    </>
                  )}
                  {humo && (
                    <>
                      El humo va hacia el {rumboTexto(humo.rumbo)} ({Math.round(humo.rumbo)}°), ±{Math.round(humo.semi)}°
                      {humo.metros ? `, ${formatoDistancia(humo.metros)} de alcance` : ""}.{" "}
                      {humo.fuente === "servidor"
                        ? "Penacho calculado en el servidor en metros: coincide con el del mapa."
                        : proy.geo
                          ? "Estimado aquí con el mismo modelo que el servidor (500 m + 90 m por km/h)."
                          : "Sin coordenadas reales: longitud relativa al lienzo."}
                    </>
                  )}
                </>
              }
              lado="abajo"
              className="pointer-events-auto"
            >
              <div
                tabIndex={0}
                className="flex items-center gap-2 rounded-[10px] border border-panel-border bg-panel/95 py-1 pl-1 pr-2.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                style={{ boxShadow: "var(--sombra-panel)" }}
              >
                <svg width="28" height="28" viewBox="-14 -14 28 28" aria-hidden className="shrink-0">
                  <circle r="12.5" fill="var(--panel-2)" stroke="var(--panel-border-strong)" strokeWidth="1" />
                  <text y="-7.2" fontSize="6" textAnchor="middle" fontWeight="700" fill="var(--foreground)" className="font-mono">
                    N
                  </text>
                  <g style={{ transform: `rotate(${giro}deg)`, transition: TRANSICION_GIRO }}>
                    <line x1="0" y1="8" x2="0" y2="-3" stroke="var(--warning)" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M 0 -8.5 L 3 -3 L -3 -3 Z" fill="var(--warning)" />
                  </g>
                </svg>
                <div className="min-w-0 leading-tight">
                  {vientoE && (
                    <p className="whitespace-nowrap text-foreground">
                      Viento del {vientoE.direccionTexto} <span className="font-mono">{Math.round(vientoE.velocidadKmh)} km/h</span>
                    </p>
                  )}
                  {humo && (
                    <p className="whitespace-nowrap text-muted">
                      Humo hacia el {rumboTexto(humo.rumbo)}
                      {humo.metros ? <span className="font-mono"> · {formatoDistancia(humo.metros)}</span> : null}
                    </p>
                  )}
                </div>
              </div>
            </Tooltip>
          )}
        </div>

        {/* Escala y norte */}
        {proy.geo && (
          <div
            className="pointer-events-none absolute bottom-2 left-2 z-10 flex items-end gap-2 rounded-md bg-panel/85 px-1.5 py-1 text-[11px] text-muted"
            role="img"
            aria-label={`Escala: la barra mide ${formatoDistancia(pasoRegla)}. El norte está arriba.`}
          >
            <div>
              <span className="font-mono">{formatoDistancia(pasoRegla)}</span>
              <div className="mt-0.5 h-1.5 border-x-2 border-b-2 border-muted" style={{ width: pasoRegla * s }} />
            </div>
            <span className="flex flex-col items-center font-mono text-[10.5px] font-bold leading-none text-foreground" aria-hidden>
              ↑<span>N</span>
            </span>
          </div>
        )}

        {/* Zoom */}
        <div
          className="absolute bottom-2 right-2 z-10 flex items-center gap-0.5 rounded-[10px] border border-panel-border bg-panel/95 p-0.5"
          style={{ boxShadow: "var(--sombra-panel)" }}
        >
          <Tooltip contenido="Alejar · tecla −" lado="arriba">
            <button type="button" className={BOTON_ICONO} onClick={() => zoom(1 / 1.5)} disabled={s <= limites.min * 1.001} aria-label="Alejar">
              <Minus className="size-4" aria-hidden />
            </button>
          </Tooltip>
          <Tooltip contenido="Zoom respecto al encuadre de todos los vértices." lado="arriba">
            <span className="w-11 text-center font-mono text-[11px] text-muted">
              {Math.round(z * 100)} %
            </span>
          </Tooltip>
          <Tooltip contenido="Acercar · tecla + · también con la rueda o con doble clic" lado="arriba">
            <button type="button" className={BOTON_ICONO} onClick={() => zoom(1.5)} disabled={s >= limites.max * 0.999} aria-label="Acercar">
              <Plus className="size-4" aria-hidden />
            </button>
          </Tooltip>
          <span className="mx-0.5 h-5 w-px bg-panel-border" aria-hidden />
          {focoInfo.punto && (
            <Tooltip contenido="Acercar al foco del incidente y su entorno inmediato · tecla F" lado="arriba">
              <button type="button" onClick={irAlFoco} className={BOTON_ICONO} aria-label="Acercar al foco del incidente">
                <LocateFixed className="size-4" aria-hidden />
              </button>
            </Tooltip>
          )}
          <Tooltip contenido="Volver a encuadrar todos los vértices · tecla 0" lado="arriba">
            <button
              type="button"
              onClick={encuadrarTodo}
              disabled={!manual}
              className="boton boton-fantasma boton-sm cursor-pointer gap-1 !px-2 !text-[12px]"
            >
              <Maximize className="size-3.5" aria-hidden /> Encuadrar
            </button>
          </Tooltip>
        </div>

        {/* Ficha flotante del vértice bajo el ratón o con foco */}
        {ficha && (
          <div
            className="pointer-events-none absolute z-30 max-w-[272px] rounded-[8px] border border-panel-border-strong bg-panel px-2.5 py-1.5 text-[11px]"
            style={{
              left: ficha.left,
              top: ficha.top,
              transform: ficha.abajo ? "translate(-50%, 0)" : "translate(-50%, -100%)",
              boxShadow: "var(--sombra-flotante)",
            }}
          >
            <p className="flex items-center gap-1 text-muted">
              <MuestraTipo tipo={ficha.i.n.tipo} tam={10} /> {ficha.i.ui.label}
              {ficha.i.n.subtipo && (subtipoLegible(ficha.i.n.subtipo) ?? ficha.i.n.subtipo).toLowerCase() !== ficha.i.ui.label.toLowerCase() && (
                <span className="text-subtle">· {subtipoLegible(ficha.i.n.subtipo) ?? ficha.i.n.subtipo}</span>
              )}
            </p>
            <p className="text-[12px] font-semibold leading-snug text-foreground">{ficha.i.n.nombre}</p>
            {(ficha.i.riesgo !== undefined || ficha.i.enDomino || ficha.i.enHumo || ficha.i.fuera) && (
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-muted">
                {ficha.i.riesgo !== undefined ? (
                  <span className="font-semibold text-warning">Dominó · riesgo {ficha.i.riesgo}</span>
                ) : (
                  ficha.i.enDomino && <span className="font-semibold text-warning">Ruta del dominó</span>
                )}
                {ficha.i.enHumo && <span>Bajo el humo</span>}
                {ficha.i.fuera && <span>A {formatoDistancia(ficha.i.fuera.distanciaM)} (fuera de escala)</span>}
              </p>
            )}
            {ficha.i.n.id !== seleccionado && <p className="mt-0.5 text-subtle">Clic para ver la ficha</p>}
          </div>
        )}

        {nodoSel && panel && (
          <PanelNodo
            nodo={nodoSel}
            estado={panel.estado}
            salientes={panel.salientes}
            entrantes={panel.entrantes}
            onIr={seleccionar}
            onCerrar={() => setSeleccionado(null)}
          />
        )}

        {nodosE.length === 0 && (
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-muted">Sin vértices en el grafo todavía.</p>
        )}
      </div>

      <Leyenda
        tipos={conteoTipos}
        aristas={conteoAristas}
        abierta={leyendaAbierta}
        onAlternar={() => setLeyendaAbierta((a) => !a)}
        hayEvidencia={Boolean(evidenciaE?.size)}
        fueraDeEscala={proy.fuera.size}
        totalNodos={nodosE.length}
        totalAristas={aristasE.length}
      />
    </section>
  );
}
