// =====================================================================
// ATALAYA INCENDIOS · Almacén del grafo de conocimiento
// ---------------------------------------------------------------------
// DUEÑO: constructor C.
// Doble persistencia deliberada:
//   1. Índice en memoria + fichero `data/conocimiento/indice.json`, para que
//      la demo funcione aunque el esquema de Supabase no esté aplicado.
//   2. Supabase (`documentos`, `chunks` con `embedding vector(384)`), que es
//      lo que usa la función RPC `buscar_chunks` cuando está disponible.
// Si Supabase falla, se registra en consola y se sigue con memoria: nunca se
// pierde la capacidad de citar normativa.
//
// Dependencias externas: @supabase/supabase-js (a través de lib/db/cliente.ts).
// =====================================================================

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AmbitoDocumento, Chunk, Documento } from "../dominio/tipos";
import { obtenerClienteSupabase } from "../db/cliente";
import { DIMENSIONES, modeloEmbeddings } from "../ia/embeddings";

/** Chunk con su vector y los metadatos del documento al que pertenece. */
export interface ChunkIndexado extends Chunk {
  embedding: number[];
  documentoTitulo: string;
  ambito: AmbitoDocumento;
  territorio?: string;
}

interface IndiceConocimiento {
  version: number;
  generado: string;
  modelo: string;
  dimensiones: number;
  documentos: Documento[];
  chunks: ChunkIndexado[];
}

const RUTA_DIRECTORIO = path.join(process.cwd(), "data", "conocimiento");
const RUTA_INDICE = path.join(RUTA_DIRECTORIO, "indice.json");

interface CacheAlmacen {
  indice?: IndiceConocimiento;
  cargando?: Promise<IndiceConocimiento>;
  guardadoPendiente?: NodeJS.Timeout;
}

type ConCache = typeof globalThis & { __atalayaConocimiento?: CacheAlmacen };
const cache: CacheAlmacen = ((globalThis as ConCache).__atalayaConocimiento ??= {});

function indiceVacio(): IndiceConocimiento {
  return {
    version: 1,
    generado: new Date().toISOString(),
    modelo: modeloEmbeddings(),
    dimensiones: DIMENSIONES,
    documentos: [],
    chunks: [],
  };
}

// ---------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------

/**
 * Índice cargado (fichero primero; si está vacío y hay Supabase, se rellena
 * desde la base de datos). Se cachea en el proceso.
 */
export async function obtenerIndice(): Promise<IndiceConocimiento> {
  if (cache.indice) return cache.indice;
  if (cache.cargando) return cache.cargando;

  cache.cargando = (async () => {
    let indice = indiceVacio();
    try {
      const bruto = await readFile(RUTA_INDICE, "utf8");
      const leido = JSON.parse(bruto) as IndiceConocimiento;
      if (Array.isArray(leido.chunks) && Array.isArray(leido.documentos)) {
        indice = { ...indiceVacio(), ...leido };
        console.log(
          `[conocimiento] índice local cargado: ${indice.documentos.length} documentos, ${indice.chunks.length} fragmentos`,
        );
      }
    } catch {
      // No hay índice aún: se creará con la primera ingesta.
    }

    if (!indice.chunks.length) {
      const desdeBd = await cargarDesdeSupabase();
      if (desdeBd) {
        indice.documentos = desdeBd.documentos;
        indice.chunks = desdeBd.chunks;
        console.log(`[conocimiento] índice cargado desde Supabase: ${desdeBd.chunks.length} fragmentos`);
      }
    }

    cache.indice = indice;
    cache.cargando = undefined;
    return indice;
  })();

  return cache.cargando;
}

interface FilaChunk {
  id: string;
  documento_id: string;
  indice: number;
  seccion: string | null;
  texto: string;
  entidades: string[] | null;
  relacionados: string[] | null;
  embedding: number[] | string | null;
  datos: Record<string, unknown> | null;
}

