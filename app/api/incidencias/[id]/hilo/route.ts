// GET /api/incidencias/[id]/hilo · El hilo ya fusionado y ordenado de una
// incidencia (observaciones, decisiones y cambios de estado, acciones con su
// resultado real, unidades, poblaciones, comunicados y actas), en JSON, para
// exportarlo o consumirlo desde fuera. DUEÑO: constructor G.
import type { NextRequest } from "next/server";
import { obtenerEstado } from "@/lib/motor/estado";
import { error, json } from "@/lib/motor/respuestas";
import { construirHilo, type CategoriaHilo } from "@/components/incidencia/hilo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIAS: CategoriaHilo[] = ["comunicaciones", "decisiones", "unidades", "percepcion", "actas"];

export async function GET(peticion: NextRequest, contexto: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await contexto.params;
  const estado = obtenerEstado();
  const incendio = estado.incendios.get(id);
  if (!incendio) return error(`No hay ninguna incidencia con id ${id}`, 404);

  const snapshot = estado.snapshot();
  let entradas = construirHilo(snapshot, id);

  const p = peticion.nextUrl.searchParams;
  const categoria = p.get("categoria")?.trim() as CategoriaHilo | null;
  if (categoria) {
    if (!CATEGORIAS.includes(categoria)) return error(`categoria debe ser una de: ${CATEGORIAS.join(", ")}`, 400);
    entradas = entradas.filter((e) => e.categoria === categoria);
  }
  const busqueda = p.get("buscar")?.trim().toLowerCase();
  if (busqueda) entradas = entradas.filter((e) => `${e.titulo} ${e.detalle ?? ""} ${e.busqueda}`.toLowerCase().includes(busqueda));

  const limiteBruto = Number(p.get("limite") ?? 500);
  const limite = Number.isFinite(limiteBruto) ? Math.max(1, Math.min(2000, Math.trunc(limiteBruto))) : 500;

  return json({
    incendio: {
      id: incendio.id,
      nombre: incendio.nombre,
      municipio: incendio.municipio,
      provincia: incendio.provincia,
      estado: incendio.estado,
      nivelGravedad: incendio.nivelGravedad,
      areaHa: incendio.areaHa,
      detectadoEn: incendio.detectadoEn,
    },
    ejecucion: { id: estado.ejecucion.id, nombre: estado.ejecucion.nombre },
    horaMundo: estado.reloj.ahoraMundo,
    generadoEn: new Date().toISOString(),
    totales: Object.fromEntries(CATEGORIAS.map((c) => [c, entradas.filter((e) => e.categoria === c).length])),
    total: entradas.length,
    entradas: entradas.slice(0, limite),
  });
}
