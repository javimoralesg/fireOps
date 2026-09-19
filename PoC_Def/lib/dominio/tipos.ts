// =====================================================================
// ATALAYA INCENDIOS · Tipos de dominio compartidos (CONTRATO)
// ---------------------------------------------------------------------
// Este archivo es la fuente de verdad del modelo. Lo escribe la sesión
// orquestadora; los agentes constructores SOLO pueden añadir campos
// opcionales (nunca renombrar ni borrar) y deben anotarlo en
// docs/REPARTO.md. Todo en español, sin abreviaturas crípticas.
// =====================================================================

/** Coordenada WGS84. */
export interface Punto {
  lat: number;
  lon: number;
}

/** Polilínea/polígono en orden [lat, lon] (el que espera Leaflet). */
export type Trazado = [number, number][];

// ----------------------------------------------------------------------
// Tiempo de la ejecución
// ----------------------------------------------------------------------

/**
 * El mundo avanza con aceleración temporal: `factor` minutos de mundo por
 * cada minuto real (12 → 5 s reales = 1 min de mundo). La meteorología
 * horaria real de Open-Meteo se indexa con la hora de mundo, así el viento
 * gira de verdad según la previsión, en minutos de demo.
 */
export interface Reloj {
  /** ISO real del arranque de la ejecución. */
  inicioReal: string;
  /** ISO de mundo correspondiente al arranque (normalmente = inicioReal). */
  inicioMundo: string;
  /** Minutos de mundo por minuto real. */
  factor: number;
  /** ISO de mundo actual (se recalcula en cada tick). */
  ahoraMundo: string;
  /** true si el orquestador está en pausa (no avanza el mundo). */
  pausado: boolean;
  /** Número de tick (monótono). */
  tick: number;
}

// ----------------------------------------------------------------------
// Meteorología y peligro
// ----------------------------------------------------------------------

export interface Meteo {
  temperaturaC: number;
  humedadPct: number;
  vientoKmh: number;
  /** Dirección DESDE la que sopla, en grados (meteorológica). */
  direccionGrados: number;
  direccionTexto: string; // "NO", "SSE"…
  rachasKmh: number;
  precipitacionMm: number;
  /** Déficit de presión de vapor si está disponible (kPa). */
  vpd?: number;
  /** Hora de mundo a la que corresponde. */
  horaMundo: string;
  fuente: string; // "Open-Meteo"
  url: string;
}

export type NivelPeligro = "bajo" | "moderado" | "alto" | "muy_alto" | "extremo";

export interface IndicePeligro {
  /** 0..100, índice propio tipo FWI simplificado. */
  valor: number;
  nivel: NivelPeligro;
  /** Explicación en una frase para el usuario. */
  motivo: string;
  calculadoEn: string;
}

/**
 * AÑADIDO (constructor B, 2026-09-19): peligro meteorológico de una zona
 * representativa de España (capitales de provincia con vocación forestal).
 * Lo calcula el agente meteorólogo cada 15 min con una sola llamada múltiple
 * a Open-Meteo; lo pinta la sala de mando como mapa de calor.
 */
export interface ZonaPeligro {
  nombre: string;
  punto: Punto;
  peligro: IndicePeligro;
  meteo: Meteo;
}

export interface AvisoMeteo {
  id: string;
  fuente: "AEMET" | "Meteoalarm";
  fenomeno: string; // "Temperaturas máximas", "Viento"…
  nivel: "amarillo" | "naranja" | "rojo";
  zona: string;
  desde: string;
  hasta: string;
  url?: string;
}

// ----------------------------------------------------------------------
// Incendios (focos)
// ----------------------------------------------------------------------

export type OrigenDeteccion =
  | "manual"
  | "satelite"
  | "camara"
  | "llamada"
  | "sms"
  | "email"
  | "web"
  | "telegram"
  | "prensa"
  | "rrss"
  | "sensor";

export type EstadoIncendio =
  | "detectado" // señal sin confirmar
  | "confirmado" // verificado por ≥2 fuentes o humano
  | "activo" // con medios asignados
  | "estabilizado"
  | "controlado"
  | "extinguido"
  | "descartado"
  | "fusionado"; // absorbido por otro foco al juntarse (ver Incendio.fusionadoEn)

/** Nivel de gravedad potencial (0-3) según los planes INFO autonómicos. */
export type NivelGravedad = 0 | 1 | 2 | 3;

export interface Combustible {
  /** Fracción 0..1 de cada tipo alrededor del foco (OSM landuse/natural). */
  bosque: number;
  matorral: number;
  pasto: number;
  agricola: number;
  urbano: number;
  /** Etiqueta dominante para el usuario. */
  dominante: "bosque" | "matorral" | "pasto" | "agricola" | "urbano";
}

