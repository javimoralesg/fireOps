// GET /api/camaras · catálogo de cámaras. DUEÑO: constructor B.
// Las vigiladas van primero, con su último análisis. Parámetros opcionales:
//   ?lat&lon&radio (km) para acotar, ?max (por defecto 200), ?todas=1 sin recorte.
import { listarTodasLasCamaras } from "@/lib/fuentes/dgtCamaras";
import { haversine } from "@/lib/fuentes/geo";
import { obtenerEstado } from "@/lib/motor/estado";
import type { Camara } from "@/lib/dominio/tipos";

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
  const max = url.searchParams.get("todas") === "1" ? 5000 : Math.max(1, Math.min(2000, num(url, "max", 200)));

  const estado = obtenerEstado();
  try {
    const catalogo = await listarTodasLasCamaras();
    // El estado manda: lleva `vigilada`, `ultimoAnalisis` e `historial`.
    const porId = new Map<string, Camara>(catalogo.map((c) => [c.id, c]));
    for (const c of estado.camaras.values()) porId.set(c.id, c);

    let lista = [...porId.values()];
    const hayPunto = Number.isFinite(lat) && Number.isFinite(lon);
    if (hayPunto) {
      lista = lista
        .map((c) => ({ ...c, distanciaKm: +haversine({ lat, lon }, c.punto).toFixed(2) }))
        .filter((c) => (c as Camara & { distanciaKm: number }).distanciaKm <= radio);
    }

    lista.sort((a, b) => {
      if (a.vigilada !== b.vigilada) return a.vigilada ? -1 : 1;
      if (hayPunto) return ((a as Camara & { distanciaKm?: number }).distanciaKm ?? 0) - ((b as Camara & { distanciaKm?: number }).distanciaKm ?? 0);
      return a.nombre.localeCompare(b.nombre, "es");
    });

    const vigiladas = lista.filter((c) => c.vigilada).length;
    estado.marcarServicio("Cámaras", true, `${catalogo.length} en catálogo, ${vigiladas} vigiladas`);
    return Response.json({ total: lista.length, vigiladas, camaras: lista.slice(0, max) });
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    estado.marcarServicio("Cámaras", false, detalle);
    return Response.json({ error: detalle }, { status: 502 });
  }
}
