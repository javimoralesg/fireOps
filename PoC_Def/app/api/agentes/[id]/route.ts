// GET/POST /api/agentes/[id] · Control humano de un agente. DUEÑO: constructor A.
// { accion: "pausar" | "reanudar" | "asumir" | "liberar" | "ciclo" }
import { z } from "zod";
import { obtenerEstado } from "@/lib/motor/estado";
import { despertar } from "@/lib/motor/orquestador";
import { cuerpoValidado, error, json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Esquema = z.object({
  accion: z.enum(["pausar", "reanudar", "asumir", "liberar", "ciclo"]),
  quien: z.string().trim().max(80).optional(),
});

export async function GET(_peticion: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const ficha = obtenerEstado().agentes.get(id);
  if (!ficha) return error(`No hay ningún agente con id ${id}`, 404);
  return json({ agente: ficha });
}

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const { datos, respuesta } = await cuerpoValidado(peticion, Esquema);
  if (respuesta) return respuesta;

  const estado = obtenerEstado();
  const ficha = estado.agentes.get(id);
  if (!ficha) return error(`No hay ningún agente con id ${id}`, 404);
  const quien = datos.quien ?? "sala de mando";

  let mensaje = "";
  switch (datos.accion) {
    case "pausar":
      estado.actualizar(estado.agentes, id, { pausado: true, estado: "pausado", tareaActual: "En pausa por orden humana" });
      mensaje = `${ficha.nombre} en pausa`;
      break;
    case "reanudar":
      estado.actualizar(estado.agentes, id, { pausado: false, estado: "observando", tareaActual: undefined, ultimoError: undefined });
      despertar(id, "humano");
      mensaje = `${ficha.nombre} reanudado`;
      break;
    case "asumir":
      // Control humano: TODAS sus propuestas pasan a ser supervisadas como mínimo.
      estado.actualizar(estado.agentes, id, { controlHumano: true });
      mensaje = `Control humano sobre ${ficha.nombre}: sus decisiones pasarán por ti`;
      break;
    case "liberar":
      estado.actualizar(estado.agentes, id, { controlHumano: false });
      mensaje = `${ficha.nombre} vuelve a su autonomía según la política`;
      break;
    case "ciclo":
      despertar(id, "humano");
      mensaje = `Ciclo forzado de ${ficha.nombre}`;
      break;
  }

  estado.registrarEvento("humano", `${mensaje} (${quien})`, { agenteId: id, nivel: "info", datos: { accion: datos.accion, quien } });
  return json({ agente: estado.agentes.get(id), mensaje });
}
