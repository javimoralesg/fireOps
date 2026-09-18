// Latido del periférico: el móvil lo manda cada 10 s con su posición y su modo.
// En línea = latido hace menos de 30 s (lo calcula el registro al servir).

import { body, fallo, ok } from "@/lib/server/http";
import { latido } from "@/lib/server/perifericos/registro";
import type { Capacidad, Periferico, PosicionGeo } from "@/lib/tipos-perifericos";

export const dynamic = "force-dynamic";

const CAPACIDADES: readonly Capacidad[] = ["camara", "gps", "microfono", "brujula", "acelerometro", "publicar"];

interface CuerpoLatido {
  posicion?: unknown;
  capacidades?: unknown;
  modo?: unknown;
  intervaloVigilanciaSeg?: unknown;
  bateria?: unknown; // se acepta por compatibilidad con el móvil; el registro aún no la guarda
}

function normalizarPosicion(x: unknown): PosicionGeo | undefined {
  if (!x || typeof x !== "object") return undefined;
  const p = x as Record<string, unknown>;
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  const precisionM = Number(p.precisionM);
  const rumboGrados = Number(p.rumboGrados);
  return {
    lat,
    lon,
    precisionM: Number.isFinite(precisionM) ? precisionM : undefined,
    rumboGrados: Number.isFinite(rumboGrados) ? ((rumboGrados % 360) + 360) % 360 : undefined,
    timestamp: typeof p.timestamp === "string" && p.timestamp ? p.timestamp : new Date().toISOString(),
  };
}

function normalizarModo(x: unknown): Periferico["modo"] | undefined {
  return x === "manual" || x === "vigilancia" ? x : undefined;
}

/** POST /api/perifericos/[id]/latido → Periferico (404 si no está emparejado). */
export async function POST(req: Request, ctx: RouteContext<"/api/perifericos/[id]/latido">) {
  try {
    const { id } = await ctx.params;
    const b = await body<CuerpoLatido>(req);
    const intervalo = Number(b.intervaloVigilanciaSeg);
    const capacidades = Array.isArray(b.capacidades)
      ? b.capacidades.filter((c): c is Capacidad => typeof c === "string" && CAPACIDADES.includes(c as Capacidad))
      : undefined;
    const p = await latido(id, {
      posicion: normalizarPosicion(b.posicion),
      capacidades,
      modo: normalizarModo(b.modo),
      intervaloVigilanciaSeg: Number.isFinite(intervalo) ? intervalo : undefined,
    });
    if (!p) return fallo("Periférico no encontrado: vuelve a emparejar el móvil", 404);
    return ok(p);
  } catch (err) {
    return fallo(err);
  }
}
