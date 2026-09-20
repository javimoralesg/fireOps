// POST /api/webhooks/happyrobot/email · Entrada de HappyRobot (email).
// Lo llama el nodo "Webhook action" del workflow al terminar la conversación.
// Verifica la cabecera x-webhook-secret y entrega el texto a la centralita (B).
// DUEÑO: constructor D.
import { entradaHappyRobot } from "@/lib/happyrobot/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request): Promise<Response> {
  return entradaHappyRobot(peticion, "email");
}
