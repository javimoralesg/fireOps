import { cambiarVelocidad, detenerSimulacion, estadoSimulacion, iniciarSimulacion } from "@/lib/server/simulacion";
import { exigir, rolDe } from "@/lib/server/autorizacion";
import { body, fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/simulacion → estado del reproductor (activa, escenarioId, velocidad, indice, total, siguienteEnSeg, ultimos[]). */
export async function GET() {
  return ok(estadoSimulacion());
}

/** POST /api/simulacion { escenarioId, velocidad?: 1|5|10, desde?: offsetSeg } — permiso controlar_simulacion o Dirección del Plan. */
export async function POST(req: Request) {
  try {
    const b = await body<{ escenarioId?: string; velocidad?: number; desde?: number; rol?: string }>(req);
    const rol = rolDe(req, b);
    const veto = rol === "director_plan" ? null : exigir(rol, "controlar_simulacion");
    if (veto) return veto;
    if (!b.escenarioId) return fallo(new Error("escenarioId obligatorio"));
    const base = new URL(req.url).origin;
    return ok(await iniciarSimulacion(b.escenarioId, b.velocidad ?? 1, b.desde ?? 0, base));
  } catch (err) {
    return fallo(err);
  }
}

/** DELETE /api/simulacion — detiene el reproductor. */
export async function DELETE(req: Request) {
  const rol = rolDe(req);
  const veto = rol === "director_plan" ? null : exigir(rol, "controlar_simulacion");
  if (veto) return veto;
  return ok(detenerSimulacion());
}

/** PATCH /api/simulacion { velocidad } — cambia la velocidad sin reiniciar. */
export async function PATCH(req: Request) {
  try {
    const b = await body<{ velocidad?: number; rol?: string }>(req);
    const rol = rolDe(req, b);
    const veto = rol === "director_plan" ? null : exigir(rol, "controlar_simulacion");
    if (veto) return veto;
    if (typeof b.velocidad !== "number") return fallo(new Error("velocidad obligatoria"));
    return ok(await cambiarVelocidad(b.velocidad));
  } catch (err) {
    return fallo(err);
  }
}
