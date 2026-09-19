// =====================================================================
// ATALAYA INCENDIOS · Orquestador (bucle de agentes y ciclo de decisión)
// ---------------------------------------------------------------------
// Propósito: un único bucle en el proceso Node que (1) mueve el reloj de
// mundo, (2) ejecuta los agentes por cadencia o por evento, (3) pasa cada
// decisión propuesta por conocimiento → política → supervisor → humano o
// ejecución, y (4) declara y enriquece focos.
// DUEÑO: constructor A. Este archivo SUSTITUYE al stub manteniendo sus
// firmas públicas (las usan los demás constructores y la API).
//
// Dependencias de otros constructores (todas cargadas con import dinámico
// y envueltas en try/catch: si un módulo aún es un stub o falla, el motor
// sigue vivo y el fallo se ve en la pantalla, nunca se simula).
// =====================================================================

import type {
  Accion,
  NivelGravedad,
  Decision,
  EstadoAgenteApp,
  EstadoIncendio,
  Evento,
  EvaluacionSupervisor,
  FuenteDeteccion,
  Incendio,
  Leccion,
  MetricasEjecucion,
  Observacion,
  OrigenDeteccion,
  Punto,
  TipoEvento,
} from "../dominio/tipos";
import type { Agente, ContextoAgente, ResultadoCiclo } from "./contratos";
import { listaFuentes, normalizarFuentes } from "../dominio/fuentes-deteccion";
import { agenteDesactivadoPorEscenario, quitarPoblacionesDe, sincronizarAgentesConEscenario } from "./escenario";
import { establecerEstado, obtenerEstado, Estado } from "./estado";
import { nuevoId } from "./ids";
import { actualizarReloj, minutosMundoEntre, reiniciarAncla } from "./reloj";
import { areaHaCirculo, distanciaKm, enriquecerIncendio, mensajeDe, RADIO_CAMARAS_KM } from "./enriquecer";
import { areaHa as areaDePoligono } from "../simulacion/geometria";
import { perimetroDeSuperficie } from "../simulacion/propagacion";
import { evaluarCompetencia } from "../dominio/politica";
import { anotarTraza, ejecutarConTraza, resumir, sinTraza, trazaActual } from "./traza";
import { generarActaAccion, generarActaDecision } from "./actas";
import { describirFueraEspana, enEspana } from "../dominio/espana";
import { esServicioDeterminista } from "../dominio/clase-agente";
import { sanearFueraEspana } from "./saneamientoEspana";

// ---------------------------------------------------------------------
// Contrato público (no cambiar: lo usan B, C, D y la API)
// ---------------------------------------------------------------------

export interface DeclaracionFoco {
  punto: Punto;
  nombre?: string;
  origen: OrigenDeteccion;
  observacionId?: string;
  confianza?: number;
  notas?: string;
  quien?: string;
  /** Datos afirmados por la fuente que lo detecta (prensa, parte): se heredan al foco. */
  areaHa?: number;
  nivelGravedad?: NivelGravedad;
  estadoInicial?: EstadoIncendio;
  resumenFuente?: string;
  fuenteDeteccion?: string;
  fuenteUrl?: string;
  mediosExternos?: string;
}

// ---------------------------------------------------------------------
// Singleton de proceso (sobrevive a la recarga en caliente de Next)
// ---------------------------------------------------------------------

interface Nucleo {
  intervalo?: ReturnType<typeof setInterval>;
  agentes: Agente[];
  /** Agentes con un ciclo en marcha (exclusión mutua: nunca se solapan). */
  ocupados: Set<string>;
  /** Cola de despertar: agentes que deben ejecutarse en el próximo tick. */
  cola: Set<string>;
  /** Por qué se despertó cada agente en cola (va a la traza del ciclo). */
  motivoDespertar: Map<string, string>;
  ultimoCicloReal: Map<string, number>;
  ultimoCicloMundo: Map<string, string>;
  desuscribir?: () => void;
  ultimoEventoId?: string;
  arrancado: boolean;
  tickEnCurso: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __atalayaNucleo: Nucleo | undefined;
}

function nucleo(): Nucleo {
  if (!globalThis.__atalayaNucleo) {
    globalThis.__atalayaNucleo = {
      agentes: [],
      ocupados: new Set(),
      cola: new Set(),
      motivoDespertar: new Map(),
      ultimoCicloReal: new Map(),
      ultimoCicloMundo: new Map(),
      arrancado: false,
      tickEnCurso: false,
    };
  }
  return globalThis.__atalayaNucleo;
}

export const TICK_MS = Number(process.env.TICK_MS ?? 5000);
/** Tiempo máximo de un ciclo de agente de razonamiento. */
const LIMITE_RAZONAMIENTO_MS = 90_000;
/** Tiempo máximo del resto de agentes. */
const LIMITE_NORMAL_MS = 30_000;

// ---------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------

function sumarMetrica(estado: Estado, clave: keyof MetricasEjecucion, delta = 1): void {
  const m = estado.ejecucion.metricas as unknown as Record<string, number>;
  m[clave] = (m[clave] ?? 0) + delta;
  estado.tocar();
}

/** Un aborto (pausa global o tiempo máximo) no es una avería del servicio. */
function esAborto(e: unknown): boolean {
  if (e instanceof Error && (e.name === "AbortError" || /abort|pausa/i.test(e.message))) return true;
  return false;
}

/**
 * ¿Este fallo lo provocó el propio mando al pulsar "Parar"?
 *
 * F1.5 de la migración (fallos L-5 y L-6 de docs/PRUEBAS.md). Antes esto se
 * decidía mirando SOLO `estado.reloj.pausado` en el momento del `catch`, y ahí
 * hay una carrera: el aborto se dispara al pausar, pero el `catch` puede correr
 * después de que alguien haya reanudado el mundo. Entonces el aborto se
 * contabilizaba como avería del agente y, a los 5, el supervisor lo pausaba para
 * siempre — medido: pausar tres veces dejaba sin vigía de cámaras y sin asesor
 * legal. La misma carrera dejaba escaladas a un humano, de forma permanente,
 * decisiones que la política marcaba como autónomas.
 *
 * Ahora se pregunta al error, que sí lleva la causa. OJO: "Tiempo máximo agotado"
 * NO entra aquí aunque sea un AbortError — un agente que se pasa de su tiempo sí
 * es un problema del agente y tiene que seguir contando.
 */
export function esPorPausa(e: unknown, estado: Estado): boolean {
  if (estado.reloj.pausado) return true;
  const texto = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /pausa/i.test(texto);
}

function esRazonamiento(agente: Agente): boolean {
  const m = (agente.modelo ?? "").toLowerCase();
  if (!m || m === "determinista") return false;
  if (m.includes("razon")) return true;
  const razonamiento = process.env.LLM_MODELO_RAZONAMIENTO?.trim().toLowerCase();
  return !!razonamiento && m === razonamiento;
}

/**
 * Un agente determinista no llama a ningún modelo: no tiene dónde inyectar una
 * lección, así que pedirlas era tirar un embedding (160-510 ms) y una RPC a
 * Supabase por ciclo. Y los deterministas son los que más ciclan: despachador
 * cada 5 s, satélite, propagación y meteorólogo cada 30-60 s.
 */
function esDeterminista(agente: Agente): boolean {
  // Una sola fuente de verdad con la pantalla (lib/dominio/clase-agente.ts): lo
  // que aquí decide no pedir lecciones es lo mismo que allí se enseña como
  // "entrada determinista".
  return esServicioDeterminista(agente.modelo);
}

/**
 * Hueco mínimo entre dos ciclos del mismo agente disparados POR EVENTO. Sin
 * esto, el coordinador se despertaba con cada `incendio_actualizado` (el
 * enriquecimiento emite dos por foco) e ignoraba por completo su cadencia.
 */
function huecoMinimoMs(agente: Agente): number {
  return Math.max((Math.max(1, agente.cadenciaSeg) * 1000) / 3, 10_000);
}

function limiteMsDe(agente: Agente): number {
  if (agente.tiempoMaximoSeg && agente.tiempoMaximoSeg > 0) return agente.tiempoMaximoSeg * 1000;
  return esRazonamiento(agente) ? LIMITE_RAZONAMIENTO_MS : LIMITE_NORMAL_MS;
}

function tocarFicha(estado: Estado, agenteId: string, cambios: Partial<EstadoAgenteApp>): void {
  if (!estado.agentes.has(agenteId)) return;
  estado.actualizar(estado.agentes, agenteId, cambios);
}

function sumarContador(estado: Estado, agenteId: string, clave: keyof EstadoAgenteApp["contadores"], delta = 1): void {
  const ficha = estado.agentes.get(agenteId);
  if (!ficha) return;
  estado.actualizar(estado.agentes, agenteId, { contadores: { ...ficha.contadores, [clave]: (ficha.contadores[clave] ?? 0) + delta } });
}

/**
 * Cambia el estado de una decisión dejando rastro: añade la entrada al
 * `historial` (quién y por qué) y dispara el acta de auditoría de ese estado.
 * TODO cambio de estado de una decisión debe pasar por aquí.
 */
function cambiarEstadoDecision(
  estado: Estado,
  id: string,
  nuevoEstado: Decision["estado"],
  quien: string,
  motivo?: string,
  otrosCambios: Partial<Decision> = {},
): Decision | undefined {
  const actual = estado.decisiones.get(id);
  if (!actual) return undefined;
  const entrada = {
    en: new Date().toISOString(),
    enMundo: estado.reloj.ahoraMundo,
    estado: nuevoEstado,
    quien,
    motivo,
  };
  const final = estado.actualizar(estado.decisiones, id, {
    ...otrosCambios,
    estado: nuevoEstado,
    historial: [...(actual.historial ?? []), entrada],
  });
  // El acta se redacta en segundo plano: auditar no puede frenar al motor.
  // `sinTraza`: el acta la escribe el redactor, no el agente que cambió el estado;
  // sin esto su llamada a la IA se anotaba en la traza de quien propuso la decisión.
  void sinTraza(() => generarActaDecision(id, nuevoEstado, { quien, motivo }));
  return final;
}

