// Tipos del sistema completo (cola de decisiones, evidencia, doctrina, informes).
// Archivo separado de lib/types.ts para no tocar el contrato de la UI existente;
// TarjetaDecision, EventoIngesta, NodoGrafo y AristaGrafo se reutilizan tal cual.

import type { AristaGrafo, EventoIngesta, NodoGrafo, ProcesadoPor, TarjetaDecision } from "./types";
import type { RolId } from "./roles";
import type { CategoriaId, VeredictoCompetencia } from "./politica-autonomia";

export type FuenteDato =
  | "MadridTrafico"
  | "OpenMeteo"
  | "OpenMeteoAire"
  | "REE"
  | "IGN"
  | "AEMET"
  | "HappyRobot"
  | "Ciudadano"
  | "FalAI"
  | "Exa"
  | "Grafo"
  | "QuiverAI"
  | "Periferico" // sensores/dispositivos periféricos (poc-07)
  | "CamaraTrafico" // cámaras públicas de tráfico del Ayuntamiento
  | "OSM" // OpenStreetMap / Overpass / Nominatim (grafo real, POIs)
  | "Organismo" // avisos oficiales de organismos (Metro, Adif, Canal de Isabel II, distribuidoras, Emergencias Madrid)
  | "Prensa" // titulares reales por RSS de Google Noticias (sin clave, poc-c8)
  | "Normativa" // RAG local sobre BOE (poc-c8)
  | "Escenario"; // dato forzado por el guion de la demo (giro), marcado como tal

export interface Evidencia {
  id: string;
  fuente: FuenteDato;
  descripcion: string; // "Sensor 3862 M-30 sur: carga 82 %, nivel de servicio 2"
  valor: string | number;
  unidad?: string;
  timestamp: string;
  url?: string; // enlace al dato original
  confianza: number; // 0..1
  nodoId?: string; // vértice del grafo al que se refiere el dato (para marcarlo en GrafoCiudad)
  lat?: number; // posición del dato (sensor, llamada…) para el mapa
  lon?: number;
}

export type Urgencia = "critica" | "alta" | "media" | "baja";

export type EstadoDecision =
  | "pendiente"
  | "ejecutando"
  | "ejecutada"
  | "denegada"
  | "invalidada" // el escenario cambió y la propuesta ya no es válida
  | "auto"; // ejecutada automáticamente por estar bajo el umbral de autonomía

export type CanalAccion = "sms" | "voz" | "email" | "ticket" | "interno";

export interface ResultadoAccion {
  accionId: string;
  canal: CanalAccion;
  proveedor: "HappyRobot" | "Twilio" | "Cuaderno" | "Ninguno"; // Cuaderno = orden interna registrada; Ninguno = sin canal configurado
  ref: string; // SID / id de la llamada / id del ticket
  ok: boolean;
  detalle: string;
  timestamp: string;
}

export interface Decision {
  id: string;
  incidenteId: string;
  foco: string; // qué se decide: despliegue_inicial | corte_m30 | hospital | evacuacion | replanificacion_viento | comunicado
  creadaEn: string;
  plazo: string; // ISO: cuándo deja de tener sentido decidir
  urgencia: Urgencia;
  riesgo: number; // 0..100 — se compara con el umbral de autonomía
  costeDeNoActuar: string;
  tarjeta: TarjetaDecision; // contrato existente de la UI
  evidencia: Evidencia[];
  reglasAplicadas: string[]; // ids de ReglaDoctrina usadas al proponer
  estado: EstadoDecision;
  decididaPor?: { rol: Rol; timestamp: string; via: "panel" | "voz" };
  feedback?: string;
  resultadoEjecucion?: ResultadoAccion[];
  motivoInvalidacion?: string;
  escaladaA?: { rol: Rol; por: Rol; timestamp: string; via?: "panel" | "voz"; ref?: string }; // escalado a un rol con más autoridad
  alternativasDescartadas?: { opcion: string; motivo: string }[]; // opciones consideradas y por qué no se propusieron
  categorias?: CategoriaId[]; // tipos de actuación del catálogo etiquetados por el proponente (poc-c5)
  competencia?: VeredictoCompetencia; // política de autonomía (poc-c5): modo, categorías, riesgo efectivo, firma mínima
  rutas?: RutaDecision[]; // rutas reales (OSRM) de las acciones: desvío, evacuación, ambulancia, acceso
  procesadoPor?: ProcesadoPor[]; // enrutador: qué modelo generó el plan y cuánto tardó (tarea "plan")
  audiosAlerta?: AudioAlerta[]; // ElevenLabs → R2, uno por idioma
  informeId?: string; // acta de decisión generada al aprobar/denegar
}

