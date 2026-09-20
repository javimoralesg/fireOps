// =====================================================================
// ATALAYA INCENDIOS · La frontera entre el modelo y el mundo
// ---------------------------------------------------------------------
// Propósito: aquí vive el tipo `Plan` —lo que el coordinador le pide al
// LLM— y la conversión de ese Plan en acciones concretas sobre unidades y
// sectores. Esa conversión es DETERMINISTA y PURA: mismo Plan y mismo
// entorno, mismas acciones. No lee el estado vivo, no lo muta, no llama a
// nadie.
//
// Por qué existe como módulo propio (fase F0 de la migración): la costura
// ya estaba en el código, solo que en línea dentro de `planificarFoco`.
// `planAtaqueInicial()` ya construye un `Plan` a mano, sin LLM, y lo pasa
// por esta misma conversión en producción. Sacarla permite probar toda la
// lógica de despliegue sin proveedor de IA y sin inventar respuestas del
// modelo: se le pasa un `Plan`, que es un dato de su tipo declarado.
//
// Arriba de esta frontera (que el modelo devuelva un Plan sensato) solo se
// prueba en vivo, con invariantes. Abajo, con unitarias exactas.
// DUEÑO: constructor D. Dependencias: lib/simulacion/geometria.
// =====================================================================
import { z } from "zod";
import type { Incendio, Punto, Unidad } from "../../dominio/tipos";
import { alcanceEnRumbo, destino, normalizarGrados, radiosPorRumbo } from "../../simulacion/geometria";
import { RADIO_INICIAL_M, VERTICES } from "../../simulacion/propagacion";
import type { AccionPropuesta } from "./comun";

export const ESQUEMA_PLAN = z.object({
  titulo: z.string(),
  resumen: z.string(),
  razonamiento: z.string(),
  prioridad: z.number().int().min(1).max(5),
  riesgo: z.number().min(0).max(100),
  sectores: z.array(z.object({ nombre: z.string(), rumbo: z.enum(["cabeza", "flanco_derecho", "flanco_izquierdo", "cola"]), descripcion: z.string() })),
  despliegues: z.array(z.object({ unidadId: z.string(), sector: z.string(), motivo: z.string() })),
  reasignaciones: z.array(z.object({ unidadId: z.string(), sector: z.string(), motivo: z.string() })),
  retiradas: z.array(z.object({ unidadId: z.string(), motivo: z.string() })),
  mediosAereos: z.object({ solicitar: z.boolean(), tipo: z.string(), motivo: z.string() }),
  nivelPropuesto: z.number().int().min(0).max(3),
  motivoNivel: z.string(),
});

export type Plan = z.infer<typeof ESQUEMA_PLAN>;

/** Desviación de cada sector respecto al rumbo del frente. */
export const RUMBO_SECTOR: Record<Plan["sectores"][number]["rumbo"], number> = {
  cabeza: 0,
  flanco_derecho: 90,
  flanco_izquierdo: -90,
  cola: 180,
};

/** Punto de trabajo de un sector: sobre el perímetro actual, en el rumbo del sector. */
export function puntoDeSector(incendio: Incendio, rumboSector: number): Punto {
  const radios = radiosPorRumbo(incendio.centro, incendio.perimetro, VERTICES, RADIO_INICIAL_M);
  const alcance = alcanceEnRumbo(radios, rumboSector);
  // 150 m por fuera del perímetro: se trabaja desde el borde, no dentro del fuego.
  return destino(incendio.centro, rumboSector, (alcance + 150) / 1000);
}

/**
 * Todo lo que la conversión necesita saber del mundo, ya resuelto por quien
 * la llama. Se pasa como dato para que la función no toque el estado vivo.
 */
export interface EntornoPlan {
  incendio: Incendio;
  /** Unidades del mundo por id. Solo se leen. */
  unidades: ReadonlyMap<string, Unidad>;
  /** Tiempos reales por carretera (OSRM) ya calculados para las candidatas. */
  candidatas: readonly { unidadId: string; minutosCarretera?: number }[];
  /** Unidades que ya tiene comprometidas una decisión viva: no se piden dos veces. */
  unidadesComprometidas: ReadonlySet<string>;
  /** ¿Hay ya una decisión viva pidiendo medios aéreos? */
  hayMediosAereosVivos: boolean;
  /** ¿Hay ya una decisión viva proponiendo elevar el nivel? */
  hayElevarNivelVivo: boolean;
  /** Marca el despliegue como ataque inicial (lo lee la política del orquestador). */
  ataqueInicial: boolean;
}

