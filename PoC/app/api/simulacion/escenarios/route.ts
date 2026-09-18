import { eventosSueltos, listarEscenarios } from "@/lib/server/simulacion";
import { fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/simulacion/escenarios → escenarios de data/dataset/*.json (+ el guion de respaldo) y eventos sueltos. */
export async function GET() {
  try {
    return ok({ escenarios: await listarEscenarios(), sueltos: await eventosSueltos() });
  } catch (err) {
    return fallo(err, 500);
  }
}
