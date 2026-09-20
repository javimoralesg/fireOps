// GET /api/fuentes/meteo?lat&lon[&hora][&rejilla=5&radio=15] · DUEÑO: B.
// Diagnóstico y datos reales para la sala de mando: meteo actual, previsión
// horaria interpolada a una hora de mundo, índice de peligro y rejilla de viento.
import { meteoActual, meteoEnHora, previsionHoraria, precipitacionAcumulada, rejillaViento, elevacion } from "@/lib/fuentes/openMeteo";
import { calcularPeligro, regla30_30_30 } from "@/lib/fuentes/peligro";

export const dynamic = "force-dynamic";

/** Número de un parámetro; NaN si no viene (ojo: Number(null) es 0). */
function num(url: URL, nombre: string, porDefecto = NaN): number {
  const v = url.searchParams.get(nombre);
  return v === null || v.trim() === "" ? porDefecto : Number(v);
}


export async function GET(peticion: Request) {
  const url = new URL(peticion.url);
  const lat = num(url, "lat");
  const lon = num(url, "lon");
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json({ error: "Parámetros obligatorios: lat y lon" }, { status: 400 });
  }
  const punto = { lat, lon };
  const hora = url.searchParams.get("hora") ?? new Date().toISOString();
  const n = num(url, "rejilla", 0);
  const radio = num(url, "radio", 15);

  try {
    const [actual, prevision, altura] = await Promise.all([
      meteoActual(punto),
      previsionHoraria(punto),
      elevacion(punto).catch(() => undefined),
    ]);
    const enHora = meteoEnHora(prevision, hora);
    const lluvia24 = precipitacionAcumulada(prevision, hora, 24);
    const peligro = calcularPeligro(enHora, undefined, lluvia24);
    const rejilla = n >= 2 ? await rejillaViento(punto, radio, n).catch(() => undefined) : undefined;

    return Response.json({
      punto,
      elevacionM: altura,
      actual,
      enHora,
      horaConsultada: hora,
      precipitacion24hMm: lluvia24,
      peligro,
      regla30_30_30: regla30_30_30(enHora),
      previsionHoras: prevision.horas.length,
      urlPrevision: prevision.url,
      rejillaViento: rejilla,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
