import { tareaVoluntarios } from "@/lib/server/motor";
import { fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST /api/voluntarios/[id]/aceptar — "Me apunto" desde el portal ciudadano (sin permiso especial). */
export async function POST(_req: Request, ctx: RouteContext<"/api/voluntarios/[id]/aceptar">) {
  try {
    const { id } = await ctx.params;
    const e = await tareaVoluntarios(id, "aceptar");
    const t = e.tareasVoluntarios?.find((x) => x.id === id);
    return ok({ ok: true, aceptados: t?.aceptados, cupo: t?.cupo, estado: t?.estado });
  } catch (err) {
    return fallo(err);
  }
}
