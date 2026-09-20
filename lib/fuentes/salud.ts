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
import { pingOverpass } from "./overpass";
import { ruta } from "./osrm";
import { municipioDe } from "./nominatim";
import { noticiasGoogle } from "./rss";
import { modeloPara, motivoIndisponible, proveedorDisponible } from "../ia/llm";

export interface SaludFuente {
  nombre: string;
  ok: boolean;
  detalle: string;
  ms: number;
  /**
   * La capacidad es deliberadamente opcional y no tiene credenciales en esta
   * instancia. `ok` se mantiene a true para que no se cuente como una caída;
   * el cliente puede distinguirla de una comprobación activa con este campo.
   */
  opcional?: boolean;
}

/** Punto de referencia de las comprobaciones: Ávila capital. */
const REFERENCIA = { lat: 40.66, lon: -4.7 };

// ---------------------------------------------------------------------
// Presupuesto de tiempo (constructor T, 2026-09-19)
// ---------------------------------------------------------------------
// Antes cada comprobación esperaba el timeout de SU fuente (12-25 s) y el
// `Promise.all` esperaba a la más lenta: /api/fuentes/salud se quedaba minutos
// colgado de un espejo muerto. Ahora cada comprobación tiene un tope propio de
// 5 s: pasado ese tiempo la fuente se declara LENTA (en rojo, con el motivo
// literal), que es información verdadera, no un dato inventado. 5 s es holgado
// —ninguna fuente sana pasa de 1 s medida— y a la vez deja el endpoint entero
// por debajo de 6 s en frío, porque todas se comprueban en paralelo.
const TOPE_COMPROBACION_MS = 5_000;
/** Vigencia del resultado completo. Se refresca EN SEGUNDO PLANO. */
const CACHE_MS = 60_000;

/**
 * Un refresco NUNCA debería tardar más que el tope de una comprobación más un
 * poco (todas van en paralelo). Si uno se queda colgado más de esto se le da por
 * perdido y se lanza otro: un guardián de "hay uno en curso" que se atasca deja
 * la barra de estado congelada para siempre, que es justo lo que pasó al
 * medirlo (el mismo `en` en tres peticiones separadas 20 s).
 */
const VUELO_CADUCA_MS = 20_000;

type Global = typeof globalThis & {
  __atalayaSaludCache?: { en: number; fuentes: SaludFuente[] };
  __atalayaSaludEnCurso?: { desde: number; promesa: Promise<SaludFuente[]> };
};
const g = globalThis as Global;

async function medir(nombre: string, fn: () => Promise<string>): Promise<SaludFuente> {
  const t0 = Date.now();
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    const detalle = await Promise.race([
      fn(),
      new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(
          () => rechazar(new Error(`sin respuesta en ${TOPE_COMPROBACION_MS / 1000} s (tope de la comprobación de salud)`)),
          TOPE_COMPROBACION_MS,
        );
      }),
    ]);
    return { nombre, ok: true, detalle, ms: Date.now() - t0 };
  } catch (e) {
    return { nombre, ok: false, detalle: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  } finally {
    // Sin esto quedaban trece temporizadores de 5 s vivos en cada refresco.
    if (temporizador) clearTimeout(temporizador);
  }
}

/** Una integración opcional sin clave no está caída ni debe pintar la sala en rojo. */
function noConfigurada(nombre: string, detalle: string): SaludFuente {
  return { nombre, ok: true, detalle, ms: 0, opcional: true };
}

/**
 * Estado de las fuentes con caché de 60 s y refresco en SEGUNDO PLANO: la
 * petición nunca espera al refresco si ya hay un resultado, y dos peticiones a
 * la vez comparten la misma comprobación (no se duplican las llamadas externas).
 */
export async function comprobarFuentesCacheadas(): Promise<{ fuentes: SaludFuente[]; en: string; delCache: boolean }> {
  const c = g.__atalayaSaludCache;
  const fresco = !!c && Date.now() - c.en < CACHE_MS;
  if (c && !fresco) void refrescar().catch(() => undefined); // refresco en segundo plano
  if (c) return { fuentes: c.fuentes, en: new Date(c.en).toISOString(), delCache: fresco };
  const fuentes = await refrescar();
  return { fuentes, en: new Date(g.__atalayaSaludCache?.en ?? Date.now()).toISOString(), delCache: false };
}

function refrescar(): Promise<SaludFuente[]> {
  // Deduplicación de vuelos: si ya hay una comprobación en curso se comparte...
  const enCurso = g.__atalayaSaludEnCurso;
  if (enCurso && Date.now() - enCurso.desde < VUELO_CADUCA_MS) return enCurso.promesa;
  // ...salvo que se haya quedado colgada: entonces se abandona y se lanza otra.
  const promesa = comprobarFuentes()
    .then((fuentes) => {
      g.__atalayaSaludCache = { en: Date.now(), fuentes };
      return fuentes;
    })
    .finally(() => {
      if (g.__atalayaSaludEnCurso?.promesa === promesa) g.__atalayaSaludEnCurso = undefined;
    });
  g.__atalayaSaludEnCurso = { desde: Date.now(), promesa };
  return promesa;
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
    // Comprobación LIGERA: una consulta mínima (nodos `place` en 2 km) en vez
    // del entorno completo, que eran tres consultas pesadas de hasta 25 s cada
    // una solo para pintar un punto verde.
    medir("Overpass (OSM)", () => pingOverpass()),
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
    firmsDisponible()
      ? medir("NASA FIRMS", async () => `${(await focosEspana()).length} focos activos en España (último día)`)
      : Promise.resolve(noConfigurada("NASA FIRMS", "FIRMS_MAP_KEY no configurada: detección satelital opcional desactivada")),
  ];

  const resultados = await Promise.all(comprobaciones);

  // Servicios que no son peticiones HTTP: solo se informa de si hay clave.
  resultados.push(
    exaDisponible()
      ? { nombre: "Exa", ok: true, detalle: "EXA_API_KEY configurada", ms: 0 }
      : noConfigurada("Exa", "EXA_API_KEY no configurada: búsqueda semántica opcional desactivada (se usa Google News RSS)"),
  );
  resultados.push(
    aemetDisponible()
      ? { nombre: "AEMET", ok: true, detalle: "AEMET_API_KEY configurada", ms: 0 }
      : noConfigurada("AEMET", "AEMET_API_KEY no configurada: fuente opcional desactivada (se usan los avisos de Meteoalarm)"),
  );
  const iaOk = proveedorDisponible("vision");
  resultados.push({
    nombre: "Visión",
    // Sin credencial la capacidad está apagada por decisión de despliegue,
    // no caída. Los fallos de una llamada de visión configurada se marcan en
    // el Vigía con `ok:false`.
    ok: true,
    detalle: iaOk ? `Modelo de visión: ${modeloPara("vision")}` : `Visión opcional desactivada: ${motivoIndisponible("vision") ?? "sin proveedor configurado"}`,
    ms: 0,
    ...(!iaOk ? { opcional: true } : {}),
  });

  return resultados;
}
