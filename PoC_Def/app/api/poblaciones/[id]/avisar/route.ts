// POST /api/poblaciones/[id]/avisar · Aviso manual a un pueblo desde la sala. DUEÑO: constructor D.
import { z } from "zod";
import { obtenerEstado } from "@/lib/motor/estado";
import { cuerpoValidado, error, json, mensajeDeError } from "@/lib/motor/respuestas";
import { decisionManual } from "@/lib/agentes/ejecucion/orden-manual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Esquema = z.object({
  quien: z.string().trim().min(1).max(80),
  canal: z.enum(["llamada", "sms", "telegram", "todos"]).optional(),
  medida: z.enum(["avisar", "confinar", "evacuar"]).optional(),
  mensaje: z.string().trim().max(300).optional(),
});

const TIPO = { avisar: "avisar_poblacion", confinar: "confinar_poblacion", evacuar: "evacuar_poblacion" } as const;

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const { datos, respuesta } = await cuerpoValidado(peticion, Esquema);
  if (respuesta) return respuesta;

  const estado = obtenerEstado();
  const poblacion = estado.poblaciones.get(id);
  if (!poblacion) return error(`No hay ninguna población con id ${id}`, 404);
  const incendio = estado.incendios.get(poblacion.incendioId);
  const organismo = process.env.ORGANISMO_NOMBRE?.trim() || "Centro de Coordinación de Incendios Forestales";

  const medida = datos.medida ?? "avisar";
  const mensaje =
    datos.mensaje ??
    `${organismo}: incendio forestal a ${poblacion.distanciaKm.toFixed(1)} km de ${poblacion.nombre}` +
      (poblacion.etaFrenteMin !== undefined ? `, el frente podría llegar en unos ${poblacion.etaFrenteMin} minutos` : "") +
      `. ${medida === "evacuar" ? "Prepare la salida siguiendo las indicaciones de los servicios de emergencia." : medida === "confinar" ? "Permanezca en el interior, cierre puertas y ventanas." : "Manténgase atento y no se acerque a la zona."} Información: 112.`;

  const guion = `Buenos días, le llamo del ${organismo}. Hay un incendio forestal a ${poblacion.distanciaKm.toFixed(1)} kilómetros de ${poblacion.nombre}${incendio ? `, el incendio de ${incendio.municipio}` : ""}. ${mensaje} ¿Me confirma que lo activan?`;

  const telefono = poblacion.telefono ?? process.env.DESTINO_DEMO?.trim();
  const canal = datos.canal ?? "todos";
  const acciones: Parameters<typeof decisionManual>[0]["acciones"] = [];

  if (canal === "todos") {
    acciones.push({
      tipo: TIPO[medida],
      descripcion: `${medida === "avisar" ? "Avisar a" : medida === "confinar" ? "Confinar" : "Evacuar"} ${poblacion.nombre} (orden manual)`,
      objetivo: { poblacionId: poblacion.id, telefono },
      parametros: { guion, sms: mensaje, telefono, municipio: poblacion.nombre, motivo: "orden manual de la sala", incendioId: poblacion.incendioId },
    });
  } else if (canal === "llamada") {
    acciones.push({ tipo: "llamar", descripcion: `Llamar al Ayuntamiento de ${poblacion.nombre}`, objetivo: { telefono, poblacionId: poblacion.id }, parametros: { guion, municipio: poblacion.nombre } });
  } else if (canal === "sms") {
    acciones.push({ tipo: "enviar_sms", descripcion: `SMS a ${poblacion.nombre}`, objetivo: { telefono, poblacionId: poblacion.id }, parametros: { sms: mensaje, municipio: poblacion.nombre } });
  } else {
    acciones.push({ tipo: "enviar_telegram", descripcion: `Telegram a ${poblacion.nombre}`, parametros: { texto: `⚠️ ${mensaje}`, municipio: poblacion.nombre, poblacionId: poblacion.id } });
  }

  try {
    const decision = await decisionManual({
      quien: datos.quien,
      incendioId: poblacion.incendioId,
      titulo: `Aviso manual a ${poblacion.nombre}`,
      razonamiento: `${datos.quien} ordena el aviso desde la sala de mando (canal ${canal}, medida ${medida}).`,
      acciones,
    });
    return json({ decision, poblacion: estado.poblaciones.get(id) }, 201);
  } catch (e) {
    return error(`No se pudo avisar a la población: ${mensajeDeError(e)}`, 500);
  }
}