/** Resumen corto de la situación: se usa como contexto para recuperar lecciones. */
function contextoBreve(estado: Estado, agente: Agente): string {
  const activos = estado.incendiosActivos();
  const partes = activos.slice(0, 3).map((i) => `${i.nombre} (${i.municipio || "sin municipio"}, ${i.estado}, nivel ${i.nivelGravedad})`);
  return `${agente.nombre}. ${activos.length} incendios activos. ${partes.join("; ")}`.slice(0, 600);
}

/** Contexto para llamar a agentes de C/D fuera de un ciclo (supervisor, redactor, ejecutor). */
export function contextoParaSistema(agenteId: string, abortSignal?: AbortSignal): ContextoAgente {
  const estado = obtenerEstado();
  return {
    estado,
    snapshot: estado.snapshot(),
    ahoraMundo: estado.reloj.ahoraMundo,
    minutosMundoDesdeUltimoCiclo: 0,
    registrar: (tipo, mensaje, extra) => { estado.registrarEvento(tipo, mensaje, { ...extra, agenteId }); },
    informarTarea: (tarea, incendioId) => tocarFicha(estado, agenteId, { tareaActual: tarea, incendioId }),
    lecciones: [],
    abortSignal: abortSignal ?? new AbortController().signal,
  };
}

// ---- carga perezosa y tolerante de módulos de otros constructores ----

async function cargarLecciones(agenteId: string, contexto: string): Promise<Leccion[]> {
  try {
    const { leccionesPara } = await import("../aprendizaje/memoria");
    return (await leccionesPara(agenteId, contexto)) ?? [];
  } catch {
    return [];
  }
}

async function guardarLeccionRemota(leccion: Leccion): Promise<void> {
  try {
    const { registrarLeccion } = await import("../aprendizaje/memoria");
    await registrarLeccion(leccion);
  } catch {
    /* la lección queda al menos en memoria */
  }
}

// ---------------------------------------------------------------------
// Arranque y bucle
// ---------------------------------------------------------------------

/** Idempotente: se puede llamar tantas veces como haga falta (instrumentation, hot reload, API). */
export function arrancarOrquestador(): void {
  const n = nucleo();
  if (n.arrancado && n.intervalo) return;
  n.arrancado = true;

  const estado = obtenerEstado();
  engancharEventos(estado);

  n.intervalo = setInterval(() => {
    void tick();
  }, TICK_MS);
  // No mantener vivo el proceso solo por el temporizador.
  (n.intervalo as unknown as { unref?: () => void }).unref?.();

  estado.registrarEvento("sistema", `Orquestador en marcha (tick ${TICK_MS} ms, aceleración ×${estado.reloj.factor})`, { nivel: "info" });

  // Registro de agentes + persistencia: en segundo plano para no bloquear el arranque del servidor.
  void (async () => {
    try {
      const { registrarAgentes } = await import("../agentes/registro");
      nucleo().agentes = registrarAgentes(obtenerEstado());
      obtenerEstado().registrarEvento("sistema", `${nucleo().agentes.length} agentes registrados`, { nivel: "info" });
    } catch (e) {
      obtenerEstado().registrarEvento("sistema", `No se pudieron registrar los agentes: ${mensajeDe(e)}`, { nivel: "critico" });
    }
    try {
      const { arrancarPersistencia } = await import("./persistencia");
      await arrancarPersistencia();
      // Lo hidratado de Supabase puede traer focos y medios de fuera de España
      // (anteriores a la restricción): fuera del mapa antes del primer tick.
      await sanearFueraEspana(obtenerEstado(), { forzar: true });
    } catch (e) {
      obtenerEstado().marcarServicio("Supabase", false, mensajeDe(e));
    }
  })();
}

/** Para el bucle (pruebas, cierre limpio). */
export function pararOrquestador(): void {
  const n = nucleo();
  if (n.intervalo) clearInterval(n.intervalo);
  n.intervalo = undefined;
  n.arrancado = false;
  n.desuscribir?.();
  n.desuscribir = undefined;
}

/** Vuelve a leer los índices de agentes (tras crear una ejecución nueva). */
export async function recargarAgentes(): Promise<number> {
  const { registrarAgentes } = await import("../agentes/registro");
  nucleo().agentes = registrarAgentes(obtenerEstado());
  return nucleo().agentes.length;
}

/** Fuerza un ciclo del agente en el próximo tick. `motivo` viaja a la traza. */
export function despertar(agenteId: string, motivo = "manual"): void {
  const n = nucleo();
  n.cola.add(agenteId);
  if (!n.motivoDespertar.has(agenteId)) n.motivoDespertar.set(agenteId, motivo);
}

/** Registra un evento y despierta a quien lo esté esperando. */
export function emitir(tipo: TipoEvento, mensaje: string, extra: Partial<Pick<Evento, "agenteId" | "incendioId" | "nivel" | "datos">> = {}): Evento {
  const evento = obtenerEstado().registrarEvento(tipo, mensaje, extra);
  despertarPorEvento(evento);
  return evento;
}

function despertarPorEvento(evento: Evento): void {
  const n = nucleo();
  for (const agente of n.agentes) {
    if (!agente.despiertaCon?.includes(evento.tipo)) continue;
    if (evento.agenteId && evento.agenteId === agente.id) continue; // no se despierta a sí mismo
    n.cola.add(agente.id);
    if (!n.motivoDespertar.has(agente.id)) n.motivoDespertar.set(agente.id, evento.tipo);
  }
}

/** Se engancha al estado para detectar eventos nuevos y despertar agentes. */
function engancharEventos(estado: Estado): void {
  const n = nucleo();
  n.desuscribir?.();
  n.ultimoEventoId = estado.eventos.at(-1)?.id;
  n.desuscribir = estado.suscribir(() => {
    const nuevos = eventosNuevos(estado);
    for (const ev of nuevos) despertarPorEvento(ev);
  });
}

/** Eventos aparecidos desde la última comprobación (búsqueda acotada hacia atrás). */
function eventosNuevos(estado: Estado): Evento[] {
  const n = nucleo();
  const total = estado.eventos.length;
  if (total === 0) return [];
  const ultimoId = n.ultimoEventoId;
  n.ultimoEventoId = estado.eventos[total - 1].id;
  if (!ultimoId) return [];
  const tope = Math.max(0, total - 300);
  for (let i = total - 1; i >= tope; i--) {
    if (estado.eventos[i].id === ultimoId) return estado.eventos.slice(i + 1);
  }
  return estado.eventos.slice(tope);
}

/** Controladores de los ciclos en curso, para cancelarlos todos al pausar el mundo. */
const controladoresEnCurso = new Map<string, AbortController>();
/** Decisiones cuya evaluación se canceló por la pausa: se reevalúan al reanudar. */
const pendientesDeReevaluar = new Set<string>();
let pausaGlobalAplicada = false;

/**
 * "Parar" para de verdad: ningún agente ejecuta ciclos ni llama a la IA, los ciclos en
 * curso se cancelan y todos aparecen como pausados hasta que se reanude el mundo.
 */
function aplicarPausaGlobal(estado: Estado): void {
  for (const [id, c] of controladoresEnCurso) {
    c.abort();
    controladoresEnCurso.delete(id);
  }
  // Red de seguridad: las llamadas a la IA lanzadas en segundo plano (actas,
  // supervisor a posteriori) no cuelgan de ningún ciclo, así que hay que
  // cortarlas por su propio registro.
  void import("../ia/llm")
    .then((m) => m.abortarLlamadasIA?.("Mundo en pausa"))
    .catch(() => undefined);
  for (const ficha of estado.agentes.values()) {
    if (ficha.estado !== "pausado") tocarFicha(estado, ficha.id, { estado: "pausado", tareaActual: "Mundo en pausa: sin ciclos ni llamadas a la IA" });
  }
  if (!pausaGlobalAplicada) {
    pausaGlobalAplicada = true;
    estado.registrarEvento("sistema", "Mundo en pausa: todos los agentes detenidos", { nivel: "aviso" });
  }
}

function levantarPausaGlobal(estado: Estado): void {
  if (!pausaGlobalAplicada) return;
  pausaGlobalAplicada = false;
  for (const ficha of estado.agentes.values()) {
    // Los abortos provocados por "Parar" no cuentan como errores del agente: se pone el contador a cero
    // para que el supervisor no lo pause "por errores repetidos" al reanudar.
    if (ficha.estado === "pausado" && !ficha.pausado) {
      tocarFicha(estado, ficha.id, { estado: "inactivo", tareaActual: "Reanudado", ultimoError: undefined, contadores: { ...ficha.contadores, errores: 0 } });
    }
  }
  // Decisiones cuya evaluación quedó cancelada por la pausa: vuelven al pipeline.
  for (const id of [...pendientesDeReevaluar]) {
    pendientesDeReevaluar.delete(id);
    const d = estado.decisiones.get(id);
    if (d && d.estado === "propuesta") void sinTraza(() => procesarDecisionPropuesta(d)).catch((e) => console.error("[orquestador] reevaluación tras pausa", e));
  }
  estado.registrarEvento("sistema", "Mundo reanudado: los agentes vuelven a trabajar", { nivel: "info" });
}

/** true si el mundo está en pausa (los agentes lo consultan para no seguir trabajando). */
export function mundoEnPausa(): boolean {
  return obtenerEstado().reloj.pausado;
}

