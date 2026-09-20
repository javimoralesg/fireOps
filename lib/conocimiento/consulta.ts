// =====================================================================
// ATALAYA INCENDIOS · Consulta al grafo de conocimiento (RAG)
// ---------------------------------------------------------------------
// DUEÑO: constructor C.
// Recorrido de una pregunta:
//   1. Embedding de la pregunta (prefijo "query: ").
//   2. Top-k por similitud coseno: RPC `buscar_chunks` en Supabase si está
//      disponible; si no, el índice en memoria.
//   3. EXPANSIÓN POR GRAFO: se añaden los fragmentos referenciados
//      ("artículo N" citado dentro del texto) y el fragmento siguiente cuando
//      el vecino también se parece bastante a la pregunta. Es lo que hace que
//      esto sea un grafo y no una simple lista de vectores.
//   4. `consultarProtocolo` pasa esos fundamentos al modelo de razonamiento,
//      que responde SOLO con ellos y citando [documento §sección].
//
// Si no hay proveedor de IA, `buscarFundamentos` sigue funcionando (los
// embeddings tienen respaldo local) y `consultarProtocolo` falla con un
// mensaje claro: nunca se inventa una respuesta legal.
// =====================================================================

import type { ConsultaConocimiento, Fundamento } from "../dominio/tipos";
import { obtenerClienteSupabase } from "../db/cliente";
import { incrustarConsulta, modeloEmbeddings, similitudCoseno } from "../ia/embeddings";
import { completarTexto, modeloPara } from "../ia/llm";
import { listarChunks, obtenerIndice, type ChunkIndexado } from "./almacen";

const K_POR_DEFECTO = Number(process.env.CONOCIMIENTO_K ?? 6);
/** Similitud mínima para que un vecino del grafo merezca entrar. */
const UMBRAL_VECINO = Number(process.env.CONOCIMIENTO_UMBRAL_VECINO ?? 0.35);
const MAX_CITA = 300;

/** Por qué se miró un fragmento: lo enseña la pantalla de conocimiento. */
export type MotivoFundamento = "vector" | "referencia" | "siguiente";

export interface FundamentoExplicado extends Fundamento {
  chunkId: string;
  motivo: MotivoFundamento;
  /** Fragmento desde el que se llegó, si vino por el grafo. */
  desdeChunkId?: string;
  texto: string;
  entidades: string[];
}

function recortarCita(texto: string): string {
  const limpio = texto.replace(/^…\S*\s*/, "").replace(/\s+/g, " ").trim();
  return limpio.length > MAX_CITA ? `${limpio.slice(0, MAX_CITA - 1)}…` : limpio;
}

function aFundamento(c: ChunkIndexado, similitud: number, motivo: MotivoFundamento, desde?: string): FundamentoExplicado {
  return {
    chunkId: c.id,
    documento: c.documentoTitulo,
    seccion: c.seccion,
    cita: recortarCita(c.texto),
    similitud: Number(similitud.toFixed(4)),
    motivo,
    desdeChunkId: desde,
    texto: c.texto,
    entidades: c.entidades,
  };
}

// ---------------------------------------------------------------------
// Recuperación vectorial
// ---------------------------------------------------------------------

interface FilaRpc {
  id: string;
  documento_id: string;
  seccion: string | null;
  texto: string;
  entidades: string[] | null;
  relacionados: string[] | null;
  similitud: number;
}

/** Top-k por Supabase (RPC `buscar_chunks`). Devuelve undefined si no se puede. */
async function topKSupabase(
  vector: number[],
  k: number,
  territorio?: string,
): Promise<{ chunk: ChunkIndexado; similitud: number }[] | undefined> {
  const bd = obtenerClienteSupabase();
  if (!bd) return undefined;
  try {
    const { data, error } = await bd.rpc("buscar_chunks", { consulta: vector, k, territorio: territorio ?? null });
    if (error) throw new Error(error.message);
    if (!Array.isArray(data) || !data.length) return undefined;
    const indice = await obtenerIndice();
    const porId = new Map(indice.chunks.map((c) => [c.id, c]));
    return (data as FilaRpc[]).map((f) => {
      const local = porId.get(f.id);
      const chunk: ChunkIndexado = local ?? {
        id: f.id,
        documentoId: f.documento_id,
        indice: 0,
        seccion: f.seccion ?? undefined,
        texto: f.texto,
        entidades: f.entidades ?? [],
        relacionados: f.relacionados ?? [],
        embedding: [],
        documentoTitulo: f.documento_id,
        ambito: "nacional",
      };
      return { chunk, similitud: f.similitud };
    });
  } catch (e) {
    console.warn(
      `[conocimiento] la RPC buscar_chunks no respondió (uso el índice local): ${e instanceof Error ? e.message : e}`,
    );
    return undefined;
  }
}

/** Top-k sobre el índice en memoria. */
async function topKMemoria(
  vector: number[],
  k: number,
  territorio?: string,
): Promise<{ chunk: ChunkIndexado; similitud: number }[]> {
  const chunks = await listarChunks();
  const candidatos = territorio
    ? chunks.filter((c) => c.ambito === "nacional" || !c.territorio || c.territorio === territorio)
    : chunks;
  return candidatos
    .filter((c) => c.embedding.length)
    .map((chunk) => ({ chunk, similitud: similitudCoseno(vector, chunk.embedding) }))
    .sort((a, b) => b.similitud - a.similitud)
    .slice(0, k);
}

