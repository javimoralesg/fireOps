import { body, fallo, ok } from "@/lib/server/http";
import { ErrorIngesta, procesarObservacion, type ObservacionPipeline } from "@/lib/server/perifericos/pipeline";

export const dynamic = "force-dynamic";

/**
 * POST /api/ingesta/observacion
 * Body: ObservacionEntrante (imagen en base64 hasta 4 MB o `imagenUrl` pública).
 * Los campos desconocidos se ignoran (el reproductor de escenarios añade
 * datasetId/eventoDatasetId/canal/esperado). Cabecera `x-simulacion: 1` = simulacro.
 * → ResultadoIngesta. 400 si falta perifericoId/tipo; 404 si el periférico no existe.
 */
export async function POST(req: Request) {
  try {
    const b = await body<ObservacionPipeline>(req);
    if (!b.perifericoId || typeof b.perifericoId !== "string") return fallo(new Error("Falta perifericoId"), 400);
    if (!b.tipo || typeof b.tipo !== "string") return fallo(new Error("Falta tipo de observación"), 400);
    const simulacro = req.headers.get("x-simulacion") === "1";
    const resultado = await procesarObservacion(b, { simulacro });
    return ok(resultado);
  } catch (err) {
    if (err instanceof ErrorIngesta) return fallo(err, err.estadoHttp);
    return fallo(err, 500);
  }
}
