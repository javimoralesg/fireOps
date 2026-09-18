// Almacén de imágenes de la ingesta (poc-07). Con credenciales R2 (Cloudflare)
// la foto se sube al bucket y el evento lleva la URL pública; sin ellas se
// escribe en data/uploads/ y la sirve GET /api/ingesta/imagen/[id].
// Nunca se guardan imágenes de más de 4 MB (el móvil ya envía JPEG comprimido).

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { nuevoId } from "../estado";
import { urlPublica } from "./registro";

const DIR = path.join(process.cwd(), "data", "uploads");
export const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_DESCARGA_MS = 10_000;

const EXTENSIONES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const MIMES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export interface ImagenGuardada {
  id: string;
  url: string; // relativa (/api/ingesta/imagen/<id>) o absoluta (R2)
  urlAbsoluta: string; // siempre https?://… para que fal/Claude puedan descargarla
  bytes: number;
  mime: string;
  almacen: "R2" | "local";
}

/** ¿Hay credenciales completas de Cloudflare R2? */
export function r2Disponible(): boolean {
  return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
}

function extensionDe(mime: string): string {
  return EXTENSIONES[mime.toLowerCase()] ?? "jpg";
}

function mimeDe(extension: string): string {
  return MIMES[extension.toLowerCase()] ?? "application/octet-stream";
}

/** Quita el prefijo data:…;base64, si el cliente lo envió entero. */
export function limpiarBase64(base64: string): string {
  const i = base64.indexOf("base64,");
  return (i >= 0 ? base64.slice(i + 7) : base64).replace(/\s+/g, "");
}

async function subirAR2(id: string, datos: Buffer, mime: string): Promise<string> {
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const cliente = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  });
  const clave = `ingesta/${id}.${extensionDe(mime)}`;
  await cliente.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: clave, Body: datos, ContentType: mime, CacheControl: "public, max-age=86400" }));
  const base = (process.env.R2_PUBLIC_URL || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}`).replace(/\/$/, "");
  return `${base}/${clave}`;
}

/**
 * Guarda la imagen y devuelve dónde quedó. Si R2 falla, cae al disco local:
 * la demo nunca se queda sin imagen por un problema de credenciales.
 */
export async function guardarImagen(base64: string, mime = "image/jpeg"): Promise<ImagenGuardada> {
  const limpio = limpiarBase64(base64);
  if (!limpio) throw new Error("Imagen vacía");
  const datos = Buffer.from(limpio, "base64");
  if (!datos.length) throw new Error("Imagen no es base64 válido");
  if (datos.length > MAX_BYTES) throw new Error(`Imagen de ${(datos.length / 1024 / 1024).toFixed(1)} MB: el máximo es 4 MB`);
  const id = nuevoId("img");

  if (r2Disponible()) {
    try {
      const url = await subirAR2(id, datos, mime);
      return { id, url, urlAbsoluta: url, bytes: datos.length, mime, almacen: "R2" };
    } catch (err) {
      console.warn("[almacen/r2]", err instanceof Error ? err.message : err);
    }
  }

  await mkdir(DIR, { recursive: true });
  await writeFile(path.join(DIR, `${id}.${extensionDe(mime)}`), datos);
  const url = `/api/ingesta/imagen/${id}`;
  const { url: base } = await urlPublica();
  return { id, url, urlAbsoluta: `${base}${url}`, bytes: datos.length, mime, almacen: "local" };
}

/** Lee del disco la imagen servida por GET /api/ingesta/imagen/[id]. */
export async function leerImagen(id: string): Promise<{ datos: Buffer; mime: string } | undefined> {
  if (!/^[a-z0-9-]+$/.test(id)) return undefined;
  let ficheros: string[];
  try {
    ficheros = await readdir(DIR);
  } catch {
    return undefined;
  }
  const fichero = ficheros.find((f) => f.slice(0, f.lastIndexOf(".")) === id);
  if (!fichero) return undefined;
  try {
    const datos = await readFile(path.join(DIR, fichero));
    return { datos, mime: mimeDe(fichero.slice(fichero.lastIndexOf(".") + 1)) };
  } catch {
    return undefined;
  }
}

/** Descarga una imagen pública (cámaras de tráfico, `imagenUrl` de la observación). */
export async function descargarImagen(url: string): Promise<{ base64: string; mime: string; bytes: number }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_DESCARGA_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`La imagen ${url} respondió ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error(`La imagen ${url} vino vacía`);
  if (buffer.length > MAX_BYTES) throw new Error(`La imagen ${url} pesa más de 4 MB`);
  const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
  return { base64: buffer.toString("base64"), mime: mime.startsWith("image/") ? mime : "image/jpeg", bytes: buffer.length };
}
