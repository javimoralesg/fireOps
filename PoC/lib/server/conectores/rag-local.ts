// RAG local REAL sobre normativa española de protección civil, para citar el
// protocolo aplicable cuando no hay clave de QuiverAI.
//
// El corpus (`data/protocolos/*.md`) se descarga de fuentes oficiales —BOE en
// XML, BOCM y transparencia.madrid.es en PDF— y se trocea e indexa con
// `node data/protocolos/construir.mjs`, que genera `data/protocolos/indice.json`
// con un vector por fragmento calculado con Ollama (all-minilm:l6-v2, 384 dim).
// Aquí no se inventa nada: si falta el índice o Ollama no responde, se lanza un
// error con el remedio y el llamador decide qué hacer.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/** Fragmento de normativa recuperado, con su cita y su puntuación en [0,1]. */
export interface FragmentoProtocolo {
  id: string;
  documento: string;
  titulo: string;
  url: string;
  referencia: string;
  texto: string;
  score: number;
}

interface FragmentoIndexado {
  id: string;
  documento: string;
  titulo: string;
  url: string;
  referencia: string;
  texto: string;
  vector: Float32Array;
  /** Frecuencia de cada término del fragmento (para el componente léxico BM25). */
  terminos: Map<string, number>;
  longitud: number;
}

interface IndiceProtocolos {
  modelo: string;
  dimension: number;
  generado: string;
  fragmentos: FragmentoIndexado[];
  /** Nº de fragmentos que contienen cada término, y longitud media. */
  df: Map<string, number>;
  longitudMedia: number;
}

interface Sonda {
  ok: boolean;
  en: number; // epoch ms
}

interface CacheRagLocal {
  indice?: IndiceProtocolos;
  cargando?: Promise<IndiceProtocolos>;
  configurado?: boolean;
  sonda?: Sonda;
  sondeando?: Promise<Sonda>;
}

type ConCache = typeof globalThis & { __atalayaRagLocal?: CacheRagLocal };

// El índice ocupa varios MB: se carga una sola vez y vive en globalThis para
// sobrevivir al hot reload de Next en desarrollo.
const cache: CacheRagLocal = ((globalThis as ConCache).__atalayaRagLocal ??= {});

const TTL_SONDA_MS = 30_000;
const TIMEOUT_TAGS_MS = 3_000; // el primer /api/tags tras arrancar Ollama tarda ~2 s
const TIMEOUT_EMBED_MS = 20_000;
const TOP_K_POR_DEFECTO = 5;

// all-minilm:l6-v2 está entrenado en inglés: sobre texto jurídico en español el
// coseno solo acierta a medias. Se combina con un BM25 léxico sobre el mismo
// índice, que es lo que engancha "residencia de mayores", "confinamiento" o
// "humo" con el articulado que los nombra. Ambos componentes van en [0,1].
const PESO_VECTOR = 0.5;
const PESO_LEXICO = 0.5;
const BM25_K1 = 1.5;
const BM25_B = 0.75;

const RUTA_INDICE = path.join(process.cwd(), "data", "protocolos", "indice.json");

const ollamaUrl = (): string =>
  (process.env.OLLAMA_URL?.trim() || "http://localhost:11434").replace(/\/$/, "");

/** Modelo de embeddings usado tanto al indexar como al consultar. */
export function modeloEmbeddings(): string {
  return process.env.OLLAMA_MODEL_EMBED?.trim() || "all-minilm:l6-v2";
}

/* ------------------------------------------------------------------ */
/* Disponibilidad                                                      */
/* ------------------------------------------------------------------ */

/** ¿Existe `data/protocolos/indice.json`? Síncrono y cacheado (no toca la red). */
export function ragLocalConfigurado(): boolean {
  if (cache.configurado === undefined) cache.configurado = existsSync(RUTA_INDICE);
  return cache.configurado;
}

/** Índice presente y Ollama sirviendo el modelo de embeddings. Sondeo cacheado 30 s. */
export async function ragLocalDisponible(): Promise<boolean> {
  if (!ragLocalConfigurado()) return false;
  const sonda = await sondearOllama();
  return sonda.ok;
}

