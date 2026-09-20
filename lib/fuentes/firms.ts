// =====================================================================
// Focos activos por satélite · NASA FIRMS. DUEÑO: constructor B.
// ---------------------------------------------------------------------
// Endpoint verificado (§2.1):
//   https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{FUENTE}/
//   {oeste,sur,este,norte}/{DIAS}
// · El endpoint por país (/api/country/...) NO existe: siempre bbox.
// · Límite: 5.000 transacciones / 10 min → cacheamos 15 min.
// · Rango de días: 1..5 (MEDIDO 2026-09-19: con 7 o 10 responde 400
//   "Invalid day range. Expects [1..5]"; la documentación decía 10).
// · SIN MAP_KEY no hay datos: se lanza un error claro y el agente satélite
//   marca el servicio en rojo. No hay alternativa sin clave:
//   EFFIS `viirs.hs` responde sin clave pero su WFS devuelve datos de 2019
//   (verificado en muestra-effis-viirs-hs.json) y no admite filtro por fecha,
//   así que NO sirve como fuente de focos activos. EFFIS se usa solo como
//   capa WMS visual (lo pinta el constructor E).
// =====================================================================
import type { FocoSatelite, Punto } from "../dominio/tipos";
import { haversine } from "./geo";
import { enEspana } from "../dominio/espana";

const BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
/**
 * España peninsular + Baleares. Canarias va aparte. Son cajas de PETICIÓN a
 * FIRMS: incluyen Portugal, el sur de Francia y el norte de Marruecos, así que
 * `parsearCsv` descarta con `enEspana` todo píxel fuera del territorio español.
 */
export const BBOX_ESPANA = "-9.5,35.9,4.4,43.9";
export const BBOX_CANARIAS = "-18.3,27.5,-13.3,29.5";
const FUENTES = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT"] as const;
const TIMEOUT_MS = 20_000;
const CACHE_MS = 15 * 60_000;
/** Máximo de días que admite el endpoint de área (medido: `Expects [1..5]`). */
export const MAX_DIAS_FIRMS = 5;

type Global = typeof globalThis & { __atalayaFirms?: Record<string, { en: number; datos: FocoSatelite[] }> };
const g = globalThis as Global;

export const firmsDisponible = (): boolean => Boolean(process.env.FIRMS_MAP_KEY);

const FUENTE_DOMINIO: Record<string, FocoSatelite["fuente"]> = {
  VIIRS_SNPP_NRT: "VIIRS_SNPP",
  VIIRS_NOAA20_NRT: "VIIRS_NOAA20",
  VIIRS_NOAA21_NRT: "VIIRS_NOAA21",
  MODIS_NRT: "MODIS",
};

function confianzaDe(v: string): FocoSatelite["confianza"] {
  const t = (v ?? "").trim().toLowerCase();
  if (t === "h" || t === "high") return "alta";
  if (t === "l" || t === "low") return "baja";
  if (t === "n" || t === "nominal") return "nominal";
  const n = Number(t);
  if (Number.isFinite(n)) return n >= 80 ? "alta" : n >= 30 ? "nominal" : "baja";
  return "nominal";
}

/** `acq_date` (YYYY-MM-DD) + `acq_time` (HHMM UTC) → ISO UTC. */
function fechaHoraDe(fecha: string, hora: string): string {
  const hhmm = (hora ?? "").padStart(4, "0");
  const iso = `${fecha}T${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}:00Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}

function parsearCsv(csv: string, fuenteApi: string): FocoSatelite[] {
  const lineas = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lineas.length < 2) return [];
  const cab = lineas[0].split(",").map((c) => c.trim());
  const idx = (n: string) => cab.indexOf(n);
  const iLat = idx("latitude");
  const iLon = idx("longitude");
  if (iLat < 0 || iLon < 0) throw new Error(`FIRMS: CSV sin columnas latitude/longitude (cabecera: ${lineas[0].slice(0, 120)})`);
  const iFrp = idx("frp");
  const iConf = idx("confidence");
  const iFecha = idx("acq_date");
  const iHora = idx("acq_time");
  const iDn = idx("daynight");

  const focos: FocoSatelite[] = [];
  for (const linea of lineas.slice(1)) {
    const c = linea.split(",");
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // La caja envolvente trae píxeles de Portugal, Francia, Andorra y Marruecos: fuera de España no entra.
    if (!enEspana({ lat, lon })) continue;
    const fechaHora = fechaHoraDe(c[iFecha] ?? "", c[iHora] ?? "");
    focos.push({
      id: `firms:${fuenteApi}:${lat.toFixed(5)},${lon.toFixed(5)}:${fechaHora}`,
      punto: { lat, lon },
      fuente: FUENTE_DOMINIO[fuenteApi] ?? "VIIRS_SNPP",
      frp: Number(c[iFrp]) || 0,
      confianza: confianzaDe(c[iConf] ?? ""),
      fechaHora,
      diaNoche: (c[iDn] ?? "D").trim().toUpperCase() === "N" ? "N" : "D",
    });
  }
  return focos;
}

async function pedirFuente(clave: string, fuente: string, bbox: string, dias: number): Promise<FocoSatelite[]> {
  const url = `${BASE}/${clave}/${fuente}/${bbox}/${dias}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  const texto = await res.text();
  if (!res.ok || /Invalid MAP_KEY|Invalid API call|exceeded/i.test(texto)) {
    throw new Error(`FIRMS ${fuente}: ${res.status} ${texto.slice(0, 160).trim()}`);
  }
  return parsearCsv(texto, fuente);
}

