// GET /api/fuentes/entorno?lat&lon&radio · DUEÑO: constructor B.
// Devuelve el entorno OSM real (pueblos con población y teléfono del
// ayuntamiento, bomberos, policía, sanidad, vulnerables, aguas, combustible).
import { entornoIncendio } from "@/lib/fuentes/overpass";

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
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json({ error: "Parámetros obligatorios: lat y lon" }, { status: 400 });
  }
  const t0 = Date.now();
  try {
    const entorno = await entornoIncendio({ lat, lon }, radio);
    return Response.json({
      ms: Date.now() - t0,
      radioKm: radio,
      resumen: {
        poblaciones: entorno.poblaciones.length,
        conTelefono: entorno.poblaciones.filter((p) => p.telefono).length,
        parquesBomberos: entorno.parquesBomberos.length,
        policia: entorno.policia.length,
        hospitales: entorno.hospitales.length,
        vulnerables: entorno.vulnerables.length,
        aguas: entorno.aguas.length,
      },
      ...entorno,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 }, { status: 502 });
  }
}