export interface Frente {
  /** Rumbo HACIA el que avanza (grados). */
  rumboGrados: number;
  rumboTexto: string;
  /** Velocidad de avance en metros por minuto de mundo. */
  velocidadMmin: number;
  /** ISO de mundo del cálculo. */
  calculadoEn: string;
}

export interface PrediccionPropagacion {
  /** Perímetros previstos a +1 h, +3 h y +6 h de mundo. */
  en1h: Trazado;
  en3h: Trazado;
  en6h: Trazado;
  /** Poblaciones alcanzadas, ordenadas por tiempo estimado. */
  poblacionesEnPeligro: { poblacionId: string; nombre: string; etaMin: number }[];
  /** Texto corto explicando la predicción (viento, pendiente, combustible). */
  explicacion: string;
  calculadoEn: string;
}

export interface Incendio {
  id: string;
  nombre: string; // "Incendio de Navalacruz"
  centro: Punto;
  municipio: string;
  provincia: string;
  comunidad: string;
  estado: EstadoIncendio;
  nivelGravedad: NivelGravedad;
  origen: OrigenDeteccion;
  /** 0..1, sube al cruzar fuentes. */
  confianza: number;
  detectadoEn: string; // ISO mundo
  actualizadoEn: string;
  /** Perímetro actual (polígono cerrado). */
  perimetro: Trazado;
  areaHa: number;
  frente?: Frente;
  prediccion?: PrediccionPropagacion;
  meteo?: Meteo;
  peligro?: IndicePeligro;
  combustible?: Combustible;
  pendientePct?: number;
  elevacionM?: number;
  /** IDs de observaciones que lo sustentan. */
  observaciones: string[];
  /** ID de clúster si forma parte de un patrón multi-foco. */
  clusterId?: string;
  /** Radio operativo en km para buscar medios/pueblos (por defecto 30). */
  radioOperativoKm: number;
  /** Notas del mando humano. */
  notas?: string;
  /** Resumen de la fuente que lo detectó (prensa, llamada…), distinto de las notas del mando. */
  resumenFuente?: string;
  /** Nombre de la fuente ("20minutos", "Llamada 112", "Cámara A-5 PK 258"). */
  fuenteDeteccion?: string;
  /** URL de la fuente que lo detectó (noticia, publicación, imagen de cámara), para abrirla desde la ficha. */
  fuenteUrl?: string;
  /** Medios que ya actúan según fuentes externas (no gestionados por Atalaya). */
  mediosExternos?: string;
  /** Si este foco fue absorbido por otro al juntarse: id del foco superviviente. */
  fusionadoEn?: string;
  /** Focos que este incendio ha absorbido (ids), para el hilo y la auditoría. */
  focosAbsorbidos?: string[];
  /**
   * Contención (extinción realista): línea de control construida por las unidades en intervención
   * y efecto de los medios aéreos. La propagación efectiva baja con la fracción controlada.
   */
  contencion?: {
    perimetroTotalM: number;
    perimetroControladoM: number;
    /** 0..1 */
    fraccion: number;
    /** Metros de línea por minuto de mundo que suman las unidades trabajando. */
    ritmoMmin: number;
    unidadesTrabajando: number;
    mediosAereos: boolean;
    /** Minutos de mundo estimados hasta el control total con el ritmo actual (undefined si no converge). */
    estimadoControlMin?: number;
    /** ISO de mundo en que se alcanzó cada hito. */
    estabilizadoEn?: string;
    controladoEn?: string;
    extinguidoEn?: string;
    calculadoEn: string;
    /** AÑADIDO (constructor K): viento efectivo (km/h) en el momento de estabilizar; referencia para detectar rebrotes. */
    vientoEstabilizadoKmh?: number;
    /** AÑADIDO (constructor K): número de rebrotes registrados en este foco. */
    rebrotes?: number;
    /** AÑADIDO (constructor K): lluvia acumulada 24 h (mm) usada en el cálculo (Open-Meteo). */
    lluvia24Mm?: number;
    /** AÑADIDO (constructor K): frase para la sala ("2 unidades a 24 m/min: 62 % de 1.480 m controlados"). */
    explicacion?: string;
  };
  /** Sector asignado por el coordinador (A, B, C…) para varios frentes. */
  sectores?: { nombre: string; rumboGrados: number; unidades: string[] }[];
  /**
   * Escenario del mando: viento fijado a mano para el ejercicio. Se aplica SOBRE la meteo real
   * (temperatura y humedad siguen siendo de Open-Meteo) y queda marcado como forzado en `meteo.fuente`
   * y en el registro; nunca se confunde con un dato real.
   */
  meteoForzada?: { direccionGrados: number; vientoKmh: number; rachasKmh?: number; fijadoPor: string; en: string };
}

