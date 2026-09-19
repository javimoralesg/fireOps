/**
 * Catálogo de la topología de cinco agentes lógicos.
 *
 * Un agente lógico no es un nuevo prompt ni sustituye el trabajo ya probado de
 * una capacidad. Es una vista de composición: conserva los objetos `Agente`
 * existentes para que el integrador pueda ejecutar, medir y atribuir cada
 * capacidad sin perder la identidad del padre que se muestra en la sala.
 */

import type { CategoriaAgente, TipoEvento } from "../dominio/tipos";
import type { Agente } from "../motor/contratos";
import { CAPACIDADES_POR_AGENTE, IDS_AGENTES_CANONICOS, type IdAgenteCanonico, type IdAgenteLegacy } from "./identidad";
import { analistaPatrones, analistaPropagacion, verificador } from "./analisis";
import { agenteMemoria } from "./aprendizaje/memoria";
import { portavoz } from "./comunicacion/portavoz";
import { despachador } from "./ejecucion/despachador";
import { redactor } from "./informes/redactor";
import { agenteCentralita, agenteMeteorologo, agentePrensaRedes, agenteSatelite, agenteVigiaCamaras } from "./percepcion";
import { asesorLegal } from "./planificacion/asesor-legal";
import { coordinador } from "./planificacion/coordinador";
import { proteccionPoblacion } from "./planificacion/proteccion-poblacion";
import { supervisor } from "./supervision/supervisor";

/** Cómo se forma el agente lógico, sin fingir que tiene un único modelo. */
export interface ModeloDescriptivoAgenteLogico {
  tipo: "composicion_de_capacidades";
  resumen: string;
  modelosDeCapacidad: readonly string[];
  incluyeRazonamiento: boolean;
  incluyeServiciosDeterministas: boolean;
}

export interface CadenciaCapacidad {
  capacidadId: IdAgenteLegacy;
  cadenciaSeg: number;
}

/** Metadatos y capacidades reales que componen a un agente lógico. */
export interface AgenteLogico {
  id: IdAgenteCanonico;
  nombre: string;
  descripcion: string;
  /** Categorías heredadas de las capacidades; un padre puede ser transversal. */
  categorias: readonly CategoriaAgente[];
  capacidadIds: readonly IdAgenteLegacy[];
  capacidades: readonly Agente[];
  /** Unión de eventos que despiertan a cualquiera de sus capacidades. */
  despiertaCon: readonly TipoEvento[];
  /** Cadencia más corta del grupo: cota segura para despertar al padre. */
  cadenciaSeg: number;
  /** Cadencia original de cada capacidad, para que el integrador no la pierda. */
  cadenciasPorCapacidad: readonly CadenciaCapacidad[];
  modelo: ModeloDescriptivoAgenteLogico;
}

/** Relación plana que conserva tanto el padre lógico como su capacidad ejecutable. */
export interface CapacidadConPadre {
  agente: AgenteLogico;
  agenteId: IdAgenteCanonico;
  capacidad: Agente;
  capacidadId: IdAgenteLegacy;
}

function unico<T>(valores: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(valores)]);
}

function esDeterminista(agente: Agente): boolean {
  return agente.modelo.trim().toLowerCase() === "determinista";
}

function crearAgenteLogico(
  id: IdAgenteCanonico,
  nombre: string,
  descripcion: string,
  resumenModelo: string,
  capacidades: readonly Agente[],
): AgenteLogico {
  const capacidadIds = CAPACIDADES_POR_AGENTE[id];
  const idsReales = capacidades.map((capacidad) => capacidad.id);
  if (idsReales.length !== capacidadIds.length || idsReales.some((capacidadId, indice) => capacidadId !== capacidadIds[indice])) {
    throw new Error(`Las capacidades de ${id} no coinciden con CAPACIDADES_POR_AGENTE`);
  }

  const modelos = unico(capacidades.map((capacidad) => capacidad.modelo));
  const eventos = unico(capacidades.flatMap((capacidad) => capacidad.despiertaCon ?? []));
  const categorias = unico(capacidades.map((capacidad) => capacidad.categoria));
  const cadenciasPorCapacidad = Object.freeze(
    capacidades.map((capacidad, indice) => Object.freeze({ capacidadId: capacidadIds[indice], cadenciaSeg: capacidad.cadenciaSeg })),
  );

  return Object.freeze({
    id,
    nombre,
    descripcion,
    categorias,
    capacidadIds: Object.freeze([...capacidadIds]),
    capacidades: Object.freeze([...capacidades]),
    despiertaCon: eventos,
    cadenciaSeg: Math.min(...capacidades.map((capacidad) => capacidad.cadenciaSeg)),
    cadenciasPorCapacidad,
    modelo: Object.freeze({
      tipo: "composicion_de_capacidades",
      resumen: resumenModelo,
      modelosDeCapacidad: modelos,
      incluyeRazonamiento: capacidades.some((capacidad) => !esDeterminista(capacidad)),
      incluyeServiciosDeterministas: capacidades.some(esDeterminista),
    }),
  });
}

