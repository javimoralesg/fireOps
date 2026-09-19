// POST /api/webhooks/happyrobot/resultado · Resultado de una llamada, SMS o email
// que disparamos nosotros. Cierra el círculo: "avisando" → "avisado"/"sin_respuesta".
// DUEÑO: constructor D.
import { resultadoHappyRobot } from "@/lib/happyrobot/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request): Promise<Response> {
  return resultadoHappyRobot(peticion);
}
