// Tipos del panel Simulador (components/simulador). Forma TOLERANTE de los eventos
// del dataset: cubre el formato del reproductor (lib/server/simulacion.ts ·
// EventoDataset con observacion/ruido/bulo/duplicaDe/esperado) y el del generador
// (lib/dataset/tipos.ts · tipoEmergencia, canal, veracidad, lugar, imagen,
// decisionEsperada). No importa nada de servidor: el dataset evoluciona en
// paralelo y el panel no puede romperse por un campo nuevo o ausente.

import type { EstadoSistema } from "@/lib/tipos-sistema";

export type EstadoSim = NonNullable<EstadoSistema["simulacion"]>;
export type ResultadoSim = EstadoSim["ultimos"][number];

export interface ResumenEscenarioSim {
  id: string;
  nombre: string;
  tipo: string;
  descripcion?: string;
  duracionSeg?: number;
  eventos: number;
}

export type Veracidad = "real" | "duplicado" | "bulo" | "ruido";
export type TipoObservacionSim = "imagen" | "texto" | "voz" | "publicacion" | "sensor";
export type GravedadSim = "critica" | "alta" | "media" | "baja" | "nula";

export interface LugarSim {
  lat: number;
  lon: number;
  nombre?: string;
  /** Solo para mostrar (p. ej. el título del evento si el dataset no trae nombre); no se envía. */
  etiqueta?: string;
}

/** Evento tal y como llega de GET /api/simulacion/escenarios (sueltos). Todo opcional. */
export interface EventoCrudo {
  id?: string;
  offsetSeg?: number;
  titulo?: string;
  texto?: string;
  fuente?: string;
  canal?: string;
  tipo?: string;
  tipoObservacion?: string;
  tipoEmergencia?: string;
  /** Formato del generador: categoría que DEBERÍA detectar el pipeline. */
  categoria?: string;
  veracidad?: string;
  lugar?: { lat?: number; lon?: number; nombre?: string; precisionM?: number };
  imagen?: string | { archivo?: string; url?: string; src?: string; descripcion?: string };
  imagenUrl?: string;
  autor?: string;
  sensor?: { magnitud: string; valor: number; unidad: string };
  ruido?: boolean;
  duplicaDe?: string;
  bulo?: { motivo?: string } | boolean | string;
  motivoBulo?: string;
  gravedad?: string;
  gravedadEsperada?: string;
  esperado?: { categoria?: string; gravedad?: string; foco?: string; impacto?: string };
  decisionEsperada?: unknown;
  observacion?: Record<string, unknown> & {
    perifericoId?: string;
    tipo?: string;
    texto?: string;
    imagenUrl?: string;
    posicion?: { lat?: number; lon?: number; precisionM?: number };
    sensor?: { magnitud: string; valor: number; unidad: string };
    autor?: string;
    tipoEmergencia?: string;
    categoria?: string;
    categoriaForzada?: string;
    gravedadForzada?: string;
    ubicacion?: string;
  };
  [campo: string]: unknown;
}

/** Evento normalizado para pintar y filtrar. */
export interface EventoSim {
  clave: string;
  id?: string;
  titulo: string;
  texto?: string;
  tipoEmergencia: string;
  canal: string;
  tipoObservacion: TipoObservacionSim;
  veracidad: Veracidad;
  motivoVeracidad?: string;
  lugar?: LugarSim;
  imagen?: string;
  imagenDescripcion?: string;
  gravedad?: string;
  esperadoCategoria?: string;
  esperadoImpacto?: string;
  /** Qué debería proponer el sistema tras este evento (texto del dataset, para evaluar la IA). */
  decisionEsperada?: string;
  crudo: EventoCrudo;
}

/** Lo que el panel recuerda de cada evento que ha lanzado (para el "esperado" y el título). */
export interface MemoriaInyeccion {
  titulo: string;
  esperadoCategoria?: string;
  esperadoImpacto?: string;
  veracidad?: Veracidad;
  origen: "suelto" | "manual";
}

const TIPOS_OBS: TipoObservacionSim[] = ["imagen", "texto", "voz", "publicacion", "sensor"];

