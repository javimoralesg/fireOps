// Síntesis de voz real en local con `say` de macOS + ffmpeg → mp3. Sustituye a
// ElevenLabs cuando no hay ELEVENLABS_API_KEY. Voces del sistema por idioma
// (es Mónica, en Samantha, de Anna, fr Thomas). Sin `say` o sin ffmpeg no hay
// audio: se lanza y el llamador lo registra, nunca se finge un mp3.

import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Ejecuta sin shell y con stdin cerrado (`say` se queda esperando texto por stdin si se lo dejamos abierto). */
function run(cmd: string, args: string[], opts: { timeout: number }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const hijo = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const temporizador = setTimeout(() => hijo.kill("SIGKILL"), opts.timeout);
    hijo.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    hijo.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    hijo.on("error", (e) => {
      clearTimeout(temporizador);
      reject(e);
    });
    hijo.on("close", (codigo, senal) => {
      clearTimeout(temporizador);
      if (codigo === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(cmd)} terminó con ${senal ?? codigo}${stderr ? `: ${stderr.trim().slice(0, 200)}` : ""}`));
    });
  });
}

const PREFERIDAS: Record<string, string[]> = {
  es: ["Mónica", "Monica", "Jorge", "Marisol", "Paulina", "Juan", "Diego"],
  en: ["Samantha", "Daniel", "Karen", "Moira", "Alex"],
  de: ["Anna", "Petra", "Markus", "Yannick"],
  fr: ["Thomas", "Amélie", "Audrey", "Aurélie"],
};
const LOCALE: Record<string, string> = { es: "es_", en: "en_", de: "de_", fr: "fr_" };
// Voces de broma del sistema que no sirven para un aviso oficial.
const NOVEDAD = /^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Zarvox|Albert|Fred|Junior|Kathy|Ralph)\b/;

function bin(nombre: string): string | null {
  for (const d of ["/usr/bin", "/opt/homebrew/bin", "/usr/local/bin"]) {
    const p = path.join(d, nombre);
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      // siguiente
    }
  }
  return null;
}

type G = typeof globalThis & { __atalayaTts?: { say: string | null; ffmpeg: string | null; ffprobe: string | null; voces?: { nombre: string; locale: string }[] } };
const g = globalThis as G;
function herramientas() {
  if (!g.__atalayaTts) g.__atalayaTts = process.platform === "darwin" ? { say: bin("say"), ffmpeg: bin("ffmpeg"), ffprobe: bin("ffprobe") } : { say: null, ffmpeg: null, ffprobe: null };
  return g.__atalayaTts;
}

export function ttsLocalDisponible(): boolean {
  const h = herramientas();
  return Boolean(h.say && h.ffmpeg);
}

export function motivoTtsLocal(): string {
  if (process.platform !== "darwin") return "solo macOS (`say`)";
  const h = herramientas();
  if (!h.say) return "falta /usr/bin/say";
  if (!h.ffmpeg) return "falta ffmpeg (brew install ffmpeg)";
  return "";
}

async function voces(): Promise<{ nombre: string; locale: string }[]> {
  const h = herramientas();
  if (h.voces) return h.voces;
  const { stdout } = await run(h.say!, ["-v", "?"], { timeout: 10_000 });
  h.voces = stdout
    .split("\n")
    .map((l) => l.match(/^(.+?)\s+([a-z]{2}_[A-Z]{2})\s/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ nombre: m[1].trim(), locale: m[2] }));
  return h.voces;
}

/** Voz instalada para el idioma (es/en/de/fr); lanza si no hay ninguna. */
export async function elegirVoz(idioma: string): Promise<string> {
  const lista = await voces();
  const nombres = new Set(lista.map((v) => v.nombre));
  for (const n of PREFERIDAS[idioma] ?? []) {
    if (nombres.has(n)) return n;
    const conSufijo = lista.find((v) => v.nombre.startsWith(`${n} (`));
    if (conSufijo) return n; // `say -v Mónica` acepta el nombre corto aunque se liste con sufijo
  }
  const prefijo = LOCALE[idioma] ?? `${idioma}_`;
  const alguna = lista.find((v) => v.locale.startsWith(prefijo) && !NOVEDAD.test(v.nombre) && !v.nombre.includes("("));
  if (alguna) return alguna.nombre;
  throw new Error(`sin voz de macOS para "${idioma}"`);
}

export interface AudioLocal {
  mp3: Buffer;
  voz: string;
  duracionSeg: number;
}

/** Sintetiza `texto` con la voz del sistema y devuelve el mp3 (96 kb/s). */
export async function sintetizarLocal(texto: string, idioma: string): Promise<AudioLocal> {
  const h = herramientas();
  if (!h.say || !h.ffmpeg) throw new Error(`TTS local no disponible: ${motivoTtsLocal()}`);
  const voz = await elegirVoz(idioma);
  const dir = await mkdtemp(path.join(os.tmpdir(), "atalaya-tts-"));
  try {
    const aiff = path.join(dir, "voz.aiff");
    const mp3 = path.join(dir, "voz.mp3");
    await run(h.say, ["-v", voz, "-o", aiff, texto], { timeout: 90_000 });
    await run(h.ffmpeg, ["-y", "-loglevel", "error", "-i", aiff, "-codec:a", "libmp3lame", "-b:a", "96k", mp3], { timeout: 90_000 });
    let duracionSeg = 0;
    if (h.ffprobe) {
      const { stdout } = await run(h.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3], { timeout: 20_000 });
      duracionSeg = Math.round(parseFloat(stdout) || 0);
    }
    return { mp3: await readFile(mp3), voz, duracionSeg };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
