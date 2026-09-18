import { fallo, ok } from "@/lib/server/http";
import { anotarAnalisisCamara, camaraPorId, perifericoDeCamara, urlImagenCamara } from "@/lib/server/perifericos/camarasMadrid";
import { descargarImagen } from "@/lib/server/perifericos/almacen";
import { ErrorIngesta, procesarObservacion } from "@/lib/server/perifericos/pipeline";

export const dynamic = "force-dynamic";

/**
 * POST /api/perifericos/camaras/[id]/analizar
 * Descarga el fotograma actual de la cámara municipal y lo mete por el pipeline
 * con un periférico virtual de tipo camara_trafico. → ResultadoIngesta
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/perifericos/camaras/[id]/analizar">) {
  try {
    const { id } = await ctx.params;
    if (!/^[0-9a-zA-Z]+$/.test(id)) return fallo(new Error("Identificador de cámara no válido"), 400);
    const camara = await camaraPorId(id);
    if (!camara) return fallo(new Error(`Cámara ${id} no encontrada en el catálogo del Ayuntamiento`), 404);

    const imagen = await descargarImagen(`${urlImagenCamara(id)}?v=${Date.now()}`);
    const periferico = await perifericoDeCamara(camara);
    const resultado = await procesarObservacion({
      perifericoId: periferico.id,
      tipo: "fotograma",
      imagenBase64: imagen.base64,
      imagenMime: imagen.mime,
      posicion: { lat: camara.lat, lon: camara.lon, timestamp: new Date().toISOString() },
      texto: `Fotograma en vivo de la cámara municipal ${camara.nombre} (${id}).`,
    });
    if (resultado.analisis) anotarAnalisisCamara(id, resultado.analisis, resultado.impacto.accion === "ruido" ? undefined : resultado.evento.id);
    return ok(resultado);
  } catch (err) {
    if (err instanceof ErrorIngesta) return fallo(err, err.estadoHttp);
    return fallo(err, 500);
  }
}
