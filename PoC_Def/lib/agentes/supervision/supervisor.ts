// =====================================================================
// ATALAYA INCENDIOS · Supervisor de calidad
// ---------------------------------------------------------------------
// DUEÑO: constructor C.
// Dos trabajos distintos:
//   1. `evaluarDecision(d, ctx)` — lo llama el núcleo (A) de forma SÍNCRONA
//      dentro del pipeline de cada decisión propuesta. Puntúa seis criterios
//      con el modelo de razonamiento y decide si puede ejecutarse sin humano.
//   2. El ciclo periódico del agente vigila a los demás agentes: errores
//      encadenados y agentes que llevan demasiado tiempo callados. Si uno
//      acumula 5 errores seguidos, lo PAUSA y avisa: un agente roto que sigue
//      proponiendo es peor que un agente parado.
//
// Si no hay proveedor de IA, `evaluarDecision` lanza error: el núcleo lo verá
// y la decisión irá al humano. Nunca se aprueba algo con una nota inventada.
// =====================================================================

import { z } from "zod";
import type { Agente, ContextoAgente, ResultadoCiclo } from "../../motor/contratos";
import type { Decision, EstadoAgenteApp, EvaluacionSupervisor } from "../../dominio/tipos";
import { completarJson, modeloPara } from "../../ia/llm";

/** Nota mínima de cada criterio: por debajo, la decisión se escala aunque la media salve. */
const MINIMO_POR_CRITERIO = Number(process.env.SUPERVISOR_MINIMO_CRITERIO ?? 40);
const ERRORES_PARA_AVISO = 3;
const ERRORES_PARA_PAUSA = 5;

const CRITERIOS = [
  { nombre: "fundamentación", pregunta: "¿Se apoya en evidencias reales y en fundamentos legales citados, o es una corazonada?" },
  { nombre: "prioridad", pregunta: "¿Va primero lo que amenaza a personas? ¿El orden entre focos y pueblos es el correcto?" },
  { nombre: "coherencia", pregunta: "¿Encaja con la meteorología, el rumbo del frente y los medios realmente disponibles?" },
  { nombre: "legalidad", pregunta: "¿Puede la IA ordenar esto según los fundamentos y la política de autonomía, o es competencia de una autoridad?" },
  { nombre: "claridad", pregunta: "¿Entendería un mando en 10 segundos qué se va a hacer y por qué?" },
  { nombre: "proporcionalidad", pregunta: "¿La medida es proporcionada al riesgo, sin quedarse corta ni desbordar recursos?" },
] as const;

const EsquemaEvaluacion = z.object({
  criterios: z.array(z.object({ nombre: z.string(), puntuacion: z.number(), comentario: z.string() })),
  puntuacion: z.number(),
  motivoEscalado: z.string(),
});

// ---------------------------------------------------------------------
// Evaluación de una decisión
// ---------------------------------------------------------------------

