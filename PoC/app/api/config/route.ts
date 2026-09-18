import { configurar } from "@/lib/server/motor";
import { exigir, rolDe } from "@/lib/server/autorizacion";
import { body, fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/config { umbralAutonomia?, rolActivo?, autoAvance?, intervaloSeg? }
 * umbralAutonomia → permiso fijar_umbral · autoAvance/intervaloSeg → controlar_simulacion o Dirección del Plan · rolActivo → libre (demo).
 */
export async function POST(req: Request) {
  try {
    const b = await body<{ umbralAutonomia?: number; rolActivo?: string; autoAvance?: boolean; intervaloSeg?: number; rol?: string }>(req);
    const rol = rolDe(req, b);
    if (typeof b.umbralAutonomia === "number") {
      const veto = exigir(rol, "fijar_umbral");
      if (veto) return veto;
    }
    if (typeof b.autoAvance === "boolean" || typeof b.intervaloSeg === "number") {
      const veto = rol === "director_plan" ? null : exigir(rol, "controlar_simulacion");
      if (veto) return veto;
    }
    return ok(await configurar({ umbralAutonomia: b.umbralAutonomia, rolActivo: b.rolActivo as never, autoAvance: b.autoAvance, intervaloSeg: b.intervaloSeg }));
  } catch (err) {
    return fallo(err);
  }
}
