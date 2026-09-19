// GET /api/decisiones · Lista de decisiones con filtros. DUEÑO: constructor D.
import { obtenerEstado } from "@/lib/motor/estado";
import { json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request): Promise<Response> {
  const url = new URL(peticion.url);
  const incendioId = url.searchParams.get("incendioId")?.trim();
  const estadoFiltro = url.searchParams.get("estado")?.trim();
  const agenteId = url.searchParams.get("agenteId")?.trim();
  const limite = Math.min(500, Math.max(1, Number(url.searchParams.get("limite") ?? 200)));

  const estado = obtenerEstado();
  let decisiones = [...estado.decisiones.values()];
  if (incendioId) decisiones = decisiones.filter((d) => d.incendioId === incendioId);
  if (estadoFiltro) decisiones = decisiones.filter((d) => d.estado === estadoFiltro);
  if (agenteId) decisiones = decisiones.filter((d) => d.agenteId === agenteId);
  decisiones.sort((a, b) => b.creadaEn.localeCompare(a.creadaEn));

  return json({
    total: decisiones.length,
    pendientesHumano: estado.decisionesPendientesHumano().length,
    decisiones: decisiones.slice(0, limite),
  });
}
