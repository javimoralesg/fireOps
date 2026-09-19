// =====================================================================
// ATALAYA INCENDIOS · Fuentes de detección conmutables (escenario del mando)
// ---------------------------------------------------------------------
// Propósito: catálogo y reglas PURAS de las fuentes automáticas que el mando
// puede apagar en una ejecución (satélite, prensa y redes, cámaras fijas,
// avisos ciudadanos). Una fuente apagada deja de recogerse, sus avisos ya no
// crean ni confirman focos y los focos sin confirmar que SOLO sostenía esa
// fuente se descartan (lib/motor/escenario.ts), para que el escenario quede
// limpio. La declaración a mano y las cámaras de móvil (`movil:<id>`) no se
// apagan nunca: son el suelo del "simulacro" (solo focos a mano y de móvil).
// DUEÑO: sesión actual (2026-09-19). Módulo ISOMORFO: lo usan el servidor
// (orquestador, verificador, vigía, enriquecimiento) y el navegador (barra
// superior), así que no importa nada con efectos ni dependencias de Node.
// =====================================================================

import type { CanalObservacion, Ejecucion, FuenteDeteccion, Observacion } from "./tipos";

export interface FichaFuenteDeteccion {
  id: FuenteDeteccion;
  /** Nombre para interruptores y tarjetas de agente. */
  nombre: string;
  /** Forma corta para la insignia de la barra ("Sin satélite"). */
  nombreCorto: string;
  /** Qué deja de pasar cuando se apaga, en una frase para el usuario. */
  descripcion: string;
  /** Agentes que no ejecutan ciclos mientras la fuente está apagada. */
  agentes: string[];
  /** Canales de observación que cubre: sus avisos no crean ni confirman focos. */
  canales: CanalObservacion[];
}

/** Prefijo de los ids de cámara que llegan de un teléfono por /movil (lib/fuentes/camarasMovil.ts). */
export const PREFIJO_CAMARA_MOVIL = "movil:";

/** Radio (km) en el que las cámaras fijas se arman alrededor de un foco (mismo valor que lib/motor/enriquecer.ts). */
export const RADIO_CAMARAS_FIJAS_KM = 25;

/** Texto de la insignia cuando están apagadas las cuatro fuentes. */
export const TEXTO_SIMULACRO = "SIMULACRO · solo focos a mano y móvil";

export const CATALOGO_FUENTES: readonly FichaFuenteDeteccion[] = [
  {
    id: "satelite",
    nombre: "Satélite (NASA FIRMS)",
    nombreCorto: "satélite",
    descripcion: "Focos térmicos VIIRS/MODIS sobre España: es la fuente que más focos sin confirmar deja en el mapa.",
    agentes: ["satelite"],
    canales: ["satelite"],
  },
  {
    id: "prensa_redes",
    nombre: "Prensa y redes",
    nombreCorto: "prensa y redes",
    descripcion: "Google News, Exa y Bluesky, geocodificados por municipio.",
    agentes: ["prensa_redes"],
    canales: ["prensa", "rrss"],
  },
  {
    id: "camaras_fijas",
    nombre: "Cámaras fijas (DGT y Madrid)",
    nombreCorto: "cámaras fijas",
    descripcion: "El vigía deja de analizarlas; las cámaras de móvil siguen vigilando.",
    agentes: [],
    canales: ["camara"],
  },
  {
    id: "avisos_ciudadanos",
    nombre: "Avisos ciudadanos",
    nombreCorto: "avisos ciudadanos",
    descripcion: "Llamadas, SMS, email, Telegram y formulario web: se registran pero no crean focos.",
    agentes: [],
    canales: ["llamada", "sms", "email", "telegram", "web"],
  },
];

export const IDS_FUENTES: readonly FuenteDeteccion[] = CATALOGO_FUENTES.map((f) => f.id);

const esFuente = (v: string): v is FuenteDeteccion => (IDS_FUENTES as readonly string[]).includes(v);

