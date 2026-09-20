// Grafo de conocimiento (nodos y aristas) para el visor. DUEÑO: constructor C.
import type { NextRequest } from "next/server";
import { ampliarGrafoConFragmentos, obtenerGrafo } from "@/lib/conocimiento/grafo";
import { obtenerChunk } from "@/lib/conocimiento/almacen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: NextRequest) {
  const documentoId = peticion.nextUrl.searchParams.get("documentoId") ?? undefined;
  const chunkId = peticion.nextUrl.searchParams.get("chunkId");
  if (chunkId) {
    const chunk = await obtenerChunk(chunkId);
    if (!chunk) return Response.json({ error: `No existe el fragmento «${chunkId}».` }, { status: 404 });
    // El vector no se manda a la pantalla: son cientos de números inútiles ahí.
    const sinVector: Partial<typeof chunk> = { ...chunk };
    delete sinVector.embedding;
    return Response.json({ chunk: sinVector });
  }
  const grafo = await obtenerGrafo(documentoId);
  // AÑADIDO (constructor I): `incluir=id1,id2` garantiza que esos fragmentos
  // salen en el grafo aunque el muestreo los hubiera dejado fuera. Lo usa el
  // modo "consulta" del visor para resaltar lo que miró la IA.
  const incluir = (peticion.nextUrl.searchParams.get("incluir") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (incluir.length) return Response.json(await ampliarGrafoConFragmentos(grafo, incluir));
  return Response.json(grafo);
}
