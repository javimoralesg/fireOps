// Ayudas de presentación sobre el catálogo de roles. La matriz de permisos vive
// SOLO en lib/roles.ts (poc-18); aquí no se duplica, solo se adapta para la UI.

import { escalarA, puede, puedeDecidir, ROL_LEGADO, ROLES, type RolId } from "./roles";

export { escalarA, puede, puedeDecidir };

/**
 * Nombre del puesto para un rol que puede venir del servidor en formato nuevo
 * (RolId) o antiguo ("alcalde", "director_emergencias"…). Si no se reconoce,
 * se devuelve tal cual en vez de inventar un rol.
 */
export function etiquetaRol(valor: string | null | undefined): string {
  if (!valor) return "—";
  if (valor in ROLES) return ROLES[valor as RolId].nombre;
  if (valor in ROL_LEGADO) return ROLES[ROL_LEGADO[valor]].nombre;
  return valor;
}

/** Riesgo máximo que puede firmar el rol (0 = no firma decisiones). */
export function limiteRiesgo(rol: RolId): number {
  return puede(rol, "decidir") ? ROLES[rol].riesgoMaxDecision : 0;
}