async function tick(): Promise<void> {
  const n = nucleo();
  if (n.tickEnCurso) return;
  n.tickEnCurso = true;
  try {
    const estado = obtenerEstado();
    estado.reloj.tick += 1;
    actualizarReloj(estado);
    if (estado.reloj.pausado) {
      aplicarPausaGlobal(estado);
      return;
    }
    levantarPausaGlobal(estado);
    caducarPendientes(estado);
    void podarMemoria(estado);
    // Fuentes apagadas por el escenario del mando (lib/motor/escenario.ts): sus
    // agentes no corren y sus fichas lo dicen. Se comprueba AQUÍ y no en
    // `ejecutarCiclo` porque todas las demás entradas (despertar, reanudar,
    // forzar ciclo) solo encolan: este bucle es el único sitio que arranca ciclos.
    sincronizarAgentesConEscenario(estado);
    // Ámbito España (lib/motor/saneamientoEspana.ts): descarta lo que quede
    // fuera del territorio. Barato: deja un minuto entre pasadas.
    void sanearFueraEspana(estado);

    const ahoraReal = Date.now();
    for (const agente of n.agentes) {
      const ficha = estado.agentes.get(agente.id);
      if (!ficha || ficha.pausado) continue;
      if (agenteDesactivadoPorEscenario(estado.ejecucion, agente.id)) {
        // Sin vaciar la cola, /api/salud lo enseñaría "en cola" para siempre.
        n.cola.delete(agente.id);
        n.motivoDespertar.delete(agente.id);
        continue;
      }
      if (n.ocupados.has(agente.id)) continue; // exclusión mutua
      const despertado = n.cola.has(agente.id);
      const ultimo = n.ultimoCicloReal.get(agente.id) ?? 0;
      const vencido = ahoraReal - ultimo >= Math.max(1, agente.cadenciaSeg) * 1000;
      if (!despertado && !vencido) continue;
      // Despertado por evento demasiado pronto: NO se descarta, se deja en la
      // cola y entrará en un tick posterior, cuando haya pasado el hueco mínimo.
      if (despertado && !vencido && ahoraReal - ultimo < huecoMinimoMs(agente)) continue;
      const motivo = despertado ? n.motivoDespertar.get(agente.id) ?? "evento" : "cadencia";
      n.cola.delete(agente.id);
      n.motivoDespertar.delete(agente.id);
      void ejecutarCiclo(estado, agente, despertado, motivo);
    }
  } catch (e) {
    console.error("[orquestador] fallo en el tick", e);
  } finally {
    n.tickEnCurso = false;
  }
}

// ---------------------------------------------------------------------
// Ciclo de un agente
// ---------------------------------------------------------------------

/**
 * Una frase con lo que el agente tiene delante al empezar el ciclo (va a la traza).
 * Se memoriza durante un tick: recorre incendios, unidades, decisiones y
 * poblaciones, y en un mismo tick pueden arrancar varios agentes con la misma foto.
 */
let entradasCache: { en: number; version: number; texto: string } | undefined;

function entradasDe(estado: Estado): string {
  if (entradasCache && entradasCache.version === estado.version && Date.now() - entradasCache.en < TICK_MS) {
    return entradasCache.texto;
  }
  const texto = calcularEntradas(estado);
  entradasCache = { en: Date.now(), version: estado.version, texto };
  return texto;
}

function calcularEntradas(estado: Estado): string {
  const activos = estado.incendiosActivos();
  const libres = [...estado.unidades.values()].filter((u) => u.estado === "disponible").length;
  const pendientes = estado.decisionesPendientesHumano().length;
  const enPeligro = [...estado.poblaciones.values()].filter((p) => p.riesgo === "alto" || p.riesgo === "inminente").length;
  const viento = activos[0]?.meteo ? `viento ${activos[0].meteo.direccionTexto} ${Math.round(activos[0].meteo.vientoKmh)} km/h` : "sin meteo";
  return `${activos.length} incendios activos, ${libres} unidades libres, ${pendientes} decisiones pendientes, ${enPeligro} poblaciones en riesgo, ${viento}`;
}

async function ejecutarCiclo(estado: Estado, agente: Agente, despertado: boolean, motivo: string): Promise<void> {
  const n = nucleo();
  n.ocupados.add(agente.id);
  n.ultimoCicloReal.set(agente.id, Date.now());

  const controlador = new AbortController();
  controladoresEnCurso.set(agente.id, controlador);
  const limite = limiteMsDe(agente);
  const desde = n.ultimoCicloMundo.get(agente.id) ?? estado.reloj.ahoraMundo;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  /**
   * La promesa REAL del ciclo (no la del `Promise.race`). Si el agente ignora
   * `abortSignal`, al saltar el tiempo máximo seguía corriendo mientras el
   * `finally` lo sacaba de `ocupados`: el siguiente tick arrancaba una segunda
   * copia y se apilaban agotando los huecos de LLM. Ahora el agente no se libera
   * hasta que ESTA promesa se asienta.
   */
  let promesaCiclo: Promise<unknown> | undefined;

  tocarFicha(estado, agente.id, {
    estado: esRazonamiento(agente) ? "razonando" : "observando",
    ultimaActividad: new Date().toISOString(),
    ultimoError: undefined,
    tareaActual: despertado ? `Despertado por ${motivo}` : undefined,
  });

  try {
    // La traza envuelve TODO el ciclo, incluido el Promise.race: si salta el
    // tiempo máximo, se cierra como "cancelado" y se ve en el visor del agente.
    await ejecutarConTraza(estado, agente.id, motivo, async () => {
      anotarTraza({ entradas: resumir(entradasDe(estado)) });

      // Los deterministas no tienen prompt: pedir lecciones solo gastaba un
      // embedding y una RPC por ciclo (ver `esDeterminista`).
      const lecciones = esDeterminista(agente) ? [] : await cargarLecciones(agente.id, contextoBreve(estado, agente));

      const ctx: ContextoAgente = {
        estado,
        snapshot: estado.snapshot(),
        ahoraMundo: estado.reloj.ahoraMundo,
        minutosMundoDesdeUltimoCiclo: minutosMundoEntre(desde, estado.reloj.ahoraMundo),
        registrar: (tipo, mensaje, extra) => { estado.registrarEvento(tipo, mensaje, { ...extra, agenteId: agente.id }); },
        informarTarea: (tarea, incendioId) => tocarFicha(estado, agente.id, { tareaActual: tarea, incendioId }),
        lecciones,
        abortSignal: controlador.signal,
      };

      promesaCiclo = Promise.resolve(agente.ciclo(ctx));
      // Sin este `catch` de cortesía, el rechazo tardío del ciclo (cuando el
      // race ya devolvió) saldría como "unhandled rejection".
      void promesaCiclo.catch(() => undefined);

      const resultado = (await Promise.race([
        promesaCiclo,
        new Promise<never>((_, rechazar) => {
          temporizador = setTimeout(() => {
            controlador.abort();
            const fallo = new Error(`Tiempo máximo agotado (${Math.round(limite / 1000)} s)`);
            fallo.name = "AbortError"; // la traza lo marca como "cancelado", no como error del agente
            rechazar(fallo);
          }, limite);
        }),
      ])) as ResultadoCiclo | void;

      sumarContador(estado, agente.id, "ciclos");
      const producido = await procesarResultado(estado, agente, (resultado ?? undefined) as ResultadoCiclo | undefined);
      anotarTraza({
        resumen: (resultado as ResultadoCiclo | undefined)?.resumen,
        decisiones: producido.decisiones,
        observaciones: producido.observaciones,
        eventos: producido.eventos,
      });

      tocarFicha(estado, agente.id, {
        estado: estado.agentes.get(agente.id)?.pausado ? "pausado" : "observando",
        tareaActual: (resultado as ResultadoCiclo | undefined)?.resumen,
        ultimaActividad: new Date().toISOString(),
      });
    });
  } catch (e) {
    controlador.abort();
    if (esPorPausa(e, estado)) {
      // Cancelado por la pausa global: no es un error del agente (fallo L-6).
      tocarFicha(estado, agente.id, { estado: "pausado", tareaActual: "Mundo en pausa: ciclo cancelado", ultimaActividad: new Date().toISOString() });
    } else {
      sumarContador(estado, agente.id, "errores");
      const mensaje = mensajeDe(e);
      tocarFicha(estado, agente.id, { estado: "error", ultimoError: mensaje, ultimaActividad: new Date().toISOString() });
      estado.registrarEvento("agente", `${agente.nombre}: ${mensaje}`, { agenteId: agente.id, nivel: "aviso" });
    }
  } finally {
    if (temporizador) clearTimeout(temporizador);
    controladoresEnCurso.delete(agente.id);
    n.ultimoCicloMundo.set(agente.id, estado.reloj.ahoraMundo);

    // Exclusión mutua de verdad: se libera cuando termina el ciclo REAL, no
    // cuando vence el Promise.race. Si el agente ignoró el abort y sigue vivo,
    // el orquestador se salta sus turnos hasta que acabe (y lo deja escrito).
    // Nota: `ultimoCicloReal` se dejó sellado al ARRANCAR el ciclo, para no
    // alargar la cadencia con la duración del propio ciclo.
    const liberar = () => n.ocupados.delete(agente.id);
    if (promesaCiclo) {
      const tardio = Date.now();
      void promesaCiclo.then(
        () => { avisarSiTardio(agente, tardio); liberar(); },
        () => { avisarSiTardio(agente, tardio); liberar(); },
      );
    } else {
      liberar();
    }
  }
}

/** Deja constancia en consola de un ciclo que siguió vivo después del tiempo máximo. */
function avisarSiTardio(agente: Agente, desde: number): void {
  const extra = Date.now() - desde;
  if (extra > 1000) {
    console.warn(`[orquestador] ${agente.id}: el ciclo siguió ${Math.round(extra / 1000)} s tras cerrarse la traza (ignora abortSignal); no se ha solapado con otro`);
  }
}

interface ProducidoPorCiclo { decisiones: string[]; observaciones: string[]; eventos: number }

