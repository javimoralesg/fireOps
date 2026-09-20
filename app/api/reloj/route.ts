// POST /api/reloj · Control del tiempo de mundo. DUEÑO: constructor A.
// { factor?: number, pausado?: boolean, avanzarMin?: number }
import { z } from "zod";
import { obtenerEstado } from "@/lib/motor/estado";
import { avanzarMinutos, establecerFactor, pausar, reanudar } from "@/lib/motor/reloj";
import { cuerpoValidado, json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Esquema = z.object({
  factor: z.number().min(0.1).max(600).optional(),
  pausado: z.boolean().optional(),
  avanzarMin: z.number().min(0).max(24 * 60).optional(),
});

export async function GET(): Promise<Response> {
  return json(obtenerEstado().reloj);
}

export async function POST(peticion: Request): Promise<Response> {
  const { datos, respuesta } = await cuerpoValidado(peticion, Esquema);
  if (respuesta) return respuesta;

  const estado = obtenerEstado();
  const hechos: string[] = [];

  if (typeof datos.factor === "number") {
    establecerFactor(estado, datos.factor);
    hechos.push(`aceleración ×${estado.reloj.factor}`);
  }
  if (typeof datos.pausado === "boolean") {
    if (datos.pausado) pausar(estado);
    else reanudar(estado);
    hechos.push(datos.pausado ? "mundo en pausa" : "mundo en marcha");
  }
  if (typeof datos.avanzarMin === "number" && datos.avanzarMin > 0) {
    avanzarMinutos(estado, datos.avanzarMin);
    hechos.push(`+${datos.avanzarMin} min de mundo`);
  }

  if (hechos.length) {
    estado.registrarEvento("humano", `Reloj: ${hechos.join(", ")}`, { nivel: "info", datos: { ...datos } });
  }
  return json({ reloj: estado.reloj, hechos });
}
