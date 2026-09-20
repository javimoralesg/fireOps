// POST /api/decisiones/manual · Decisión tomada por un humano desde la sala.
// Se crea con agenteId "humano", se aprueba directamente y se EJECUTA de verdad.
// DUEÑO: constructor D.
import { z } from "zod";
import type { TipoAccion } from "@/lib/dominio/tipos";
import { obtenerEstado } from "@/lib/motor/estado";
import { cuerpoValidado, error, json, mensajeDeError } from "@/lib/motor/respuestas";
import { decisionManual } from "@/lib/agentes/ejecucion/orden-manual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIPOS: [TipoAccion, ...TipoAccion[]] = [
  "llamar",
  "enviar_sms",
  "enviar_email",
  "enviar_telegram",
  "desplegar_unidad",
  "reasignar_unidad",
  "retirar_unidad",
  "solicitar_medios_aereos",
  "avisar_poblacion",
  "confinar_poblacion",
  "evacuar_poblacion",
  "cortar_carretera",
  "publicar_comunicado",
  "elevar_nivel",
  "declarar_controlado",
  "abrir_ticket",
  "vigilar_camara",
  "solicitar_confirmacion",
];

const Punto = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });

const Esquema = z.object({
  incendioId: z.string().trim().optional(),
  titulo: z.string().trim().min(3).max(200),
  resumen: z.string().trim().max(1000).optional(),
  razonamiento: z.string().trim().max(4000).optional(),
  quien: z.string().trim().min(1).max(80),
  prioridad: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  acciones: z
    .array(
      z.object({
        tipo: z.enum(TIPOS),
        descripcion: z.string().trim().min(3).max(300),
        objetivo: z
          .object({
            unidadId: z.string().trim().optional(),
            poblacionId: z.string().trim().optional(),
            telefono: z.string().trim().optional(),
            email: z.string().trim().optional(),
            camaraId: z.string().trim().optional(),
            punto: Punto.optional(),
          })
          .optional(),
        parametros: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1, "Una decisión manual necesita al menos una acción"),
});

export async function POST(peticion: Request): Promise<Response> {
  const { datos, respuesta } = await cuerpoValidado(peticion, Esquema);
  if (respuesta) return respuesta;

  const estado = obtenerEstado();
  if (datos.incendioId && !estado.incendios.get(datos.incendioId)) {
    return error(`No hay ningún incendio con id ${datos.incendioId}`, 404);
  }

  try {
    const decision = await decisionManual({
      quien: datos.quien,
      incendioId: datos.incendioId,
      titulo: datos.titulo,
      resumen: datos.resumen,
      razonamiento: datos.razonamiento,
      prioridad: datos.prioridad,
      acciones: datos.acciones.map((a) => ({
        tipo: a.tipo,
        descripcion: a.descripcion,
        objetivo: a.objetivo,
        parametros: (a.parametros ?? {}) as Record<string, unknown>,
      })),
    });
    return json({ decision }, 201);
  } catch (e) {
    return error(`La decisión se creó pero falló al ejecutarse: ${mensajeDeError(e)}`, 500);
  }
}
