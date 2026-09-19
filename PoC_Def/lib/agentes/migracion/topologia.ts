/** Topologías disponibles durante la migración de agentes. */
export const TOPOLOGIAS_AGENTES = ["legacy", "shadow", "five"] as const;

export type TopologiaAgentes = (typeof TOPOLOGIAS_AGENTES)[number];

export interface SeleccionTopologia {
  /** Topología que puede mutar estado y producir efectos externos. */
  autoridad: "legacy" | "five";
  /** Ejecuta también la topología de cinco, pero solo como plan candidato. */
  ejecutarSombra: boolean;
}

/**
 * Lee AGENT_TOPOLOGY de forma estricta. La ausencia conserva el comportamiento
 * actual; un typo falla al arrancar en vez de activar accidentalmente otra
 * topología.
 */
export function leerTopologiaAgentes(valor = process.env.AGENT_TOPOLOGY): TopologiaAgentes {
  const normalizado = valor?.trim().toLowerCase();
  if (!normalizado) return "legacy";
  if ((TOPOLOGIAS_AGENTES as readonly string[]).includes(normalizado)) {
    return normalizado as TopologiaAgentes;
  }
  throw new Error(`AGENT_TOPOLOGY inválida: "${valor}". Valores permitidos: ${TOPOLOGIAS_AGENTES.join(", ")}`);
}

/** Traduce el flag de despliegue a autoridad y ejecución paralela. */
export function seleccionarTopologia(topologia = leerTopologiaAgentes()): SeleccionTopologia {
  switch (topologia) {
    case "legacy":
      return { autoridad: "legacy", ejecutarSombra: false };
    case "shadow":
      return { autoridad: "legacy", ejecutarSombra: true };
    case "five":
      return { autoridad: "five", ejecutarSombra: false };
  }
}

