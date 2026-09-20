// =====================================================================
// Entorno OSM de un incendio vía Overpass. DUEÑO: constructor B.
// ---------------------------------------------------------------------
// Verificado con curl:
//   POST https://overpass-api.de/api/interpreter  (User-Agent OBLIGATORIO:
//   sin él devuelve 406). Radio 30 km en Ávila: 275 elementos, 113 KB, 4,4 s.
//   (kumi.systems era la alternativa recomendada; se ha retirado, ver abajo.)
//
// TRES consultas SEPARADAS (constructor M, 2026-09-19). Antes eran dos y los
// pueblos viajaban con los parques: si la consulta gorda fallaba o tardaba, el
// foco se quedaba SIN unidades Y SIN pueblos a la vez, y el ataque inicial no
// salía. Ahora cada una falla y se cachea por su cuenta:
//   1) PUEBLOS    `out center tags`: places + ayuntamientos (de donde sale el
//      teléfono de cada pueblo). Medido: 2,5-5,3 s en 30 km.
//   2) MEDIOS     `out center tags`: bomberos, policía, hospitales, centros de
//      salud, colegios, residencias, campings y puntos de agua. De aquí salen
//      LAS UNIDADES, así que es la que se pide PRIMERO. Medido: 3,7-7,4 s.
//   3) SUPERFICIES `out geom` en 5 km: polígonos de combustible. La fracción
//      de cada tipo se calcula sumando el ÁREA APROXIMADA de cada polígono
//      (fórmula del cordón de zapato sobre una proyección equirrectangular
//      local: exacta a estas escalas) y normalizando. Si no sale ningún
//      polígono con geometría se recurre a contar elementos.
// Caché en memoria por (clave redondeada, radio); el mundo físico no cambia
// durante la demo. Si ambos servidores fallan se LANZA el error.
// =====================================================================
import type { Combustible, Hospital, Poblacion, Punto, TipoUnidad } from "../dominio/tipos";
import { haversine } from "./geo";
import { enEspana } from "../dominio/espana";

export type PoblacionBase = Pick<Poblacion, "id" | "nombre" | "centro" | "tipo" | "habitantes" | "municipio" | "telefono" | "email">;
export interface BaseMedios { id: string; nombre: string; punto: Punto; tipo: TipoUnidad; telefono?: string }
export interface EntornoIncendio {
  poblaciones: PoblacionBase[];
  parquesBomberos: BaseMedios[];
  policia: BaseMedios[];
  hospitales: Hospital[];
  vulnerables: { tipo: string; nombre: string; punto: Punto }[];
  aguas: { nombre: string; punto: Punto }[];
  combustible: Combustible;
  url: string;
}

// MEDIDO 2026-09-19 por el constructor M, desde la red de la demo:
//   overpass-api.de  → **CONNECTION REFUSED** en las dos IP (65.109.112.52 y
//                      162.55.144.139). Ni DNS ni firewall local: el servidor
//                      rechaza la conexión. Es la causa raíz de los fallos
//                      (a), (b), (f) y (g) de la última pasada de integración.
//   kumi.systems     → conecta pero no responde (>60 s) a ninguna consulta.
//   private.coffee   → 504 a los 32 s en la consulta pequeña; >90 s en las grandes.
//   osm.ch           → responde 200 en 0,4 s pero con la BASE DE DATOS VACÍA
//                      (`timestamp_osm_base: "117119"`, `elements: []`). Es el
//                      peor caso posible: parece que funciona y devuelve cero
//                      pueblos. Por eso `validar()` rechaza toda respuesta cuyo
//                      `timestamp_osm_base` no sea una fecha reciente.
//   maps.mail.ru     → 200 con datos reales: pueblos 2,5-5,3 s · medios 3,7-7,4 s
//                      · superficies 2,6 s. Es el único espejo sano hoy.
// OJO: esa foto duró horas. Esa misma tarde se midió lo contrario (maps.mail.ru
// colgado, overpass-api.de en 1,5 s). Por eso el orden ya no se escribe a mano:
// lo decide `servidoresOrdenados()` con la latencia medida. Ver el bloque de abajo.
// (overpass-api.de era el PRIMERO de la lista por ser el de referencia; desde
// la 2.ª pasada del constructor T el orden lo manda la salud medida, ver abajo.)
//
// RENDIMIENTO (constructor T, 2026-09-19). El log del servidor estaba lleno de
// `medios 30 km falló en overpass.kumi.systems tras 25002 ms: timeout`: kumi se
// cuelga y se llevaba 25 s en CADA consulta de CADA foco, dos vueltas, tres
// consultas por foco y hasta tres reintentos del enriquecimiento. Se retira de
// la lista (el propio comentario de arriba ya lo daba por muerto) y el resto
// queda protegido por un cortacircuitos por servidor.
// ORDEN Y TOPE POR SERVIDOR.
//
// Esta lista es solo la SEMILLA: el orden real lo decide la latencia medida en
// caliente (ver `preferencias` y `servidoresOrdenados`). Se hizo así porque la
// lista escrita a mano CADUCA, y caduca rápido:
//
//   2026-09-19 (constructor T): maps.mail.ru era el único vivo (7-23 s) y los
//     otros dos estaban muertos. Se puso primero con tope 26 s.
//   2026-09-19, más tarde (fase F3 de la migración): justo al revés. Medido
//     contra los tres espejos: maps.mail.ru se cuelga sin responder (>30 s),
//     private.coffee se cuelga, y overpass-api.de contesta en 1,5 s.
//
// El efecto del orden caducado no era menor: cada consulta empezaba esperando
// 26 s a un servidor muerto antes de llegar al bueno, y un foco hace tres o
// cuatro consultas. Un proceso recién arrancado tardaba MINUTOS en cargar el
// entorno de un foco (medido: el entorno no llegaba en 90 s y el foco se
// quedaba con 0 pueblos). Un proceso con horas de vida iba bien, porque su
// cortacircuitos ya había aprendido a saltarse al muerto.
//
// kumi.systems se ha retirado de la lista: se colgaba >60 s en cada consulta y
// era el origen de casi todos los `falló ... tras 25002 ms` del log.
interface Servidor {
  url: string;
  host: string;
  /** Tope para `out center tags` (pueblos, medios). */
  timeoutMs: number;
  /** Tope para `out geom` (superficies), que siempre tarda más. */
  timeoutGeomMs: number;
}
const SERVIDORES: Servidor[] = [
  // 45 s y no 26 (2026-09-19, foco de Madrid): 30 km alrededor de una ciudad
  // son miles de elementos y una consulta real superó los 26 s. El mismo tope
  // para todos evita convertir esa observación puntual en una preferencia fija:
  // `servidoresOrdenados()` decide en caliente cuál merece ir primero.
  { url: "https://overpass-api.de/api/interpreter", host: "overpass-api.de", timeoutMs: 45_000, timeoutGeomMs: 45_000 },
  { url: "https://maps.mail.ru/osm/tools/overpass/api/interpreter", host: "maps.mail.ru", timeoutMs: 45_000, timeoutGeomMs: 45_000 },
  { url: "https://overpass.private.coffee/api/interpreter", host: "overpass.private.coffee", timeoutMs: 45_000, timeoutGeomMs: 45_000 },
];