async function procesarResultado(estado: Estado, agente: Agente, resultado?: ResultadoCiclo): Promise<ProducidoPorCiclo> {
  const producido: ProducidoPorCiclo = { decisiones: [], observaciones: [], eventos: 0 };
  if (!resultado) return producido;

  // Observaciones
  for (const bruta of resultado.observaciones ?? []) {
    const o: Observacion = { ...bruta, id: bruta.id || nuevoId("obs"), recibidaEn: bruta.recibidaEn || new Date().toISOString() };
    estado.guardar(estado.observaciones, o);
    producido.observaciones.push(o.id);
    const grave = o.extraccion?.gravedad === "grave" || o.extraccion?.gravedad === "critica";
    estado.registrarEvento("observacion", `${agente.nombre}: ${o.extraccion?.resumen ?? o.texto.slice(0, 160)}`, {
      agenteId: agente.id,
      incendioId: o.incendioId,
      nivel: grave ? "aviso" : "info",
      datos: { observacionId: o.id, canal: o.canal },
    });
  }

  // Eventos del agente
  for (const ev of resultado.eventos ?? []) {
    estado.registrarEvento(ev.tipo, ev.mensaje, { agenteId: ev.agenteId ?? agente.id, incendioId: ev.incendioId, nivel: ev.nivel, datos: ev.datos });
    producido.eventos += 1;
  }

  // Lecciones
  for (const bruta of resultado.lecciones ?? []) {
    const l: Leccion = { ...bruta, id: bruta.id || nuevoId("lec"), ejecucionId: bruta.ejecucionId || estado.ejecucion.id, creadaEn: bruta.creadaEn || new Date().toISOString() };
    estado.guardar(estado.lecciones, l);
    estado.registrarEvento("leccion", `Lección aprendida (${l.categoria}): ${l.texto}`, { agenteId: agente.id, nivel: "info", datos: { leccionId: l.id } });
    void guardarLeccionRemota(l);
  }

  // Decisiones (lo más caro: secuencial y tolerante)
  const decisiones = resultado.decisiones ?? [];
  if (decisiones.length) {
    tocarFicha(estado, agente.id, { estado: "actuando", tareaActual: `Proponiendo ${decisiones.length} decisión(es)` });
    for (const d of decisiones) {
      try {
        const procesada = await procesarDecisionPropuesta({ ...d, agenteId: d.agenteId || agente.id });
        producido.decisiones.push(procesada.id);
        sumarContador(estado, agente.id, "decisiones");
      } catch (e) {
        estado.registrarEvento("agente", `No se pudo procesar una decisión de ${agente.nombre}: ${mensajeDe(e)}`, { agenteId: agente.id, nivel: "aviso" });
      }
    }
  }
  return producido;
}

// ---------------------------------------------------------------------
// Ciclo de vida de una decisión
// ---------------------------------------------------------------------

/**
 * Pipeline: normaliza → guarda (la pantalla la ve ya) → fundamentos legales →
 * política de autonomía → supervisor → enrutado (autónoma / humano / escalada).
 * Cada paso es tolerante: un fallo nunca deja la decisión en el limbo.
 */
