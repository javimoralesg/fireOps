import { preguntar } from "@/lib/server/agentes";
import { obtenerEstado } from "@/lib/server/motor";
import { exigir, rolDe } from "@/lib/server/autorizacion";
import { body, fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST /api/agentes/preguntar { pregunta, decisionId? } — permiso interrogar_ia. Responde solo con evidencia, doctrina y traza. */
export async function POST(req: Request) {
  try {
    const b = await body<{ pregunta?: string; decisionId?: string; rol?: string }>(req);
    const veto = exigir(rolDe(req, b), "interrogar_ia");
    if (veto) return veto;
    const pregunta = b.pregunta?.trim();
    if (!pregunta) return fallo(new Error("pregunta obligatoria"));
    return ok(await preguntar(pregunta, await obtenerEstado(), b.decisionId));
  } catch (err) {
    return fallo(err);
  }
}
