// POST /api/camaras/[id]/vigilar {vigilada: boolean} · DUEÑO: constructor B.
// Pone o quita una cámara de la ronda del Vigía. Si la cámara no estaba en el
// estado se trae del catálogo real (nunca se inventa una cámara). Con las
// cámaras fijas apagadas por el escenario del mando no se puede armar una fija
// (409): el vigía no la miraría y el anillo del mapa mentiría.
import { fuenteActiva } from "@/lib/dominio/fuentes-deteccion";
import { camaraPorId } from "@/lib/fuentes/dgtCamaras";
import { obtenerEstado } from "@/lib/motor/estado";

export const dynamic = "force-dynamic";

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: crudo } = await ctx.params;
  const id = decodeURIComponent(crudo);
  let cuerpo: { vigilada?: boolean; vigilar?: boolean; incendioId?: string } = {};
  try {
    cuerpo = (await peticion.json()) as typeof cuerpo;
  } catch {
    return Response.json({ error: "Cuerpo JSON no válido: se espera {vigilada: boolean}" }, { status: 400 });
  }
  if (typeof cuerpo.vigilada !== "boolean" && typeof cuerpo.vigilar === "boolean") cuerpo.vigilada = cuerpo.vigilar;
  if (typeof cuerpo.vigilada !== "boolean") {
    return Response.json({ error: "Falta el campo booleano `vigilada`" }, { status: 400 });
  }

  const estado = obtenerEstado();
  try {
    let camara = estado.camaras.get(id);
    if (!camara) {
      const delCatalogo = await camaraPorId(id);
      if (!delCatalogo) return Response.json({ error: `No existe la cámara ${id}` }, { status: 404 });
      camara = delCatalogo;
      estado.guardar(estado.camaras, camara);
    }
    if (cuerpo.vigilada && camara.fuente !== "Movil" && !fuenteActiva(estado.ejecucion, "camaras_fijas")) {
      return Response.json(
        { error: "Las cámaras fijas están apagadas por el escenario: enciende «Cámaras fijas» en las fuentes de detección (desplegable de ejecución) para vigilarla" },
        { status: 409 },
      );
    }
    const actualizada = estado.actualizar(estado.camaras, camara.id, {
      vigilada: cuerpo.vigilada,
      incendioId: cuerpo.incendioId ?? camara.incendioId,
    });
    estado.registrarEvento("sistema", `${cuerpo.vigilada ? "Vigilando" : "Dejando de vigilar"} la cámara ${camara.nombre}`, {
      agenteId: "vigia_camaras",
      incendioId: cuerpo.incendioId ?? camara.incendioId,
    });
    return Response.json({ camara: actualizada });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