function describirDecision(d: Decision, ctx: ContextoAgente): string {
  const incendio = d.incendioId ? ctx.snapshot.incendios.find((i) => i.id === d.incendioId) : undefined;
  const poblaciones = d.incendioId ? ctx.snapshot.poblaciones.filter((p) => p.incendioId === d.incendioId) : [];
  const unidades = d.incendioId ? ctx.snapshot.unidades.filter((u) => u.incendioId === d.incendioId) : [];
  const previas = d.incendioId
    ? ctx.snapshot.decisiones.filter((x) => x.incendioId === d.incendioId && x.id !== d.id).slice(-4)
    : [];

  return [
    `DECISIÓN PROPUESTA por el agente "${d.agenteId}"`,
    `Título: ${d.titulo}`,
    `Resumen: ${d.resumen}`,
    `Razonamiento del agente: ${d.razonamiento}`,
    `Prioridad declarada: ${d.prioridad} (1 = máxima). Competencia asignada por política: ${d.competencia}. Riesgo: ${d.riesgo}/100.`,
    `Acciones (${d.acciones.length}): ${d.acciones.map((a) => `${a.tipo} — ${a.descripcion}`).join("; ") || "ninguna"}`,
    d.alertasLegales?.length ? `ALERTAS LEGALES del asesor: ${d.alertasLegales.join("; ")}` : "",
    `Evidencias (${d.evidencias.length}): ${d.evidencias.map((e) => `${e.fuente}: ${e.resumen}`).join(" | ") || "NINGUNA"}`,
    `Fundamentos legales (${d.fundamentos.length}): ${d.fundamentos.map((f) => `[${f.documento} §${f.seccion ?? "—"}] ${f.cita}`).join(" | ") || "NINGUNO"}`,
    incendio
      ? `INCENDIO: ${incendio.nombre} (${incendio.municipio}, ${incendio.provincia}), estado ${incendio.estado}, nivel ${incendio.nivelGravedad}, ` +
        `${incendio.areaHa.toFixed(0)} ha. Meteo: ${incendio.meteo ? `${incendio.meteo.vientoKmh} km/h del ${incendio.meteo.direccionTexto}, rachas ${incendio.meteo.rachasKmh}, ${incendio.meteo.humedadPct}% HR` : "sin datos"}. ` +
        `Peligro: ${incendio.peligro ? `${incendio.peligro.nivel} (${incendio.peligro.valor})` : "sin datos"}. ` +
        `Frente: ${incendio.frente ? `rumbo ${incendio.frente.rumboTexto} a ${incendio.frente.velocidadMmin.toFixed(1)} m/min` : "sin calcular"}.`
      : "Sin incendio asociado.",
    poblaciones.length
      ? `POBLACIONES: ${poblaciones
          .slice(0, 8)
          .map((p) => `${p.nombre} (${p.riesgo}, ${p.distanciaKm.toFixed(1)} km, ETA ${p.etaFrenteMin ?? "—"} min, ${p.estadoAviso})`)
          .join("; ")}`
      : "",
    unidades.length
      ? `MEDIOS: ${unidades.slice(0, 10).map((u) => `${u.nombre} [${u.tipo}, ${u.estado}]`).join("; ")}`
      : "Sin medios asignados a este incendio.",
    previas.length
      ? `DECISIONES ANTERIORES DEL MISMO INCENDIO: ${previas.map((x) => `«${x.titulo}» (${x.estado})`).join("; ")}`
      : "",
    ctx.lecciones.length
      ? `LECCIONES DE EJECUCIONES ANTERIORES: ${ctx.lecciones.map((l) => `${l.texto} (peso ${l.peso})`).join("; ")}`
      : "",
    `POLÍTICA: puntuación mínima para ejecutar sin humano = ${ctx.snapshot.politica.puntuacionMinimaSupervisor}/100; ` +
      `a partir de nivel de gravedad ${ctx.snapshot.politica.nivelGravedadHumano} todo es competencia humana.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Puntúa una decisión de 0 a 100 en seis criterios y dice si puede ejecutarse
 * sin pasar por un humano. Lo llama el núcleo antes de aplicar la política.
 */
export async function evaluarDecision(decision: Decision, ctx: ContextoAgente): Promise<EvaluacionSupervisor> {
  ctx.informarTarea(`Evaluando «${decision.titulo}»`, decision.incendioId);

  const r = await completarJson({
    // Cola prioritaria de lib/ia/llm.ts: Pipeline: cada decisión espera a esta evaluación para ejecutarse o escalar.
    prioridad: "alta",
    papel: "razonamiento",
    nombreEsquema: "evaluacion_supervisor",
    maxTokens: 6000, // los modelos razonadores gastan miles de tokens antes de responder
    // Señal propia: la evaluación corre en el pipeline del orquestador, fuera del ciclo del agente
    // que propuso; heredar su abortSignal cancelaba la evaluación al terminar ese ciclo.
    signal: AbortSignal.timeout(120_000),
    system:
      "Eres el supervisor de calidad de un centro de coordinación de incendios forestales en España. " +
      "Revisas cada decisión que propone un agente autónomo ANTES de que se ejecute en el mundo real: " +
      "llamadas a ayuntamientos, despliegue de bomberos, órdenes de evacuación. " +
      "Eres exigente pero no obstruccionista: una decisión sensata y bien fundada debe poder ejecutarse sola; " +
      "una que afecte a la seguridad de personas sin base suficiente tiene que ir a un humano. " +
      "Puntúas de 0 a 100 cada criterio y explicas cada nota en una frase. No inventes datos que no estén en el contexto.",
    user:
      `${describirDecision(decision, ctx)}\n\n` +
      `Evalúa estos seis criterios, en este orden y con estos nombres exactos:\n` +
      CRITERIOS.map((c, i) => `${i + 1}. ${c.nombre} — ${c.pregunta}`).join("\n") +
      `\n\nDevuelve: criterios (los seis, con nombre, puntuación 0-100 y comentario de una frase), ` +
      `puntuacion (0-100, la nota global; no tiene por qué ser la media, pero debe ser coherente) y ` +
      `motivoEscalado (UNA frase para el mando humano explicando qué habría que revisar; cadena vacía si no hay nada que objetar).`,
    esquema: EsquemaEvaluacion,
  });

  const criterios = r.datos.criterios
    .slice(0, 8)
    .map((c) => ({ nombre: c.nombre, puntuacion: Math.round(Math.min(100, Math.max(0, c.puntuacion))), comentario: c.comentario }));
  const puntuacion = Math.round(Math.min(100, Math.max(0, r.datos.puntuacion)));
  const minimo = ctx.snapshot.politica.puntuacionMinimaSupervisor;
  const criterioSuspenso = criterios.find((c) => c.puntuacion < MINIMO_POR_CRITERIO);
  const aprueba = puntuacion >= minimo && !criterioSuspenso;

  const motivoEscalado = aprueba
    ? undefined
    : criterioSuspenso
      ? `${criterioSuspenso.nombre} ${criterioSuspenso.puntuacion}/100: ${criterioSuspenso.comentario}`
      : r.datos.motivoEscalado?.trim() || `Puntuación ${puntuacion}/100, por debajo del mínimo ${minimo}.`;

  const evaluacion: EvaluacionSupervisor = {
    en: new Date().toISOString(),
    puntuacion,
    aprueba,
    criterios,
    motivoEscalado,
    modelo: r.modelo || modeloPara("razonamiento"),
  };

  ctx.registrar(
    aprueba ? "decision_propuesta" : "decision_escalada",
    aprueba
      ? `Supervisor: «${decision.titulo}» ${puntuacion}/100, puede ejecutarse.`
      : `Supervisor: «${decision.titulo}» ${puntuacion}/100 — a revisión humana. ${motivoEscalado}`,
    { incendioId: decision.incendioId, nivel: aprueba ? "info" : "aviso", datos: { decisionId: decision.id, puntuacion } },
  );

  return evaluacion;
}

// ---------------------------------------------------------------------
// Vigilancia de los demás agentes
// ---------------------------------------------------------------------

function minutosDesde(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (Date.now() - t) / 60000 : undefined;
}

/** ¿Este agente lleva demasiado tiempo sin dar señales para su cadencia? */
function estaCallado(a: EstadoAgenteApp): boolean {
  if (a.pausado || a.cadenciaSeg <= 0) return false;
  const minutos = minutosDesde(a.ultimaActividad);
  if (minutos === undefined) return false;
  return minutos * 60 > a.cadenciaSeg * 3;
}

export const supervisor: Agente = {
  id: "supervisor",
  nombre: "Supervisor de calidad",
  categoria: "supervision",
  descripcion:
    "Puntúa cada decisión antes de ejecutarla (fundamentación, prioridad, coherencia, legalidad, claridad, proporcionalidad) " +
    "y vigila la salud de los demás agentes.",
  modelo: modeloPara("razonamiento"),
  cadenciaSeg: 120,
  despiertaCon: ["decision_propuesta", "agente"],

  async ciclo(ctx: ContextoAgente): Promise<ResultadoCiclo> {
    ctx.informarTarea("Vigilando la salud de los agentes");
    const eventos: ResultadoCiclo["eventos"] = [];
    let avisados = 0;
    let pausados = 0;

    for (const a of ctx.snapshot.agentes) {
      if (a.id === supervisor.id) continue;
      // Un ciclo cancelado por "Parar" (AbortError / "pausa") no es una avería del agente.
      if (ctx.snapshot.reloj.pausado || /abort|pausa/i.test(a.ultimoError ?? "")) continue;

      if (a.contadores.errores >= ERRORES_PARA_PAUSA && !a.pausado) {
        ctx.estado.actualizar(ctx.estado.agentes, a.id, { pausado: true });
        pausados += 1;
        eventos.push({
          tipo: "agente",
          agenteId: a.id,
          nivel: "critico",
          mensaje: `Pausado ${a.nombre} por errores repetidos (${a.contadores.errores}): requiere revisión humana.`,
          datos: { errores: a.contadores.errores, ultimoError: a.ultimoError },
        });
        continue;
      }

      if (a.contadores.errores >= ERRORES_PARA_AVISO && !a.pausado) {
        avisados += 1;
        eventos.push({
          tipo: "agente",
          agenteId: a.id,
          nivel: "aviso",
          mensaje: `${a.nombre} acumula ${a.contadores.errores} errores. Último: ${a.ultimoError ?? "sin detalle"}.`,
          datos: { errores: a.contadores.errores },
        });
        continue;
      }

      if (estaCallado(a)) {
        avisados += 1;
        const minutos = minutosDesde(a.ultimaActividad) ?? 0;
        eventos.push({
          tipo: "agente",
          agenteId: a.id,
          nivel: "aviso",
          mensaje: `${a.nombre} lleva ${minutos.toFixed(0)} min sin actividad (su cadencia es de ${a.cadenciaSeg} s).`,
          datos: { minutosSinActividad: Math.round(minutos) },
        });
      }
    }

    const resumen = pausados
      ? `${pausados} agente(s) pausado(s) por errores repetidos y ${avisados} con aviso.`
      : avisados
        ? `${avisados} agente(s) con aviso; el resto, correctos.`
        : `${ctx.snapshot.agentes.length} agentes sin incidencias.`;
    return { resumen, eventos };
  },
};
