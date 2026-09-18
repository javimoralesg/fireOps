import { esCategoriaId, type AjusteCategoria } from "@/lib/politica-autonomia";
import { exigir, rolDe } from "@/lib/server/autorizacion";
import { body, fallo, ok } from "@/lib/server/http";
import { obtenerEstado } from "@/lib/server/motor";
import { ajustarCategoria, politicaActual, restablecer } from "@/lib/server/politica";

export const dynamic = "force-dynamic";

async function respuesta() {
  const [politica, estado] = await Promise.all([politicaActual(), obtenerEstado()]);
  return ok({ politica, umbralAutonomia: estado.umbralAutonomia });
}

/** GET /api/politica → { politica: PoliticaAutonomia, umbralAutonomia }. El catálogo por defecto vive en lib/politica-autonomia.ts (compartido con la UI). */
export async function GET() {
  try {
    return await respuesta();
  } catch (err) {
    return fallo(err, 500);
  }
}

/**
 * PUT /api/politica { categoria: CategoriaId, ajuste: { modo?, riesgoMinimo?, firmaMinima? } } | { restablecer: true }
 * Permiso: fijar_umbral (misma autoridad que el umbral de autonomía). Devuelve lo mismo que GET.
 */
export async function PUT(req: Request) {
  try {
    const b = await body<{ categoria?: string; ajuste?: AjusteCategoria; restablecer?: boolean; rol?: string }>(req);
    const rol = rolDe(req, b);
    const veto = exigir(rol, "fijar_umbral");
    if (veto) return veto;
    if (b.restablecer) {
      await restablecer(rol);
      return await respuesta();
    }
    if (!esCategoriaId(b.categoria)) return fallo(new Error(`Categoría desconocida: ${String(b.categoria)}`));
    if (!b.ajuste || typeof b.ajuste !== "object") return fallo(new Error("Falta `ajuste` { modo?, riesgoMinimo?, firmaMinima? }"));
    await ajustarCategoria(b.categoria, b.ajuste, rol);
    return await respuesta();
  } catch (err) {
    return fallo(err);
  }
}
