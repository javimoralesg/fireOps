// POST /api/decisiones/[id]/aprobar · Aprobación humana (y ejecución real). DUEÑO: constructor D.
import { z } from "zod";
import { obtenerEstado } from "@/lib/motor/estado";
import { aprobarDecision } from "@/lib/motor/orquestador";
import { cuerpoValidado, error, json, mensajeDeError } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Esquema = z.object({
  quien: z.string().trim().min(1).max(80),
  comentario: z.string().trim().max(2000).optional(),
});

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const { datos, respuesta } = await cuerpoValidado(peticion, Esquema);
  if (respuesta) return respuesta;

  const estado = obtenerEstado();
  const previa = estado.decisiones.get(id);
  if (!previa) return error(`No hay ninguna decisión con id ${id}`, 404);
  if (["ejecutada", "denegada", "fallida", "caducada"].includes(previa.estado)) {
    return error(`La decisión ya está ${previa.estado}: no se puede aprobar`, 409, { decision: previa });
  }

  try {
    const decision = await aprobarDecision(id, `humano:${datos.quien.replace(/^humano:/, "")}`, datos.comentario);
    return json({ decision: decision ?? estado.decisiones.get(id) });
  } catch (e) {
    return error(`No se pudo aprobar la decisión: ${mensajeDeError(e)}`, 500);
  }
}
