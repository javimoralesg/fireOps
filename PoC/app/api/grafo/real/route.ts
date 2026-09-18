import { construirGrafoReal } from "@/lib/server/grafo-real";
import { INCIDENTE_BASE } from "@/lib/server/escenario";
import { body, fallo, ok } from "@/lib/server/http";
import { aplicarGrafo, obtenerEstado } from "@/lib/server/motor";

export const dynamic = "force-dynamic";

const numero = (v: unknown, porDefecto: number) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : porDefecto;
};

const acotarRadio = (n: number) => Math.max(200, Math.min(5000, n));

/** GET /api/grafo/real?lat=&lon=&radio= — grafo real (OSM) alrededor del punto.
 *  Sin parámetros usa el incidente base (?refrescar=1 ignora la caché en memoria).
 *  Para inspección y sala de periféricos. */
export async function GET(req: Request) {
  try {
    const p = new URL(req.url).searchParams;
    const lat = numero(p.get("lat"), INCIDENTE_BASE.ubicacion.lat);
    const lon = numero(p.get("lon"), INCIDENTE_BASE.ubicacion.lon);
    const radioM = acotarRadio(numero(p.get("radio"), 1200));
    const mismoFoco = lat === INCIDENTE_BASE.ubicacion.lat && lon === INCIDENTE_BASE.ubicacion.lon;
    const grafo = await construirGrafoReal(
      { lat, lon },
      {
        radioM,
        refrescar: p.get("refrescar") === "1",
        incidente: mismoFoco ? { id: INCIDENTE_BASE.id, nombre: INCIDENTE_BASE.titulo } : undefined,
      },
    );
    return ok(grafo);
  } catch (err) {
    return fallo(err, 500);
  }
}

/** POST /api/grafo/real — construye el grafo real (por defecto el incidente del
 *  estado, con su viento real) y lo aplica al motor. Body opcional:
 *  { lat?, lon?, radioM? }. */
export async function POST(req: Request) {
  try {
    const p = await body<{ lat?: number; lon?: number; radioM?: number }>(req);
    const estado = await obtenerEstado();
    const inc = estado.incidente;
    const lat = numero(p.lat, inc.ubicacion.lat);
    const lon = numero(p.lon, inc.ubicacion.lon);
    const radioM = acotarRadio(numero(p.radioM, 1200));
    const propio = lat === inc.ubicacion.lat && lon === inc.ubicacion.lon;
    const viento = estado.entorno?.viento;
    const grafo = await construirGrafoReal(
      { lat, lon },
      {
        radioM,
        incidente: propio ? { id: inc.id, nombre: inc.titulo } : undefined,
        viento: viento ? { direccionGrados: viento.direccionGrados, velocidadKmh: viento.velocidadKmh } : undefined,
      },
    );
    await aplicarGrafo(grafo.nodos, grafo.aristas, grafo.origen);
    return ok({ aplicado: true, origen: grafo.origen, nodos: grafo.nodos.length, aristas: grafo.aristas.length, resumen: grafo.resumen });
  } catch (err) {
    return fallo(err, 500);
  }
}
