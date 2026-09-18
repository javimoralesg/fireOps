// Visión por computador sobre la foto adjunta a un aviso. Proveedores reales, en
// este orden: fal.ai (FAL_KEY; endpoint síncrono fal.run/<modelo> con
// image_url + prompt → texto), y si no hay clave, el LLM multimodal disponible
// (Claude con ANTHROPIC_API_KEY u Ollama en local, p. ej. gemma3). Sin ninguno,
// visionDisponible() es false y el router no analiza: nunca se inventa una clase.

import { z } from "zod";
import { descargarImagen } from "../perifericos/almacen";
import { generarEstructurado, llmDisponible, modeloLLM, proveedorLLM, type ImagenLLM } from "./llm";

const MODELO_POR_DEFECTO = "fal-ai/moondream2/visual-query";

const PROMPT = [
  "Eres un analista de emergencias. Observa la imagen y responde SOLO con JSON válido, sin texto adicional,",
  'con esta forma: {"descripcion":"<una frase en español>","clases":[{"etiqueta":"fire","confianza":0.96}],',
  '"fuego":true,"humo":true,"personas":false}.',
  "Las etiquetas deben estar en inglés (fire, smoke, people, vehicle, building, water...) y la confianza entre 0 y 1.",
].join(" ");

export interface ClaseVision {
  etiqueta: string;
  confianza: number;
}

export interface AnalisisImagen {
  clases: ClaseVision[];
  descripcion: string;
  fuegoDetectado: boolean;
  humoDetectado: boolean;
  personasVisibles: boolean;
  latenciaMs: number;
  modelo: string; // proveedor/modelo que analizó de verdad la imagen
}

export type ProveedorVision = "fal.ai" | "claude" | "ollama";

export function falDisponible(): boolean {
  return Boolean(process.env.FAL_KEY);
}

/** Ruta del modelo de fal usada (sirve también como nombre en `procesadoPor.modelo`). */
export function modeloFal(): string {
  return process.env.FAL_MODELO || MODELO_POR_DEFECTO;
}

export function proveedorVision(): ProveedorVision | null {
  if (falDisponible()) return "fal.ai";
  const p = proveedorLLM();
  return p === "anthropic" ? "claude" : p === "ollama" ? "ollama" : null;
}

export const visionDisponible = () => proveedorVision() !== null;

/** Nombre del modelo de visión activo, para la traza. */
export function modeloVision(): string {
  const p = proveedorVision();
  if (p === "fal.ai") return modeloFal();
  if (p === "claude") return modeloLLM("ligero", "anthropic");
  if (p === "ollama") return `ollama/${modeloLLM("vision", "ollama")}`;
  return "sin-vision";
}

/** Saca el texto del modelo sea cual sea la forma de la respuesta de fal. */
function textoDeRespuesta(j: unknown): string {
  if (typeof j === "string") return j;
  if (!j || typeof j !== "object") return "";
  const o = j as Record<string, unknown>;
  for (const k of ["output", "text", "answer", "response", "result", "caption"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  if (o.data) return textoDeRespuesta(o.data);
  return "";
}

/** Primer bloque {...} del texto, por si el modelo envuelve el JSON en prosa o ```json. */
function extraerJson(texto: string): Record<string, unknown> | null {
  const i = texto.indexOf("{");
  const f = texto.lastIndexOf("}");
  if (i < 0 || f <= i) return null;
  try {
    const o = JSON.parse(texto.slice(i, f + 1));
    return o && typeof o === "object" ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "si", "sí", "yes", "1"].includes(s)) return true;
    if (["false", "no", "0"].includes(s)) return false;
  }
  return undefined;
}

function clasesDe(v: unknown): ClaseVision[] {
  if (!Array.isArray(v)) return [];
  const out: ClaseVision[] = [];
  for (const c of v) {
    if (typeof c === "string") {
      out.push({ etiqueta: c, confianza: 0.8 });
      continue;
    }
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const etiqueta = o.etiqueta ?? o.label ?? o.class ?? o.name;
    if (typeof etiqueta !== "string" || !etiqueta.trim()) continue;
    const bruto = o.confianza ?? o.confidence ?? o.score ?? 0.8;
    const confianza = typeof bruto === "number" ? Math.min(1, Math.max(0, bruto)) : 0.8;
    out.push({ etiqueta: etiqueta.trim(), confianza });
  }
  return out.slice(0, 6);
}

/** Palabras clave por si el modelo no devolvió JSON. */
function detectar(texto: string, palabras: string[]): boolean {
  const t = texto.toLowerCase();
  return palabras.some((p) => t.includes(p));
}

