// =====================================================================
// ATALAYA INCENDIOS · Redactor de informes (actas de auditoría)
// ---------------------------------------------------------------------
// DUEÑO: constructor C.
// Requisito de producto: TODA decisión y TODA acción de los agentes tiene que
// quedar auditada. De ahí la regla de oro de este archivo:
//
//   EL ACTA ES DETERMINISTA Y NUNCA FALLA.
//
// Primero se compone un markdown con los hechos (sin IA): quién, cuándo, qué
// vio el agente, qué decidió, quién lo autorizó, qué se ejecutó de verdad, con
// qué proveedor y qué referencia externa, y con qué base legal. Solo DESPUÉS,
// si hay proveedor de IA y responde en menos de 20 s, se añade una sección
// "Análisis" con la narrativa. Si la IA falla, el acta se guarda igual con
// `conNarrativaIA: false` y una nota que lo dice.
//
// Cada acta lleva su huella SHA-256 al pie: si alguien la edita, se nota.
//
// A llama a `redactarInforme(decision, ctx, opciones)` en cada cambio de
// estado de una decisión y tras cada acción; este agente, por su cuenta, saca
// un parte de situación cada 30 minutos de mundo.
// =====================================================================

import { createHash } from "node:crypto";
import type { Agente, ContextoAgente, ResultadoCiclo } from "../../motor/contratos";
import type { Accion, Decision, Incendio, Informe, TrazaCiclo } from "../../dominio/tipos";
import { completarTexto, modeloPara, proveedorDisponible } from "../../ia/llm";

const MINUTOS_ENTRE_PARTES = Number(process.env.INFORMES_MINUTOS_SITUACION ?? 30);
/** La narrativa es un extra: si tarda más de esto, el acta sale sin ella. */
const TIMEOUT_NARRATIVA_MS = Number(process.env.INFORMES_TIMEOUT_NARRATIVA_MS ?? 20_000);

interface EstadoRedactor {
  ultimoParteMundo?: string;
}
type ConEstado = typeof globalThis & { __atalayaRedactor?: EstadoRedactor };
const estadoRedactor: EstadoRedactor = ((globalThis as ConEstado).__atalayaRedactor ??= {});

export interface OpcionesInforme {
  tipo?: "decision" | "accion" | "postmortem" | "situacion";
  accionId?: string;
}

function nuevoIdInforme(): string {
  return `inf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Huella SHA-256 del contenido: garantiza que el acta no se ha tocado. */
export function huellaDe(contenido: string): string {
  return createHash("sha256").update(contenido, "utf8").digest("hex");
}

// ---------------------------------------------------------------------
// Piezas del acta determinista
// ---------------------------------------------------------------------

const sinDato = "_no consta_";

function describirIncendio(i: Incendio | undefined): string {
  if (!i) return "- Sin incendio asociado.";
  return [
    `- **Incendio**: ${i.nombre} (${i.municipio}, ${i.provincia}, ${i.comunidad}) · id \`${i.id}\``,
    `- **Estado**: ${i.estado} · nivel de gravedad ${i.nivelGravedad} · ${i.areaHa.toFixed(0)} ha · confianza ${(i.confianza * 100).toFixed(0)} %`,
    `- **Centro**: ${i.centro.lat.toFixed(5)}, ${i.centro.lon.toFixed(5)}`,
    i.meteo
      ? `- **Meteorología** (${i.meteo.fuente}, ${i.meteo.horaMundo}): ${i.meteo.temperaturaC} °C · ${i.meteo.humedadPct} % HR · ` +
        `viento ${i.meteo.vientoKmh} km/h del ${i.meteo.direccionTexto} (${i.meteo.direccionGrados}°) · rachas ${i.meteo.rachasKmh} km/h · ` +
        `precipitación ${i.meteo.precipitacionMm} mm — <${i.meteo.url}>`
      : `- **Meteorología**: ${sinDato}`,
    i.peligro ? `- **Peligro**: ${i.peligro.nivel} (${i.peligro.valor}/100) — ${i.peligro.motivo}` : `- **Peligro**: ${sinDato}`,
    i.frente
      ? `- **Frente**: rumbo ${i.frente.rumboTexto} (${i.frente.rumboGrados}°) a ${i.frente.velocidadMmin.toFixed(1)} m/min de mundo`
      : `- **Frente**: ${sinDato}`,
    i.combustible ? `- **Combustible dominante**: ${i.combustible.dominante}` : "",
    i.prediccion?.poblacionesEnPeligro.length
      ? `- **Predicción**: ${i.prediccion.poblacionesEnPeligro.map((p) => `${p.nombre} en ${p.etaMin} min`).join(", ")}. ${i.prediccion.explicacion}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function describirHistorial(d: Decision): string {
  if (!d.historial?.length) {
    return d.decididaEn
      ? `- ${d.decididaEn} · ${d.estado} · ${d.decididaPor ?? "sin registrar"}${d.comentarioHumano ? ` — «${d.comentarioHumano}»` : ""}`
      : `- ${d.creadaEn} · propuesta · ${d.agenteId}`;
  }
  return d.historial
    .map((h) => `- ${h.en} (mundo ${h.enMundo}) · **${h.estado}** · ${h.quien}${h.motivo ? ` — ${h.motivo}` : ""}`)
    .join("\n");
}

/** Parámetros de una acción sin secretos: nunca se escriben claves en un acta. */
function parametrosSeguros(parametros: Record<string, unknown>): string {
  const prohibido = /(clave|secret|token|api[_-]?key|password|authorization)/i;
  const entradas = Object.entries(parametros).filter(([k]) => !prohibido.test(k));
  if (!entradas.length) return sinDato;
  return entradas
    .map(([k, v]) => {
      const texto = typeof v === "string" ? v : JSON.stringify(v);
      return `  - \`${k}\`: ${texto && texto.length > 400 ? `${texto.slice(0, 400)}…` : texto}`;
    })
    .join("\n");
}

