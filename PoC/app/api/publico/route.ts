import { obtenerEstado } from "@/lib/server/motor";
import { vistaPublica } from "@/lib/server/publico";
import { fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/publico — portal ciudadano: avisos oficiales, recomendaciones, noticias verificadas y bulos desmentidos. Sin datos internos. */
export async function GET() {
  try {
    return ok(vistaPublica(await obtenerEstado()));
  } catch (err) {
    return fallo(err, 500);
  }
}
