// /api/happyrobot/recuperar · Llamadas al 112 que no llegaron a Atalaya.
//   GET  → resultado de la última pasada (sin tocar nada).
//   POST → pasada ahora mismo (exige x-webhook-secret): pide a HappyRobot las llamadas
//          recientes y registra las que falten, con lo que dictó la persona o su transcripción.
// La pasada también corre sola cada minuto en el servidor y la lanza el guardián del
// túnel (scripts/tunel-vigilado.sh). DUEÑO: sesión fireops-82 (2026-09-19).
import { verificarWebhook } from "@/lib/happyrobot/cliente";
import { arrancarRecuperacionLlamadas, recuperarLlamadasPerdidas, ultimaRecuperacion } from "@/lib/happyrobot/recuperar-llamadas";
import { arrancarOrquestador } from "@/lib/motor/orquestador";
import { error, json, mensajeDeError } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  arrancarRecuperacionLlamadas();
  return json({ ultima: ultimaRecuperacion() ?? null });
}

export async function POST(peticion: Request): Promise<Response> {
  if (!verificarWebhook(peticion.headers)) return error("Cabecera x-webhook-secret ausente o incorrecta", 401);
  arrancarOrquestador();
  arrancarRecuperacionLlamadas();
  try {
    return json(await recuperarLlamadasPerdidas());
  } catch (e) {
    return error(`No se pudieron recuperar las llamadas: ${mensajeDeError(e)}`, 500);
  }
}
