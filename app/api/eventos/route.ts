// GET /api/eventos · Histórico del registro vivo. DUEÑO: constructor A.
// Filtros: ?desde=<ISO o id de evento>&incendioId=&nivel=&limite=
import type { NextRequest } from "next/server";
import type { Evento } from "@/lib/dominio/tipos";
import { obtenerEstado } from "@/lib/motor/estado";
import { error, json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NIVELES = new Set(["info", "aviso", "critico"]);

export async function GET(peticion: NextRequest): Promise<Response> {
  const p = peticion.nextUrl.searchParams;
  const desde = p.get("desde")?.trim();
  const incendioId = p.get("incendioId")?.trim();
  const nivel = p.get("nivel")?.trim();
  const limiteBruto = Number(p.get("limite") ?? 200);
  const limite = Number.isFinite(limiteBruto) ? Math.max(1, Math.min(2000, Math.trunc(limiteBruto))) : 200;

  if (nivel && !NIVELES.has(nivel)) return error(`nivel debe ser uno de: ${[...NIVELES].join(", ")}`, 400);

  const estado = obtenerEstado();
  let eventos: Evento[] = estado.eventos;

  if (desde) {
    const porId = eventos.findIndex((e) => e.id === desde);
    if (porId >= 0) {
      eventos = eventos.slice(porId + 1);
    } else {
      const t = Date.parse(desde);
      if (!Number.isFinite(t)) return error("desde debe ser un ISO válido o el id de un evento conocido", 400);
      eventos = eventos.filter((e) => Date.parse(e.en) > t);
    }
  }
  if (incendioId) eventos = eventos.filter((e) => e.incendioId === incendioId);
  if (nivel) eventos = eventos.filter((e) => e.nivel === nivel);

  const recortados = eventos.slice(-limite);
  return json({
    total: eventos.length,
    devueltos: recortados.length,
    ultimoId: recortados.at(-1)?.id,
    eventos: recortados,
  });
}
