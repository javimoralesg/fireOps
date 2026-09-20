// GET /api/fuentes/satelite[?dias=1&canarias=1] · DUEÑO: constructor B.
// Focos activos reales de NASA FIRMS (VIIRS SNPP + NOAA-20), agrupados a 2 km.
// Sin FIRMS_MAP_KEY informa una capacidad opcional desactivada, sin fingir una
// caída del servicio. Un FIRMS configurado que falle sigue respondiendo 502.
import { agruparFocos, firmsDisponible, focosEspana } from "@/lib/fuentes/firms";

export const dynamic = "force-dynamic";

/** Número de un parámetro; NaN si no viene (ojo: Number(null) es 0). */
function num(url: URL, nombre: string, porDefecto = NaN): number {
  const v = url.searchParams.get(nombre);
  return v === null || v.trim() === "" ? porDefecto : Number(v);
}


export async function GET(peticion: Request) {
  const url = new URL(peticion.url);
  const dias = num(url, "dias", 1);
  const canarias = url.searchParams.get("canarias") === "1";
  if (!firmsDisponible()) {
    return Response.json({
      disponible: false,
      opcional: true,
      detalle: "FIRMS_MAP_KEY no configurada: detección satelital opcional desactivada.",
      total: 0,
      grupos: [],
      focos: [],
    });
  }
  const t0 = Date.now();
  try {
    const focos = await focosEspana({ dias, incluirCanarias: canarias });
    const grupos = agruparFocos(focos);
    return Response.json({
      ms: Date.now() - t0,
      total: focos.length,
      grupos: grupos.slice(0, 50).map((g) => ({ centro: g.centro, focos: g.focos.length, frpTotal: +g.frpTotal.toFixed(1), ultimo: g.focos[0]?.fechaHora })),
      focos: focos.slice(0, 500),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 }, { status: 502 });
  }
}
