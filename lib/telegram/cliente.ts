// =====================================================================
// ATALAYA INCENDIOS · Cliente de Telegram (Bot API)
// ---------------------------------------------------------------------
// Propósito: canal ciudadano bidireccional real y gratuito (no necesita
// Meta Business como WhatsApp): el vecino escribe al bot, comparte su
// ubicación o una foto, y Atalaya le contesta; los agentes le mandan
// avisos y comunicados. DUEÑO: constructor D.
// Dependencias externas: https://core.telegram.org/bots/api
//
// Variables: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID_DEMO, TELEGRAM_WEBHOOK_SECRET.
// Sin token, todo lanza con el nombre exacto de la variable que falta.
// =====================================================================

const TIMEOUT_MS = 15_000;
const variable = (clave: string): string | undefined => process.env[clave]?.trim() || undefined;

export const tokenBot = (): string | undefined => variable("TELEGRAM_BOT_TOKEN");
export const chatDemo = (): string | undefined => variable("TELEGRAM_CHAT_ID_DEMO");
export const secretoWebhookTelegram = (): string | undefined => variable("TELEGRAM_WEBHOOK_SECRET");

/** ¿Está el bot configurado? */
export const telegramDisponible = (): boolean => Boolean(tokenBot());

export function estadoTelegram(): { ok: boolean; detalle: string } {
  if (!tokenBot()) return { ok: false, detalle: "Telegram: falta TELEGRAM_BOT_TOKEN" };
  if (!chatDemo()) return { ok: true, detalle: "Bot configurado (sin TELEGRAM_CHAT_ID_DEMO: solo responde a quien escriba)" };
  return { ok: true, detalle: `Bot configurado · chat de demo ${chatDemo()}` };
}

const base = (): string => {
  const t = tokenBot();
  if (!t) throw new Error("Falta TELEGRAM_BOT_TOKEN");
  return `https://api.telegram.org/bot${t}`;
};

export interface LlamadaTrazada<T> {
  resultado: T;
  /** AUDITORÍA: cuerpo enviado (el token va en la URL, nunca en el cuerpo). */
  peticion: Record<string, unknown>;
  /** AUDITORÍA: respuesta cruda de la Bot API, recortada a 2 KB. */
  respuesta: string;
  duracionMs: number;
}

async function llamarApiTrazado<T>(metodo: string, cuerpo: Record<string, unknown>, signal?: AbortSignal): Promise<LlamadaTrazada<T>> {
  const t0 = Date.now();
  const res = await fetch(`${base()}/${metodo}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
  });
  const texto = await res.text();
  const duracionMs = Date.now() - t0;
  let j: { ok?: boolean; result?: T; description?: string };
  try {
    j = JSON.parse(texto) as { ok?: boolean; result?: T; description?: string };
  } catch {
    throw new Error(`Telegram ${metodo}: respuesta no JSON (${texto.slice(0, 120)})`);
  }
  if (!res.ok || !j.ok) throw new Error(`Telegram ${metodo} ${res.status}: ${j.description ?? texto.slice(0, 160)}`);
  return { resultado: j.result as T, peticion: cuerpo, respuesta: texto.slice(0, 2048), duracionMs };
}

async function llamarApi<T>(metodo: string, cuerpo: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  return (await llamarApiTrazado<T>(metodo, cuerpo, signal)).resultado;
}

export interface MensajeEnviado {
  message_id: number;
  chat: { id: number };
  date: number;
}

/** Envía un mensaje de texto a un chat. */
export function enviarMensaje(chatId: string | number, texto: string, opciones: { parseMode?: "HTML" | "Markdown" } = {}): Promise<MensajeEnviado> {
  return llamarApi<MensajeEnviado>("sendMessage", {
    chat_id: chatId,
    text: texto.slice(0, 4000),
    parse_mode: opciones.parseMode,
    disable_web_page_preview: true,
  });
}

/** Igual que `enviarMensaje` pero devolviendo la traza completa para el acta de la acción. */
export function enviarMensajeTrazado(chatId: string | number, texto: string, opciones: { parseMode?: "HTML" | "Markdown" } = {}): Promise<LlamadaTrazada<MensajeEnviado>> {
  return llamarApiTrazado<MensajeEnviado>("sendMessage", {
    chat_id: chatId,
    text: texto.slice(0, 4000),
    parse_mode: opciones.parseMode,
    disable_web_page_preview: true,
  });
}

/** Envía una ubicación (para señalar el foco o el punto de encuentro). */
export function enviarUbicacion(chatId: string | number, lat: number, lon: number): Promise<MensajeEnviado> {
  return llamarApi<MensajeEnviado>("sendLocation", { chat_id: chatId, latitude: lat, longitude: lon });
}

/** Registra el webhook del bot con el secreto que después verificamos en cada update. */
export function configurarWebhook(urlPublicaBase: string): Promise<boolean> {
  const url = `${urlPublicaBase.replace(/\/+$/, "")}/api/webhooks/telegram`;
  return llamarApi<boolean>("setWebhook", {
    url,
    secret_token: secretoWebhookTelegram(),
    allowed_updates: ["message", "edited_message"],
    drop_pending_updates: true,
  });
}

export interface InfoWebhook {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_message?: string;
}

export function infoWebhook(): Promise<InfoWebhook> {
  return llamarApi<InfoWebhook>("getWebhookInfo", {});
}

/** Verifica la cabecera X-Telegram-Bot-Api-Secret-Token de un update entrante. */
export function verificarWebhookTelegram(cabeceras: Headers): boolean {
  const esperado = secretoWebhookTelegram();
  if (!esperado) return false;
  return cabeceras.get("x-telegram-bot-api-secret-token")?.trim() === esperado;
}

/**
 * Descarga un archivo del bot (foto del ciudadano) y lo devuelve en base64
 * para que el analista de visión lo mire. Dos pasos: getFile → /file/bot<token>/<path>.
 */
export async function obtenerArchivo(fileId: string, signal?: AbortSignal): Promise<{ base64: string; mime: string; bytes: number }> {
  const info = await llamarApi<{ file_path?: string }>("getFile", { file_id: fileId }, signal);
  if (!info.file_path) throw new Error("Telegram getFile no devolvió file_path");
  const res = await fetch(`https://api.telegram.org/file/bot${tokenBot()}/${info.file_path}`, {
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Telegram descarga de archivo ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type") ?? (info.file_path.endsWith(".png") ? "image/png" : "image/jpeg");
  return { base64: buffer.toString("base64"), mime, bytes: buffer.length };
}