export type TipoCluster = "mismo_incendio" | "serie_sospechosa" | "convergencia" | "independientes";

export interface Cluster {
  id: string;
  incendios: string[];
  tipo: TipoCluster;
  analisis: string;
  /** Recomendación operativa conjunta. */
  recomendacion: string;
  detectadoEn: string;
  actualizadoEn: string;
}

// ----------------------------------------------------------------------
// Poblaciones (pueblos a avisar)
// ----------------------------------------------------------------------

export type RiesgoPoblacion = "bajo" | "medio" | "alto" | "inminente";
export type EstadoAviso = "sin_avisar" | "avisando" | "avisado" | "confinado" | "evacuando" | "evacuado" | "sin_respuesta";

export interface Poblacion {
  id: string; // "osm:node/123"
  nombre: string;
  centro: Punto;
  tipo: "ciudad" | "pueblo" | "aldea" | "urbanizacion";
  habitantes?: number;
  municipio?: string;
  /** Incendio de referencia para distancia/riesgo. */
  incendioId: string;
  distanciaKm: number;
  /** Rumbo desde el incendio hacia el pueblo (grados). */
  rumboDesdeFuegoGrados: number;
  riesgo: RiesgoPoblacion;
  /** Minutos de mundo estimados hasta que el frente llegue (undefined = fuera de trayectoria). */
  etaFrenteMin?: number;
  /**
   * Por qué tiene ese riesgo, en una frase para la pantalla (sesión riesgo-fundado,
   * 2026-09-19): el analista de propagación la reescribe en cada ciclo con el
   * frente, el cono y la meteo; hasta entonces dice que es provisional por
   * distancia. OPCIONAL: las filas antiguas no lo traen.
   */
  motivoRiesgo?: string;
  estadoAviso: EstadoAviso;
  /** Teléfono de contacto (ayuntamiento) si se conoce; en demo puede ser DESTINO_DEMO. */
  telefono?: string;
  /** AÑADIDO (constructor A): true si el teléfono no viene de OSM sino de DESTINO_DEMO. */
  telefonoEsDemo?: boolean;
  email?: string;
  ultimoContacto?: { en: string; canal: CanalComunicacion; resultado: string };
  /** Vulnerables cercanos (residencias, colegios, campings) sacados de OSM. */
  vulnerables?: { tipo: string; nombre: string; punto: Punto }[];
}

// ----------------------------------------------------------------------
// Unidades (medios)
// ----------------------------------------------------------------------

export type TipoUnidad =
  | "bomberos"
  | "brif" // brigadas de refuerzo contra incendios forestales
  | "agentes_forestales"
  | "medios_aereos"
  | "guardia_civil"
  | "policia"
  | "ambulancia"
  | "proteccion_civil"
  | "maquinaria";

export type EstadoUnidad =
  | "disponible"
  | "asignada" // orden recibida, aún en base
  | "en_ruta"
  | "en_intervencion"
  | "regreso"
  | "fuera_servicio";

export interface RutaUnidad {
  coords: Trazado;
  distanciaM: number;
  duracionS: number;
  /** 0..1 progreso sobre la polilínea. */
  progreso: number;
  /** ISO mundo de salida. */
  salida: string;
  /** ISO mundo prevista de llegada. */
  llegadaPrevista: string;
  destino: Punto;
  fuente: "OSRM";
}

export interface Unidad {
  id: string;
  nombre: string; // "Parque de Bomberos de Ávila · BUL-2"
  tipo: TipoUnidad;
  base: { nombre: string; punto: Punto; osmId?: string };
  posicion: Punto;
  estado: EstadoUnidad;
  incendioId?: string;
  sector?: string;
  ruta?: RutaUnidad;
  velocidadKmh: number;
  /** Personas y vehículos. */
  dotacion: { personas: number; vehiculos: number; descripcion?: string };
  telefono?: string;
  /** Última orden recibida (texto) y cuándo. */
  ultimaOrden?: { en: string; texto: string; decisionId: string };
  ultimoContacto?: { en: string; canal: CanalComunicacion; resultado: string };
  /** Fuente del dato (OSM u otra). */
  fuente: string;
}

export interface Hospital {
  id: string;
  nombre: string;
  punto: Punto;
  tipo: "hospital" | "centro_salud";
  camasEstimadas?: number;
  telefono?: string;
  distanciaKm?: number;
  incendioId?: string;
}