/**
 * Tope del PRIMER intento contra un espejo del que todavía no sabemos nada en
 * este proceso. Sin esto, un servidor muerto que esté el primero se come 26 s
 * de presupuesto antes de que nadie aprenda nada. Con historial de éxito, se
 * usa su tope completo: el espejo bueno puede tardar de verdad 20 s en una
 * consulta grande y cortarle a los 8 s sería peor.
 * EXCEPCIÓN: al último candidato se le da el tope completo. Si es el único que
 * queda, más vale esperarle que quedarse sin datos.
 */
const TOPE_SIN_HISTORIAL_MS = 8_000;
const UA = "atalaya-incendios/1.0 (HackSpain 2026; contacto javimorgalis@gmail.com)";
/**
 * Tope del ping de salud. Es una consulta de 1 KB, pero el espejo sano de hoy
 * tarda 8-20 s hasta en eso, así que con 8 s el ping fallaba SIEMPRE y pintaba
 * en rojo un Overpass que estaba sirviendo focos. Con 20 s: la comprobación de
 * salud deja de esperarlo a los 5 s (su propio tope) y el ping SIGUE en marcha
 * en segundo plano; cuando termina deja su resultado en la caché de 60 s, así
 * que el siguiente refresco lo lee en 1 ms y con una medida de verdad.
 */
const TIMEOUT_PING_MS = 20_000;
/**
 * Tope DURO de la consulta completa, servidores incluidos: el último intento se
 * recorta a lo que quede. Antes el peor caso eran 2 vueltas × 4 servidores ×
 * 25 s ≈ 200 s por consulta, y cada foco hace tres. Son 34 s y no 25 porque el
 * único espejo vivo necesita hasta 23 s para contestar DE VERDAD: una consulta
 * de 25 s que siempre falla es peor que una de 30 s que trae las unidades.
 * 62 s desde el 2026-09-19: en un arranque sin historial permite probar dos
 * espejos durante 8 s y todavía reservar 45 s completos al último candidato.
 * Así una consulta urbana grande no pierde el margen que necesita por el mero
 * hecho de que el espejo sano haya quedado tercero en la semilla.
 */
const PRESUPUESTO_MS = 62_000;
/**
 * Una sola vuelta a la lista: el cortacircuitos ya deja fuera al servidor que
 * acaba de fallar, así que una segunda vuelta solo repetiría los saltos.
 */
const VUELTAS = 1;
/**
 * Fallos SEGUIDOS antes de abrir el cortacircuitos por un fallo "blando"
 * (timeout o 5xx). Un solo timeout no prueba que el servidor esté muerto: puede
 * estar cargado, y si es el único sano abrir el interruptor por ese timeout deja
 * a todos los focos sin unidades. Los fallos "duros" (conexión rechazada, DNS,
 * 404, espejo con la base vacía) abren a la primera: ahí no hay duda.
 */
const FALLOS_PARA_ABRIR = 3;
/** Conexión rechazada o DNS: el servidor no está. */
const CORTACIRCUITOS_RED_MS = 5 * 60_000;
/** Timeout repetido: está vivo pero saturado. Castigo corto. */
const CORTACIRCUITOS_LENTO_MS = 2 * 60_000;
/** Un 429/5xx es transitorio: castigo corto. */
const CORTACIRCUITOS_HTTP_MS = 30_000;
/** Un espejo con la base vacía o congelada está roto de verdad: castigo largo. */
const CORTACIRCUITOS_ESPEJO_MS = 10 * 60_000;
/**
 * Castigo al ÚLTIMO espejo que quedaba vivo. Quedarse 5 minutos sin NINGÚN
 * Overpass es peor que volver a preguntar en 90 s, y no es martillear: la caché
 * de fallos (2 min) sigue tapando todas las consultas mientras tanto, así que
 * como mucho sale un intento cada 2 minutos.
 */
const CORTACIRCUITOS_ULTIMO_MS = 90_000;
/** Overpass solo da 2 slots por IP: más de dos consultas a la vez son 429 seguros. */
const MAX_EN_VUELO = 2;
/** Reutilización de una celda vecina del MISMO tipo y radio (tope absoluto). */
const REUTILIZACION_KM = 5;
const RADIO_COMBUSTIBLE_KM = 5;