async function analizarConFal(imagenUrl: string): Promise<AnalisisImagen> {
  const clave = process.env.FAL_KEY;
  if (!clave) throw new Error("fal sin clave");
  const t0 = Date.now();
  const res = await fetch(`https://fal.run/${modeloFal()}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Key ${clave}` },
    body: JSON.stringify({ image_url: imagenUrl, prompt: PROMPT }),
    signal: AbortSignal.timeout(25_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`fal ${res.status}`);
  const texto = textoDeRespuesta(await res.json());
  const latenciaMs = Date.now() - t0;
  if (!texto.trim()) throw new Error("fal sin texto");

  const j = extraerJson(texto);
  const descripcion = (typeof j?.descripcion === "string" && j.descripcion) || (typeof j?.description === "string" && j.description) || texto.slice(0, 240);
  let clases = clasesDe(j?.clases ?? j?.classes ?? j?.labels);

  const fuegoDetectado = bool(j?.fuego ?? j?.fire) ?? detectar(texto, ["fire", "flame", "fuego", "llama", "incendi"]);
  const humoDetectado = bool(j?.humo ?? j?.smoke) ?? detectar(texto, ["smoke", "humo", "smoky"]);
  const personasVisibles = bool(j?.personas ?? j?.people ?? j?.persons) ?? detectar(texto, ["people", "person", "persona", "gente", "crowd", "human"]);

  if (!clases.length) {
    // Sin lista explícita, derivamos las clases de los booleanos para que la UI muestre algo útil.
    clases = [
      fuegoDetectado ? { etiqueta: "fire", confianza: 0.9 } : null,
      humoDetectado ? { etiqueta: "smoke", confianza: 0.88 } : null,
      personasVisibles ? { etiqueta: "people", confianza: 0.75 } : null,
    ].filter((c): c is ClaseVision => c !== null);
  }

  return { clases, descripcion: descripcion.trim(), fuegoDetectado, humoDetectado, personasVisibles, latenciaMs, modelo: modeloFal() };
}

const MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Carga la imagen en base64 para el LLM: data-URI o URL http(s) pública. */
async function cargarImagen(url: string): Promise<ImagenLLM> {
  const m = url.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (m) {
    const mime = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase();
    if (!MIMES.has(mime)) throw new Error(`formato ${mime} no admitido`);
    return { base64: m[2], mime: mime as ImagenLLM["mime"] };
  }
  if (!/^https?:\/\//i.test(url)) throw new Error(`la visión del router solo analiza URLs públicas (${url})`);
  const d = await descargarImagen(url);
  const mime = d.mime === "image/jpg" ? "image/jpeg" : d.mime;
  if (!MIMES.has(mime)) throw new Error(`formato ${mime} no admitido`);
  return { base64: d.base64, mime: mime as ImagenLLM["mime"] };
}

const EsquemaVision = z.object({
  descripcion: z.string(),
  clases: z.array(z.object({ etiqueta: z.string(), confianza: z.number() })),
  fuego: z.boolean(),
  humo: z.boolean(),
  personas: z.boolean(),
});

async function analizarConLLM(imagenUrl: string): Promise<AnalisisImagen> {
  const imagen = await cargarImagen(imagenUrl);
  const r = await generarEstructurado(EsquemaVision, {
    nivel: "vision",
    imagenes: [imagen],
    maxTokens: 500,
    timeoutMs: 180_000,
    user: "Eres un analista de emergencias. Describe la imagen en una frase en español e indica si hay fuego, humo o personas. Clases en inglés (fire, smoke, people, vehicle, building, water, road...) con confianza entre 0 y 1; incluye solo lo que se ve.",
  });
  const d = r.datos;
  return {
    clases: clasesDe(d.clases),
    descripcion: d.descripcion.trim(),
    fuegoDetectado: d.fuego,
    humoDetectado: d.humo,
    personasVisibles: d.personas,
    latenciaMs: r.latenciaMs,
    modelo: r.proveedor === "anthropic" ? r.modelo : `ollama/${r.modelo}`,
  };
}

/** Analiza la imagen con el proveedor real disponible; lanza si no hay ninguno o falla. */
export async function analizarImagen(imagenUrl: string): Promise<AnalisisImagen> {
  if (falDisponible()) return analizarConFal(imagenUrl);
  if (llmDisponible()) return analizarConLLM(imagenUrl);
  throw new Error("sin proveedor de visión (FAL_KEY, ANTHROPIC_API_KEY u Ollama)");
}

/** "Visión: fire (0.96), smoke (0.88)" para anexar al detalle del evento. */
export function resumenClases(clases: ClaseVision[]): string {
  return clases.map((c) => `${c.etiqueta} (${c.confianza.toFixed(2)})`).join(", ");
}
