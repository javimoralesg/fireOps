// POST /api/camaras/movil · fotograma + GPS desde la página /movil. DUEÑO: B.
// Cuerpo: {dispositivoId, nombre?, lat, lon, precisionM?, imagenBase64, mime?}
// Registra/actualiza una Camara "Movil" vigilada y la analiza AL MOMENTO (prioridad
// alta en la cola del modelo de visión): el veredicto vuelve en esta misma respuesta
// si llega en menos de ESPERA_ANALISIS_MS; si no, sigue en segundo plano y el
// teléfono lo recibe en su siguiente envío o sondeo. Cada fotograma se analiza una vez.
import { analizarMovilAlLlegar, conTiempoMaximo } from "@/lib/fuentes/analisisMovilInmediato";
import { registrarFotograma } from "@/lib/fuentes/camarasMovil";
import { obtenerEstado } from "@/lib/motor/estado";

/** Cuánto espera la respuesta al análisis antes de devolver el fotograma como "analizando". */
const ESPERA_ANALISIS_MS = 12_000;

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
    const recibidoEn = new Date().toISOString();
    const { valor: analisis, agotado } = await conTiempoMaximo(analizarMovilAlLlegar(camara.id), ESPERA_ANALISIS_MS);
    return Response.json({
      camaraId: camara.id,
      nombre: camara.nombre,
      punto: camara.punto,
      /** Análisis de ESTE fotograma, o null si aún no está (ver `analizando`). */
      analisis: analisis ?? null,
      /** true si el modelo sigue con este fotograma: el resultado llegará por `ultimoAnalisis`. */
      analizando: agotado,
      ultimoAnalisis: analisis ?? estado.camaras.get(camara.id)?.ultimoAnalisis ?? null,
      recibidoEn,
    });
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    estado.marcarServicio("Móvil en campo", false, detalle);
    return Response.json({ error: detalle }, { status: 400 });
  }
}
