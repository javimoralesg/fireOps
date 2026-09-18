import { obtenerEstado } from "@/lib/server/motor";
import { fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/estado — snapshot completo del sistema (polling cada 2 s desde la UI). */
export async function GET() {
  try {
    return ok(await obtenerEstado());
  } catch (err) {
    return fallo(err, 500);
  }
}
