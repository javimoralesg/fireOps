// =====================================================================
// ATALAYA INCENDIOS · Almacén de estado en memoria (CONTRATO + base)
// ---------------------------------------------------------------------
// Fuente de verdad en caliente. Un único proceso Node (Railway) lo tiene
// en memoria; la persistencia en Supabase la añade el agente constructor
// "núcleo" enganchándose a `suscribir` (sin cambiar estas firmas).
// Todas las mutaciones pasan por métodos que suben `version` y avisan a
// los suscriptores (SSE). Los agentes NUNCA tocan los arrays a mano.
// =====================================================================

import type {
  AvisoMeteo,
  Camara,
  Cluster,
  Comunicado,
  Decision,
  Ejecucion,
  EstadoAgenteApp,
  Evento,
  FocoSatelite,
  Hospital,
  Incendio,
  Informe,
  Leccion,
  Observacion,
  Poblacion,
  PoliticaAutonomia,
  Reloj,
  Snapshot,
  Ticket,
  TipoEvento,
  Unidad,
  ZonaPeligro,
} from "../dominio/tipos";
import { politicaPorDefecto } from "../dominio/politica-defecto";
import { nuevoId } from "./ids";

export type Suscriptor = (snapshot: Snapshot) => void;

const MAX_EVENTOS_SNAPSHOT = 200;
/** Caracteres de acta que viajan en el Snapshot (el resto, por API). */
const EXTRACTO_INFORME = 400;

/**
 * AÑADIDO (constructor P, OPCIONAL): sellos de cambio para que el navegador
 * pueda conservar identidades al fusionar dos snapshots.
 *   · `coleccion[nombre]` sube solo cuando algún item de esa colección cambió;
 *     si no cambió, el cliente reutiliza la MISMA referencia de array.
 *   · `item[nombre][i]` es el sello del item i (mismo orden que el array de la
 *     colección): si no cambió, el cliente reutiliza el MISMO objeto.
 * Los sellos son el valor de `version` en el que se detectó el cambio.
 */
export interface SellosSnapshot {
  coleccion: Record<string, number>;
  item: Record<string, number[]>;
}

/** Snapshot con los sellos opcionales (el tipo del contrato no los declara todavía). */
export type SnapshotSellado = Snapshot & { sellos?: SellosSnapshot };

/** Colecciones del Snapshot que viven en un `Map` de Estado (nombre = propiedad). */
const COLECCIONES_MAPA = [
  "incendios",
  "clusters",
  "unidades",
  "poblaciones",
  "hospitales",
  "camaras",
  "focosSatelite",
  "observaciones",
  "decisiones",
  "comunicados",
  "informes",
  "tickets",
  "agentes",
  "lecciones",
] as const;

/** Clave estable de un item de colección (`zonasPeligro` se identifica por nombre). */
function claveDe(item: { id?: string; nombre?: string }): string {
  return item.id ?? item.nombre ?? "";
}

export class Estado {
  version = 0;
  reloj: Reloj;
  ejecucion: Ejecucion;
  incendios = new Map<string, Incendio>();
  clusters = new Map<string, Cluster>();
  unidades = new Map<string, Unidad>();
  poblaciones = new Map<string, Poblacion>();
  hospitales = new Map<string, Hospital>();
  camaras = new Map<string, Camara>();
  focosSatelite = new Map<string, FocoSatelite>();
  observaciones = new Map<string, Observacion>();
  decisiones = new Map<string, Decision>();
  comunicados = new Map<string, Comunicado>();
  /** AÑADIDO (constructor A): informes generados por el redactor. */
  informes = new Map<string, Informe>();
  /** AÑADIDO (constructor D): partes internos abiertos por la acción `abrir_ticket`. */
  tickets = new Map<string, Ticket>();
  agentes = new Map<string, EstadoAgenteApp>();
  lecciones = new Map<string, Leccion>();
  avisosMeteo: AvisoMeteo[] = [];
  /** AÑADIDO (constructor B): peligro por zonas representativas de España. */
  zonasPeligro: ZonaPeligro[] = [];
  eventos: Evento[] = [];
  politica: PoliticaAutonomia;
  servicios: Snapshot["servicios"] = {};