/**
 * Catálogo estable en el mismo orden que `IDS_AGENTES_CANONICOS`.
 * No se exporta un Agente sintético con `ciclo`: la ejecución sigue siendo de
 * las capacidades que ya existen, no de un mega-prompt del padre.
 */
export const AGENTES_LOGICOS: readonly AgenteLogico[] = Object.freeze([
  crearAgenteLogico(
    "observador",
    "Observador",
    "Detecta, reúne y verifica señales del terreno, sensores, avisos y fuentes abiertas.",
    "Percepción y verificación compuestas; conserva fuentes y verificación independientes.",
    [agenteVigiaCamaras, agenteSatelite, agentePrensaRedes, agenteCentralita, agenteMeteorologo, verificador],
  ),
  crearAgenteLogico(
    "planificador_operativo",
    "Planificador operativo",
    "Estima la evolución, prioriza la respuesta, protege población y prepara el despacho.",
    "Análisis operativo, planificación y despacho como capacidades coordinadas.",
    [analistaPropagacion, analistaPatrones, coordinador, proteccionPoblacion, despachador],
  ),
  crearAgenteLogico(
    "comunicador",
    "Comunicador",
    "Convierte el estado operativo en comunicaciones claras para población y sala.",
    "Comunicación pública a través de una única capacidad especializada.",
    [portavoz],
  ),
  crearAgenteLogico(
    "guardian",
    "Guardián",
    "Revisa legalidad, calidad y necesidad de escalado antes o después de las decisiones.",
    "Control legal y supervisión independiente, sin mezclar sus criterios.",
    [asesorLegal, supervisor],
  ),
  crearAgenteLogico(
    "cronista",
    "Cronista",
    "Aprende de resultados y redacta el relato operativo verificable de cada incidente.",
    "Memoria de aprendizaje e informes, conservando sus disparadores propios.",
    [agenteMemoria, redactor],
  ),
]);

const POR_ID = new Map(AGENTES_LOGICOS.map((agente) => [agente.id, agente]));

/** Obtiene el padre lógico; útil al traducir ids de la topología de cinco. */
export function agenteLogicoPorId(id: string): AgenteLogico | undefined {
  return POR_ID.get(id as IdAgenteCanonico);
}

/** Aplana un catálogo a las capacidades ejecutables, sin duplicar objetos por id. */
export function aplanarCapacidades(catalogo: readonly AgenteLogico[] = AGENTES_LOGICOS): readonly Agente[] {
  const porId = new Map<string, Agente>();
  for (const agente of catalogo) {
    for (const capacidad of agente.capacidades) {
      if (!porId.has(capacidad.id)) porId.set(capacidad.id, capacidad);
    }
  }
  return Object.freeze([...porId.values()]);
}

/** Aplana padre y capacidad juntos, para ejecutar una capacidad sin perder atribución. */
export function aplanarCapacidadesConPadre(catalogo: readonly AgenteLogico[] = AGENTES_LOGICOS): readonly CapacidadConPadre[] {
  const planas: CapacidadConPadre[] = [];
  for (const agente of catalogo) {
    agente.capacidades.forEach((capacidad, indice) => {
      planas.push(Object.freeze({ agente, agenteId: agente.id, capacidad, capacidadId: agente.capacidadIds[indice] }));
    });
  }
  return Object.freeze(planas);
}

/** Busca una capacidad plana por su id histórico. */
export function capacidadConPadrePorId(id: string, catalogo: readonly AgenteLogico[] = AGENTES_LOGICOS): CapacidadConPadre | undefined {
  return aplanarCapacidadesConPadre(catalogo).find((entrada) => entrada.capacidadId === id);
}

/** Invariante ligera: el catálogo debe cubrir exactamente los cinco padres definidos. */
export function esCatalogoLogicoCompleto(catalogo: readonly AgenteLogico[] = AGENTES_LOGICOS): boolean {
  return catalogo.length === IDS_AGENTES_CANONICOS.length && IDS_AGENTES_CANONICOS.every((id) => catalogo.some((agente) => agente.id === id));
}
