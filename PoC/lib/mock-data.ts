import type {
  AristaGrafo,
  EventoIngesta,
  ImpactoDomino,
  NodoGrafo,
  TarjetaDecision,
} from "./types";

// ---------------------------------------------------------------------------
// Feed de ingesta (Exa + FalAI + reporte ciudadano)
// ---------------------------------------------------------------------------
export const EVENTOS_INGESTA: EventoIngesta[] = [
  {
    id: "ev-001",
    fuente: "Ciudadano",
    timestamp: "2026-09-18T20:41:12Z",
    titulo: "Reporte ciudadano con imagen",
    detalle:
      "\"Hay muchísimo humo negro saliendo de la nave de Méndez Álvaro, se oyen explosiones pequeñas.\"",
    confianza: 0.72,
    ubicacion: "C/ Méndez Álvaro 56",
  },
  {
    id: "ev-002",
    fuente: "FalAI",
    timestamp: "2026-09-18T20:41:15Z",
    titulo: "Visión: fuego activo detectado",
    detalle:
      "Clases: fire (0.96), dense_smoke (0.93), industrial_building (0.88). Sin personas visibles en el encuadre.",
    confianza: 0.96,
    ubicacion: "C/ Méndez Álvaro 56",
  },
  {
    id: "ev-003",
    fuente: "Exa",
    timestamp: "2026-09-18T20:41:40Z",
    titulo: "14 menciones en X/Twitter (últimos 8 min)",
    detalle:
      "Términos: \"humo Méndez Álvaro\", \"incendio nave\", \"olor a plástico quemado\". Radio de 1,2 km.",
    confianza: 0.81,
    ubicacion: "Arganzuela, Madrid",
  },
  {
    id: "ev-004",
    fuente: "Exa",
    timestamp: "2026-09-18T20:42:05Z",
    titulo: "Noticia local: Emergencias Madrid confirma aviso",
    detalle:
      "Telemadrid: \"Bomberos reciben múltiples llamadas por un incendio en una nave industrial del sur de Madrid.\"",
    confianza: 0.9,
    ubicacion: "Arganzuela, Madrid",
  },
  {
    id: "ev-005",
    fuente: "FalAI",
    timestamp: "2026-09-18T20:42:30Z",
    titulo: "Visión: segunda imagen — humo cruza la M-30",
    detalle:
      "Clases: dense_smoke (0.91), highway (0.85), low_visibility (0.79). Dirección del viento estimada: SO → NE.",
    confianza: 0.91,
    ubicacion: "M-30, salida 12",
  },
];

// ---------------------------------------------------------------------------
// Grafo de ciudad (ArangoDB: Ciudad_Graph)
// Vértices: Incidencias / Infraestructuras / Efectivos
// Aristas: BLOQUEA_A / SUMINISTRA_A / DESPLEGADO_EN
// ---------------------------------------------------------------------------
export const NODOS: NodoGrafo[] = [
  { id: "Incidencias/inc-2049", nombre: "Incendio Nave Méndez Álvaro", tipo: "Incidencia", x: 30, y: 55 },

  { id: "Infraestructuras/via-mendez-alvaro", nombre: "C/ Méndez Álvaro", tipo: "Carretera", x: 48, y: 42 },
  { id: "Infraestructuras/m30-sur", nombre: "M-30 (tramo sur)", tipo: "Carretera", x: 50, y: 74 },
  { id: "Infraestructuras/ruta-evac-3", nombre: "Ruta Evacuación R-3", tipo: "Ruta_Evacuacion", x: 70, y: 78 },
  { id: "Infraestructuras/hosp-gregorio", nombre: "Hospital Gregorio Marañón", tipo: "Hospital", x: 72, y: 30 },
  { id: "Infraestructuras/subest-arganzuela", nombre: "Subestación Arganzuela", tipo: "Carretera", x: 52, y: 20 },
  { id: "Infraestructuras/cecom-112", nombre: "Centro Comunicaciones 112", tipo: "Centro_Comunicaciones", x: 86, y: 52 },

  { id: "Efectivos/bomberos-p7", nombre: "Bomberos Parque 7", tipo: "Bomberos", x: 14, y: 30 },
  { id: "Efectivos/policia-u12", nombre: "Policía Unidad 12", tipo: "Policia", x: 12, y: 78 },
  { id: "Efectivos/samur-a3", nombre: "SAMUR Ambulancia A3", tipo: "Sanitarios", x: 88, y: 18 },
];

