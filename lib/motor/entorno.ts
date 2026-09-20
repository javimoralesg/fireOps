// =====================================================================
// ATALAYA INCENDIOS · Entorno efectivo del proceso
// ---------------------------------------------------------------------
// Propósito: resolver la URL pública real de la app. En local, el móvil
// (cámara/GPS) y los webhooks de HappyRobot y Telegram necesitan HTTPS,
// así que se usa el túnel de Cloudflare que abre scripts/tunel.sh y deja
// la URL en data/url-publica.txt. Ese archivo MANDA sobre la variable de
// entorno, porque es lo que está vivo ahora mismo.
// DUEÑO: constructor A. Dependencias: ninguna (solo node:fs).
// =====================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ARCHIVO_URL = join(process.cwd(), "data", "url-publica.txt");
/** Caché corta: el túnel puede reabrirse durante la demo. */
const VIGENCIA_MS = 5000;
let cache: { en: number; valor?: string } | undefined;

function leerArchivo(): string | undefined {
  try {
    const texto = readFileSync(ARCHIVO_URL, "utf8").trim();
    return /^https?:\/\//.test(texto) ? texto.replace(/\/+$/, "") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * URL pública efectiva, sin barra final:
 *   data/url-publica.txt (túnel vivo)  >  PUBLIC_BASE_URL  >  undefined.
 * Devuelve undefined si no hay ninguna: quien la necesite debe fallar de
 * forma visible, nunca inventarse un dominio.
 */
export function urlPublica(): string | undefined {
  if (cache && Date.now() - cache.en < VIGENCIA_MS) return cache.valor;
  const deEntorno = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  const valor = leerArchivo() ?? (deEntorno || undefined);
  cache = { en: Date.now(), valor };
  return valor;
}

/** De dónde sale la URL pública (para /api/salud y la barra de estado). */
export function origenUrlPublica(): "tunel" | "variable_entorno" | "sin_configurar" {
  if (leerArchivo()) return "tunel";
  if (process.env.PUBLIC_BASE_URL?.trim()) return "variable_entorno";
  return "sin_configurar";
}