export async function procesarDecisionPropuesta(decision: Decision): Promise<Decision> {
  const estado = obtenerEstado();
  const ahoraReal = new Date().toISOString();

  const d: Decision = {
    ...decision,
    id: decision.id || nuevoId("dec"),
    ejecucionId: decision.ejecucionId || estado.ejecucion.id,
    creadaEn: decision.creadaEn || ahoraReal,
    creadaEnMundo: decision.creadaEnMundo || estado.reloj.ahoraMundo,
    estado: "propuesta",
    prioridad: decision.prioridad ?? 3,
    riesgo: decision.riesgo ?? 0,
    competencia: decision.competencia ?? "autonoma",
    acciones: (decision.acciones ?? []).map((a) => ({
      ...a,
      id: a.id || nuevoId("acc"),
      estado: a.estado ?? "pendiente",
      parametros: a.parametros ?? {},
    })),
    evidencias: decision.evidencias ?? [],
    fundamentos: decision.fundamentos ?? [],
    // Sello de auditoría: qué ciclo de qué agente la produjo.
    trazaId: decision.trazaId ?? trazaActual()?.id,
    informeIds: decision.informeIds ?? [],
    historial: decision.historial ?? [
      { en: ahoraReal, enMundo: estado.reloj.ahoraMundo, estado: "propuesta" as const, quien: decision.agenteId, motivo: "Propuesta por el agente" },
    ],
  };
  estado.guardar(estado.decisiones, d);
  void sinTraza(() => generarActaDecision(d.id, "propuesta", { quien: d.agenteId, motivo: "Propuesta por el agente" }));
  sumarMetrica(estado, "decisionesPropuestas");
  estado.registrarEvento("decision_propuesta", `${d.titulo}`, {
    agenteId: d.agenteId,
    incendioId: d.incendioId,
    nivel: d.prioridad <= 2 ? "aviso" : "info",
    datos: { decisionId: d.id, acciones: d.acciones.map((a) => a.tipo) },
  });

  const ctx = contextoParaSistema(d.agenteId);

  // (a) Fundamentos legales del grafo de conocimiento --------------------
  try {
    const { buscarFundamentos } = await import("../conocimiento/consulta");
    const pregunta = `${d.titulo}. ${d.resumen}. Acciones: ${d.acciones.map((a) => a.descripcion).join("; ")}`;
    const fundamentos = await buscarFundamentos(pregunta, { k: 4 });
    if (fundamentos?.length) {
      estado.actualizar(estado.decisiones, d.id, { fundamentos });
      d.fundamentos = fundamentos;
    }
    estado.marcarServicio("Conocimiento (RAG)", true, `${fundamentos?.length ?? 0} fundamentos`);
  } catch (e) {
    estado.marcarServicio("Conocimiento (RAG)", false, mensajeDe(e));
  }

  // (a bis) Revisión legal EN LÍNEA (F1c de la migración, 2026-09-19) ------
  // Antes la hacía el agente `asesor_legal` en un tick POSTERIOR, y el enrutado
  // de más abajo ya había decidido con su copia local de `competencia`: una
  // decisión con alerta legal podía ejecutarse sola y el veto llegaba tarde.
  // `revisarLegalidad` ya estaba exportada para esto y reutiliza los fundamentos
  // que acaba de recuperar (a), así que no gasta una segunda búsqueda.
  //
  // EXCEPCIÓN, misma doctrina que el supervisor: un despliegue de ataque inicial
  // no espera. Mandar medios a apagar un fuego no tiene problema de competencia
  // —la tienen la evacuación, el confinamiento, el corte de carretera o elevar
  // el nivel—, y bloquear la primera salida ~20 s por una revisión que casi
  // siempre sale conforme cuesta minutos de fuego. Se revisa a posteriori.
  const soloDespliegueInicial =
    d.acciones.length > 0 && d.acciones.every((a) => a.tipo === "desplegar_unidad" && a.parametros?.ataqueInicial === true);

  const aplicarRevision = (revision: { conforme: boolean; alertas: string[]; sinRevisar?: string }): void => {
    if (revision.sinRevisar) {
      estado.registrarEvento("agente", `Revisión legal de «${d.titulo}» no realizada: ${revision.sinRevisar}`, {
        agenteId: "asesor_legal",
        incendioId: d.incendioId,
        nivel: "aviso",
        datos: { decisionId: d.id },
      });
      return;
    }
    // Se escribe SIEMPRE, aunque la lista vaya vacía: así el agente asesor_legal
    // (que filtra por `alertasLegales === undefined`) no la vuelve a revisar.
    estado.actualizar(estado.decisiones, d.id, { alertasLegales: revision.alertas });
    d.alertasLegales = revision.alertas;
    if (!revision.conforme && revision.alertas.length) {
      estado.registrarEvento("decision_escalada", `Alerta legal en «${d.titulo}»: ${revision.alertas[0]} Pasa a decisión humana.`, {
        agenteId: "asesor_legal",
        incendioId: d.incendioId,
        nivel: "aviso",
        datos: { decisionId: d.id, alertas: revision.alertas },
      });
    }
  };

  try {
    const { revisarLegalidad } = await import("../agentes/planificacion/asesor-legal");
    if (soloDespliegueInicial) {
      // A posteriori y en su propia traza, para que su latencia se mida donde toca.
      void sinTraza(() => ejecutarConTraza(estado, "asesor_legal", "revision_a_posteriori", () => revisarLegalidad(d)))
        .then(aplicarRevision)
        .catch((e) => {
          if (!esAborto(e)) estado.marcarServicio("Asesor legal", false, mensajeDe(e));
        });
    } else {
      aplicarRevision(await ejecutarConTraza(estado, "asesor_legal", "revision_en_linea", () => revisarLegalidad(d)));
      estado.marcarServicio("Asesor legal", true, `${d.alertasLegales?.length ?? 0} alerta(s)`);
    }
  } catch (e) {
    // Sin revisión legal no se bloquea la decisión: la política y el supervisor
    // siguen mandando. Pero queda dicho, nunca se da por conforme en silencio.
    if (!esAborto(e)) estado.marcarServicio("Asesor legal", false, mensajeDe(e));
    estado.registrarEvento("agente", `No se pudo revisar la legalidad de «${d.titulo}»: ${mensajeDe(e)}`, {
      agenteId: "asesor_legal",
      incendioId: d.incendioId,
      nivel: "aviso",
      datos: { decisionId: d.id },
    });
  }

  // (b) Política de autonomía --------------------------------------------
  const incendio = d.incendioId ? estado.incendios.get(d.incendioId) : undefined;
  let competencia = d.competencia;
  let riesgo = d.riesgo;
  let motivoCompetencia = "";
  try {
    const evaluada = evaluarCompetencia(d, estado.politica, incendio);
    competencia = evaluada.competencia;
    riesgo = evaluada.riesgo;
    motivoCompetencia = evaluada.motivo;
  } catch (e) {
    competencia = "humano";
    riesgo = Math.max(riesgo, 90);
    motivoCompetencia = `No se pudo evaluar la política (${mensajeDe(e)}): decide un humano`;
  }
  // Un humano ha asumido el control de este agente: nada suyo es autónomo.
  const ficha = estado.agentes.get(d.agenteId);
  if (ficha?.controlHumano && competencia === "autonoma") {
    competencia = "supervisada";
    motivoCompetencia = `${motivoCompetencia}; un humano ha asumido el control de ${ficha.nombre}`;
  }
  // Ataque inicial (doctrina): la primera salida se despacha sola, como en un 112 real, y el
  // supervisor la revisa A POSTERIORI. Solo si no hay alertas legales, el agente no está bajo
  // control humano y el foco está por debajo del nivel de gravedad reservado a humanos.
  const esAtaqueInicial =
    d.acciones.length > 0 &&
    d.acciones.every((a) => a.tipo === "desplegar_unidad" && a.parametros?.ataqueInicial === true) &&
    !ficha?.controlHumano &&
    !d.alertasLegales?.length &&
    (!incendio || incendio.nivelGravedad < estado.politica.nivelGravedadHumano);
  if (esAtaqueInicial) {
    competencia = "autonoma";
    riesgo = Math.min(riesgo, 25);
    motivoCompetencia = "Ataque inicial: la primera salida se despacha de forma autónoma (doctrina) y el supervisor la revisa a posteriori";
  }
  estado.actualizar(estado.decisiones, d.id, { competencia, riesgo });
  d.competencia = competencia;
  d.riesgo = riesgo;

  // (c) Supervisor de calidad --------------------------------------------
  let evaluacion: EvaluacionSupervisor | undefined;
  let supervisorCaido = false;
  let motivoSupervisorCaido = "";
  try {
    const { evaluarDecision } = await import("../agentes/supervision/supervisor");
    if (esAtaqueInicial) {
      // No bloquea: la evaluación llega después y queda en la decisión y en el acta.
      // Va en su PROPIA traza de supervisor (fuera de la del agente proponente) para
      // que su latencia se mida donde corresponde y se vea en /agentes/supervisor.
      void sinTraza(() => ejecutarConTraza(estado, "supervisor", "revision_a_posteriori", () => evaluarDecision(d, ctx)))
        .then((ev) => {
          estado.actualizar(estado.decisiones, d.id, { evaluacion: ev });
          estado.marcarServicio("Supervisor", true, `${ev.puntuacion}/100`);
          if (!ev.aprueba) {
            estado.registrarEvento("decision_escalada", `El supervisor revisa a posteriori el ataque inicial (${ev.puntuacion}/100): ${ev.motivoEscalado ?? "revisar el dispositivo"}`, {
              agenteId: d.agenteId,
              incendioId: d.incendioId,
              nivel: "aviso",
              datos: { decisionId: d.id, puntuacion: ev.puntuacion },
            });
          }
        })
        .catch((e) => {
          // Un aborto por pausa global no es una avería del supervisor: no se pinta en rojo.
          if (!esAborto(e)) estado.marcarServicio("Supervisor", false, mensajeDe(e));
        });
      evaluacion = undefined;
    } else {
      evaluacion = await ejecutarConTraza(estado, "supervisor", "evaluacion_decision", () => evaluarDecision(d, ctx));
      estado.actualizar(estado.decisiones, d.id, { evaluacion });
      d.evaluacion = evaluacion;
      estado.marcarServicio("Supervisor", true, `${evaluacion.puntuacion}/100`);
    }
  } catch (e) {
    if (esPorPausa(e, estado)) {
      // Cancelado por "Parar": no es una avería (fallo L-5). La decisión se queda en
      // "propuesta" y el orquestador vuelve a pasarla por el pipeline al reanudar.
      pendientesDeReevaluar.add(d.id);
      estado.registrarEvento("sistema", `Evaluación de «${d.titulo}» aplazada por la pausa del mundo; se retomará al reanudar`, {
        agenteId: d.agenteId,
        incendioId: d.incendioId,
        nivel: "info",
        datos: { decisionId: d.id },
      });
      return estado.decisiones.get(d.id) ?? d;
    }
    supervisorCaido = true;
    motivoSupervisorCaido = mensajeDe(e);
    if (!esAborto(e)) estado.marcarServicio("Supervisor", false, motivoSupervisorCaido);
    estado.registrarEvento("decision_escalada", `El supervisor no ha podido evaluar (${motivoSupervisorCaido}): la decisión pasa a un humano`, {
      agenteId: d.agenteId,
      incendioId: d.incendioId,
      nivel: "aviso",
      datos: { decisionId: d.id, error: mensajeDe(e) },
    });
  }

  const aprueba = esAtaqueInicial || (!supervisorCaido && !!evaluacion?.aprueba);

  // (d) Enrutado ----------------------------------------------------------
  if (aprueba && competencia === "autonoma") {
    sumarMetrica(estado, "decisionesAutonomas");
    // En segundo plano: ejecutar no debe bloquear el ciclo del agente.
    void sinTraza(() => aprobarDecision(d.id, "ia")).catch((e) => {
      estado.registrarEvento("accion_fallida", `Fallo al ejecutar la decisión autónoma: ${mensajeDe(e)}`, { incendioId: d.incendioId, nivel: "critico", datos: { decisionId: d.id } });
    });
    return estado.decisiones.get(d.id) ?? d;
  }

  if (aprueba) {
    // supervisada o humano: espera a una persona, con la recomendación del supervisor
    const actualizada = cambiarEstadoDecision(estado, d.id, "pendiente_humano", "sistema", `Competencia ${competencia}: ${motivoCompetencia}`) ?? d;
    estado.registrarEvento("decision_propuesta", `Requiere tu decisión: ${d.titulo} (${competencia}, riesgo ${riesgo})`, {
      agenteId: d.agenteId,
      incendioId: d.incendioId,
      nivel: d.prioridad <= 2 ? "aviso" : "info",
      datos: { decisionId: d.id, competencia, motivo: motivoCompetencia },
    });
    return actualizada;
  }

  const motivoEscalado = supervisorCaido
    ? `El supervisor no ha podido evaluar (${motivoSupervisorCaido || "sin proveedor de IA"}): la decisión la valida una persona`
    : evaluacion?.motivoEscalado || `El supervisor no aprueba (${evaluacion?.puntuacion ?? 0}/100)`;
  const escalada = cambiarEstadoDecision(estado, d.id, "escalada", "supervisor", motivoEscalado, {
    evaluacion: evaluacion ? { ...evaluacion, motivoEscalado } : undefined,
  }) ?? d;
  sumarMetrica(estado, "escaladasAHumano");
  estado.registrarEvento("decision_escalada", `Escalada a un humano: ${d.titulo} · ${motivoEscalado}`, {
    agenteId: d.agenteId,
    incendioId: d.incendioId,
    nivel: "critico",
    datos: { decisionId: d.id, motivoEscalado },
  });
  return escalada;
}

/**
 * Caduca las decisiones que llevan demasiados minutos REALES esperando a una persona.
 * Se mide en tiempo real (no de mundo) porque quien decide es un humano que reacciona en
 * tiempo real: con aceleración ×12, 20 min de mundo serían solo 100 s reales.
 * El plazo cuenta desde que la decisión pasó a pendiente/escalada (última entrada del historial).
 */
function caducarPendientes(estado: Estado): void {
  const limite = estado.politica.minutosCaducidad;
  if (!limite || limite <= 0) return;
  const ahora = Date.now();
  for (const d of estado.decisiones.values()) {
    if (d.estado !== "pendiente_humano" && d.estado !== "escalada") continue;
    // Recorrido hacia atrás SIN copiar el historial (antes: un array nuevo por
    // decisión y por tick).
    const historial = d.historial ?? [];
    let desde = d.creadaEn;
    for (let i = historial.length - 1; i >= 0; i--) {
      if (historial[i].estado === d.estado) { desde = historial[i].en; break; }
    }
    const esperando = (ahora - Date.parse(desde)) / 60_000;
    if (!Number.isFinite(esperando) || esperando <= limite) continue;
    cambiarEstadoDecision(estado, d.id, "caducada", "sistema", `Sin respuesta humana tras ${Math.round(esperando)} min reales (límite ${limite})`);
    estado.registrarEvento("decision_denegada", `Caducada sin respuesta (${Math.round(esperando)} min reales): ${d.titulo}`, {
      agenteId: d.agenteId,
      incendioId: d.incendioId,
      nivel: "aviso",
      datos: { decisionId: d.id, minutosEsperando: Math.round(esperando) },
    });
  }
}

/**
 * Cambia UNA acción de una decisión releyendo siempre el estado vivo. Antes el
 * bucle de ejecución llevaba su propia copia del array y la reescribía entera,
 * así que pisaba lo que el acta (asíncrona) acababa de escribir en la acción.
 */
function mutarAccion(estado: Estado, decisionId: string, accionId: string, cambios: Partial<Accion>): Accion | undefined {
  const actual = estado.decisiones.get(decisionId);
  if (!actual) return undefined;
  let mutada: Accion | undefined;
  const acciones = actual.acciones.map((a) => {
    if (a.id !== accionId) return a;
    mutada = { ...a, ...cambios };
    return mutada;
  });
  if (!mutada) return undefined;
  estado.actualizar(estado.decisiones, decisionId, { acciones });
  return mutada;
}

// ---------------------------------------------------------------------
// Poda de memoria (constructor S, 2026-09-19)
// ---------------------------------------------------------------------
// Las colecciones vivas no tenían techo: decisiones cerradas con su historial,
// informes con el Markdown completo (decenas de miles de caracteres) y
// observaciones se acumulaban hasta que el proceso pasaba de 2,7 GB. Lo que se
// poda ya está en Supabase (y los informes se sirven por /api/informes/[id],
// que cae al repositorio si no están en memoria), así que no se pierde nada.
// Si NO hay persistencia no se poda: sería tirar datos.

