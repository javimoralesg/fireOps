// Punto de entrada del dataset de eventos de emergencia (simulador de Atalaya).
// Ver README.md en esta carpeta.

import type { ObservacionEntrante } from "../tipos-perifericos";
import { accidenteFerroviarioAtocha } from "./escenarios/accidente-ferroviario-atocha";
import { accidenteM30Ventas } from "./escenarios/accidente-m30-ventas";
import { aglomeracionBernabeu } from "./escenarios/aglomeracion-bernabeu";
import { amenazaPaqueteSol } from "./escenarios/amenaza-paquete-sol";
import { apagonHortaleza } from "./escenarios/apagon-hortaleza";
import { danaManzanaresUsera } from "./escenarios/dana-manzanares-usera";
import { derrumbeTetuan } from "./escenarios/derrumbe-tetuan";
import { fugaGasChamberi } from "./escenarios/fuga-gas-chamberi";
import { incendioForestalCasaDeCampo } from "./escenarios/incendio-forestal-casa-de-campo";
import { incendioIndustrialMendezAlvaro } from "./escenarios/incendio-industrial-mendez-alvaro";
import { incendioUrbanoLavapies } from "./escenarios/incendio-urbano-lavapies";
import { nevadaNorteMadrid } from "./escenarios/nevada-norte-madrid";
import { olaCalorCarabanchel } from "./escenarios/ola-calor-carabanchel";
import { terremotoTajuna } from "./escenarios/terremoto-tajuna";
import { tormentaAbronigalVallecas } from "./escenarios/tormenta-abronigal-vallecas";
import { vertidoQuimicoVillaverde } from "./escenarios/vertido-quimico-villaverde";
import { EVENTOS_SUELTOS } from "./sueltos";
import type { Canal, EscenarioDataset, EventoDataset, TipoEmergencia } from "./tipos";

export type { Canal, EscenarioDataset, EventoDataset, ImagenDataset, LugarDataset, TipoEmergencia, Veracidad } from "./tipos";
export { IMAGENES } from "./imagenes";
export { LUGARES } from "./lugares";
export { EVENTOS_SUELTOS };

/** Escenarios de la demo. El primero es el principal (incendio de Méndez Álvaro). */
export const ESCENARIOS: EscenarioDataset[] = [
  incendioIndustrialMendezAlvaro,
  incendioUrbanoLavapies,
  incendioForestalCasaDeCampo,
  danaManzanaresUsera,
  tormentaAbronigalVallecas,
  accidenteM30Ventas,
  accidenteFerroviarioAtocha,
  vertidoQuimicoVillaverde,
  fugaGasChamberi,
  derrumbeTetuan,
  apagonHortaleza,
  olaCalorCarabanchel,
  nevadaNorteMadrid,
  terremotoTajuna,
  aglomeracionBernabeu,
  amenazaPaqueteSol,
];

export const ESCENARIO_PRINCIPAL = incendioIndustrialMendezAlvaro;

export const TODOS_LOS_EVENTOS: EventoDataset[] = [...ESCENARIOS.flatMap((e) => e.eventos), ...EVENTOS_SUELTOS];

export const ETIQUETA_TIPO: Record<TipoEmergencia, string> = {
  incendio_urbano: "Incendio urbano",
  incendio_industrial: "Incendio industrial",
  incendio_forestal: "Incendio forestal",
  inundacion: "Inundación",
  accidente_trafico: "Accidente de tráfico",
  accidente_ferroviario: "Accidente ferroviario",
  fuga_gas: "Fuga de gas",
  derrumbe: "Derrumbe",
  apagon: "Apagón",
  ola_calor: "Ola de calor",
  nevada: "Nevada",
  terremoto: "Terremoto",
  aglomeracion: "Aglomeración",
  vertido_quimico: "Vertido químico",
  persona_en_peligro: "Persona en peligro",
  amenaza_seguridad: "Amenaza a la seguridad",
};

export const ETIQUETA_CANAL: Record<Canal, string> = {
  llamada_112: "Llamada al 112",
  app_ciudadana: "App ciudadana",
  red_social: "Red social",
  camara_trafico: "Cámara de tráfico",
  sensor: "Sensor",
  aviso_oficial: "Aviso oficial",
  efectivo: "Efectivo en el terreno",
};

/** Busca un escenario por id. */
export function escenarioPorId(id: string): EscenarioDataset | undefined {
  return ESCENARIOS.find((e) => e.id === id);
}

/** Busca un evento (de escenario o suelto) por id. */
export function eventoPorId(id: string): EventoDataset | undefined {
  return TODOS_LOS_EVENTOS.find((e) => e.id === id);
}

export type ObservacionSimulada = ObservacionEntrante & {
  imagenUrl?: string;
  tipoEmergencia: TipoEmergencia;
  simulacro: true;
  datasetId: string;
  canal: Canal;
};

/** Convierte un evento del dataset en lo que recibe POST /api/ingesta/observacion. */
export function aObservacion(ev: EventoDataset, ahoraIso = new Date().toISOString()): ObservacionSimulada {
  return {
    perifericoId: "simulador",
    tipo: ev.tipoObservacion,
    timestamp: ahoraIso,
    posicion: { lat: ev.lugar.lat, lon: ev.lugar.lon, precisionM: ev.lugar.precisionM, timestamp: ahoraIso },
    texto: `${ev.titulo}\n${ev.texto}`,
    ...(ev.autor ? { autor: ev.autor } : {}),
    ...(ev.sensor ? { sensor: ev.sensor } : {}),
    ...(ev.imagen ? { imagenUrl: ev.imagen.archivo } : {}),
    tipoEmergencia: ev.tipoEmergencia,
    simulacro: true,
    datasetId: ev.id,
    canal: ev.canal,
  };
}
