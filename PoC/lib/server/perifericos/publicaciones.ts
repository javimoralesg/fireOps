// Muro de publicaciones de la demo (poc-07): lo que publica el jurado desde
// /periferico y los comunicados que aprueba el Gabinete. Almacén JSON propio
// (data/publicaciones.json) con el mismo patrón de bloqueo que registro.ts.
// Las publicaciones similares se agrupan ("N menciones") y pasan por el pipeline
// de ingesta para que se verifiquen (Exa) y puedan disparar un desmentido.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Publicacion, ResultadoIngesta } from "../../tipos-perifericos";
import { nuevoId } from "../estado";
import { guardarImagen } from "./almacen";
import { procesarObservacion, type ObservacionPipeline } from "./pipeline";
import { similitud } from "./verificacion";

const RUTA = path.join(process.cwd(), "data", "publicaciones.json");
const VENTANA_AGRUPACION_MS = 10 * 60_000;
const SIMILITUD_AGRUPACION = 0.6;
const MAXIMO = 400;

type Global = typeof globalThis & { __publicaciones?: Publicacion[]; __publicacionesLock?: Promise<unknown> };
const g = globalThis as Global;

async function cargar(): Promise<Publicacion[]> {
  if (g.__publicaciones) return g.__publicaciones;
  try {
    g.__publicaciones = JSON.parse(await readFile(RUTA, "utf8")) as Publicacion[];
  } catch {
    g.__publicaciones = [];
  }
  return g.__publicaciones;
}

async function guardar() {
  await mkdir(path.dirname(RUTA), { recursive: true });
  await writeFile(RUTA, JSON.stringify(g.__publicaciones ?? [], null, 2), "utf8");
}

async function conBloqueo<T>(fn: () => Promise<T>): Promise<T> {
  const anterior = g.__publicacionesLock ?? Promise.resolve();
  let liberar!: () => void;
  const mio = new Promise<void>((r) => (liberar = r));
  g.__publicacionesLock = anterior.then(() => mio);
  await anterior;
  try {
    return await fn();
  } finally {
    liberar();
  }
}

/** Más recientes primero. */
export async function listarPublicaciones(limite = 50): Promise<Publicacion[]> {
  const xs = await cargar();
  return xs.slice(0, Math.max(1, Math.min(200, limite)));
}

export interface EntradaPublicacion {
  perifericoId?: string;
  autor?: string;
  texto: string;
  imagenBase64?: string;
  imagenMime?: string;
  posicion?: ObservacionPipeline["posicion"];
}

async function anadir(p: Publicacion): Promise<Publicacion> {
  return conBloqueo(async () => {
    const xs = await cargar();
    // Agrupación de bulos y mensajes calcados publicados casi a la vez.
    const t = new Date(p.timestamp).getTime();
    const original = xs.find((o) => o.id !== p.id && o.origen === "periferico" && Math.abs(t - new Date(o.timestamp).getTime()) < VENTANA_AGRUPACION_MS && similitud(o.texto, p.texto) >= SIMILITUD_AGRUPACION);
    if (original) {
      original.menciones += 1;
      p.menciones = original.menciones;
      p.verificacion = { estado: "duplicado", motivo: `Misma publicación que ${original.id} (${original.menciones} menciones)`, duplicaDe: original.id };
    }
    xs.unshift(p);
    if (xs.length > MAXIMO) xs.length = MAXIMO;
    await guardar();
    return p;
  });
}

/**
 * Publica en el muro y lo hace pasar por el pipeline de ingesta (verificación,
 * impacto y, si hay bulo repetido, decisión de desmentido para el Gabinete).
 */
export async function publicar(entrada: EntradaPublicacion): Promise<{ publicacion: Publicacion; resultado?: ResultadoIngesta }> {
  const texto = (entrada.texto ?? "").trim();
  if (!texto) throw new Error("La publicación necesita texto");
  const autor = (entrada.autor ?? "").trim().slice(0, 40) || "Anónimo";

  let resultado: ResultadoIngesta | undefined;
  try {
    resultado = await procesarObservacion({
      perifericoId: entrada.perifericoId,
      tipo: "publicacion",
      texto,
      imagenBase64: entrada.imagenBase64,
      imagenMime: entrada.imagenMime,
      posicion: entrada.posicion,
      autor,
    });
  } catch (err) {
    console.warn("[publicaciones/pipeline]", err instanceof Error ? err.message : err);
  }

  // Sin pipeline (periférico inexistente) la imagen se guarda igualmente para el muro.
  let imagenUrl = resultado?.imagenUrl;
  if (!imagenUrl && entrada.imagenBase64) {
    try {
      imagenUrl = (await guardarImagen(entrada.imagenBase64, entrada.imagenMime || "image/jpeg")).url;
    } catch (err) {
      console.warn("[publicaciones/imagen]", err instanceof Error ? err.message : err);
    }
  }

  const posicion = entrada.posicion && typeof entrada.posicion.lat === "number" && typeof entrada.posicion.lon === "number" ? { lat: entrada.posicion.lat, lon: entrada.posicion.lon, precisionM: entrada.posicion.precisionM, rumboGrados: entrada.posicion.rumboGrados, timestamp: entrada.posicion.timestamp || new Date().toISOString() } : undefined;

  const publicacion = await anadir({
    id: nuevoId("pub"),
    autor,
    texto,
    imagenUrl,
    timestamp: new Date().toISOString(),
    perifericoId: entrada.perifericoId,
    origen: "periferico",
    posicion,
    verificacion: resultado?.evento.verificacion ?? { estado: "pendiente" },
    eventoId: resultado && resultado.impacto.accion !== "ruido" ? resultado.evento.id : undefined,
    menciones: 1,
  });

  return { publicacion, resultado };
}

/**
 * Comunicado oficial aprobado por el Gabinete: aparece en el mismo muro con
 * origen "gabinete". Lo llaman otras sesiones al ejecutar la acción de comunicar.
 */
export async function publicarComunicado(texto: string, autor = "Gabinete de Crisis"): Promise<Publicacion> {
  const limpio = (texto ?? "").trim();
  if (!limpio) throw new Error("El comunicado necesita texto");
  return conBloqueo(async () => {
    const xs = await cargar();
    const p: Publicacion = {
      id: nuevoId("pub"),
      autor: autor.slice(0, 40),
      texto: limpio.slice(0, 1200),
      timestamp: new Date().toISOString(),
      origen: "gabinete",
      verificacion: { estado: "verificado", motivo: "Comunicado oficial del centro de mando" },
      menciones: 1,
    };
    xs.unshift(p);
    if (xs.length > MAXIMO) xs.length = MAXIMO;
    await guardar();
    return p;
  });
}