/** Decisiones cerradas que se conservan en memoria. */
const MAX_DECISIONES_CERRADAS = Number(process.env.MEMORIA_MAX_DECISIONES ?? 300);
/** Informes que se conservan en memoria (el snapshot enseña los últimos 100). */
const MAX_INFORMES = Number(process.env.MEMORIA_MAX_INFORMES ?? 300);
/** Observaciones que se conservan en memoria. */
const MAX_OBSERVACIONES = Number(process.env.MEMORIA_MAX_OBSERVACIONES ?? 1000);
/** Edad mínima (ms reales) para poder podar: muy por encima del debounce de la persistencia. */
const EDAD_MINIMA_PODA_MS = Number(process.env.MEMORIA_EDAD_PODA_MS ?? 600_000);
/** Una pasada de poda por minuto basta. */
const INTERVALO_PODA_MS = 60_000;

const ESTADOS_DECISION_CERRADOS: ReadonlySet<Decision["estado"]> = new Set<Decision["estado"]>([
  "ejecutada",
  "denegada",
  "fallida",
  "caducada",
]);

let ultimaPoda = 0;

async function podarMemoria(estado: Estado): Promise<void> {
  const ahora = Date.now();
  if (ahora - ultimaPoda < INTERVALO_PODA_MS) return;
  ultimaPoda = ahora;
  try {
    const { hayPersistencia } = await import("../db/repositorio");
    if (!hayPersistencia()) return;
    const { esperandoPersistencia } = await import("./persistencia");

    const viejo = (iso?: string) => !!iso && ahora - Date.parse(iso) > EDAD_MINIMA_PODA_MS;

    // --- decisiones cerradas -------------------------------------------
    const cerradas = [...estado.decisiones.values()]
      .filter((d) => ESTADOS_DECISION_CERRADOS.has(d.estado) && viejo(d.decididaEn ?? d.creadaEn))
      .sort((a, b) => (a.decididaEn ?? a.creadaEn).localeCompare(b.decididaEn ?? b.creadaEn));
    let quitadas = 0;
    for (const d of cerradas) {
      if (estado.decisiones.size <= MAX_DECISIONES_CERRADAS) break;
      if (esperandoPersistencia("decisiones", d.id)) continue;
      estado.eliminar(estado.decisiones, d.id);
      quitadas += 1;
    }

    // --- informes (el texto completo es lo que más pesa) ---------------
    const informes = [...estado.informes.values()].sort((a, b) => a.generadoEn.localeCompare(b.generadoEn));
    let informesFuera = 0;
    for (const i of informes) {
      if (estado.informes.size <= MAX_INFORMES) break;
      if (!viejo(i.generadoEn)) break; // están ordenados: si este es reciente, los siguientes también
      if (esperandoPersistencia("informes", i.id)) continue;
      estado.eliminar(estado.informes, i.id);
      informesFuera += 1;
    }

    // --- observaciones --------------------------------------------------
    const observaciones = [...estado.observaciones.values()].sort((a, b) => a.recibidaEn.localeCompare(b.recibidaEn));
    let observacionesFuera = 0;
    for (const o of observaciones) {
      if (estado.observaciones.size <= MAX_OBSERVACIONES) break;
      if (!viejo(o.recibidaEn)) break;
      if (esperandoPersistencia("observaciones", o.id)) continue;
      estado.eliminar(estado.observaciones, o.id);
      observacionesFuera += 1;
    }

    if (quitadas || informesFuera || observacionesFuera) {
      console.log(
        `[orquestador] poda de memoria: ${quitadas} decisiones cerradas, ${informesFuera} informes y ` +
          `${observacionesFuera} observaciones salen de RAM (siguen en Supabase)`,
      );
    }
  } catch (e) {
    console.warn(`[orquestador] no se pudo podar la memoria: ${mensajeDe(e)}`);
  }
}

/** Aprueba y EJECUTA. `quien` = "ia" o "humano:<nombre>". */
export async function aprobarDecision(id: string, quien: string, comentario?: string): Promise<Decision | undefined> {
  const estado = obtenerEstado();
  const inicial = estado.decisiones.get(id);
  if (!inicial) return undefined;
  if (["ejecutando", "ejecutada", "denegada", "fallida"].includes(inicial.estado)) return inicial;

  const ahora = new Date().toISOString();
  cambiarEstadoDecision(estado, id, "aprobada", quien, comentario, { decididaEn: ahora, decididaPor: quien, comentarioHumano: comentario ?? inicial.comentarioHumano });
  sumarMetrica(estado, "decisionesAprobadas");
  estado.registrarEvento("decision_aprobada", `Aprobada por ${quien}: ${inicial.titulo}`, {
    agenteId: inicial.agenteId,
    incendioId: inicial.incendioId,
    nivel: "info",
    datos: { decisionId: id, quien, comentario },
  });

  cambiarEstadoDecision(estado, id, "ejecutando", quien, `${inicial.acciones.length} acción(es) por ejecutar`);
  const ctx = contextoParaSistema(inicial.agenteId);

  // Ejecutor real (constructor D). Si no está, cada acción falla con motivo claro.
  let ejecutor: (typeof import("../agentes/ejecucion/ejecutor"))["ejecutorAcciones"] | undefined;
  try {
    ({ ejecutorAcciones: ejecutor } = await import("../agentes/ejecucion/ejecutor"));
  } catch (e) {
    estado.marcarServicio("Ejecutor de acciones", false, mensajeDe(e));
  }

  const idsAcciones = (estado.decisiones.get(id)?.acciones ?? []).map((a) => a.id);
  let algunaBien = false;
  for (const accionId of idsAcciones) {
    // Sello de auditoría de la acción: quién la autorizó y cuándo se ordenó.
    const ordenadaEn = new Date().toISOString();
    let accion = mutarAccion(estado, id, accionId, { autorizadaPor: quien, ordenadaEn });
    if (!accion) continue;
    let resultado: Accion = accion;
    if (!ejecutor || !ejecutor.soporta(accion.tipo)) {
      resultado = {
        ...accion,
        estado: "fallida",
        ejecutadaEn: new Date().toISOString(),
        resultado: { en: new Date().toISOString(), proveedor: "ninguno", resumen: `Ninguna integración sabe ejecutar "${accion.tipo}" todavía`, exito: false },
      };
    } else {
      // marcamos "ejecutando" para que la sala lo vea en vivo
      accion = mutarAccion(estado, id, accionId, { estado: "ejecutando" }) ?? accion;
      try {
        resultado = await ejecutor.ejecutar(accion, estado.decisiones.get(id) ?? inicial, ctx);
      } catch (e) {
        resultado = {
          ...accion,
          estado: "fallida",
          ejecutadaEn: new Date().toISOString(),
          resultado: { en: new Date().toISOString(), proveedor: "desconocido", resumen: mensajeDe(e), exito: false },
        };
      }
    }
    mutarAccion(estado, id, accionId, resultado);

    const exito = resultado.estado === "ejecutada" && resultado.resultado?.exito !== false;
    if (exito) algunaBien = true;
    sumarContador(estado, inicial.agenteId, "acciones");
    estado.registrarEvento(exito ? "accion_ejecutada" : "accion_fallida", `${resultado.descripcion}: ${resultado.resultado?.resumen ?? (exito ? "hecho" : "sin resultado")}`, {
      agenteId: inicial.agenteId,
      incendioId: inicial.incendioId,
      nivel: exito ? "info" : "aviso",
      datos: { decisionId: id, accionId: resultado.id, tipo: resultado.tipo, referencia: resultado.resultado?.referencia },
    });
    // Acta de ESTA acción (haya ido bien o mal): se audita todo, pero SIN
    // esperarla. Redactarla puede costar una llamada de razonamiento de ~25 s
    // y aquí bloqueaba la ejecución de las acciones siguientes y el cierre de
    // la decisión. El acta escribe `informeId` dentro de la acción por su
    // cuenta; por eso todas las mutaciones de acciones pasan por `mutarAccion`,
    // que relee el estado y no pisa lo que haya escrito mientras tanto.
    void sinTraza(() => generarActaAccion(id, resultado.id)).catch((e) =>
      console.error(`[orquestador] no se pudo redactar el acta de la acción ${resultado.id}: ${mensajeDe(e)}`),
    );
    if (exito && resultado.tipo === "llamar") sumarMetrica(estado, "llamadasRealizadas");
    if (exito && (resultado.tipo === "avisar_poblacion" || resultado.tipo === "confinar_poblacion" || resultado.tipo === "evacuar_poblacion")) {
      sumarMetrica(estado, "poblacionesAvisadas");
    }
  }

  const acciones = estado.decisiones.get(id)?.acciones ?? [];
  const estadoFinal: Decision["estado"] = acciones.length === 0 ? "ejecutada" : algunaBien ? "ejecutada" : "fallida";
  const final = cambiarEstadoDecision(estado, id, estadoFinal, quien, `${acciones.filter((a) => a.estado === "ejecutada").length} de ${acciones.length} acciones con éxito`) ?? inicial;
  estado.registrarEvento("decision_ejecutada", `${estadoFinal === "ejecutada" ? "Ejecutada" : "Fallida"}: ${inicial.titulo}`, {
    agenteId: inicial.agenteId,
    incendioId: inicial.incendioId,
    nivel: estadoFinal === "ejecutada" ? "info" : "aviso",
    datos: { decisionId: id, acciones: acciones.length },
  });

  // NO se pide aquí un informe extra: `cambiarEstadoDecision` acaba de disparar el
  // acta del estado final (ejecutada/fallida), sellada con huella, trazaId y
  // estadoDecision, y engancharla a `informeIds`. La llamada que había aquí escribía
  // un SEGUNDO informe del mismo estado, se pisaba `informeId` con uno que no estaba
  // en `informeIds` y gastaba una llamada de razonamiento de ~25 s por decisión
  // (medido 2026-09-19: dos actas "ejecutada" por decisión en /api/auditoria).
  return final;
}

