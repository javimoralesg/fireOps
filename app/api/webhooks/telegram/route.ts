// POST /api/webhooks/telegram · Updates del bot de Telegram (Bot API).
// El ciudadano escribe, comparte su ubicación o manda una foto; se registra como
// Observacion por la centralita (B) y se le responde con acuse y consejo real.
// DUEÑO: constructor D. Seguridad: cabecera X-Telegram-Bot-Api-Secret-Token.
import type { Punto } from "@/lib/dominio/tipos";
import { error, json } from "@/lib/motor/respuestas";
import { enviarMensaje, obtenerArchivo, verificarWebhookTelegram } from "@/lib/telegram/cliente";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MensajeTelegram {
  message_id: number;
  chat: { id: number; first_name?: string; username?: string };
  from?: { first_name?: string; username?: string };
  text?: string;
  caption?: string;
  location?: { latitude: number; longitude: number };
  photo?: { file_id: string; file_size?: number; width?: number }[];
}

const AYUDA =
  "Soy el bot de Atalaya, la sala de coordinación de incendios forestales.\n\n" +
  "Cuéntame qué ves (humo, llamas, dónde) y lo paso a la sala al momento.\n" +
  "• Comparte tu ubicación con el clip 📎 → Ubicación: así sé exactamente dónde.\n" +
  "• Puedes mandarme una foto con una descripción.\n\n" +
  "Si hay personas en peligro, llama antes al 112.";

export async function POST(peticion: Request): Promise<Response> {
  if (!verificarWebhookTelegram(peticion.headers)) return error("Cabecera X-Telegram-Bot-Api-Secret-Token ausente o incorrecta", 401);

  let update: { message?: MensajeTelegram; edited_message?: MensajeTelegram };
  try {
    update = (await peticion.json()) as typeof update;
  } catch {
    return error("El cuerpo debe ser JSON", 400);
  }

  const mensaje = update.message ?? update.edited_message;
  // Telegram reintenta si no respondemos 200: cualquier update que no sepamos
  // tratar se reconoce igualmente para que no entre en bucle.
  if (!mensaje?.chat?.id) return json({ ok: true, ignorado: "update sin mensaje" });

  const chatId = String(mensaje.chat.id);
  const texto = (mensaje.text ?? mensaje.caption ?? "").trim();
  const punto: Punto | undefined = mensaje.location ? { lat: mensaje.location.latitude, lon: mensaje.location.longitude } : undefined;

  if (texto.startsWith("/start") || texto.startsWith("/ayuda") || texto.startsWith("/help")) {
    try {
      await enviarMensaje(chatId, AYUDA);
    } catch {
      /* si el envío falla, el update igual queda reconocido */
    }
    return json({ ok: true, respondido: "ayuda" });
  }

  // Una foto sin texto también es un aviso: se anota y se analiza aparte.
  let nota = "";
  if (mensaje.photo?.length) {
    const mayor = mensaje.photo[mensaje.photo.length - 1];
    try {
      const archivo = await obtenerArchivo(mayor.file_id);
      nota = `\n\n[Adjunta una foto de ${Math.round(archivo.bytes / 1024)} KB tomada con el móvil.]`;
    } catch {
      nota = "\n\n[Adjunta una foto que no se ha podido descargar.]";
    }
  }

  const cuerpo =
    texto || punto
      ? `${texto || "(sin texto)"}${punto ? `\n\nUbicación compartida: ${punto.lat.toFixed(5)}, ${punto.lon.toFixed(5)}` : ""}${nota}`
      : "";

  if (!cuerpo) {
    try {
      await enviarMensaje(chatId, AYUDA);
    } catch {
      /* ignorado */
    }
    return json({ ok: true, respondido: "ayuda" });
  }

  let observacionId: string | undefined;
  let fallo: string | undefined;
  try {
    const { procesarEntrada } = await import("@/lib/agentes/percepcion/centralita");
    const observacion = await procesarEntrada({
      canal: "telegram",
      texto: cuerpo,
      remitente: String(chatId),
      referenciaExterna: String(mensaje.message_id),
      punto,
    });
    observacionId = observacion.id;
  } catch (e) {
    fallo = e instanceof Error ? e.message : String(e);
  }

  // Acuse con consejo REAL: qué incendios hay cerca de donde está.
  let respuesta = fallo
    ? `He recibido tu aviso, pero ha habido un problema al registrarlo (${fallo}). Si es urgente, llama al 112.`
    : "✅ Aviso recibido. Lo está revisando la sala de coordinación.";
  try {
    const { contextoParaVoz } = await import("@/lib/agentes/percepcion/centralita");
    const contexto = await contextoParaVoz(punto ?? texto);
    respuesta += `\n\n${contexto.consejoGeneral}`;
    if (!punto) respuesta += "\n\nSi puedes, compárteme tu ubicación con el clip 📎 → Ubicación: así los medios saben dónde ir.";
  } catch {
    /* sin contexto, el acuse ya vale */
  }

  try {
    await enviarMensaje(chatId, respuesta);
  } catch {
    /* el aviso ya está registrado aunque no podamos contestar */
  }

  return json({ ok: true, observacionId: observacionId ?? null, error: fallo ?? null });
}
