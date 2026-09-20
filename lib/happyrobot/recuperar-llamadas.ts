// =====================================================================
// ATALAYA INCENDIOS · Recuperación de llamadas al 112 que no llegaron
// ---------------------------------------------------------------------
// Propósito: que no se pierda NADA de una llamada aunque el enlace con Atalaya
// falle mientras dura (túnel caído, red que bloquea Cloudflare, servidor
// reiniciándose). HappyRobot guarda cada llamada: la transcripción, el número
// de quien llama y los argumentos con los que el agente llamó a sus
// herramientas (registrar_aviso, situar_lugar). Este módulo los PIDE a la API
// (no depende de que nos llegue ningún webhook) y registra en Atalaya lo que
// falte:
//   · llamada sin observación → se registra como aviso con lo que la persona
//     dictó al agente (o, si no llegó a dictarlo, con la transcripción);
//   · observación sin transcripción (falló solo el webhook de colgar) → se adjunta.
// Idempotente por run de HappyRobot (misma referencia externa que usa el
// registro en directo): una llamada nunca se registra dos veces. El corte NO es
// el inicio de la ejecución (revisión del PR, 19-09: sin persistencia, un reinicio
// abre otra ejecución y las llamadas recibidas con el servidor parado quedaban
// antes de su inicio y no se recuperaban nunca) sino el registro en disco de
// llamadas atendidas (lib/happyrobot/llamadas-atendidas.ts), que sobrevive al
// reinicio. Con persistencia, la pasada espera a que la ejecución esté rehidratada
// de Supabase: si no, una llamada atendida en directo parecería perdida.
// Se ejecuta cada minuto en el propio servidor (`arrancarRecuperacionLlamadas`,
// desde instrumentation.ts) y a demanda en POST /api/happyrobot/recuperar, que
// además llama el guardián del túnel (scripts/tunel-vigilado.sh) al recuperarse.
// DUEÑO: sesión fireops-82 (2026-09-19); revisión del PR por fireops-f4. Dependencias: lib/happyrobot/entrante.ts,
// API v2 de HappyRobot (GET /workflows/{slug}/runs, /runs/{id}/nodes, /runs/{id}/outputs/{id}).
// =====================================================================
import { obtenerEstado } from "../motor/estado";
import { rehidratacionTerminada } from "../motor/persistencia";
import { apiBase } from "./cliente";
import {
  adjuntarTranscripcion,
  avisoDesdeCuerpo,
  MARCA_TRANSCRIPCION,
  observacionDeLlamada,
  registrarAvisoDeLlamada,
  situarLugar,
  slugEntrante,
  type AvisoLlamada,
} from "./entrante";
import { hayRegistroDeLlamadas, llamadaAtendida, marcarLlamadasAtendidas } from "./llamadas-atendidas";

/** Nombre del nodo del agente en el workflow (scripts/happyrobot-entrante.mjs, NOMBRES_NODOS.agente). */
const NODO_AGENTE = "Centralita 112";
/** Cada cuánto se revisa la plataforma. */
export const CADA_MS = Number(process.env.HAPPYROBOT_RECUPERAR_CADA_MS ?? 60_000);
/** Cuántas llamadas recientes se revisan en cada pasada. */
const LIMITE_RUNS = 20;
/** Llamadas más antiguas que esto no se recuperan (ya no tienen sentido operativo). */
const VENTANA_MS = 6 * 3_600_000;
const TIMEOUT_API_MS = 15_000;

// Lectura de la transcripción: lib/happyrobot/transcripcion.ts (la usa también entrante.ts al colgar).
export { argumentosHerramienta, leerTranscripcion, loQueDijoLaPersona, textoTranscripcion, type MensajeTranscripcion } from "./transcripcion";
import { argumentosHerramienta, leerTranscripcion, loQueDijoLaPersona, textoTranscripcion, type MensajeTranscripcion } from "./transcripcion";

export type PlanRecuperacion =
  | { tipo: "aviso"; aviso: AvisoLlamada; situar?: { lugar?: string; municipio?: string }; fuente: "registrar_aviso" | "situar_lugar" }
  | { tipo: "transcripcion"; texto: string }
  | { tipo: "nada"; motivo: string };

