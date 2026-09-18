// Autorización por rol (demo sin autenticación real): la UI declara el rol en la
// cabecera x-atalaya-rol (o en body.rol); la matriz de permisos vive en lib/roles.ts.

import { CABECERA_ROL, ROLES, ROLES_LISTA, escalarA, normalizarRol, puede, puedeDecidir, type Permiso, type RolId } from "../roles";
import { puedeFirmar, type VeredictoCompetencia } from "../politica-autonomia";

export function rolDe(req: Request, cuerpo?: { rol?: unknown }): RolId {
  const cab = req.headers.get(CABECERA_ROL);
  const body = typeof cuerpo?.rol === "string" ? cuerpo.rol : undefined;
  return normalizarRol(cab || body);
}

/** Rol con menos autoridad que tiene el permiso (para "Escalar a…" en la UI). */
function rolMinimoCon(permiso: Permiso): RolId {
  const orden: RolId[] = ["operador_112", "coordinador_voluntariado", "jefe_sala_112", "jefe_pma", "gabinete_informacion", "comite_asesor", "enlace_delegacion", "director_tecnico", "administrador", "director_plan"];
  return orden.find((r) => puede(r, permiso)) ?? ROLES_LISTA.find((r) => puede(r.id, permiso))?.id ?? "director_plan";
}

function prohibido(error: string, permiso: Permiso, riesgo?: number, destinoExplicito?: RolId) {
  const destino = destinoExplicito ?? (permiso === "decidir" ? escalarA(riesgo ?? 0) : rolMinimoCon(permiso));
  return Response.json({ error, permiso, escalarA: destino }, { status: 403, headers: { "cache-control": "no-store" } });
}

/** Devuelve null si el rol tiene el permiso; si no, la Response 403 ya construida. */
export function exigir(rol: RolId, ...permisos: Permiso[]): Response | null {
  if (permisos.some((p) => puede(rol, p))) return null;
  return prohibido(`El rol ${rol} no tiene el permiso ${permisos.join(" o ")}`, permisos[0]);
}

/** Aprobar / denegar: exige "decidir", riesgo ≤ máximo del rol y, si hay veredicto de política, la firma mínima de la categoría. */
export function exigirDecidir(rol: RolId, riesgo: number, competencia?: VeredictoCompetencia | null): Response | null {
  if (competencia) {
    if (puedeFirmar(rol, competencia)) return null;
    if (puedeDecidir(rol, competencia.riesgoEfectivo) && competencia.firmaMinima) {
      return prohibido(`Esta decisión (${competencia.categoriaDominante ?? "sin categoría"}) exige la firma de ${ROLES[competencia.firmaMinima].nombre} como mínimo.`, "decidir", competencia.riesgoEfectivo, competencia.firmaMinima);
    }
  }
  if (puedeDecidir(rol, riesgo)) return null;
  const necesita = escalarA(riesgo);
  return prohibido(
    puede(rol, "decidir") ? `El rol ${rol} solo puede decidir hasta riesgo ${riesgoMax(rol)}; esta decisión tiene ${riesgo}. Escalar a ${necesita}.` : `El rol ${rol} no puede aprobar ni denegar decisiones. Escalar a ${necesita}.`,
    "decidir",
    riesgo,
  );
}

const riesgoMax = (rol: RolId) => ROLES[rol].riesgoMaxDecision;
