// =====================================================================
// ATALAYA INCENDIOS · Persistencia asíncrona del estado
// ---------------------------------------------------------------------
// Propósito: enganchar el estado vivo a Supabase sin que el motor espere
// nunca por la base de datos. Se suscribe a los cambios, agrupa 2 s
// (debounce) y hace upserts en lote SOLO de lo que cambió.
//
// REESCRITO (constructor S, 2026-09-19) por tres problemas medidos:
//  1. cada 2 s se hacía JSON.stringify de TODAS las entidades (con actas de
//     decenas de miles de caracteres) solo para detectar cambios. Ahora el
//     estado dice qué ids cambiaron (`estado.consumirCambios()`, contrato del
//     constructor A) y una pasada sin cambios no toca ni un objeto.
//  2. ante CUALQUIER error de Supabase se vaciaban las huellas y 2 s después
//     se re-subía TODO el estado, en bucle mientras la base fallase. Ahora
//     solo se reencola el LOTE fallido, con retroceso exponencial por tabla.
//  3. los eventos se seguían por índice de array: al llegar a 5000 el splice
//     de `estado.ts` dejaba la longitud clavada en 5000 y, como
//     `eventosInsertados` también valía 5000, los eventos dejaban de
//     guardarse en silencio. Ahora se siguen por id.
//
// Si Supabase falla: marcarServicio("Supabase", false, …) y a seguir en
// memoria; se reintenta el lote pendiente con retroceso.
// DUEÑO: constructor A (rendimiento: constructor S). Dependencias: lib/db/repositorio.ts.
// =====================================================================

import type { TrazaCiclo } from "../dominio/tipos";
import { establecerEstado, obtenerEstado, type Estado } from "./estado";
import { mensajeDe } from "./enriquecer";
import { obtenerClienteSupabase } from "../db/cliente";
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
/** Primer retroceso tras un lote fallido; se dobla en cada fallo seguido. */
const RETROCESO_BASE_MS = 2000;
const RETROCESO_MAX_MS = 120_000;
/** Tope de ids de traza recordados (se podan los más antiguos: el Set conserva el orden). */
const MAX_TRAZAS_RECORDADAS = 5000;
/** Tope de ids pendientes por tabla: si Supabase lleva caído mucho rato, no se crece sin fin. */
const MAX_PENDIENTES_POR_TABLA = 20_000;

/**
 * Nombre de colección del Estado → tabla de Supabase. Los nombres son los de
 * las propiedades de `Estado` (contrato de `consumirCambios`). Lo que no esté
 * aquí (agentes, lecciones, servicios, tickets…) no se persiste por esta vía.
 */
const TABLA_POR_COLECCION: Record<string, TablaEntidad> = {
  incendios: "incendios",
  unidades: "unidades",
  poblaciones: "poblaciones",
  observaciones: "observaciones",
  decisiones: "decisiones",
  informes: "informes",
  comunicados: "comunicados",
  camaras: "camaras_analisis",
  eventos: "eventos",
};

interface Fallo {
  intentos: number;
  proximoIntento: number;
}

interface EstadoPersistencia {
  desuscribir?: () => void;
  temporizador?: ReturnType<typeof setTimeout>;
  /** Ids por tabla a los que aún les falta confirmación de Supabase. */
  pendientes: Map<TablaEntidad, Set<string>>;
  /** Retroceso exponencial por tabla tras un lote fallido. */
  fallos: Map<TablaEntidad, Fallo>;
  /** RESPALDO (solo si el Estado no expone `consumirCambios`): huella por entidad. */
  huellas: Map<string, string>;
  /** RESPALDO: id del último evento insertado (nunca un índice: ver cabecera). */
  ultimoEventoId?: string;
  /** Trazas de ciclo ya enviadas (solo se guardan una vez, al cerrarse). */
  trazasEnviadas: Set<string>;
  volcando: boolean;
  arrancada: boolean;
  /** true cuando `arrancarPersistencia` ya cargó (o intentó cargar) la ejecución activa: el Estado es el definitivo. */
  rehidratada: boolean;
  huellaPolitica?: string;
  huellaEjecucion?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __atalayaPersistencia: EstadoPersistencia | undefined;
}