interface ElementoOsm {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

// ---------------------------------------------------------------------
// Caché, deduplicación de vuelos, cortacircuitos y cola. DUEÑO: constructor T.
// ---------------------------------------------------------------------
// Caché por CELDA y por tipo de consulta: la clave redondea a 0,01° (~1 km),
// así que dos focos del mismo valle comparten entorno y no repiten la consulta.
// Cada tipo se cachea por separado para que el fallo de una no invalide a las otras.
// Se cachean TAMBIÉN los fallos (2 min): el error se propaga igual —el servicio
// sigue en rojo con su motivo, nunca se inventa un dato—, pero no se vuelve a
// llamar a un servidor muerto una vez por foco y por reintento.

interface Celda {
  en: number;
  ttl: number;
  centro: Punto;
  ok: boolean;
  datos?: Respuesta;
  error?: string;
}
interface Respuesta { elementos: ElementoOsm[]; url: string }
interface Vuelo { centro: Punto; promesa: Promise<Respuesta> }

/** Estado de un servidor: fallos seguidos y, si el interruptor está abierto, hasta cuándo. */
interface SaludServidor { fallosSeguidos: number; hasta: number; motivo: string }

type Global = typeof globalThis & {
  __atalayaOverpassCeldas?: Map<string, Celda>;
  __atalayaOverpassVuelos?: Map<string, Vuelo>;
  __atalayaOverpassMuertos?: Map<string, SaludServidor>;
  __atalayaOverpassLatencias?: Map<string, { latenciaMs: number; en: number }>;
  __atalayaOverpassCola?: { enCurso: number; espera: (() => void)[] };
};
const g = globalThis as Global;
const celdas = () => (g.__atalayaOverpassCeldas ??= new Map());
const vuelos = () => (g.__atalayaOverpassVuelos ??= new Map());
const muertos = () => (g.__atalayaOverpassMuertos ??= new Map());
/** Última latencia con la que cada espejo respondió DE VERDAD (solo éxitos). */
const latencias = () => (g.__atalayaOverpassLatencias ??= new Map());
const cola = () => (g.__atalayaOverpassCola ??= { enCurso: 0, espera: [] });
const CACHE_MS = 6 * 60 * 60_000;
/** El mundo físico no cambia, pero un fallo sí: se recuerda solo 2 minutos. */
const CACHE_FALLO_MS = 2 * 60_000;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Cede el bucle de eventos (parseos largos no pueden bloquear al servidor). */
const ceder = () => new Promise<void>((r) => setImmediate(r));
const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

const claveDe = (tipo: string, centro: Punto, radioKm: number) =>
  `${tipo}|${centro.lat.toFixed(2)},${centro.lon.toFixed(2)}@${Math.round(radioKm)}`;

/**
 * Celda utilizable para este centro: la exacta o la de un foco vecino del mismo
 * tipo y radio a menos de 5 km (y nunca a más de un 20 % del radio, para que el
 * recorte del `around` no se note). Los fallos también se comparten: si Overpass
 * no responde para un foco tampoco responde para el de al lado.
 */
function buscarCelda(tipo: string, centro: Punto, radioKm: number): Celda | undefined {
  const tope = Math.min(REUTILIZACION_KM, radioKm * 0.2);
  const prefijo = `${tipo}|`;
  const sufijo = `@${Math.round(radioKm)}`;
  const ahora = Date.now();
  let mejor: Celda | undefined;
  let mejorD = Infinity;
  for (const [clave, c] of celdas()) {
    if (!clave.startsWith(prefijo) || !clave.endsWith(sufijo)) continue;
    if (ahora - c.en >= c.ttl) { celdas().delete(clave); continue; }
    const d = haversine(centro, c.centro);
    if (d > tope || d >= mejorD) continue;
    mejorD = d;
    mejor = c;
  }
  return mejor;
}

/** Vuelo en curso reutilizable (mismo tipo/radio, centro a menos de 5 km). */
function buscarVuelo(tipo: string, centro: Punto, radioKm: number): Promise<Respuesta> | undefined {
  const tope = Math.min(REUTILIZACION_KM, radioKm * 0.2);
  const prefijo = `${tipo}|`;
  const sufijo = `@${Math.round(radioKm)}`;
  for (const [clave, v] of vuelos()) {
    if (!clave.startsWith(prefijo) || !clave.endsWith(sufijo)) continue;
    if (haversine(centro, v.centro) <= tope) return v.promesa;
  }
  return undefined;
}

/** Semáforo global: como mucho dos consultas a Overpass a la vez, el resto en cola. */
async function conRanura<T>(fn: () => Promise<T>): Promise<T> {
  const q = cola();
  if (q.enCurso >= MAX_EN_VUELO) await new Promise<void>((r) => q.espera.push(r));
  q.enCurso += 1;
  try {
    return await fn();
  } finally {
    q.enCurso -= 1;
    q.espera.shift()?.();
  }
}

/** Estado del cortacircuitos, para /api/fuentes/salud. */
export function servidoresOverpass(): { host: string; vivo: boolean; motivo?: string; vuelveEnS?: number }[] {
  const ahora = Date.now();
  return SERVIDORES.map(({ host }) => {
    const m = muertos().get(host);
    if (!m || ahora >= m.hasta) return { host, vivo: true };
    return { host, vivo: false, motivo: m.motivo, vuelveEnS: Math.round((m.hasta - ahora) / 1000) };
  });
}

interface Opciones {
  /** Vigencia del resultado en caché. */
  ttl?: number;
  /** Qué tope por servidor se aplica: el normal, el de `out geom` o el del ping. */
  modo?: "normal" | "geom" | "ping";
  /** Salta la cola (solo para el ping de salud, que es una consulta de 1 KB). */
  sinCola?: boolean;
  /** No mete al servidor en cortacircuitos si falla (ídem: el ping no juzga). */
  sinCastigo?: boolean;
  /**
   * Reintento del entorno de un foco: ignora el fallo recordado en caché y, si
   * todos los espejos están en cortacircuitos, pregunta igualmente al que antes
   * vuelve. Sin esto el primer reintento (a los 60 s) chocaba con el fallo
   * cacheado 2 min y fallaba en 0 ms sin preguntar a nadie.
   */
  forzar?: boolean;
}

/** Opciones que aceptan las consultas públicas (pueblos, medios, combustible). */
export interface OpcionesConsulta {
  forzar?: boolean;
}

/** Tope por intento según el modo, leyendo el que tenga configurado cada servidor. */
function topeSegunModo(modo: Opciones["modo"]): (s: Servidor) => number {
  if (modo === "geom") return (s) => s.timeoutGeomMs;
  if (modo === "ping") return (s) => Math.min(s.timeoutMs, TIMEOUT_PING_MS);
  return (s) => s.timeoutMs;
}

/**
 * Consulta con caché, deduplicación de vuelos y caché de fallos.
 * Devuelve los ELEMENTOS en crudo: cada función pública los interpreta con SU
 * centro, así que reutilizar la celda del vecino no falsea ninguna distancia.
 */
async function elementosDe(
  tipo: string,
  centro: Punto,
  radioKm: number,
  query: string,
  etiqueta: string,
  opciones: Opciones = {},
): Promise<Respuesta> {
  const ttl = opciones.ttl ?? CACHE_MS;
  const c = buscarCelda(tipo, centro, radioKm);
  if (c?.ok && c.datos) return c.datos;
  if (c && !c.ok && !opciones.forzar) throw new Error(c.error ?? `Overpass no disponible (${etiqueta})`);

  const yaEnVuelo = buscarVuelo(tipo, centro, radioKm);
  if (yaEnVuelo) return yaEnVuelo;

  const clave = claveDe(tipo, centro, radioKm);
  const promesa = (async () => {
    try {
      const lanzar = () => consultar(query, etiqueta, topeSegunModo(opciones.modo), opciones.sinCastigo === true, opciones.forzar === true);
      const datos = opciones.sinCola ? await lanzar() : await conRanura(lanzar);
      celdas().set(clave, { en: Date.now(), ttl, centro, ok: true, datos });
      return datos;
    } catch (e) {
      // El fallo se cachea para no martillear, pero SE PROPAGA: el servicio
      // queda en rojo con su motivo literal. Nunca se devuelven datos vacíos.
      celdas().set(clave, { en: Date.now(), ttl: CACHE_FALLO_MS, centro, ok: false, error: mensaje(e) });
      throw e;
    } finally {
      vuelos().delete(clave);
    }
  })();
  vuelos().set(clave, { centro, promesa });
  return promesa;
}

/**
 * Rechaza a los espejos que responden 200 con una base de datos vacía o
 * congelada (caso real: overpass.osm.ch devuelve `timestamp_osm_base:"117119"`
 * y cero elementos). Una respuesta así es PEOR que un error: se tomaría por
 * buena y el foco se quedaría sin pueblos ni parques sin que nadie lo note.
 */
function validar(j: { elements?: ElementoOsm[]; osm3s?: { timestamp_osm_base?: string }; remark?: string }): ElementoOsm[] {
  // Si el servidor corta la consulta por SU tope responde 200 con un `remark`
  // ("runtime error: Query timed out…") y los elementos a medias o ninguno. Darlo
  // por bueno dejaba el foco con 0 pueblos en caché 6 h y sin reintento.
  if (j.remark && /error|timed out|out of memory/i.test(j.remark)) throw new Error(`consulta cortada por el servidor: ${j.remark.slice(0, 160)}`);
  const sello = j.osm3s?.timestamp_osm_base;
  const t = sello ? Date.parse(sello) : NaN;
  if (!Number.isFinite(t)) throw new Error(`respuesta sin sello de base válido (timestamp_osm_base="${sello ?? "—"}"): espejo no fiable`);
  const dias = (Date.now() - t) / 86_400_000;
  if (dias > 30) throw new Error(`base de datos desfasada ${Math.round(dias)} días (${sello}): espejo no fiable`);
  return j.elements ?? [];
}

/**
 * Fallo DURO: el servidor no está o está roto sin remedio. Abre el interruptor
 * a la primera. Un timeout NO entra aquí: un servidor lento sigue sirviendo.
 */
function esFalloDuro(motivo: string): boolean {
  return /econnrefused|enotfound|eai_again|econnreset|fetch failed|espejo no fiable|desfasada|\b40[34]\b/i.test(motivo);
}

/** Ventana en la que una respuesta buena sigue probando que el espejo está vivo. */
const EXITO_RECIENTE_MS = 2 * 60_000;

/**
 * ¿Este fallo "duro" es en realidad la cuota por IP de Overpass?
 * Lo es cuando el espejo nos ha respondido hace nada: un servidor que acaba de
 * mandar datos no ha desaparecido de la red en dos segundos. Un 404 o un espejo
 * con la base desfasada NO entran aquí: eso sí está roto de verdad.
 */
export function esCuotaProbable(host: string, motivo: string): boolean {
  if (/espejo no fiable|desfasada|\b40[34]\b/i.test(motivo)) return false;
  const exito = latencias().get(host);
  return !!exito && Date.now() - exito.en < EXITO_RECIENTE_MS;
}

/** Cuánto castiga el cortacircuitos a un servidor según cómo haya fallado. */
function castigoPara(motivo: string): number {
  if (/espejo no fiable|desfasada/i.test(motivo)) return CORTACIRCUITOS_ESPEJO_MS;
  if (/econnrefused|enotfound|eai_again|econnreset|fetch failed/i.test(motivo)) return CORTACIRCUITOS_RED_MS;
  if (/timeout|abort|etimedout/i.test(motivo)) return CORTACIRCUITOS_LENTO_MS;
  return CORTACIRCUITOS_HTTP_MS;
}

/**
 * Con `forzar`, el espejo al que se pregunta aunque tenga el cortacircuitos
 * abierto: el que antes vuelve, y solo cuando TODOS están abiertos (si queda uno
 * cerrado se le pregunta a ese, como siempre). Así un reintento nunca se gasta
 * sin llegar a preguntar a nadie.
 */
function primeroEnVolver(): Servidor | undefined {
  const ahora = Date.now();
  let mejor: { s: Servidor; hasta: number } | undefined;
  for (const s of SERVIDORES) {
    const m = muertos().get(s.host);
    const hasta = m && ahora < m.hasta ? m.hasta : 0;
    if (hasta === 0) return undefined; // hay uno disponible: no hace falta saltarse nada
    if (!mejor || hasta < mejor.hasta) mejor = { s, hasta };
  }
  return mejor?.s;
}

/**
 * Lanza la consulta contra los servidores por orden hasta que uno responda.
 * Reglas de rendimiento (constructor T):
 *   · El orden lo decide `servidoresOrdenados()` con la latencia MEDIDA en este
 *     proceso, no la lista escrita a mano: el que ya respondió va primero, del
 *     más rápido al más lento, y los que nadie ha probado van detrás en el orden
 *     de la semilla. Se corrige solo cuando un espejo se cae o resucita.
 *   · A un espejo sin historial se le dan TOPE_SIN_HISTORIAL_MS en su primer
 *     intento (salvo que sea el último candidato): un muerto no puede comerse el
 *     presupuesto entero antes de que nadie aprenda nada.
 *   · PRESUPUESTO_MS es un tope DURO de la consulta entera: el último intento
 *     se recorta a lo que quede.
 *   · El cortacircuitos se abre A LA PRIMERA solo ante fallos duros (conexión
 *     rechazada, DNS, 404, espejo con la base vacía). Un timeout o un 5xx
 *     necesitan FALLOS_PARA_ABRIR seguidos: un pico de carga en el único espejo
 *     sano no puede dejar a los focos sin unidades durante minutos.
 *   · Un servidor con el interruptor abierto se SALTA (coste 0 ms).
 *   · Si todos están abiertos se LANZA el error diciéndolo: el servicio queda en
 *     rojo con su motivo, no se devuelve nada inventado.
 */
/**
 * Los espejos, ordenados por lo que han demostrado EN ESTE PROCESO: primero los
 * que han respondido, del más rápido al más lento; después los que no se han
 * probado todavía, en el orden de la semilla. Así el orden se corrige solo
 * cuando un espejo se cae o resucita, sin que nadie tenga que editar la lista.
 */
function servidoresOrdenados(): Servidor[] {
  const medidas = latencias();
  return [...SERVIDORES].sort((a, b) => {
    const la = medidas.get(a.host)?.latenciaMs;
    const lb = medidas.get(b.host)?.latenciaMs;
    if (la !== undefined && lb !== undefined) return la - lb;
    if (la !== undefined) return -1; // el que ya respondió va antes
    if (lb !== undefined) return 1;
    return SERVIDORES.indexOf(a) - SERVIDORES.indexOf(b); // ninguno probado: semilla
  });
}

/** Latencias medidas, para /api/fuentes/salud y para explicar el orden. */
export function latenciasOverpass(): { host: string; latenciaMs?: number; medidaHaceS?: number }[] {
  const ahora = Date.now();
  return servidoresOrdenados().map(({ host }) => {
    const m = latencias().get(host);
    return m ? { host, latenciaMs: m.latenciaMs, medidaHaceS: Math.round((ahora - m.en) / 1000) } : { host };
  });
}

async function consultar(
  query: string,
  etiqueta: string,
  topeDe: (s: Servidor) => number,
  sinCastigo = false,
  forzar = false,
): Promise<Respuesta> {
  const limite = Date.now() + PRESUPUESTO_MS;
  let ultimo: string | undefined;
  const saltados: string[] = [];
  for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
    const orden = servidoresOrdenados();
    for (const [indice, servidor] of orden.entries()) {
      const { url, host } = servidor;
      const salud = muertos().get(host);
      if (salud && Date.now() < salud.hasta && !(forzar && servidor === primeroEnVolver())) {
        saltados.push(`${host} (cortacircuitos ${Math.round((salud.hasta - Date.now()) / 1000)} s: ${salud.motivo})`);
        continue;
      }
      const restante = limite - Date.now();
      if (restante < 1_500) {
        ultimo ??= `sin presupuesto: ${PRESUPUESTO_MS} ms agotados`;
        break;
      }
      const t0 = Date.now();
      try {
        // Probación: a un espejo del que no sabemos nada se le dan
        // TOPE_SIN_HISTORIAL_MS, no su tope completo, para que un muerto no se
        // coma el presupuesto. Al último candidato se le da todo: si es el que
        // queda, más vale esperarle que quedarse sin datos.
        const conHistorial = latencias().has(host);
        const esUltimo = indice === orden.length - 1;
        const tope = conHistorial || esUltimo ? topeDe(servidor) : Math.min(topeDe(servidor), TOPE_SIN_HISTORIAL_MS);
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain; charset=utf-8", "User-Agent": UA, Accept: "application/json" },
          body: query,
          signal: AbortSignal.timeout(Math.min(tope, restante)),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const elementos = validar((await res.json()) as { elements?: ElementoOsm[]; osm3s?: { timestamp_osm_base?: string }; remark?: string });
        muertos().delete(host); // responde: se le borra el historial de fallos
        latencias().set(host, { latenciaMs: Date.now() - t0, en: Date.now() }); // y se anota lo que tardó
        console.log(`[overpass] ${etiqueta} · ${host} · ${Date.now() - t0} ms · ${elementos.length} elementos`);
        return { elementos, url };
      } catch (e) {
        const motivo = mensaje(e);
        ultimo = `${host}: ${motivo}`;
        // El orden: `anotarFallo` ANTES de borrar la latencia, porque necesita saber
        // si este espejo acababa de responder para no castigarlo como si estuviera muerto.
        const nota = anotarFallo(host, motivo, sinCastigo);
        // Y después deja de ser "el rápido": que vuelva a ganárselo respondiendo.
        latencias().delete(host);
        console.warn(`[overpass] ${etiqueta} falló en ${host} tras ${Date.now() - t0} ms: ${motivo}${nota}`);
      }
    }
    if (vuelta < VUELTAS - 1) await dormir(500);
  }
  const detalle = ultimo ?? (saltados.length ? `todos los servidores en cortacircuitos · ${saltados.join(" · ")}` : "sin servidores");
  throw new Error(`Overpass no disponible (${etiqueta}): ${detalle}`);
}