// ---------------------------------------------------------------------
// Búsqueda con expansión por grafo
// ---------------------------------------------------------------------

/**
 * Fundamentos legales para una pregunta: top-k vectorial + vecinos del grafo.
 * Es lo que llama el asesor legal (constructor D) antes de cada decisión.
 */
export async function buscarFundamentos(
  pregunta: string,
  opciones: { k?: number; territorio?: string } = {},
): Promise<Fundamento[]> {
  return buscarFundamentosExplicados(pregunta, opciones);
}

/** Igual que `buscarFundamentos`, pero diciendo por qué entró cada fragmento. */
export async function buscarFundamentosExplicados(
  pregunta: string,
  opciones: { k?: number; territorio?: string } = {},
): Promise<FundamentoExplicado[]> {
  const k = opciones.k ?? K_POR_DEFECTO;
  const indice = await obtenerIndice();
  if (!indice.chunks.length) return [];
  if (indice.modelo && indice.modelo !== modeloEmbeddings()) {
    console.warn(
      `[conocimiento] el índice se creó con "${indice.modelo}" y ahora el modelo es "${modeloEmbeddings()}": ` +
        `los vectores no son comparables. Vuelve a ejecutar scripts/sembrar-conocimiento.ts.`,
    );
  }

  const vector = await incrustarConsulta(pregunta);
  const base = (await topKSupabase(vector, k, opciones.territorio)) ?? (await topKMemoria(vector, k, opciones.territorio));

  const porId = new Map(indice.chunks.map((c) => [c.id, c]));
  const elegidos = new Map<string, FundamentoExplicado>();
  for (const { chunk, similitud } of base) elegidos.set(chunk.id, aFundamento(chunk, similitud, "vector"));

  // --- expansión por grafo -------------------------------------------
  for (const { chunk } of base) {
    for (const idRelacionado of chunk.relacionados) {
      if (elegidos.has(idRelacionado)) continue;
      const vecino = porId.get(idRelacionado);
      if (!vecino?.embedding.length) continue;
      const contiguo = Math.abs(vecino.indice - chunk.indice) === 1 && vecino.documentoId === chunk.documentoId;
      const similitud = similitudCoseno(vector, vecino.embedding);
      // Una referencia cruzada ("véase el artículo 46") entra siempre: es
      // justo el salto que un jurista daría. El fragmento contiguo solo si
      // además se parece a la pregunta.
      if (!contiguo) {
        elegidos.set(vecino.id, aFundamento(vecino, similitud, "referencia", chunk.id));
      } else if (vecino.indice > chunk.indice && similitud >= UMBRAL_VECINO) {
        elegidos.set(vecino.id, aFundamento(vecino, similitud, "siguiente", chunk.id));
      }
    }
  }

  return [...elegidos.values()].sort((a, b) => b.similitud - a.similitud).slice(0, k * 2);
}

// ---------------------------------------------------------------------
// Respuesta razonada
// ---------------------------------------------------------------------

/**
 * Responde una pregunta operativa citando SOLO los fundamentos recuperados.
 * Si no hay corpus o no hay proveedor de IA, falla con un mensaje claro.
 */
export async function consultarProtocolo(pregunta: string, opciones: { territorio?: string; k?: number } = {}): Promise<ConsultaConocimiento> {
  const fundamentos = await buscarFundamentosExplicados(pregunta, opciones);
  if (!fundamentos.length) {
    throw new Error(
      "No hay conocimiento indexado: sube documentos en /conocimiento o ejecuta `npx tsx scripts/sembrar-conocimiento.ts`.",
    );
  }

  const contexto = fundamentos
    .map((f, i) => `[${i + 1}] ${f.documento} §${f.seccion ?? "—"} (similitud ${f.similitud.toFixed(3)}, ${f.motivo})\n${f.texto}`)
    .join("\n\n");

  const r = await completarTexto({
    // Cola prioritaria de lib/ia/llm.ts: Hay una persona esperando la respuesta delante de la pantalla.
    prioridad: "alta",
    permitirEnPausa: true,
    papel: "razonamiento",
    // Igual que el resto de llamadas de razonamiento: por debajo de 4000 el
    // modelo se gasta el presupuesto razonando y hay que reintentar.
    maxTokens: 4000,
    system:
      "Eres el asesor jurídico-operativo de un centro de coordinación de incendios forestales en España. " +
      "Respondes SOLO con lo que digan los fragmentos que te dan. Si no está en ellos, dices literalmente " +
      "«Los documentos indexados no lo dicen» y señalas qué haría falta. " +
      "Citas siempre como [Documento §sección]. Español claro, directo y breve: el que lee está en una sala de mando.",
    user:
      `Pregunta: ${pregunta}\n\n` +
      `Fragmentos disponibles:\n${contexto}\n\n` +
      `Responde en 3-6 frases, citando la fuente de cada afirmación con [Documento §sección]. ` +
      `Si hay varias administraciones implicadas, deja claro quién ordena qué.`,
  });

  return {
    pregunta,
    respuesta: r.datos,
    fundamentos: fundamentos.map((f) => ({
      chunkId: f.chunkId,
      documento: f.documento,
      seccion: f.seccion,
      cita: f.cita,
      similitud: f.similitud,
    })),
    vecinos: fundamentos.filter((f) => f.motivo !== "vector").map((f) => f.chunkId),
    modelo: r.modelo || modeloPara("razonamiento"),
  };
}
