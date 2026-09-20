// Fábricas mínimas de objetos de dominio para las pruebas unitarias.
// DUEÑO: constructor L. No tocan red ni estado global.
import type { Accion, Combustible, Decision, Incendio, Meteo, Poblacion, TipoAccion, Trazado, Unidad } from "@/lib/dominio/tipos";
import { perimetroInicial } from "@/lib/simulacion/propagacion";

export function meteo(p: Partial<Meteo> = {}): Meteo {
  return {
    temperaturaC: 34,
    humedadPct: 18,
    vientoKmh: 35,
    direccionGrados: 225, // sopla DESDE el suroeste → el frente va al NE
    direccionTexto: "SO",
    rachasKmh: 40,
    precipitacionMm: 0,
    horaMundo: "2026-09-19T14:00:00.000Z",
    fuente: "Open-Meteo",
    url: "https://api.open-meteo.com/v1/forecast",
    ...p,
  };
}

export function combustible(dominante: Combustible["dominante"] = "pasto"): Combustible {
  const base: Combustible = { bosque: 0, matorral: 0, pasto: 0, agricola: 0, urbano: 0, dominante };
  base[dominante] = 1;
  return base;
}

/** Foco de prueba en Navalacruz (Ávila), perímetro circular inicial de 60 m. */
export function incendio(p: Partial<Incendio> = {}): Incendio {
  const centro = p.centro ?? { lat: 40.44, lon: -4.99 };
  const perimetro: Trazado = p.perimetro ?? perimetroInicial(centro);
  return {
    id: "inc-prueba",
    nombre: "Incendio de prueba",
    centro,
    municipio: "Navalacruz",
    provincia: "Ávila",
    comunidad: "Castilla y León",
    estado: "activo",
    nivelGravedad: 0,
    origen: "manual",
    confianza: 1,
    detectadoEn: "2026-09-19T14:00:00.000Z",
    actualizadoEn: "2026-09-19T14:00:00.000Z",
    perimetro,
    areaHa: 1.13,
    observaciones: [],
    radioOperativoKm: 30,
    meteo: meteo(),
    combustible: combustible("pasto"),
    pendientePct: 0,
    ...p,
  };
}

/** Pueblo a `distanciaKm` en el rumbo `rumbo` desde el foco. */
export function poblacion(nombre: string, distanciaKm: number, rumboGrados: number, p: Partial<Poblacion> = {}): Poblacion {
  return {
    id: `osm:node/${nombre}`,
    nombre,
    centro: { lat: 0, lon: 0 }, // fuera del perímetro a efectos de `dentroDePoligono`
    tipo: "pueblo",
    incendioId: "inc-prueba",
    distanciaKm,
    rumboDesdeFuegoGrados: rumboGrados,
    riesgo: "bajo",
    estadoAviso: "sin_avisar",
    ...p,
  };
}

export function accion(tipo: TipoAccion, p: Partial<Accion> = {}): Accion {
  return {
    id: `acc-${tipo}`,
    tipo,
    descripcion: `Acción ${tipo}`,
    parametros: {},
    estado: "pendiente",
    ...p,
  };
}

export function decision(acciones: Accion[], p: Partial<Decision> = {}): Decision {
  return {
    id: "dec-prueba",
    ejecucionId: "ejec-prueba",
    agenteId: "coordinador",
    titulo: "Decisión de prueba",
    resumen: "Resumen",
    razonamiento: "Porque sí",
    prioridad: 2,
    riesgo: 0,
    competencia: "autonoma",
    estado: "propuesta",
    acciones,
    evidencias: [],
    fundamentos: [],
    creadaEn: "2026-09-19T14:00:00.000Z",
    creadaEnMundo: "2026-09-19T14:00:00.000Z",
    ...p,
  };
}

export function unidad(tipo: Unidad["tipo"], p: Partial<Unidad> = {}): Unidad {
  return {
    id: `uni-${tipo}`,
    nombre: `Unidad ${tipo}`,
    tipo,
    base: { nombre: "Base", punto: { lat: 40.5, lon: -5 } },
    posicion: { lat: 40.44, lon: -4.99 },
    estado: "en_intervencion",
    incendioId: "inc-prueba",
    velocidadKmh: 60,
    dotacion: { personas: 5, vehiculos: 1 },
    fuente: "OSM",
    ...p,
  };
}