  private suscriptores = new Set<Suscriptor>();
  /** Los que pidieron el Snapshot materializado (no el perezoso). */
  private suscriptoresReales = new Set<Suscriptor>();
  private cacheSnapshot?: SnapshotSellado;
  private cacheSnapshotVersion = -1;
  private cacheTexto?: string;
  private cacheTextoVersion = -1;

  // --- notificación coalescida (una por vuelta del bucle de eventos) ---
  private notificacionProgramada = false;
  private notificacionPendiente = false;
  private profundidadLote = 0;

  // --- registro de cambios para la persistencia (constructor D) ---
  private cambios = new Map<string, Set<string>>();
  /** Índice inverso mapa → nombre de colección, para `guardar`/`actualizar`/`eliminar`. */
  private nombresDeMapa?: Map<object, string>;

  // --- sellos de cambio por colección e item (identidad en el cliente) ---
  private sellosColeccion = new Map<string, number>();
  private sellosItem = new Map<string, Map<string, number>>();
  /** Último array servido por colección, para detectar cambios por referencia. */
  private arraysPrevios = new Map<string, readonly { id?: string; nombre?: string }[]>();
  /** Ids marcados a mano (mutación en sitio) que hay que re-sellar en el próximo snapshot. */
  private forzados = new Map<string, Set<string>>();
  /** Extractos de acta ya recortados, memorizados por el informe original. */
  private extractos = new WeakMap<Informe, Informe>();

  constructor(ejecucion?: Ejecucion, reloj?: Reloj) {
    const ahora = new Date().toISOString();
    this.reloj = reloj ?? {
      inicioReal: ahora,
      inicioMundo: ahora,
      factor: Number(process.env.ACELERACION_TIEMPO ?? 12),
      ahoraMundo: ahora,
      pausado: false,
      tick: 0,
    };
    this.ejecucion = ejecucion ?? {
      id: nuevoId("ejec"),
      nombre: `Ejecución ${ahora.slice(0, 16).replace("T", " ")}`,
      inicio: ahora,
      estado: "activa",
      metricas: {
        incendios: 0,
        decisionesPropuestas: 0,
        decisionesAprobadas: 0,
        decisionesDenegadas: 0,
        decisionesAutonomas: 0,
        escaladasAHumano: 0,
        poblacionesAvisadas: 0,
        poblacionesEnPeligroSinAvisar: 0,
        llamadasRealizadas: 0,
        llamadasContestadas: 0,
        falsosPositivosCamara: 0,
      },
    };
    this.politica = politicaPorDefecto();
  }

  // ---------------- suscripción / versión ----------------

  /**
   * Avisa tras cada cambio (de forma coalescida: un aviso por vuelta del bucle
   * de eventos, con la versión final).
   *
   * El Snapshot que recibe el suscriptor es PEREZOSO: se materializa solo si se
   * lee alguna propiedad, para no construir megas por gusto (la mayoría de
   * suscriptores solo quieren saber que algo cambió). Se puede leer, recorrer,
   * desestructurar y serializar con JSON; lo único que no admite es
   * `structuredClone`. Si hace falta el objeto de verdad: `{ real: true }`.
   */
  suscribir(fn: Suscriptor, opciones: { real?: boolean } = {}): () => void {
    this.suscriptores.add(fn);
    if (opciones.real) this.suscriptoresReales.add(fn);
    return () => {
      this.suscriptores.delete(fn);
      this.suscriptoresReales.delete(fn);
    };
  }

  /**
   * Sube la versión, invalida las cachés y avisa. Llamar tras cualquier mutación.
   *
   * Es O(1): el Snapshot ya NO se construye aquí (se construye perezosamente en
   * `snapshot()` y se cachea por versión) y la notificación se agrupa: por muy
   * seguidas que vayan las mutaciones, los suscriptores reciben UN solo aviso
   * por vuelta del bucle de eventos, con la versión final.
   *
   * El aviso es asíncrono (setImmediate). Si hace falta el snapshot al instante,
   * llámese a `estado.snapshot()` (que es el que de verdad lo materializa).
   */
  tocar(): void {
    this.version += 1;
    this.cacheSnapshot = undefined;
    this.cacheTexto = undefined;
    this.programarNotificacion();
  }

