// POST /api/focos · Declarar un foco a mano desde la sala. DUEÑO: constructor A.
// { lat, lon, nombre?, notas?, quien? } → crea el incendio y lo enriquece en segundo plano.
import { z } from "zod";
import { obtenerEstado } from "@/lib/motor/estado";
import { arrancarOrquestador, declararFoco } from "@/lib/motor/orquestador";
import { cuerpoValidado, error, json, mensajeDeError } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Esquema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  nombre: z.string().trim().max(120).optional(),
  notas: z.string().trim().max(2000).optional(),
  quien: z.string().trim().max(80).optional(),
});

export async function GET(): Promise<Response> {
  return json({ incendios: [...obtenerEstado().incendios.values()] });
}

export async function POST(peticion: Request): Promise<Response> {
  const { datos, respuesta } = await cuerpoValidado(peticion, Esquema);
  if (respuesta) return respuesta;
  arrancarOrquestador();
  try {
    const incendio = await declararFoco({
      punto: { lat: datos.lat, lon: datos.lon },
      nombre: datos.nombre,
      notas: datos.notas,
      quien: datos.quien ?? "sala de mando",
      origen: "manual",
    });
    return json({ incendio }, 201);
  } catch (e) {
    return error(`No se pudo declarar el foco: ${mensajeDeError(e)}`, 500);
  }
}
