// Punto único de acceso al LLM. Siempre real: Claude (ANTHROPIC_API_KEY) y, si no
// hay clave o la API falla, Ollama en el propio Mac. Sin ningún proveedor NO hay
// plantillas ni respuestas fingidas: se lanza un error y el llamador lo muestra.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { chatJson, modeloOllama, modeloVisionOllama, motivoOllama, ollamaDisponible, ollamaOcupado, sondearOllama } from "./ollama";

export type ProveedorLLM = "anthropic" | "ollama";
export type NivelLLM = "ligero" | "plan" | "vision";

export interface ImagenLLM {
  base64: string;
  mime: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

export interface PeticionLLM {
  system?: string;
  user: string;
  nivel?: NivelLLM; // ligero = clasificar/traducir; plan = razonar; vision = con imagen
  imagenes?: ImagenLLM[];
  maxTokens?: number;
  timeoutMs?: number;
  temperatura?: number;
  effort?: "low" | "medium" | "high";
}

export interface RespuestaLLM<T> {
  datos: T;
  modelo: string;
  proveedor: ProveedorLLM;
  latenciaMs: number;
}

const env = (k: string) => process.env[k]?.trim() || undefined;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const anthropicDisponible = () => Boolean(env("ANTHROPIC_API_KEY"));

/** Proveedor que se usará ahora mismo (null = ninguno). */
export function proveedorLLM(): ProveedorLLM | null {
  if (anthropicDisponible()) return "anthropic";
  if (ollamaDisponible()) return "ollama";
  return null;
}

export const llmDisponible = () => proveedorLLM() !== null;

/** El LLM local está atendiendo otra petición (Claude no tiene cola). Sirve para no bloquear al motor. */
export const llmOcupado = () => proveedorLLM() === "ollama" && ollamaOcupado();

// Tiempos máximos por defecto: cortos en tareas ligeras para no bloquear el motor
// (poc-55: la clasificación por evento corre dentro del bloqueo del estado).
const TIMEOUT_MS: Record<NivelLLM, number> = { ligero: 10_000, plan: 300_000, vision: 120_000 };
const timeoutDe = (p: PeticionLLM) => p.timeoutMs ?? TIMEOUT_MS[p.nivel ?? "plan"];

export function modeloLLM(nivel: NivelLLM = "plan", proveedor: ProveedorLLM | null = proveedorLLM()): string {
  if (proveedor === "anthropic") return nivel === "ligero" ? env("CLAUDE_MODEL_LIGERO") || "claude-haiku-4-5" : env("CLAUDE_MODEL") || "claude-opus-5";
  if (proveedor === "ollama") return nivel === "vision" ? modeloVisionOllama() : modeloOllama();
  return "sin-llm";
}

/** Texto para el panel de servicios: qué IA está respondiendo de verdad. */
export function describirLLM(): { proveedor: ProveedorLLM | null; modelo: string; detalle: string } {
  const p = proveedorLLM();
  if (p === "anthropic") return { proveedor: p, modelo: modeloLLM("plan", p), detalle: `Claude API · ${modeloLLM("plan", p)} (plan) · ${modeloLLM("ligero", p)} (router)` };
  if (p === "ollama") return { proveedor: p, modelo: modeloLLM("plan", p), detalle: `Ollama local · ${modeloOllama()}${modeloVisionOllama() !== modeloOllama() ? ` · visión ${modeloVisionOllama()}` : ""}` };
  return { proveedor: null, modelo: "sin-llm", detalle: motivoOllama() ?? "sin ANTHROPIC_API_KEY y sin Ollama" };
}

async function conAnthropic<T>(schema: z.ZodType<T>, p: PeticionLLM): Promise<RespuestaLLM<T>> {
  const t0 = Date.now();
  const modelo = modeloLLM(p.nivel ?? "plan", "anthropic");
  const client = new Anthropic({ timeout: timeoutDe(p), maxRetries: 1 });
  const content: Anthropic.MessageParam["content"] = p.imagenes?.length
    ? [
        ...p.imagenes.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.mime, data: i.base64 } })),
        { type: "text" as const, text: p.user },
      ]
    : p.user;
  const res = await client.messages.parse({
    model: modelo,
    max_tokens: p.maxTokens ?? 2000,
    ...(p.temperatura !== undefined ? { temperature: p.temperatura } : {}),
    output_config: { ...(p.effort ? { effort: p.effort } : {}), format: zodOutputFormat(schema) },
    ...(p.system ? { system: [{ type: "text" as const, text: p.system, cache_control: { type: "ephemeral" as const } }] } : {}),
    messages: [{ role: "user", content }],
  });
  const datos = res.parsed_output;
  if (!datos) throw new Error(`sin salida estructurada (stop_reason ${res.stop_reason})`);
  return { datos, modelo, proveedor: "anthropic", latenciaMs: Date.now() - t0 };
}

async function conOllama<T>(schema: z.ZodType<T>, p: PeticionLLM): Promise<RespuestaLLM<T>> {
  const r = await chatJson(schema, {
    system: p.system,
    user: p.user,
    imagenes: p.imagenes?.map((i) => i.base64),
    modelo: modeloLLM(p.nivel ?? "plan", "ollama"),
    temperatura: p.temperatura,
    maxTokens: p.maxTokens,
    timeoutMs: timeoutDe(p),
  });
  return { ...r, proveedor: "ollama" };
}

/**
 * Genera una salida validada por `schema`. Orden: Claude → Ollama. Si ningún
 * proveedor responde, lanza (el llamador NO debe sustituirlo por datos ficticios).
 */
export async function generarEstructurado<T>(schema: z.ZodType<T>, p: PeticionLLM): Promise<RespuestaLLM<T>> {
  const errores: string[] = [];
  if (anthropicDisponible()) {
    try {
      return await conAnthropic(schema, p);
    } catch (e) {
      errores.push(`Claude: ${msg(e)}`);
      console.warn("[llm] Claude falló, pruebo Ollama:", msg(e));
    }
  }
  if (ollamaDisponible() || (await sondearOllama(true)).ok) {
    try {
      return await conOllama(schema, p);
    } catch (e) {
      errores.push(`Ollama: ${msg(e)}`);
    }
  } else {
    errores.push(`Ollama: ${motivoOllama() ?? "no disponible"}`);
  }
  throw new Error(`Sin LLM real disponible — ${errores.join(" · ")}`);
}