/**
 * Anota el fallo del servidor y abre el interruptor si toca. Devuelve el trozo
 * de texto que se añade al log (vacío si no se ha abierto).
 * El ping de salud NO castiga (`sinCastigo`): una consulta diagnóstica que se
 * cruza con el enriquecimiento de un foco no puede dejar fuera a un espejo.
 */
function anotarFallo(host: string, motivo: string, sinCastigo: boolean): string {
  if (sinCastigo) return "";
  const previo = muertos().get(host);
  const fallosSeguidos = (previo?.fallosSeguidos ?? 0) + 1;

  // Un espejo que acaba de devolver datos NO está muerto: lo que hay es una cuota.
  // Overpass solo da 2 conexiones por IP y RECHAZA LA CONEXIÓN cuando te pasas, lo
  // que llega aquí como `fetch failed` — indistinguible de un servidor caído si solo
  // se mira el mensaje. Medido el 2026-09-19:
  //   pueblos 30 km · overpass-api.de · 1612 ms · 281 elementos
  //   medios  30 km · overpass-api.de ·  152 ms: fetch failed · fuera 300 s
  // 1,6 s entre una cosa y la otra. El castigo de 5 minutos dejaba fuera al ÚNICO
  // espejo sano y tumbaba el enriquecimiento de todos los focos.
  const duro = esFalloDuro(motivo) && !esCuotaProbable(host, motivo);
  if (!duro && fallosSeguidos < FALLOS_PARA_ABRIR) {
    muertos().set(host, { fallosSeguidos, hasta: 0, motivo });
    return ` · fallo ${fallosSeguidos}/${FALLOS_PARA_ABRIR} (aún no se descarta)`;
  }
  // Si era el ÚLTIMO espejo en pie, el castigo se recorta: quedarse sin ninguno
  // durante 5 minutos es peor que volver a preguntar en 90 s.
  const quedanVivos = servidoresOverpass().some((s) => s.vivo && s.host !== host);
  // A una cuota se le aplica el castigo corto de un 429, no el de "no existe".
  const base = esCuotaProbable(host, motivo) ? CORTACIRCUITOS_HTTP_MS : castigoPara(motivo);
  const castigo = quedanVivos ? base : Math.min(base, CORTACIRCUITOS_ULTIMO_MS);
  muertos().set(host, { fallosSeguidos, hasta: Date.now() + castigo, motivo });
  return ` · fuera ${Math.round(castigo / 1000)} s`;
}

