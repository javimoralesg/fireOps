import { inyectarManual, type EventoDataset } from "@/lib/server/simulacion";
import { exigir, rolDe } from "@/lib/server/autorizacion";
import { body, fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST /api/simulacion/evento — inyecta un evento compuesto a mano (mismo formato que los del dataset, offsetSeg opcional). */
export async function POST(req: Request) {
  try {
    const b = await body<Partial<EventoDataset> & { rol?: string }>(req);
    const rol = rolDe(req, b);
    const veto = rol === "director_plan" ? null : exigir(rol, "controlar_simulacion", "verificar_eventos");
    if (veto) return veto;
    if (!b.observacion) return fallo(new Error("observacion obligatoria"));
    const base = new URL(req.url).origin;
    return ok(await inyectarManual({ offsetSeg: 0, ...b, observacion: b.observacion }, base));
  } catch (err) {
    return fallo(err);
  }
}