  /**
   * Agrupa varias mutaciones en una sola notificación (la versión sigue subiendo
   * una vez por mutación). Reentrante: solo el `lote` más externo notifica.
   */
  lote<T>(fn: () => T): T {
    this.profundidadLote += 1;
    try {
      return fn();
    } finally {
      this.profundidadLote -= 1;
      if (this.profundidadLote === 0 && this.notificacionPendiente) {
        this.notificacionPendiente = false;
        this.programarNotificacion();
      }
    }
  }

  private programarNotificacion(): void {
    if (this.profundidadLote > 0) {
      this.notificacionPendiente = true;
      return;
    }
    if (this.notificacionProgramada) return;
    this.notificacionProgramada = true;
    const disparar = () => {
      this.notificacionProgramada = false;
      this.notificar();
    };
    if (typeof setImmediate === "function") {
      const t = setImmediate(disparar);
      (t as unknown as { unref?: () => void }).unref?.();
    } else {
      queueMicrotask(disparar);
    }
  }

  private notificar(): void {
    if (this.suscriptores.size === 0) return;
    // Perezoso: la mayoría de suscriptores (persistencia, orquestador, SSE) no
    // miran el argumento, así que no se paga la construcción del Snapshot salvo
    // que alguien lo lea de verdad.
    const perezoso = this.snapshotPerezoso();
    for (const fn of [...this.suscriptores]) {
      try {
        fn(this.suscriptoresReales.has(fn) ? this.snapshot() : perezoso);
      } catch (e) {
        console.error("[estado] suscriptor falló", e);
      }
    }
  }

  /** Snapshot que solo se materializa si alguien lee alguna propiedad. */
  private snapshotPerezoso(): Snapshot {
    let real: SnapshotSellado | undefined;
    const materializar = (): SnapshotSellado => (real ??= this.snapshot() as SnapshotSellado);
    return new Proxy({} as SnapshotSellado, {
      get: (_d, clave) => (materializar() as unknown as Record<string | symbol, unknown>)[clave],
      has: (_d, clave) => clave in materializar(),
      ownKeys: () => Reflect.ownKeys(materializar()),
      getOwnPropertyDescriptor: (_d, clave) => {
        const d = Object.getOwnPropertyDescriptor(materializar(), clave);
        return d ? { ...d, configurable: true } : undefined;
      },
    }) as Snapshot;
  }

  // ---------------- snapshot (perezoso y cacheado por versión) ----------------

  snapshot(): Snapshot {
    if (this.cacheSnapshot && this.cacheSnapshotVersion === this.version) return this.cacheSnapshot;
    const s: SnapshotSellado = {
      version: this.version,
      generadoEn: new Date().toISOString(),
      reloj: { ...this.reloj },
      ejecucion: structuredClone(this.ejecucion),
      incendios: this.sellar("incendios", [...this.incendios.values()]),
      clusters: this.sellar("clusters", [...this.clusters.values()]),
      unidades: this.sellar("unidades", [...this.unidades.values()]),
      poblaciones: this.sellar("poblaciones", [...this.poblaciones.values()]),
      hospitales: this.sellar("hospitales", [...this.hospitales.values()]),
      camaras: this.sellar("camaras", [...this.camaras.values()]),
      focosSatelite: this.sellar("focosSatelite", [...this.focosSatelite.values()]),
      observaciones: this.sellar("observaciones", [...this.observaciones.values()].slice(-300)),
      decisiones: this.sellar("decisiones", [...this.decisiones.values()]),
      comunicados: this.sellar("comunicados", [...this.comunicados.values()]),
      agentes: this.sellar("agentes", [...this.agentes.values()]),
      avisosMeteo: this.sellar("avisosMeteo", [...this.avisosMeteo]),
      zonasPeligro: this.sellar("zonasPeligro", [...this.zonasPeligro]),
      eventos: this.sellar("eventos", this.eventos.slice(-MAX_EVENTOS_SNAPSHOT)),
      politica: structuredClone(this.politica),
      lecciones: this.sellar("lecciones", [...this.lecciones.values()].sort((a, b) => b.peso - a.peso).slice(0, 50)),
      servicios: { ...this.servicios },
      // Las actas completas pesan decenas de miles de caracteres cada una y el
      // Snapshot entero viaja por SSE en cada cambio: aquí van solo la ficha y
      // un extracto. El Markdown completo se pide a /api/informes/[id] o a
      // /api/auditoria?decisionId=… (donde también se verifica la huella).
      informes: this.sellar("informes", [...this.informes.values()].slice(-100).map((i) => this.extracto(i))),
      tickets: this.sellar("tickets", [...this.tickets.values()]),
    };
    s.sellos = this.instantaneaDeSellos();
    this.forzados.clear();
    this.cacheSnapshot = s;
    this.cacheSnapshotVersion = this.version;
    return s;
  }

