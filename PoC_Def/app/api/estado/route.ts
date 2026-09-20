// GET /api/estado · Snapshot completo del estado vivo. DUEÑO: constructor A.
// Rendimiento (constructor P): ETag = ejecución + versión del estado. Si el cliente manda
// `If-None-Match` con la revisión que ya tiene, contesta 304 sin cuerpo (el
// polling de respaldo así no descarga megas para nada) y, cuando sí hay cuerpo,
// reutiliza la cadena ya serializada que comparte con el SSE.
import { obtenerEstado } from "@/lib/motor/estado";
import { arrancarOrquestador } from "@/lib/motor/orquestador";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request): Promise<Response> {
  arrancarOrquestador(); // idempotente: por si la ruta se toca antes que instrumentation
  const estado = obtenerEstado();
  // Dos procesos o ejecuciones distintas pueden tener la misma versión. El id
  // evita responder 304 a una pestaña que aún conserva el estado anterior.
  const etag = `W/"${estado.ejecucion.id}:${estado.version}"`;
  const cabeceras: Record<string, string> = { ETag: etag, "Cache-Control": "no-store" };

  const pedido = peticion.headers.get("if-none-match");
  if (pedido && pedido.split(",").some((v) => v.trim() === etag)) {
    return new Response(null, { status: 304, headers: cabeceras });
  }

  return new Response(estado.snapshotTexto(), {
    headers: { ...cabeceras, "Content-Type": "application/json; charset=utf-8" },
  });
}
