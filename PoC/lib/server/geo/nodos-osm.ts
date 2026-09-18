// Coordenadas REALES de los 10 nodos del grafo de lib/mock-data.ts, obtenidas de
// OpenStreetMap (Nominatim + Overpass) el 18 de septiembre de 2026 (~19:30 UTC).
// Ningún valor está inventado: todos salen de una consulta concreta, y el `osmId`
// permite verificarlos abriendo https://www.openstreetmap.org/<osmId>.
//
// ---------------------------------------------------------------------------
// CONSULTAS USADAS (reproducibles)
// ---------------------------------------------------------------------------
// Nominatim (User-Agent "crisis-mando-ai/0.1 (hackathon; contacto en repo)",
// format=jsonv2, limit=3, addressdetails=1, viewbox=-3.9,40.55,-3.5,40.30, bounded=1):
//   q="Calle de Mendez Alvaro 56, Madrid"              → way/85588573   (nave del incidente)
//   q="Centro de Emergencias 112 Comunidad de Madrid"  → way/366542172  (Pozuelo de Alarcón)
//
// Overpass (https://overpass-api.de/api/interpreter, `out center tags`), centradas en
// el incidente 40.3972179,-3.6826030:
//   [out:json][timeout:50];
//   (
//     way(around:1200,40.3972179,-3.6826030)[ref="M-30"];
//     nwr(around:2000,40.3972179,-3.6826030)[power=substation];
//     nwr(around:4000,40.3972179,-3.6826030)[amenity=fire_station];
//     nwr(around:2500,40.3972179,-3.6826030)[amenity=police];
//   ); out center tags;
//
//   [out:json][timeout:60];
//   (
//     way(around:400,40.3972179,-3.6826030)[highway][name~"Méndez Álvaro"];
//     nwr(around:2500,40.3972179,-3.6826030)[leisure=sports_centre][name];
//     nwr(around:5000,40.3972179,-3.6826030)[amenity=hospital][name];
//   ); out center tags;
//
//   [out:json][timeout:90][bbox:40.36,-3.74,40.45,-3.63];
//   ( nwr[emergency=ambulance_station]; node["name"~"SAMUR"]; way["name"~"SAMUR"]; );
//   out center tags;
//
// En todos los casos se eligió el elemento MÁS CERCANO al incidente que cumplía el
// criterio; la distancia medida va anotada en `notas`.
// ---------------------------------------------------------------------------

export interface CoordOsm {
  lat: number;
  lon: number;
  /** "node/123" | "way/456" | "relation/789". */
  osmId: string;
  /** Nombre tal y como figura en OSM (o la dirección devuelta por Nominatim). */
  nombreOsm: string;
  /** Instante ISO de la consulta. */
  consultadoEn: string;
  /** Criterio de selección y distancia al incidente, para auditoría. */
  notas: string;
  /** "Nominatim" | "Overpass". */
  fuente: "Nominatim" | "Overpass";
}

/** Momento en que se resolvieron todas las consultas de este fichero. */
export const CONSULTADO_EN = "2026-09-18T19:36:21Z";

/** Foco del escenario: C/ Méndez Álvaro 56, Arganzuela (Madrid). */
export const CENTRO_INCIDENTE = { lat: 40.3972179, lon: -3.682603 };

/**
 * id de nodo (lib/mock-data.ts → NODOS) → coordenadas reales de OSM.
 * Los 10 nodos del escenario están resueltos; no falta ninguno.
 */