  /** El Snapshot ya serializado, UNA sola vez por versión (lo comparten SSE y GET /api/estado). */
  snapshotTexto(): string {
    if (this.cacheTexto !== undefined && this.cacheTextoVersion === this.version) return this.cacheTexto;
    const texto = JSON.stringify(this.snapshot());
    this.cacheTexto = texto;
    this.cacheTextoVersion = this.version;
    return texto;
  }

  /** Extracto de un acta, memorizado: así el objeto no cambia si el informe no cambia. */
  private extracto(i: Informe): Informe {
    const guardado = this.extractos.get(i);
    if (guardado) return guardado;
    const recortado: Informe = i.contenido.length > EXTRACTO_INFORME
      ? { ...i, contenido: `${i.contenido.slice(0, EXTRACTO_INFORME)}\n\n…(extracto: el acta completa está en /api/informes/${i.id})` }
      : i;
    this.extractos.set(i, recortado);
    return recortado;
  }

  /**
   * Compara el array recién construido con el que se sirvió la última vez.
   * Si nada cambió (mismos objetos en el mismo orden) devuelve el array ANTERIOR
   * —así conserva su identidad también en el servidor— y no toca los sellos.
   */
  private sellar<T extends { id?: string; nombre?: string }>(nombre: string, items: T[]): T[] {
    const previo = this.arraysPrevios.get(nombre) as T[] | undefined;
    const forzados = this.forzados.get(nombre);
    if (previo && !forzados?.size && previo.length === items.length) {
      let igual = true;
      for (let i = 0; i < items.length; i++) {
        if (previo[i] !== items[i]) {
          igual = false;
          break;
        }
      }
      if (igual) return previo;
    }

    let sellos = this.sellosItem.get(nombre);
    if (!sellos) {
      sellos = new Map();
      this.sellosItem.set(nombre, sellos);
    }
    const anteriores = new Map<string, T>();
    for (const p of previo ?? []) anteriores.set(claveDe(p), p);
    const vivos = new Set<string>();
    for (const item of items) {
      const clave = claveDe(item);
      vivos.add(clave);
      if (anteriores.get(clave) !== item || forzados?.has(clave) || !sellos.has(clave)) sellos.set(clave, this.version);
    }
    for (const clave of [...sellos.keys()]) if (!vivos.has(clave)) sellos.delete(clave);
    this.sellosColeccion.set(nombre, this.version);
    this.arraysPrevios.set(nombre, items);
    return items;
  }

  /** Sellos listos para viajar: por colección y, en paralelo al array, por item. */
  private instantaneaDeSellos(): SellosSnapshot {
    const coleccion: Record<string, number> = {};
    const item: Record<string, number[]> = {};
    for (const [nombre, sello] of this.sellosColeccion) {
      coleccion[nombre] = sello;
      const sellos = this.sellosItem.get(nombre);
      const array = this.arraysPrevios.get(nombre);
      if (!sellos || !array) continue;
      item[nombre] = array.map((i) => sellos.get(claveDe(i)) ?? sello);
    }
    return { coleccion, item };
  }

