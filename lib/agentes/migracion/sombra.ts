import type { Leccion, Snapshot } from "../../dominio/tipos";
import type { ResultadoCiclo } from "../../motor/contratos";

export type SoloLecturaProfunda<T> =
  T extends (...args: never[]) => unknown ? T
    : T extends readonly (infer U)[] ? readonly SoloLecturaProfunda<U>[]
      : T extends object ? { readonly [K in keyof T]: SoloLecturaProfunda<T[K]> }
        : T;

export interface ContextoSombra {
  /** Copia profunda: nunca es la referencia cacheada del Estado vivo. */
  readonly snapshot: SoloLecturaProfunda<Snapshot>;
  readonly ahoraMundo: string;
  readonly minutosMundoDesdeUltimoCiclo: number;
  readonly lecciones: readonly SoloLecturaProfunda<Leccion>[];
  readonly abortSignal: AbortSignal;
}

export interface CapacidadSombra {
  readonly agenteLogicoId: string;
  readonly capacidadId: string;
  /**
   * No recibe Estado, registrar, informarTarea ni un ejecutor. Por contrato no
   * puede persistir ni disparar efectos; solo devuelve propuestas.
   */
  evaluar(ctx: ContextoSombra): Promise<ResultadoCiclo | void>;
}

export interface PlanCandidato {
  readonly tipo: "plan_candidato";
  readonly agenteLogicoId: string;
  readonly capacidadId: string;
  readonly aplicable: false;
  readonly snapshotVersion: number;
  readonly creadoEnMundo: string;
  readonly resultado: SoloLecturaProfunda<ResultadoCiclo>;
}

function congelar<T>(valor: T, vistos = new WeakSet<object>()): SoloLecturaProfunda<T> {
  if (valor === null || typeof valor !== "object") return valor as SoloLecturaProfunda<T>;
  const objeto = valor as object;
  if (vistos.has(objeto)) return valor as SoloLecturaProfunda<T>;
  vistos.add(objeto);
  for (const hijo of Object.values(valor as Record<string, unknown>)) congelar(hijo, vistos);
  return Object.freeze(valor) as SoloLecturaProfunda<T>;
}

/** Clona antes de congelar para no congelar referencias pertenecientes al Estado. */
export function snapshotInmutable(snapshot: Snapshot): SoloLecturaProfunda<Snapshot> {
  return congelar(structuredClone(snapshot));
}

/** Ejecuta una capacidad aislada y devuelve una propuesta que no puede aplicarse. */
export async function ejecutarEnSombra(
  capacidad: CapacidadSombra,
  snapshot: Snapshot,
  opciones: {
    minutosMundoDesdeUltimoCiclo?: number;
    lecciones?: Leccion[];
    abortSignal?: AbortSignal;
  } = {},
): Promise<SoloLecturaProfunda<PlanCandidato>> {
  const copia = snapshotInmutable(snapshot);
  const abortSignal = opciones.abortSignal ?? new AbortController().signal;
  const lecciones = congelar(structuredClone(opciones.lecciones ?? snapshot.lecciones));
  const resultado = (await capacidad.evaluar({
    snapshot: copia,
    ahoraMundo: copia.reloj.ahoraMundo,
    minutosMundoDesdeUltimoCiclo: opciones.minutosMundoDesdeUltimoCiclo ?? 0,
    lecciones,
    abortSignal,
  })) ?? {};

  return congelar({
    tipo: "plan_candidato" as const,
    agenteLogicoId: capacidad.agenteLogicoId,
    capacidadId: capacidad.capacidadId,
    aplicable: false as const,
    snapshotVersion: copia.version,
    creadoEnMundo: copia.reloj.ahoraMundo,
    resultado: structuredClone(resultado),
  });
}

