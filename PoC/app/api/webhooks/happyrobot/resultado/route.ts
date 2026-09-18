import { resultadoExterno } from "@/lib/server/motor";
import { body, comprobarSecretoWebhook, fallo, ok } from "@/lib/server/http";
import type { CanalAccion } from "@/lib/tipos-sistema";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/happyrobot/resultado
 * HappyRobot devuelve el resultado de una llamada/mensaje disparado al aprobar.
 * Body: { decisionId, accionId, ref|call_id|id, ok|success, detalle|summary, canal }
 */
export async function POST(req: Request) {
  if (!comprobarSecretoWebhook(req)) return fallo(new Error("secreto de webhook inválido"), 401);
  try {
    const b = await body<Record<string, unknown>>(req);
    const s = (k: string[]) => k.map((x) => b[x]).find((v) => typeof v === "string" && v.trim()) as string | undefined;
    const decisionId = s(["decisionId", "decision_id"]);
    const accionId = s(["accionId", "accion_id", "action_id"]);
    if (!decisionId || !accionId) return fallo(new Error("decisionId y accionId son obligatorios"));
    const e = await resultadoExterno({
      decisionId,
      accionId,
      ref: s(["ref", "call_id", "run_id", "id"]) ?? `hr-${Date.now()}`,
      ok: b.ok === true || b.success === true || b.status === "completed",
      detalle: s(["detalle", "summary", "resumen", "outcome"]) ?? "Resultado recibido de HappyRobot",
      canal: s(["canal", "channel"]) as CanalAccion | undefined,
    });
    return ok({ recibido: true, decisionId, acciones: e.decisiones.find((d) => d.id === decisionId)?.resultadoEjecucion });
  } catch (err) {
    return fallo(err);
  }
}