// ----------------------------------------------------------------------
// Cámaras
// ----------------------------------------------------------------------

export interface AnalisisCamara {
  en: string; // ISO real
  humo: boolean;
  fuego: boolean;
  /** 0..1 */
  confianza: number;
  descripcion: string;
  modelo: string;
  /** URL de la imagen analizada (proxy interno). */
  imagenUrl: string;
  latenciaMs: number;
}

export interface Camara {
  id: string;
  nombre: string;
  punto: Punto;
  /** "Movil" = teléfono de un ciudadano/agente que comparte ubicación y fotogramas desde /movil. */
  fuente: "DGT" | "Madrid" | "Movil" | "Windy" | "Otra";
  /** URL de la imagen JPEG (se sirve por /api/camaras/[id]/imagen para evitar CORS). */
  urlImagen: string;
  carretera?: string;
  /** Segundos entre análisis cuando está en vigilancia. */
  intervaloSeg: number;
  /** true si el Vigía la está analizando ahora. */
  vigilada: boolean;
  incendioId?: string;
  ultimoAnalisis?: AnalisisCamara;
  /** Historial corto (últimos N). */
  historial: AnalisisCamara[];
}

export interface FocoSatelite {
  id: string;
  punto: Punto;
  fuente: "VIIRS_SNPP" | "VIIRS_NOAA20" | "VIIRS_NOAA21" | "MODIS";
  frp: number; // potencia radiativa MW
  confianza: "baja" | "nominal" | "alta";
  fechaHora: string; // ISO UTC
  diaNoche: "D" | "N";
  incendioId?: string;
}

// ----------------------------------------------------------------------
// Observaciones (todo lo que entra)
// ----------------------------------------------------------------------

export type CanalComunicacion = "llamada" | "sms" | "email" | "whatsapp" | "telegram" | "web" | "ticket" | "interno";

export type CanalObservacion = "llamada" | "sms" | "email" | "telegram" | "web" | "rrss" | "prensa" | "satelite" | "camara" | "sensor" | "manual";

/**
 * Fuentes automáticas de detección que el mando puede apagar en una ejecución
 * (escenario). La declaración a mano y las cámaras de móvil no se apagan nunca:
 * son el suelo del "simulacro". Catálogo y reglas en `lib/dominio/fuentes-deteccion.ts`.
 * CAMPO NUEVO Y ADITIVO (sesión actual, 2026-09-19).
 */
export type FuenteDeteccion = "satelite" | "prensa_redes" | "camaras_fijas" | "avisos_ciudadanos";

export interface ExtraccionObservacion {
  esIncendio: boolean;
  tipo: "humo" | "llamas" | "incendio_activo" | "olor" | "otro";
  gravedad: "leve" | "moderada" | "grave" | "critica";
  lugarTexto?: string;
  municipio?: string;
  personasEnRiesgo?: boolean;
  viviendasCerca?: boolean;
  tamanoEstimado?: string;
  resumen: string;
  /** 0..1 fiabilidad estimada por el extractor. */
  fiabilidad: number;
  /** Datos estructurados que la fuente afirma (prensa, parte oficial): se heredan al foco si lo crea. */
  areaHa?: number;
  nivelDeclarado?: NivelGravedad;
  situacion?: "activo" | "estabilizado" | "controlado" | "extinguido" | "desconocido";
  /** Medios que ya actúan según la fuente ("UME y 14 medios aéreos"), no gestionados por Atalaya. */
  mediosMencionados?: string;
}

export type ImpactoObservacion = "ruido" | "registrada" | "confirma" | "nuevo_foco" | "agrava" | "mitiga" | "duplicada";

export interface Observacion {
  id: string;
  canal: CanalObservacion;
  recibidaEn: string; // ISO real
  /** Texto original (transcripción, mensaje, titular, descripción de imagen). */
  texto: string;
  /** Quién lo envía (teléfono, email, medio, cámara, satélite). */
  remitente?: string;
  urlFuente?: string;
  punto?: Punto;
  extraccion?: ExtraccionObservacion;
  impacto?: ImpactoObservacion;
  incendioId?: string;
  /** Explicación del verificador. */
  verificacion?: string;
  /** Referencia externa (run id de HappyRobot, id de post…). */
  referenciaExterna?: string;
}

// ----------------------------------------------------------------------
// Decisiones y acciones
// ----------------------------------------------------------------------

export type TipoAccion =
  | "llamar"
  | "enviar_sms"
  | "enviar_email"
  | "enviar_telegram"
  | "desplegar_unidad"
  | "reasignar_unidad"
  | "retirar_unidad"
  | "solicitar_medios_aereos"
  | "avisar_poblacion"
  | "confinar_poblacion"
  | "evacuar_poblacion"
  | "cortar_carretera"
  | "publicar_comunicado"
  | "elevar_nivel"
  | "declarar_controlado"
  | "abrir_ticket"
  | "vigilar_camara"
  | "solicitar_confirmacion";