function pers(): EstadoPersistencia {
  if (!globalThis.__atalayaPersistencia) {
    globalThis.__atalayaPersistencia = {
      pendientes: new Map(),
      fallos: new Map(),
      huellas: new Map(),
      trazasEnviadas: new Set(),
      volcando: false,
      arrancada: false,
      rehidratada: false,
    };
  }
  return globalThis.__atalayaPersistencia;
}

function reiniciar(p: EstadoPersistencia): void {
  p.pendientes.clear();
  p.fallos.clear();
  p.huellas.clear();
  p.trazasEnviadas.clear();
  p.ultimoEventoId = undefined;
  p.huellaPolitica = undefined;
  p.huellaEjecucion = undefined;
}

/** Huella barata y estable de un objeto pequeño (no hace falta criptografía). */
function huella(objeto: unknown): string {
  const texto = JSON.stringify(objeto);
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return `${texto.length}:${h}`;
}

function apuntar(p: EstadoPersistencia, tabla: TablaEntidad, ids: Iterable<string>): void {
  let conjunto = p.pendientes.get(tabla);
  if (!conjunto) {
    conjunto = new Set();
    p.pendientes.set(tabla, conjunto);
  }
  for (const id of ids) {
    if (conjunto.size >= MAX_PENDIENTES_POR_TABLA) break;
    conjunto.add(id);
  }
}

/** true si a este id todavía le falta confirmación de Supabase (lo consulta la poda de memoria). */
export function esperandoPersistencia(tabla: TablaEntidad, id: string): boolean {
  return pers().pendientes.get(tabla)?.has(id) ?? false;
}

// ---------------------------------------------------------------------
// Detección de cambios
// ---------------------------------------------------------------------

type ConCambios = Estado & {
  consumirCambios?: () => Map<string, Set<string>>;
};

/**
 * Pasa a `pendientes` lo que ha cambiado desde la última vuelta.
 * Camino principal: `estado.consumirCambios()` (O(cambios)).
 * Respaldo (si A aún no lo ha publicado): huella por entidad, pero SOLO de las
 * colecciones pequeñas y con una huella ligera para los informes, que son los
 * que pesan decenas de miles de caracteres cada uno.
 */
function recogerCambios(estado: Estado): void {
  const p = pers();
  const conCambios = estado as ConCambios;
  if (typeof conCambios.consumirCambios === "function") {
    for (const [coleccion, ids] of conCambios.consumirCambios()) {
      const tabla = TABLA_POR_COLECCION[coleccion];
      if (tabla) apuntar(p, tabla, ids);
    }
    return;
  }
  recogerCambiosPorHuella(estado);
}

function recogerCambiosPorHuella(estado: Estado): void {
  const p = pers();
  const porHuella = <T extends { id: string }>(tabla: TablaEntidad, prefijo: string, items: Iterable<T>, ligera?: (item: T) => unknown) => {
    const nuevos: string[] = [];
    for (const item of items) {
      const clave = `${prefijo}:${item.id}`;
      const h = huella(ligera ? ligera(item) : item);
      if (p.huellas.get(clave) === h) continue;
      p.huellas.set(clave, h);
      nuevos.push(item.id);
    }
    if (nuevos.length) apuntar(p, tabla, nuevos);
  };

  porHuella("incendios", "inc", estado.incendios.values());
  porHuella("unidades", "uni", estado.unidades.values());
  porHuella("poblaciones", "pob", estado.poblaciones.values());
  porHuella("observaciones", "obs", estado.observaciones.values());
  porHuella("decisiones", "dec", estado.decisiones.values());
  // Los informes solo cambian cuando cambia su contenido, y `huella` ya es su
  // SHA-256: no hace falta volver a serializar el Markdown entero.
  porHuella("informes", "inf", estado.informes.values(), (i) => `${i.huella}|${i.estadoDecision ?? ""}|${i.modelo}`);
  porHuella("comunicados", "com", estado.comunicados.values());
  porHuella("camaras_analisis", "cam", [...estado.camaras.values()].filter((c) => !!c.ultimoAnalisis));

  // Eventos: inmutables y en orden; se avanza desde el ÚLTIMO ID insertado
  // (nunca desde un índice: con el recorte a 5000 el índice se quedaba fijo).
  const total = estado.eventos.length;
  if (!total) return;
  let desde = 0;
  if (p.ultimoEventoId) {
    const i = indiceDeEvento(estado, p.ultimoEventoId);
    desde = i >= 0 ? i + 1 : 0;
  }
  const nuevos = estado.eventos.slice(desde);
  if (nuevos.length) {
    p.ultimoEventoId = estado.eventos[total - 1].id;
    apuntar(p, "eventos", nuevos.map((e) => e.id));
  }
}