const texto = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const numero = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function lugarDe(ev: EventoCrudo): LugarSim | undefined {
  const l = ev.lugar;
  const lat = numero(l?.lat) ?? numero(ev.observacion?.posicion?.lat);
  const lon = numero(l?.lon) ?? numero(ev.observacion?.posicion?.lon);
  if (lat === undefined || lon === undefined) return undefined;
  return { lat, lon, nombre: texto(l?.nombre) ?? texto(ev.observacion?.ubicacion) };
}

function imagenDe(ev: EventoCrudo): string | undefined {
  if (typeof ev.imagen === "string") return texto(ev.imagen);
  if (ev.imagen && typeof ev.imagen === "object") return texto(ev.imagen.archivo) ?? texto(ev.imagen.url) ?? texto(ev.imagen.src);
  return texto(ev.imagenUrl) ?? texto(ev.observacion?.imagenUrl);
}

function veracidadDe(ev: EventoCrudo): { veracidad: Veracidad; motivo?: string } {
  const v = texto(ev.veracidad)?.toLowerCase();
  const motivoBulo =
    texto(ev.motivoBulo) ??
    (typeof ev.bulo === "string" ? ev.bulo : ev.bulo && typeof ev.bulo === "object" ? texto(ev.bulo.motivo) : undefined);
  if (v === "bulo" || ev.bulo) return { veracidad: "bulo", motivo: motivoBulo };
  if (v === "duplicado" || ev.duplicaDe) return { veracidad: "duplicado", motivo: ev.duplicaDe ? `Duplica ${ev.duplicaDe}` : undefined };
  if (v === "ruido" || ev.ruido) return { veracidad: "ruido" };
  return { veracidad: "real" };
}

function tipoObsDe(ev: EventoCrudo): TipoObservacionSim {
  const t = texto(ev.observacion?.tipo) ?? texto(ev.tipoObservacion) ?? texto(ev.tipo);
  if (t && (TIPOS_OBS as string[]).includes(t)) return t as TipoObservacionSim;
  if (t === "fotograma") return "imagen";
  if (ev.observacion?.sensor) return "sensor";
  if (imagenDe(ev)) return "imagen";
  const c = texto(ev.canal)?.toLowerCase() ?? "";
  if (/red|social|tuit|twitter|x\b|publicaci/.test(c)) return "publicacion";
  if (/112|llamada|voz|telef/.test(c)) return "voz";
  if (/sensor|iot|estaci/.test(c)) return "sensor";
  if (/camara|cámara|foto/.test(c)) return "imagen";
  return "texto";
}

function esperadoDe(ev: EventoCrudo): { categoria?: string; impacto?: string; gravedad?: string } {
  const d = ev.decisionEsperada;
  const deDecision =
    d && typeof d === "object"
      ? {
          categoria: texto((d as Record<string, unknown>).categoria),
          impacto: texto((d as Record<string, unknown>).impacto) ?? texto((d as Record<string, unknown>).accion),
        }
      : {};
  return {
    categoria: texto(ev.esperado?.categoria) ?? texto(ev.categoria) ?? deDecision.categoria,
    impacto: texto(ev.esperado?.impacto) ?? deDecision.impacto,
    gravedad: texto(ev.esperado?.gravedad) ?? texto(ev.gravedadEsperada),
  };
}

/** Resumen de escenario tolerante: el generador usa titulo/tipoEmergencia en vez de nombre/tipo. */
export function normalizarEscenario(e: Record<string, unknown>): ResumenEscenarioSim {
  const id = texto(e.id) ?? "sin-id";
  return {
    id,
    nombre: texto(e.nombre) ?? texto(e.titulo) ?? id,
    tipo: texto(e.tipo) ?? texto(e.tipoEmergencia) ?? "otro",
    descripcion: texto(e.descripcion) ?? texto(e.objetivoDemo),
    duracionSeg: numero(e.duracionSeg),
    eventos: numero(e.eventos) ?? (Array.isArray(e.eventos) ? e.eventos.length : 0),
  };
}