/**
 * Qué hacer con una llamada que no llegó a Atalaya (PURO):
 *   1. si el agente llegó a llamar a registrar_aviso → esos datos (lo que dictó la persona);
 *   2. si solo llegó a situar_lugar → el sitio de ahí y "qué ve" de lo que dijo la persona;
 *   3. si la persona habló pero no hubo herramientas → la transcripción a la centralita;
 *   4. si nadie habló → nada.
 */
export function planRecuperacion(runId: string, desde: string | undefined, msgs: MensajeTranscripcion[]): PlanRecuperacion {
  const dicho = loQueDijoLaPersona(msgs);
  const registrar = argumentosHerramienta(msgs, "registrar_aviso");
  if (registrar) {
    const leido = avisoDesdeCuerpo({ ...registrar, run_id: runId, telefono_llamante: desde, que_ve: registrar.que_ve || dicho.slice(0, 600) });
    if (leido.aviso) return { tipo: "aviso", aviso: leido.aviso, situar: { lugar: leido.aviso.lugar, municipio: leido.aviso.municipio }, fuente: "registrar_aviso" };
  }
  const situar = argumentosHerramienta(msgs, "situar_lugar");
  if (situar && dicho) {
    const leido = avisoDesdeCuerpo({ lugar: situar.lugar, municipio: situar.municipio, que_ve: dicho.slice(0, 600), run_id: runId, telefono_llamante: desde });
    if (leido.aviso) return { tipo: "aviso", aviso: leido.aviso, situar: { lugar: leido.aviso.lugar, municipio: leido.aviso.municipio }, fuente: "situar_lugar" };
  }
  if (dicho) return { tipo: "transcripcion", texto: textoTranscripcion(msgs) };
  return { tipo: "nada", motivo: "la persona no llegó a hablar" };
}

// ---------------------------------------------------------------------
// API de HappyRobot
// ---------------------------------------------------------------------

interface RunApi {
  id: string;
  status?: string;
  timestamp?: string;
  completed_at?: string | null;
}
interface NodoRunApi {
  name?: string;
  output_id?: string;
}

async function pedir<T>(ruta: string): Promise<T> {
  const clave = process.env.HAPPYROBOT_API_KEY?.trim();
  if (!clave) throw new Error("Falta HAPPYROBOT_API_KEY");
  const res = await fetch(`${apiBase()}/api/v2${ruta}`, { headers: { authorization: `Bearer ${clave}`, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_API_MS) });
  const texto = await res.text();
  if (!res.ok) throw new Error(`HappyRobot ${res.status} en ${ruta}: ${texto.slice(0, 200)}`);
  return JSON.parse(texto) as T;
}
const lista = <T>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : (((r as { data?: T[] })?.data ?? []) as T[]));

/** Transcripción y número del llamante de una llamada (del nodo del agente). */
async function datosDeLlamada(runId: string): Promise<{ desde?: string; msgs: MensajeTranscripcion[] }> {
  const nodos = lista<NodoRunApi>(await pedir(`/runs/${encodeURIComponent(runId)}/nodes`));
  const agente = nodos.find((n) => n.name === NODO_AGENTE);
  if (!agente?.output_id) return { msgs: [] };
  const o = await pedir<{ data?: { data?: Record<string, unknown> } & Record<string, unknown> }>(`/runs/${encodeURIComponent(runId)}/outputs/${encodeURIComponent(agente.output_id)}`);
  const datos = ((o.data?.data ?? o.data ?? {}) as Record<string, unknown>) ?? {};
  const desde = typeof datos.from === "string" && datos.from.trim() ? datos.from.trim() : undefined;
  return { desde, msgs: leerTranscripcion(datos.transcript) };
}

// ---------------------------------------------------------------------
// Recuperación
// ---------------------------------------------------------------------

export interface ResultadoRecuperacion {
  en: string;
  revisadas: number;
  recuperadas: { runId: string; como: string; observacionId?: string; impacto?: string | null }[];
  transcripcionesAdjuntadas: string[];
  /** Solo en el primer arranque sin registro en disco: llamadas anteriores a la ejecución que se dan por atendidas sin importarlas. */
  anterioresAlArranque?: number;
  error?: string;
}