async function sondearOllama(): Promise<Sonda> {
  const previa = cache.sonda;
  if (previa && Date.now() - previa.en < TTL_SONDA_MS) return previa;
  if (cache.sondeando) return cache.sondeando;

  cache.sondeando = (async (): Promise<Sonda> => {
    let sonda: Sonda = { ok: false, en: Date.now() };
    try {
      const r = await fetch(`${ollamaUrl()}/api/tags`, {
        signal: AbortSignal.timeout(TIMEOUT_TAGS_MS),
        cache: "no-store",
      });
      if (r.ok) sonda = { ok: tieneModelo(await r.json(), modeloEmbeddings()), en: Date.now() };
    } catch {
      // Ollama no responde: queda ok=false hasta el siguiente sondeo.
    }
    cache.sonda = sonda;
    cache.sondeando = undefined;
    return sonda;
  })();

  return cache.sondeando;
}

function tieneModelo(respuesta: unknown, modelo: string): boolean {
  if (!esObjeto(respuesta) || !Array.isArray(respuesta.models)) return false;
  const buscado = modelo.includes(":") ? modelo : `${modelo}:latest`;
  return respuesta.models.some(
    (m) => esObjeto(m) && typeof m.name === "string" && m.name === buscado,
  );
}

/* ------------------------------------------------------------------ */
/* Búsqueda                                                            */
/* ------------------------------------------------------------------ */

/**
 * Embebe la consulta con Ollama y devuelve los `topK` fragmentos de normativa
 * más parecidos del índice local, de mayor a menor score.
 *
 * El score combina la similitud coseno del embedding con un BM25 léxico sobre
 * el mismo índice (mitad y mitad), porque el modelo de embeddings disponible en
 * local está entrenado en inglés y por sí solo se queda corto en español.
 *
 * @throws Error si falta el índice o si Ollama no responde, con el remedio.
 */
export async function buscarProtocoloLocal(
  consulta: string,
  topK: number = TOP_K_POR_DEFECTO,
): Promise<FragmentoProtocolo[]> {
  const texto = consulta.trim();
  if (!texto) return [];

  const indice = await cargarIndice();
  const vectorConsulta = await embeberConsulta(texto);

  if (vectorConsulta.length !== indice.dimension) {
    throw new Error(
      `RAG local: el modelo ${modeloEmbeddings()} devuelve ${vectorConsulta.length} dimensiones y el índice se generó con ${indice.dimension} (modelo ${indice.modelo}). Regenera el índice con "node data/protocolos/construir.mjs".`,
    );
  }

  const normaConsulta = norma(vectorConsulta);
  if (normaConsulta === 0) return [];

  const terminosConsulta = tokenizar(texto);
  const total = indice.fragmentos.length;
  const vectorial = new Float64Array(total);
  const lexico = new Float64Array(total);
  let maxLexico = 0;

  for (let i = 0; i < total; i += 1) {
    const fragmento = indice.fragmentos[i];
    // Coseno en [0,1]: los negativos no aportan nada como "protocolo aplicable".
    vectorial[i] = Math.max(0, coseno(vectorConsulta, normaConsulta, fragmento.vector));
    const bm = bm25(terminosConsulta, fragmento, indice);
    lexico[i] = bm;
    if (bm > maxLexico) maxLexico = bm;
  }

  const limite = Math.max(1, Math.min(Math.trunc(topK) || TOP_K_POR_DEFECTO, total));
  const mejores: FragmentoProtocolo[] = [];

  for (let i = 0; i < total; i += 1) {
    const score = PESO_VECTOR * vectorial[i] + PESO_LEXICO * (maxLexico > 0 ? lexico[i] / maxLexico : 0);
    if (mejores.length === limite && score <= mejores[mejores.length - 1].score) continue;

    const fragmento = indice.fragmentos[i];
    const candidato: FragmentoProtocolo = {
      id: fragmento.id,
      documento: fragmento.documento,
      titulo: fragmento.titulo,
      url: fragmento.url,
      referencia: fragmento.referencia,
      texto: fragmento.texto,
      score,
    };
    const posicion = mejores.findIndex((m) => m.score < score);
    mejores.splice(posicion < 0 ? mejores.length : posicion, 0, candidato);
    if (mejores.length > limite) mejores.pop();
  }

  return mejores;
}

