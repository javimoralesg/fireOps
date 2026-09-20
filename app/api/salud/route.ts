// GET /api/salud · Healthcheck de Railway y barra de servicios. DUEÑO: constructor A.
import { obtenerEstado } from "@/lib/motor/estado";
import { origenUrlPublica, urlPublica } from "@/lib/motor/entorno";
import { arrancarOrquestador, estadoDelNucleo } from "@/lib/motor/orquestador";
import { json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------
// Recuento de Supabase: cacheado 30 s y refrescado EN SEGUNDO PLANO
// ---------------------------------------------------------------------
// (constructor T, 2026-09-19) `contarPersistidos` son dos `count` contra
// Supabase y se llevaban ~0,5 s de los ~0,6 s de este endpoint, que es el
// healthcheck de Railway y la barra de servicios (se pide cada pocos segundos).
// Con la caché la petición no espera nunca a la base de datos: devuelve el
// último recuento conocido —con su marca de tiempo— y pide el siguiente aparte.
const CACHE_RECUENTO_MS = 30_000;
type GlobalSalud = typeof globalThis & {
  __atalayaRecuento?: { en: number; ejecucionId: string; valor: { trazas: number; informes: number } | null };
  __atalayaRecuentoEnCurso?: Promise<void>;
};
const gs = globalThis as GlobalSalud;

function recuentoPersistido(ejecucionId: string): { trazas: number; informes: number; en: string } | null {
  const c = gs.__atalayaRecuento;
  const vigente = c && c.ejecucionId === ejecucionId && Date.now() - c.en < CACHE_RECUENTO_MS;
  if (!vigente && !gs.__atalayaRecuentoEnCurso) {
    gs.__atalayaRecuentoEnCurso = (async () => {
      try {
        const { contarPersistidos } = await import("@/lib/db/repositorio");
        const valor = await contarPersistidos(ejecucionId);
        gs.__atalayaRecuento = { en: Date.now(), ejecucionId, valor };
      } catch {
        // Sin base de datos o sin respuesta: se dice (null), no se inventa.
        gs.__atalayaRecuento = { en: Date.now(), ejecucionId, valor: null };
      } finally {
        gs.__atalayaRecuentoEnCurso = undefined;
      }
    })();
  }
  const c2 = gs.__atalayaRecuento;
  if (!c2 || c2.ejecucionId !== ejecucionId || !c2.valor) return null;
  return { ...c2.valor, en: new Date(c2.en).toISOString() };
}

export async function GET(): Promise<Response> {
  arrancarOrquestador();
  const estado = obtenerEstado();
  const memoria = process.memoryUsage();
  const servicios = estado.servicios;
  const caidos = Object.entries(servicios).filter(([, v]) => !v.ok).map(([k]) => k);

  // Auditoría: actas y trazas en memoria y las ya guardadas en Supabase.
  const trazasEnMemoria = [...estado.agentes.values()].reduce((n, a) => n + (a.trazas?.length ?? 0), 0);
  const informesPorTipo: Record<string, number> = {};
  for (const i of estado.informes.values()) informesPorTipo[i.tipo] = (informesPorTipo[i.tipo] ?? 0) + 1;
  // El recuento en Supabase NO se espera: este endpoint es el healthcheck de
  // Railway y no puede quedarse colgado de la base de datos (si tardase,
  // Railway reiniciaría el contenedor por un fallo que no es suyo). Se sirve el
  // último recuento conocido (≤ 30 s) y el siguiente se pide en segundo plano.
  // `null` = sin base de datos o sin recuento todavía: se dice, no se inventa.
  const persistidos = recuentoPersistido(estado.ejecucion.id);

  // --- IA: proveedor, modelos, contadores y cola de concurrencia -------
  let ia: Record<string, unknown> = { ok: false, detalle: "No se ha podido leer la capa de IA" };
  try {
    const { estadisticasLLM, estadoColaLLM, motivoIndisponible } = await import("@/lib/ia/llm");
    const e = estadisticasLLM();
    const cola = estadoColaLLM();
    ia = {
      ok: e.disponible,
      proveedor: e.proveedor,
      modelos: e.modelos,
      detalle: e.disponible
        ? `${e.proveedor} · razonamiento ${e.modelos.razonamiento}, rápido ${e.modelos.rapido}, visión ${e.modelos.vision} · cola ${cola.enCurso}/${cola.maximo} en curso, ${cola.esperando} esperando`
        : motivoIndisponible() ?? "Sin proveedor de IA",
      cola,
      porPapel: e.porPapel,
    };
  } catch (err) {
    ia = { ok: false, detalle: `Capa de IA no disponible: ${err instanceof Error ? err.message : String(err)}` };
  }

  // --- Integraciones de salida: HappyRobot y Telegram -------------------
  const integraciones: Record<string, unknown> = {};
  try {
    const { estadoCanal } = await import("@/lib/happyrobot/cliente");
    const canales = (["voz", "sms", "email"] as const).map((c) => ({ canal: c, ...estadoCanal(c) }));
    integraciones.HappyRobot = {
      ok: canales.every((c) => c.ok),
      detalle: canales.every((c) => c.ok)
        ? "Voz, SMS y email listos"
        : canales.filter((c) => !c.ok).map((c) => c.detalle).join(" · "),
      canales,
    };
  } catch (err) {
    integraciones.HappyRobot = { ok: false, detalle: `No se pudo leer HappyRobot: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    const { estadoTelegram } = await import("@/lib/telegram/cliente");
    integraciones.Telegram = estadoTelegram();
  } catch (err) {
    integraciones.Telegram = { ok: false, detalle: `No se pudo leer Telegram: ${err instanceof Error ? err.message : String(err)}` };
  }
  // Supabase: lo marca la persistencia, pero si aún no ha corrido no aparece.
  if (!servicios.Supabase) {
    // Mismo orden de claves que lib/db/cliente.ts: la de servicio o, si no, la anónima.
    const hayClaves =
      !!process.env.SUPABASE_URL?.trim() &&
      (!!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || !!process.env.SUPABASE_ANON_KEY?.trim());
    const { persistenciaActivada } = await import("@/lib/db/repositorio");
    integraciones.Supabase = {
      ok: false,
      detalle: hayClaves
        ? persistenciaActivada()
          ? "Configurada, pendiente del primer volcado"
          : "Esta instancia no guarda la ejecución (SUPABASE_PERSISTIR sin activar): vive solo en memoria"
        : "Sin SUPABASE_URL o sin SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY: la ejecución vive solo en memoria",
    };
  }
  // OSRM no tiene ping propio: se refleja el último uso real que anotó el despachador.
  if (!servicios.OSRM) {
    const conRuta = [...estado.unidades.values()].filter((u) => u.ruta?.fuente === "OSRM").length;
    integraciones.OSRM = conRuta
      ? { ok: true, detalle: `${conRuta} ruta(s) reales calculadas en esta ejecución` }
      : { ok: true, detalle: "Sin rutas pedidas todavía en esta ejecución (router.project-osrm.org)" };
  }

  return json({
    ok: true, // el proceso responde; los servicios externos van aparte
    version: estado.version,
    ejecucion: { id: estado.ejecucion.id, nombre: estado.ejecucion.nombre, estado: estado.ejecucion.estado, inicio: estado.ejecucion.inicio },
    reloj: estado.reloj,
    nucleo: estadoDelNucleo(),
    agentes: {
      total: estado.agentes.size,
      pausados: [...estado.agentes.values()].filter((a) => a.pausado).length,
      enError: [...estado.agentes.values()].filter((a) => a.estado === "error").map((a) => a.id),
    },
    incendiosActivos: estado.incendiosActivos().length,
    // Bloque de IA: proveedor, modelos por papel, contadores de uso y la cola de
    // concurrencia. Sin esto no había forma de ver desde fuera si el cuello de
    // botella era el proveedor o la cola (LLM_CONCURRENCIA).
    ia,
    // Integraciones de salida: sin ellas los agentes proponen pero no actúan.
    integraciones,
    auditoria: {
      informesEnMemoria: estado.informes.size,
      informesPorTipo,
      trazasEnMemoria,
      decisionesConTraza: [...estado.decisiones.values()].filter((d) => !!d.trazaId).length,
      accionesConActa: [...estado.decisiones.values()].reduce((n, d) => n + d.acciones.filter((a) => !!a.informeId).length, 0),
      persistidos, // null = sin Supabase o sin respuesta
    },
    decisionesPendientes: estado.decisionesPendientesHumano().length,
    servicios,
    serviciosCaidos: caidos,
    urlPublica: { valor: urlPublica() ?? null, origen: origenUrlPublica() },
    proceso: {
      nodo: process.version,
      tiempoEnPieS: Math.round(process.uptime()),
      memoriaMB: {
        rss: Math.round(memoria.rss / 1024 / 1024),
        heapUsado: Math.round(memoria.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoria.heapTotal / 1024 / 1024),
      },
    },
  });
}
