// =====================================================================
// ATALAYA INCENDIOS · Utilidades comunes de planificación
// ---------------------------------------------------------------------
// Propósito: todo lo que comparten el coordinador, la protección de
// población, el asesor legal, el analista de patrones y el portavoz:
// construir una Decision bien formada, inyectar las lecciones aprendidas
// y las decisiones previas del mismo incendio, y evitar duplicados.
// DUEÑO: constructor D. Sin dependencias externas.
// =====================================================================
import type { Accion, Decision, Evidencia, Incendio, ModoCompetencia, TipoAccion } from "../../dominio/tipos";
import type { ContextoAgente } from "../../motor/contratos";
import { evaluarCompetencia } from "../../dominio/politica";
import { nuevoId } from "../../motor/ids";

/** Acción tal y como la escribe un agente: sin id ni estado. */
export interface AccionPropuesta {
  tipo: TipoAccion;
  descripcion: string;
  objetivo?: Accion["objetivo"];
  parametros?: Record<string, unknown>;
}

export interface BorradorDecision {
  agenteId: string;
  titulo: string;
  resumen: string;
  razonamiento: string;
  prioridad: Decision["prioridad"];
  riesgo: number;
  acciones: AccionPropuesta[];
  evidencias?: Evidencia[];
  incendioId?: string;
  clusterId?: string;
  sustituyeA?: string;
  motivoReplanificacion?: string;
  leccionesAplicadas?: Decision["leccionesAplicadas"];
  decisionesPrevias?: string[];
}

/** Convierte una acción propuesta en una Accion del dominio. */
export function materializarAccion(a: AccionPropuesta): Accion {
  return {
    id: nuevoId("acc"),
    tipo: a.tipo,
    descripcion: a.descripcion,
    objetivo: a.objetivo,
    parametros: a.parametros ?? {},
    estado: "pendiente",
  };
}

/**
 * Crea una Decision completa y ya evaluada por la política de autonomía.
 * El orquestador la volverá a pasar por `evaluarCompetencia` (por si la
 * política cambió entre medias); aquí se deja rellena para que la pantalla
 * muestre el modo correcto desde el primer instante.
 */
export function decisionBase(ctx: ContextoAgente, b: BorradorDecision): Decision {
  const acciones = b.acciones.map(materializarAccion);
  const incendio = b.incendioId ? ctx.estado.incendios.get(b.incendioId) : undefined;
  const borrador: Decision = {
    id: nuevoId("dec"),
    ejecucionId: ctx.estado.ejecucion.id,
    agenteId: b.agenteId,
    incendioId: b.incendioId,
    clusterId: b.clusterId,
    titulo: b.titulo,
    resumen: b.resumen,
    razonamiento: b.razonamiento,
    prioridad: b.prioridad,
    riesgo: Math.max(0, Math.min(100, Math.round(b.riesgo))),
    competencia: "autonoma",
    estado: "propuesta",
    acciones,
    evidencias: b.evidencias ?? [],
    fundamentos: [],
    leccionesAplicadas: b.leccionesAplicadas ?? ctx.lecciones.slice(0, 3).map((l) => ({ leccionId: l.id, texto: l.texto })),
    decisionesPrevias: b.decisionesPrevias,
    sustituyeA: b.sustituyeA,
    motivoReplanificacion: b.motivoReplanificacion,
    creadaEn: new Date().toISOString(),
    creadaEnMundo: ctx.ahoraMundo,
  };
  const { competencia, riesgo } = evaluarCompetencia(borrador, ctx.estado.politica, incendio);
  return { ...borrador, competencia: competencia as ModoCompetencia, riesgo };
}

/** Bloque de lecciones para inyectar en el prompt (vacío si no hay ninguna). */
export function bloqueLecciones(ctx: ContextoAgente): string {
  if (!ctx.lecciones.length) return "";
  return (
    "\n\nLecciones de ejecuciones anteriores que DEBES tener en cuenta:\n" +
    ctx.lecciones
      .slice(0, 6)
      .map((l) => `- [${l.categoria}] ${l.texto}${l.cambio ? ` → ${l.cambio}` : ""}`)
      .join("\n")
  );
}

/** Estados de decisión que siguen "vivos" (no se debe duplicar lo que hay en marcha). */
export const ESTADOS_VIVOS: Decision["estado"][] = ["propuesta", "pendiente_humano", "aprobada", "ejecutando", "escalada"];

/**
 * Resumen de las decisiones anteriores del mismo incendio, para que el
 * planificador no repita ni se contradiga. Una línea por decisión.
 */
export function bloqueDecisionesPrevias(ctx: ContextoAgente, incendioId: string, maximo = 8): { texto: string; ids: string[] } {
  const previas = ctx.estado.decisionesDe(incendioId).slice(-maximo);
  if (!previas.length) return { texto: "\n\nNo hay decisiones previas sobre este incendio: es la primera.", ids: [] };
  const lineas = previas.map(
    (d) =>
      `- [${d.estado}${d.decididaPor ? ` por ${d.decididaPor}` : ""}] ${d.titulo} · acciones: ${d.acciones.map((a) => a.tipo).join(", ")}` +
      (d.comentarioHumano ? ` · comentario humano: "${d.comentarioHumano}"` : ""),
  );
  return {
    texto:
      "\n\nDecisiones YA tomadas sobre este incendio (no las repitas ni las contradigas; si hace falta cambiar una, " +
      "propón la sustitución explicando el motivo):\n" + lineas.join("\n"),
    ids: previas.map((d) => d.id),
  };
}

