// =====================================================================
// ATALAYA INCENDIOS · Persistencia asíncrona del estado
// ---------------------------------------------------------------------
// Propósito: enganchar el estado vivo a Supabase sin que el motor espere
// nunca por la base de datos. Se suscribe a los cambios, agrupa 2 s
// (debounce), calcula qué entidades cambiaron de verdad (hash del JSON por
// id) y hace upserts en lote. Los eventos se insertan tal cual.
// Si Supabase falla: marcarServicio("Supabase", false, …) y a seguir en
// memoria; se reintenta en el siguiente volcado.
// DUEÑO: constructor A. Dependencias: lib/db/repositorio.ts.
// =====================================================================

import type { TrazaCiclo } from "../dominio/tipos";
import { establecerEstado, obtenerEstado, type Estado } from "./estado";
import { mensajeDe } from "./enriquecer";
import {
  cargarEjecucionActiva,
  guardarEjecucion,
  guardarLote,
  guardarPolitica,
  guardarTrazas,
  hayPersistencia,
  type OpcionesGuardado,
  type TablaEntidad,
} from "../db/repositorio";

const DEBOUNCE_MS = 2000;

interface EstadoPersistencia {
  desuscribir?: () => void;
  temporizador?: ReturnType<typeof setTimeout>;
  /** id de entidad → huella del JSON guardado la última vez. */
  huellas: Map<string, string>;
  /** Índice del último evento ya insertado. */
  eventosInsertados: number;
  /** Trazas de ciclo ya enviadas (solo se guardan una vez, al cerrarse). */
  trazasEnviadas: Set<string>;
  volcando: boolean;
  arrancada: boolean;
  huellaPolitica?: string;
  huellaEjecucion?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __atalayaPersistencia: EstadoPersistencia | undefined;
}

function pers(): EstadoPersistencia {
  if (!globalThis.__atalayaPersistencia) {
    globalThis.__atalayaPersistencia = { huellas: new Map(), eventosInsertados: 0, trazasEnviadas: new Set(), volcando: false, arrancada: false };
  }
  return globalThis.__atalayaPersistencia;
}

/** Huella barata y estable de una entidad (no hace falta criptografía). */
function huella(objeto: unknown): string {
  const texto = JSON.stringify(objeto);
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return `${texto.length}:${h}`;
}

/** Entidades de un mapa cuyo JSON ha cambiado desde el último volcado. */
function cambiadas<T extends { id: string }>(prefijo: string, items: Iterable<T>): T[] {
  const p = pers();
  const nuevas: T[] = [];
  for (const item of items) {
    const clave = `${prefijo}:${item.id}`;
    const h = huella(item);
    if (p.huellas.get(clave) === h) continue;
    p.huellas.set(clave, h);
    nuevas.push(item);
  }
  return nuevas;
}

async function volcar(): Promise<void> {
  const p = pers();
  if (p.volcando || !hayPersistencia()) return;
  p.volcando = true;
  const estado = obtenerEstado();
  const opciones: OpcionesGuardado = { ejecucionId: estado.ejecucion.id };
  try {
    const tareas: Promise<unknown>[] = [];
    const lote = (tabla: TablaEntidad, items: { id: string }[]) => {
      if (items.length) tareas.push(guardarLote(tabla, items, opciones));
    };

    lote("incendios", cambiadas("inc", estado.incendios.values()));
    lote("unidades", cambiadas("uni", estado.unidades.values()));
    lote("poblaciones", cambiadas("pob", estado.poblaciones.values()));
    lote("observaciones", cambiadas("obs", estado.observaciones.values()));
    lote("decisiones", cambiadas("dec", estado.decisiones.values()));
    lote("informes", cambiadas("inf", estado.informes.values()));
    lote("comunicados", cambiadas("com", estado.comunicados.values()));
    lote("camaras_analisis", cambiadas("cam", [...estado.camaras.values()].filter((c) => !!c.ultimoAnalisis)));

    // Eventos: son inmutables, se insertan tal cual desde donde nos quedamos.
    const pendientes = estado.eventos.slice(p.eventosInsertados);
    if (pendientes.length) {
      p.eventosInsertados = estado.eventos.length;
      tareas.push(guardarLote("eventos", pendientes, opciones));
    }

    // Trazas de ciclo cerradas que aún no se han guardado (auditoría).
    const trazasPendientes: { traza: TrazaCiclo; agenteId: string; incendioId?: string }[] = [];
    for (const agente of estado.agentes.values()) {
      for (const traza of agente.trazas ?? []) {
        if (traza.estado === "en_curso") continue;
        if (p.trazasEnviadas.has(traza.id)) continue;
        p.trazasEnviadas.add(traza.id);
        trazasPendientes.push({ traza, agenteId: agente.id, incendioId: agente.incendioId });
      }
    }
    if (trazasPendientes.length) {
      // Va en su propio try/catch y con su propio nombre de servicio: si falta
      // la tabla `trazas` (migración sin aplicar) no debe teñir de rojo toda la
      // persistencia, que por lo demás está funcionando.
      tareas.push(
        guardarTrazas(trazasPendientes, estado.ejecucion.id)
          .then(() => estado.marcarServicio("Supabase · trazas", true, `${trazasPendientes.length} trazas guardadas`))
          .catch((e) => {
            for (const { traza } of trazasPendientes) p.trazasEnviadas.delete(traza.id);
            estado.marcarServicio("Supabase · trazas", false, mensajeDe(e));
          }),
      );
    }

    const hPolitica = huella(estado.politica);
    if (hPolitica !== p.huellaPolitica) {
      p.huellaPolitica = hPolitica;
      tareas.push(guardarPolitica(estado.politica));
    }
    const hEjecucion = huella(estado.ejecucion);
    if (hEjecucion !== p.huellaEjecucion) {
      p.huellaEjecucion = hEjecucion;
      tareas.push(guardarEjecucion(estado.ejecucion));
    }

    if (!tareas.length) return;
    await Promise.all(tareas);
    estado.marcarServicio("Supabase", true, `${tareas.length} lotes escritos`);
  } catch (e) {
    // Reintento: se olvidan las huellas para volver a mandar todo la próxima vez.
    p.huellas.clear();
    p.huellaPolitica = undefined;
    p.huellaEjecucion = undefined;
    estado.marcarServicio("Supabase", false, mensajeDe(e));
  } finally {
    p.volcando = false;
  }
}

