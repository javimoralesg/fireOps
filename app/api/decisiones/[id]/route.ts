// GET /api/decisiones/[id] · Una decisión ÍNTEGRA. DUEÑO: constructor D.
//
// MOTIVO (constructor T, 2026-09-19): el listado /api/decisiones ofrece la
// proyección `?campos=resumen`, que recorta las citas legales a 200 caracteres,
// se queda con los 3 fundamentos más parecidos y deja fuera historial,
// evidencias y evaluación. Ese recorte solo es legítimo si el detalle completo
// está a un clic, y no lo estaba: bajo `[id]` solo había `aprobar` y `denegar`,
// así que el enlace `recortado.detalle` devolvía 404. Aquí está la decisión
// entera, sin recortar y sin inventar nada: si no existe, 404 con su motivo.
import { obtenerEstado } from "@/lib/motor/estado";
import { error, json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_peticion: Request, contexto: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await contexto.params;
  const decision = obtenerEstado().decisiones.get(id);
  if (!decision) return error(`No existe la decisión «${id}».`, 404);
  return json({ decision });
}
