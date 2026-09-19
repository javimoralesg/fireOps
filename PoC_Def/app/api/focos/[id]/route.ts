// GET/PATCH /api/focos/[id] · Consultar y cambiar un foco. DUEÑO: constructor A.
// Los estados de cierre (controlado/extinguido/descartado) pasan por cerrarIncendio,
// que libera medios y saca las cámaras de vigilancia.
import { z } from "zod";
import { obtenerEstado } from "@/lib/motor/estado";
import { cerrarIncendio, emitir } from "@/lib/motor/orquestador";
import { cuerpoValidado, error, json, mensajeDeError } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ESTADOS_CIERRE = ["controlado", "extinguido", "descartado"] as const;

const Esquema = z.object({
  estado: z.enum(["detectado", "confirmado", "activo", "estabilizado", "controlado", "extinguido", "descartado"]).optional(),
  notas: z.string().trim().max(2000).optional(),
  nivelGravedad: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
  nombre: z.string().trim().min(1).max(120).optional(),
  quien: z.string().trim().max(80).optional(),
});

export async function GET(_peticion: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const estado = obtenerEstado();
  const incendio = estado.incendios.get(id);
  if (!incendio) return error(`No hay ningún incendio con id ${id}`, 404);
  return json({
    incendio,
    unidades: estado.unidadesDe(id),
    poblaciones: estado.poblacionesDe(id),
    decisiones: estado.decisionesDe(id),
  });
}

export async function PATCH(peticion: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const { datos, respuesta } = await cuerpoValidado(peticion, Esquema);
  if (respuesta) return respuesta;

  const estado = obtenerEstado();
  const incendio = estado.incendios.get(id);
  if (!incendio) return error(`No hay ningún incendio con id ${id}`, 404);

  const quien = datos.quien ?? "sala de mando";
  const cambios: Record<string, unknown> = { actualizadoEn: estado.reloj.ahoraMundo };
  if (datos.notas !== undefined) cambios.notas = datos.notas;
  if (datos.nombre !== undefined) cambios.nombre = datos.nombre;
  if (datos.nivelGravedad !== undefined) cambios.nivelGravedad = datos.nivelGravedad;

  try {
    if (Object.keys(cambios).length > 1) {
      estado.actualizar(estado.incendios, id, cambios);
      if (datos.nivelGravedad !== undefined && datos.nivelGravedad !== incendio.nivelGravedad) {
        emitir("incendio_actualizado", `${incendio.nombre}: nivel de gravedad ${datos.nivelGravedad} (${quien})`, {
          incendioId: id,
          nivel: datos.nivelGravedad >= 2 ? "critico" : "aviso",
          datos: { nivelGravedad: datos.nivelGravedad, quien },
        });
      }
    }

    if (datos.estado) {
      if ((ESTADOS_CIERRE as readonly string[]).includes(datos.estado)) {
        await cerrarIncendio(id, datos.estado as (typeof ESTADOS_CIERRE)[number], quien);
      } else if (datos.estado !== incendio.estado) {
        estado.actualizar(estado.incendios, id, { estado: datos.estado, actualizadoEn: estado.reloj.ahoraMundo });
        emitir("incendio_actualizado", `${incendio.nombre} pasa a ${datos.estado} (${quien})`, { incendioId: id, nivel: "info", datos: { estado: datos.estado, quien } });
      }
    }
    return json({ incendio: estado.incendios.get(id) });
  } catch (e) {
    return error(`No se pudo actualizar el foco: ${mensajeDeError(e)}`, 500);
  }
}