/** Alerta multilingüe: ElevenLabs sintetiza, R2 aloja. */
export interface AudioAlerta {
  idioma: "es" | "en" | "de" | "fr" | string;
  texto: string;
  url: string; // .mp3 en R2
  destino: "radio_efectivos" | "megafonia" | "push";
  duracionSeg?: number;
}

/** Civilian tasking: tarea de bajo riesgo ofrecida a voluntarios, se cierra al cubrir el cupo. */
export interface TareaVoluntarios {
  id: string;
  incidenteId: string;
  titulo: string; // "Llevar mantas al Polideportivo Arganzuela"
  descripcion: string;
  lugar: string;
  cupo: number;
  aceptados: number;
  estado: "propuesta" | "abierta" | "cubierta" | "cancelada";
  creadaEn: string;
  riesgo: "bajo"; // solo se ofrecen tareas de bajo riesgo
}

export interface ReglaDoctrina {
  id: string;
  texto: string; // feedback original del cargo
  reglaNormalizada: string; // reescrita como restricción operativa
  ambito: "incidente" | "global"; // solo este incidente o todos los futuros
  origen: { decisionId: string; rol: Rol; timestamp: string };
  activa: boolean;
  vecesAplicada: number;
}

export interface Informe {
  id: string;
  tipo: "sitrep" | "acta_decision" | "post_mortem";
  incidenteId: string;
  decisionId?: string;
  generadoEn: string;
  titulo: string;
  markdown: string;
  pdfUrl?: string; // R2, post_mortem listo para firmar
}

/** Rol de usuario: catálogo de protección civil en lib/roles.ts (los valores antiguos se normalizan con normalizarRol). */
export type Rol = RolId;

export type TipoEmergencia =
  | "incendio_industrial"
  | "incendio_urbano"
  | "incendio_forestal"
  | "inundacion"
  | "accidente_trafico"
  | "accidente_ferroviario"
  | "fuga_gas"
  | "derrumbe"
  | "apagon"
  | "ola_calor"
  | "nevada"
  | "sismo"
  | "aglomeracion"
  | "vertido_quimico"
  | "persona_peligro"
  | "otro";

export interface Incidente {
  id: string;
  titulo: string;
  tipo: TipoEmergencia;
  descripcion?: string;
  nodoId?: string; // vértice del grafo desde el que corre el efecto dominó
  severidad?: "critica" | "alta" | "media" | "baja";
  ultimoEventoEn?: string;
  eventosIds?: string[];
  focosPropuestos?: string[]; // claves de foco ya propuestas (motor por eventos)
  simulacro?: boolean; // creado por el reproductor de escenarios
  ubicacion: { nombre: string; lat: number; lon: number };
  iniciadoEn: string;
  tick: number;
  fase: "deteccion" | "respuesta" | "escalada" | "estabilizacion" | "cierre";
  activo: boolean;
}

export interface CondicionesEntorno {
  viento: { velocidadKmh: number; direccionGrados: number; direccionTexto: string; fuente: FuenteDato; timestamp: string };
  aire?: { pm25: number; pm10: number; co: number; timestamp: string };
  trafico?: { sensoresCercanos: number; cargaMedia: number; sensorPeor: { id: string; descripcion: string; carga: number } | null; timestamp: string };
  demandaElectricaMW?: { valor: number; timestamp: string };
  penacho?: { rumboGrados: number; longitudM: number; semianguloGrados: number; afectados: string[] }; // cono de humo en metros (misma fórmula para mapa, grafo y decisiones)
}