export type EstadoAccion = "pendiente" | "ejecutando" | "ejecutada" | "fallida" | "cancelada";

export interface Accion {
  id: string;
  tipo: TipoAccion;
  /** Frase para el usuario: "Llamar al Ayuntamiento de Navalacruz". */
  descripcion: string;
  /** Destinatario/objeto: unidadId, poblacionId, teléfono, email… */
  objetivo?: { unidadId?: string; poblacionId?: string; telefono?: string; email?: string; camaraId?: string; punto?: Punto };
  /** Parámetros libres (guion de llamada, texto SMS, sector, etc.). */
  parametros: Record<string, unknown>;
  estado: EstadoAccion;
  /** Competencia mínima de esta acción. Ausente en datos históricos: se deriva de la política. */
  competencia?: ModoCompetencia;
  /** Riesgo propio 0..100. La política puede elevarlo, nunca reducirlo. */
  riesgo?: number;
  /** IDs de acciones de esta misma decisión que deben terminar con éxito antes de ejecutarla. */
  dependeDe?: string[];
  /** Resultado de la ejecución real (id de run HappyRobot, transcripción, error…). */
  resultado?: { en: string; proveedor: string; referencia?: string; resumen: string; exito: boolean; datos?: Record<string, unknown> };
  ejecutadaEn?: string;
  /** Quién autorizó la ejecución ("ia" o "humano:<nombre>") y cuándo se ordenó (auditoría). */
  autorizadaPor?: string;
  ordenadaEn?: string;
  /** Informe (acta) de esta acción concreta. */
  informeId?: string;
}

export type ModoCompetencia = "autonoma" | "supervisada" | "humano";

export type EstadoDecision =
  | "propuesta" // esperando supervisor/política
  | "pendiente_humano" // requiere aprobación
  | "aprobada"
  | "denegada"
  | "ejecutando"
  | "ejecutada"
  | "fallida"
  | "escalada" // el supervisor la devolvió a un humano
  | "caducada";

export interface Evidencia {
  id: string;
  fuente: string; // "Open-Meteo", "NASA FIRMS", "Cámara DGT A-6 km 12", "Llamada 112"…
  resumen: string;
  url?: string;
  en: string;
  /** 0..1 */
  confianza?: number;
}

export interface Fundamento {
  chunkId: string;
  documento: string;
  seccion?: string;
  /** Fragmento citado (≤ 300 caracteres). */
  cita: string;
  /** 0..1 similitud. */
  similitud: number;
}

export interface EvaluacionSupervisor {
  en: string;
  /** 0..100 */
  puntuacion: number;
  aprueba: boolean;
  criterios: { nombre: string; puntuacion: number; comentario: string }[];
  motivoEscalado?: string;
  modelo: string;
}

export interface Decision {
  id: string;
  ejecucionId: string;
  agenteId: string;
  incendioId?: string;
  clusterId?: string;
  titulo: string;
  resumen: string;
  /** Razonamiento visible para el usuario (por qué esto y por qué ahora). */
  razonamiento: string;
  /** 1 = máxima urgencia. */
  prioridad: 1 | 2 | 3 | 4 | 5;
  /** Riesgo de la decisión 0..100 (para la política de autonomía). */
  riesgo: number;
  competencia: ModoCompetencia;
  estado: EstadoDecision;
  acciones: Accion[];
  evidencias: Evidencia[];
  fundamentos: Fundamento[];
  /** Alertas legales del asesor (si hay, la competencia sube a humano). */
  alertasLegales?: string[];
  /** Lecciones de ejecuciones anteriores tenidas en cuenta. */
  leccionesAplicadas?: { leccionId: string; texto: string }[];
  /** Decisiones anteriores del mismo incendio consideradas. */
  decisionesPrevias?: string[];
  evaluacion?: EvaluacionSupervisor;
  informeId?: string;
  creadaEn: string; // ISO real
  /** Momento de mundo en que se propuso. */
  creadaEnMundo: string;
  decididaEn?: string;
  decididaPor?: string; // "ia" | "humano:<nombre>"
  comentarioHumano?: string;
  /** Si la decisión sustituye a otra (replanificación por giro del frente). */
  sustituyeA?: string;
  motivoReplanificacion?: string;
  /** Traza del ciclo de agente que la propuso (auditoría). */
  trazaId?: string;
  /** Informes (actas) generados para esta decisión en cada estado, en orden. */
  informeIds?: string[];
  /** Historial de cambios de estado con quién y por qué (auditoría). */
  historial?: { en: string; enMundo: string; estado: EstadoDecision; quien: string; motivo?: string }[];
}

