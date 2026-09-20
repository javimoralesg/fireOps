// GET /api/fuentes/salud · DUEÑO: constructor B (rendimiento: constructor T).
// Petición mínima a cada fuente externa con su latencia real. Además deja el
// resultado en `estado.servicios` para la barra de estado de la sala de mando.
//
// RENDIMIENTO (constructor T, 2026-09-19): el resultado se cachea 60 s y se
// refresca en segundo plano, y cada comprobación tiene un tope de 5 s. Antes
// esta ruta hacía ~13 llamadas externas en vivo por petición y esperaba a la
// más lenta (minutos con Overpass caído). El error sigue siendo visible: una
// fuente que no responde sale en rojo con su motivo, nunca se inventa nada.
import { comprobarFuentesCacheadas } from "@/lib/fuentes/salud";
import { obtenerEstado } from "@/lib/motor/estado";

export const dynamic = "force-dynamic";

export async function GET() {
  const estado = obtenerEstado();
  const { fuentes, en, delCache } = await comprobarFuentesCacheadas();
  // Solo se marcan los servicios que HAN CAMBIADO: cada `marcarServicio` toca
  // el estado y dispara un Snapshot por SSE a todas las pantallas abiertas.
  for (const f of fuentes) {
    const previo = estado.servicios[f.nombre];
    if (previo && previo.ok === f.ok && previo.detalle === f.detalle) continue;
    estado.marcarServicio(f.nombre, f.ok, f.detalle);
  }
  return Response.json({
    en,
    delCache,
    ok: fuentes.filter((f) => f.ok).length,
    total: fuentes.length,
    fuentes,
  });
}