function describirAccion(a: Accion, d: Decision): string {
  const objetivo = a.objetivo
    ? Object.entries(a.objetivo)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
        .join(", ")
    : sinDato;
  const r = a.resultado;
  return [
    `- **Tipo**: ${a.tipo} · id \`${a.id}\``,
    `- **Descripción**: ${a.descripcion}`,
    `- **Objetivo**: ${objetivo}`,
    `- **Estado**: ${a.estado}`,
    `- **Autorizada por**: ${a.autorizadaPor ?? d.decididaPor ?? sinDato}`,
    `- **Ordenada en**: ${a.ordenadaEn ?? sinDato} · **ejecutada en**: ${a.ejecutadaEn ?? sinDato}`,
    `- **Parámetros**:\n${parametrosSeguros(a.parametros)}`,
    r
      ? [
          `- **Resultado real** (${r.en}):`,
          `  - Proveedor: ${r.proveedor}`,
          `  - Referencia externa: ${r.referencia ?? sinDato}`,
          `  - Éxito: ${r.exito ? "sí" : "NO"}`,
          `  - Resumen: ${r.resumen}`,
          r.datos ? `  - Datos devueltos: \`${JSON.stringify(r.datos).slice(0, 1200)}\`` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : `- **Resultado real**: ${sinDato} (la acción no ha llegado a ejecutarse)`,
  ].join("\n");
}

/** Traza del ciclo que produjo la decisión: lo que el agente vio y pensó. */
function buscarTraza(ctx: ContextoAgente, trazaId: string | undefined, agenteId: string): TrazaCiclo | undefined {
  if (!trazaId) return undefined;
  for (const a of ctx.snapshot.agentes) {
    const t = a.trazas?.find((x) => x.id === trazaId);
    if (t) return t;
  }
  const agente = ctx.snapshot.agentes.find((a) => a.id === agenteId);
  return agente?.trazas?.find((t) => t.id === trazaId);
}

function describirTraza(t: TrazaCiclo | undefined): string {
  if (!t) return `_Sin traza asociada._`;
  const llamadas = t.llamadasIA.length
    ? t.llamadasIA
        .map(
          (l, i) =>
            `  ${i + 1}. ${l.proveedor}/${l.modelo} (${l.papel}) · ${l.latenciaMs} ms · ` +
            `${l.tokensEntrada ?? "?"}→${l.tokensSalida ?? "?"} tokens${l.error ? ` · ERROR: ${l.error}` : ""}\n` +
            `     - Prompt: ${l.promptResumen}\n` +
            `     - Respuesta: ${l.respuestaResumen}`,
        )
        .join("\n")
    : "  _Ninguna: el agente resolvió sin IA._";
  return [
    `- **Traza**: \`${t.id}\` · motivo: ${t.motivo} · estado: ${t.estado} · ${t.duracionMs ?? "?"} ms`,
    `- **Entradas que vio el agente**: ${t.entradas ?? sinDato}`,
    `- **Conclusión del agente**: ${t.resumen ?? sinDato}`,
    t.error ? `- **Error del ciclo**: ${t.error}` : "",
    `- **Llamadas a modelos de IA** (${t.llamadasIA.length}):\n${llamadas}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------
// Acta determinista
// ---------------------------------------------------------------------

function componerActa(
  idInforme: string,
  tipo: Informe["tipo"],
  decision: Decision,
  ctx: ContextoAgente,
  accion: Accion | undefined,
  previas: Decision[],
): string {
  const incendio = decision.incendioId ? ctx.snapshot.incendios.find((i) => i.id === decision.incendioId) : undefined;
  const poblaciones = decision.incendioId ? ctx.snapshot.poblaciones.filter((p) => p.incendioId === decision.incendioId) : [];
  const unidades = decision.incendioId ? ctx.snapshot.unidades.filter((u) => u.incendioId === decision.incendioId) : [];
  const traza = buscarTraza(ctx, decision.trazaId, decision.agenteId);

  const bloques: string[] = [];

  bloques.push(
    [
      `# ${tituloDe(tipo, decision, accion)}`,
      ``,
      `| Campo | Valor |`,
      `|---|---|`,
      `| Informe | \`${idInforme}\` |`,
      `| Tipo | ${tipo} |`,
      `| Generado (real) | ${new Date().toISOString()} |`,
      `| Hora de mundo | ${ctx.ahoraMundo} |`,
      `| Ejecución | ${ctx.snapshot.ejecucion.nombre} (\`${ctx.snapshot.ejecucion.id}\`) |`,
      `| Decisión | \`${decision.id}\` |`,
      accion ? `| Acción | \`${accion.id}\` (${accion.tipo}) |` : "",
      `| Agente de origen | ${decision.agenteId} |`,
      `| Estado de la decisión | ${decision.estado} |`,
      `| Competencia | ${decision.competencia} |`,
      `| Incendio | ${incendio ? `${incendio.nombre} (\`${incendio.id}\`)` : sinDato} |`,
      `| Traza del ciclo | ${decision.trazaId ? `\`${decision.trazaId}\`` : sinDato} |`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  bloques.push(`## 1. Quién decidió y por qué (historial)\n\n${describirHistorial(decision)}`);

  bloques.push(
    `## 2. Situación en el momento de la decisión\n\n${describirIncendio(incendio)}\n\n` +
      `### Poblaciones\n\n` +
      (poblaciones.length
        ? poblaciones
            .map(
              (p) =>
                `- **${p.nombre}** (${p.tipo}${p.habitantes ? `, ${p.habitantes} hab.` : ""}) · riesgo ${p.riesgo} · ` +
                `${p.distanciaKm.toFixed(1)} km · ETA del frente ${p.etaFrenteMin ?? "—"} min · aviso: ${p.estadoAviso}` +
                (p.telefono ? ` · teléfono ${p.telefono}${p.telefonoEsDemo ? " (DESTINO_DEMO, no es el real del ayuntamiento)" : ""}` : ""),
            )
            .join("\n")
        : `_Ninguna registrada._`) +
      `\n\n### Medios\n\n` +
      (unidades.length
        ? unidades
            .map(
              (u) =>
                `- **${u.nombre}** [${u.tipo}] · ${u.estado}` +
                (u.ruta ? ` · ruta ${(u.ruta.distanciaM / 1000).toFixed(1)} km / ${Math.round(u.ruta.duracionS / 60)} min (${u.ruta.fuente}), progreso ${(u.ruta.progreso * 100).toFixed(0)} %` : "") +
                (u.ultimaOrden ? ` · última orden: «${u.ultimaOrden.texto}»` : ""),
            )
            .join("\n")
        : `_Ninguno asignado._`),
  );

  bloques.push(
    `## 3. La decisión\n\n` +
      [
        `- **Título**: ${decision.titulo}`,
        `- **Resumen**: ${decision.resumen}`,
        `- **Razonamiento del agente**: ${decision.razonamiento}`,
        `- **Prioridad**: ${decision.prioridad} (1 = máxima) · **Riesgo**: ${decision.riesgo}/100`,
        `- **Competencia según la política**: ${decision.competencia} ` +
          `(umbral humano ${ctx.snapshot.politica.umbralHumano}, umbral supervisada ${ctx.snapshot.politica.umbralSupervisada}, ` +
          `nota mínima del supervisor ${ctx.snapshot.politica.puntuacionMinimaSupervisor})`,
        decision.sustituyeA ? `- **Replanificación**: sustituye a \`${decision.sustituyeA}\`. ${decision.motivoReplanificacion ?? ""}` : "",
        `- **Acciones previstas** (${decision.acciones.length}): ` +
          (decision.acciones.map((a) => `${a.tipo} — ${a.descripcion} [${a.estado}]`).join("; ") || sinDato),
      ]
        .filter(Boolean)
        .join("\n"),
  );

  if (accion) {
    bloques.push(`## 4. La acción ejecutada\n\n${describirAccion(accion, decision)}`);
  }

  bloques.push(
    `## ${accion ? 5 : 4}. Evaluación del supervisor\n\n` +
      (decision.evaluacion
        ? [
            `- **Puntuación**: ${decision.evaluacion.puntuacion}/100 · **${decision.evaluacion.aprueba ? "aprueba" : "suspende"}** · modelo ${decision.evaluacion.modelo} · ${decision.evaluacion.en}`,
            decision.evaluacion.motivoEscalado ? `- **Motivo de escalado**: ${decision.evaluacion.motivoEscalado}` : "",
            ``,
            `| Criterio | Nota | Comentario |`,
            `|---|---:|---|`,
            ...decision.evaluacion.criterios.map((c) => `| ${c.nombre} | ${c.puntuacion} | ${c.comentario.replace(/\|/g, "／")} |`),
          ]
            .filter(Boolean)
            .join("\n")
        : `_La decisión no pasó por el supervisor._`),
  );

  bloques.push(
    `## ${accion ? 6 : 5}. Base legal y alertas\n\n` +
      (decision.alertasLegales?.length ? `**Alertas legales**: ${decision.alertasLegales.join("; ")}\n\n` : "") +
      (decision.fundamentos.length
        ? decision.fundamentos
            .map((f) => `- **[${f.documento} §${f.seccion ?? "—"}]** (similitud ${f.similitud.toFixed(3)}, chunk \`${f.chunkId}\`)\n  > ${f.cita}`)
            .join("\n")
        : `_Sin fundamentos legales citados._`),
  );

  bloques.push(
    `## ${accion ? 7 : 6}. Evidencias\n\n` +
      (decision.evidencias.length
        ? decision.evidencias
            .map((e) => `- **${e.fuente}** (${e.en}${e.confianza !== undefined ? `, confianza ${(e.confianza * 100).toFixed(0)} %` : ""}): ${e.resumen}${e.url ? ` — <${e.url}>` : ""}`)
            .join("\n")
        : `_Sin evidencias registradas._`),
  );

  bloques.push(
    `## ${accion ? 8 : 7}. Memoria y contexto previo\n\n` +
      `**Lecciones aplicadas**: ` +
      (decision.leccionesAplicadas?.length
        ? `\n${decision.leccionesAplicadas.map((l) => `- ${l.texto} (\`${l.leccionId}\`)`).join("\n")}`
        : `${sinDato}`) +
      `\n\n**Decisiones anteriores del mismo incendio consideradas**: ` +
      (previas.length
        ? `\n${previas.map((d) => `- «${d.titulo}» (\`${d.id}\`, ${d.estado}, ${d.creadaEnMundo})${d.comentarioHumano ? ` — comentario del mando: «${d.comentarioHumano}»` : ""}`).join("\n")}`
        : `_Es la primera decisión de este incendio._`),
  );

  bloques.push(`## ${accion ? 9 : 8}. Traza del ciclo de agente\n\n${describirTraza(traza)}`);

  return bloques.join("\n\n");
}

function tituloDe(tipo: Informe["tipo"], decision: Decision, accion: Accion | undefined): string {
  if (tipo === "accion" && accion) return `Acta de acción · ${accion.tipo} — ${accion.descripcion}`;
  if (tipo === "postmortem") return decision.titulo.toLowerCase().startsWith("post-mortem") ? decision.titulo : `Post-mortem · ${decision.titulo}`;
  return `Acta de decisión · ${decision.titulo} (${decision.estado})`;
}

// ---------------------------------------------------------------------
// Narrativa opcional con IA
// ---------------------------------------------------------------------

async function anadirNarrativa(acta: string, decision: Decision, accion: Accion | undefined, ctx: ContextoAgente): Promise<{ texto: string; ok: boolean; modelo: string }> {
  if (!proveedorDisponible()) {
    return { texto: "", ok: false, modelo: "determinista" };
  }
  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), TIMEOUT_NARRATIVA_MS);
  // Si el orquestador cancela el ciclo, la narrativa se cancela con él.
  const propagar = () => control.abort();
  ctx.abortSignal.addEventListener("abort", propagar, { once: true });
  try {
    const r = await completarTexto({
      papel: "razonamiento",
      maxTokens: 5000,
      signal: control.signal,
      system:
        "Eres el analista de un centro de coordinación de incendios forestales en España. " +
        "Te dan el acta con TODOS los hechos de una decisión. Escribes solo la sección de análisis, en markdown y en español. " +
        "No repites la tabla ni las listas: interpretas. Solo puedes usar lo que aparece en el acta; " +
        "si algo no consta, lo dices. Quien te lee tendrá que defender esta decisión ante una comisión de investigación.",
      user:
        `${acta.slice(0, 14000)}\n\n---\n\n` +
        `Escribe la sección "Análisis" con tres apartados cortos:\n` +
        `**Por qué era razonable** (o por qué no lo era, si se denegó o falló)\n` +
        `**Riesgos asumidos**\n` +
        `**Qué vigilar ahora**\n` +
        (accion ? `Ten en cuenta el resultado real de la acción ejecutada.\n` : "") +
        `Máximo 250 palabras en total. No empieces con un encabezado de nivel 1.`,
    });
    return { texto: r.datos.trim(), ok: true, modelo: r.modelo };
  } catch (e) {
    console.warn(`[redactor] acta sin narrativa (${e instanceof Error ? e.message : e})`);
    return { texto: "", ok: false, modelo: "determinista" };
  } finally {
    clearTimeout(corte);
    ctx.abortSignal.removeEventListener("abort", propagar);
  }
}

// ---------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------

/**
 * Acta de una decisión o de una de sus acciones. Siempre devuelve un informe:
 * el acta determinista se compone sin IA y la narrativa es un añadido.
 * NO guarda en `estado.informes` (lo hace el núcleo, que conoce el ciclo de
 * vida de la decisión); sí lo intenta persistir en Supabase.
 */
export async function redactarInforme(decision: Decision, ctx: ContextoAgente, opciones: OpcionesInforme = {}): Promise<Informe> {
  const accion = opciones.accionId ? decision.acciones.find((a) => a.id === opciones.accionId) : undefined;
  const tipo: Informe["tipo"] =
    opciones.tipo ??
    (accion
      ? "accion"
      : decision.titulo.trim().toLowerCase().startsWith("post-mortem") || decision.acciones.length === 0
        ? "postmortem"
        : "decision");

  const previas = decision.incendioId
    ? ctx.snapshot.decisiones
        .filter((d) => d.incendioId === decision.incendioId && d.id !== decision.id && d.creadaEn < decision.creadaEn)
        .slice(-5)
    : [];

  const id = nuevoIdInforme();
  ctx.informarTarea(`Levantando acta de «${accion ? accion.descripcion : decision.titulo}»`, decision.incendioId);

  const acta = componerActa(id, tipo, decision, ctx, accion, previas);
  const narrativa = await anadirNarrativa(acta, decision, accion, ctx);

  const cuerpo =
    `${acta}\n\n## Análisis\n\n` +
    (narrativa.ok
      ? narrativa.texto
      : `_Acta sin narrativa: el proveedor de IA no estaba disponible o no respondió a tiempo. ` +
        `Todos los hechos anteriores son verificables y no dependen de ningún modelo._`);

  const huella = huellaDe(cuerpo);
  const contenido = `${cuerpo}\n\n---\n\n_Acta \`${id}\` · huella SHA-256 \`${huella}\` · generada por Atalaya el ${new Date().toISOString()}._\n`;

  const informe: Informe = {
    id,
    ejecucionId: decision.ejecucionId || ctx.snapshot.ejecucion.id,
    decisionId: decision.id,
    accionId: accion?.id,
    incendioId: decision.incendioId,
    agenteId: decision.agenteId,
    trazaId: decision.trazaId,
    estadoDecision: decision.estado,
    titulo: tituloDe(tipo, decision, accion),
    contenido,
    decisionesConsideradas: previas.map((d) => d.id),
    generadoEn: new Date().toISOString(),
    modelo: narrativa.ok ? narrativa.modelo || modeloPara("razonamiento") : "determinista",
    tipo,
    conNarrativaIA: narrativa.ok,
    huella,
  };

  await persistirInforme(informe);
  return informe;
}

/** Persistencia tolerante en Supabase (el repositorio de A puede no existir aún). */
async function persistirInforme(informe: Informe): Promise<void> {
  try {
    const repositorio = (await import("@/lib/db/repositorio")) as { guardarInforme?: (i: Informe) => Promise<unknown> };
    if (typeof repositorio.guardarInforme === "function") await repositorio.guardarInforme(informe);
  } catch {
    // Sin repositorio: el informe vive en el estado y viaja por SSE.
  }
}

// ---------------------------------------------------------------------
// Parte de situación general (ciclo propio)
// ---------------------------------------------------------------------

async function redactarParteSituacion(ctx: ContextoAgente): Promise<Informe | undefined> {
  const incendios = ctx.snapshot.incendios.filter((i) => !["extinguido", "descartado"].includes(i.estado));
  if (!incendios.length) return undefined;

  const pendientes = ctx.snapshot.decisiones.filter((d) => d.estado === "pendiente_humano" || d.estado === "escalada");
  const ejecutadas = ctx.snapshot.decisiones.filter((d) => d.estado === "ejecutada");
  const poblacionesRiesgo = ctx.snapshot.poblaciones.filter((p) => p.riesgo === "alto" || p.riesgo === "inminente");
  const id = nuevoIdInforme();

  const acta = [
    `# Parte de situación · ${ctx.ahoraMundo} (hora de mundo)`,
    ``,
    `| Campo | Valor |`,
    `|---|---|`,
    `| Informe | \`${id}\` |`,
    `| Ejecución | ${ctx.snapshot.ejecucion.nombre} |`,
    `| Incendios activos | ${incendios.length} |`,
    `| Decisiones ejecutadas | ${ejecutadas.length} |`,
    `| Pendientes del mando | ${pendientes.length} |`,
    ``,
    `## Por incendio`,
    ...incendios.map((i) => `\n### ${i.nombre}\n\n${describirIncendio(i)}`),
    ``,
    `## Poblaciones en riesgo alto o inminente`,
    poblacionesRiesgo.length
      ? poblacionesRiesgo
          .map((p) => `- **${p.nombre}**: riesgo ${p.riesgo} · ETA ${p.etaFrenteMin ?? "—"} min · aviso: ${p.estadoAviso}`)
          .join("\n")
      : `_Ninguna._`,
    ``,
    `## Medios`,
    ctx.snapshot.unidades.length
      ? ctx.snapshot.unidades.slice(0, 30).map((u) => `- ${u.nombre} [${u.tipo}] — ${u.estado}`).join("\n")
      : `_Sin medios registrados._`,
    ``,
    `## Lo que espera decisión del mando`,
    pendientes.length
      ? pendientes.map((d) => `- «${d.titulo}» (prioridad ${d.prioridad}, ${d.estado}, \`${d.id}\`)`).join("\n")
      : `_Nada pendiente._`,
    ``,
    `## Avisos recientes del registro`,
    ctx.snapshot.eventos
      .filter((e) => e.nivel !== "info")
      .slice(-10)
      .map((e) => `- [${e.nivel}] ${e.enMundo} · ${e.mensaje}`)
      .join("\n") || `_Sin avisos._`,
  ].join("\n");

  let narrativa = "";
  let conIA = false;
  let modelo = "determinista";
  if (proveedorDisponible()) {
    try {
      const r = await completarTexto({
        papel: "razonamiento",
        maxTokens: 5000,
        signal: AbortSignal.timeout(60_000),
        system:
          "Redactas el cuadro general de un parte de situación para un centro de coordinación de incendios forestales. " +
          "Markdown, español, directo. Solo con los datos dados. Un mando tiene que entender en 30 segundos dónde está el problema.",
        user: `${acta.slice(0, 14000)}\n\n---\n\nEscribe "Cuadro general" (máximo 150 palabras) y "Prioridades ahora" (lista de 3 puntos).`,
      });
      narrativa = r.datos.trim();
      conIA = true;
      modelo = r.modelo;
    } catch (e) {
      console.warn(`[redactor] parte sin narrativa: ${e instanceof Error ? e.message : e}`);
    }
  }

  const cuerpo = conIA ? `${acta}\n\n## Lectura de la situación\n\n${narrativa}` : acta;
  const huella = huellaDe(cuerpo);
  const informe: Informe = {
    id,
    ejecucionId: ctx.snapshot.ejecucion.id,
    titulo: `Parte de situación · ${ctx.ahoraMundo.slice(11, 16)} (hora de mundo)`,
    contenido: `${cuerpo}\n\n---\n\n_Acta \`${id}\` · huella SHA-256 \`${huella}\`._\n`,
    decisionesConsideradas: pendientes.map((d) => d.id),
    generadoEn: new Date().toISOString(),
    modelo,
    tipo: "situacion",
    agenteId: "redactor",
    conNarrativaIA: conIA,
    huella,
  };
  // Este sí lo guarda el redactor: nace de su propio ciclo, no de una decisión.
  ctx.estado.guardar(ctx.estado.informes, informe);
  await persistirInforme(informe);
  return informe;
}

export const redactor: Agente = {
  id: "redactor",
  nombre: "Redactor de informes",
  categoria: "comunicacion",
  descripcion:
    "Levanta acta de cada decisión y de cada acción (hechos verificables con huella SHA-256, más análisis si hay IA) " +
    "y publica un parte de situación cada media hora de mundo.",
  modelo: modeloPara("razonamiento"),
  cadenciaSeg: 600,
  despiertaCon: ["decision_ejecutada", "decision_denegada", "decision_escalada"],

  async ciclo(ctx: ContextoAgente): Promise<ResultadoCiclo> {
    const ahora = Date.parse(ctx.ahoraMundo);
    const ultimo = estadoRedactor.ultimoParteMundo ? Date.parse(estadoRedactor.ultimoParteMundo) : undefined;
    const minutos = ultimo !== undefined ? (ahora - ultimo) / 60000 : Infinity;

    if (minutos < MINUTOS_ENTRE_PARTES) {
      return { resumen: `Próximo parte de situación en ${(MINUTOS_ENTRE_PARTES - minutos).toFixed(0)} min de mundo.` };
    }

    ctx.informarTarea("Redactando el parte de situación");
    const informe = await redactarParteSituacion(ctx);
    estadoRedactor.ultimoParteMundo = ctx.ahoraMundo;
    if (!informe) return { resumen: "Sin incendios activos: no hay parte que redactar." };

    return {
      resumen: `Parte de situación redactado${informe.conNarrativaIA ? "" : " (solo acta, sin IA)"}.`,
      eventos: [
        {
          tipo: "sistema",
          agenteId: "redactor",
          nivel: "info",
          mensaje: `Parte de situación de las ${ctx.ahoraMundo.slice(11, 16)} disponible en /informes.`,
          datos: { informeId: informe.id, huella: informe.huella },
        },
      ],
    };
  },
};

// ---------------------------------------------------------------------
// Informe en vivo de UNA incidencia (AÑADIDO por el constructor G,
// 2026-09-19, para el visor /incidencias/[id] · petición de Javi: "que se
// pueda sacar un informe en vivo de comunicaciones que se están haciendo").
// No toca nada de lo anterior: es una función nueva que reutiliza las mismas
// piezas deterministas. El acta SIEMPRE sale; la narrativa es un extra.
// ---------------------------------------------------------------------

/** Enmascara teléfonos y correos: el acta viaja fuera del sistema. */
function destinoSeguro(valor?: string): string {
  const d = (valor ?? "").trim();
  if (!d) return sinDato;
  if (d.includes("@")) {
    const [usuario, dominio] = d.split("@");
    return `${usuario.slice(0, 2)}${"•".repeat(Math.max(1, usuario.length - 2))}@${dominio}`;
  }
  const digitos = d.replace(/[^\d+]/g, "");
  return digitos.length >= 6 ? `${digitos.slice(0, 4)}${"•".repeat(Math.max(2, digitos.length - 6))}${digitos.slice(-2)}` : d;
}

const TIPOS_COMUNICACION = new Set<Accion["tipo"]>([
  "llamar",
  "enviar_sms",
  "enviar_email",
  "enviar_telegram",
  "avisar_poblacion",
  "confinar_poblacion",
  "evacuar_poblacion",
  "publicar_comunicado",
  "solicitar_confirmacion",
  "abrir_ticket",
]);

/** Una línea por comunicación ejecutada, con su resultado REAL. */
function lineaComunicacion(a: Accion, d: Decision, ctx: ContextoAgente): string {
  const cuando = a.ejecutadaEn ?? a.ordenadaEn ?? d.creadaEn;
  const destino =
    a.objetivo?.telefono || a.objetivo?.email
      ? destinoSeguro(a.objetivo.telefono ?? a.objetivo.email)
      : a.objetivo?.poblacionId
        ? ctx.snapshot.poblaciones.find((p) => p.id === a.objetivo?.poblacionId)?.nombre ?? a.objetivo.poblacionId
        : a.objetivo?.unidadId
          ? ctx.snapshot.unidades.find((u) => u.id === a.objetivo?.unidadId)?.nombre ?? a.objetivo.unidadId
          : sinDato;
  const r = a.resultado;
  const resultado = r
    ? `**${r.exito ? "ÉXITO" : "FALLO"}** · ${r.proveedor}${r.referencia ? ` · ref. \`${r.referencia}\`` : ""} — ${r.resumen}`
    : `sin resultado (estado ${a.estado})`;
  const extra = r?.datos
    ? Object.entries(r.datos)
        .filter(([k, v]) => /(transcrip|confirm|respuesta|mensaje|contest)/i.test(k) && (typeof v === "string" || typeof v === "boolean"))
        .map(([k, v]) => `\n    - ${k}: ${typeof v === "boolean" ? (v ? "sí" : "no") : String(v).slice(0, 600)}`)
        .join("")
    : "";
  return `- \`${cuando}\` **${a.tipo.replace(/_/g, " ")}** → ${destino} · ${resultado}${extra}`;
}

