import { generarSitrep, obtenerEstado } from "@/lib/server/motor";
import { exigir, rolDe } from "@/lib/server/autorizacion";
import { body, fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/informes — lista (sin markdown). POST { tipo: "sitrep" } — genera un SITREP ahora. */
export async function GET() {
  try {
    const e = await obtenerEstado();
    return ok(e.informes.map(({ markdown: _m, ...resto }) => resto));
  } catch (err) {
    return fallo(err, 500);
  }
}

export async function POST(req: Request) {
  try {
    const b = await body<{ tipo?: string; rol?: string }>(req);
    const veto = exigir(rolDe(req, b), "generar_informes");
    if (veto) return veto;
    if (b.tipo && b.tipo !== "sitrep") return fallo(new Error("tipo debe ser sitrep"));
    const e = await generarSitrep();
    return ok(e.informes[0]);
  } catch (err) {
    return fallo(err, 500);
  }
}
