import { ingestaExterna } from "@/lib/server/motor";
import { body, comprobarSecretoWebhook, fallo, ok } from "@/lib/server/http";
import type { FuenteIngesta } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/happyrobot/ingesta
 * Lo llama HappyRobot al terminar una conversación entrante (línea ciudadana).
 * Body tolerante: { titulo|summary, detalle|transcript, ubicacion|location, confianza, pedirDecision, foco }
 */
export async function POST(req: Request) {
  if (!comprobarSecretoWebhook(req)) return fallo(new Error("secreto de webhook inválido"), 401);
  try {
    const b = await body<Record<string, unknown>>(req);
    const s = (k: string[]) => k.map((x) => b[x]).find((v) => typeof v === "string" && v.trim()) as string | undefined;
    const titulo = s(["titulo", "summary", "resumen", "title"]) ?? "Aviso recibido por HappyRobot";
    const detalle = s(["detalle", "transcript", "transcripcion", "detail", "message"]) ?? JSON.stringify(b).slice(0, 500);
    const e = await ingestaExterna({
      fuente: (s(["fuente"]) as FuenteIngesta | undefined) ?? "HappyRobot",
      titulo,
      detalle,
      ubicacion: s(["ubicacion", "location", "address"]),
      confianza: typeof b.confianza === "number" ? b.confianza : 0.85,
      pedirDecision: b.pedirDecision === true || b.pedirDecision === "true",
      foco: s(["foco"]),
    });
    return ok({ recibido: true, eventoId: e.eventos[0]?.id, tick: e.incidente.tick });
  } catch (err) {
    return fallo(err, 500);
  }
}
