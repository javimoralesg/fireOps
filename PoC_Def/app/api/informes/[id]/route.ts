// Un informe completo (markdown). DUEÑO: constructor C.
import type { Informe } from "@/lib/dominio/tipos";
import { obtenerEstado } from "@/lib/motor/estado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request, contexto: { params: Promise<{ id: string }> }) {
  const { id } = await contexto.params;
  let informe: Informe | undefined = obtenerEstado().informes.get(id);

  if (!informe) {
    try {
      const repositorio = (await import("@/lib/db/repositorio")) as { obtenerInforme?: (id: string) => Promise<Informe | undefined> };
      if (typeof repositorio.obtenerInforme === "function") informe = await repositorio.obtenerInforme(id);
    } catch {
      // Sin repositorio.
    }
  }
  if (!informe) return Response.json({ error: `No existe el informe «${id}».` }, { status: 404 });

  const url = new URL(peticion.url);
  if (url.searchParams.get("formato") === "md") {
    return new Response(informe.contenido, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${informe.id}.md"`,
      },
    });
  }
  return Response.json(informe);
}
