// Guion del escenario dinámico: incendio industrial en Méndez Álvaro 56 (Madrid).
// Cada tick (~5 min de tiempo de crisis) añade eventos, pide una decisión nueva
// al proponente y, en el tick 4, fuerza un giro de viento que invalida los
// planes anteriores. Los datos de entorno (viento, aire, tráfico) son reales.

import type { EventoIngesta } from "../types";
import type { Incidente } from "../tipos-sistema";
import { COORDS_OSM } from "./geo/nodos-osm";

export const INCIDENTE_BASE: Omit<Incidente, "iniciadoEn" | "tick" | "fase" | "activo"> = {
  id: "Incidencias/inc-2049",
  titulo: "Incendio industrial — Nave Méndez Álvaro 56",
  tipo: "incendio_industrial",
  // Coordenadas reales (OSM way/85588573, Nominatim 2026-09-18); fallback a la estimación si faltara la entrada.
  ubicacion: { nombre: "C/ Méndez Álvaro 56, Arganzuela, Madrid", lat: COORDS_OSM["Incidencias/inc-2049"]?.lat ?? 40.3935, lon: COORDS_OSM["Incidencias/inc-2049"]?.lon ?? -3.679 },
};

export interface PasoGuion {
  tick: number;
  fase?: Incidente["fase"];
  eventos?: (ahora: string) => EventoIngesta[];
  foco?: { clave: string; descripcion: string };
  giroViento?: { direccionGrados: number; velocidadKmh: number; motivo: string };
  invalidarFocos?: string[];
  sitrep?: boolean;
}

const ev = (id: string, fuente: EventoIngesta["fuente"], titulo: string, detalle: string, confianza: number, ubicacion: string, ahora: string, offsetSeg = 0, verificacion?: EventoIngesta["verificacion"]): EventoIngesta => ({
  id,
  fuente,
  timestamp: new Date(new Date(ahora).getTime() + offsetSeg * 1000).toISOString(),
  titulo,
  detalle,
  confianza,
  ubicacion,
  verificacion,
});

