// Protocolos de emergencia aplicables (RAG). Con QUIVER_API_KEY: QuiverAI
// (cliente genérico: POST $QUIVER_URL, Bearer, {query, top_k, collection?}).
// Sin clave: RAG local REAL sobre normativa oficial descargada del BOE
// (data/protocolos/, conectores/rag-local.ts) con embeddings de Ollama.
// Sin ninguno → null, y el proponente mantiene el protocolo que propuso el LLM.

import { buscarProtocoloLocal, ragLocalConfigurado } from "./rag-local";
import { ollamaDisponible } from "./ollama";

const URL_POR_DEFECTO = "https://api.quiver.ai/v1/query";

export type ProveedorProtocolos = "QuiverAI" | "RAG local";

export interface ProtocoloQuiver {
  codigo: string;
  nombre: string;
  extracto: string;
  fuente: ProveedorProtocolos;
  url?: string; // documento oficial (BOE) en el RAG local
  referencia?: string; // "Art. 7", "Cap. III"...
}

interface Fragmento {
  texto: string;
  score: number;
  meta: Record<string, unknown>;
}

export function quiverDisponible(): boolean {
  return Boolean(process.env.QUIVER_API_KEY);
}

/** Índice local presente y Ollama respondiendo (síncrono, con la caché del sondeo). */
export function ragLocalDisponibleSync(): boolean {
  return ragLocalConfigurado() && ollamaDisponible(process.env.OLLAMA_MODEL_EMBED || "all-minilm:l6-v2");
}

export function proveedorProtocolos(): ProveedorProtocolos | null {
  if (quiverDisponible()) return "QuiverAI";
  if (ragLocalDisponibleSync()) return "RAG local";
  return null;
}

/** Hay alguna fuente real de protocolos (QuiverAI o el RAG local). */
export const protocolosDisponibles = () => proveedorProtocolos() !== null;

function esObjeto(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function textoDe(o: Record<string, unknown>): string {
  for (const k of ["text", "content", "chunk", "texto", "contenido", "passage", "document"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim().length > 20) return v.trim();
  }
  return "";
}

function scoreDe(o: Record<string, unknown>): number {
  for (const k of ["score", "similarity", "relevance", "distance"]) {
    const v = o[k];
    if (typeof v === "number") return v;
  }
  return 0;
}

/** Recorre la respuesta buscando el primer array cuyos elementos parezcan fragmentos RAG. */
function extraerFragmentos(v: unknown, prof = 0): Fragmento[] {
  if (prof > 4 || !v || typeof v !== "object") return [];
  if (Array.isArray(v)) {
    const frags = v
      .filter(esObjeto)
      .map((o) => {
        const meta = esObjeto(o.metadata) ? o.metadata : esObjeto(o.meta) ? o.meta : {};
        return { texto: textoDe(o) || textoDe(meta), score: scoreDe(o), meta: { ...meta, ...o } };
      })
      .filter((f) => f.texto);
    if (frags.length) return frags;
    for (const x of v) {
      const r = extraerFragmentos(x, prof + 1);
      if (r.length) return r;
    }
    return [];
  }
  for (const x of Object.values(v as Record<string, unknown>)) {
    const r = extraerFragmentos(x, prof + 1);
    if (r.length) return r;
  }
  return [];
}

function cadena(meta: Record<string, unknown>, claves: string[]): string | undefined {
  for (const k of claves) {
    const v = meta[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function codigoDe(f: Fragmento): string {
  const explicito = cadena(f.meta, ["codigo", "code", "protocolo", "protocol", "ref", "referencia"]);
  if (explicito) return explicito.slice(0, 40);
  const m = f.texto.match(/\b[A-Z]{2,}[A-Z0-9]*(?:-[A-Z0-9]+){1,3}\b/);
  return m ? m[0] : "QUIVER-RAG";
}

function nombreDe(f: Fragmento): string {
  const explicito = cadena(f.meta, ["nombre", "name", "titulo", "title", "document", "documento", "source", "filename"]);
  if (explicito) return explicito.slice(0, 120);
  const linea = f.texto.split(/[\n.]/)[0]?.trim() ?? "";
  return (linea || f.texto).slice(0, 120);
}

async function consultarQuiver(descripcionIncidente: string): Promise<ProtocoloQuiver | null> {
  const clave = process.env.QUIVER_API_KEY!;
  const url = process.env.QUIVER_URL || URL_POR_DEFECTO;
  const coleccion = process.env.QUIVER_COLECCION;
  const cuerpo: Record<string, unknown> = { query: descripcionIncidente.slice(0, 500), top_k: 3 };
  if (coleccion) {
    cuerpo.collection = coleccion;
    cuerpo.collection_id = coleccion; // distintos despliegues usan un nombre u otro
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${clave}` },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`quiver ${res.status}`);
  const frags = extraerFragmentos(await res.json());
  if (!frags.length) return null;
  const mejor = [...frags].sort((a, b) => b.score - a.score)[0];
  return { codigo: codigoDe(mejor), nombre: nombreDe(mejor), extracto: mejor.texto.slice(0, 400), fuente: "QuiverAI" };
}

/** Abrevia el título oficial para usarlo como código: "Ley 17/2015", "RD 393/2007"… */
function codigoNormativa(titulo: string, referencia: string): string {
  const m = titulo.match(/\b(Ley|Real Decreto|Decreto|Orden|Resolución)\s+(\d+\/\d{4})/i);
  const norma = m ? `${/^real decreto$/i.test(m[1]) ? "RD" : m[1]} ${m[2]}` : titulo.slice(0, 30);
  return `${norma}${referencia ? ` · ${referencia}` : ""}`.slice(0, 60);
}

async function consultarRagLocal(descripcionIncidente: string): Promise<ProtocoloQuiver | null> {
  const frags = await buscarProtocoloLocal(descripcionIncidente.slice(0, 500), 3);
  if (!frags.length) return null;
  const mejor = frags[0];
  return {
    codigo: codigoNormativa(mejor.titulo, mejor.referencia),
    nombre: `${mejor.titulo}${mejor.referencia ? ` — ${mejor.referencia}` : ""}`.slice(0, 120),
    extracto: mejor.texto.slice(0, 400),
    fuente: "RAG local",
    url: mejor.url,
    referencia: mejor.referencia,
  };
}

/** Protocolo aplicable al incidente, o null si no hay ninguna fuente de protocolos o no devuelve nada. Lanza si la fuente falla. */
export async function protocoloAplicable(descripcionIncidente: string): Promise<ProtocoloQuiver | null> {
  const p = proveedorProtocolos();
  if (p === "QuiverAI") return consultarQuiver(descripcionIncidente);
  if (p === "RAG local") return consultarRagLocal(descripcionIncidente);
  return null;
}
