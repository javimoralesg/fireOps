import { desactivarRegla, obtenerEstado } from "@/lib/server/motor";
import { exigir, rolDe } from "@/lib/server/autorizacion";
import { body, fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/doctrina — reglas aprendidas. DELETE { id } — desactiva. PATCH { id, activa }. Permiso: editar_doctrina. */
export async function GET() {
  try {
    return ok((await obtenerEstado()).doctrina);
  } catch (err) {
    return fallo(err, 500);
  }
}

export async function DELETE(req: Request) {
  try {
    const b = await body<{ id?: string; rol?: string }>(req);
    const veto = exigir(rolDe(req, b), "editar_doctrina");
    if (veto) return veto;
    if (!b.id) return fallo(new Error("id obligatorio"));
    return ok((await desactivarRegla(b.id, false)).doctrina);
  } catch (err) {
    return fallo(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const b = await body<{ id?: string; activa?: boolean; rol?: string }>(req);
    const veto = exigir(rolDe(req, b), "editar_doctrina");
    if (veto) return veto;
    if (!b.id) return fallo(new Error("id obligatorio"));
    return ok((await desactivarRegla(b.id, b.activa ?? true)).doctrina);
  } catch (err) {
    return fallo(err);
  }
}
