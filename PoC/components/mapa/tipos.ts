// Datos geográficos que consume el mapa. Forma pactada con poc-55 (EstadoSistema.mapa,
// Decision.rutas, entorno.penacho); se declaran aquí para que el mapa compile mientras
// el backend los publica. Todo opcional: el mapa pinta lo que llegue.

export interface SensorMapa {
  id: string;
  descripcion: string;
  lat: number;
  lon: number;
  carga: number; // % de carga de la vía
  nivelServicio?: number;
  intensidad?: number; // veh/h
  timestamp?: string;
}

export interface PoiMapa {
  id: string; // "node/123"
  tipo: string; // hospital | bomberos | policia | centro_salud | colegio | residencia | refugio
  nombre: string;
  lat: number;
  lon: number;
  url?: string; // ficha en openstreetmap.org
  fuente?: string; // "Overpass" | "OSM"
  distanciaM?: number; // al incidente
}

export interface RutaMapa {
  id: string;
  nombre: string;
  tipo: string; // desvio | evacuacion | ambulancia | acceso
  coords: [number, number][];
  distanciaM?: number;
  duracionS?: number;
  fuente?: string; // "OSRM"
}

export interface PenachoServidor {
  longitudM: number;
  semianguloGrados: number;
  rumboGrados?: number;
  afectados?: string[]; // ids de nodo
}

export interface DatosMapa {
  centro?: { lat: number; lon: number };
  sensores?: SensorMapa[];
  pois?: PoiMapa[];
  actualizadoEn?: string;
}