function indiceDeEvento(estado: Estado, id: string): number {
  for (let i = estado.eventos.length - 1; i >= 0; i--) if (estado.eventos[i].id === id) return i;
  return -1;
}

/** Entidades vivas correspondientes a los ids pendientes de una tabla. */
function entidadesDe(estado: Estado, tabla: TablaEntidad, ids: Set<string>): { id: string }[] {
  if (tabla === "eventos") {
    // Recorrido hacia atrás: los eventos pendientes son siempre los últimos.
    const encontrados: { id: string }[] = [];
    const faltan = new Set(ids);
    for (let i = estado.eventos.length - 1; i >= 0 && faltan.size; i--) {
      const ev = estado.eventos[i];
      if (faltan.delete(ev.id)) encontrados.push(ev);
    }
    return encontrados.reverse();
  }
  const mapa = mapaDe(estado, tabla);
  if (!mapa) return [];
  const salida: { id: string }[] = [];
  for (const id of ids) {
    const item = mapa.get(id);
    if (item) salida.push(item);
  }
  return salida;
}

function mapaDe(estado: Estado, tabla: TablaEntidad): Map<string, { id: string }> | undefined {
  switch (tabla) {
    case "incendios": return estado.incendios;
    case "unidades": return estado.unidades;
    case "poblaciones": return estado.poblaciones;
    case "observaciones": return estado.observaciones;
    case "decisiones": return estado.decisiones;
    case "informes": return estado.informes;
    case "comunicados": return estado.comunicados;
    case "camaras_analisis": return estado.camaras as unknown as Map<string, { id: string }>;
    default: return undefined;
  }
}

// ---------------------------------------------------------------------
// Volcado
// ---------------------------------------------------------------------