export const COORDS_OSM: Record<string, CoordOsm> = {
  "Incidencias/inc-2049": {
    lat: 40.3972179,
    lon: -3.682603,
    osmId: "way/85588573",
    nombreOsm: "Grupo Arnaiz, 56, Calle de Méndez Álvaro, Delicias, Arganzuela, 28045 Madrid",
    consultadoEn: CONSULTADO_EN,
    notas: 'Nominatim q="Calle de Mendez Alvaro 56, Madrid". Portal 56 exacto; es el foco del escenario.',
    fuente: "Nominatim",
  },

  "Infraestructuras/via-mendez-alvaro": {
    lat: 40.3972635,
    lon: -3.6822151,
    osmId: "way/44098013",
    nombreOsm: "Calle de Méndez Álvaro (tramo a la altura del nº 56)",
    consultadoEn: CONSULTADO_EN,
    notas:
      "Overpass way[highway][name~Méndez Álvaro] around:400 del incidente; tramo más cercano, centroide a 33 m del portal 56.",
    fuente: "Overpass",
  },

  "Infraestructuras/m30-sur": {
    lat: 40.3955425,
    lon: -3.6807192,
    osmId: "way/371658827",
    nombreOsm: "M-30 · Bypass Sur (Calle 30), tramo más próximo al incidente",
    consultadoEn: CONSULTADO_EN,
    notas: 'Overpass way[ref="M-30"] around:1200 del incidente; el más cercano, centroide a 245 m.',
    fuente: "Overpass",
  },

  "Infraestructuras/ruta-evac-3": {
    lat: 40.3979539,
    lon: -3.6898728,
    osmId: "way/1046984010",
    nombreOsm: "Centro Deportivo Delicias (Paseo de las Delicias 61) — destino de la Ruta R-3",
    consultadoEn: CONSULTADO_EN,
    notas:
      "La R-3 es una ruta, no un punto: se ancla en su DESTINO, el polideportivo de Arganzuela más cercano sobre el Paseo de las Delicias (Overpass leisure=sports_centre around:2500, a 621 m del incidente).",
    fuente: "Overpass",
  },

  "Infraestructuras/hosp-gregorio": {
    lat: 40.4196605,
    lon: -3.6711734,
    osmId: "way/262480721",
    nombreOsm: "Hospital General Universitario Gregorio Marañón (C/ del Doctor Esquerdo 46)",
    consultadoEn: CONSULTADO_EN,
    notas:
      'Nominatim con q="Calle del Doctor Esquerdo 46, Madrid" solo devuelve la VÍA (way/44288850), sin el portal 46; se resolvió con Overpass nwr[amenity=hospital][name~"Gregorio"] around:5000 → recinto del hospital, a 2 677 m del incidente.',
    fuente: "Overpass",
  },

  "Infraestructuras/subest-arganzuela": {
    lat: 40.3998437,
    lon: -3.6810474,
    osmId: "way/231184704",
    nombreOsm: "Subestación Cerro de la Plata (Arganzuela)",
    consultadoEn: CONSULTADO_EN,
    notas:
      "Overpass power=substation around:2000 del incidente; la más cercana (320 m). En OSM se llama «Cerro de la Plata», no «Arganzuela», pero está en ese distrito.",
    fuente: "Overpass",
  },

  "Infraestructuras/cecom-112": {
    lat: 40.4212912,
    lon: -3.803844,
    osmId: "way/366542172",
    nombreOsm: "Centro de Emergencias 112 de la Comunidad de Madrid (Pozuelo de Alarcón)",
    consultadoEn: CONSULTADO_EN,
    notas:
      'Nominatim q="Centro de Emergencias 112 Comunidad de Madrid". Se elige la sede REAL del 112 (Pozuelo, ~10,6 km al ONO) y no la sede de Emergencias Madrid en C/ Bustamante, porque esa última se usa ya para el nodo SAMUR.',
    fuente: "Nominatim",
  },

  "Efectivos/bomberos-p7": {
    lat: 40.3932546,
    lon: -3.6739191,
    osmId: "way/394044571",
    nombreOsm: "Calle30 — Base de bomberos de Méndez Álvaro",
    consultadoEn: CONSULTADO_EN,
    notas:
      "Overpass amenity=fire_station around:4000 del incidente; el parque más cercano (857 m). El siguiente es el Parque nº 5 (Sta. María de la Cabeza) a 2,1 km.",
    fuente: "Overpass",
  },

  "Efectivos/policia-u12": {
    lat: 40.3937633,
    lon: -3.6810148,
    osmId: "way/358499249",
    nombreOsm: "Policía Municipal — Unidad Especial de Tráfico",
    consultadoEn: CONSULTADO_EN,
    notas:
      "Overpass amenity=police around:2500 del incidente; la más cercana (407 m). La UID de Arganzuela queda a 1,7 km.",
    fuente: "Overpass",
  },

  "Efectivos/samur-a3": {
    lat: 40.4004959,
    lon: -3.6892883,
    osmId: "way/393469732",
    nombreOsm: "SAMUR-Protección Civil · Base 8 (Calle de Bustamante 16)",
    consultadoEn: CONSULTADO_EN,
    notas:
      'Overpass nwr[emergency=ambulance_station] + name~"SAMUR" en bbox de Madrid centro; la base SAMUR más cercana (673 m).',
    fuente: "Overpass",
  },
};

/** Ids de nodo resueltos, por comodidad. */
export const NODOS_CON_COORDS = Object.keys(COORDS_OSM);
