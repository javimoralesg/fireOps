import { fallo } from "@/lib/server/http";
import { leerImagen } from "@/lib/server/perifericos/almacen";

export const dynamic = "force-dynamic";

/** GET /api/ingesta/imagen/[id] → la foto guardada en data/uploads (sin R2). */
export async function GET(_req: Request, ctx: RouteContext<"/api/ingesta/imagen/[id]">) {
  try {
    const { id } = await ctx.params;
    if (!/^[a-z0-9-]+$/.test(id)) return fallo(new Error("Identificador de imagen no válido"), 400);
    const imagen = await leerImagen(id);
    if (!imagen) return fallo(new Error("Imagen no encontrada"), 404);
    return new Response(new Uint8Array(imagen.datos), {
      headers: { "content-type": imagen.mime, "content-length": String(imagen.datos.length), "cache-control": "public, max-age=300" },
    });
  } catch (err) {
    return fallo(err, 500);
  }
}
