// =====================================================================
// Salud de las fuentes externas. DUEÑO: constructor B.
// Una petición MÍNIMA a cada fuente, en paralelo, con su latencia real.
// Lo usan /api/fuentes/salud, la barra de estado (A) y los agentes para
// marcar servicios en rojo con `estado.marcarServicio(nombre, ok, detalle)`.
// Nada se simula: si una fuente falla, `ok:false` y el motivo literal.
// =====================================================================
import { avisosMeteoalarmEspana, aemetDisponible } from "./avisos";
import { buscarPosts } from "./bluesky";
import { listarCamarasDgt } from "./dgtCamaras";
import { listarCamarasMadrid } from "./camarasMadrid";
import { exaDisponible } from "./exa";
import { firmsDisponible, focosEspana } from "./firms";
import { meteoActual } from "./openMeteo";
import { entornoIncendio } from "./overpass";
import { ruta } from "./osrm";
import { municipioDe } from "./nominatim";
import { noticiasGoogle } from "./rss";
import { modeloPara, motivoIndisponible, proveedorDisponible } from "../ia/llm";

export interface SaludFuente {
  nombre: string;
  ok: boolean;
  detalle: string;
  ms: number;
}

/** Punto de referencia de las comprobaciones: Ávila capital. */
const REFERENCIA = { lat: 40.66, lon: -4.7 };

async function medir(nombre: string, fn: () => Promise<string>): Promise<SaludFuente> {
  const t0 = Date.now();
  try {
    const detalle = await fn();
    return { nombre, ok: true, detalle, ms: Date.now() - t0 };
  } catch (e) {
    return { nombre, ok: false, detalle: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
}

/** Comprueba todas las fuentes en paralelo y devuelve su estado con latencias. */
export async function comprobarFuentes(): Promise<SaludFuente[]> {
  const comprobaciones: Promise<SaludFuente>[] = [
    medir("Open-Meteo", async () => {
      const m = await meteoActual(REFERENCIA);
      return `${m.temperaturaC} °C, ${m.humedadPct} % HR, viento ${m.vientoKmh} km/h del ${m.direccionTexto}`;
    }),
    medir("Cámaras DGT", async () => `${(await listarCamarasDgt()).length} cámaras en el catálogo`),
    medir("Cámaras Madrid", async () => `${(await listarCamarasMadrid()).length} cámaras en el catálogo`),
    medir("Overpass (OSM)", async () => {
      const e = await entornoIncendio(REFERENCIA, 10);
      return `${e.poblaciones.length} pueblos, ${e.parquesBomberos.length} parques de bomberos, ${e.hospitales.length} centros sanitarios`;
    }),
    medir("OSRM", async () => {
      const r = await ruta(REFERENCIA, { lat: 40.4101, lon: -4.708 });
      return `${(r.distanciaM / 1000).toFixed(1)} km en ${Math.round(r.duracionS / 60)} min`;
    }),
    medir("Nominatim", async () => {
      const m = await municipioDe(REFERENCIA);
      return `${m.municipio}, ${m.provincia}`;
    }),
    medir("Meteoalarm", async () => `${(await avisosMeteoalarmEspana()).length} avisos vigentes en España`),
    medir("Google News", async () => `${(await noticiasGoogle("incendio forestal", 5)).length} titulares`),
    medir("Bluesky", async () => `${(await buscarPosts("incendio forestal", { limite: 5 })).length} publicaciones`),
    medir("NASA FIRMS", async () => {
      if (!firmsDisponible()) throw new Error("FIRMS_MAP_KEY no configurada (sin detección satelital real)");
      return `${(await focosEspana()).length} focos activos en España (último día)`;
    }),
  ];

  const resultados = await Promise.all(comprobaciones);

  // Servicios que no son peticiones HTTP: solo se informa de si hay clave.
  resultados.push({
    nombre: "Exa",
    ok: exaDisponible(),
    detalle: exaDisponible() ? "EXA_API_KEY configurada" : "EXA_API_KEY no configurada (se usa Google News RSS)",
    ms: 0,
  });
  resultados.push({
    nombre: "AEMET",
    ok: aemetDisponible(),
    detalle: aemetDisponible() ? "AEMET_API_KEY configurada" : "AEMET_API_KEY no configurada (se usan los avisos de Meteoalarm)",
    ms: 0,
  });
  const iaOk = proveedorDisponible();
  resultados.push({
    nombre: "Visión",
    ok: iaOk,
    detalle: iaOk ? `Modelo de visión: ${modeloPara("vision")}` : (motivoIndisponible() ?? "Sin proveedor de IA"),
    ms: 0,
  });

  return resultados;
}
