// Ejecuciones, métricas, lecciones y uso de los modelos. DUEÑO: constructor C.
import { listarEjecuciones, listarLecciones } from "@/lib/aprendizaje/memoria";
import { estadisticasLLM } from "@/lib/ia/llm";
import { estadisticasEmbeddings } from "@/lib/ia/embeddings";
import { obtenerEstado } from "@/lib/motor/estado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const estado = obtenerEstado();
  const [ejecuciones, lecciones] = await Promise.all([listarEjecuciones(), listarLecciones()]);

  // La ejecución en curso puede no estar aún en el histórico persistido.
  const enCurso = estado.ejecucion;
  const todas = ejecuciones.some((e) => e.id === enCurso.id) ? ejecuciones : [enCurso, ...ejecuciones];

  return Response.json({
    ejecucionActual: enCurso.id,
    ejecuciones: todas.sort((a, b) => b.inicio.localeCompare(a.inicio)),
    lecciones,
    estadisticasLLM: estadisticasLLM(),
    estadisticasEmbeddings: estadisticasEmbeddings(),
  });
}
