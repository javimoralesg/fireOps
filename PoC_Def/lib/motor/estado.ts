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
  private cacheSnapshot?: Snapshot;

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

  suscribir(fn: Suscriptor): () => void {
    this.suscriptores.add(fn);
    return () => this.suscriptores.delete(fn);
  }

  /** Sube la versión, invalida la caché y avisa. Llamar tras cualquier mutación. */
  tocar(): void {
    this.version += 1;
    this.cacheSnapshot = undefined;
    const s = this.snapshot();
    for (const fn of this.suscriptores) {
      try {
        fn(s);
      } catch (e) {
        console.error("[estado] suscriptor falló", e);
      }
    }
  }

  snapshot(): Snapshot {
    if (this.cacheSnapshot) return this.cacheSnapshot;
    const s: Snapshot = {
      version: this.version,
      generadoEn: new Date().toISOString(),
      reloj: { ...this.reloj },
      ejecucion: structuredClone(this.ejecucion),
      incendios: [...this.incendios.values()],
      clusters: [...this.clusters.values()],
      unidades: [...this.unidades.values()],
      poblaciones: [...this.poblaciones.values()],
      hospitales: [...this.hospitales.values()],
      camaras: [...this.camaras.values()],
      focosSatelite: [...this.focosSatelite.values()],
      observaciones: [...this.observaciones.values()].slice(-300),
      decisiones: [...this.decisiones.values()],
      comunicados: [...this.comunicados.values()],
      agentes: [...this.agentes.values()],
      avisosMeteo: [...this.avisosMeteo],
      zonasPeligro: [...this.zonasPeligro],
      eventos: this.eventos.slice(-MAX_EVENTOS_SNAPSHOT),
      politica: structuredClone(this.politica),
      lecciones: [...this.lecciones.values()].sort((a, b) => b.peso - a.peso).slice(0, 50),
      servicios: { ...this.servicios },
      // Las actas completas pesan decenas de miles de caracteres cada una y el
      // Snapshot entero viaja por SSE en cada cambio: aquí van solo la ficha y
      // un extracto. El Markdown completo se pide a /api/informes/[id] o a
      // /api/auditoria?decisionId=… (donde también se verifica la huella).
      informes: [...this.informes.values()].slice(-100).map((i) => ({
        ...i,
        contenido: i.contenido.length > EXTRACTO_INFORME
          ? `${i.contenido.slice(0, EXTRACTO_INFORME)}\n\n…(extracto: el acta completa está en /api/informes/${i.id})`
          : i.contenido,
      })),
      tickets: [...this.tickets.values()],
    };
    this.cacheSnapshot = s;
    return s;
  }

  // ---------------- helpers genéricos ----------------

  /** Inserta o sustituye por id y toca. */
  guardar<T extends { id: string }>(mapa: Map<string, T>, item: T): T {
    mapa.set(item.id, item);
    this.tocar();
    return item;
  }

  /** Modifica parcialmente por id (si existe) y toca. */
  actualizar<T extends { id: string }>(mapa: Map<string, T>, id: string, cambios: Partial<T>): T | undefined {
    const actual = mapa.get(id);
    if (!actual) return undefined;
    const nuevo = { ...actual, ...cambios };
    mapa.set(id, nuevo);
    this.tocar();
    return nuevo;
  }

  eliminar<T extends { id: string }>(mapa: Map<string, T>, id: string): boolean {
    const ok = mapa.delete(id);
    if (ok) this.tocar();
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
    if (this.eventos.length > 5000) this.eventos.splice(0, this.eventos.length - 5000);
    this.tocar();
    return ev;
  }

  // ---------------- servicios externos ----------------

  marcarServicio(nombre: string, ok: boolean, detalle?: string): void {
    this.servicios[nombre] = { ok, detalle, en: new Date().toISOString() };
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
  // eslint-disable-next-line no-var
  var __atalayaEstado: Estado | undefined;
}

/** Estado único del proceso (sobrevive a la recarga en caliente de Next en desarrollo). */
export function obtenerEstado(): Estado {
  if (!globalThis.__atalayaEstado) globalThis.__atalayaEstado = new Estado();
  return globalThis.__atalayaEstado;
}

/** Sustituye el estado (al cargar una ejecución de la base de datos o al reiniciar). */
export function establecerEstado(nuevo: Estado): void {
  globalThis.__atalayaEstado = nuevo;
}