  // ---------------- registro de cambios (lo consume la persistencia) ----------------

  /**
   * AÑADIDO (constructor P, para el constructor D): apunta que un item de una
   * colección cambió. Lo llaman solos `guardar`/`actualizar`/`eliminar`,
   * `registrarEvento` y `marcarServicio`; quien mute una entidad EN SITIO (sin
   * pasar por esos métodos) debe llamarlo a mano para que la persistencia y los
   * sellos de identidad del cliente se enteren.
   * `coleccion` es el nombre de la propiedad de Estado ("unidades", "decisiones"…).
   */
  marcarCambio(coleccion: string, id: string): void {
    let ids = this.cambios.get(coleccion);
    if (!ids) {
      ids = new Set();
      this.cambios.set(coleccion, ids);
    }
    ids.add(id);
    let forzados = this.forzados.get(coleccion);
    if (!forzados) {
      forzados = new Set();
      this.forzados.set(coleccion, forzados);
    }
    forzados.add(id);
  }

  /** Colecciones/ids cambiados desde la última llamada; los vacía. */
  consumirCambios(): Map<string, Set<string>> {
    const previos = this.cambios;
    this.cambios = new Map();
    return previos;
  }

  /** Nombre de colección de un mapa de este Estado (para `guardar`/`actualizar`/`eliminar`). */
  private nombreDe(mapa: Map<string, unknown>): string | undefined {
    if (!this.nombresDeMapa) {
      this.nombresDeMapa = new Map();
      const propiedades = this as unknown as Record<string, unknown>;
      for (const nombre of COLECCIONES_MAPA) {
        const valor = propiedades[nombre];
        if (valor instanceof Map) this.nombresDeMapa.set(valor, nombre);
      }
    }
    return this.nombresDeMapa.get(mapa);
  }

  // ---------------- helpers genéricos ----------------

  /** Inserta o sustituye por id y toca. */
  guardar<T extends { id: string }>(mapa: Map<string, T>, item: T): T {
    mapa.set(item.id, item);
    const coleccion = this.nombreDe(mapa as Map<string, unknown>);
    if (coleccion) this.apuntarCambio(coleccion, item.id);
    this.tocar();
    return item;
  }

  /** Igual que `marcarCambio` pero sin forzar el re-sellado (el item ya es nuevo). */
  private apuntarCambio(coleccion: string, id: string): void {
    let ids = this.cambios.get(coleccion);
    if (!ids) {
      ids = new Set();
      this.cambios.set(coleccion, ids);
    }
    ids.add(id);
  }

  /** Modifica parcialmente por id (si existe) y toca. */
  actualizar<T extends { id: string }>(mapa: Map<string, T>, id: string, cambios: Partial<T>): T | undefined {
    const actual = mapa.get(id);
    if (!actual) return undefined;
    const nuevo = { ...actual, ...cambios };
    mapa.set(id, nuevo);
    const coleccion = this.nombreDe(mapa as Map<string, unknown>);
    if (coleccion) this.apuntarCambio(coleccion, id);
    this.tocar();
    return nuevo;
  }

  eliminar<T extends { id: string }>(mapa: Map<string, T>, id: string): boolean {
    const ok = mapa.delete(id);
    if (ok) {
      const coleccion = this.nombreDe(mapa as Map<string, unknown>);
      if (coleccion) this.apuntarCambio(coleccion, id);
      this.tocar();
    }
    return ok;
  }

  // ---------------- eventos ----------------

  registrarEvento(
    tipo: TipoEvento,
    mensaje: string,
    extra: Partial<Pick<Evento, "agenteId" | "incendioId" | "nivel" | "datos">> = {},
  ): Evento {
    const ev: Evento = {
      id: nuevoId("ev"),
      en: new Date().toISOString(),
      enMundo: this.reloj.ahoraMundo,
      tipo,
      mensaje,
      nivel: extra.nivel ?? "info",
      agenteId: extra.agenteId,
      incendioId: extra.incendioId,
      datos: extra.datos,
    };
    this.eventos.push(ev);
    if (this.eventos.length > 5000) {
      // Los eventos podados ya no existen en el estado: sus ids tampoco pueden
      // quedarse en el registro de cambios (sin Supabase nadie lo vacía y crecería sin tope).
      const podados = this.eventos.splice(0, this.eventos.length - 5000);
      const ids = this.cambios.get("eventos");
      if (ids) for (const p of podados) ids.delete(p.id);
    }
    this.apuntarCambio("eventos", ev.id);
    this.tocar();
    return ev;
  }

