// Borrado de un documento del conocimiento. DUEÑO: constructor C.
import { eliminarDocumento } from "@/lib/conocimiento/almacen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const { id } = await contexto.params;
  const borrado = await eliminarDocumento(id);
  if (!borrado) return Response.json({ error: `No existe el documento «${id}».` }, { status: 404 });
  return Response.json({ ok: true, id });
}
