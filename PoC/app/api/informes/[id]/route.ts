import { obtenerEstado } from "@/lib/server/motor";
import { fallo, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/informes/[id]            → JSON del informe
 *  GET /api/informes/[id]?formato=md → Markdown descargable */
export async function GET(req: Request, ctx: RouteContext<"/api/informes/[id]">) {
  try {
    const { id } = await ctx.params;
    const e = await obtenerEstado();
    const inf = e.informes.find((i) => i.id === id);
    if (!inf) return fallo(new Error("Informe no encontrado"), 404);
    const formato = new URL(req.url).searchParams.get("formato");
    if (formato === "md") {
      return new Response(inf.markdown, {
        headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${inf.id}.md"`, "cache-control": "no-store" },
      });
    }
    return ok(inf);
  } catch (err) {
    return fallo(err, 500);
  }
}
