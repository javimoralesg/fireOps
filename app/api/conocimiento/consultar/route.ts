// Pregunta al grafo de conocimiento ("¿Cómo procedo si…?"). DUEÑO: constructor C.
import type { NextRequest } from "next/server";
import { buscarFundamentosExplicados, consultarProtocolo } from "@/lib/conocimiento/consulta";
import { motivoIndisponible } from "@/lib/ia/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(peticion: NextRequest) {
  let cuerpo: { pregunta?: string; territorio?: string; k?: number };
  try {
    cuerpo = (await peticion.json()) as typeof cuerpo;
  } catch {
    return Response.json({ error: "Petición mal formada: se esperaba JSON con «pregunta»." }, { status: 400 });
  }
  const pregunta = cuerpo.pregunta?.trim();
  if (!pregunta) return Response.json({ error: "Escribe una pregunta." }, { status: 400 });

  try {
    const consulta = await consultarProtocolo(pregunta, { territorio: cuerpo.territorio, k: cuerpo.k });
    const explicados = await buscarFundamentosExplicados(pregunta, { territorio: cuerpo.territorio, k: cuerpo.k });
    return Response.json({ ...consulta, explicados });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    // Sin proveedor de IA se devuelven igualmente los fragmentos recuperados:
    // el mando puede leer la norma aunque nadie se la resuma. Nunca se inventa.
    try {
      const explicados = await buscarFundamentosExplicados(pregunta, { territorio: cuerpo.territorio, k: cuerpo.k });
      if (explicados.length) {
        return Response.json(
          { error: motivoIndisponible() ?? mensaje, pregunta, explicados, fundamentos: explicados, vecinos: [], respuesta: "", modelo: "" },
          { status: 503 },
        );
      }
    } catch {
      // Si tampoco hay embeddings, se devuelve el error original.
    }
    return Response.json({ error: mensaje }, { status: 503 });
  }
}