interface FilaDocumento {
  id: string;
  titulo: string;
  nombre_archivo: string;
  ambito: string;
  territorio: string | null;
  subido_en: string;
  tamano_bytes: number;
  num_chunks: number;
  estado: string;
}

function comoVector(v: number[] | string | null): number[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as number[];
    } catch {
      return [];
    }
  }
  return [];
}

async function cargarDesdeSupabase(): Promise<{ documentos: Documento[]; chunks: ChunkIndexado[] } | undefined> {
  const bd = obtenerClienteSupabase();
  if (!bd) return undefined;
  try {
    const { data: docs, error: e1 } = await bd.from("documentos").select("*");
    if (e1) throw new Error(e1.message);
    const { data: trozos, error: e2 } = await bd.from("chunks").select("*");
    if (e2) throw new Error(e2.message);
    const documentos = (docs ?? []).map(
      (d: FilaDocumento): Documento => ({
        id: d.id,
        titulo: d.titulo,
        nombreArchivo: d.nombre_archivo,
        ambito: d.ambito as AmbitoDocumento,
        territorio: d.territorio ?? undefined,
        subidoEn: d.subido_en,
        tamanoBytes: d.tamano_bytes ?? 0,
        numChunks: d.num_chunks ?? 0,
        estado: (d.estado as Documento["estado"]) ?? "listo",
      }),
    );
    const porId = new Map(documentos.map((d) => [d.id, d]));
    const chunks = (trozos ?? []).map((c: FilaChunk): ChunkIndexado => {
      const doc = porId.get(c.documento_id);
      return {
        id: c.id,
        documentoId: c.documento_id,
        indice: c.indice,
        seccion: c.seccion ?? undefined,
        texto: c.texto,
        entidades: c.entidades ?? [],
        relacionados: c.relacionados ?? [],
        embedding: comoVector(c.embedding),
        documentoTitulo: doc?.titulo ?? c.documento_id,
        ambito: doc?.ambito ?? "nacional",
        territorio: doc?.territorio,
      };
    });
    return { documentos, chunks };
  } catch (e) {
    console.warn(`[conocimiento] no se pudo leer de Supabase (se usa el índice local): ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

// ---------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------

/** Guarda el índice en disco (agrupando escrituras seguidas). */
function programarGuardado(): void {
  if (cache.guardadoPendiente) clearTimeout(cache.guardadoPendiente);
  cache.guardadoPendiente = setTimeout(() => {
    void guardarIndice();
  }, 500);
  // No mantiene vivo el proceso si es lo único pendiente.
  cache.guardadoPendiente.unref?.();
}

export async function guardarIndice(): Promise<void> {
  const indice = await obtenerIndice();
  indice.generado = new Date().toISOString();
  try {
    await mkdir(RUTA_DIRECTORIO, { recursive: true });
    // Los vectores se redondean a 5 decimales: el fichero baja a menos de la
    // mitad y la similitud coseno no se resiente de forma apreciable.
    const compacto = {
      ...indice,
      chunks: indice.chunks.map((c) => ({ ...c, embedding: c.embedding.map((x) => Number(x.toFixed(5))) })),
    };
    await writeFile(RUTA_INDICE, JSON.stringify(compacto), "utf8");
  } catch (e) {
    console.warn(`[conocimiento] no se pudo guardar el índice local: ${e instanceof Error ? e.message : e}`);
  }
}

/** Añade (o reemplaza) un documento y sus fragmentos en memoria, disco y Supabase. */
export async function guardarDocumento(documento: Documento, chunks: ChunkIndexado[]): Promise<void> {
  const indice = await obtenerIndice();
  indice.documentos = [...indice.documentos.filter((d) => d.id !== documento.id), documento];
  indice.chunks = [...indice.chunks.filter((c) => c.documentoId !== documento.id), ...chunks];
  programarGuardado();
  await sincronizarDocumento(documento, chunks);
}

/** Actualiza solo la ficha del documento (estado "procesando" → "listo"/"error"). */
export async function actualizarDocumento(id: string, cambios: Partial<Documento>): Promise<Documento | undefined> {
  const indice = await obtenerIndice();
  const i = indice.documentos.findIndex((d) => d.id === id);
  if (i < 0) return undefined;
  indice.documentos[i] = { ...indice.documentos[i], ...cambios };
  programarGuardado();
  return indice.documentos[i];
}

export async function eliminarDocumento(id: string): Promise<boolean> {
  const indice = await obtenerIndice();
  const antes = indice.documentos.length;
  indice.documentos = indice.documentos.filter((d) => d.id !== id);
  indice.chunks = indice.chunks.filter((c) => c.documentoId !== id);
  if (indice.documentos.length === antes) return false;
  programarGuardado();
  const bd = obtenerClienteSupabase();
  if (bd) {
    try {
      await bd.from("chunks").delete().eq("documento_id", id);
      await bd.from("documentos").delete().eq("id", id);
    } catch (e) {
      console.warn(`[conocimiento] no se pudo borrar en Supabase: ${e instanceof Error ? e.message : e}`);
    }
  }
  return true;
}

async function sincronizarDocumento(documento: Documento, chunks: ChunkIndexado[]): Promise<void> {
  const bd = obtenerClienteSupabase();
  if (!bd) return;
  try {
    const { error: e1 } = await bd.from("documentos").upsert({
      id: documento.id,
      titulo: documento.titulo,
      nombre_archivo: documento.nombreArchivo,
      ambito: documento.ambito,
      territorio: documento.territorio ?? null,
      subido_en: documento.subidoEn,
      tamano_bytes: documento.tamanoBytes,
      num_chunks: documento.numChunks,
      estado: documento.estado,
    });
    if (e1) throw new Error(e1.message);

    await bd.from("chunks").delete().eq("documento_id", documento.id);
    // En lotes de 100 para no pasarse del tamaño de petición de PostgREST.
    for (let i = 0; i < chunks.length; i += 100) {
      const lote = chunks.slice(i, i + 100).map((c) => ({
        id: c.id,
        documento_id: c.documentoId,
        indice: c.indice,
        seccion: c.seccion ?? null,
        texto: c.texto,
        entidades: c.entidades,
        relacionados: c.relacionados,
        embedding: c.embedding,
        datos: { documentoTitulo: c.documentoTitulo, ambito: c.ambito, territorio: c.territorio ?? null },
      }));
      const { error } = await bd.from("chunks").insert(lote);
      if (error) throw new Error(error.message);
    }
    console.log(`[conocimiento] documento "${documento.titulo}" sincronizado con Supabase (${chunks.length} fragmentos)`);
  } catch (e) {
    console.warn(
      `[conocimiento] Supabase no aceptó el documento (la demo sigue con el índice local): ${e instanceof Error ? e.message : e}`,
    );
  }
}

// ---------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------

export async function listarDocumentos(): Promise<Documento[]> {
  const indice = await obtenerIndice();
  return [...indice.documentos].sort((a, b) => b.subidoEn.localeCompare(a.subidoEn));
}

export async function listarChunks(documentoId?: string): Promise<ChunkIndexado[]> {
  const indice = await obtenerIndice();
  return documentoId ? indice.chunks.filter((c) => c.documentoId === documentoId) : indice.chunks;
}

export async function obtenerChunk(id: string): Promise<ChunkIndexado | undefined> {
  const indice = await obtenerIndice();
  return indice.chunks.find((c) => c.id === id);
}

export async function resumenConocimiento(): Promise<{ documentos: number; chunks: number; modelo: string; enSupabase: boolean }> {
  const indice = await obtenerIndice();
  return {
    documentos: indice.documentos.length,
    chunks: indice.chunks.length,
    modelo: indice.modelo,
    enSupabase: Boolean(obtenerClienteSupabase()),
  };
}
