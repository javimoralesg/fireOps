// GET /api/estado · Snapshot completo del estado vivo. DUEÑO: constructor A.
import { obtenerEstado } from "@/lib/motor/estado";
import { arrancarOrquestador } from "@/lib/motor/orquestador";
import { json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  arrancarOrquestador(); // idempotente: por si la ruta se toca antes que instrumentation
  return json(obtenerEstado().snapshot());
}
