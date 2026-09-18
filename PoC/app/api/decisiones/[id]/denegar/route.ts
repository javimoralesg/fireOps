import { denegar, obtenerEstado } from "@/lib/server/motor";
import { exigirDecidir, rolDe } from "@/lib/server/autorizacion";
import { body, fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/decisiones/[id]/denegar  { feedback, rol?, ambito? } — exige "decidir" con riesgo ≤ máximo del rol.
 * Deniega, convierte el feedback en regla de doctrina y genera una nueva propuesta que la respeta.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/decisiones/[id]/denegar">) {
  try {
    const { id } = await ctx.params;
    const b = await body<{ feedback?: string; rol?: string; ambito?: "global" | "incidente" }>(req);
    const rol = rolDe(req, b);
    const d = (await obtenerEstado()).decisiones.find((x) => x.id === id);
    if (!d) return fallo(new Error(`Decisión ${id} no encontrada`), 404);
    const veto = exigirDecidir(rol, d.riesgo, d.competencia);
    if (veto) return veto;
    return ok(await denegar(id, b.feedback ?? "", rol, b.ambito ?? "global"));
  } catch (err) {
    return fallo(err);
  }
}