const punto = (e: ElementoOsm): Punto | undefined => {
  const lat = e.lat ?? e.center?.lat;
  const lon = e.lon ?? e.center?.lon;
  return typeof lat === "number" && typeof lon === "number" ? { lat, lon } : undefined;
};
const idDe = (e: ElementoOsm) => `osm:${e.type}/${e.id}`;
const telefonoDe = (t: Record<string, string> = {}) => t["phone"] ?? t["contact:phone"] ?? t["contact:mobile"] ?? undefined;
const emailDe = (t: Record<string, string> = {}) => t["email"] ?? t["contact:email"] ?? undefined;

const TIPO_PLACE: Record<string, PoblacionBase["tipo"]> = {
  city: "ciudad",
  town: "pueblo",
  village: "pueblo",
  hamlet: "aldea",
};

/** Área aproximada de un anillo en m² (cordón de zapato en proyección local). */
function areaM2(geom: { lat: number; lon: number }[]): number {
  if (!geom || geom.length < 3) return 0;
  const lat0 = (geom[0].lat * Math.PI) / 180;
  const mLon = 111_320 * Math.cos(lat0);
  const mLat = 110_540;
  let s = 0;
  for (let i = 0; i < geom.length; i++) {
    const a = geom[i];
    const b = geom[(i + 1) % geom.length];
    s += (a.lon * mLon) * (b.lat * mLat) - (b.lon * mLon) * (a.lat * mLat);
  }
  return Math.abs(s) / 2;
}

