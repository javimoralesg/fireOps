import { fallo, ok } from "@/lib/server/http";
import { listarPublicaciones } from "@/lib/server/perifericos/publicaciones";

export const dynamic = "force-dynamic";

/** GET /api/ingesta/publicaciones?limite=50 → Publicacion[] (más recientes primero). */
export async function GET(req: Request) {
  try {
    const limite = Number(new URL(req.url).searchParams.get("limite") ?? 50);
    return ok(await listarPublicaciones(Number.isFinite(limite) ? limite : 50));
  } catch (err) {
    return fallo(err, 500);
  }
}
