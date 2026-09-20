// GET /api/fuentes/camaras/cercanas?lat&lon[&radio=30&max=20] · DUEÑO: B.
// Cámaras reales (DGT + Madrid + móviles) ordenadas por distancia al punto.
import { camarasCercanas } from "@/lib/fuentes/dgtCamaras";

export const dynamic = "force-dynamic";

/** Número de un parámetro; NaN si no viene (ojo: Number(null) es 0). */
function num(url: URL, nombre: string, porDefecto = NaN): number {
  const v = url.searchParams.get(nombre);
  return v === null || v.trim() === "" ? porDefecto : Number(v);
}


export async function GET(peticion: Request) {
  const url = new URL(peticion.url);
  const lat = num(url, "lat");
  const lon = num(url, "lon");
  const radio = num(url, "radio", 30);
  const max = Math.max(1, Math.min(100, num(url, "max", 20)));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json({ error: "Parámetros obligatorios: lat y lon" }, { status: 400 });
  }
  try {
    const cercanas = await camarasCercanas({ lat, lon }, radio);
    return Response.json({
      total: cercanas.length,
      radioKm: radio,
      camaras: cercanas.slice(0, max).map((c) => ({ ...c, urlProxy: `/api/camaras/${encodeURIComponent(c.id)}/imagen` })),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
