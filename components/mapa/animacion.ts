"use client";
// Movimiento suave de los marcadores de unidad SIN estado de React.
// DUEÑO: constructor Q (rendimiento).
//
// POR QUÉ EXISTE: antes la interpolación vivía en un `useState` de la raíz del
// mapa (`usePosicionesAnimadas`): un `setInterval` de 50 ms creaba un objeto
// nuevo con los ~1.000 identificadores y forzaba ~28 renders COMPLETOS del mapa
// por cada movimiento. Aquí se mueve el marcador de Leaflet directamente
// (`marker.setLatLng`) desde un único `requestAnimationFrame` compartido, así
// que React no se entera y solo se tocan las unidades que de verdad se mueven.
//
// FLUIDEZ (visto 2026-09-19): el despachador mueve las unidades cada 5 s de
// reloj real y el stream las entrega como mucho cada 2 s. Con una animación
// fija de 1,4 s el camión corría 1,4 s y se quedaba clavado 3,6 s. Ahora cada
// marcador mide cada cuánto le llegan posiciones y anima durante ese intervalo,
// así que se mueve de forma continua y llega justo cuando entra la siguiente.
// Si la unidad va por una ruta, sigue la carretera entre el progreso anterior
// y el nuevo en vez de cortar en línea recta.

import type { Marker } from "leaflet";
import { distanciaM, interpolar } from "./geo";

type Trazado = [number, number][];

/** Duración de la primera animación, cuando aún no se conoce la cadencia. */
export const ANIMACION_MS = 1400;
/** Cadencia observada acotada: ni frenazos por debajo ni arrastres eternos. */
const ANIMACION_MIN_MS = 800;
const ANIMACION_MAX_MS = 8000;
/** ~25 fotogramas por segundo: a 60 no se nota y cuesta el doble. */
const MS_POR_CUADRO = 40;
/** Con más unidades moviéndose a la vez no compensa interpolar: saltan. */
const MAXIMO_ANIMADAS = 120;
/** Un salto mayor que esto (≈ 20 km) no es un avance: se coloca sin animar. */
const SALTO_MAXIMO_GRADOS = 0.2;

/** Ruta de la unidad tal como llega en el snapshot (`unidad.ruta`). */
export interface RutaUnidad {
  coords: Trazado;
  /** Fracción recorrida de la ruta, 0..1. */
  progreso: number;
}

/** Tramo de carretera por el que discurre una animación. */
interface Camino {
  coords: Trazado;
  tramos: number[];
  total: number;
  desde: number;
  hasta: number;
}

interface Movimiento {
  origen: [number, number];
  destino: [number, number];
  inicio: number;
  duracion: number;
  actual: [number, number];
  camino?: Camino;
  /** Progreso de ruta que corresponde a `actual` (solo con `camino`). */
  progresoActual?: number;
}

/** Lo que se sabe de cada marcador entre llegadas: para medir la cadencia y seguir la ruta. */
interface Cadencia {
  ultimaLlegada: number;
  intervalo: number;
  progreso?: number;
  firmaRuta?: string;
}

const enMarcha = new Map<Marker, Movimiento>();
const cadencias = new Map<Marker, Cadencia>();
let cuadro = 0;
let ultimoCuadro = 0;

function casiIgual(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}

/** Identifica una ruta sin comparar referencias (el snapshot trae arrays nuevos). */
function firmaDe(coords: Trazado): string {
  const a = coords[0];
  const z = coords[coords.length - 1];
  return `${coords.length}|${a[0]},${a[1]}|${z[0]},${z[1]}`;
}

function caminoDe(coords: Trazado, desde: number, hasta: number): Camino | undefined {
  if (coords.length < 2) return undefined;
  const tramos: number[] = [];
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const d = distanciaM({ lat: coords[i - 1][0], lon: coords[i - 1][1] }, { lat: coords[i][0], lon: coords[i][1] });
    tramos.push(d);
    total += d;
  }
  if (total <= 0) return undefined;
  return { coords, tramos, total, desde, hasta };
}

/** Punto de la ruta a una fracción 0..1 de su longitud. */
function puntoEnCamino(c: Camino, fraccion: number): [number, number] {
  const objetivo = Math.max(0, Math.min(1, fraccion)) * c.total;
  let acumulado = 0;
  for (let i = 0; i < c.tramos.length; i += 1) {
    if (acumulado + c.tramos[i] >= objetivo) {
      const t = c.tramos[i] > 0 ? (objetivo - acumulado) / c.tramos[i] : 0;
      return interpolar(c.coords[i], c.coords[i + 1], t);
    }
    acumulado += c.tramos[i];
  }
  return c.coords[c.coords.length - 1];
}

