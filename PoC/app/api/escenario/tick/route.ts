import { avanzar } from "@/lib/server/motor";
import { exigir, rolDe } from "@/lib/server/autorizacion";
import { fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST /api/escenario/tick — avance manual (permiso controlar_simulacion o Dirección del Plan). */
export async function POST(req: Request) {
  try {
    const rol = rolDe(req);
    const veto = rol === "director_plan" ? null : exigir(rol, "controlar_simulacion");
    if (veto) return veto;
    const e = await avanzar();
    return ok({ ok: true, tick: e.incidente.tick, fase: e.incidente.fase, activo: e.incidente.activo });
  } catch (err) {
    return fallo(err, 500);
  }
}