/** Deniega con motivo obligatorio (el motivo es lo que enseña al sistema). */
export async function denegarDecision(id: string, quien: string, comentario: string): Promise<Decision | undefined> {
  const estado = obtenerEstado();
  const d = estado.decisiones.get(id);
  if (!d) return undefined;
  const motivo = (comentario ?? "").trim();
  if (!motivo) throw new Error("Al denegar hay que explicar por qué: el comentario es obligatorio");
  const final = cambiarEstadoDecision(estado, id, "denegada", quien, motivo, {
    decididaEn: new Date().toISOString(),
    decididaPor: quien,
    comentarioHumano: motivo,
  });
  sumarMetrica(estado, "decisionesDenegadas");
  estado.registrarEvento("decision_denegada", `Denegada por ${quien}: ${d.titulo} · ${motivo}`, {
    agenteId: d.agenteId,
    incendioId: d.incendioId,
    nivel: "aviso",
    datos: { decisionId: id, comentario: motivo, quien },
  });
  return final;
}

// ---------------------------------------------------------------------
// Focos
// ---------------------------------------------------------------------

/** Radio del perímetro inicial (m): un foco recién detectado es un punto. */
const RADIO_INICIAL_M = 60;

/**
 * Declara un foco y lo guarda YA (la sala lo ve al instante). El
 * enriquecimiento con fuentes reales continúa en segundo plano.
 */
export async function declararFoco(d: DeclaracionFoco): Promise<Incendio> {
  // Ámbito: SOLO España. Vale para la mano, el verificador y cualquier fuente.
  if (!enEspana(d.punto)) throw new Error(describirFueraEspana(d.punto));
  const estado = obtenerEstado();
  const ahoraMundo = estado.reloj.ahoraMundo;
  const id = nuevoId("inc");
  // Superficie REAL (sesión superficie-real, 2026-09-19): el perímetro se
  // construye para que MIDA las hectáreas de la fuente (o las del punto
  // inicial) y `areaHa` sale del propio polígono, con la misma fórmula con la
  // que el mapa mide lo que dibuja. Nunca se guarda una cifra copiada de la
  // fuente que no se corresponda con el trazado.
  const perimetroDeclarado = perimetroDeSuperficie(d.punto, d.areaHa && d.areaHa > 0 ? d.areaHa : areaHaCirculo(RADIO_INICIAL_M));
  const incendio: Incendio = {
    id,
    nombre: d.nombre?.trim() || `Incendio en ${d.punto.lat.toFixed(3)}, ${d.punto.lon.toFixed(3)}`,
    centro: { lat: d.punto.lat, lon: d.punto.lon },
    municipio: "",
    provincia: "",
    comunidad: "",
    estado: d.estadoInicial ?? (d.origen === "manual" ? "confirmado" : "detectado"),
    nivelGravedad: d.nivelGravedad ?? 0,
    origen: d.origen,
    confianza: d.confianza ?? (d.origen === "manual" ? 1 : 0.5),
    detectadoEn: ahoraMundo,
    actualizadoEn: ahoraMundo,
    // Si la fuente da una superficie, el perímetro inicial es un círculo de esa
    // área; la cifra guardada es la MEDIDA sobre ese polígono.
    perimetro: perimetroDeclarado,
    areaHa: +areaDePoligono(perimetroDeclarado).toFixed(2),
    observaciones: d.observacionId ? [d.observacionId] : [],
    radioOperativoKm: 30,
    notas: d.notas,
    resumenFuente: d.resumenFuente,
    fuenteDeteccion: d.fuenteDeteccion,
    fuenteUrl: d.fuenteUrl,
    mediosExternos: d.mediosExternos,
  };
  estado.guardar(estado.incendios, incendio);
  sumarMetrica(estado, "incendios");
  if (d.observacionId) {
    estado.actualizar(estado.observaciones, d.observacionId, { incendioId: id, impacto: "nuevo_foco" });
  }
  emitir("incendio_nuevo", `Nuevo foco ${d.origen === "manual" ? `declarado por ${d.quien ?? "la sala"}` : `detectado por ${d.origen}`}: ${incendio.nombre}`, {
    incendioId: id,
    nivel: "critico",
    datos: { lat: d.punto.lat, lon: d.punto.lon, origen: d.origen, quien: d.quien },
  });

  // Enriquecimiento asíncrono: nunca bloquea la respuesta de la API.
  void enriquecerIncendio(estado, id)
    .catch((e) => estado.registrarEvento("sistema", `Enriquecimiento incompleto: ${mensajeDe(e)}`, { incendioId: id, nivel: "aviso" }))
    .finally(() => emitir("incendio_actualizado", `Foco listo para trabajar: ${estado.incendios.get(id)?.nombre ?? incendio.nombre}`, { incendioId: id, nivel: "info" }));

  return incendio;
}

/**
 * Cierra un foco.
 *
 * MODIFICADO (constructor K, 2026-09-19 — extinción realista):
 *  · "controlado" NO es el final: es el paso a LIQUIDACIÓN. Los medios se
 *    quedan en el terreno rematando y enfriando la franja interior, y las
 *    cámaras siguen vigilando. Solo se sella el hito `contencion.controladoEn`.
 *  · "extinguido" / "descartado" sí cierran: los medios REGRESAN A SUS BASES
 *    POR CARRETERA (ruta real de OSRM a través de `despachador.retirar`, que
 *    los deja en estado "regreso"; el despachador los pone "disponible" al
 *    llegar). Antes se teletransportaban a base de golpe.
 *    Si OSRM falla para una unidad, se libera a mano para no dejarla colgada.
 */
export async function cerrarIncendio(
  id: string,
  nuevoEstado: Extract<EstadoIncendio, "controlado" | "extinguido" | "descartado">,
  quien: string,
): Promise<Incendio | undefined> {
  const estado = obtenerEstado();
  const incendio = estado.incendios.get(id);
  if (!incendio) return undefined;

  const ahoraMundo = estado.reloj.ahoraMundo;
  // Hito de extinción para el hilo de la incidencia y para la sala.
  const contencion = incendio.contencion
    ? {
        ...incendio.contencion,
        controladoEn: nuevoEstado === "controlado" ? (incendio.contencion.controladoEn ?? ahoraMundo) : incendio.contencion.controladoEn,
        extinguidoEn: nuevoEstado === "extinguido" ? (incendio.contencion.extinguidoEn ?? ahoraMundo) : incendio.contencion.extinguidoEn,
        calculadoEn: ahoraMundo,
      }
    : undefined;

  const final = estado.actualizar(estado.incendios, id, { estado: nuevoEstado, contencion, actualizadoEn: ahoraMundo });

  // Liquidación: un incendio "controlado" conserva sus medios y sus cámaras.
  if (nuevoEstado === "controlado") {
    const enTerreno = [...estado.unidades.values()].filter((u) => u.incendioId === id).length;
    emitir("incendio_actualizado", `${incendio.nombre} pasa a CONTROLADO (${quien}). ${enTerreno} unidades siguen en liquidación y remate; las cámaras continúan vigilando.`, {
      incendioId: id,
      nivel: "aviso",
      datos: { estado: nuevoEstado, quien, enLiquidacion: enTerreno },
    });
    return final;
  }

  // Medios: regresan a su base POR CARRETERA y quedan disponibles al llegar.
  const { retirar } = await import("../agentes/ejecucion/despachador");
  let liberadas = 0;
  let enRegreso = 0;
  for (const u of [...estado.unidades.values()]) {
    if (u.incendioId !== id) continue;
    if (u.estado === "fuera_servicio") continue;
    // Las que nunca llegaron a salir de su base no necesitan viaje de vuelta.
    const yaEnBase = u.estado === "asignada" || u.estado === "disponible";
    if (!yaEnBase) {
      try {
        await retirar(u.id, `${incendio.nombre} ${nuevoEstado}`, `cierre:${id}`);
        enRegreso += 1;
        continue;
      } catch (e) {
        estado.registrarEvento("sistema", `No se pudo calcular la ruta de regreso de ${u.nombre} (${mensajeDe(e)}): se libera directamente.`, { incendioId: id, nivel: "aviso" });
      }
    }
    estado.actualizar(estado.unidades, u.id, {
      estado: "disponible",
      posicion: u.base.punto,
      ruta: undefined,
      sector: undefined,
      incendioId: undefined,
    });
    liberadas += 1;
  }

  // Cámaras: dejan de vigilarse si no queda ningún otro foco activo cerca.
  const otrosActivos = estado.incendiosActivos().filter((i) => i.id !== id);
  let apagadas = 0;
  for (const c of [...estado.camaras.values()]) {
    if (c.incendioId !== id && !c.vigilada) continue;
    if (c.fuente === "Movil") continue; // la sostiene una persona: no se apaga sola
    const cercaDeOtro = otrosActivos.some((i) => distanciaKm(i.centro, c.punto) <= RADIO_CAMARAS_KM);
    if (cercaDeOtro) {
      const otro = otrosActivos.find((i) => distanciaKm(i.centro, c.punto) <= RADIO_CAMARAS_KM);
      estado.actualizar(estado.camaras, c.id, { incendioId: otro?.id });
    } else if (c.incendioId === id) {
      estado.actualizar(estado.camaras, c.id, { vigilada: false, incendioId: undefined });
      apagadas += 1;
    }
  }

  // Descartado = falsa alarma: sus pueblos no corren riesgo de nada. Se van del
  // estado (y de Supabase, tolerante) para que el mapa y las métricas no sigan
  // contando "riesgo" de un foco que no existe. Un extinguido los conserva para
  // el post-mortem. (sesión riesgo-fundado, 2026-09-19)
  let pueblosQuitados = 0;
  let pueblosReasignados = 0;
  if (nuevoEstado === "descartado") {
    const { eliminados, reasignados } = quitarPoblacionesDe(estado, id);
    pueblosQuitados = eliminados.length;
    pueblosReasignados = reasignados;
    if (eliminados.length) {
      try {
        const { borrarLote } = await import("../db/repositorio");
        await borrarLote("poblaciones", eliminados);
      } catch (e) {
        estado.marcarServicio("Supabase", false, `No se pudieron borrar los pueblos del foco descartado: ${mensajeDe(e)}`);
      }
    }
  }

  emitir(
    "incendio_cerrado",
    `${incendio.nombre} pasa a ${nuevoEstado} (${quien}). ${enRegreso} unidades regresan a su base por carretera` +
      (liberadas ? `, ${liberadas} liberadas en base` : "") +
      `, ${apagadas} cámaras fuera de vigilancia` +
      (pueblosQuitados ? `, ${pueblosQuitados} pueblos retirados del mapa` : "") +
      (pueblosReasignados ? `, ${pueblosReasignados} pueblos pasan a otro foco cercano` : ""),
    {
      incendioId: id,
      nivel: "info",
      datos: { estado: nuevoEstado, quien, liberadas, enRegreso, apagadas, pueblosQuitados, pueblosReasignados },
    },
  );
  return final;
}

