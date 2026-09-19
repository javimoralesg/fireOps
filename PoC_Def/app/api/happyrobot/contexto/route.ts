// GET|POST /api/happyrobot/contexto · Lo llama el agente de voz de HappyRobot
// mientras habla con el ciudadano (herramienta «consultar_zona» del workflow
// «Atalaya · 112 entrante»), para decirle si ya hay un incendio conocido cerca y
// qué debe hacer. GET con ?texto=&lat=&lon= (compatibilidad); POST con JSON
// {lugar|texto, lat, lon} (es lo que manda el nodo Webhook de la herramienta).
// Solo lectura: no pide el secreto y no muta nada. DUEÑO: constructor D;
// POST añadido por la sesión fireops-82 (2026-09-19).
import { haversine } from "@/lib/fuentes/geo";
import { obtenerEstado } from "@/lib/motor/estado";
import { error, json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Radio en el que se consideran "cerca" los incendios (km). */
const RADIO_KM = 50;

async function responder(texto: string, lat: number, lon: number): Promise<Response> {
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
        ? `Hay ${activos.length} incendio(s) activo(s): ${activos.map((i) => `${i.nombre} en ${i.municipio}`).join(", ")}. Si ve humo o llamas, aléjese en dirección contraria al humo y avise a emergencias.`
        : "No hay ningún incendio activo registrado ahora mismo. Si ve humo o llamas, avise a emergencias.",
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
      consejo: km <= 2 ? "Salga ya de la zona alejándose del humo y avise a emergencias." : km <= 5 ? "Prepárese para salir y esté pendiente del teléfono." : "No se acerque a la zona y deje las carreteras libres.",
    }));

  return json({
    incendiosCercanos: cercanos,
    consejoGeneral: cercanos.length
      ? `El incendio más próximo, ${cercanos[0].nombre}, está a ${cercanos[0].distanciaKm} kilómetros. ${cercanos[0].consejo}`
      : `No hay ningún incendio activo a menos de ${RADIO_KM} kilómetros de esa posición. Si ve humo, descríbame dónde y avisamos a los medios.`,
  });
}

export async function GET(peticion: Request): Promise<Response> {
  const url = new URL(peticion.url);
  const texto = url.searchParams.get("texto")?.trim() ?? url.searchParams.get("lugar")?.trim() ?? "";
  return responder(texto, Number(url.searchParams.get("lat")), Number(url.searchParams.get("lon")));
}

/** Cuerpo del nodo Webhook de la herramienta consultar_zona: {lugar} (o {texto} / {lat, lon}). */
export async function POST(peticion: Request): Promise<Response> {
  let bruto: unknown;
  try {
    bruto = await peticion.json();
  } catch {
    return error("El cuerpo debe ser JSON", 400);
  }
  const c = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const anidado = (c.data ?? c.payload ?? c.arguments) as Record<string, unknown> | undefined;
  const cuerpo = anidado && typeof anidado === "object" && !Array.isArray(anidado) ? { ...anidado, ...c } : c;
  const candidatos = [cuerpo.lugar, cuerpo.texto, cuerpo.municipio, cuerpo.ubicacion, cuerpo.location];
  const texto = candidatos.find((v): v is string => typeof v === "string" && v.trim() !== "" && !/^\{\{\$var:/.test(v.trim()))?.trim() ?? "";
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
  return responder(texto, num(cuerpo.lat ?? cuerpo.latitud), num(cuerpo.lon ?? cuerpo.lng ?? cuerpo.longitud));
}