/** Lo mínimo que hace falta saber de una ejecución para aplicar las reglas. */
export type ConFuentes = Pick<Ejecucion, "fuentesDesactivadas"> | undefined;

/** Quita desconocidos y duplicados y deja el orden del catálogo (así dos listas iguales se comparan como texto). */
export function normalizarFuentes(lista: readonly string[] | undefined): FuenteDeteccion[] {
  const pedidas = new Set((lista ?? []).filter(esFuente));
  return IDS_FUENTES.filter((id) => pedidas.has(id));
}

export function fuentesDesactivadas(e: ConFuentes): FuenteDeteccion[] {
  return normalizarFuentes(e?.fuentesDesactivadas);
}

export function fuenteActiva(e: ConFuentes, fuente: FuenteDeteccion): boolean {
  return !fuentesDesactivadas(e).includes(fuente);
}

/** Simulacro = las cuatro fuentes apagadas: solo la mano y el móvil crean focos. */
export function esSimulacro(e: ConFuentes): boolean {
  return fuentesDesactivadas(e).length === IDS_FUENTES.length;
}

export function fichaFuente(fuente: FuenteDeteccion): FichaFuenteDeteccion {
  const ficha = CATALOGO_FUENTES.find((f) => f.id === fuente);
  if (!ficha) throw new Error(`Fuente de detección desconocida: ${fuente}`);
  return ficha;
}

/** Ficha de la fuente apagada que deja a este agente sin ciclos, o undefined si debe correr. */
export function agenteDesactivadoPorEscenario(e: ConFuentes, agenteId: string): FichaFuenteDeteccion | undefined {
  for (const id of fuentesDesactivadas(e)) {
    const ficha = fichaFuente(id);
    if (ficha.agentes.includes(agenteId)) return ficha;
  }
  return undefined;
}

export const esCamaraMovil = (referenciaExterna: string | undefined): boolean =>
  Boolean(referenciaExterna?.startsWith(PREFIJO_CAMARA_MOVIL));

/**
 * Ficha de la fuente apagada que bloquea esta observación (no crea ni confirma
 * focos), o undefined si puede seguir su camino. `manual` y `sensor` pasan siempre;
 * una cámara pasa si es de móvil aunque las fijas estén apagadas.
 */
export function fuenteQueBloquea(e: ConFuentes, obs: Pick<Observacion, "canal" | "referenciaExterna">): FichaFuenteDeteccion | undefined {
  for (const id of fuentesDesactivadas(e)) {
    const ficha = fichaFuente(id);
    if (!ficha.canales.includes(obs.canal)) continue;
    if (id === "camaras_fijas" && esCamaraMovil(obs.referenciaExterna)) continue;
    return ficha;
  }
  return undefined;
}

export const canalPuedeDeclararFoco = (e: ConFuentes, obs: Pick<Observacion, "canal" | "referenciaExterna">): boolean =>
  fuenteQueBloquea(e, obs) === undefined;

/** Lista legible de las fuentes apagadas ("satélite, prensa y redes"), o vacío si no hay ninguna. */
export function listaFuentes(fuentes: readonly FuenteDeteccion[]): string {
  return fuentes.map((f) => fichaFuente(f).nombreCorto).join(", ");
}

/**
 * Texto para la insignia de la barra superior: undefined en operación real,
 * "SIMULACRO · …" con las cuatro apagadas, "Sin satélite" con una, y
 * "Fuentes apagadas: …" con varias.
 */
export function resumenFuentes(e: ConFuentes): string | undefined {
  const apagadas = fuentesDesactivadas(e);
  if (!apagadas.length) return undefined;
  if (apagadas.length === IDS_FUENTES.length) return TEXTO_SIMULACRO;
  if (apagadas.length === 1) return `Sin ${fichaFuente(apagadas[0]).nombreCorto}`;
  return `Fuentes apagadas: ${listaFuentes(apagadas)}`;
}
