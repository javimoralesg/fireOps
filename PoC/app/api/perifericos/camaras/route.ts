import { fallo, ok } from "@/lib/server/http";
import { obtenerEstado } from "@/lib/server/motor";
import { camarasCercanas } from "@/lib/server/perifericos/camarasMadrid";

export const dynamic = "force-dynamic";

/**
 * GET /api/perifericos/camaras?n=8
 * Las n cámaras municipales más cercanas al incidente (informo.madrid.es, sin clave).
 * `imagenUrl` lleva ?v=<minuto> para que el navegador refresque el JPEG cada minuto.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const n = Number(url.searchParams.get("n") ?? 8);
    const estado = await obtenerEstado();
    const centro = estado.incidente.ubicacion;
    const version = Math.floor(Date.now() / 60_000);
    const camaras = (await camarasCercanas(centro.lat, centro.lon, Number.isFinite(n) ? n : 8)).map((c) => ({ ...c, imagenUrl: `${c.imagenUrl}?v=${version}` }));
    return ok(camaras);
  } catch (err) {
    return fallo(err, 500);
  }
}
