// POST /api/viento { direccionGrados, vientoKmh, rachasKmh?, quien } → fija el viento en TODOS los focos activos.
// DELETE /api/viento?quien= → quita el forzado en todos. DUEÑO: sesión orquestadora.

import { z } from "zod";
import { obtenerEstado } from "@/lib/motor/estado";
import { fijarVientoForzado } from "@/lib/motor/viento-forzado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Cuerpo = z.object({
  direccionGrados: z.number().min(0).max(360),
  vientoKmh: z.number().min(0).max(200),
  rachasKmh: z.number().min(0).max(250).optional(),
  quien: z.string().trim().min(1).max(80).default("mando"),
});

export async function POST(req: Request) {
  const datos = Cuerpo.safeParse(await req.json().catch(() => ({})));
  if (!datos.success) return Response.json({ error: "Se esperan direccionGrados (0-360), vientoKmh (0-200) y opcionalmente rachasKmh" }, { status: 422 });
  const { quien, ...viento } = datos.data;
  const ids = obtenerEstado().incendiosActivos().map((i) => i.id);
  const incendios = ids.map((id) => fijarVientoForzado(id, viento, quien)).filter(Boolean);
  return Response.json({ afectados: incendios.length, incendios });
}

export async function DELETE(req: Request) {
  const quien = new URL(req.url).searchParams.get("quien") ?? "mando";
  const ids = obtenerEstado().incendiosActivos().map((i) => i.id);
  const incendios = ids.map((id) => fijarVientoForzado(id, null, quien)).filter(Boolean);
  return Response.json({ afectados: incendios.length, incendios });
}