// ---------------------------------------------------------------------
// Ejecuciones (una "partida" completa, con métricas y aprendizaje)
// ---------------------------------------------------------------------

/** Recalcula las métricas derivadas a partir del estado vivo. */
export function consolidarMetricas(estado: Estado): MetricasEjecucion {
  const m = estado.ejecucion.metricas;
  const poblaciones = [...estado.poblaciones.values()];
  const avisadas = poblaciones.filter((p) => p.estadoAviso !== "sin_avisar").length;
  const enPeligroSinAvisar = poblaciones.filter((p) => p.estadoAviso === "sin_avisar" && (p.riesgo === "alto" || p.riesgo === "inminente")).length;
  const puntuaciones = [...estado.decisiones.values()].map((d) => d.evaluacion?.puntuacion).filter((v): v is number => typeof v === "number");
  const nuevas: MetricasEjecucion = {
    ...m,
    incendios: estado.incendios.size,
    poblacionesAvisadas: Math.max(m.poblacionesAvisadas, avisadas),
    poblacionesEnPeligroSinAvisar: enPeligroSinAvisar,
    puntuacionSupervisorMedia: puntuaciones.length ? Number((puntuaciones.reduce((a, b) => a + b, 0) / puntuaciones.length).toFixed(1)) : undefined,
  };
  estado.ejecucion = { ...estado.ejecucion, metricas: nuevas };
  estado.tocar();
  return nuevas;
}

/** Cierra la ejecución actual: métricas, comparativa con la anterior y post-mortem. */
export async function cerrarEjecucion(): Promise<void> {
  const estado = obtenerEstado();
  if (estado.ejecucion.estado === "cerrada") return;
  consolidarMetricas(estado);
  estado.ejecucion = { ...estado.ejecucion, fin: new Date().toISOString(), estado: "cerrada" };
  estado.tocar();

  try {
    const { compararConAnterior } = await import("../aprendizaje/memoria");
    const comparativa = await compararConAnterior(estado.ejecucion);
    if (comparativa) {
      estado.ejecucion = { ...estado.ejecucion, comparativa };
      estado.tocar();
    }
  } catch (e) {
    estado.marcarServicio("Aprendizaje", false, mensajeDe(e));
  }

  await redactarPostmortem();

  try {
    const { guardarEjecucion, volcarTodo } = await import("../db/repositorio");
    await volcarTodo(estado);
    await guardarEjecucion(estado.ejecucion);
  } catch (e) {
    estado.marcarServicio("Supabase", false, mensajeDe(e));
  }

  estado.registrarEvento("sistema", `Ejecución cerrada: ${estado.ejecucion.nombre}`, { nivel: "info" });
}

/**
 * Post-mortem de la ejecución actual (ya cerrada): una "decisión sintética" sirve
 * de percha para el redactor. También se llama a mano si el cierre se quedó sin
 * él (p. ej. el proveedor de IA no respondió).
 */
export async function redactarPostmortem(): Promise<void> {
  const estado = obtenerEstado();
  try {
    const { redactarInforme } = await import("../agentes/informes/redactor");
    const sintetica: Decision = {
      id: nuevoId("dec"),
      ejecucionId: estado.ejecucion.id,
      agenteId: "memoria",
      titulo: `Post-mortem de ${estado.ejecucion.nombre}`,
      resumen: "Cierre de la ejecución: qué se decidió, qué se ejecutó y qué habría que cambiar.",
      razonamiento: JSON.stringify(estado.ejecucion.metricas),
      prioridad: 3,
      riesgo: 0,
      competencia: "autonoma",
      estado: "ejecutada",
      acciones: [],
      evidencias: [],
      fundamentos: [],
      creadaEn: new Date().toISOString(),
      creadaEnMundo: estado.reloj.ahoraMundo,
    };
    // Tope de 12 s para la narrativa de IA: se aborta la petición (no se descarta
    // el informe), así el redactor devuelve al menos el acta determinista.
    const corte = new AbortController();
    const temporizador = setTimeout(() => corte.abort(), 12_000);
    let informe;
    try {
      informe = await redactarInforme(sintetica, contextoParaSistema("redactor", corte.signal));
    } finally {
      clearTimeout(temporizador);
    }
    if (informe) {
      const guardado = { ...informe, id: informe.id || nuevoId("inf"), tipo: "postmortem" as const, ejecucionId: estado.ejecucion.id };
      estado.guardar(estado.informes, guardado);
      estado.ejecucion = { ...estado.ejecucion, postmortemInformeId: guardado.id };
      estado.tocar();
    }
  } catch (e) {
    estado.marcarServicio("Redactor de informes", false, mensajeDe(e));
  }
}

/** Cierra la actual y empieza una ejecución limpia (estado nuevo, agentes re-registrados). */
export async function nuevaEjecucion(nombre?: string, fuentesDesactivadas?: FuenteDeteccion[]): Promise<Estado> {
  await cerrarEjecucion();
  const anterior = obtenerEstado();
  const nuevo = new Estado();
  if (nombre?.trim()) nuevo.ejecucion = { ...nuevo.ejecucion, nombre: nombre.trim() };
  // El escenario (fuentes de detección apagadas) lo fija el mando y se hereda entre
  // ejecuciones, como la política. Se puede fijar explícitamente al crearla: las
  // pruebas mandan [] para no arrastrar un simulacro que alguien dejó puesto.
  const fuentes = normalizarFuentes(fuentesDesactivadas ?? anterior.ejecucion.fuentesDesactivadas);
  if (fuentes.length) nuevo.ejecucion = { ...nuevo.ejecucion, fuentesDesactivadas: fuentes };
  // La política la fija el humano y NO se pierde entre ejecuciones... pero solo si
  // de verdad la ha tocado alguien. Si sigue siendo la de fábrica ("sistema"), se
  // toma la del código: si no, cambiar `politica-defecto.ts` no tenía ningún efecto
  // sobre un servidor en marcha (visto 2026-09-19: `avisar_poblacion` y
  // `publicar_comunicado` seguían "supervisada/45" tras pasarlos a autónomos, así que
  // ni los avisos ni los comunicados salían solos).
  nuevo.politica = anterior.politica.actualizadaPor === "sistema" ? nuevo.politica : anterior.politica;
  if (nuevo.politica !== anterior.politica) {
    nuevo.registrarEvento("sistema", "Política de autonomía: se recargan los valores de fábrica (nadie la había editado a mano)", { nivel: "info" });
  }
  establecerEstado(nuevo);
  reiniciarAncla(nuevo);
  engancharEventos(nuevo);
  // La persistencia estaba suscrita al estado anterior: sin esto, la ejecución nueva no guarda nada.
  try {
    const { engancharPersistencia } = await import("./persistencia");
    engancharPersistencia(nuevo);
  } catch (e) {
    nuevo.marcarServicio("Supabase", false, `No se pudo enganchar la persistencia: ${mensajeDe(e)}`);
  }
  nucleo().ocupados.clear();
  nucleo().cola.clear();
  nucleo().motivoDespertar.clear();
  nucleo().ultimoCicloReal.clear();
  nucleo().ultimoCicloMundo.clear();

  try {
    await recargarAgentes();
  } catch (e) {
    nuevo.registrarEvento("sistema", `No se pudieron registrar los agentes: ${mensajeDe(e)}`, { nivel: "critico" });
  }

  // Lecciones de ejecuciones anteriores: se inyectan desde el minuto cero.
  const lecciones = await cargarLecciones("*", "arranque de ejecución de incendios forestales en España");
  for (const l of lecciones) nuevo.lecciones.set(l.id, l);
  nuevo.tocar();

  try {
    const { guardarEjecucion } = await import("../db/repositorio");
    await guardarEjecucion(nuevo.ejecucion);
  } catch (e) {
    nuevo.marcarServicio("Supabase", false, mensajeDe(e));
  }

  nuevo.registrarEvento(
    "sistema",
    `Nueva ejecución: ${nuevo.ejecucion.nombre} (${lecciones.length} lecciones heredadas)${fuentes.length ? ` · fuentes de detección apagadas: ${listaFuentes(fuentes)}` : ""}`,
    { nivel: fuentes.length ? "aviso" : "info" },
  );
  return nuevo;
}

/** Para /api/salud y diagnóstico. */
export function estadoDelNucleo(): { arrancado: boolean; tickMs: number; agentes: number; ocupados: string[]; enCola: string[] } {
  const n = nucleo();
  return { arrancado: n.arrancado && !!n.intervalo, tickMs: TICK_MS, agentes: n.agentes.length, ocupados: [...n.ocupados], enCola: [...n.cola] };
}
