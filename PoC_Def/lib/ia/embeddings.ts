// =====================================================================
// ATALAYA INCENDIOS · Embeddings multilingües
// ---------------------------------------------------------------------
// DUEÑO: constructor C.
// El número de dimensiones lo fija `EMBEDDINGS_DIMENSIONES` (512 por defecto)
// y tiene que coincidir con el `vector(N)` del esquema de Supabase.
// VERIFICADO 2026-09-19 contra la API de HelmCode: 384 NO está permitido; los
// valores admitidos son 32, 64, 128, 256, 512, 768, 1024, 1536, 2048 y 4096.
//
// Proveedores:
//   helmcode → POR DEFECTO. `qwen3-embedding` (8B, 100+ idiomas) en la UE,
//              con `dimensions` (Matryoshka: se puede pedir menos de 4096).
//   local    → RESPALDO SIN CLAVE. `@huggingface/transformers` 4.x en proceso,
//              `Xenova/multilingual-e5-small` con dtype q8 (~118 MB), pooling
//              mean + normalize. Da 384 dimensiones: se rellena con ceros
//              hasta el tamaño configurado y se marca como DEGRADADO (los
//              vectores no son comparables con los de qwen3-embedding, así que
//              hay que reindexar si se cambia de proveedor).
//   jina     → jina-embeddings-v5-text-small (clave gratuita autogenerada)
//   openai   → text-embedding-3-small con `dimensions`
//
// IMPORTANTE (familia E5): hay que anteponer "query: " a las preguntas y
// "passage: " a los fragmentos. Omitirlo hunde la calidad de recuperación;
// por eso se exponen `incrustarConsulta` e `incrustarPasajes`.
//
// Dependencias externas: @huggingface/transformers (local), fetch (resto).
// =====================================================================

import { anotarLlamadaIA } from "../motor/traza";

/** Dimensiones admitidas por la API de HelmCode (verificado 2026-09-19). */
const DIMENSIONES_VALIDAS = [32, 64, 128, 256, 512, 768, 1024, 1536, 2048, 4096];

function dimensionesConfiguradas(): number {
  const pedida = Number(process.env.EMBEDDINGS_DIMENSIONES ?? 512);
  if (DIMENSIONES_VALIDAS.includes(pedida)) return pedida;
  console.warn(`[embeddings] EMBEDDINGS_DIMENSIONES=${pedida} no está permitido; uso 512.`);
  return 512;
}

/** Longitud de los vectores. Debe coincidir con el `vector(N)` de pgvector. */
export const DIMENSIONES = dimensionesConfiguradas();

/** Dimensiones nativas del modelo local de respaldo. */
const DIMENSIONES_LOCAL = 384;

export type ProveedorEmbeddings = "local" | "jina" | "helmcode" | "openai";

/** Proveedor pedido por configuración (sin comprobar si tiene clave). */
function proveedorPedido(): ProveedorEmbeddings {
  const v = process.env.EMBEDDINGS_PROVEEDOR?.trim().toLowerCase();
  if (v === "jina" || v === "local" || v === "openai") return v;
  return "helmcode";
}

/**
 * Proveedor que se va a usar de verdad. Si el pedido necesita clave y no la
 * hay, se cae al modelo local (que es real y no necesita nada) avisando por
 * consola: la plataforma nunca se queda sin poder citar normativa.
 */
export function proveedorEmbeddings(): ProveedorEmbeddings {
  const pedido = proveedorPedido();
  if (pedido === "local") return "local";
  const c = configHttp(pedido);
  if (c.clave) return pedido;
  if (!avisoRespaldoDado) {
    avisoRespaldoDado = true;
    console.warn(
      `[embeddings] EMBEDDINGS_PROVEEDOR=${pedido} pero falta ${c.variableClave}: ` +
        `uso el modelo local Xenova/multilingual-e5-small (384 dims, sin clave).`,
    );
  }
  return "local";
}

let avisoRespaldoDado = false;