function tic(ahora: number): void {
  cuadro = 0;
  if (ahora - ultimoCuadro >= MS_POR_CUADRO) {
    ultimoCuadro = ahora;
    for (const [marcador, m] of enMarcha) {
      // Lineal a propósito: los tramos se encadenan sin acelerones ni frenazos.
      const k = Math.min(1, (ahora - m.inicio) / m.duracion);
      if (m.camino) {
        m.progresoActual = m.camino.desde + (m.camino.hasta - m.camino.desde) * k;
        m.actual = k >= 1 ? m.destino : puntoEnCamino(m.camino, m.progresoActual);
      } else {
        m.actual = interpolar(m.origen, m.destino, k);
      }
      marcador.setLatLng(m.actual);
      if (k >= 1) enMarcha.delete(marcador);
    }
  }
  if (enMarcha.size > 0) cuadro = requestAnimationFrame(tic);
}

/**
 * Lleva `marcador` hasta `destino` durante el intervalo con el que le llegan
 * posiciones (la primera vez, `ANIMACION_MS`). Con `ruta` sigue la carretera
 * entre el progreso anterior y el nuevo. Si el salto es enorme (reencuadre,
 * unidad recién aparecida) o ya hay demasiadas animaciones en marcha, coloca
 * el marcador de golpe: más vale un salto que un mapa atascado. Llamarla de
 * nuevo con el mismo destino no reinicia nada.
 */
export function moverMarcador(marcador: Marker, destino: [number, number], ruta?: RutaUnidad): void {
  const enCurso = enMarcha.get(marcador);
  if (enCurso && casiIgual(enCurso.destino, destino)) return; // ya va hacia ahí
  const aqui = marcador.getLatLng();
  const actual: [number, number] = enCurso ? enCurso.actual : [aqui.lat, aqui.lng];
  const ahora = performance.now();
  const previa = cadencias.get(marcador);
  const firmaRuta = ruta && ruta.coords.length >= 2 ? firmaDe(ruta.coords) : undefined;
  if (casiIgual(actual, destino)) {
    enMarcha.delete(marcador);
    // Ya está en su sitio: solo se toma nota de la ruta y el progreso la primera
    // vez, para que el siguiente tramo pueda ir por la carretera. No se toca la
    // cadencia (una llamada repetida no es una llegada).
    if (!previa) cadencias.set(marcador, { ultimaLlegada: ahora, intervalo: 0, progreso: ruta?.progreso, firmaRuta });
    return;
  }

  // Cadencia observada (media móvil desde la segunda llegada) acotada: es lo
  // que dura la animación. Hasta conocerla, `ANIMACION_MS`.
  let intervalo = 0;
  if (previa) {
    const medido = ahora - previa.ultimaLlegada;
    intervalo = previa.intervalo > 0 ? previa.intervalo * 0.5 + medido * 0.5 : medido;
  }
  const duracion = Math.max(ANIMACION_MIN_MS, Math.min(ANIMACION_MAX_MS, intervalo > 0 ? intervalo : ANIMACION_MS));
  cadencias.set(marcador, { ultimaLlegada: ahora, intervalo, progreso: ruta?.progreso, firmaRuta });

  const salto =
    Math.abs(actual[0] - destino[0]) > SALTO_MAXIMO_GRADOS || Math.abs(actual[1] - destino[1]) > SALTO_MAXIMO_GRADOS;
  if (salto || (!enCurso && enMarcha.size >= MAXIMO_ANIMADAS)) {
    enMarcha.delete(marcador);
    marcador.setLatLng(destino);
    return;
  }

  // Por la carretera solo si es la misma ruta que la última vez y avanza.
  let camino: Camino | undefined;
  if (ruta && firmaRuta && previa?.firmaRuta === firmaRuta && previa.progreso !== undefined) {
    const desde = enCurso?.camino ? (enCurso.progresoActual ?? previa.progreso) : previa.progreso;
    if (ruta.progreso > desde) camino = caminoDe(ruta.coords, desde, ruta.progreso);
  }

  enMarcha.set(marcador, { origen: actual, destino, inicio: ahora, duracion, actual, camino, progresoActual: camino?.desde });
  if (!cuadro) {
    ultimoCuadro = 0;
    cuadro = requestAnimationFrame(tic);
  }
}

/** Al desmontar un marcador: fuera de la animación (si no, se fuga). */
export function olvidarMarcador(marcador: Marker): void {
  enMarcha.delete(marcador);
  cadencias.delete(marcador);
  if (enMarcha.size === 0 && cuadro) {
    cancelAnimationFrame(cuadro);
    cuadro = 0;
  }
}

/** Solo para pruebas y diagnóstico. */
export function unidadesAnimandose(): number {
  return enMarcha.size;
}
