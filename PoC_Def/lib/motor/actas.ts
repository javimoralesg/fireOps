// =====================================================================
// ATALAYA INCENDIOS · Actas (informes de auditoría)
// ---------------------------------------------------------------------
// Propósito: que TODA decisión y TODA acción de los agentes deje un acta
// escrita, en cualquier estado, para poder auditarlo absolutamente todo.
// Requisito de Javi (2026-09-19).
//
// Regla dura: el acta se genera SIEMPRE. Si el redactor de C está caído o
// no hay proveedor de IA, se escribe un acta DETERMINISTA con los mismos
// datos (`conNarrativaIA: false`). Sin IA se pierde la prosa, nunca la
// trazabilidad. Cada acta lleva su huella SHA-256 para detectar cambios.
//
// RENDIMIENTO (constructor S, 2026-09-19): la narrativa de IA se reserva al
// estado FINAL de la decisión (ver ESTADOS_CON_NARRATIVA) y sale por el carril
// de prioridad "baja" de lib/ia/llm.ts, con su propio hueco. Antes cada uno de
// los cinco estados por los que pasa una decisión pedía una llamada de
// razonamiento (~25 s) en la cola "normal" de 4 huecos, y esas llamadas
// tapaban al supervisor, al coordinador y a la percepción.
//
// DUEÑO: constructor A. Dependencias: lib/agentes/informes/redactor.ts (C).
// =====================================================================

import { createHash } from "node:crypto";
import type { Accion, Decision, Informe, TrazaCiclo } from "../dominio/tipos";
import type { ContextoAgente } from "./contratos";
import { obtenerEstado, type Estado } from "./estado";
import { nuevoId } from "./ids";

/**
 * Firma AMPLIADA del redactor de C (tercer parámetro opcional). Se llama por
 * import dinámico y con esta forma para no depender de que C la haya publicado
 * todavía: mientras siga con dos parámetros, el tercero se ignora sin romper.
 */
type RedactorAmpliado = (
  decision: Decision,
  ctx: ContextoAgente,
  opciones?: { tipo?: Informe["tipo"]; accionId?: string },
) => Promise<Informe>;

export function huellaDe(contenido: string): string {
  return createHash("sha256").update(contenido, "utf8").digest("hex");
}

/** Busca una traza por id entre las que llevan los agentes en el estado vivo. */
export function buscarTraza(estado: Estado, trazaId?: string): TrazaCiclo | undefined {
  if (!trazaId) return undefined;
  for (const agente of estado.agentes.values()) {
    const t = agente.trazas?.find((x) => x.id === trazaId);
    if (t) return t;
  }
  return undefined;
}

// ---------------------------------------------------------------------
// Acta determinista (la red de seguridad: nunca falla)
// ---------------------------------------------------------------------

function lista(titulo: string, filas: string[]): string {
  if (!filas.length) return `### ${titulo}\n\n_Sin datos._\n`;
  return `### ${titulo}\n\n${filas.map((f) => `- ${f}`).join("\n")}\n`;
}

function bloqueTraza(traza?: TrazaCiclo): string {
  if (!traza) return "### Traza del ciclo\n\n_No se conserva la traza del ciclo que la originó._\n";
  // Solo la ficha de cada llamada: los prompts y respuestas completos están en
  // la traza (GET /api/auditoria) y en el expediente exportable, para que el
  // acta no se dispare a decenas de miles de caracteres.
  const llamadas = traza.llamadasIA.map(
    (l) => `${l.papel} · ${l.proveedor}/${l.modelo} · ${l.latenciaMs} ms${typeof l.tokensEntrada === "number" ? ` · ${l.tokensEntrada}→${l.tokensSalida ?? "?"} tok` : ""}${l.error ? ` · ERROR: ${l.error}` : ""}`,
  );
  return [
    "### Traza del ciclo que la originó",
    "",
    `- Traza \`${traza.id}\` · motivo: ${traza.motivo} · estado: ${traza.estado}${traza.duracionMs ? ` · ${traza.duracionMs} ms` : ""}`,
    `- Qué vio el agente: ${traza.entradas ?? "(no anotado)"}`,
    `- Qué concluyó: ${traza.resumen ?? "(sin resumen)"}`,
    traza.error ? `- Error del ciclo: ${traza.error}` : "",
    "",
    lista(`Llamadas a modelos de IA (${llamadas.length})`, llamadas),
  ].filter(Boolean).join("\n");
}