export function modeloEmbeddings(): string {
  const proveedor = proveedorEmbeddings();
  const explicito = process.env.EMBEDDINGS_MODELO?.trim();
  // El modelo explícito solo vale si no hemos caído al respaldo local.
  if (explicito && (proveedor !== "local" || proveedorPedido() === "local")) return explicito;
  switch (proveedor) {
    case "jina":
      return "jina-embeddings-v5-text-small";
    case "helmcode":
      return "qwen3-embedding";
    case "openai":
      return "text-embedding-3-small";
    default:
      return "Xenova/multilingual-e5-small";
  }
}

// ---------------------------------------------------------------------
// Estadísticas (latencias medidas, para docs y para la pantalla)
// ---------------------------------------------------------------------

export interface EstadisticasEmbeddings {
  proveedor: ProveedorEmbeddings;
  modelo: string;
  dimensiones: number;
  lotes: number;
  textos: number;
  latenciaTotalMs: number;
  latenciaMediaPorTextoMs: number;
  /** Milisegundos que costó cargar el modelo local la primera vez. */
  cargaModeloMs?: number;
  errores: number;
  ultimoError?: string;
  /** true si se está usando el respaldo local rellenado con ceros. */
  degradado: boolean;
  /** Explicación del modo degradado para enseñarla en la pantalla. */
  motivoDegradado?: string;
}

interface CacheEmbeddings {
  extractor?: unknown;
  cargando?: Promise<unknown>;
  cargaModeloMs?: number;
  estadisticas?: EstadisticasEmbeddings;
}

type ConCache = typeof globalThis & { __atalayaEmbeddings?: CacheEmbeddings };
const cache: CacheEmbeddings = ((globalThis as ConCache).__atalayaEmbeddings ??= {});

function stats(): EstadisticasEmbeddings {
  cache.estadisticas ??= {
    proveedor: proveedorEmbeddings(),
    modelo: modeloEmbeddings(),
    dimensiones: DIMENSIONES,
    lotes: 0,
    textos: 0,
    latenciaTotalMs: 0,
    latenciaMediaPorTextoMs: 0,
    errores: 0,
    degradado: false,
  };
  return cache.estadisticas;
}

export function estadisticasEmbeddings(): EstadisticasEmbeddings {
  const degradado = proveedorEmbeddings() === "local" && DIMENSIONES !== DIMENSIONES_LOCAL;
  return {
    ...stats(),
    proveedor: proveedorEmbeddings(),
    modelo: modeloEmbeddings(),
    dimensiones: DIMENSIONES,
    cargaModeloMs: cache.cargaModeloMs,
    degradado,
    motivoDegradado: degradado
      ? `Respaldo local: ${DIMENSIONES_LOCAL} dimensiones rellenadas con ceros hasta ${DIMENSIONES}. ` +
        `No son comparables con los vectores de qwen3-embedding: hay que reindexar el conocimiento.`
      : undefined,
  };
}

// ---------------------------------------------------------------------
// Proveedor local: @huggingface/transformers
// ---------------------------------------------------------------------