function clasificarCombustible(t: Record<string, string> = {}): keyof Omit<Combustible, "dominante"> | undefined {
  if (t.landuse === "forest" || t.natural === "wood") return "bosque";
  if (t.natural === "scrub" || t.natural === "heath") return "matorral";
  if (t.natural === "grassland" || t.landuse === "meadow") return "pasto";
  if (t.landuse === "farmland" || t.landuse === "orchard" || t.landuse === "vineyard") return "agricola";
  if (t.landuse === "residential") return "urbano";
  return undefined;
}

const alrededor = (c: Punto, radioM: number) => `(around:${radioM},${c.lat.toFixed(5)},${c.lon.toFixed(5)})`;

/** (1) Pueblos + ayuntamientos: de aquí salen las POBLACIONES y sus teléfonos. */
function consultaPueblos(c: Punto, radioM: number): string {
  const a = alrededor(c, radioM);
  return `[out:json][timeout:44][maxsize:67108864];
(
  node["place"~"^(city|town|village|hamlet)$"]${a};
  nwr["amenity"="townhall"]${a};
);
out center tags;`;
}

/** (2) Medios y puntos sensibles: de aquí salen las UNIDADES (parques, policía, hospitales). */
function consultaMedios(c: Punto, radioM: number): string {
  const a = alrededor(c, radioM);
  // Un solo `nwr` con expresión regular para los amenity: agrupar baja el
  // tiempo de 14 s a 4-7 s frente a una línea por etiqueta (medido).
  return `[out:json][timeout:44][maxsize:67108864];
(
  nwr["amenity"~"^(fire_station|police|hospital|clinic|doctors|school|kindergarten)$"]${a};
  nwr["social_facility"]${a};
  nwr["tourism"="camp_site"]${a};
  nwr["man_made"="water_tower"]${a};
  nwr["landuse"="reservoir"]${a};
);
out center tags;`;
}

/** (3) Superficies de combustible en 5 km. */
function consultaSuperficies(c: Punto, radioM: number): string {
  const a = alrededor(c, radioM);
  return `[out:json][timeout:44][maxsize:67108864];
(
  way["landuse"~"^(forest|farmland|orchard|vineyard|meadow|residential)$"]${a};
  way["natural"~"^(wood|scrub|heath|grassland)$"]${a};
);
out geom;`;
}

/**
 * Fracciones de combustible. ASÍNCRONA a propósito (constructor T): `out geom`
 * en 5 km trae miles de polígonos con su geometría completa y el cálculo de
 * áreas bloqueaba el bucle de eventos del servidor mientras duraba (se notaba
 * en el resto de peticiones). Se cede el hilo cada 250 polígonos.
 */
