import type { TipoEvento } from "@/lib/dominio/tipos";
import type { IdAgenteLegacy } from "@/lib/agentes/identidad";
import {
  AGENTES_LOGICOS,
  aplanarCapacidadesConPadre,
  type CapacidadConPadre,
} from "@/lib/agentes/logicos";

/**
 * Fixture determinista para probar el integrador de la topología nueva sin
 * levantar Next ni tocar ningún proveedor externo. Mantiene el orden del
 * catálogo para que los fallos de atribución sean fáciles de leer.
 */
export const CAPACIDADES = aplanarCapacidadesConPadre();

/** Despertadores que forman parte del contrato de cada capacidad legacy. */
export const EVENTOS_DE_PRUEBA: readonly TipoEvento[] = [
  "incendio_nuevo",
  "incendio_actualizado",
  "observacion",
  "camara_positiva",
  "satelite",
  "viento_gira",
  "peligro_sube",
  "unidad_llega",
  "decision_propuesta",
  "decision_aprobada",
  "decision_denegada",
  "decision_ejecutada",
  "decision_escalada",
  "accion_fallida",
  "poblacion_avisada",
  "agente",
];

/**
 * Proyección del despertador que debe usar el integrador. Es deliberadamente
 * una fixture de pruebas, no una segunda tabla de producción: los ids salen
 * de los objetos `Agente` reales y el padre se conserva en cada fila.
 */
export function capacidadesDespertadasPor(evento: TipoEvento, capacidades: readonly CapacidadConPadre[] = CAPACIDADES): readonly CapacidadConPadre[] {
  return capacidades.filter(({ capacidad }) => capacidad.despiertaCon?.includes(evento));
}

export interface DeltaCapacidad {
  capacidadId: string;
  ciclos?: number;
  decisiones?: number;
  acciones?: number;
  errores?: number;
  trazaId?: string;
}

/**
 * Reduce deltas de capacidades a su ficha padre. El helper permite probar el
 * contrato de agregación sin inventar llamadas al LLM ni depender del reloj.
 */
export function agregarDeltasAlPadre(deltas: readonly DeltaCapacidad[]): Map<string, { ciclos: number; decisiones: number; acciones: number; errores: number; trazas: string[] }> {
  const salida = new Map<string, { ciclos: number; decisiones: number; acciones: number; errores: number; trazas: string[] }>();
  for (const delta of deltas) {
    const entrada = CAPACIDADES.find(({ capacidadId }) => capacidadId === delta.capacidadId);
    if (!entrada) throw new Error(`capacidad legacy desconocida en fixture: ${delta.capacidadId}`);
    const previo = salida.get(entrada.agenteId) ?? { ciclos: 0, decisiones: 0, acciones: 0, errores: 0, trazas: [] };
    previo.ciclos += delta.ciclos ?? 0;
    previo.decisiones += delta.decisiones ?? 0;
    previo.acciones += delta.acciones ?? 0;
    previo.errores += delta.errores ?? 0;
    if (delta.trazaId) previo.trazas.push(delta.trazaId);
    salida.set(entrada.agenteId, previo);
  }
  return salida;
}

/**
 * Solo capacidades activas pueden entrar en la cola de ejecución de prueba.
 *
 * La desactivación por escenario es granular: recibe ids de capacidad legacy,
 * no ids de los cinco padres. Apagar `satelite` no puede apagar el resto de
 * capacidades de `observador`.
 */
export function capacidadesEjecutables(
  capacidades: readonly CapacidadConPadre[],
  desactivadas: readonly IdAgenteLegacy[],
): readonly CapacidadConPadre[] {
  const apagadas = new Set(desactivadas);
  return capacidades.filter(({ capacidadId }) => !apagadas.has(capacidadId));
}

export function fichaPadreDe(capacidadId: string, capacidades: readonly CapacidadConPadre[] = CAPACIDADES): string | undefined {
  return capacidades.find((entrada) => entrada.capacidadId === capacidadId)?.agenteId;
}

/** Invariante del catálogo que reutilizan los tests para dar mensajes claros. */
export function padresDelCatalogo(): readonly string[] {
  return AGENTES_LOGICOS.map((agente) => agente.id);
}