function actaDecisionDeterminista(estado: Estado, d: Decision, traza?: TrazaCiclo): { titulo: string; contenido: string } {
  const agente = estado.agentes.get(d.agenteId);
  const incendio = d.incendioId ? estado.incendios.get(d.incendioId) : undefined;
  const titulo = `Acta de decisión · ${d.titulo} · ${d.estado}`;
  const contenido = [
    `# ${titulo}`,
    "",
    `**Decisión** \`${d.id}\` · **ejecución** \`${d.ejecucionId}\``,
    `**Agente**: ${agente?.nombre ?? d.agenteId} (\`${d.agenteId}\`, modelo ${agente?.modelo ?? "desconocido"})`,
    incendio ? `**Incendio**: ${incendio.nombre} (${incendio.municipio}, ${incendio.provincia}) · estado ${incendio.estado} · nivel ${incendio.nivelGravedad}` : "**Incendio**: —",
    `**Propuesta**: ${d.creadaEn} (hora de mundo ${d.creadaEnMundo})`,
    `**Estado actual**: ${d.estado} · **prioridad** ${d.prioridad} · **riesgo** ${d.riesgo} · **competencia** ${d.competencia}`,
    d.decididaPor ? `**Decidida por**: ${d.decididaPor} el ${d.decididaEn}` : "",
    d.comentarioHumano ? `**Comentario humano**: ${d.comentarioHumano}` : "",
    d.sustituyeA ? `**Sustituye a**: \`${d.sustituyeA}\` (${d.motivoReplanificacion ?? "replanificación"})` : "",
    "",
    "## Qué se propuso y por qué",
    "",
    d.resumen || "_Sin resumen._",
    "",
    "**Razonamiento del agente:**",
    "",
    d.razonamiento || "_No consta._",
    "",
    "## Trazabilidad",
    "",
    lista(
      `Historial de estados (${d.historial?.length ?? 0})`,
      (d.historial ?? []).map((h) => `\`${h.en}\` (mundo ${h.enMundo}) → **${h.estado}** por ${h.quien}${h.motivo ? ` · ${h.motivo}` : ""}`),
    ),
    lista(
      `Acciones (${d.acciones.length})`,
      d.acciones.map((a) => {
        const res = a.resultado ? `${a.resultado.exito ? "ÉXITO" : "FALLO"} vía ${a.resultado.proveedor}${a.resultado.referencia ? ` (ref. ${a.resultado.referencia})` : ""}: ${a.resultado.resumen}` : "sin resultado";
        return `\`${a.id}\` **${a.tipo}** — ${a.descripcion} · estado ${a.estado}${a.autorizadaPor ? ` · autorizada por ${a.autorizadaPor}` : ""}${a.ordenadaEn ? ` · ordenada ${a.ordenadaEn}` : ""} · ${res}`;
      }),
    ),
    lista(
      `Evidencias (${d.evidencias.length})`,
      d.evidencias.map((e) => `${e.fuente}: ${e.resumen}${e.url ? ` (${e.url})` : ""} · ${e.en}${typeof e.confianza === "number" ? ` · confianza ${e.confianza}` : ""}`),
    ),
    lista(
      `Fundamentos normativos (${d.fundamentos.length})`,
      d.fundamentos.map((f) => `${f.documento}${f.seccion ? ` · ${f.seccion}` : ""} (similitud ${f.similitud.toFixed(2)}): «${f.cita}»`),
    ),
    d.alertasLegales?.length ? lista("Alertas legales", d.alertasLegales) : "",
    lista(
      `Lecciones aplicadas (${d.leccionesAplicadas?.length ?? 0})`,
      (d.leccionesAplicadas ?? []).map((l) => `\`${l.leccionId}\`: ${l.texto}`),
    ),
    "### Evaluación del supervisor",
    "",
    d.evaluacion
      ? [
          `Puntuación **${d.evaluacion.puntuacion}/100** · ${d.evaluacion.aprueba ? "APRUEBA" : "NO APRUEBA"} · modelo ${d.evaluacion.modelo} · ${d.evaluacion.en}`,
          d.evaluacion.motivoEscalado ? `Motivo de escalado: ${d.evaluacion.motivoEscalado}` : "",
          "",
          ...d.evaluacion.criterios.map((c) => `- ${c.nombre}: ${c.puntuacion} — ${c.comentario}`),
        ].filter(Boolean).join("\n")
      : "_Sin evaluación del supervisor (no hubo proveedor de IA disponible o no llegó a evaluarse)._",
    "",
    bloqueTraza(traza),
  ].filter((l) => l !== "").join("\n");
  return { titulo, contenido };
}