async function combustibleDe(elementos: ElementoOsm[]): Promise<Combustible> {
  const areas = { bosque: 0, matorral: 0, pasto: 0, agricola: 0, urbano: 0 };
  const cuentas = { ...areas };
  let desde = 0;
  for (const e of elementos) {
    if (++desde % 250 === 0) await ceder();
    const clase = clasificarCombustible(e.tags);
    if (!clase) continue;
    cuentas[clase] += 1;
    areas[clase] += areaM2(e.geometry ?? []);
  }
  const totalArea = Object.values(areas).reduce((a, b) => a + b, 0);
  const totalCuenta = Object.values(cuentas).reduce((a, b) => a + b, 0);
  const base = totalArea > 0 ? areas : cuentas;
  const total = totalArea > 0 ? totalArea : totalCuenta;
  if (total <= 0) {
    // Sin datos OSM de uso del suelo: no inventamos: matorral/pasto a partes iguales
    // es una suposición, así que devolvemos ceros y dominante "pasto" (el más neutro).
    return { bosque: 0, matorral: 0, pasto: 0, agricola: 0, urbano: 0, dominante: "pasto" };
  }
  const f = {
    bosque: +(base.bosque / total).toFixed(3),
    matorral: +(base.matorral / total).toFixed(3),
    pasto: +(base.pasto / total).toFixed(3),
    agricola: +(base.agricola / total).toFixed(3),
    urbano: +(base.urbano / total).toFixed(3),
  };
  const dominante = (Object.entries(f).sort((a, b) => b[1] - a[1])[0][0]) as Combustible["dominante"];
  return { ...f, dominante };
}

// ---------------------------------------------------------------------
// Las tres consultas, cada una cacheada e independiente de las demás
// ---------------------------------------------------------------------

export interface PueblosCercanos { poblaciones: PoblacionBase[]; url: string }
export interface MediosCercanos {
  parquesBomberos: BaseMedios[];
  policia: BaseMedios[];
  hospitales: Hospital[];
  vulnerables: { tipo: string; nombre: string; punto: Punto }[];
  aguas: { nombre: string; punto: Punto }[];
  url: string;
}

/**
 * (1) Poblaciones del radio, ya ordenadas por distancia y con el teléfono del
 * ayuntamiento más cercano (≤ 3 km) cuando OSM lo tiene.
 */
export async function poblacionesCercanas(centro: Punto, radioKm: number, opciones: OpcionesConsulta = {}): Promise<PueblosCercanos> {
  {
    const radioM = Math.round(Math.max(1, Math.min(60, radioKm)) * 1000);
    const { elementos, url } = await elementosDe("pueblos", centro, radioKm, consultaPueblos(centro, radioM), `pueblos ${radioKm} km`, { forzar: opciones.forzar });

    const ayuntamientos: { punto: Punto; nombre: string; telefono?: string; email?: string }[] = [];
    const poblaciones: PoblacionBase[] = [];
    for (const e of elementos) {
      const t = e.tags ?? {};
      const p = punto(e);
      if (!p || !enEspana(p)) continue; // junto a la frontera el radio pisa Portugal o Francia: fuera de España no entra
      const nombre = t.name ?? t["official_name"] ?? "";
      if (t.amenity === "townhall") {
        ayuntamientos.push({ punto: p, nombre: nombre || "Ayuntamiento", telefono: telefonoDe(t), email: emailDe(t) });
        continue;
      }
      if (t.place && TIPO_PLACE[t.place] && nombre) {
        const hab = Number(t.population);
        poblaciones.push({
          id: idDe(e),
          nombre,
          centro: p,
          tipo: TIPO_PLACE[t.place],
          habitantes: Number.isFinite(hab) ? hab : undefined,
          municipio: t["is_in:municipality"] ?? undefined,
        });
      }
    }

    // Teléfono del ayuntamiento más cercano a cada pueblo (≤ 3 km).
    for (const pob of poblaciones) {
      let mejor: { d: number; a: (typeof ayuntamientos)[number] } | undefined;
      for (const a of ayuntamientos) {
        const d = haversine(pob.centro, a.punto);
        if (d <= 3 && (!mejor || d < mejor.d)) mejor = { d, a };
      }
      if (mejor) {
        pob.telefono = mejor.a.telefono;
        pob.email = mejor.a.email;
      }
    }
    poblaciones.sort((a, b) => haversine(centro, a.centro) - haversine(centro, b.centro));
    return { poblaciones, url };
  }
}

/** (2) Parques, policía, hospitales, puntos vulnerables y puntos de agua del radio. */
export async function mediosCercanos(centro: Punto, radioKm: number, opciones: OpcionesConsulta = {}): Promise<MediosCercanos> {
  {
    const radioM = Math.round(Math.max(1, Math.min(60, radioKm)) * 1000);
    const { elementos, url } = await elementosDe("medios", centro, radioKm, consultaMedios(centro, radioM), `medios ${radioKm} km`, { forzar: opciones.forzar });

    const parquesBomberos: BaseMedios[] = [];
    const policia: BaseMedios[] = [];
    const hospitales: Hospital[] = [];
    const vulnerables: { tipo: string; nombre: string; punto: Punto }[] = [];
    const aguas: { nombre: string; punto: Punto }[] = [];

    for (const e of elementos) {
      const t = e.tags ?? {};
      const p = punto(e);
      if (!p || !enEspana(p)) continue; // junto a la frontera el radio pisa Portugal o Francia: fuera de España no entra
      const nombre = t.name ?? t["official_name"] ?? "";

      if (t.amenity === "fire_station") {
        parquesBomberos.push({ id: idDe(e), nombre: nombre || "Parque de bomberos", punto: p, tipo: "bomberos", telefono: telefonoDe(t) });
        continue;
      }
      if (t.amenity === "police") {
        const esGuardiaCivil = /guardia civil/i.test(`${nombre} ${t.operator ?? ""}`);
        policia.push({
          id: idDe(e),
          nombre: nombre || "Puesto de policía",
          punto: p,
          tipo: esGuardiaCivil ? "guardia_civil" : "policia",
          telefono: telefonoDe(t),
        });
        continue;
      }
      if (t.amenity === "hospital" || t.amenity === "clinic" || t.amenity === "doctors") {
        hospitales.push({
          id: idDe(e),
          nombre: nombre || (t.amenity === "hospital" ? "Hospital" : "Centro de salud"),
          punto: p,
          tipo: t.amenity === "hospital" ? "hospital" : "centro_salud",
          telefono: telefonoDe(t),
          distanciaKm: +haversine(centro, p).toFixed(2),
        });
        continue;
      }
      if (t.amenity === "school" || t.amenity === "kindergarten") {
        vulnerables.push({ tipo: "colegio", nombre: nombre || "Centro educativo", punto: p });
        continue;
      }
      if (t.social_facility) {
        const residencia = /nursing_home|assisted_living|group_home/.test(t.social_facility);
        vulnerables.push({ tipo: residencia ? "residencia" : "centro social", nombre: nombre || "Centro social", punto: p });
        continue;
      }
      if (t.tourism === "camp_site") {
        vulnerables.push({ tipo: "camping", nombre: nombre || "Camping", punto: p });
        continue;
      }
      if (t.man_made === "water_tower" || t.landuse === "reservoir" || t.natural === "water") {
        aguas.push({ nombre: nombre || (t.man_made === "water_tower" ? "Depósito de agua" : "Masa de agua"), punto: p });
      }
    }

    hospitales.sort((a, b) => (a.distanciaKm ?? 0) - (b.distanciaKm ?? 0));
    parquesBomberos.sort((a, b) => haversine(centro, a.punto) - haversine(centro, b.punto));
    policia.sort((a, b) => haversine(centro, a.punto) - haversine(centro, b.punto));
    aguas.sort((a, b) => haversine(centro, a.punto) - haversine(centro, b.punto));

    return { parquesBomberos, policia, hospitales, vulnerables, aguas: aguas.slice(0, 60), url };
  }
}

