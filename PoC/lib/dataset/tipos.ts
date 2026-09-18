// Tipos del dataset de eventos de emergencia (simulador de Atalaya).
// Cada evento se convierte en una ObservacionEntrante (lib/tipos-perifericos.ts)
// con `aObservacion()` (lib/dataset/index.ts) y se inyecta en POST /api/ingesta/observacion.

import type { FuenteIngesta } from "../types";
import type { CategoriaObservacion, TipoObservacion } from "../tipos-perifericos";

export type TipoEmergencia =
  | "incendio_urbano"
  | "incendio_industrial"
  | "incendio_forestal"
  | "inundacion"
  | "accidente_trafico"
  | "accidente_ferroviario"
  | "fuga_gas"
  | "derrumbe"
  | "apagon"
  | "ola_calor"
  | "nevada"
  | "terremoto"
  | "aglomeracion"
  | "vertido_quimico"
  | "persona_en_peligro"
  | "amenaza_seguridad";

export type Canal = "llamada_112" | "app_ciudadana" | "red_social" | "camara_trafico" | "sensor" | "aviso_oficial" | "efectivo";

export type Veracidad = "real" | "duplicado" | "bulo" | "ruido";

export interface LugarDataset {
  nombre: string; // "Nave industrial, C/ de Méndez Álvaro 56"
  direccion?: string;
  lat: number; // WGS84 reales (Nominatim / Overpass)
  lon: number;
  precisionM: number; // 10-50 si es dirección exacta, 100-500 si es aproximado ("por la zona de…")
  osmId?: string; // "node/123" | "way/456"
  fuenteCoordenadas: "Nominatim" | "Overpass" | "manual_verificada";
}

export interface ImagenDataset {
  archivo: string; // ruta pública: "/dataset/img/incendio-nave.jpg"
  descripcion: string;
  licencia: string;
  autor: string;
  urlOrigen: string;
}

export interface EventoDataset {
  id: string; // "inc-ind-01-e03"
  escenarioId?: string; // undefined para eventos sueltos
  offsetSeg: number; // segundos desde el inicio del escenario (0 para sueltos)
  tipoEmergencia: TipoEmergencia;
  categoria: CategoriaObservacion; // categoría del pipeline ("otro" si no encaja)
  tipoObservacion: TipoObservacion; // "texto" | "voz" | "publicacion" | "sensor" | "imagen" …
  canal: Canal;
  fuente: FuenteIngesta; // Ciudadano, HappyRobot (llamada de voz), Exa (red social), CamaraTrafico, Periferico, MadridTrafico, OpenMeteo, AEMET, IGN, REE…
  titulo: string; // una línea para el feed
  texto: string; // contenido completo (transcripción, publicación, aviso…)
  autor?: string;
  lugar: LugarDataset;
  sensor?: { magnitud: string; valor: number; unidad: string };
  imagen?: ImagenDataset;
  gravedadEsperada: "critica" | "alta" | "media" | "baja" | "nula";
  veracidad: Veracidad;
  duplicaDe?: string; // id del evento original si es duplicado
  motivoBulo?: string; // por qué es falso y cómo se detecta
  etiquetas: string[];
  decisionEsperada?: string; // qué debería proponer el sistema tras este evento (para evaluar la IA)
}

export interface EscenarioDataset {
  id: string;
  titulo: string;
  descripcion: string;
  tipoEmergencia: TipoEmergencia;
  zona: { nombre: string; lat: number; lon: number };
  duracionSeg: number; // 300-900 s en tiempo de demo
  objetivoDemo: string; // qué demuestra al jurado (dominó, escalada, bulo, giro de viento, escalado de firma…)
  eventos: EventoDataset[]; // ordenados por offsetSeg
}