export const GUION: PasoGuion[] = [
  {
    tick: 0,
    fase: "deteccion",
    eventos: (t) => [
      ev("ev-001", "Ciudadano", "Reporte ciudadano con imagen", "\"Hay muchísimo humo negro saliendo de la nave de Méndez Álvaro, se oyen explosiones pequeñas.\"", 0.72, "C/ Méndez Álvaro 56", t, -90),
      ev("ev-002", "FalAI", "Visión: fuego activo detectado", "Clases: fire (0.96), dense_smoke (0.93), industrial_building (0.88). Sin personas visibles en el encuadre.", 0.96, "C/ Méndez Álvaro 56", t, -60),
      ev("ev-003", "Exa", "14 menciones en X/Twitter (últimos 8 min)", "Términos: \"humo Méndez Álvaro\", \"incendio nave\", \"olor a plástico quemado\". Radio de 1,2 km.", 0.81, "Arganzuela, Madrid", t, -30),
      ev("ev-003b", "Ciudadano", "Reporte ciudadano: humo en Méndez Álvaro", "\"Mucho humo negro en la nave de Méndez Álvaro, parece que explota algo.\"", 0.7, "C/ Méndez Álvaro 56", t, -20, { estado: "duplicado", motivo: "Misma ubicación y contenido que ev-001 (similitud 0,91)", duplicaDe: "ev-001" }),
    ],
    foco: { clave: "despliegue_inicial", descripcion: "Primera respuesta: qué medios enviar, perímetro y prioridad de protección. Aún no hay confirmación oficial de heridos." },
  },
  {
    tick: 1,
    fase: "respuesta",
    eventos: (t) => [
      ev("ev-004", "Exa", "Noticia local: Emergencias Madrid confirma aviso", "Telemadrid: \"Bomberos reciben múltiples llamadas por un incendio en una nave industrial del sur de Madrid.\"", 0.9, "Arganzuela, Madrid", t),
      ev("ev-005", "FalAI", "Visión: segunda imagen — humo cruza la M-30", "Clases: dense_smoke (0.91), highway (0.85), low_visibility (0.79).", 0.91, "M-30, salida 12", t, 20),
      ev("ev-005b", "Ciudadano", "Foto viral: \"explosión química en Méndez Álvaro\"", "Imagen compartida 600 veces con una bola de fuego naranja sobre naves industriales.", 0.4, "Méndez Álvaro", t, 40, { estado: "sospechoso", motivo: "Exa: la imagen coincide con el incendio de Seseña (mayo 2016); no es actual" }),
    ],
    foco: { clave: "corte_m30", descripcion: "El humo cruza la M-30 sur. Decidir si se corta la vía (total o parcial) usando la carga real de tráfico de los sensores municipales." },
  },
  {
    tick: 2,
    eventos: (t) => [
      ev("ev-006", "Ciudadano", "Llamada al 112: olor a humo en urgencias del Gregorio Marañón", "\"Somos del servicio de urgencias, entra olor a plástico quemado por la toma de aire. ¿Cerramos?\"", 0.85, "Hospital Gregorio Marañón", t),
    ],
    foco: { clave: "hospital", descripcion: "El grafo muestra que la vía bloqueada abastece al Hospital Gregorio Marañón. Decidir protección del hospital y preposicionamiento sanitario." },
  },
  {
    tick: 3,
    fase: "escalada",
    eventos: (t) => [
      ev("ev-007", "HappyRobot", "Llamada entrante: residencia de mayores Méndez Álvaro", "Agente de voz: la directora informa de 42 residentes (11 con movilidad reducida) a 300 m de la nave; el humo entra por las ventanas. Pide instrucciones.", 0.93, "C/ Méndez Álvaro 40", t),
    ],
    foco: { clave: "evacuacion", descripcion: "Residencia de mayores a 300 m con 42 personas. Decidir evacuación o confinamiento, destino y medios." },
    sitrep: true,
  },
  {
    tick: 4,
    eventos: (t) => [
      ev("ev-008", "OpenMeteo", "Cambio brusco de viento: rola a componente sur", "Viento de 32 km/h del SSO. La columna de humo gira hacia el NNE: C/ Méndez Álvaro, subestación de Cerro de la Plata y Hospital Gregorio Marañón (a 2,7 km).", 0.9, "Arganzuela, Madrid", t),
      ev("ev-009", "FalAI", "Visión: tercera imagen — humo sobre el acceso al Gregorio Marañón", "Clases: dense_smoke (0.94), hospital_building (0.83), road (0.8). El acceso de urgencias queda bajo la columna de humo.", 0.94, "Hospital Gregorio Marañón", t, 25),
    ],
    giroViento: { direccionGrados: 201, velocidadKmh: 32, motivo: "Giro de guion de la demo: el viento rola al rumbo opuesto al hospital (calculado con coordenadas reales) y el humo avanza hacia el Gregorio Marañón." },
    invalidarFocos: ["despliegue_inicial", "corte_m30", "evacuacion", "hospital"],
    foco: { clave: "replanificacion_viento", descripcion: "El viento ha rolado (32 km/h) y el humo avanza hacia el NNE: C/ Méndez Álvaro, la subestación de Cerro de la Plata y el acceso de urgencias del Hospital Gregorio Marañón (2,7 km). Replanificar protección del hospital, ruta de evacuación, corte de tráfico y posición de bomberos." },
  },
  {
    tick: 5,
    eventos: (t) => [
      ev("ev-010", "Exa", "Tendencia en redes: 240 menciones, vídeos virales y rumores de explosión química", "Exa detecta 3 vídeos reciclados de otro incendio (2023) presentados como actuales. Riesgo de pánico.", 0.8, "Madrid", t),
      ev("ev-010b", "Ciudadano", "Vídeo: \"están evacuando todo Arganzuela\"", "Vídeo de 40 s con columnas de humo y sirenas, sin referencias reconocibles.", 0.35, "Arganzuela", t, 15, { estado: "sospechoso", motivo: "Exa: vídeo publicado originalmente en 2023 (incendio de Montecarmelo); metadatos incoherentes" }),
      ev("ev-006b", "Ciudadano", "Llamada 112: humo en urgencias del hospital", "\"Entra humo por la ventilación de urgencias del Gregorio Marañón.\"", 0.8, "Hospital Gregorio Marañón", t, 30, { estado: "duplicado", motivo: "Misma ubicación e incidencia que ev-006", duplicaDe: "ev-006" }),
    ],
    foco: { clave: "comunicado", descripcion: "Rumores en redes y prensa. Decidir comunicado oficial y alerta a la población." },
  },
  {
    tick: 6,
    fase: "estabilizacion",
    eventos: (t) => [
      ev("ev-011", "Ciudadano", "Bomberos: incendio controlado, sin propagación a la subestación", "Jefe de intervención: fuego controlado al 80 %, se mantiene la vigilancia del flanco sur.", 0.95, "C/ Méndez Álvaro 56", t),
    ],
    sitrep: true,
  },
  { tick: 8, fase: "cierre", sitrep: true },
];

export const TICK_MAX = 8;