/**
 * Focos activos sobre España en el último día (VIIRS SNPP + NOAA-20).
 * Requiere FIRMS_MAP_KEY. Cacheado 15 min.
 */
export async function focosEspana(opciones: { dias?: number; incluirCanarias?: boolean } = {}): Promise<FocoSatelite[]> {
  const clave = process.env.FIRMS_MAP_KEY;
  if (!clave) {
    throw new Error(
      "FIRMS_MAP_KEY no configurada: no hay detección satelital real. Consíguela en https://firms.modaps.eosdis.nasa.gov/api/map_key/ (llega por email en minutos) y ponla en .env.local.",
    );
  }
  // Caché por (días, Canarias): el agente pide 1 día para el mapa y 5 para
  // reconocer fuentes estáticas; una sola entrada mezclaba las dos consultas.
  const dias = Math.max(1, Math.min(MAX_DIAS_FIRMS, opciones.dias ?? 1));
  const claveCache = `${dias}d:${opciones.incluirCanarias ? "con-canarias" : "peninsula"}`;
  const cache = (g.__atalayaFirms ??= {})[claveCache];
  if (cache && Date.now() - cache.en < CACHE_MS) return cache.datos;

  const cajas = opciones.incluirCanarias ? [BBOX_ESPANA, BBOX_CANARIAS] : [BBOX_ESPANA];
  const tareas: Promise<FocoSatelite[]>[] = [];
  for (const caja of cajas) for (const f of FUENTES) tareas.push(pedirFuente(clave, f, caja, dias));

  const resultados = await Promise.allSettled(tareas);
  const ok = resultados.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<FocoSatelite[]>[];
  if (!ok.length) {
    const err = resultados.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw new Error(`FIRMS no respondió: ${err?.reason instanceof Error ? err.reason.message : err?.reason}`);
  }
  const focos = ok.flatMap((r) => r.value).sort((a, b) => b.fechaHora.localeCompare(a.fechaHora));
  (g.__atalayaFirms ??= {})[claveCache] = { en: Date.now(), datos: focos };
  return focos;
}

/** Agrupa focos cercanos (por defecto < 2 km) y devuelve el centroide y la suma de FRP. */
export function agruparFocos(focos: FocoSatelite[], distanciaKm = 2): { centro: Punto; focos: FocoSatelite[]; frpTotal: number }[] {
  const grupos: { centro: Punto; focos: FocoSatelite[]; frpTotal: number }[] = [];
  for (const f of focos) {
    const grupo = grupos.find((gr) => haversine(gr.centro, f.punto) <= distanciaKm);
    if (grupo) {
      grupo.focos.push(f);
      grupo.frpTotal += f.frp;
      grupo.centro = {
        lat: +(grupo.focos.reduce((s, x) => s + x.punto.lat, 0) / grupo.focos.length).toFixed(5),
        lon: +(grupo.focos.reduce((s, x) => s + x.punto.lon, 0) / grupo.focos.length).toFixed(5),
      };
    } else {
      grupos.push({ centro: { ...f.punto }, focos: [f], frpTotal: f.frp });
    }
  }
  return grupos.sort((a, b) => b.frpTotal - a.frpTotal);
}

/**
 * Días distintos (YYYY-MM-DD, UTC) con algún píxel a menos de `distanciaKm`
 * del punto dentro de un histórico de varios días.
 */
export function diasConDeteccion(centro: Punto, historico: FocoSatelite[], distanciaKm = 2): number {
  const dias = new Set<string>();
  for (const f of historico) if (haversine(centro, f.punto) <= distanciaKm) dias.add(f.fechaHora.slice(0, 10));
  return dias.size;
}

/**
 * Un punto caliente que aparece un día sí y otro también NO es un incendio
 * forestal: es una refinería, una acería, una antorcha o una quema controlada
 * (FIRMS lo llama "other static land source"). MEDIDO 2026-09-19 sobre España:
 * 30 grupos del último día, 14 vistos en ≥ 3 de los últimos 5 días (la Pobla de
 * Mafumet, 64 MW, 10 píxeles, es la refinería de Tarragona: 3 de 5 días). Con
 * este umbral se quedaban fuera exactamente los 14 y ninguno de los que solo
 * habían aparecido ese día.
 */
export const DIAS_FUENTE_ESTATICA = 3;

export function esFuenteEstatica(centro: Punto, historico: FocoSatelite[], distanciaKm = 2): boolean {
  return diasConDeteccion(centro, historico, distanciaKm) >= DIAS_FUENTE_ESTATICA;
}
