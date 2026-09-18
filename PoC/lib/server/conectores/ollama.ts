// Ollama en local (http://localhost:11434): LLM real que corre en el propio Mac,
// sin clave ni red. Se usa cuando no hay ANTHROPIC_API_KEY. La salida se fuerza
// por JSON Schema (`format`), que respetan gemma3 / qwen2.5 / llama3; si el
// modelo no aplica la gramática (p. ej. qwen3.5) se reintenta con el esquema en
// el prompt y se valida con zod. Nada de aquí inventa datos: si Ollama no
// responde, se lanza un error y el llamador decide.

import { z } from "zod";

const env = (k: string) => process.env[k]?.trim() || undefined;

export const ollamaUrl = () => (env("OLLAMA_URL") || "http://localhost:11434").replace(/\/$/, "");
export const modeloOllama = () => env("OLLAMA_MODEL") || "gemma3:4b";
export const modeloVisionOllama = () => env("OLLAMA_MODEL_VISION") || modeloOllama();
export const modeloEmbedOllama = () => env("OLLAMA_MODEL_EMBED") || "all-minilm:l6-v2";

export interface SondaOllama {
  ok: boolean; // el servidor responde
  modelos: string[]; // modelos descargados
  en: number; // epoch ms del sondeo
}

type G = typeof globalThis & { __atalayaOllama?: SondaOllama; __atalayaOllamaSonda?: Promise<SondaOllama>; __atalayaOllamaCalientes?: Set<string> };
const g = globalThis as G;
const TTL_MS = 20_000;

/** Consulta /api/tags (1,5 s de tope) y cachea el resultado 20 s. Sobrevive al HMR de Next vía globalThis. */
export async function sondearOllama(forzar = false): Promise<SondaOllama> {
  const c = g.__atalayaOllama;
  if (!forzar && c && Date.now() - c.en < TTL_MS) return c;
  if (g.__atalayaOllamaSonda) return g.__atalayaOllamaSonda;
  g.__atalayaOllamaSonda = (async () => {
    let s: SondaOllama = { ok: false, modelos: [], en: Date.now() };
    try {
      const r = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as { models?: { name: string }[] };
        s = { ok: true, modelos: (j.models ?? []).map((m) => m.name), en: Date.now() };
      }
    } catch {
      // no responde: queda ok=false hasta el siguiente sondeo
    }
    g.__atalayaOllama = s;
    g.__atalayaOllamaSonda = undefined;
    if (s.ok && tieneModelo(s, modeloOllama())) void calentar(modeloOllama());
    return s;
  })();
  return g.__atalayaOllamaSonda;
}

const KEEP_ALIVE = "2h";

/**
 * Carga el modelo en memoria fuera de cualquier petición del motor (una vez por
 * modelo): así los timeouts cortos del router no cancelan la carga a medias.
 */
