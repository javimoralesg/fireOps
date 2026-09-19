/**
 * Identidad estable durante la migración de 16 agentes a 5.
 *
 * Los ids antiguos siguen siendo los ids de capacidad: sirven para atribuir
 * históricos y para abrir enlaces guardados. Los ids canónicos identifican al
 * agente lógico que será dueño de esas capacidades tras el cambio de topología.
 * Este módulo no modifica el registro ni el orquestador.
 */

export const IDS_AGENTES_CANONICOS = [
  "observador",
  "planificador_operativo",
  "comunicador",
  "guardian",
  "cronista",
] as const;

export type IdAgenteCanonico = (typeof IDS_AGENTES_CANONICOS)[number];

export const CAPACIDADES_POR_AGENTE = {
  observador: ["vigia_camaras", "satelite", "prensa_redes", "centralita", "meteorologo", "verificador"],
  planificador_operativo: ["propagacion", "patrones", "coordinador", "proteccion_poblacion", "despachador"],
  comunicador: ["portavoz"],
  guardian: ["asesor_legal", "supervisor"],
  cronista: ["memoria", "redactor"],
} as const satisfies Record<IdAgenteCanonico, readonly string[]>;

export type IdAgenteLegacy = (typeof CAPACIDADES_POR_AGENTE)[IdAgenteCanonico][number];

export const AGENTE_CANONICO_POR_LEGACY: Readonly<Record<IdAgenteLegacy, IdAgenteCanonico>> = Object.freeze(
  Object.fromEntries(
    Object.entries(CAPACIDADES_POR_AGENTE).flatMap(([agenteId, capacidades]) =>
      capacidades.map((capacidadId) => [capacidadId, agenteId]),
    ),
  ) as Record<IdAgenteLegacy, IdAgenteCanonico>,
);

const idsCanonicos = new Set<string>(IDS_AGENTES_CANONICOS);

export interface IdentidadAgente {
  /** Id lógico estable del agente en la topología de cinco. */
  agenteId: IdAgenteCanonico;
  /** Id de la capacidad antigua; ausente si se pidió directamente el agente. */
  capacidadId?: IdAgenteLegacy;
  /** Id recibido de una URL, filtro o registro histórico. */
  solicitadoId: string;
  esAlias: boolean;
}

export function esIdAgenteCanonico(id: string): id is IdAgenteCanonico {
  return idsCanonicos.has(id);
}

export function esIdAgenteLegacy(id: string): id is IdAgenteLegacy {
  return Object.hasOwn(AGENTE_CANONICO_POR_LEGACY, id);
}

/** Resuelve identidad semántica sin asumir qué topología está activa. */
export function resolverIdentidadAgente(id: string): IdentidadAgente | undefined {
  if (esIdAgenteCanonico(id)) return { agenteId: id, solicitadoId: id, esAlias: false };
  if (!esIdAgenteLegacy(id)) return undefined;
  return {
    agenteId: AGENTE_CANONICO_POR_LEGACY[id],
    capacidadId: id,
    solicitadoId: id,
    esAlias: true,
  };
}

export function agenteCanonicoDe(id: string): IdAgenteCanonico | undefined {
  return resolverIdentidadAgente(id)?.agenteId;
}

export function capacidadDeAgente(id: string): IdAgenteLegacy | undefined {
  return resolverIdentidadAgente(id)?.capacidadId;
}

/**
 * Ids que pueden aparecer en datos históricos pertenecientes al agente lógico.
 * Incluye siempre el id canónico para que funcione durante una migración viva.
 */
export function idsHistoricosDeAgente(id: string): readonly string[] {
  const identidad = resolverIdentidadAgente(id);
  if (!identidad) return [id];
  return [identidad.agenteId, ...CAPACIDADES_POR_AGENTE[identidad.agenteId]];
}

export function perteneceAlMismoAgente(idRegistrado: string | undefined, idSolicitado: string): boolean {
  if (!idRegistrado) return false;
  const solicitado = resolverIdentidadAgente(idSolicitado);
  const registrado = resolverIdentidadAgente(idRegistrado);
  if (!solicitado || !registrado) return idRegistrado === idSolicitado;
  return solicitado.agenteId === registrado.agenteId;
}

interface ConId {
  id: string;
}

/**
 * Busca la ficha operativa sin anticipar el corte:
 * 1. gana el id exacto (topología actual de 16);
 * 2. un alias antiguo cae al agente canónico (topología futura de 5).
 *
 * Deliberadamente no elige una capacidad arbitraria cuando se pide un id
 * canónico y todavía solo existen las 16 fichas.
 */
export function buscarAgenteCompatible<T extends ConId>(agentes: readonly T[], solicitadoId: string): T | undefined {
  const exacto = agentes.find((agente) => agente.id === solicitadoId);
  if (exacto) return exacto;
  const canonico = agenteCanonicoDe(solicitadoId);
  return canonico ? agentes.find((agente) => agente.id === canonico) : undefined;
}

/**
 * Resuelve la clave con la que una ficha está registrada en el estado vivo.
 * Conserva la precedencia del id exacto para la topología de 16 y solo usa el
 * padre canónico cuando la capacidad histórica ya no tiene ficha propia.
 */
export function resolverIdAgenteCompatible<T extends ConId>(agentes: ReadonlyMap<string, T>, solicitadoId: string): string | undefined {
  if (agentes.has(solicitadoId)) return solicitadoId;
  const canonico = agenteCanonicoDe(solicitadoId);
  return canonico && agentes.has(canonico) ? canonico : undefined;
}

/** Busca una ficha del estado vivo aceptando aliases históricos de capacidad. */
export function buscarAgenteCompatibleEnMapa<T extends ConId>(agentes: ReadonlyMap<string, T>, solicitadoId: string): T | undefined {
  const id = resolverIdAgenteCompatible(agentes, solicitadoId);
  return id ? agentes.get(id) : undefined;
}
