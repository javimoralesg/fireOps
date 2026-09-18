import { desactivarRegla } from "@/lib/server/motor";
import { exigir, rolDe } from "@/lib/server/autorizacion";
import { body, fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** PATCH /api/doctrina/[id] { activa } · DELETE /api/doctrina/[id]. Permiso: editar_doctrina. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/doctrina/[id]">) {
  try {
    const { id } = await ctx.params;
    const b = await body<{ activa?: boolean; rol?: string }>(req);
    const veto = exigir(rolDe(req, b), "editar_doctrina");
    if (veto) return veto;
    await desactivarRegla(id, b.activa ?? true);
    return ok({ ok: true });
  } catch (err) {
    return fallo(err);
  }
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/doctrina/[id]">) {
  try {
    const { id } = await ctx.params;
    const veto = exigir(rolDe(req), "editar_doctrina");
    if (veto) return veto;
    await desactivarRegla(id, false);
    return ok({ ok: true });
  } catch (err) {
    return fallo(err);
  }
}