// ----------------------------------------------------------------------
// Informes, comunicados, lecciones, ejecuciones
// ----------------------------------------------------------------------

export interface Informe {
  id: string;
  ejecucionId: string;
  decisionId?: string;
  incendioId?: string;
  titulo: string;
  /** Markdown completo. */
  contenido: string;
  /** Decisiones anteriores consideradas al redactarlo. */
  decisionesConsideradas: string[];
  generadoEn: string;
  modelo: string;
  /**
   * decision = acta de una decisión en cualquier estado (propuesta, aprobada, denegada, escalada,
   * caducada, ejecutada, fallida) · accion = acta de UNA acción ejecutada (llamada, SMS, despliegue…) ·
   * situacion = parte periódico · postmortem = cierre de ejecución · ciclo = acta de un ciclo de agente.
   */
  tipo: "decision" | "accion" | "situacion" | "postmortem" | "ciclo";
  /** Acción concreta a la que se refiere (tipo "accion"). */
  accionId?: string;
  /** Agente que originó la decisión/acción/ciclo. */
  agenteId?: string;
  /** Traza del ciclo que la produjo, para auditar qué vio y qué pensó el agente. */
  trazaId?: string;
  /** Estado de la decisión en el momento de redactar (para distinguir actas sucesivas). */
  estadoDecision?: EstadoDecision;
  /** true si la narrativa la generó la IA; false si solo hay acta determinista. */
  conNarrativaIA?: boolean;
  /** Huella SHA-256 del contenido para garantizar que el acta no se altera. */
  huella?: string;
}

export interface Comunicado {
  id: string;
  ejecucionId: string;
  incendioId?: string;
  titulo: string;
  cuerpo: string;
  /** Traducciones por código de idioma. */
  traducciones?: Record<string, { titulo: string; cuerpo: string }>;
  canales: ("portal" | "sms" | "email" | "telegram" | "rrss")[];
  estado: "borrador" | "pendiente_aprobacion" | "publicado" | "retirado";
  publicadoEn?: string;
  aprobadoPor?: string;
  decisionId?: string;
}

export interface Leccion {
  id: string;
  ejecucionId: string;
  /** A qué agente se aplica ("*" para todos). */
  agenteId: string;
  categoria: "aviso_poblacion" | "despliegue" | "prediccion" | "comunicacion" | "deteccion" | "legal" | "supervision" | "general";
  texto: string;
  /** Qué ocurrió (evidencia) y qué cambiar. */
  evidencia: string;
  cambio: string;
  /** Peso 0..1 (sube si se confirma en más ejecuciones). */
  peso: number;
  creadaEn: string;
  vecesAplicada: number;
  origen: "denegacion_humana" | "aprobacion_humana" | "supervisor" | "resultado_accion" | "postmortem";
}

export interface MetricasEjecucion {
  incendios: number;
  decisionesPropuestas: number;
  decisionesAprobadas: number;
  decisionesDenegadas: number;
  decisionesAutonomas: number;
  escaladasAHumano: number;
  /** Minutos de mundo medios desde detección hasta primer aviso a población. */
  minutosDeteccionAviso?: number;
  /** Minutos de mundo medios desde detección hasta primera unidad en ruta. */
  minutosDeteccionDespliegue?: number;
  poblacionesAvisadas: number;
  poblacionesEnPeligroSinAvisar: number;
  llamadasRealizadas: number;
  llamadasContestadas: number;
  puntuacionSupervisorMedia?: number;
  falsosPositivosCamara: number;
}

export interface Ejecucion {
  id: string;
  nombre: string;
  inicio: string;
  fin?: string;
  estado: "activa" | "cerrada";
  metricas: MetricasEjecucion;
  /** Comparación con la ejecución anterior (texto para el usuario). */
  comparativa?: string;
  postmortemInformeId?: string;
  /**
   * Fuentes de detección apagadas por el mando en esta ejecución (ausente o
   * vacío = operación real, todas activas). Una fuente apagada no se recoge y
   * sus avisos no crean ni confirman focos. CAMPO NUEVO Y OPCIONAL (sesión actual).
   */
  fuentesDesactivadas?: FuenteDeteccion[];
}

// ----------------------------------------------------------------------
// Agentes de la aplicación
// ----------------------------------------------------------------------

export type CategoriaAgente = "percepcion" | "analisis" | "planificacion" | "ejecucion" | "comunicacion" | "supervision" | "aprendizaje";

