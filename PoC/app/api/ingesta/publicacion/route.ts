import { body, fallo, ok } from "@/lib/server/http";
import { publicar, type EntradaPublicacion } from "@/lib/server/perifericos/publicaciones";

export const dynamic = "force-dynamic";

/**
 * POST /api/ingesta/publicacion
 * Body: { perifericoId?, autor, texto, imagenBase64?, imagenMime?, posicion? }
 * → { publicacion, resultado? }  (resultado = ResultadoIngesta del pipeline)
 */
export async function POST(req: Request) {
  try {
    const b = await body<EntradaPublicacion>(req);
    if (!b.texto || typeof b.texto !== "string" || !b.texto.trim()) return fallo(new Error("Falta el texto de la publicación"), 400);
    const { publicacion, resultado } = await publicar(b);
    return ok({ publicacion, resultado });
  } catch (err) {
    return fallo(err, 500);
  }
}
