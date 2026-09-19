// GET /api/auditoria · La cadena completa de una decisión, para auditarlo todo.
// DUEÑO: constructor A.
//   ?decisionId=…  → cadena completa de esa decisión
//   ?incendioId=…&desde=…&hasta=…  → lista cronológica de la ejecución
// Requisito de Javi (2026-09-19): toda decisión y acción debe poder auditarse.
import type { NextRequest } from "next/server";
import { obtenerEstado } from "@/lib/motor/estado";
import { cadenaDe } from "@/lib/motor/auditoria";
import { error, json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: NextRequest): Promise<Response> {
  const p = peticion.nextUrl.searchParams;
  const estado = obtenerEstado();
  const decisionId = p.get("decisionId")?.trim();

  if (decisionId) {
    const d = estado.decisiones.get(decisionId);
    if (!d) return error(`No hay ninguna decisión con id ${decisionId}`, 404);
    return json(await cadenaDe(estado, d));
  }

  // Lista cronológica paginada de la ejecución
  const incendioId = p.get("incendioId")?.trim();
  const desde = p.get("desde")?.trim();
  const hasta = p.get("hasta")?.trim();
  for (const [nombre, valor] of [["desde", desde], ["hasta", hasta]] as const) {
    if (valor && !Number.isFinite(Date.parse(valor))) return error(`${nombre} debe ser una fecha ISO válida`, 400);
  }
  const limiteBruto = Number(p.get("limite") ?? 100);
  const limite = Number.isFinite(limiteBruto) ? Math.max(1, Math.min(500, Math.trunc(limiteBruto))) : 100;
  const desplazamientoBruto = Number(p.get("desplazamiento") ?? 0);
  const desplazamiento = Number.isFinite(desplazamientoBruto) ? Math.max(0, Math.trunc(desplazamientoBruto)) : 0;

  const enRango = (iso: string) => {
    if (desde && Date.parse(iso) < Date.parse(desde)) return false;
    if (hasta && Date.parse(iso) > Date.parse(hasta)) return false;
    return true;
  };

  const decisiones = [...estado.decisiones.values()]
    .filter((d) => (!incendioId || d.incendioId === incendioId) && enRango(d.creadaEn))
    .sort((a, b) => a.creadaEn.localeCompare(b.creadaEn));

  const acciones = decisiones.flatMap((d) =>
    d.acciones.map((a) => ({
      accionId: a.id,
      decisionId: d.id,
      incendioId: d.incendioId,
      tipo: a.tipo,
      descripcion: a.descripcion,
      estado: a.estado,
      autorizadaPor: a.autorizadaPor,
      ordenadaEn: a.ordenadaEn,
      ejecutadaEn: a.ejecutadaEn,
      exito: a.resultado?.exito ?? null,
      proveedor: a.resultado?.proveedor ?? null,
      referencia: a.resultado?.referencia ?? null,
      informeId: a.informeId ?? null,
    })),
  );

  const informes = [...estado.informes.values()]
    .filter((i) => (!incendioId || i.incendioId === incendioId) && enRango(i.generadoEn))
    .sort((a, b) => a.generadoEn.localeCompare(b.generadoEn));

  return json({
    ejecucion: estado.ejecucion,
    filtros: { incendioId: incendioId ?? null, desde: desde ?? null, hasta: hasta ?? null, limite, desplazamiento },
    totales: { decisiones: decisiones.length, acciones: acciones.length, informes: informes.length },
    decisiones: decisiones.slice(desplazamiento, desplazamiento + limite).map((d) => ({
      id: d.id,
      titulo: d.titulo,
      agenteId: d.agenteId,
      incendioId: d.incendioId,
      estado: d.estado,
      competencia: d.competencia,
      riesgo: d.riesgo,
      creadaEn: d.creadaEn,
      creadaEnMundo: d.creadaEnMundo,
      decididaPor: d.decididaPor,
      trazaId: d.trazaId,
      cambiosDeEstado: (d.historial ?? []).length,
      acciones: d.acciones.length,
      informes: (d.informeIds ?? []).length,
    })),
    acciones: acciones.slice(desplazamiento, desplazamiento + limite),
    informes: informes.slice(desplazamiento, desplazamiento + limite).map((i) => ({
      id: i.id,
      tipo: i.tipo,
      titulo: i.titulo,
      decisionId: i.decisionId,
      accionId: i.accionId,
      agenteId: i.agenteId,
      trazaId: i.trazaId,
      estadoDecision: i.estadoDecision,
      conNarrativaIA: i.conNarrativaIA,
      modelo: i.modelo,
      generadoEn: i.generadoEn,
      huella: i.huella,
      caracteres: i.contenido.length,
    })),
  });
}
