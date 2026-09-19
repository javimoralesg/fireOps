// Lista de informes (actas de auditoría). DUEÑO: constructor C.
import type { NextRequest } from "next/server";
import type { Informe } from "@/lib/dominio/tipos";
import { obtenerEstado } from "@/lib/motor/estado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Los informes viven en el estado; si hay repositorio de A, se completan con los persistidos. */
async function todosLosInformes(): Promise<Informe[]> {
  const enMemoria = [...obtenerEstado().informes.values()];
  try {
    const repositorio = (await import("@/lib/db/repositorio")) as { listarInformes?: () => Promise<Informe[]> };
    if (typeof repositorio.listarInformes === "function") {
      const porId = new Map<string, Informe>();
      for (const i of await repositorio.listarInformes()) porId.set(i.id, i);
      for (const i of enMemoria) porId.set(i.id, i);
      return [...porId.values()];
    }
  } catch {
    // Sin repositorio: solo los de esta ejecución.
  }
  return enMemoria;
}

export async function GET(peticion: NextRequest) {
  const p = peticion.nextUrl.searchParams;
  const incendioId = p.get("incendioId");
  const tipo = p.get("tipo");
  const agenteId = p.get("agenteId");
  const decisionId = p.get("decisionId");
  const estadoDecision = p.get("estadoDecision");

  let informes = await todosLosInformes();
  if (incendioId) informes = informes.filter((i) => i.incendioId === incendioId);
  if (tipo) informes = informes.filter((i) => i.tipo === tipo);
  if (agenteId) informes = informes.filter((i) => i.agenteId === agenteId);
  if (decisionId) informes = informes.filter((i) => i.decisionId === decisionId);
  if (estadoDecision) informes = informes.filter((i) => i.estadoDecision === estadoDecision);

  informes = informes.sort((a, b) => b.generadoEn.localeCompare(a.generadoEn));

  // Sin el markdown completo: la lista puede ser larga y el detalle está en /api/informes/[id].
  const resumen = informes.map(({ contenido, ...resto }) => ({ ...resto, caracteres: contenido.length }));
  return Response.json({ informes: resumen, total: resumen.length });
}