/**
 * ¿Ya hay una decisión viva de este agente con las mismas acciones sobre el
 * mismo objetivo? Evita que el coordinador pida dos veces la misma unidad.
 */
export function hayEquivalenteViva(
  ctx: ContextoAgente,
  agenteId: string,
  incendioId: string | undefined,
  tipo: TipoAccion,
  clave?: string,
): boolean {
  return [...ctx.estado.decisiones.values()].some(
    (d) =>
      d.agenteId === agenteId &&
      d.incendioId === incendioId &&
      ESTADOS_VIVOS.includes(d.estado) &&
      d.acciones.some(
        (a) =>
          a.tipo === tipo &&
          (!clave || a.objetivo?.unidadId === clave || a.objetivo?.poblacionId === clave || a.parametros?.clave === clave),
      ),
  );
}

/**
 * Marca como "caducada" toda decisión pendiente del agente sobre un incendio
 * que ha quedado obsoleta por una replanificación.
 */
export function caducarPendientes(ctx: ContextoAgente, agenteId: string, incendioId: string, motivo: string, salvo?: string[]): string[] {
  const caducadas: string[] = [];
  for (const d of ctx.estado.decisiones.values()) {
    if (d.agenteId !== agenteId || d.incendioId !== incendioId) continue;
    if (salvo?.includes(d.id)) continue;
    if (d.estado !== "propuesta" && d.estado !== "pendiente_humano" && d.estado !== "escalada") continue;
    ctx.estado.actualizar(ctx.estado.decisiones, d.id, { estado: "caducada", comentarioHumano: d.comentarioHumano, decididaEn: new Date().toISOString(), decididaPor: `ia:${agenteId}` });
    caducadas.push(d.id);
    ctx.registrar("agente", `Decisión "${d.titulo}" caducada: ${motivo}`, { incendioId, nivel: "aviso", datos: { decisionId: d.id } });
  }
  return caducadas;
}

/** Ficha corta de un incendio para los prompts. */
export function fichaIncendio(i: Incendio): string {
  return [
    `Incendio: ${i.nombre} (id ${i.id})`,
    `Lugar: ${i.municipio || "?"}, ${i.provincia || "?"}, ${i.comunidad || "?"} · centro ${i.centro.lat.toFixed(4)}, ${i.centro.lon.toFixed(4)}`,
    `Estado: ${i.estado} · nivel de gravedad ${i.nivelGravedad} · ${i.areaHa.toFixed(1)} ha · confianza ${i.confianza.toFixed(2)}`,
    i.meteo
      ? `Meteo: ${i.meteo.temperaturaC.toFixed(0)} °C, HR ${i.meteo.humedadPct.toFixed(0)} %, viento ${i.meteo.vientoKmh.toFixed(0)} km/h del ${i.meteo.direccionTexto} (rachas ${i.meteo.rachasKmh.toFixed(0)})`
      : "Meteo: todavía sin datos",
    i.peligro ? `Índice de peligro: ${i.peligro.valor} (${i.peligro.nivel}) — ${i.peligro.motivo}` : "",
    i.frente ? `Frente: avanza al ${i.frente.rumboTexto} a ${i.frente.velocidadMmin.toFixed(1)} m/min` : "",
    i.combustible ? `Combustible dominante: ${i.combustible.dominante}` : "",
    i.pendientePct !== undefined ? `Pendiente media: ${i.pendientePct.toFixed(0)} %` : "",
    i.prediccion ? `Predicción: ${i.prediccion.explicacion}` : "",
    i.notas ? `Notas del mando: ${i.notas}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Doctrina común de mando de incendios forestales en España para los prompts. */
export const DOCTRINA_ESPANA = `
Contexto normativo y operativo español que debes respetar:
- Los incendios forestales se clasifican en NIVELES de gravedad potencial 0 a 3 (Directriz Básica, RD 893/2013):
  0 = se prevé controlar con los medios ordinarios, sin riesgo para personas ni bienes no forestales;
  1 = se puede prever amenaza a personas o bienes no forestales;
  2 = amenaza seria a poblaciones o bienes de importancia, o se precisan medios extraordinarios;
  3 = interés nacional (lo declara el Ministerio del Interior).
- Quien manda en el incendio es el DIRECTOR DE EXTINCIÓN en el terreno; el DIRECTOR DEL PLAN (autoridad
  autonómica) es quien puede ordenar CONFINAMIENTO y EVACUACIÓN de población y quien eleva el nivel.
  Esta sala PROPONE; la orden la firma el director del plan. Dilo así en el razonamiento.
- El puesto de mando avanzado (PMA) coordina en zona; el dispositivo se organiza en SECTORES
  (A = cabeza del frente, B = flanco derecho, C = flanco izquierdo, D = cola/remate) con un jefe por sector.
- Prioridad absoluta e innegociable: 1) vidas humanas (población y personal de extinción),
  2) viviendas y bienes esenciales, 3) masa forestal y patrimonio natural.
- Seguridad del personal: nunca se deja una unidad en la trayectoria del frente ni en fondo de valle o
  ladera ascendente por delante del fuego; si el viento rola sobre ellas, se retiran a zona segura.
- Los medios aéreos tienen ventana operativa diurna (orto-ocaso) y se piden al organismo competente
  de la comunidad autónoma o, para medios estatales, al MITECO a través del CECOP.
`.trim();