async function volcar(): Promise<void> {
  const p = pers();
  if (p.volcando || !hayPersistencia()) return;
  p.volcando = true;
  const estado = obtenerEstado();
  const opciones: OpcionesGuardado = { ejecucionId: estado.ejecucion.id };
  const ahora = Date.now();
  let hayFallo = "";
  try {
    recogerCambios(estado);

    const tareas: Promise<unknown>[] = [];
    for (const [tabla, ids] of p.pendientes) {
      if (!ids.size) continue;
      const fallo = p.fallos.get(tabla);
      if (fallo && ahora < fallo.proximoIntento) continue; // en retroceso: ya le tocará

      const enviados = [...ids];
      let items = entidadesDe(estado, tabla, ids);
      if (tabla === "camaras_analisis") items = items.filter((c) => !!(c as { ultimoAnalisis?: unknown }).ultimoAnalisis);
      // Ids que ya no existen (entidad podada o nunca guardada): se olvidan.
      const vivos = new Set(items.map((i) => i.id));
      for (const id of enviados) if (!vivos.has(id)) ids.delete(id);
      if (!items.length) continue;

      tareas.push(
        guardarLote(tabla, items, opciones)
          .then(() => {
            for (const item of items) ids.delete(item.id);
            p.fallos.delete(tabla);
          })
          .catch((e) => {
            // SOLO se reencola este lote (los ids siguen en `ids`), con retroceso.
            const previo = p.fallos.get(tabla);
            const intentos = (previo?.intentos ?? 0) + 1;
            p.fallos.set(tabla, {
              intentos,
              proximoIntento: Date.now() + Math.min(RETROCESO_MAX_MS, RETROCESO_BASE_MS * 2 ** (intentos - 1)),
            });
            hayFallo = `${tabla}: ${mensajeDe(e)}`;
          }),
      );
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
    podarTrazasRecordadas(p);
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
      tareas.push(
        guardarPolitica(estado.politica)
          .then(() => { p.huellaPolitica = hPolitica; })
          .catch((e) => { hayFallo = `politica: ${mensajeDe(e)}`; }),
      );
    }
    const hEjecucion = huella(estado.ejecucion);
    if (hEjecucion !== p.huellaEjecucion) {
      tareas.push(
        guardarEjecucion(estado.ejecucion)
          .then(() => { p.huellaEjecucion = hEjecucion; })
          .catch((e) => { hayFallo = `ejecuciones: ${mensajeDe(e)}`; }),
      );
    }

    if (!tareas.length) return;
    await Promise.all(tareas);
    if (hayFallo) estado.marcarServicio("Supabase", false, hayFallo);
    else estado.marcarServicio("Supabase", true, `${tareas.length} lotes escritos`);
  } catch (e) {
    // Nada de `huellas.clear()`: lo pendiente ya está anotado por id y se
    // reintenta solo; vaciar las huellas re-subía TODO el estado cada 2 s.
    estado.marcarServicio("Supabase", false, mensajeDe(e));
  } finally {
    p.volcando = false;
    // Si algo quedó pendiente (fallo o retroceso), se vuelve a intentar.
    for (const ids of p.pendientes.values()) {
      if (ids.size) { programarVolcado(); break; }
    }
  }
}

function podarTrazasRecordadas(p: EstadoPersistencia): void {
  while (p.trazasEnviadas.size > MAX_TRAZAS_RECORDADAS) {
    const masVieja = p.trazasEnviadas.values().next().value;
    if (masVieja === undefined) break;
    p.trazasEnviadas.delete(masVieja);
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
  reiniciar(p);
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
    estado.marcarServicio(
      "Supabase",
      true,
      obtenerClienteSupabase()
        ? "Persistencia opcional desactivada (SUPABASE_PERSISTIR sin activar): esta instancia vive solo en memoria"
        : "Supabase opcional no configurado: la ejecución vive solo en memoria",
    );
    p.rehidratada = true;
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
  p.rehidratada = true;

  // Nota: `cargarEjecucionActiva` rellena los mapas directamente (sin pasar por
  // `guardar`), así que lo recuperado de la base no queda marcado como cambio y
  // no se re-sube. Solo se suben las mutaciones posteriores.
  engancharPersistencia(estado);
  await volcar();
}

/**
 * true cuando el Estado en memoria ya es el definitivo: sin persistencia, siempre; con ella,
 * cuando `arrancarPersistencia` ha cargado (o intentado cargar) la ejecución activa. La
 * recuperación de llamadas al 112 (lib/happyrobot/recuperar-llamadas.ts) espera a esto:
 * una llamada atendida en directo y aún no rehidratada parecería perdida y se registraría dos veces.
 */
export function rehidratacionTerminada(): boolean {
  return !hayPersistencia() || pers().rehidratada;
}

/** Fuerza un volcado inmediato (al cerrar una ejecución o desde scripts). */
export async function volcarAhora(): Promise<void> {
  const p = pers();
  if (p.temporizador) {
    clearTimeout(p.temporizador);
    p.temporizador = undefined;
  }
  // Un volcado forzado no respeta el retroceso: es el último tren.
  p.fallos.clear();
  await volcar();
}
