// GET /api/happyrobot/contexto?texto=&lat=&lon= · Lo llama el agente de voz de
// HappyRobot mientras habla con el ciudadano, para decirle si ya hay un incendio
// conocido cerca y qué debe hacer. DUEÑO: constructor D.
import { haversine } from "@/lib/fuentes/geo";
import { obtenerEstado } from "@/lib/motor/estado";
import { json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Radio en el que se consideran "cerca" los incendios (km). */
const RADIO_KM = 50;

export async function GET(peticion: Request): Promise<Response> {
  const url = new URL(peticion.url);
  const texto = url.searchParams.get("texto")?.trim() ?? "";
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const punto = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;

  // La centralita (constructor B) es la dueña de este contexto. Si aún no
  // existe la función, se responde con lo que se puede calcular aquí mismo.
  try {
    const { contextoParaVoz } = await import("@/lib/agentes/percepcion/centralita");
    if (typeof contextoParaVoz === "function") {
      const contexto = await contextoParaVoz(punto ?? texto);
      return json(contexto);
    }
  } catch {
    /* se cae al cálculo local de abajo */
  }

  const estado = obtenerEstado();
  const activos = estado.incendiosActivos();
  if (!punto) {
    return json({
      incendiosCercanos: [],
      consejoGeneral: activos.length
        ? `Hay ${activos.length} incendio(s) activo(s): ${activos.map((i) => `${i.nombre} en ${i.municipio}`).join(", ")}. Si ve humo o llamas, aléjese en dirección contraria al humo y llame al 112.`
        : "No hay ningún incendio activo registrado ahora mismo. Si ve humo o llamas, llame al 112.",
    });
  }

  const cercanos = activos
    .map((i) => ({ i, km: haversine(punto, i.centro) }))
    .filter((x) => x.km <= RADIO_KM)
    .sort((a, b) => a.km - b.km)
    .slice(0, 5)
    .map(({ i, km }) => ({
      nombre: i.nombre,
      distanciaKm: +km.toFixed(1),
      estado: i.estado,
      consejo: km <= 2 ? "Salga ya de la zona alejándose del humo y llame al 112." : km <= 5 ? "Prepárese para salir y esté pendiente del teléfono." : "No se acerque a la zona y deje las carreteras libres.",
    }));

  return json({
    incendiosCercanos: cercanos,
    consejoGeneral: cercanos.length
      ? `El incendio más próximo, ${cercanos[0].nombre}, está a ${cercanos[0].distanciaKm} kilómetros. ${cercanos[0].consejo}`
      : `No hay ningún incendio activo a menos de ${RADIO_KM} kilómetros de esa posición. Si ve humo, descríbame dónde y avisamos a los medios.`,
  });
}