export function normalizarEvento(ev: EventoCrudo, i: number): EventoSim {
  const obsTexto = texto(ev.observacion?.texto) ?? texto(ev.texto);
  const { veracidad, motivo } = veracidadDe(ev);
  const esperado = esperadoDe(ev);
  const tipoObservacion = tipoObsDe(ev);
  return {
    clave: texto(ev.id) ?? `suelto-${i}`,
    id: texto(ev.id),
    titulo: texto(ev.titulo) ?? obsTexto?.slice(0, 90) ?? `Evento ${i + 1}`,
    texto: obsTexto,
    tipoEmergencia: texto(ev.tipoEmergencia) ?? texto(ev.observacion?.tipoEmergencia) ?? "otro",
    canal: texto(ev.canal) ?? tipoObservacion,
    tipoObservacion,
    veracidad,
    motivoVeracidad: motivo,
    lugar: lugarDe(ev),
    imagen: imagenDe(ev),
    imagenDescripcion: ev.imagen && typeof ev.imagen === "object" ? texto(ev.imagen.descripcion) : undefined,
    gravedad: texto(ev.gravedad) ?? texto(ev.observacion?.gravedadForzada) ?? esperado.gravedad,
    esperadoCategoria: esperado.categoria,
    esperadoImpacto: esperado.impacto,
    decisionEsperada: texto(ev.decisionEsperada) ?? texto(ev.esperado?.foco),
    crudo: ev,
  };
}

/**
 * Cuerpo para POST /api/simulacion/evento a partir de un evento del dataset.
 * Garantiza una `observacion` válida (perifericoId "simulador", simulacro: true)
 * aunque el evento venga en el formato del generador (lugar/imagen/texto arriba).
 * `idEnvio` permite relanzar el mismo evento (el motor rechaza ids repetidos).
 */
export function cuerpoInyeccion(ev: EventoSim, idEnvio?: string): { observacion: Record<string, unknown> } & Record<string, unknown> {
  const c = ev.crudo;
  const obs: Record<string, unknown> = { ...(c.observacion ?? {}) };
  obs.perifericoId = "simulador";
  obs.simulacro = true;
  obs.tipo = texto(obs.tipo as string) ?? ev.tipoObservacion;
  // Sin observación explícita se imita aObservacion() de lib/dataset: "título\ntexto".
  if (!obs.texto && ev.texto) obs.texto = !c.observacion && c.titulo && c.titulo !== ev.texto ? `${c.titulo}\n${ev.texto}` : ev.texto;
  if (!obs.canal && c.canal) obs.canal = c.canal;
  if (!obs.texto && !obs.imagenUrl && !obs.sensor && !c.sensor) obs.texto = ev.titulo;
  if (!obs.imagenUrl && ev.imagen) obs.imagenUrl = ev.imagen;
  if (!obs.autor && c.autor) obs.autor = c.autor;
  if (!obs.sensor && c.sensor) obs.sensor = c.sensor;
  if (!obs.posicion && ev.lugar) {
    const precisionM = numero(c.lugar?.precisionM);
    obs.posicion = { lat: ev.lugar.lat, lon: ev.lugar.lon, ...(precisionM !== undefined ? { precisionM } : {}) };
  }
  if (!obs.ubicacion && ev.lugar?.nombre) obs.ubicacion = ev.lugar.nombre;
  if (!obs.tipoEmergencia && ev.tipoEmergencia !== "otro") obs.tipoEmergencia = ev.tipoEmergencia;
  const cuerpo: { observacion: Record<string, unknown> } & Record<string, unknown> = { ...c, observacion: obs };
  // Formato del generador (veracidad/motivoBulo) → marcas que entiende el reproductor
  // (lib/server/simulacion.ts: bulo/ruido/duplicaDe), igual que en un escenario exportado.
  if (ev.veracidad === "bulo" && !c.bulo) cuerpo.bulo = { motivo: ev.motivoVeracidad ?? "Bulo según el dataset" };
  if (ev.veracidad === "ruido" && c.ruido === undefined) cuerpo.ruido = true;
  if (!cuerpo.esperado && (ev.esperadoCategoria || ev.gravedad)) {
    cuerpo.esperado = { ...(ev.esperadoCategoria ? { categoria: ev.esperadoCategoria } : {}), ...(ev.gravedad ? { gravedad: ev.gravedad } : {}) };
  }
  if (idEnvio) cuerpo.id = idEnvio;
  delete cuerpo.offsetSeg;
  return cuerpo;
}