export interface EntradaTimeline {
  id: string;
  timestamp: string;
  tick: number;
  tipo: "evento" | "propuesta" | "aprobada" | "denegada" | "ejecutada" | "invalidada" | "auto" | "regla" | "informe" | "sistema";
  texto: string;
  ref?: string; // id de decisión / evento / informe
}

/** Organismo cliente (tenant) que opera el centro de mando. Configurable por env ORGANISMO_*. */
export interface Organismo {
  nombre: string; // "Ayuntamiento de Madrid"
  servicio: string; // "Emergencias Madrid · SAMUR-PC"
  municipio: string; // "Madrid"
}

/** Ruta real sobre calles (OSRM) asociada a una acción del plan. */
export interface RutaDecision {
  id: string;
  nombre: string;
  tipo: "desvio" | "evacuacion" | "ambulancia" | "acceso";
  coords: [number, number][]; // [lat, lon]
  distanciaM: number;
  duracionS: number;
  fuente: "OSRM";
}

/** Capa de mapa real (OpenStreetMap) que acompaña al grafo. */
export interface MapaEstado {
  centro: { lat: number; lon: number };
  sensores: { id: string; descripcion: string; lat: number; lon: number; carga: number; nivelServicio: number; intensidad?: number; timestamp: string }[];
  pois: { id: string; tipo: string; nombre: string; lat: number; lon: number; url: string; fuente: "Overpass" | "OSM"; distanciaM?: number }[];
  actualizadoEn: string;
}

/** Reproductor de escenarios (simulación en servidor). */
export interface EstadoSimulacion {
  activa: boolean;
  escenarioId?: string;
  nombre?: string;
  velocidad: number;
  indice: number; // eventos ya inyectados
  total: number;
  offsetSeg?: number; // segundo del guion del último evento inyectado
  siguienteEnSeg?: number;
  procesando?: { eventoId: string; desdeHaceSeg: number }; // evento en curso (el pipeline puede tardar con LLM local)
  iniciadaEn?: string;
  ultimos: { datasetId: string; eventoId: string; impacto: string; decisionId?: string; categoria?: string; timestamp: string; error?: string }[];
}

export interface EstadoSistema {
  organismo: Organismo;
  incidente: Incidente; // incidente activo / más grave (compatibilidad)
  incidentes?: Incidente[]; // todos los incidentes (motor por eventos); decorar() lo rellena siempre
  entorno: CondicionesEntorno;
  eventos: EventoIngesta[];
  nodos: NodoGrafo[];
  aristas: AristaGrafo[];
  decisiones: Decision[];
  doctrina: ReglaDoctrina[];
  informes: Informe[];
  timeline: EntradaTimeline[];
  umbralAutonomia: number; // 0..100: riesgo máximo que la IA ejecuta sin firma humana
  autoAvance: boolean; // el escenario avanza solo cada intervaloSeg
  intervaloSeg: number;
  proveedorEjecucion: "HappyRobot" | "Twilio" | "Cuaderno" | "Ninguno";
  iaDisponible: boolean; // hay ANTHROPIC_API_KEY
  origenGrafo?: "ArangoDB" | "memoria"; // de dónde salió el último efecto dominó
  conectores?: { exa: boolean; fal: boolean; quiver: boolean; elevenlabs: boolean; happyrobot: boolean; ollama?: boolean; vision?: boolean; busqueda?: boolean; rag?: boolean; tts?: boolean; arango?: boolean }; // servicios configurados (externos o locales, poc-c8)
  rolActivo: Rol;
  modoDatos: "real" | "mixto" | "sin_datos"; // sin_datos = ninguna fuente abierta respondió
  actualizadoEn: string;
  serverTime: string; // reloj del servidor para countdowns en la UI
  conectoresDetalle?: Record<string, string>; // texto por servicio: qué proveedor real responde (poc-c8)
  mapa?: MapaEstado;
  simulacion?: EstadoSimulacion;
  version?: number; // versión monótona del estado (sube en cada cambio; la usa el stream SSE)
  tareasVoluntarios?: TareaVoluntarios[];
}