/* ------------------------------------------------------------------ */
/* Componente léxico (BM25)                                            */
/* ------------------------------------------------------------------ */

// Palabras vacías del español: no discriminan entre artículos de una ley.
const VACIAS = new Set([
  "a", "al", "algo", "algun", "alguna", "algunas", "alguno", "algunos", "ante", "antes", "aquel",
  "aquella", "aquellas", "aquello", "aquellos", "aqui", "asi", "aun", "aunque", "bajo", "bien",
  "cada", "casi", "como", "con", "contra", "cual", "cuales", "cualquier", "cuando", "cuanto", "de",
  "debe", "deben", "del", "demas", "dentro", "desde", "donde", "dos", "durante", "e", "el", "ella",
  "ellas", "ello", "ellos", "en", "entre", "era", "eran", "es", "esa", "esas", "ese", "eso", "esos",
  "esta", "estan", "estas", "este", "esto", "estos", "fue", "fueron", "ha", "haber", "hace", "hacia",
  "han", "hasta", "hay", "la", "las", "le", "les", "lo", "los", "mas", "me", "mediante", "menos",
  "mi", "mientras", "mismo", "misma", "mismas", "mismos", "mucho", "muy", "ni", "no", "nos", "o",
  "otra", "otras", "otro", "otros", "para", "pero", "poco", "por", "porque", "pueda", "pueden",
  "puede", "que", "quien", "se", "segun", "ser", "si", "sido", "sin", "sobre", "solo", "son", "su",
  "sus", "tal", "tambien", "tanto", "te", "tiene", "tienen", "toda", "todas", "todo", "todos", "tras",
  "un", "una", "unas", "uno", "unos", "y", "ya",
]);

/** Minúsculas sin acentos, palabras de 3+ letras y sin vacías. */
function tokenizar(texto: string): string[] {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t.length >= 3 && !VACIAS.has(t));
}

function contar(tokens: string[]): Map<string, number> {
  const cuenta = new Map<string, number>();
  for (const t of tokens) cuenta.set(t, (cuenta.get(t) ?? 0) + 1);
  return cuenta;
}

function bm25(terminos: string[], fragmento: FragmentoIndexado, indice: IndiceProtocolos): number {
  if (terminos.length === 0 || fragmento.longitud === 0) return 0;
  const n = indice.fragmentos.length;
  let total = 0;
  for (const termino of terminos) {
    const tf = fragmento.terminos.get(termino);
    if (!tf) continue;
    const df = indice.df.get(termino) ?? 0;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    const normalizador = BM25_K1 * (1 - BM25_B + (BM25_B * fragmento.longitud) / indice.longitudMedia);
    total += idf * ((tf * (BM25_K1 + 1)) / (tf + normalizador));
  }
  return total;
}

function norma(v: Float32Array): number {
  let suma = 0;
  for (let i = 0; i < v.length; i += 1) suma += v[i] * v[i];
  return Math.sqrt(suma);
}

function coseno(consulta: Float32Array, normaConsulta: number, fragmento: Float32Array): number {
  let punto = 0;
  let suma = 0;
  for (let i = 0; i < consulta.length; i += 1) {
    punto += consulta[i] * fragmento[i];
    suma += fragmento[i] * fragmento[i];
  }
  const divisor = normaConsulta * Math.sqrt(suma);
  return divisor === 0 ? 0 : punto / divisor;
}

