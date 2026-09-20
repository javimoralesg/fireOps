// POST /api/decisiones/[id]/denegar · Denegación humana con motivo OBLIGATORIO.
// El motivo es lo que enseña al sistema (el agente de memoria lo convierte en lección).
// DUEÑO: constructor D.
import { z } from "zod";
import { obtenerEstado } from "@/lib/motor/estado";
import { denegarDecision } from "@/lib/motor/orquestador";
import { cuerpoValidado, error, json, mensajeDeError } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Esquema = z.object({
  quien: z.string().trim().min(1).max(80),
  comentario: z.string().trim().min(3, "Hay que explicar por qué se deniega: es lo que aprende el sistema").max(2000),
});

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const { datos, respuesta } = await cuerpoValidado(peticion, Esquema);
  if (respuesta) return respuesta;

  const estado = obtenerEstado();
  const previa = estado.decisiones.get(id);
  if (!previa) return error(`No hay ninguna decisión con id ${id}`, 404);
  if (["ejecutada", "denegada", "fallida"].includes(previa.estado)) {
    return error(`La decisión ya está ${previa.estado}: no se puede denegar`, 409, { decision: previa });
  }

  try {
    const decision = await denegarDecision(id, `humano:${datos.quien.replace(/^humano:/, "")}`, datos.comentario);
    return json({ decision: decision ?? estado.decisiones.get(id) });
  } catch (e) {
    return error(`No se pudo denegar la decisión: ${mensajeDeError(e)}`, 500);
  }
}
