import { aprobar, obtenerEstado } from "@/lib/server/motor";
import { exigirDecidir, rolDe } from "@/lib/server/autorizacion";
import { body, fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST /api/decisiones/[id]/aprobar  { rol?, via? } — exige permiso "decidir" con riesgo ≤ máximo del rol. */
export async function POST(req: Request, ctx: RouteContext<"/api/decisiones/[id]/aprobar">) {
  try {
    const { id } = await ctx.params;
    const b = await body<{ rol?: string; via?: "panel" | "voz" }>(req);
    const rol = rolDe(req, b);
    const d = (await obtenerEstado()).decisiones.find((x) => x.id === id);
    if (!d) return fallo(new Error(`Decisión ${id} no encontrada`), 404);
    const veto = exigirDecidir(rol, d.riesgo, d.competencia);
    if (veto) return veto;
    return ok(await aprobar(id, rol, b.via ?? "panel"));
  } catch (err) {
    return fallo(err);
  }
}
