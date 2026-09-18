// Alertas de voz multilingües. Síntesis real siempre: ElevenLabs si hay clave,
// si no la voz del sistema macOS (`say` + ffmpeg, conectores/tts-local.ts).
// Traducción (en/de/fr) con el LLM real disponible (Claude u Ollama); sin LLM,
// solo el aviso en español. El mp3 va a Cloudflare R2 si hay credenciales y, si
// no, a public/audio/ (se sirve en /audio/). Sin ningún sintetizador no se
// genera nada y audiosAlerta queda vacío: nunca se finge un audio.

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AudioAlerta, Decision } from "../tipos-sistema";
import { generarEstructurado, llmDisponible } from "./conectores/llm";
import { motivoTtsLocal, sintetizarLocal, ttsLocalDisponible } from "./conectores/tts-local";

const env = (k: string) => process.env[k]?.trim() || undefined;

export const elevenlabsDisponible = () => Boolean(env("ELEVENLABS_API_KEY"));
export type ProveedorAudio = "ElevenLabs" | "macOS say";
export function proveedorAudio(): ProveedorAudio | null {
  if (elevenlabsDisponible()) return "ElevenLabs";
  if (ttsLocalDisponible()) return "macOS say";
  return null;
}
/** Hay algún sintetizador real (ElevenLabs o la voz del sistema). */
export const audioDisponible = () => proveedorAudio() !== null;
export const motivoAudio = () => (audioDisponible() ? "" : `sin ELEVENLABS_API_KEY y ${motivoTtsLocal()}`);

const r2Disponible = () => Boolean(env("R2_ACCOUNT_ID") && env("R2_ACCESS_KEY_ID") && env("R2_SECRET_ACCESS_KEY") && env("R2_BUCKET"));

const IDIOMAS: { codigo: string; nombre: string }[] = [
  { codigo: "es", nombre: "español" },
  { codigo: "en", nombre: "inglés" },
  { codigo: "de", nombre: "alemán" },
  { codigo: "fr", nombre: "francés" },
];

async function traducir(texto: string): Promise<Record<string, string>> {
  const base: Record<string, string> = { es: texto };
  if (!llmDisponible()) return base;
  try {
    const r = await generarEstructurado(z.object({ en: z.string(), de: z.string(), fr: z.string() }), {
      nivel: "ligero",
      maxTokens: 1200,
      timeoutMs: 120_000,
      user: `Traduce este aviso de emergencia municipal al inglés, alemán y francés, manteniendo nombres propios y tono oficial breve:\n\n${texto}`,
    });
    return { ...base, ...r.datos };
  } catch (err) {
    console.warn("[audio/traducir]", err instanceof Error ? err.message : err);
    return base;
  }
}

async function sintetizarElevenLabs(texto: string): Promise<Buffer> {
  const voz = env("ELEVENLABS_VOICE_ID") || "21m00Tcm4TlvDq8ikWAM";
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voz}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": env("ELEVENLABS_API_KEY")!, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text: texto, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function sintetizar(texto: string, idioma: string): Promise<{ mp3: Buffer; duracionSeg: number; voz: string }> {
  if (elevenlabsDisponible()) {
    const mp3 = await sintetizarElevenLabs(texto);
    return { mp3, duracionSeg: Math.round(mp3.length / 16000), voz: `ElevenLabs ${env("ELEVENLABS_VOICE_ID") || "Rachel"}` };
  }
  const a = await sintetizarLocal(texto, idioma);
  return { mp3: a.mp3, duracionSeg: a.duracionSeg, voz: `macOS ${a.voz}` };
}

async function almacenar(clave: string, datos: Buffer): Promise<string> {
  if (r2Disponible()) {
    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env("R2_ACCESS_KEY_ID")!, secretAccessKey: env("R2_SECRET_ACCESS_KEY")! },
    });
    await s3.send(new PutObjectCommand({ Bucket: env("R2_BUCKET")!, Key: clave, Body: datos, ContentType: "audio/mpeg" }));
    const publica = env("R2_PUBLIC_URL");
    return publica ? `${publica.replace(/\/$/, "")}/${clave}` : `r2://${env("R2_BUCKET")}/${clave}`;
  }
  const dir = path.join(process.cwd(), "public", "audio");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, path.basename(clave)), datos);
  return `/audio/${path.basename(clave)}`;
}

/** Genera los audios de alerta de una decisión aprobada. Devuelve [] si no hay ningún sintetizador. */
export async function generarAudios(d: Decision): Promise<AudioAlerta[]> {
  if (!audioDisponible()) {
    console.warn("[audio] sin sintetizador:", motivoAudio());
    return [];
  }
  const textos = await traducir(d.tarjeta.plan.mensajeAlerta);
  const out: AudioAlerta[] = [];
  for (const { codigo } of IDIOMAS) {
    const texto = textos[codigo];
    if (!texto) continue;
    try {
      const { mp3, duracionSeg, voz } = await sintetizar(texto, codigo);
      const url = await almacenar(`alertas/${d.id}-${codigo}.mp3`, mp3);
      out.push({ idioma: codigo, texto, url, destino: codigo === "es" ? "radio_efectivos" : "megafonia", duracionSeg });
      console.info(`[audio] ${codigo} sintetizado con ${voz} (${duracionSeg} s) → ${url}`);
    } catch (err) {
      console.warn(`[audio] ${codigo}:`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}
