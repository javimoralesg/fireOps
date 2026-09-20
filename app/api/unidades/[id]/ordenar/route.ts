// POST /api/unidades/[id]/ordenar · Orden manual a una unidad desde la sala.
// Crea una decisión humana con acción `desplegar_unidad` y la ejecuta (ruta OSRM real).
// DUEÑO: constructor D.
import { z } from "zod";
import { obtenerEstado } from "@/lib/motor/estado";
import { cuerpoValidado, error, json, mensajeDeError } from "@/lib/motor/respuestas";
import { decisionManual } from "@/lib/agentes/ejecucion/orden-manual";
import { describirFueraEspana, enEspana } from "@/lib/dominio/espana";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Esquema = z.object({
  destino: z.union([z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }), z.string().trim().min(1)]),
  incendioId: z.string().trim().min(1),
  sector: z.string().trim().max(20).optional(),
  quien: z.string().trim().min(1).max(80),
});

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const { datos, respuesta } = await cuerpoValidado(peticion, Esquema);
  if (respuesta) return respuesta;

  const estado = obtenerEstado();
  const unidad = estado.unidades.get(id);
  if (!unidad) return error(`No hay ninguna unidad con id ${id}`, 404);
  const incendio = estado.incendios.get(datos.incendioId);
  if (!incendio) return error(`No hay ningún incendio con id ${datos.incendioId}`, 404);

  // El destino puede venir como punto o como id de población (clic en el mapa o en la lista).
  let destino: { lat: number; lon: number };
  if (typeof datos.destino === "string") {
    const poblacion = estado.poblaciones.get(datos.destino);
    if (!poblacion) return error(`No hay ninguna población con id ${datos.destino}`, 404);
    destino = poblacion.centro;
  } else {
    destino = datos.destino;
  }
  if (!enEspana(destino)) return error(describirFueraEspana(destino), 400);

  try {
    const decision = await decisionManual({
      quien: datos.quien,
      incendioId: incendio.id,
      titulo: `Orden manual: ${unidad.nombre} al sector ${datos.sector ?? "A"} de ${incendio.nombre}`,
      razonamiento: `${datos.quien} ordena el movimiento desde la sala de mando, al margen de la propuesta de los agentes.`,
      acciones: [
        {
          tipo: "desplegar_unidad",
          descripcion: `Enviar ${unidad.nombre} al sector ${datos.sector ?? "A"} de ${incendio.nombre}`,
          objetivo: { unidadId: unidad.id },
          parametros: { destino, incendioId: incendio.id, sector: datos.sector ?? "A", motivo: "orden manual de la sala" },
        },
      ],
    });
    return json({ decision, unidad: estado.unidades.get(id) }, 201);
  } catch (e) {
    return error(`No se pudo ordenar el movimiento: ${mensajeDeError(e)}`, 500);
  }
}
