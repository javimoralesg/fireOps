// Escenario del mando: fijar o quitar el viento a mano en uno o varios focos.
// DUEÑO: sesión orquestadora. Se aplica sobre la meteo real (solo viento), queda
// marcado como "forzado" y despierta a meteorólogo, propagación y planificadores
// para que el giro se note de inmediato (replanificación, avisos, predicción).

import type { Incendio } from "../dominio/tipos";
import { calcularPeligro } from "../fuentes/peligro";
import { aplicarVientoForzado } from "../agentes/percepcion/meteorologo";
import { obtenerEstado } from "./estado";
import { despertar } from "./orquestador";

export interface VientoForzado {
  direccionGrados: number;
  vientoKmh: number;
  rachasKmh?: number;
}

const AGENTES_A_DESPERTAR = ["meteorologo", "propagacion", "coordinador", "proteccion_poblacion", "portavoz"];

/** Fija (o quita, con `viento = null`) el viento forzado en un incendio y devuelve el incendio actualizado. */
export function fijarVientoForzado(incendioId: string, viento: VientoForzado | null, quien: string): Incendio | undefined {
  const estado = obtenerEstado();
  const incendio = estado.incendios.get(incendioId);
  if (!incendio) return undefined;

  if (!viento) {
    const actualizado = estado.actualizar(estado.incendios, incendioId, { meteoForzada: undefined, actualizadoEn: estado.reloj.ahoraMundo });
    estado.registrarEvento("humano", `${quien} quita el viento forzado en ${incendio.nombre}: vuelve la previsión real`, { incendioId, nivel: "aviso", datos: { quien } });
    for (const a of AGENTES_A_DESPERTAR) despertar(a, "humano");
    return actualizado;
  }

  const meteoForzada = { ...viento, fijadoPor: quien, en: new Date().toISOString() };
  const base = incendio.meteo;
  const meteo = base ? aplicarVientoForzado(base, { meteoForzada }) : undefined;
  const peligro = meteo ? calcularPeligro(meteo, incendio.combustible) : incendio.peligro;
  const actualizado = estado.actualizar(estado.incendios, incendioId, {
    meteoForzada,
    ...(meteo ? { meteo } : {}),
    ...(peligro ? { peligro } : {}),
    actualizadoEn: estado.reloj.ahoraMundo,
  });
  const anterior = base ? `${base.direccionTexto} ${Math.round(base.vientoKmh)} km/h` : "sin dato";
  estado.registrarEvento(
    "viento_gira",
    `${quien} fija el viento en ${incendio.nombre}: ${meteo?.direccionTexto ?? viento.direccionGrados + "°"} a ${viento.vientoKmh} km/h (antes ${anterior}). Ejercicio: viento forzado por el mando.`,
    { incendioId, nivel: "critico", datos: { quien, forzado: true, anteriorGrados: base?.direccionGrados, nuevoGrados: viento.direccionGrados, vientoKmh: viento.vientoKmh } },
  );
  for (const a of AGENTES_A_DESPERTAR) despertar(a, "viento_gira");
  return actualizado;
}
