// GET/POST /api/agentes/[id] · Control humano de un agente. DUEÑO: constructor A.
// { accion: "pausar" | "reanudar" | "asumir" | "liberar" | "ciclo" }
import { z } from "zod";
import { resolverIdAgenteCompatible } from "@/lib/agentes/identidad";
import { obtenerEstado } from "@/lib/motor/estado";
import { despertar } from "@/lib/motor/orquestador";
import { cuerpoValidado, error, json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Esquema = z.object({
  accion: z.enum(["pausar", "reanudar", "asumir", "liberar", "ciclo"]),
  quien: z.string().trim().max(80).optional(),
});

function resolverIdOperativo(id: string): string {
  const estado = obtenerEstado();
  return resolverIdAgenteCompatible(estado.agentes, id) ?? id;
}

export async function GET(_peticion: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: solicitadoId } = await ctx.params;
  const id = resolverIdOperativo(solicitadoId);
  const ficha = obtenerEstado().agentes.get(id);
  if (!ficha) return error(`No hay ningún agente con id ${id}`, 404);
  return json({ agente: ficha });
}

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: solicitadoId } = await ctx.params;
  const id = resolverIdOperativo(solicitadoId);
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
      // El contador de errores se pone a cero (fallo L-6): si no, un agente que
      // el supervisor pausó por errores repetidos volvía con sus 5-6 errores
      // encima y el siguiente lo pausaba otra vez en el acto. Reanudar es una
      // orden humana de "vuelve a intentarlo", y eso incluye la cuenta.
      estado.actualizar(estado.agentes, id, {
        pausado: false,
        estado: "observando",
        tareaActual: undefined,
        ultimoError: undefined,
        contadores: { ...ficha.contadores, errores: 0 },
      });
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