type Global = typeof globalThis & {
  __atalayaRecuperacion?: { enCurso: boolean; sembrado: boolean; ultima?: ResultadoRecuperacion; intervalo?: ReturnType<typeof setInterval> };
};
const est = () => ((globalThis as Global).__atalayaRecuperacion ??= { enCurso: false, sembrado: false });

/** Resultado de la última pasada (para la pantalla de salud). */
export const ultimaRecuperacion = (): ResultadoRecuperacion | undefined => est().ultima;

const terminada = (r: RunApi) => Boolean(r.completed_at) || ["completed", "failed", "cancelled", "canceled", "error", "timeout"].includes(String(r.status));

/**
 * Una pasada: revisa las llamadas recientes del workflow entrante y registra lo
 * que falte en Atalaya. Nunca registra dos veces la misma llamada: el corte lo
 * pone el registro en disco de llamadas atendidas (no el inicio de la ejecución),
 * así que una llamada recibida con el servidor parado se recupera al arrancar.
 */
export async function recuperarLlamadasPerdidas(opciones: { ahora?: number } = {}): Promise<ResultadoRecuperacion> {
  const e = est();
  const resultado: ResultadoRecuperacion = { en: new Date().toISOString(), revisadas: 0, recuperadas: [], transcripcionesAdjuntadas: [] };
  const slug = slugEntrante();
  if (!slug || !process.env.HAPPYROBOT_API_KEY?.trim()) {
    resultado.error = "Falta HAPPYROBOT_WORKFLOW_SLUG_ENTRANTE o HAPPYROBOT_API_KEY";
    return (e.ultima = resultado);
  }
  if (e.enCurso) {
    resultado.error = "Ya hay una pasada en curso";
    return resultado;
  }
  // Con persistencia, el Estado no es el definitivo hasta que se carga la ejecución activa de Supabase:
  // una llamada atendida en directo y aún no rehidratada parecería perdida y se registraría dos veces.
  if (!rehidratacionTerminada()) {
    resultado.error = "Esperando a que termine la rehidratación de la ejecución desde Supabase";
    return (e.ultima = resultado);
  }
  e.enCurso = true;
  try {
    const estado = obtenerEstado();
    const ahora = opciones.ahora ?? Date.now();
    const desdeMs = ahora - VENTANA_MS;
    const runs = lista<RunApi>(await pedir(`/workflows/${encodeURIComponent(slug)}/runs?page_size=${LIMITE_RUNS}`));
    const cuandoDe = (r: RunApi): number => Date.parse(r.timestamp ?? "");
    // PRIMER arranque con registro (aún no hay archivo en data/): las llamadas anteriores a esta ejecución
    // no son de nadie y se dan por atendidas sin importarlas (un servidor recién estrenado no se traga
    // media tarde de pruebas). A partir de ahí manda el registro: una llamada que no esté en él se
    // recupera aunque sea anterior al inicio de la ejecución actual (servidor parado, reinicio sin
    // persistencia). Marcar una lista vacía crea el archivo: la siembra ocurre una sola vez.
    if (!e.sembrado && !hayRegistroDeLlamadas()) {
      const inicioEjecucion = Date.parse(estado.ejecucion?.inicio ?? "") || 0;
      const previas = runs.filter((r) => r?.id && terminada(r) && cuandoDe(r) < inicioEjecucion && !llamadaAtendida(r.id)).map((r) => r.id);
      marcarLlamadasAtendidas(previas, new Date(ahora));
      resultado.anterioresAlArranque = previas.length;
    }
    e.sembrado = true;
    for (const run of runs) {
      if (!run?.id || llamadaAtendida(run.id)) continue;
      const cuando = cuandoDe(run);
      if (!Number.isFinite(cuando) || cuando < desdeMs) continue;
      if (!terminada(run)) continue; // sigue en curso: la herramienta en directo puede llegar todavía
      resultado.revisadas += 1;
      const existente = observacionDeLlamada(estado, run.id);
      const { desde, msgs } = await datosDeLlamada(run.id);
      if (existente) {
        // Llegó el registro pero no la transcripción (falló solo el webhook de colgar).
        if (!existente.texto.includes(MARCA_TRANSCRIPCION) && msgs.length) {
          adjuntarTranscripcion(run.id, textoTranscripcion(msgs), desde);
          resultado.transcripcionesAdjuntadas.push(run.id);
        }
        marcarLlamadasAtendidas([run.id], new Date(ahora));
        continue;
      }
      const plan = planRecuperacion(run.id, desde, msgs);
      if (plan.tipo === "nada") {
        marcarLlamadasAtendidas([run.id], new Date(ahora));
        continue;
      }
      const hora = new Date(cuando).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
      if (plan.tipo === "aviso") {
        if (plan.situar && (plan.situar.lugar || plan.situar.municipio)) await situarLugar(plan.situar, { runId: run.id });
        const r = await registrarAvisoDeLlamada(plan.aviso);
        adjuntarTranscripcion(run.id, textoTranscripcion(msgs), desde);
        estado.registrarEvento(
          "observacion",
          `Llamada al 112 de ${desde ?? "un ciudadano"} (${hora}) recuperada de HappyRobot: no constaba en Atalaya (el enlace falló durante la llamada o el servidor estaba parado) y se ha registrado ahora con lo que dictó la persona (${plan.fuente}).`,
          { agenteId: "centralita", incendioId: r.foco?.id, nivel: "aviso", datos: { observacionId: r.observacionId, referenciaExterna: run.id, recuperada: true, fuente: plan.fuente } },
        );
        // Mismo SMS que el registro en directo (lib/happyrobot/sms-avisos.ts, sesión fireops-00); tolerante.
        try {
          const { enviarSmsAvisoRegistrado } = await import("./sms-avisos");
          void enviarSmsAvisoRegistrado(plan.aviso, r, { ampliacion: false });
        } catch {
          /* sin módulo de SMS: el aviso ya está registrado */
        }
        resultado.recuperadas.push({ runId: run.id, como: `aviso (${plan.fuente})`, observacionId: r.observacionId, impacto: r.impacto });
      } else {
        const { procesarEntrada } = await import("../agentes/percepcion/centralita");
        const obs = await procesarEntrada({ canal: "llamada", texto: `${MARCA_TRANSCRIPCION}\n${plan.texto}`, remitente: desde, referenciaExterna: run.id });
        estado.registrarEvento(
          "observacion",
          `Llamada al 112 de ${desde ?? "un ciudadano"} (${hora}) recuperada de HappyRobot: no constaba en Atalaya (el enlace falló durante la llamada o el servidor estaba parado); el agente no llegó a registrarla y se ha entregado la transcripción a la centralita.`,
          { agenteId: "centralita", nivel: "aviso", datos: { observacionId: obs.id, referenciaExterna: run.id, recuperada: true, fuente: "transcripcion" } },
        );
        resultado.recuperadas.push({ runId: run.id, como: "transcripción", observacionId: obs.id, impacto: obs.impacto ?? null });
      }
      marcarLlamadasAtendidas([run.id], new Date(ahora));
    }
  } catch (err) {
    resultado.error = err instanceof Error ? err.message : String(err);
    console.warn("[112 entrante] recuperación de llamadas:", resultado.error);
  } finally {
    e.enCurso = false;
  }
  if (resultado.recuperadas.length || resultado.transcripcionesAdjuntadas.length) {
    console.log(`[112 entrante] recuperadas ${resultado.recuperadas.length} llamada(s) y ${resultado.transcripcionesAdjuntadas.length} transcripción(es) de HappyRobot`);
  }
  return (e.ultima = resultado);
}

/** Arranca la revisión periódica en este proceso (idempotente; no hace nada sin slug o clave). */
export function arrancarRecuperacionLlamadas(): void {
  const e = est();
  if (e.intervalo || !slugEntrante() || !process.env.HAPPYROBOT_API_KEY?.trim() || CADA_MS <= 0) return;
  e.intervalo = setInterval(() => void recuperarLlamadasPerdidas(), CADA_MS);
  e.intervalo.unref?.();
  // Primera pasada al poco de arrancar: recoge lo que se perdió mientras el servidor estaba parado.
  setTimeout(() => void recuperarLlamadasPerdidas(), 10_000).unref?.();
}
