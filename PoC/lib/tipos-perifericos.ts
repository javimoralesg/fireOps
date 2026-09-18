// Tipos de la capa de periféricos e inputs reales (sesión poc-07).
// Un "periférico" es cualquier dispositivo o canal que alimenta el sistema con
// observaciones del mundo real: el móvil de un ciudadano o del jurado, una cámara
// fija (móvil en trípode), el móvil de un efectivo, las cámaras públicas de
// tráfico, un sensor por webhook. Los tipos base (EventoIngesta, NodoGrafo…)
// están en lib/types.ts; los del sistema en lib/tipos-sistema.ts.

import type { AristaGrafo, EventoIngesta, NodoGrafo } from "./types";

export type TipoPeriferico =
  | "movil_ciudadano" // ciudadano / jurado con su móvil
  | "camara_fija" // móvil en trípode apuntando a una escena (modo vigilancia)
  | "efectivo" // móvil de un bombero / policía: su posición mueve el nodo Efectivos/…
  | "pma" // puesto de mando avanzado
  | "camara_trafico" // cámara pública del Ayuntamiento (no se empareja: se descubre)
  | "sensor" // hardware (ESP32, Raspberry) que hace POST a la API
  | "webhook"; // sistema externo (HappyRobot, Twilio, otro)

export interface PosicionGeo {
  lat: number;
  lon: number;
  precisionM?: number;
  rumboGrados?: number; // hacia dónde apunta la cámara (brújula)
  timestamp: string;
}

export type Capacidad = "camara" | "gps" | "microfono" | "brujula" | "acelerometro" | "publicar";

export interface Periferico {
  id: string; // "per-…"
  nombre: string; // "Móvil de Javi", "Cámara fija · escenario"
  tipo: TipoPeriferico;
  registradoEn: string;
  ultimoLatido: string;
  enLinea: boolean; // latido hace menos de 30 s (se calcula al servir)
  posicion?: PosicionGeo;
  capacidades: Capacidad[];
  modo: "manual" | "vigilancia"; // vigilancia: envía un fotograma cada intervaloVigilanciaSeg
  intervaloVigilanciaSeg: number;
  observaciones: number; // contador
  ultimaObservacion?: { id: string; timestamp: string; resumen: string; categoria?: CategoriaObservacion; eventoId?: string };
  confianza: number; // reputación 0..1: baja cuando sus observaciones se marcan como falsas/duplicadas
  nodoId?: string; // efectivo/PMA: vértice Efectivos/… que mueve en el grafo
  userAgent?: string;
}

export type TipoObservacion =
  | "imagen" // foto tomada a mano
  | "fotograma" // captura automática en modo vigilancia
  | "texto" // aviso escrito
  | "voz" // transcripción (Web Speech API en el móvil o HappyRobot)
  | "publicacion" // "tuit" en la red social simulada
  | "posicion" // solo movimiento (efectivos)
  | "sensor"; // magnitud física (aceleración, gas, temperatura…)

export type CategoriaObservacion =
  | "incendio"
  | "humo"
  | "inundacion"
  | "accidente"
  | "derrumbe"
  | "aglomeracion"
  | "persona_en_peligro"
  | "vertido"
  | "corte_electrico"
  | "explosion"
  | "fuga_gas"
  | "terremoto"
  | "ola_calor"
  | "nevada"
  | "accidente_ferroviario"
  | "amenaza" // aviso de bomba, agresión…
  | "sin_novedad"
  | "otro";

/** Lo que envía un periférico (JSON). La imagen va en base64 sin prefijo data:. */
export interface ObservacionEntrante {
  perifericoId: string;
  tipo: TipoObservacion;
  timestamp?: string;
  posicion?: Omit<PosicionGeo, "timestamp"> & { timestamp?: string };
  texto?: string; // comentario del ciudadano, transcripción o texto de la publicación
  imagenBase64?: string;
  imagenMime?: string; // image/jpeg por defecto
  imagenUrl?: string; // alternativa a base64: URL pública https (el servidor la descarga, máx. 4 MB)
  autor?: string; // alias visible en publicaciones
  sensor?: { magnitud: string; valor: number; unidad: string };
  /** Simulador de dataset (poc-26): perifericoId "simulador" (tipo webhook, se crea solo). El evento lleva
   *  la etiqueta "simulacro" y no altera la reputación. Permite fijar la categoría sin pasar por visión. */
  simulacro?: boolean;
  categoriaForzada?: CategoriaObservacion;
  gravedadForzada?: AnalisisVision["gravedad"];
  tipoEmergencia?: string; // texto libre del dataset si no encaja en CategoriaObservacion
}

export interface AnalisisVision {
  motor: "FalAI" | "Claude" | "Ollama" | "palabras-clave" | "dataset" | "ninguno"; // ninguno = sin análisis (no se disfraza)
  modelo: string; // "fal-ai/moondream2", "claude-haiku-4-5", "gemma3:4b"…
  latenciaMs: number;
  descripcion: string; // caption en español
  categoria: CategoriaObservacion;
  confianza: number; // 0..1
  etiquetas: string[]; // ["fire", "dense_smoke", "road"]
  gravedad: "critica" | "alta" | "media" | "baja" | "nula";
  personasVisibles?: number;
}

export type AccionImpacto =
  | "ruido" // no aporta nada (sin novedad, muy baja confianza)
  | "registrado" // evento guardado, sin decisión
  | "confirma" // confirma un foco existente
  | "nuevo_foco" // incidencia nueva en el grafo → decisión
  | "agrava" // el foco existente empeora → decisión / invalidación
  | "mitiga" // mejora (controlado, sin humo) → registrado, informa al SITREP
  | "desmentido_sugerido"; // publicaciones sospechosas → decisión para el Gabinete

export interface Impacto {
  accion: AccionImpacto;
  motivo: string; // explicación legible que se enseña al mando
  decisionPedida: boolean;
  foco?: string; // clave de la decisión pedida
  decisionId?: string;
  nodoNuevo?: NodoGrafo;
  aristasNuevas?: AristaGrafo[];
  distanciaIncidenteM?: number;
  infraestructurasCercanas?: { id: string; nombre: string; tipo: string; distanciaM: number }[];
}

export interface ResultadoIngesta {
  evento: EventoIngesta;
  analisis?: AnalisisVision;
  impacto: Impacto;
  imagenUrl?: string;
}

/** Publicación de la red social simulada (entrada del jurado) o real (Exa). */
export interface Publicacion {
  id: string;
  autor: string;
  texto: string;
  imagenUrl?: string;
  timestamp: string;
  perifericoId?: string;
  origen: "periferico" | "exa" | "gabinete"; // gabinete = comunicado oficial publicado por la app
  posicion?: PosicionGeo;
  verificacion: EventoIngesta["verificacion"];
  eventoId?: string;
  menciones: number; // publicaciones similares agrupadas
}

export interface CamaraTrafico {
  id: string; // "02308"
  nombre: string;
  lat: number;
  lon: number;
  imagenUrl: string; // https://informo.madrid.es/cameras/Camara02308.jpg
  distanciaM: number; // al incidente
  ultimoAnalisis?: AnalisisVision & { timestamp: string; eventoId?: string };
}

export interface EstadoPerifericos {
  perifericos: Periferico[];
  urlUnion: string; // URL pública de /periferico para el QR
  urlSegura?: boolean; // https: el móvil podrá usar cámara, GPS y micrófono
  origenUrl?: "tunel" | "env" | "lan"; // de dónde salió la URL (ver registro.urlPublica)
  actualizadoEn: string;
}
