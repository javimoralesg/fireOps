// POST /api/unidades/[id]/retirar · Retirada manual de una unidad a su base. DUEÑO: constructor D.
import { z } from "zod";
import { obtenerEstado } from "@/lib/motor/estado";
import { cuerpoValidado, error, json, mensajeDeError } from "@/lib/motor/respuestas";
import { decisionManual } from "@/lib/agentes/ejecucion/orden-manual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Esquema = z.object({
  quien: z.string().trim().min(1).max(80),
  motivo: z.string().trim().max(500).optional(),
});

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const { datos, respuesta } = await cuerpoValidado(peticion, Esquema);
  if (respuesta) return respuesta;

  const estado = obtenerEstado();
  const unidad = estado.unidades.get(id);
  if (!unidad) return error(`No hay ninguna unidad con id ${id}`, 404);

  try {
    const decision = await decisionManual({
      quien: datos.quien,
      incendioId: unidad.incendioId,
      titulo: `Orden manual: retirar ${unidad.nombre}`,
      razonamiento: datos.motivo ?? `${datos.quien} retira la unidad desde la sala de mando.`,
      acciones: [
        {
          tipo: "retirar_unidad",
          descripcion: `Retirar ${unidad.nombre} a ${unidad.base.nombre}`,
          objetivo: { unidadId: unidad.id },
          parametros: { motivo: datos.motivo ?? "orden manual de la sala" },
        },
      ],
    });
    return json({ decision, unidad: estado.unidades.get(id) }, 201);
  } catch (e) {
    return error(`No se pudo retirar la unidad: ${mensajeDeError(e)}`, 500);
  }
}
