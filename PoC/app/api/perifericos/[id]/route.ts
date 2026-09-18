// Cambios y baja de un periférico emparejado (poc-07, subagente B).

import { body, fallo, ok } from "@/lib/server/http";
import { actualizarPeriferico, eliminarPeriferico, obtenerPeriferico } from "@/lib/server/perifericos/registro";
import type { Periferico, TipoPeriferico } from "@/lib/tipos-perifericos";

export const dynamic = "force-dynamic";

const TIPOS: readonly TipoPeriferico[] = ["movil_ciudadano", "camara_fija", "efectivo", "pma", "camara_trafico", "sensor", "webhook"];

type Cambios = Partial<Pick<Periferico, "nombre" | "modo" | "intervaloVigilanciaSeg" | "nodoId" | "tipo">>;

interface CuerpoCambios {
  nombre?: unknown;
  modo?: unknown;
  intervaloVigilanciaSeg?: unknown;
  nodoId?: unknown;
  tipo?: unknown;
}

/** GET /api/perifericos/[id] → Periferico. Cómodo para depurar y para la consola. */
export async function GET(_req: Request, ctx: RouteContext<"/api/perifericos/[id]">) {
  try {
    const { id } = await ctx.params;
    const p = await obtenerPeriferico(id);
    if (!p) return fallo("Periférico no encontrado", 404);
    return ok(p);
  } catch (err) {
    return fallo(err, 500);
  }
}

/** PATCH /api/perifericos/[id] {nombre?, modo?, intervaloVigilanciaSeg?, tipo?, nodoId?} → Periferico. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/perifericos/[id]">) {
  try {
    const { id } = await ctx.params;
    const b = await body<CuerpoCambios>(req);
    const cambios: Cambios = {};
    if (typeof b.nombre === "string" && b.nombre.trim()) cambios.nombre = b.nombre.trim().slice(0, 60);
    if (b.modo === "manual" || b.modo === "vigilancia") cambios.modo = b.modo;
    const intervalo = Number(b.intervaloVigilanciaSeg);
    if (Number.isFinite(intervalo)) cambios.intervaloVigilanciaSeg = Math.max(5, Math.min(120, intervalo));
    if (typeof b.nodoId === "string") cambios.nodoId = b.nodoId || undefined;
    if (typeof b.tipo === "string") {
      if (!TIPOS.includes(b.tipo as TipoPeriferico)) return fallo(`Tipo de periférico no válido (esperado uno de: ${TIPOS.join(", ")})`, 400);
      cambios.tipo = b.tipo as TipoPeriferico;
    }
    if (Object.keys(cambios).length === 0) return fallo("No hay ningún cambio que aplicar", 400);
    const p = await actualizarPeriferico(id, cambios);
    if (!p) return fallo("Periférico no encontrado", 404);
    return ok(p);
  } catch (err) {
    return fallo(err);
  }
}

/** DELETE /api/perifericos/[id] → {ok:true}. El móvil lo llama al "Desconectar". */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/perifericos/[id]">) {
  try {
    const { id } = await ctx.params;
    const borrado = await eliminarPeriferico(id);
    if (!borrado) return fallo("Periférico no encontrado", 404);
    return ok({ ok: true, id });
  } catch (err) {
    return fallo(err);
  }
}