export type EstadoAgente = "inactivo" | "observando" | "razonando" | "actuando" | "esperando_humano" | "pausado" | "error";

/** Registro de una llamada a un modelo de IA dentro de un ciclo (para los visores de agentes). */
export interface LlamadaIA {
  en: string;
  proveedor: string;
  modelo: string;
  papel: "razonamiento" | "rapido" | "vision" | "embeddings" | "audio";
  latenciaMs: number;
  tokensEntrada?: number;
  tokensSalida?: number;
  /** Primeras ~400 letras del prompt de usuario (sin imágenes). */
  promptResumen: string;
  /** Primeras ~400 letras de la respuesta. */
  respuestaResumen: string;
  error?: string;
}

/** Traza de un ciclo de un agente: qué recibió, qué pensó (llamadas de IA), qué produjo. */
export interface TrazaCiclo {
  id: string;
  inicio: string;
  fin?: string;
  duracionMs?: number;
  estado: "en_curso" | "ok" | "error" | "cancelado";
  /** Por qué se ejecutó: "cadencia" o el evento que lo despertó. */
  motivo: string;
  /** Resumen de entradas relevantes (p. ej. "2 incendios activos, 5 unidades libres, viento NO 32 km/h"). */
  entradas?: string;
  /** Frase final del agente (ResultadoCiclo.resumen). */
  resumen?: string;
  error?: string;
  llamadasIA: LlamadaIA[];
  /** IDs de decisiones/observaciones producidas. */
  decisiones: string[];
  observaciones: string[];
  eventos: number;
}

export interface EstadoAgenteApp {
  id: string; // "vigia_camaras"
  nombre: string; // "Vigía de cámaras"
  categoria: CategoriaAgente;
  descripcion: string;
  estado: EstadoAgente;
  /** Qué está haciendo ahora, en una frase para el usuario. */
  tareaActual?: string;
  /** Sobre qué incendio trabaja ahora. */
  incendioId?: string;
  ultimaActividad?: string;
  ultimoError?: string;
  /** Modelo de IA que usa (o "determinista"). */
  modelo: string;
  /** Contadores para la pantalla. */
  contadores: { ciclos: number; decisiones: number; acciones: number; errores: number };
  /** true si un humano lo ha pausado. */
  pausado: boolean;
  /** true si un humano ha asumido el control: sus propuestas pasan a supervisadas. */
  controlHumano: boolean;
  /** Segundos entre ciclos. */
  cadenciaSeg: number;
  /**
   * Segundos máximos de un ciclo antes de que el orquestador lo cancele (CAMPO
   * NUEVO Y OPCIONAL, constructor J): sin él no había forma de ver desde
   * /api/estado por qué una traza salía "cancelado".
   */
  tiempoMaximoSeg?: number;
  /** Últimos ciclos (≤ 20), para los visores de agentes. */
  trazas?: TrazaCiclo[];
  /**
   * Nombre legible de la fuente de detección apagada por el escenario que deja a
   * este agente sin ciclos (p. ej. "Satélite (NASA FIRMS)"). Distinto de `pausado`:
   * no lo ha parado un humano a él, sino que su fuente está apagada. CAMPO NUEVO Y
   * OPCIONAL (sesión actual).
   */
  desactivadoPorEscenario?: string;
}

// ----------------------------------------------------------------------
// Eventos (registro vivo)
// ----------------------------------------------------------------------

export type TipoEvento =
  | "incendio_nuevo"
  | "incendio_actualizado"
  | "incendio_cerrado"
  | "observacion"
  | "camara_positiva"
  | "satelite"
  | "viento_gira"
  | "peligro_sube"
  | "decision_propuesta"
  | "decision_aprobada"
  | "decision_denegada"
  | "decision_ejecutada"
  | "decision_escalada"
  | "accion_ejecutada"
  | "accion_fallida"
  | "unidad_movida"
  | "unidad_llega"
  | "poblacion_avisada"
  | "comunicado"
  | "agente"
  | "humano"
  | "leccion"
  | "sistema";

export interface Evento {
  id: string;
  en: string; // ISO real
  enMundo: string; // ISO mundo
  tipo: TipoEvento;
  agenteId?: string;
  incendioId?: string;
  /** Una frase legible. */
  mensaje: string;
  /** Importancia para filtrar en la UI. */
  nivel: "info" | "aviso" | "critico";
  datos?: Record<string, unknown>;
}

// ----------------------------------------------------------------------
// Política de autonomía
// ----------------------------------------------------------------------

