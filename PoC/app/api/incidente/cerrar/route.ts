import { cerrarIncidente } from "@/lib/server/motor";
import { exigir, rolDe } from "@/lib/server/autorizacion";
import { body, fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST /api/incidente/cerrar { id? } — cierra la incidencia (por defecto la activa) y genera el post-mortem. Permiso: firmar_informes. */
export async function POST(req: Request) {
  try {
    const b = await body<{ id?: string; rol?: string }>(req);
    const veto = exigir(rolDe(req, b), "firmar_informes");
    if (veto) return veto;
    const e = await cerrarIncidente(b.id);
    const inf = e.informes.find((i) => i.tipo === "post_mortem");
    return ok({ ok: true, informeId: inf?.id, pdfUrl: inf?.pdfUrl ?? null });
  } catch (err) {
    return fallo(err);
  }
}