/**
 * Parte de situación de UN incendio, con la cronología de comunicaciones y su
 * resultado real, para el visor de la incidencia. No lo guarda en el estado:
 * eso lo hace quien lo pide (POST /api/incidencias/[id]/informe).
 */
export async function informeSituacionIncendio(incendio: Incendio, ctx: ContextoAgente): Promise<Informe> {
  const id = nuevoIdInforme();
  // Los focos absorbidos por fusión conservan su propio id en todo lo que
  // registraron: forman parte de esta misma incidencia.
  const idsFoco = new Set<string>([incendio.id]);
  const porVisitar = [incendio.id];
  while (porVisitar.length) {
    const actual = porVisitar.pop() as string;
    for (const absorbido of ctx.snapshot.incendios.find((i) => i.id === actual)?.focosAbsorbidos ?? []) {
      if (!idsFoco.has(absorbido)) {
        idsFoco.add(absorbido);
        porVisitar.push(absorbido);
      }
    }
  }
  const deEsteFoco = (otro?: string) => Boolean(otro && idsFoco.has(otro));

  const decisiones = ctx.snapshot.decisiones
    .filter((d) => deEsteFoco(d.incendioId))
    .sort((a, b) => a.creadaEn.localeCompare(b.creadaEn));
  const unidades = ctx.snapshot.unidades.filter((u) => deEsteFoco(u.incendioId));
  const poblaciones = ctx.snapshot.poblaciones
    .filter((p) => deEsteFoco(p.incendioId))
    .sort((a, b) => (a.etaFrenteMin ?? 1e9) - (b.etaFrenteMin ?? 1e9));
  const observaciones = ctx.snapshot.observaciones.filter((o) => deEsteFoco(o.incendioId));
  const idsDecision = new Set(decisiones.map((d) => d.id));
  const actas = (ctx.snapshot.informes ?? [])
    .filter((i) => deEsteFoco(i.incendioId) || (i.decisionId && idsDecision.has(i.decisionId)))
    .sort((a, b) => a.generadoEn.localeCompare(b.generadoEn));

  const comunicaciones = decisiones
    .flatMap((d) => d.acciones.filter((a) => TIPOS_COMUNICACION.has(a.tipo) && (a.ordenadaEn || a.ejecutadaEn)).map((a) => ({ a, d })))
    .sort((x, y) => (x.a.ejecutadaEn ?? x.a.ordenadaEn ?? "").localeCompare(y.a.ejecutadaEn ?? y.a.ordenadaEn ?? ""));
  const despliegues = decisiones.flatMap((d) =>
    d.acciones.filter((a) => a.tipo === "desplegar_unidad" || a.tipo === "reasignar_unidad" || a.tipo === "retirar_unidad").map((a) => ({ a, d })),
  );

  ctx.informarTarea(`Levantando el informe en vivo de «${incendio.nombre}»`, incendio.id);

  const acta = [
    `# Informe en vivo · ${incendio.nombre}`,
    ``,
    `| Campo | Valor |`,
    `|---|---|`,
    `| Informe | \`${id}\` |`,
    `| Tipo | situación (una sola incidencia) |`,
    `| Generado (real) | ${new Date().toISOString()} |`,
    `| Hora de mundo | ${ctx.ahoraMundo} |`,
    `| Ejecución | ${ctx.snapshot.ejecucion.nombre} (\`${ctx.snapshot.ejecucion.id}\`) |`,
    `| Incendio | \`${incendio.id}\` |`,
    ``,
    `## 1. Situación`,
    ``,
    describirIncendio(incendio),
    ...(incendio.focosAbsorbidos?.length
      ? [`- **Focos absorbidos por fusión**: ${incendio.focosAbsorbidos.map((otro) => `${ctx.snapshot.incendios.find((i) => i.id === otro)?.nombre ?? otro} (\`${otro}\`)`).join(", ")}`]
      : []),
    ...(incendio.fusionadoEn
      ? [`- **Este foco se unió a**: \`${incendio.fusionadoEn}\` (${ctx.snapshot.incendios.find((i) => i.id === incendio.fusionadoEn)?.nombre ?? "foco superviviente"})`]
      : []),
    ``,
    `## 2. Cronología de comunicaciones (con resultado real)`,
    ``,
    comunicaciones.length ? comunicaciones.map(({ a, d }) => lineaComunicacion(a, d, ctx)).join("\n") : `_Todavía no se ha ejecutado ninguna comunicación para este incendio._`,
    ``,
    `## 3. Decisiones y su estado`,
    ``,
    decisiones.length
      ? decisiones
          .map((d) =>
            [
              `- \`${d.creadaEn}\` **${d.titulo}** — ${d.agenteId} · estado **${d.estado}** · competencia ${d.competencia} · riesgo ${d.riesgo}/100 · prioridad ${d.prioridad}` +
                (d.decididaPor ? ` · decidida por ${d.decididaPor}` : "") +
                (d.comentarioHumano ? ` · comentario del mando: «${d.comentarioHumano}»` : "") +
                (d.evaluacion ? ` · supervisor ${d.evaluacion.puntuacion}/100 (${d.evaluacion.aprueba ? "aprueba" : "suspende"})` : ""),
              ...(d.historial ?? []).map((h) => `  - ${h.en} (mundo ${h.enMundo}) → **${h.estado}** · ${h.quien}${h.motivo ? ` — ${h.motivo}` : ""}`),
            ].join("\n"),
          )
          .join("\n")
      : `_Ninguna decisión registrada todavía._`,
    ``,
    `## 4. Unidades y posiciones`,
    ``,
    unidades.length
      ? unidades
          .map(
            (u) =>
              `- **${u.nombre}** [${u.tipo}] · ${u.estado} · posición ${u.posicion.lat.toFixed(5)}, ${u.posicion.lon.toFixed(5)}` +
              (u.sector ? ` · sector ${u.sector}` : "") +
              (u.ruta
                ? ` · ruta ${u.ruta.fuente} ${(u.ruta.distanciaM / 1000).toFixed(1)} km / ${Math.round(u.ruta.duracionS / 60)} min · progreso ${(u.ruta.progreso * 100).toFixed(0)} % · llegada prevista ${u.ruta.llegadaPrevista}`
                : "") +
              (u.ultimaOrden ? ` · última orden: «${u.ultimaOrden.texto}» (${u.ultimaOrden.en})` : "") +
              (u.ultimoContacto ? ` · último contacto por ${u.ultimoContacto.canal}: ${u.ultimoContacto.resultado}` : ""),
          )
          .join("\n")
      : `_Sin medios asignados._`,
    ``,
    `## 5. Poblaciones y avisos`,
    ``,
    poblaciones.length
      ? poblaciones
          .map(
            (p) =>
              `- **${p.nombre}** (${p.tipo}${p.habitantes ? `, ${p.habitantes} hab.` : ""}) · riesgo ${p.riesgo} · ${p.distanciaKm.toFixed(1)} km · ETA del frente ${p.etaFrenteMin ?? "—"} min · aviso: **${p.estadoAviso}**` +
              (p.ultimoContacto ? ` · último contacto ${p.ultimoContacto.en} por ${p.ultimoContacto.canal}: ${p.ultimoContacto.resultado}` : "") +
              (p.telefono ? ` · teléfono ${destinoSeguro(p.telefono)}${p.telefonoEsDemo ? " (DESTINO_DEMO)" : ""}` : ""),
          )
          .join("\n")
      : `_Sin núcleos de población cargados._`,
    ``,
    `## 6. Percepción y despliegues`,
    ``,
    `- Observaciones recibidas: ${observaciones.length}${observaciones.length ? ` (${[...new Set(observaciones.map((o) => o.canal))].join(", ")})` : ""}`,
    `- Despliegues ordenados: ${despliegues.length}`,
    `- Comunicados publicados: ${ctx.snapshot.comunicados.filter((c) => deEsteFoco(c.incendioId) && c.estado === "publicado").length}`,
    ``,
    `## 7. Actas relacionadas (${actas.length})`,
    ``,
    actas.length
      ? actas.map((i) => `- \`${i.id}\` · ${i.tipo}${i.estadoDecision ? ` (${i.estadoDecision})` : ""} · ${i.titulo} · ${i.generadoEn}${i.huella ? ` · huella \`${i.huella.slice(0, 16)}…\`` : ""}`).join("\n")
      : `_Ninguna acta previa para esta incidencia._`,
  ].join("\n");

  let narrativa = "";
  let conIA = false;
  let modelo = "determinista";
  if (proveedorDisponible()) {
    try {
      const r = await completarTexto({
        permitirEnPausa: true,
        papel: "razonamiento",
        maxTokens: 5000,
        signal: AbortSignal.timeout(TIMEOUT_NARRATIVA_MS),
        system:
          "Eres el analista de guardia de un centro de coordinación de incendios forestales en España. " +
          "Te dan el parte en vivo de UNA incidencia con todos los hechos verificables. Escribes en markdown y en español, " +
          "solo con lo que aparece en el parte; si algo no consta, lo dices. Un mando tiene que entenderlo en 30 segundos.",
        user:
          `${acta.slice(0, 14000)}\n\n---\n\n` +
          `Escribe "Cuadro de la incidencia" (máximo 140 palabras), "Comunicaciones: qué ha funcionado y qué no" (3 puntos) ` +
          `y "Qué vigilar ahora" (3 puntos). No empieces con un encabezado de nivel 1.`,
      });
      narrativa = r.datos.trim();
      conIA = true;
      modelo = r.modelo;
    } catch (e) {
      console.warn(`[redactor] informe en vivo sin narrativa: ${e instanceof Error ? e.message : e}`);
    }
  }

  const cuerpo =
    `${acta}\n\n## Lectura de la situación\n\n` +
    (conIA
      ? narrativa
      : `_Informe sin narrativa: el proveedor de IA no estaba disponible o no respondió en ${Math.round(TIMEOUT_NARRATIVA_MS / 1000)} s. ` +
        `Todos los hechos anteriores son verificables y no dependen de ningún modelo._`);

  const huella = huellaDe(cuerpo);
  const informe: Informe = {
    id,
    ejecucionId: ctx.snapshot.ejecucion.id,
    incendioId: incendio.id,
    titulo: `Informe en vivo · ${incendio.nombre} · ${ctx.ahoraMundo.slice(11, 16)} (hora de mundo)`,
    contenido: `${cuerpo}\n\n---\n\n_Acta \`${id}\` · huella SHA-256 \`${huella}\` · generada por Atalaya el ${new Date().toISOString()}._\n`,
    decisionesConsideradas: decisiones.map((d) => d.id),
    generadoEn: new Date().toISOString(),
    modelo,
    tipo: "situacion",
    agenteId: "redactor",
    conNarrativaIA: conIA,
    huella,
  };
  await persistirInforme(informe);
  return informe;
}