export interface ReglaAutonomia {
  tipoAccion: TipoAccion;
  /** Modo por defecto para este tipo de acción. */
  modo: ModoCompetencia;
  /** Riesgo mínimo asignado a cualquier decisión que incluya esta acción (suelo). */
  riesgoMinimo: number;
  descripcion: string;
}

export interface PoliticaAutonomia {
  reglas: ReglaAutonomia[];
  /** Riesgo a partir del cual todo pasa a "humano" aunque la regla diga otra cosa. */
  umbralHumano: number;
  /** Riesgo a partir del cual todo pasa a "supervisada". */
  umbralSupervisada: number;
  /** Puntuación mínima del supervisor para ejecutar sin humano. */
  puntuacionMinimaSupervisor: number;
  /** Nivel de gravedad a partir del cual todas las decisiones son humanas. */
  nivelGravedadHumano: NivelGravedad;
  /** Minutos REALES que una decisión pendiente puede esperar a un humano antes de caducar (no minutos de mundo). */
  minutosCaducidad: number;
  actualizadaEn: string;
  actualizadaPor: string;
}

// ----------------------------------------------------------------------
// Conocimiento (grafo de protocolos y normativa)
// ----------------------------------------------------------------------

export type AmbitoDocumento = "nacional" | "comunidad" | "provincia" | "municipio" | "interno";

export interface Documento {
  id: string;
  titulo: string;
  nombreArchivo: string;
  ambito: AmbitoDocumento;
  /** Comunidad/municipio al que aplica si ámbito ≠ nacional. */
  territorio?: string;
  subidoEn: string;
  tamanoBytes: number;
  numChunks: number;
  estado: "procesando" | "listo" | "error";
  error?: string;
}

export interface Chunk {
  id: string;
  documentoId: string;
  indice: number;
  seccion?: string;
  texto: string;
  /** Entidades detectadas (organismos, roles, acciones, niveles). */
  entidades: string[];
  /** IDs de chunks relacionados (siguiente, mismo artículo, referencia cruzada). */
  relacionados: string[];
  /** Solo presente en respuestas de consulta. */
  similitud?: number;
}

export interface NodoGrafo {
  id: string;
  tipo: "documento" | "chunk" | "entidad";
  etiqueta: string;
  documentoId?: string;
}

export interface AristaGrafo {
  origen: string;
  destino: string;
  tipo: "contiene" | "sigue" | "menciona" | "referencia";
}

export interface GrafoConocimiento {
  nodos: NodoGrafo[];
  aristas: AristaGrafo[];
}

export interface ConsultaConocimiento {
  pregunta: string;
  respuesta: string;
  fundamentos: Fundamento[];
  /** Chunks vecinos por el grafo que también se consultaron. */
  vecinos: string[];
  modelo: string;
}

// ----------------------------------------------------------------------
// Estado global que viaja por SSE
// ----------------------------------------------------------------------

/**
 * AÑADIDO (constructor D, OPCIONAL): parte interno que abre un agente cuando
 * hay que dejar constancia fuera del sistema (SEPRONA, mantenimiento, DGT…).
 * Lo crea la acción `abrir_ticket` del ejecutor.
 */
export interface Ticket {
  id: string;
  titulo: string;
  cuerpo: string;
  destinatario: string;
  estado: "abierto" | "en_curso" | "cerrado";
  creadoEn: string;
  decisionId?: string;
  incendioId?: string;
}

export interface Snapshot {
  version: number;
  generadoEn: string;
  reloj: Reloj;
  ejecucion: Ejecucion;
  incendios: Incendio[];
  clusters: Cluster[];
  unidades: Unidad[];
  poblaciones: Poblacion[];
  hospitales: Hospital[];
  camaras: Camara[];
  focosSatelite: FocoSatelite[];
  observaciones: Observacion[];
  decisiones: Decision[];
  comunicados: Comunicado[];
  agentes: EstadoAgenteApp[];
  avisosMeteo: AvisoMeteo[];
  /** Últimos N eventos (el histórico completo está en /api/eventos). */
  eventos: Evento[];
  politica: PoliticaAutonomia;
  /** Lecciones activas (resumen) para mostrar "qué aprendió". */
  lecciones: Leccion[];
  /** Salud de servicios externos para la barra de estado (nombre → ok/ko + detalle). */
  servicios: Record<string, { ok: boolean; detalle?: string; en: string }>;
  /** AÑADIDO (constructor B): peligro por zonas de España para el mapa de calor. */
  zonasPeligro?: ZonaPeligro[];
  /** AÑADIDO (constructor A, OPCIONAL): informes generados en esta ejecución. */
  informes?: Informe[];
  /** AÑADIDO (constructor D, OPCIONAL): partes internos abiertos por los agentes. */
  tickets?: Ticket[];
}