/** Firma mínima del pipeline de feature-extraction que usamos. */
type Extractor = (
  textos: string[],
  opciones: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

async function obtenerExtractor(): Promise<Extractor> {
  if (cache.extractor) return cache.extractor as Extractor;
  if (!cache.cargando) {
    cache.cargando = (async () => {
      const t0 = Date.now();
      // Import dinámico: el paquete es pesado (onnxruntime-node) y solo debe
      // cargarse en el servidor y cuando de verdad se necesita.
      const { pipeline } = await import("@huggingface/transformers");
      const p = await pipeline("feature-extraction", modeloEmbeddings(), { dtype: "q8" });
      cache.cargaModeloMs = Date.now() - t0;
      console.log(`[embeddings] modelo local ${modeloEmbeddings()} (q8) cargado en ${cache.cargaModeloMs} ms`);
      cache.extractor = p;
      return p;
    })();
  }
  return (await cache.cargando) as Extractor;
}

/** Descarga y carga el modelo local por adelantado (evita el coste en la primera consulta). */
export async function precalentar(): Promise<{ proveedor: ProveedorEmbeddings; cargaMs?: number }> {
  if (proveedorEmbeddings() !== "local") return { proveedor: proveedorEmbeddings() };
  await obtenerExtractor();
  return { proveedor: "local", cargaMs: cache.cargaModeloMs };
}

async function incrustarLocal(textos: string[]): Promise<number[][]> {
  const extractor = await obtenerExtractor();
  const salida = await extractor(textos, { pooling: "mean", normalize: true });
  return salida.tolist().map(ajustarDimensiones);
}

// ---------------------------------------------------------------------
// Proveedores por HTTP (compatibles con la API de OpenAI)
// ---------------------------------------------------------------------

interface ConfigHttp {
  url: string;
  clave?: string;
  variableClave: string;
  /** El proveedor admite el parámetro `dimensions`. */
  admiteDimensiones: boolean;
}

function configHttp(proveedor: Exclude<ProveedorEmbeddings, "local">): ConfigHttp {
  switch (proveedor) {
    case "jina":
      return {
        url: "https://api.jina.ai/v1/embeddings",
        clave: process.env.JINA_API_KEY?.trim(),
        variableClave: "JINA_API_KEY",
        admiteDimensiones: true,
      };
    case "helmcode":
      return {
        url: `${process.env.HELMCODE_API_BASE?.trim() || "https://api.helmcode.com/v1"}/embeddings`,
        clave: process.env.HELMCODE_API_KEY?.trim(),
        variableClave: "HELMCODE_API_KEY",
        // Se pide `dimensions: 384`; si la API lo ignora y manda 4096, se
        // trunca y renormaliza en `ajustarDimensiones`.
        admiteDimensiones: true,
      };
    case "openai":
      return {
        url: `${process.env.OPENAI_API_BASE?.trim() || "https://api.openai.com/v1"}/embeddings`,
        clave: process.env.OPENAI_API_KEY?.trim(),
        variableClave: "OPENAI_API_KEY",
        admiteDimensiones: true,
      };
  }
}

async function incrustarHttp(proveedor: Exclude<ProveedorEmbeddings, "local">, textos: string[]): Promise<number[][]> {
  const c = configHttp(proveedor);
  if (!c.clave) {
    throw new Error(
      `Sin proveedor de embeddings: falta ${c.variableClave} (EMBEDDINGS_PROVEEDOR=${proveedor}). ` +
        `Cambia a EMBEDDINGS_PROVEEDOR=local para usar el modelo en proceso, sin clave.`,
    );
  }
  const cuerpo: Record<string, unknown> = { model: modeloEmbeddings(), input: textos };
  if (c.admiteDimensiones) cuerpo.dimensions = DIMENSIONES;

  const r = await fetch(c.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.clave}` },
    body: JSON.stringify(cuerpo),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) {
    throw new Error(`Embeddings de ${proveedor}: HTTP ${r.status} · ${(await r.text()).slice(0, 300)}`);
  }
  const datos = (await r.json()) as { data?: { embedding: number[]; index?: number }[] };
  if (!datos.data?.length) throw new Error(`Embeddings de ${proveedor}: respuesta sin datos`);
  const ordenados = [...datos.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  // Si el proveedor ignora `dimensions`, se trunca a 384 y se renormaliza L2.
  return ordenados.map((d) => ajustarDimensiones(d.embedding));
}

let avisoAjusteDado = false;

/** Lleva un vector a `DIMENSIONES` truncando (Matryoshka) o rellenando con ceros, y renormaliza L2. */
function ajustarDimensiones(v: number[]): number[] {
  if (v.length === DIMENSIONES) return v;
  if (!avisoAjusteDado) {
    avisoAjusteDado = true;
    console.warn(
      `[embeddings] ${modeloEmbeddings()} devolvió ${v.length} dimensiones y la base espera ${DIMENSIONES}: ` +
        `${v.length > DIMENSIONES ? "trunco (Matryoshka)" : "relleno con ceros (modo degradado)"} y renormalizo.`,
    );
  }
  const recortado = v.slice(0, DIMENSIONES);
  while (recortado.length < DIMENSIONES) recortado.push(0);
  let norma = 0;
  for (const x of recortado) norma += x * x;
  norma = Math.sqrt(norma);
  return norma ? recortado.map((x) => x / norma) : recortado;
}

// ---------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------

const TAMANO_LOTE = Number(process.env.EMBEDDINGS_LOTE ?? 16);

/**
 * Vectores de 384 dimensiones para los textos dados, en el mismo orden.
 * Sin prefijo E5: para RAG usa `incrustarConsulta` / `incrustarPasajes`.
 */
export async function incrustar(textos: string[]): Promise<number[][]> {
  if (!textos.length) return [];
  const proveedor = proveedorEmbeddings();
  const salida: number[][] = [];
  const t0 = Date.now();
  try {
    for (let i = 0; i < textos.length; i += TAMANO_LOTE) {
      const lote = textos.slice(i, i + TAMANO_LOTE).map((t) => (t.trim() || "(vacío)").slice(0, 4000));
      const vectores = proveedor === "local" ? await incrustarLocal(lote) : await incrustarHttp(proveedor, lote);
      salida.push(...vectores);
    }
  } catch (e) {
    const s = stats();
    s.errores += 1;
    s.ultimoError = e instanceof Error ? e.message : String(e);
    anotarLlamadaIA({
      proveedor,
      modelo: modeloEmbeddings(),
      papel: "embeddings",
      latenciaMs: Date.now() - t0,
      promptResumen: `${textos.length} texto(s) a incrustar`,
      respuestaResumen: "",
      error: s.ultimoError,
    });
    throw e;
  }
  const latencia = Date.now() - t0;
  anotarLlamadaIA({
    proveedor,
    modelo: modeloEmbeddings(),
    papel: "embeddings",
    latenciaMs: latencia,
    promptResumen: `${textos.length} texto(s) a incrustar`,
    respuestaResumen: `${salida.length} vectores de ${DIMENSIONES} dimensiones`,
  });
  const s = stats();
  s.lotes += Math.ceil(textos.length / TAMANO_LOTE);
  s.textos += textos.length;
  s.latenciaTotalMs += latencia;
  s.latenciaMediaPorTextoMs = Math.round(s.latenciaTotalMs / Math.max(1, s.textos));
  console.log(`[embeddings] ${proveedor}/${modeloEmbeddings()} · ${textos.length} textos en ${latencia} ms`);

  if (salida.some((v) => v.length !== DIMENSIONES)) {
    throw new Error(
      `El modelo ${modeloEmbeddings()} devolvió vectores de ${salida[0]?.length} dimensiones; ` +
        `la base de datos espera ${DIMENSIONES} (EMBEDDINGS_DIMENSIONES).`,
    );
  }
  return salida;
}

/** Embedding de una PREGUNTA (prefijo "query: " que exige la familia E5). */
export async function incrustarConsulta(texto: string): Promise<number[]> {
  const [v] = await incrustar([conPrefijo(texto, "query")]);
  return v;
}

/** Embeddings de FRAGMENTOS de documento (prefijo "passage: "). */
export async function incrustarPasajes(textos: string[]): Promise<number[][]> {
  return incrustar(textos.map((t) => conPrefijo(t, "passage")));
}

function conPrefijo(texto: string, tipo: "query" | "passage"): string {
  // Verificado 2026-09-19: los prefijos mejoran tanto e5-small como
  // qwen3-embedding (coseno 0,76 entre pregunta y pasaje relevante).
  return `${tipo}: ${texto}`;
}

export function similitudCoseno(a: number[], b: number[]): number {
  let p = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { p += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? p / Math.sqrt(na * nb) : 0;
}