/** (3) Combustible dominante en 5 km a partir de los polígonos de uso del suelo. */
export async function combustibleCercano(centro: Punto, opciones: OpcionesConsulta = {}): Promise<Combustible> {
  const { elementos } = await elementosDe(
    "combustible",
    centro,
    RADIO_COMBUSTIBLE_KM,
    consultaSuperficies(centro, RADIO_COMBUSTIBLE_KM * 1000),
    "superficies 5 km",
    { modo: "geom", forzar: opciones.forzar },
  );
  return combustibleDe(elementos);
}

/** Consulta REAL más reciente que salió bien, con su antigüedad. */
function ultimoExito(): { host: string; hace: number; elementos: number } | undefined {
  let mejor: { host: string; hace: number; elementos: number } | undefined;
  const ahora = Date.now();
  for (const c of celdas().values()) {
    if (!c.ok || !c.datos) continue;
    const hace = ahora - c.en;
    if (!mejor || hace < mejor.hace) mejor = { host: new URL(c.datos.url).host, hace, elementos: c.datos.elementos.length };
  }
  return mejor;
}

/** Ventana en la que una consulta real vale como prueba de que el servicio está vivo. */
const VENTANA_TESTIGO_MS = 30 * 60_000;

/**
 * Comprobación LIGERA para /api/fuentes/salud (constructor T). NO es un dato
 * simulado: es el estado MEDIDO del servicio, por este orden.
 *   1) Si hay una consulta REAL reciente que salió bien (≤ 30 min), esa es la
 *      mejor prueba de que Overpass responde, y sale gratis. El espejo sano de
 *      hoy tarda 8-23 s hasta en una consulta de 1 KB, así que un ping sintético
 *      solo conseguía dos cosas malas: marcar en rojo un servicio que estaba
 *      sirviendo focos y añadir carga a un servidor ya al límite.
 *   2) Si todos los espejos están en cortacircuitos, se LANZA con sus motivos:
 *      rojo con la causa literal, sin llamar a nadie.
 *   3) Si no hay testigo ni cortacircuitos (arranque en frío), se hace la
 *      consulta mínima de verdad. No castiga al espejo ni ocupa ranura: es un
 *      diagnóstico, no puede dejar fuera a nadie. Se cachea 60 s.
 *   4) Si ESE ping falla pero sí hubo una consulta real correcta (aunque sea
 *      vieja), se informa de las dos cosas: el servicio ha servido datos y ahora
 *      va lento. Marcar en rojo un Overpass que acaba de traer 192 pueblos
 *      porque no contesta un ping en 5 s sería tan falso como inventárselo.
 */
export async function pingOverpass(): Promise<string> {
  const servidores = servidoresOverpass();
  const caidos = servidores.filter((s) => !s.vivo);
  const extra = caidos.length ? ` · ${caidos.length} de ${servidores.length} espejo(s) en cortacircuitos` : "";

  const testigo = ultimoExito();
  const edad = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);
  if (testigo && testigo.hace < VENTANA_TESTIGO_MS) {
    return `${testigo.host} respondió hace ${edad(testigo.hace)} (${testigo.elementos} elementos)${extra}`;
  }
  if (!servidores.some((s) => s.vivo)) {
    throw new Error(`Overpass no disponible: ${caidos.map((s) => `${s.host} (${s.vuelveEnS} s: ${s.motivo})`).join(" · ")}`);
  }

  const centro = { lat: 40.66, lon: -4.7 };
  const query = `[out:json][timeout:8];node["place"](around:2000,40.66,-4.70);out ids 5;`;
  try {
    const { elementos, url } = await elementosDe("ping", centro, 2, query, "ping 2 km", { ttl: 60_000, modo: "ping", sinCola: true, sinCastigo: true });
    return `${new URL(url).host} responde (${elementos.length} nodos de referencia)${extra}`;
  } catch (e) {
    if (testigo) return `lento: el ping no contesta (${mensaje(e)}), pero ${testigo.host} sirvió ${testigo.elementos} elementos hace ${edad(testigo.hace)}${extra}`;
    throw e;
  }
}

/**
 * Entorno completo del incendio (las tres consultas EN SERIE). Se conserva
 * para /api/fuentes/entorno y para quien quiera todo de golpe; el
 * enriquecimiento del motor usa las tres funciones por separado para no
 * hacer esperar al ataque inicial.
 */
export async function entornoIncendio(centro: Punto, radioKm: number): Promise<EntornoIncendio> {
  // EN SERIE a propósito: overpass-api.de solo da 2 slots por IP y en paralelo
  // con otras sesiones devuelve 429.
  const medios = await mediosCercanos(centro, radioKm);
  const pueblos = await poblacionesCercanas(centro, radioKm);
  const combustible = await combustibleCercano(centro).catch(async (e) => {
    console.warn("[overpass] superficies falló, combustible sin datos:", mensaje(e));
    return combustibleDe([]);
  });
  return {
    poblaciones: pueblos.poblaciones,
    parquesBomberos: medios.parquesBomberos,
    policia: medios.policia,
    hospitales: medios.hospitales,
    vulnerables: medios.vulnerables,
    aguas: medios.aguas,
    combustible,
    url: medios.url || pueblos.url,
  };
}
