// GET/POST /api/ejecucion · Ciclo de vida de una ejecución. DUEÑO: constructor A.
// { accion: "nueva" | "cerrar", nombre? }
import { z } from "zod";
import { obtenerEstado } from "@/lib/motor/estado";
import { arrancarOrquestador, cerrarEjecucion, consolidarMetricas, nuevaEjecucion } from "@/lib/motor/orquestador";
import { cuerpoValidado, error, json, mensajeDeError } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Esquema = z.object({
  accion: z.enum(["nueva", "cerrar"]),
  nombre: z.string().trim().max(120).optional(),
});

export async function GET(): Promise<Response> {
  const estado = obtenerEstado();
  let anteriores: unknown[] = [];
  try {
    const { listarEjecuciones } = await import("@/lib/db/repositorio");
    anteriores = await listarEjecuciones(20);
  } catch {
    anteriores = []; // sin base de datos solo existe la ejecución en memoria
  }
  return json({ ejecucion: estado.ejecucion, anteriores });
}

export async function POST(peticion: Request): Promise<Response> {
  const { datos, respuesta } = await cuerpoValidado(peticion, Esquema);
  if (respuesta) return respuesta;
  arrancarOrquestador();

  try {
    if (datos.accion === "cerrar") {
      const estado = obtenerEstado();
      if (estado.ejecucion.estado === "cerrada") return error("La ejecución ya está cerrada", 409);
      await cerrarEjecucion();
      return json({ ejecucion: obtenerEstado().ejecucion });
    }
    const nuevo = await nuevaEjecucion(datos.nombre);
    consolidarMetricas(nuevo);
    return json({ ejecucion: nuevo.ejecucion, agentes: nuevo.agentes.size }, 201);
  } catch (e) {
    return error(`No se pudo ${datos.accion === "nueva" ? "crear" : "cerrar"} la ejecución: ${mensajeDeError(e)}`, 500);
  }
}