  // ---------------- servicios externos ----------------

  marcarServicio(nombre: string, ok: boolean, detalle?: string): void {
    this.servicios[nombre] = { ok, detalle, en: new Date().toISOString() };
    this.apuntarCambio("servicios", nombre);
    this.tocar();
  }

  // ---------------- consultas frecuentes ----------------

  incendiosActivos(): Incendio[] {
    return [...this.incendios.values()].filter((i) => !["extinguido", "descartado", "fusionado"].includes(i.estado));
  }

  /**
   * Focos en los que se planifica y se despliegan medios: confirmados (por un humano o por fuentes
   * independientes), activos o estabilizados. Los meramente "detectados" (p. ej. por una noticia)
   * solo se vigilan y verifican; así una avalancha de prensa no satura al coordinador.
   */
  incendiosOperativos(): Incendio[] {
    return this.incendiosActivos().filter((i) => ["confirmado", "activo", "estabilizado"].includes(i.estado));
  }

  unidadesDe(incendioId: string): Unidad[] {
    return [...this.unidades.values()].filter((u) => u.incendioId === incendioId);
  }

  poblacionesDe(incendioId: string): Poblacion[] {
    return [...this.poblaciones.values()].filter((p) => p.incendioId === incendioId);
  }

  decisionesDe(incendioId: string): Decision[] {
    return [...this.decisiones.values()].filter((d) => d.incendioId === incendioId).sort((a, b) => a.creadaEn.localeCompare(b.creadaEn));
  }

  decisionesPendientesHumano(): Decision[] {
    return [...this.decisiones.values()].filter((d) => d.estado === "pendiente_humano" || d.estado === "escalada");
  }
}

// ---------------- singleton de proceso ----------------

declare global {
  var __atalayaEstado: Estado | undefined;
}

/** Estado único del proceso (sobrevive a la recarga en caliente de Next en desarrollo). */
export function obtenerEstado(): Estado {
  const guardado = globalThis.__atalayaEstado;
  if (!guardado) {
    globalThis.__atalayaEstado = new Estado();
    return globalThis.__atalayaEstado;
  }
  // Recarga en caliente: el objeto vivo se quedó con el prototipo de la clase
  // ANTERIOR, así que le faltan los métodos añadidos en esta edición (y toda la
  // app revienta con "no es una función" hasta reiniciar). Se le vuelve a poner
  // el prototipo actual conservando su identidad: los suscriptores y los
  // cierres que ya apuntan a este objeto siguen valiendo.
  if (!(guardado instanceof Estado)) adoptar(guardado);
  return guardado;
}

/** Reengancha un Estado de una versión anterior del módulo a la clase actual. */
function adoptar(viejo: Estado): void {
  try {
    Object.setPrototypeOf(viejo, Estado.prototype);
    const campos = viejo as unknown as Record<string, unknown>;
    const plantilla = new Estado() as unknown as Record<string, unknown>;
    for (const clave of Object.keys(plantilla)) {
      if (!(clave in campos) || campos[clave] === undefined) campos[clave] = plantilla[clave];
    }
    // Las cachés vienen de la implementación anterior: se tiran.
    campos.cacheSnapshot = undefined;
    campos.cacheSnapshotVersion = -1;
    campos.cacheTexto = undefined;
    campos.cacheTextoVersion = -1;
    campos.nombresDeMapa = undefined;
  } catch (e) {
    console.error("[estado] no se pudo adoptar el estado tras la recarga en caliente", e);
  }
}

/** Sustituye el estado (al cargar una ejecución de la base de datos o al reiniciar). */
export function establecerEstado(nuevo: Estado): void {
  globalThis.__atalayaEstado = nuevo;
}