function programarVolcado(): void {
  const p = pers();
  if (p.temporizador) return;
  p.temporizador = setTimeout(() => {
    p.temporizador = undefined;
    void volcar();
  }, DEBOUNCE_MS);
  (p.temporizador as unknown as { unref?: () => void }).unref?.();
}

/** Engancha la persistencia al estado vivo. */
export function engancharPersistencia(estado: Estado): void {
  const p = pers();
  p.desuscribir?.();
  p.huellas.clear();
  p.eventosInsertados = 0;
  p.trazasEnviadas.clear();
  p.huellaPolitica = undefined;
  p.huellaEjecucion = undefined;
  p.desuscribir = estado.suscribir(() => programarVolcado());
}

/**
 * Al arrancar: si hay cliente y existe una ejecución activa en la base, la
 * carga (así un reinicio en Railway no pierde la partida); si no, guarda la
 * ejecución nueva. Siempre engancha el guardado incremental.
 */
export async function arrancarPersistencia(): Promise<void> {
  const p = pers();
  if (p.arrancada) return;
  p.arrancada = true;

  let estado = obtenerEstado();
  if (!hayPersistencia()) {
    // El cliente acepta SUPABASE_SERVICE_ROLE_KEY o, en su defecto, SUPABASE_ANON_KEY
    // (ver lib/db/cliente.ts): el mensaje debe nombrar las dos o parece que falta una
    // clave que en realidad no hace falta.
    estado.marcarServicio("Supabase", false, "Sin SUPABASE_URL o sin SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY: la ejecución vive solo en memoria");
    return;
  }

  try {
    const recuperado = await cargarEjecucionActiva();
    if (recuperado) {
      // Se conservan los agentes ya registrados en el estado en curso.
      for (const [id, ficha] of estado.agentes) if (!recuperado.agentes.has(id)) recuperado.agentes.set(id, ficha);
      recuperado.servicios = { ...estado.servicios };
      establecerEstado(recuperado);
      estado = recuperado;
      estado.registrarEvento("sistema", `Ejecución recuperada de Supabase: ${estado.ejecucion.nombre} (${estado.incendios.size} incendios)`, { nivel: "info" });
    } else {
      await guardarEjecucion(estado.ejecucion);
    }
    estado.marcarServicio("Supabase", true, recuperado ? "ejecución recuperada" : "ejecución nueva registrada");
  } catch (e) {
    estado.marcarServicio("Supabase", false, mensajeDe(e));
  }

  engancharPersistencia(estado);
  await volcar();
}

/** Fuerza un volcado inmediato (al cerrar una ejecución o desde scripts). */
export async function volcarAhora(): Promise<void> {
  const p = pers();
  if (p.temporizador) {
    clearTimeout(p.temporizador);
    p.temporizador = undefined;
  }
  await volcar();
}
