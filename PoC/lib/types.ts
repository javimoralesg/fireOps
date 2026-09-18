// Tipos base compartidos entre la UI y lib/server/*. Los del sistema completo están en lib/tipos-sistema.ts.

export type FuenteIngesta =
  | "Exa"
  | "FalAI"
  | "Ciudadano"
  | "HappyRobot"
  | "MadridTrafico"
  | "OpenMeteo"
  | "REE"
  | "IGN"
  | "AEMET"
  | "Periferico" // móvil/cámara/sensor emparejado con la app (poc-07)
  | "CamaraTrafico" // cámaras públicas de tráfico del Ayuntamiento (informo.madrid.es)
  | "Organismo"; // avisos oficiales de organismos: Metro, Adif, Canal de Isabel II, distribuidoras, Emergencias Madrid

/** Enrutador de IA: qué modelo procesó el evento y cuánto tardó. */
export interface ProcesadoPor {
  modelo: string; // p. ej. "claude-haiku-4-5" (clasificación) | "claude-sonnet-5" (plan)
  latenciaMs: number;
  tarea: "clasificacion" | "extraccion_entidades" | "vision" | "verificacion" | "plan";
}

/** Filtro anti-saturación / fake news (FalAI extrae contexto, Exa cruza con fuentes públicas). */
export interface Verificacion {
  estado: "pendiente" | "verificado" | "duplicado" | "sospechoso";
  motivo?: string; // "Imagen coincide con un incendio de 2021 (Exa)"
  duplicaDe?: string; // id del evento original si es duplicado
}

export interface EventoIngesta {
  id: string;
  fuente: FuenteIngesta;
  timestamp: string; // ISO
  titulo: string;
  detalle: string;
  confianza: number; // 0..1
  ubicacion?: string;
  imagenUrl?: string; // R2
  procesadoPor?: ProcesadoPor[];
  verificacion?: Verificacion;
  geo?: { lat: number; lon: number; precisionM?: number; rumboGrados?: number }; // posición real del periférico (poc-07)
  perifericoId?: string; // id del periférico que lo generó
  etiquetas?: string[]; // etiquetas de visión: ["fire", "dense_smoke"]
  categoria?: string; // CategoriaObservacion (lib/tipos-perifericos.ts)
}

export type TipoNodo =
  | "Incidencia"
  | "Hospital"
  | "Centro_Comunicaciones"
  | "Ruta_Evacuacion"
  | "Carretera"
  | "Bomberos"
  | "Policia"
  | "Sanitarios"
  // Tipos del grafo real (OpenStreetMap), poc-07. La UI debe tener fallback para tipos desconocidos.
  | "Residencia" // residencias de mayores, centros de día, comedores sociales
  | "Colegio"
  | "Subestacion"
  | "Estacion" // metro / cercanías
  | "Refugio" // polideportivos y centros culturales usables como albergue
  | "Gasolinera"; // riesgo añadido

export type TipoArista = "BLOQUEA_A" | "SUMINISTRA_A" | "DESPLEGADO_EN";

export interface NodoGrafo {
  id: string;
  nombre: string;
  tipo: TipoNodo;
  x: number; // coordenadas del lienzo 0..100
  y: number;
  lat?: number; // grafo real: coordenadas WGS84 (poc-07)
  lon?: number;
  subtipo?: string; // categoría fina de OSM: "nursing_home", "primary", "metro"…
  origen?: "manual" | "OSM" | "periferico"; // de dónde salió el vértice
  osmId?: string; // "node/123" | "way/456"
  detalle?: string; // dirección, operador, capacidad… para el tooltip
}

export interface AristaGrafo {
  from: string;
  to: string;
  tipo: TipoArista;
}

/** Fila devuelta por la query AQL de Efecto Dominó. */
export interface ImpactoDomino {
  infraestructura: string;
  riesgo: number; // 25 | 50 | 75
  ruta: string[];
}

export interface AccionPlan {
  id: string;
  recurso: string;
  accion: string;
  eta: string;
  prioridad: "alta" | "media" | "baja";
}

export interface PlanPropuesto {
  version: number;
  razonamiento: string;
  acciones: AccionPlan[];
  mensajeAlerta: string; // texto que ElevenLabs convertirá a voz
  restricciones: string[]; // feedback humano acumulado
}

export interface TarjetaDecision {
  incidenteId: string;
  titulo: string;
  resumen: string;
  severidad: "critica" | "alta" | "media";
  protocolo: { codigo: string; nombre: string }; // QuiverAI
  domino: ImpactoDomino[];
  plan: PlanPropuesto;
}