async function embeberConsulta(texto: string): Promise<Float32Array> {
  const url = `${ollamaUrl()}/api/embed`;
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modeloEmbeddings(),
        input: [texto.slice(0, 1_100)],
        truncate: true,
        // all-minilm:l6-v2 se publica con num_ctx=256; el modelo admite 512.
        options: { num_ctx: 512 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_EMBED_MS),
      cache: "no-store",
    });
  } catch (e) {
    cache.sonda = { ok: false, en: Date.now() };
    throw new Error(
      `RAG local: Ollama no responde en ${ollamaUrl()} (${mensaje(e)}). Arráncalo con "ollama serve" y descarga el modelo con "ollama pull ${modeloEmbeddings()}".`,
    );
  }

  if (!respuesta.ok) {
    cache.sonda = { ok: false, en: Date.now() };
    throw new Error(
      `RAG local: Ollama devolvió HTTP ${respuesta.status} al embeber la consulta con ${modeloEmbeddings()}. Comprueba "ollama list" en ${ollamaUrl()}.`,
    );
  }

  const cuerpo: unknown = await respuesta.json();
  if (!esObjeto(cuerpo) || !Array.isArray(cuerpo.embeddings) || cuerpo.embeddings.length === 0) {
    throw new Error(`RAG local: respuesta inesperada de ${url} (sin "embeddings").`);
  }
  const vector = cuerpo.embeddings[0];
  if (!esVectorNumerico(vector)) {
    throw new Error(`RAG local: el embedding devuelto por ${url} no es un vector numérico.`);
  }
  return Float32Array.from(vector);
}

/* ------------------------------------------------------------------ */
/* Carga del índice                                                    */
/* ------------------------------------------------------------------ */

async function cargarIndice(): Promise<IndiceProtocolos> {
  if (cache.indice) return cache.indice;
  if (cache.cargando) return cache.cargando;

  cache.cargando = (async (): Promise<IndiceProtocolos> => {
    let bruto: string;
    try {
      bruto = await readFile(RUTA_INDICE, "utf8");
    } catch {
      cache.configurado = false;
      throw new Error(
        `RAG local sin índice: no existe ${RUTA_INDICE}. Genéralo con "node data/protocolos/construir.mjs" (descarga el BOE y calcula los embeddings con Ollama).`,
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(bruto);
    } catch (e) {
      throw new Error(`RAG local: ${RUTA_INDICE} no es JSON válido (${mensaje(e)}). Regenéralo.`);
    }

    const indice = interpretarIndice(json);
    cache.indice = indice;
    cache.configurado = true;
    cache.cargando = undefined;
    return indice;
  })();

  try {
    return await cache.cargando;
  } catch (e) {
    cache.cargando = undefined;
    throw e;
  }
}

function interpretarIndice(json: unknown): IndiceProtocolos {
  if (!esObjeto(json) || !Array.isArray(json.fragmentos)) {
    throw new Error(`RAG local: ${RUTA_INDICE} no tiene la forma esperada (falta "fragmentos").`);
  }

  const fragmentos: FragmentoIndexado[] = [];
  for (const crudo of json.fragmentos) {
    if (!esObjeto(crudo)) continue;
    const { id, documento, titulo, url, referencia, texto, vector } = crudo;
    if (
      typeof id !== "string" ||
      typeof documento !== "string" ||
      typeof titulo !== "string" ||
      typeof url !== "string" ||
      typeof referencia !== "string" ||
      typeof texto !== "string" ||
      !esVectorNumerico(vector)
    ) {
      continue;
    }
    const tokens = tokenizar(`${referencia} ${texto}`);
    fragmentos.push({
      id,
      documento,
      titulo,
      url,
      referencia,
      texto,
      vector: Float32Array.from(vector),
      terminos: contar(tokens),
      longitud: tokens.length,
    });
  }

  if (fragmentos.length === 0) {
    throw new Error(`RAG local: ${RUTA_INDICE} no contiene fragmentos válidos. Regenéralo.`);
  }

  // Estadísticas del corpus para BM25 (una sola vez, al cargar el índice).
  const df = new Map<string, number>();
  let longitudTotal = 0;
  for (const fragmento of fragmentos) {
    longitudTotal += fragmento.longitud;
    for (const termino of fragmento.terminos.keys()) df.set(termino, (df.get(termino) ?? 0) + 1);
  }

  const dimension = typeof json.dimension === "number" ? json.dimension : fragmentos[0].vector.length;
  return {
    modelo: typeof json.modelo === "string" ? json.modelo : modeloEmbeddings(),
    dimension,
    generado: typeof json.generado === "string" ? json.generado : "",
    fragmentos,
    df,
    longitudMedia: longitudTotal / fragmentos.length || 1,
  };
}

/* ------------------------------------------------------------------ */
/* Ayudas                                                              */
/* ------------------------------------------------------------------ */

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function esVectorNumerico(v: unknown): v is number[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