export const ARISTAS: AristaGrafo[] = [
  { from: "Incidencias/inc-2049", to: "Infraestructuras/via-mendez-alvaro", tipo: "BLOQUEA_A" },
  { from: "Incidencias/inc-2049", to: "Infraestructuras/m30-sur", tipo: "BLOQUEA_A" },
  { from: "Incidencias/inc-2049", to: "Infraestructuras/subest-arganzuela", tipo: "BLOQUEA_A" },
  { from: "Infraestructuras/via-mendez-alvaro", to: "Infraestructuras/hosp-gregorio", tipo: "SUMINISTRA_A" },
  { from: "Infraestructuras/m30-sur", to: "Infraestructuras/ruta-evac-3", tipo: "SUMINISTRA_A" },
  { from: "Infraestructuras/subest-arganzuela", to: "Infraestructuras/cecom-112", tipo: "SUMINISTRA_A" },
  { from: "Infraestructuras/hosp-gregorio", to: "Infraestructuras/cecom-112", tipo: "SUMINISTRA_A" },
  { from: "Efectivos/bomberos-p7", to: "Incidencias/inc-2049", tipo: "DESPLEGADO_EN" },
  { from: "Efectivos/policia-u12", to: "Infraestructuras/m30-sur", tipo: "DESPLEGADO_EN" },
  { from: "Efectivos/samur-a3", to: "Infraestructuras/hosp-gregorio", tipo: "DESPLEGADO_EN" },
];

/**
 * Resultado de la query AQL de Efecto Dominó (1..3 OUTBOUND desde la
 * incidencia). riesgo = (4 - profundidad) * 25 → 75 / 50 / 25.
 */
export const IMPACTO_DOMINO: ImpactoDomino[] = [
  {
    infraestructura: "Hospital Gregorio Marañón",
    riesgo: 50,
    ruta: ["Incendio Nave Méndez Álvaro", "C/ Méndez Álvaro", "Hospital Gregorio Marañón"],
  },
  {
    infraestructura: "Ruta Evacuación R-3",
    riesgo: 50,
    ruta: ["Incendio Nave Méndez Álvaro", "M-30 (tramo sur)", "Ruta Evacuación R-3"],
  },
  {
    infraestructura: "Centro Comunicaciones 112",
    riesgo: 50,
    ruta: ["Incendio Nave Méndez Álvaro", "Subestación Arganzuela", "Centro Comunicaciones 112"],
  },
  {
    infraestructura: "Centro Comunicaciones 112",
    riesgo: 25,
    ruta: [
      "Incendio Nave Méndez Álvaro",
      "C/ Méndez Álvaro",
      "Hospital Gregorio Marañón",
      "Centro Comunicaciones 112",
    ],
  },
];

// ---------------------------------------------------------------------------
// Tarjeta de decisión inicial (salida del orquestador /api/ingest)
// ---------------------------------------------------------------------------
export const TARJETA_INICIAL: TarjetaDecision = {
  incidenteId: "Incidencias/inc-2049",
  titulo: "Incendio industrial — Nave Méndez Álvaro 56",
  severidad: "critica",
  resumen:
    "Fuego activo confirmado por visión (96%) y 14 reportes ciudadanos. Humo denso cruzando la M-30 con viento SO→NE. Riesgo de afectar al acceso sur del Hospital Gregorio Marañón y a la subestación que alimenta el 112.",
  protocolo: { codigo: "PEMAM-IND-04", nombre: "Incendio industrial con materiales plásticos" },
  domino: IMPACTO_DOMINO,
  plan: {
    version: 1,
    razonamiento:
      "El protocolo PEMAM-IND-04 prioriza confinamiento del perímetro y protección de infraestructura crítica aguas abajo. Dado el vector de humo hacia el NE, se corta la M-30 sur preventivamente y se asegura el suministro eléctrico del 112.",
    acciones: [
      { id: "a1", recurso: "Bomberos Parque 7", accion: "Desplegar 2 autobombas + escala en Méndez Álvaro 56. Ataque perimetral, no interior.", eta: "6 min", prioridad: "alta" },
      { id: "a2", recurso: "Policía Unidad 12", accion: "Corte total M-30 sur entre salidas 11 y 13. Desvío por Ruta Evacuación R-3.", eta: "4 min", prioridad: "alta" },
      { id: "a3", recurso: "Helicóptero Bomberos H-1", accion: "Reconocimiento aéreo y descarga sobre cubierta de la nave.", eta: "12 min", prioridad: "media" },
      { id: "a4", recurso: "Iberdrola / Subestación Arganzuela", accion: "Conmutar Centro 112 a alimentación de respaldo.", eta: "8 min", prioridad: "alta" },
      { id: "a5", recurso: "SAMUR A3", accion: "Preposicionar en el acceso norte del Gregorio Marañón.", eta: "5 min", prioridad: "media" },
    ],
    mensajeAlerta:
      "Atención. Incendio industrial activo en Méndez Álvaro 56. Se corta la M-30 sur entre las salidas 11 y 13. Eviten la zona y mantengan ventanas cerradas por humo denso. Sigan las indicaciones de emergencias.",
    restricciones: [],
  },
};
