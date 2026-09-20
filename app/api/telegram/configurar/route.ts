// POST/GET /api/telegram/configurar · Registra (o consulta) el webhook del bot
// contra la URL pública viva (túnel de Cloudflare o PUBLIC_BASE_URL). DUEÑO: constructor D.
import { urlPublica } from "@/lib/motor/entorno";
import { error, json, mensajeDeError } from "@/lib/motor/respuestas";
import { configurarWebhook, infoWebhook, secretoWebhookTelegram, telegramDisponible } from "@/lib/telegram/cliente";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!telegramDisponible()) return error("Falta TELEGRAM_BOT_TOKEN", 503);
  try {
    return json({ urlPublica: urlPublica() ?? null, webhook: await infoWebhook() });
  } catch (e) {
    return error(`No se pudo consultar el webhook: ${mensajeDeError(e)}`, 502);
  }
}

export async function POST(peticion: Request): Promise<Response> {
  if (!telegramDisponible()) return error("Falta TELEGRAM_BOT_TOKEN", 503);
  if (!secretoWebhookTelegram()) return error("Falta TELEGRAM_WEBHOOK_SECRET (sin secreto no se puede verificar quién llama al webhook)", 503);

  let base: string | undefined;
  try {
    const cuerpo = (await peticion.json()) as { url?: string };
    base = cuerpo?.url?.trim();
  } catch {
    /* sin cuerpo: se usa la URL pública del proceso */
  }
  base = base || urlPublica();
  if (!base) return error("No hay URL pública: arranca el túnel (scripts/tunel.sh) o define PUBLIC_BASE_URL", 503);
  if (!base.startsWith("https://")) return error(`Telegram exige HTTPS y la URL pública es ${base}`, 422);

  try {
    await configurarWebhook(base);
    return json({ ok: true, url: `${base.replace(/\/+$/, "")}/api/webhooks/telegram`, webhook: await infoWebhook() });
  } catch (e) {
    return error(`No se pudo registrar el webhook: ${mensajeDeError(e)}`, 502);
  }
}
