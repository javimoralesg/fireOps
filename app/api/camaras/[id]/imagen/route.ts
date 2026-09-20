// GET /api/camaras/[id]/imagen · proxy del JPEG en vivo. DUEÑO: constructor B.
// Necesario porque el listado de la DGT restringe CORS; la imagen se sirve con
// Cache-Control: no-store para que siempre sea la de ahora mismo. Acepta ?t=.
import { imagenCamara } from "@/lib/fuentes/dgtCamaras";

export const dynamic = "force-dynamic";

export async function GET(_peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const { bytes, mime } = await imagenCamara(decodeURIComponent(id));
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