function actaAccionDeterminista(estado: Estado, d: Decision, a: Accion, traza?: TrazaCiclo): { titulo: string; contenido: string } {
  const agente = estado.agentes.get(d.agenteId);
  const titulo = `Acta de acción · ${a.descripcion} · ${a.estado}`;
  const objetivo = a.objetivo ?? {};
  const destinatarios = [
    objetivo.unidadId ? `unidad \`${objetivo.unidadId}\` (${estado.unidades.get(objetivo.unidadId)?.nombre ?? "?"})` : "",
    objetivo.poblacionId ? `población \`${objetivo.poblacionId}\` (${estado.poblaciones.get(objetivo.poblacionId)?.nombre ?? "?"})` : "",
    objetivo.telefono ? `teléfono ${objetivo.telefono}` : "",
    objetivo.email ? `email ${objetivo.email}` : "",
    objetivo.camaraId ? `cámara \`${objetivo.camaraId}\`` : "",
    objetivo.punto ? `punto ${objetivo.punto.lat}, ${objetivo.punto.lon}` : "",
  ].filter(Boolean);

  const contenido = [
    `# ${titulo}`,
    "",
    `**Acción** \`${a.id}\` · **tipo** ${a.tipo} · **estado** ${a.estado}`,
    `**Decisión de origen**: \`${d.id}\` — ${d.titulo}`,
    `**Agente**: ${agente?.nombre ?? d.agenteId} (\`${d.agenteId}\`)`,
    `**Autorizada por**: ${a.autorizadaPor ?? d.decididaPor ?? "(no consta)"}`,
    `**Ordenada**: ${a.ordenadaEn ?? "(no consta)"} · **ejecutada**: ${a.ejecutadaEn ?? "(no consta)"}`,
    "",
    "## Qué se ordenó",
    "",
    a.descripcion,
    "",
    lista("Destinatarios", destinatarios),
    "### Parámetros de la orden",
    "",
    "```json",
    JSON.stringify(a.parametros ?? {}, null, 2),
    "```",
    "",
    "## Qué pasó de verdad",
    "",
    a.resultado
      ? [
          `**Resultado**: ${a.resultado.exito ? "ÉXITO" : "FALLO"}`,
          `**Proveedor**: ${a.resultado.proveedor}`,
          a.resultado.referencia ? `**Referencia externa**: ${a.resultado.referencia}` : "",
          `**Cuándo**: ${a.resultado.en}`,
          "",
          a.resultado.resumen,
          a.resultado.datos ? `\n\`\`\`json\n${JSON.stringify(a.resultado.datos, null, 2)}\n\`\`\`` : "",
        ].filter(Boolean).join("\n")
      : "_La acción no llegó a ejecutarse o no devolvió resultado._",
    "",
    bloqueTraza(traza),
  ].filter((l) => l !== "").join("\n");
  return { titulo, contenido };
}

// ---------------------------------------------------------------------
// Generación y guardado
// ---------------------------------------------------------------------

/** Contexto mínimo para el redactor de C, sin depender del orquestador. */
function contextoDe(estado: Estado, agenteId: string): ContextoAgente {
  return {
    estado,
    snapshot: estado.snapshot(),
    ahoraMundo: estado.reloj.ahoraMundo,
    minutosMundoDesdeUltimoCiclo: 0,
    registrar: (tipo, mensaje, extra) => { estado.registrarEvento(tipo, mensaje, { ...extra, agenteId }); },
    informarTarea: () => {},
    lecciones: [],
    abortSignal: new AbortController().signal,
  };
}

/**
 * Estados en los que un acta merece narrativa de IA: los FINALES. Los
 * intermedios (propuesta → pendiente_humano → aprobada → ejecutando) se
 * auditan igual de bien con el acta determinista y no justifican una llamada
 * de razonamiento de ~25 s cada uno. MEDIDO 2026-09-19: cinco llamadas por
 * decisión, todas en la cola "normal", tapando a los agentes de decisión.
 */
const ESTADOS_CON_NARRATIVA: ReadonlySet<Decision["estado"]> = new Set<Decision["estado"]>([
  "ejecutada",
  "denegada",
  "fallida",
  "caducada",
]);

async function pedirNarrativa(
  estado: Estado,
  d: Decision,
  opciones: { tipo: Informe["tipo"]; accionId?: string },
): Promise<Informe | undefined> {
  try {
    const modulo = await import("../agentes/informes/redactor");
    const redactar = modulo.redactarInforme as unknown as RedactorAmpliado;
    const { conPrioridadLLM } = await import("../ia/llm");
    // Carril de prioridad BAJA: el redactor llama al LLM por su cuenta y hereda
    // esta prioridad por AsyncLocalStorage, así que su hueco es propio y no le
    // quita ninguno al supervisor, al coordinador ni a la percepción.
    const informe = await conPrioridadLLM("baja", () => redactar(d, contextoDe(estado, d.agenteId), opciones));
    return informe ?? undefined;
  } catch {
    // Sin IA o con el redactor caído: se sigue con el acta determinista.
    return undefined;
  }
}

