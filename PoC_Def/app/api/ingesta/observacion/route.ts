// POST /api/ingesta/observacion · Entrada genérica de avisos (formulario /parte,
// página /movil, integraciones). Todo pasa por `procesarEntrada` de la centralita.
// DUEÑO: constructor D.
import { z } from "zod";
import { procesarEntrada } from "@/lib/agentes/percepcion/centralita";
import { cuerpoValidado, error, json, mensajeDeError } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Esquema = z.object({
  canal: z.enum(["web", "llamada", "sms", "email", "telegram"]).default("web"),
  texto: z.string().trim().min(3, "Cuéntanos qué ves").max(4000),
  remitente: z.string().trim().max(200).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  referenciaExterna: z.string().trim().max(200).optional(),
  urlFuente: z.string().trim().max(500).optional(),
  /**
   * Foto del móvil. NO se guarda como data URL en la observación: un base64 de
   * varios cientos de KB viajaría por SSE en cada snapshot. El análisis de los
   * fotogramas lo hace el vigía de cámaras (constructor B) por su canal /movil;
   * aquí solo se anota que venía una foto.
   */
  imagenBase64: z.string().max(12_000_000).optional(),
});

export async function POST(peticion: Request): Promise<Response> {
  const { datos, respuesta } = await cuerpoValidado(peticion, Esquema);
  if (respuesta) return respuesta;

  const punto = datos.lat !== undefined && datos.lon !== undefined ? { lat: datos.lat, lon: datos.lon } : undefined;
  const texto = datos.imagenBase64 ? `${datos.texto}\n\n[El aviso incluye una foto tomada con el móvil.]` : datos.texto;

  try {
    const observacion = await procesarEntrada({
      canal: datos.canal,
      texto,
      remitente: datos.remitente,
      referenciaExterna: datos.referenciaExterna,
      punto,
      urlFuente: datos.urlFuente,
    });
    return json({ observacion, mensaje: "Aviso recibido. Gracias: lo está revisando la sala de coordinación." }, 201);
  } catch (e) {
    return error(`No se pudo registrar el aviso: ${mensajeDeError(e)}`, 500);
  }
}
