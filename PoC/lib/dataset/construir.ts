// Ayudantes para escribir el dataset sin repetir canal/fuente/tipo en cada evento.
// Cada canal tiene su fuente de ingesta y su tipo de observación por defecto:
//   llamada_112   → HappyRobot (voz transcrita)       · tipo "voz"
//   app_ciudadana → Ciudadano                          · "imagen" si lleva foto, si no "texto"
//   red_social    → Exa (publicación encontrada)       · "publicacion"
//   camara_trafico→ CamaraTrafico (informo.madrid.es)  · "fotograma"
//   sensor        → la que se indique (OpenMeteo, IGN, REE, AEMET, MadridTrafico, Periferico) · "sensor"
//   aviso_oficial → AEMET / REE / IGN si es suyo; Exa para Metro, Adif, Canal, distribuidoras y Emergencias Madrid · "texto"
//   efectivo      → Periferico (móvil del efectivo)    · "texto"

import type { FuenteIngesta } from "../types";
import type { TipoObservacion } from "../tipos-perifericos";
import type { EscenarioDataset, EventoDataset, Veracidad } from "./tipos";

type EventoSinEscenario = Omit<EventoDataset, "escenarioId">;

/** Lo que se escribe a mano en cada evento: canal, fuente y tipo los pone el ayudante. */
export type EventoBase = Omit<EventoSinEscenario, "canal" | "fuente" | "tipoObservacion" | "veracidad"> & {
  veracidad?: Veracidad; // "real" por defecto
  fuente?: FuenteIngesta;
  tipoObservacion?: TipoObservacion;
};

function completar(
  e: EventoBase,
  canal: EventoDataset["canal"],
  fuente: FuenteIngesta,
  tipoObservacion: TipoObservacion,
): EventoSinEscenario {
  const { veracidad, fuente: f, tipoObservacion: t, ...resto } = e;
  return { ...resto, canal, fuente: f ?? fuente, tipoObservacion: t ?? tipoObservacion, veracidad: veracidad ?? "real" };
}

export const llamada = (e: EventoBase) => completar(e, "llamada_112", "HappyRobot", "voz");
export const app = (e: EventoBase) => completar(e, "app_ciudadana", "Ciudadano", e.imagen ? "imagen" : "texto");
export const red = (e: EventoBase) => completar(e, "red_social", "Exa", "publicacion");
export const camara = (e: EventoBase) => completar(e, "camara_trafico", "CamaraTrafico", "fotograma");
export const sensor = (fuente: FuenteIngesta, e: EventoBase) => completar(e, "sensor", fuente, "sensor");
export const aviso = (fuente: FuenteIngesta, e: EventoBase) => completar(e, "aviso_oficial", fuente, "texto");
export const efectivo = (e: EventoBase) => completar(e, "efectivo", "Periferico", "texto");

/** Crea un escenario y pone su id en cada evento. No reordena: validar.ts comprueba el orden. */
export function escenario(e: Omit<EscenarioDataset, "eventos"> & { eventos: EventoSinEscenario[] }): EscenarioDataset {
  return { ...e, eventos: e.eventos.map((ev) => ({ ...ev, escenarioId: e.id })) };
}