/** Guarda el acta en el estado dejándola completa y sellada. */
function sellarYGuardar(estado: Estado, base: Omit<Informe, "id" | "huella"> & { id?: string }): Informe {
  const informe: Informe = {
    ...base,
    id: base.id || nuevoId("inf"),
    huella: huellaDe(base.contenido),
  };
  estado.guardar(estado.informes, informe);
  return informe;
}

/**
 * Acta de una decisión en su estado actual. Se llama en CADA cambio de estado.
 * Nunca lanza: si algo va mal, devuelve undefined y el motor sigue.
 */
export async function generarActaDecision(
  decisionId: string,
  estadoDecision: Decision["estado"],
  contexto: { quien?: string; motivo?: string } = {},
): Promise<Informe | undefined> {
  const estado = obtenerEstado();
  const d = estado.decisiones.get(decisionId);
  if (!d) return undefined;

  try {
    const traza = buscarTraza(estado, d.trazaId);
    // Solo el estado FINAL se redacta con IA (ver ESTADOS_CON_NARRATIVA): los
    // intermedios llevan acta determinista, que es igual de auditable.
    const narrativa = ESTADOS_CON_NARRATIVA.has(estadoDecision)
      ? await pedirNarrativa(estado, d, { tipo: "decision" })
      : undefined;
    const determinista = actaDecisionDeterminista(estado, d, traza);

    // Si el redactor de C ha escrito el acta, manda la suya (el formato es
    // suyo y ya incluye historial, evidencias y traza). El acta determinista
    // es la red de seguridad: se usa cuando C no puede redactar (sin IA, sin
    // proveedor o con error). Nunca se concatenan: duplicaría el documento.
    const contenido = narrativa?.contenido || determinista.contenido;

    const informe = sellarYGuardar(estado, {
      ejecucionId: d.ejecucionId || estado.ejecucion.id,
      decisionId: d.id,
      incendioId: d.incendioId,
      titulo: narrativa?.titulo || determinista.titulo,
      contenido,
      decisionesConsideradas: narrativa?.decisionesConsideradas ?? d.decisionesPrevias ?? [],
      generadoEn: new Date().toISOString(),
      modelo: narrativa?.modelo || "determinista",
      tipo: "decision",
      agenteId: d.agenteId,
      trazaId: d.trazaId,
      estadoDecision,
      conNarrativaIA: !!narrativa?.contenido,
    });

    // Se engancha a la decisión (informeIds en orden; informeId = el último).
    const actual = estado.decisiones.get(decisionId);
    if (actual) {
      estado.actualizar(estado.decisiones, decisionId, {
        informeIds: [...(actual.informeIds ?? []), informe.id],
        informeId: informe.id,
      });
    }
    void contexto;
    return informe;
  } catch (e) {
    estado.marcarServicio("Actas de auditoría", false, e instanceof Error ? e.message : String(e));
    return undefined;
  }
}

/** Acta de UNA acción concreta, tras ejecutarla (con éxito o sin él). */
export async function generarActaAccion(decisionId: string, accionId: string): Promise<Informe | undefined> {
  const estado = obtenerEstado();
  const d = estado.decisiones.get(decisionId);
  const a = d?.acciones.find((x) => x.id === accionId);
  if (!d || !a) return undefined;

  try {
    const traza = buscarTraza(estado, d.trazaId);
    const narrativa = await pedirNarrativa(estado, d, { tipo: "accion", accionId });
    const determinista = actaAccionDeterminista(estado, d, a, traza);
    // Igual que en las decisiones: la de C si la hay y es del tipo pedido,
    // y si no el acta determinista de la acción.
    const contenido = narrativa?.tipo === "accion" && narrativa.contenido
      ? narrativa.contenido
      : determinista.contenido;

    const informe = sellarYGuardar(estado, {
      ejecucionId: d.ejecucionId || estado.ejecucion.id,
      decisionId: d.id,
      incendioId: d.incendioId,
      titulo: determinista.titulo,
      contenido,
      decisionesConsideradas: [],
      generadoEn: new Date().toISOString(),
      modelo: narrativa?.tipo === "accion" ? narrativa.modelo : "determinista",
      tipo: "accion",
      accionId,
      agenteId: d.agenteId,
      trazaId: d.trazaId,
      estadoDecision: d.estado,
      conNarrativaIA: narrativa?.tipo === "accion" && !!narrativa.contenido,
    });

    // Se engancha a la acción dentro de la decisión.
    const actual = estado.decisiones.get(decisionId);
    if (actual) {
      estado.actualizar(estado.decisiones, decisionId, {
        acciones: actual.acciones.map((x) => (x.id === accionId ? { ...x, informeId: informe.id } : x)),
        informeIds: [...(actual.informeIds ?? []), informe.id],
      });
    }
    return informe;
  } catch (e) {
    estado.marcarServicio("Actas de auditoría", false, e instanceof Error ? e.message : String(e));
    return undefined;
  }
}
