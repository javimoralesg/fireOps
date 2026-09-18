import { tareaVoluntarios } from "@/lib/server/motor";
import { exigir, rolDe } from "@/lib/server/autorizacion";
import { fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST /api/voluntarios/[id]/cancelar — permiso gestionar_voluntarios. */
export async function POST(req: Request, ctx: RouteContext<"/api/voluntarios/[id]/cancelar">) {
  try {
    const { id } = await ctx.params;
    const veto = exigir(rolDe(req), "gestionar_voluntarios");
    if (veto) return veto;
    await tareaVoluntarios(id, "cancelar");
    return ok({ ok: true });
  } catch (err) {
    return fallo(err);
  }
}
