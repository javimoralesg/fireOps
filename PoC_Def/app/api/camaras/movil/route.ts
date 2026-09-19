// POST /api/camaras/movil · fotograma + GPS desde la página /movil. DUEÑO: B.
// Cuerpo: {dispositivoId, nombre?, lat, lon, precisionM?, imagenBase64, mime?}
// Registra/actualiza una Camara "Movil" vigilada; el Vigía la analiza en su
// siguiente ciclo (cada fotograma nuevo se analiza una sola vez).
import { registrarFotograma } from "@/lib/fuentes/camarasMovil";
import { obtenerEstado } from "@/lib/motor/estado";

export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  let cuerpo: {
    dispositivoId?: string;
    nombre?: string;
    lat?: number;
    lon?: number;
    precisionM?: number;
    imagenBase64?: string;
    mime?: string;
  };
  try {
    cuerpo = (await peticion.json()) as typeof cuerpo;
  } catch {
    return Response.json({ error: "Cuerpo JSON no válido" }, { status: 400 });
  }
  if (!cuerpo.dispositivoId || !cuerpo.imagenBase64 || typeof cuerpo.lat !== "number" || typeof cuerpo.lon !== "number") {
    return Response.json({ error: "Faltan campos: dispositivoId, lat, lon e imagenBase64 son obligatorios" }, { status: 400 });
  }

  const estado = obtenerEstado();
  try {
    const camara = registrarFotograma(estado, {
      dispositivoId: cuerpo.dispositivoId,
      nombre: cuerpo.nombre,
      lat: cuerpo.lat,
      lon: cuerpo.lon,
      precisionM: cuerpo.precisionM,
      imagenBase64: cuerpo.imagenBase64,
      mime: cuerpo.mime,
    });
    estado.marcarServicio("Móvil en campo", true, `${camara.nombre} enviando desde ${camara.punto.lat.toFixed(4)}, ${camara.punto.lon.toFixed(4)}`);
    return Response.json({
      camaraId: camara.id,
      nombre: camara.nombre,
      punto: camara.punto,
      ultimoAnalisis: camara.ultimoAnalisis ?? null,
      recibidoEn: new Date().toISOString(),
    });
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    estado.marcarServicio("Móvil en campo", false, detalle);
    return Response.json({ error: detalle }, { status: 400 });
  }
}
