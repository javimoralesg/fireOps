// GET /api/fuentes/salud · DUEÑO: constructor B.
// Petición mínima a cada fuente externa con su latencia real. Además deja el
// resultado en `estado.servicios` para la barra de estado de la sala de mando.
import { comprobarFuentes } from "@/lib/fuentes/salud";
import { obtenerEstado } from "@/lib/motor/estado";

export const dynamic = "force-dynamic";

export async function GET() {
  const estado = obtenerEstado();
  const fuentes = await comprobarFuentes();
  for (const f of fuentes) estado.marcarServicio(f.nombre, f.ok, f.detalle);
  return Response.json({
    en: new Date().toISOString(),
    ok: fuentes.filter((f) => f.ok).length,
    total: fuentes.length,
    fuentes,
  });
}