export interface AccionesDelPlan {
  /** Sectores con su rumbo absoluto, para pintarlos en el mapa. */
  sectores: { nombre: string; rumboGrados: number }[];
  /** Decisión 1: llevar medios al foco. */
  despliegue: AccionPropuesta[];
  /** Decisión 2: nivel de gravedad y retiradas por seguridad. */
  mando: AccionPropuesta[];
}

/**
 * Convierte un `Plan` en las acciones que se van a proponer. Pura y total:
 * ignora en silencio lo que no se puede ejecutar (una unidad que ya no está
 * disponible, una retirada de una unidad que no es de este foco), porque el
 * modelo puede nombrar cosas que dejaron de ser ciertas mientras pensaba.
 */
export function accionesDelPlan(plan: Plan, entorno: EntornoPlan): AccionesDelPlan {
  const { incendio, unidades, candidatas, unidadesComprometidas, ataqueInicial } = entorno;
  const rumboFrente = incendio.frente?.rumboGrados ?? 0;

  const sectores = plan.sectores.map((s) => ({
    nombre: s.nombre,
    rumboGrados: +normalizarGrados(rumboFrente + RUMBO_SECTOR[s.rumbo]).toFixed(0),
  }));

  const rumboDeSector = (nombre: string): number => {
    const s = plan.sectores.find((x) => x.nombre === nombre);
    return normalizarGrados(rumboFrente + RUMBO_SECTOR[s?.rumbo ?? "cabeza"]);
  };

  // ---- Decisión 1: despliegue (+ medios aéreos) ----
  const despliegue: AccionPropuesta[] = [];
  for (const d of plan.despliegues) {
    const unidad = unidades.get(d.unidadId);
    if (!unidad || unidad.estado !== "disponible") continue;
    if (unidadesComprometidas.has(d.unidadId)) continue;
    const rumboSector = rumboDeSector(d.sector);
    const candidata = candidatas.find((c) => c.unidadId === d.unidadId);
    despliegue.push({
      tipo: "desplegar_unidad",
      descripcion: `Enviar ${unidad.nombre} al sector ${d.sector} de ${incendio.nombre}${candidata?.minutosCarretera !== undefined ? ` (${candidata.minutosCarretera} min por carretera)` : ""}`,
      objetivo: { unidadId: unidad.id },
      parametros: {
        sector: d.sector,
        destino: puntoDeSector(incendio, rumboSector),
        incendioId: incendio.id,
        motivo: d.motivo,
        minutosCarretera: candidata?.minutosCarretera,
        ataqueInicial,
      },
    });
  }
  for (const r of plan.reasignaciones) {
    const unidad = unidades.get(r.unidadId);
    if (!unidad || unidad.incendioId === incendio.id) continue;
    despliegue.push({
      tipo: "reasignar_unidad",
      descripcion: `Reasignar ${unidad.nombre} al sector ${r.sector} de ${incendio.nombre}`,
      objetivo: { unidadId: unidad.id },
      parametros: { sector: r.sector, destino: puntoDeSector(incendio, rumboDeSector(r.sector)), incendioId: incendio.id, motivo: r.motivo, desdeIncendioId: unidad.incendioId },
    });
  }
  if (plan.mediosAereos.solicitar && !entorno.hayMediosAereosVivos) {
    despliegue.push({
      tipo: "solicitar_medios_aereos",
      descripcion: `Solicitar medios aéreos (${plan.mediosAereos.tipo}) para ${incendio.nombre}`,
      parametros: { tipo: plan.mediosAereos.tipo, motivo: plan.mediosAereos.motivo, incendioId: incendio.id, organismo: `Operativo de incendios de ${incendio.comunidad || "la comunidad autónoma"}` },
    });
  }

  // ---- Decisión 2: nivel de gravedad, o retiradas por seguridad ----
  const mando: AccionPropuesta[] = [];
  if (plan.nivelPropuesto > incendio.nivelGravedad && !entorno.hayElevarNivelVivo) {
    mando.push({
      tipo: "elevar_nivel",
      descripcion: `Proponer al director del plan elevar ${incendio.nombre} a nivel ${plan.nivelPropuesto}`,
      parametros: { nivel: plan.nivelPropuesto, motivo: plan.motivoNivel, incendioId: incendio.id },
    });
  }
  for (const r of plan.retiradas) {
    const unidad = unidades.get(r.unidadId);
    if (!unidad || unidad.incendioId !== incendio.id) continue;
    mando.push({
      tipo: "retirar_unidad",
      descripcion: `Retirar ${unidad.nombre} a zona segura`,
      objetivo: { unidadId: unidad.id },
      parametros: { motivo: r.motivo, incendioId: incendio.id },
    });
  }

  return { sectores, despliegue, mando };
}
