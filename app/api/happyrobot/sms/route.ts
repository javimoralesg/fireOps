// POST /api/happyrobot/sms · Herramienta «enviar_sms» del agente de voz del 112 virtual
// (workflow «Atalaya · 112 entrante»). El nodo Webhook de la herramienta manda el texto
// que el agente decide transmitir (personas atrapadas, cambio de situación, mensaje que
// pide la persona) con la cabecera x-webhook-secret; aquí sale por el workflow de SMS
// de HappyRobot al teléfono de TELEFONO_AVISOS_SMS (o DESTINO_DEMO) y se devuelve al
// agente qué decir (`mensajeParaLocutor`). El agente NO elige el número.
// Responde SIEMPRE 200 con las cinco claves (enviado, referencia, destino, error, mensajeParaLocutor).
// GET · estado del canal y últimos SMS del agente (para la sala y para depurar).
// DUEÑO: sesión fireops-00 (2026-09-19). Lógica en lib/happyrobot/sms-avisos.ts.
import { verificarWebhook } from "@/lib/happyrobot/cliente";
import { estadoSmsAvisos, herramientaEnviarSms, respuestaHerramientaSinDatos, smsDesdeCuerpo, smsRecientes } from "@/lib/happyrobot/sms-avisos";
import { arrancarOrquestador } from "@/lib/motor/orquestador";
import { error, json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { destino: _destino, ...situacion } = estadoSmsAvisos();
  void _destino; // el teléfono completo no sale de la API
  return json({ ...situacion, recientes: smsRecientes() });
}

export async function POST(peticion: Request): Promise<Response> {
  if (!verificarWebhook(peticion.headers)) return error("Cabecera x-webhook-secret ausente o incorrecta", 401);

  let bruto: unknown;
  try {
    bruto = await peticion.json();
  } catch {
    return error("El cuerpo debe ser JSON", 400);
  }
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return error("El cuerpo debe ser un objeto JSON", 400);
  const obj = bruto as Record<string, unknown>;
  // HappyRobot puede envolver los argumentos de la herramienta en data/payload/arguments.
  const anidado = (obj.data ?? obj.payload ?? obj.arguments ?? obj.parameters) as Record<string, unknown> | undefined;
  const cuerpo = anidado && typeof anidado === "object" && !Array.isArray(anidado) ? { ...anidado, ...obj } : obj;

  const leido = smsDesdeCuerpo(cuerpo);
  // Sin texto (p. ej. la prueba de nodo de la plataforma, que manda las variables sin resolver): 200 con
  // todas las claves y el error dentro. Un 4xx dejaría al agente sin ver los campos de la respuesta.
  if (!leido.peticion) return json(respuestaHerramientaSinDatos(leido.error ?? "SMS no válido"));

  arrancarOrquestador();
  // Siempre 200 con {enviado, error?, mensajeParaLocutor}: el agente tiene que poder
  // leerle a la persona qué ha pasado; el fallo queda visible en `error` y como evento.
  return json(await herramientaEnviarSms(leido.peticion));
}