export async function calentar(modelo: string): Promise<void> {
  g.__atalayaOllamaCalientes ??= new Set<string>();
  if (g.__atalayaOllamaCalientes.has(modelo)) return;
  g.__atalayaOllamaCalientes.add(modelo);
  try {
    await fetch(`${ollamaUrl()}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: modelo, keep_alive: KEEP_ALIVE }),
      signal: AbortSignal.timeout(600_000),
      cache: "no-store",
    });
    console.info(`[ollama] modelo ${modelo} cargado en memoria`);
  } catch (e) {
    g.__atalayaOllamaCalientes.delete(modelo);
    console.warn(`[ollama] no se pudo precargar ${modelo}:`, e instanceof Error ? e.message : e);
  }
}

// Una sola petición de generación a la vez: con varias en paralelo el Mac se
// ahoga y todas acaban en timeout. El router pregunta ollamaOcupado() y, si lo
// está, no espera (no registra clasificación para ese evento).
let enCurso: Promise<unknown> | null = null;
export const ollamaOcupado = () => enCurso !== null;
async function enCola<T>(f: () => Promise<T>): Promise<T> {
  while (enCurso) await enCurso.catch(() => undefined);
  const p = f();
  enCurso = p;
  try {
    return await p;
  } finally {
    if (enCurso === p) enCurso = null;
  }
}

function tieneModelo(s: SondaOllama, nombre: string): boolean {
  const n = nombre.includes(":") ? nombre : `${nombre}:latest`;
  return s.modelos.includes(n);
}

/** Síncrono: último sondeo. Si caducó, dispara otro en segundo plano. Exige que el modelo configurado esté descargado. */
export function ollamaDisponible(modelo = modeloOllama()): boolean {
  const c = g.__atalayaOllama;
  if (!c || Date.now() - c.en >= TTL_MS) void sondearOllama();
  return Boolean(c?.ok && tieneModelo(c, modelo));
}

/** Motivo legible cuando no está disponible (para el panel de servicios). */
export function motivoOllama(): string | null {
  const c = g.__atalayaOllama;
  if (!c) return "sin sondear";
  if (!c.ok) return `Ollama no responde en ${ollamaUrl()}`;
  if (!tieneModelo(c, modeloOllama())) return `modelo ${modeloOllama()} no descargado (ollama pull ${modeloOllama()})`;
  return null;
}

void sondearOllama();

export interface OpcionesChat {
  system?: string;
  user: string;
  imagenes?: string[]; // base64 sin prefijo data:
  modelo?: string;
  temperatura?: number;
  maxTokens?: number;
  timeoutMs?: number;
  numCtx?: number; // solo si hace falta: cambiar el contexto obliga a recargar el modelo
}

interface RespuestaChat {
  message?: { content?: string };
  error?: string;
}

// Modelos con "modo pensar": se desactiva para que la respuesta sea solo el JSON.
const piensa = (m: string) => /qwen3|deepseek-r1|gpt-oss|magistral/i.test(m);

async function chat(o: OpcionesChat, format: unknown): Promise<string> {
  const modelo = o.modelo || modeloOllama();
  const body: Record<string, unknown> = {
    model: modelo,
    stream: false,
    format,
    keep_alive: KEEP_ALIVE,
    options: { temperature: o.temperatura ?? 0.2, num_predict: o.maxTokens ?? 1500, ...(o.numCtx ? { num_ctx: o.numCtx } : {}) },
    messages: [
      ...(o.system ? [{ role: "system", content: o.system }] : []),
      { role: "user", content: o.user, ...(o.imagenes?.length ? { images: o.imagenes } : {}) },
    ],
  };
  if (piensa(modelo)) body.think = false;
  const r = await fetch(`${ollamaUrl()}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(o.timeoutMs ?? 180_000),
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as RespuestaChat;
  if (!r.ok || j.error) throw new Error(`ollama ${r.status}${j.error ? `: ${j.error}` : ""}`);
  return j.message?.content ?? "";
}

/** Primer objeto {...} del texto (por si el modelo envuelve el JSON en prosa o ```json). */
function extraerJson(texto: string): unknown {
  const i = texto.indexOf("{");
  const f = texto.lastIndexOf("}");
  if (i < 0 || f <= i) return undefined;
  try {
    return JSON.parse(texto.slice(i, f + 1));
  } catch {
    return undefined;
  }
}

/** Chat con salida validada por un esquema zod. Lanza si Ollama no responde o la salida no cumple el esquema tras dos intentos. */
export async function chatJson<T>(schema: z.ZodType<T>, o: OpcionesChat): Promise<{ datos: T; modelo: string; latenciaMs: number }> {
  const t0 = Date.now();
  const modelo = o.modelo || modeloOllama();
  const js = z.toJSONSchema(schema);
  let texto = await enCola(() => chat({ ...o, modelo }, js));
  let r = schema.safeParse(extraerJson(texto));
  if (!r.success) {
    const user = `${o.user}\n\nResponde ÚNICAMENTE con un objeto JSON válido que cumpla exactamente este JSON Schema (mismos nombres de campo, sin campos extra, sin comentarios):\n${JSON.stringify(js)}`;
    texto = await enCola(() => chat({ ...o, modelo, user }, "json"));
    r = schema.safeParse(extraerJson(texto));
    if (!r.success) {
      const p = r.error.issues[0];
      throw new Error(`ollama ${modelo}: salida no válida (${p?.path.join(".") || "raíz"}: ${p?.message ?? "?"})`);
    }
  }
  return { datos: r.data, modelo, latenciaMs: Date.now() - t0 };
}

/** Embeddings reales (all-minilm por defecto, 384 dims). */
export async function embeber(textos: string[], modelo = modeloEmbedOllama()): Promise<number[][]> {
  const r = await fetch(`${ollamaUrl()}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: modelo, input: textos }),
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as { embeddings?: number[][]; error?: string };
  if (!r.ok || j.error || !j.embeddings) throw new Error(`ollama embed ${r.status}${j.error ? `: ${j.error}` : ""}`);
  return j.embeddings;
}
