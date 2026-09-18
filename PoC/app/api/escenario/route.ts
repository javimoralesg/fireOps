import { avanzar, configurar, reiniciar } from "@/lib/server/motor";
import { exigir, rolDe } from "@/lib/server/autorizacion";
import { body, fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/escenario  { accion: "tick" | "reset" | "auto", autoAvance?, intervaloSeg? }
 * Permiso: controlar_simulacion (administrador) o Dirección del Plan (para la demo).
 */
export async function POST(req: Request) {
  try {
    const b = await body<{ accion?: string; autoAvance?: boolean; intervaloSeg?: number; rol?: string }>(req);
    const rol = rolDe(req, b);
    const veto = rol === "director_plan" ? null : exigir(rol, "controlar_simulacion");
    if (veto) return veto;
    switch (b.accion) {
      case "tick":
        return ok(await avanzar());
      case "reset":
        return ok(await reiniciar());
      case "auto":
        return ok(await configurar({ autoAvance: b.autoAvance ?? true, intervaloSeg: b.intervaloSeg }));
      default:
        return fallo(new Error("accion debe ser tick | reset | auto"));
    }
  } catch (err) {
    return fallo(err, 500);
  }
}
