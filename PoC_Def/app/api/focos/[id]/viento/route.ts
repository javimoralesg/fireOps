// POST /api/focos/[id]/viento { direccionGrados, vientoKmh, rachasKmh?, quien } · DELETE quita el forzado.
// DUEÑO: sesión orquestadora. Escenario del mando: viento fijado a mano, marcado como forzado.

import { z } from "zod";
import { fijarVientoForzado } from "@/lib/motor/viento-forzado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Cuerpo = z.object({
  direccionGrados: z.number().min(0).max(360),
  vientoKmh: z.number().min(0).max(200),
  rachasKmh: z.number().min(0).max(250).optional(),
  quien: z.string().trim().min(1).max(80).default("mando"),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const datos = Cuerpo.safeParse(await req.json().catch(() => ({})));
  if (!datos.success) return Response.json({ error: "Se esperan direccionGrados (0-360), vientoKmh (0-200) y opcionalmente rachasKmh" }, { status: 422 });
  const { quien, ...viento } = datos.data;
  const incendio = fijarVientoForzado(decodeURIComponent(id), viento, quien);
  if (!incendio) return Response.json({ error: `No existe el incendio «${id}»` }, { status: 404 });
  return Response.json({ incendio });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const quien = new URL(req.url).searchParams.get("quien") ?? "mando";
  const incendio = fijarVientoForzado(decodeURIComponent(id), null, quien);
  if (!incendio) return Response.json({ error: `No existe el incendio «${id}»` }, { status: 404 });
  return Response.json({ incendio });
}
