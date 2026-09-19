// GET /api/fuentes/avisos · DUEÑO: constructor B.
// Avisos meteorológicos vigentes en España (AEMET si hay clave, Meteoalarm si no).
import { avisosEspana } from "@/lib/fuentes/avisos";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { avisos, fuente, detalle } = await avisosEspana();
    return Response.json({ fuente, detalle, total: avisos.length, avisos });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
