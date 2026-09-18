import { escalar } from "@/lib/server/motor";
import { rolDe } from "@/lib/server/autorizacion";
import { body, fallo, ok } from "@/lib/server/http";
import { ROLES, normalizarRol } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * POST /api/decisiones/[id]/escalar { a: RolId } — cabecera x-atalaya-rol = quien escala.
 * Cualquier rol de mando puede escalar (el operador 112 escala sin permiso "decidir").
 * Si HappyRobot está configurado, llama al cargo para aprobación por voz.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/decisiones/[id]/escalar">) {
  try {
    const { id } = await ctx.params;
    const b = await body<{ a?: string; rol?: string }>(req);
    const por = rolDe(req, b);
    if (!b.a || !(b.a in ROLES)) return fallo(new Error("a debe ser un RolId válido"));
    const a = normalizarRol(b.a);
    if (!ROLES[a].permisos.includes("decidir")) return fallo(new Error(`El rol ${a} no puede decidir; escala a un rol con permiso "decidir"`));
    const e = await escalar(id, a, por);
    const d = e.decisiones.find((x) => x.id === id);
    return ok({ ok: true, escaladaA: d?.escaladaA });
  } catch (err) {
    return fallo(err);
  }
}
