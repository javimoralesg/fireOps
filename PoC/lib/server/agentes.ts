// Interrogatorio a la IA (Comité Asesor / supervisión humana, art. 14 RIA):
// responde SOLO con la evidencia, la doctrina y la traza de la decisión.
// Respuesta en Markdown con citas inline [n] (n = posición 1-based en `citas`).
// LLM real siempre que haya uno (Claude u Ollama local, conectores/llm.ts). Si
// ningún LLM responde, la respuesta se compone a partir de la traza real según
// la intención, y se etiqueta como tal (nunca se presenta como IA).

import { z } from "zod";
import type { Decision, EstadoSistema, Evidencia, ReglaDoctrina } from "../tipos-sistema";
import { generarEstructurado, llmDisponible, modeloLLM } from "./conectores/llm";

export interface RespuestaAgente {
  respuesta: string; // markdown con [n]
  citas: Evidencia[];
  reglasAplicadas: string[];
  modelo: string;
  latenciaMs: number;
  decisionId?: string;
}

type Intencion = "porque" | "evidencia" | "doctrina" | "no_actuar" | "alternativas" | "riesgo" | "estado" | "modelo" | "resumen";

const fmt = (iso: string) => new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const PATRONES: [Intencion, RegExp][] = [
  ["alternativas", /alternativ|descart|otra opcion|otras opciones|en lugar de|plan b/],
  ["no_actuar", /no actu|no hac|si no |coste|costo|consecuencia|esperar|inaccion|que pasa si/],
  ["doctrina", /doctrina|regla|restriccion|norma|aprendid/],
  ["evidencia", /evidencia|dato|fuente|respald|sensor|prueba|basa|en que te|confianza|medicion/],
  ["modelo", /modelo|llm|claude|latencia|procesad|que ia|haiku|opus/],
  ["riesgo", /riesgo|umbral|autonom|firma|peligro|grave/],
  ["estado", /quien|aprob|deneg|estado|ejecut|resultado|invalid|feedback|decidi|escal/],
  ["porque", /por que|porque|razon|motivo|justific|explica|objetivo/],
];

export function detectarIntencion(pregunta: string): Intencion {
  const t = norm(pregunta);
  return PATRONES.find(([, re]) => re.test(t))?.[0] ?? "resumen";
}

class Citas {
  lista: Evidencia[] = [];
  marca(e: Evidencia) {
    let i = this.lista.findIndex((x) => x.id === e.id);
    if (i < 0) {
      this.lista.push(e);
      i = this.lista.length - 1;
    }
    return `[${i + 1}]`;
  }
}

const linea = (e: Evidencia, c: Citas) => `- **${e.fuente}** · ${e.descripcion}${e.unidad && e.unidad !== "confianza" ? ` — \`${e.valor} ${e.unidad}\`` : ""} · confianza ${Math.round(e.confianza * 100)} %${e.fuente === "Escenario" ? " · _dato de guion_" : ""} ${c.marca(e)}`;
const SIN = "_No consta en la traza._";

function contexto(e: EstadoSistema, d?: Decision) {
  const reglas = d ? e.doctrina.filter((r) => d.reglasAplicadas.includes(r.id)) : e.doctrina.filter((r) => r.activa);
  const traza = d ? e.timeline.filter((t) => t.ref === d.id) : e.timeline.slice(0, 15);
  const evidencia = [...(d ? d.evidencia : e.decisiones.slice(0, 3).flatMap((x) => x.evidencia))].sort((a, b) => b.confianza - a.confianza);
  return { reglas, traza, evidencia };
}

function seccionReglas(reglas: ReglaDoctrina[]) {
  return reglas.length ? reglas.map((r) => `- ${r.reglaNormalizada} — fijada por **${r.origen.rol}** el ${fmt(r.origen.timestamp)}${r.origen.decisionId ? ` al denegar \`${r.origen.decisionId}\`` : ""} (aplicada ${r.vecesAplicada} veces)`) : ["- Ninguna regla de doctrina aplicada."];
}

function responderPorPlantilla(pregunta: string, e: EstadoSistema, d?: Decision): Omit<RespuestaAgente, "modelo" | "latenciaMs"> {
  const { reglas, traza, evidencia } = contexto(e, d);
  const c = new Citas();
  const intencion = detectarIntencion(pregunta);
  const l: string[] = [];
  const t = d?.tarjeta;

  if (!d) {
    l.push(`**Sin decisión seleccionada.** Respondo con el estado general del incidente (${e.incidente.titulo}, fase ${e.incidente.fase}).`, "");
    if (intencion === "doctrina" || intencion === "resumen") l.push("**Doctrina activa**", "", ...seccionReglas(reglas), "");
    if (intencion === "evidencia" || intencion === "resumen") {
      l.push(`**Últimos datos registrados (${Math.min(evidencia.length, 8)} de ${evidencia.length})**`, "");
      for (const x of evidencia.slice(0, 8)) l.push(linea(x, c));
    }
    if (intencion === "alternativas" || intencion === "estado") {
      l.push("**Decisiones del incidente**", "");
      for (const x of e.decisiones.slice(0, 8)) l.push(`- \`${x.id}\` ${x.tarjeta.titulo} — **${x.estado}** (riesgo ${x.riesgo})${x.feedback ? ` · denegada: "${x.feedback}"` : ""}`);
      l.push("", "Selecciona una decisión para ver sus alternativas descartadas.");
    }
    if (l.length <= 2) l.push("No dispongo de información registrada para responder a eso; solo puedo contestar con la evidencia, la doctrina y la traza de las decisiones.");
    return { respuesta: l.join("\n"), citas: c.lista, reglasAplicadas: reglas.map((r) => r.id) };
  }

  switch (intencion) {
    case "porque":
      l.push(`**Propuesta:** ${t!.titulo}`, "", t!.resumen, "", "**Razonamiento registrado**", "", `> ${t!.plan.razonamiento}`, "", `**Protocolo:** \`${t!.protocolo.codigo}\` — ${t!.protocolo.nombre}`, "", `**Acciones (${t!.plan.acciones.length})**`, "");
      for (const a of t!.plan.acciones) l.push(`- **${a.recurso}**: ${a.accion} · ETA ${a.eta} · prioridad ${a.prioridad}`);
      l.push("", "**Datos principales en los que se apoya**", "");
      for (const x of evidencia.slice(0, 3)) l.push(linea(x, c));
      break;
    case "evidencia": {
      const fuentes = new Set(evidencia.map((x) => x.fuente));
      const bajas = evidencia.filter((x) => x.confianza < 0.5).length;
      l.push(`La traza registra **${evidencia.length} datos** de **${fuentes.size} fuentes**, por confianza:`, "");
      for (const x of evidencia.slice(0, 10)) l.push(linea(x, c));
      if (bajas) l.push("", `**Atención:** ${bajas} dato(s) con confianza inferior al 50 %.`);
      break;
    }
    case "doctrina":
      l.push("**Reglas de doctrina aplicadas a esta propuesta**", "", ...seccionReglas(reglas));
      if (t!.plan.restricciones.length) l.push("", "**Restricciones del mando en este incidente**", "", ...t!.plan.restricciones.map((r) => `- "${r}"`));
      break;
    case "no_actuar":
      l.push("**Coste de no actuar (registrado en la propuesta)**", "", d.costeDeNoActuar, "", `**Plazo útil:** hasta las ${fmt(d.plazo)} (urgencia ${d.urgencia}).`, "", "**Impacto en cascada según el grafo**", "");
      for (const x of t!.domino.slice(0, 4)) l.push(`- ${x.infraestructura} — riesgo ${x.riesgo}/100 · ${x.ruta.join(" → ")}`);
      const dom = evidencia.filter((x) => x.fuente === "Grafo").slice(0, 2);
      if (dom.length) l.push("", ...dom.map((x) => linea(x, c)));
      break;
    case "alternativas":
      if (d.alternativasDescartadas?.length) {
        l.push("**Alternativas consideradas y descartadas**", "");
        for (const a of d.alternativasDescartadas) l.push(`- **${a.opcion}** — ${a.motivo}`);
      } else l.push("**Alternativas:** " + SIN);
      {
        const previas = e.decisiones.filter((x) => x.foco === d.foco && x.id !== d.id);
        if (previas.length) l.push("", "**Versiones anteriores del mismo foco**", "", ...previas.map((x) => `- v${x.tarjeta.plan.version} \`${x.id}\` — ${x.estado}${x.feedback ? ` · motivo: "${x.feedback}"` : ""}`));
      }
      break;
    case "riesgo":
      l.push(`**Riesgo:** ${d.riesgo}/100 · **Urgencia:** ${d.urgencia} · **Umbral de autonomía:** ${e.umbralAutonomia}`, "", d.riesgo <= e.umbralAutonomia ? "Está por debajo del umbral: la IA puede ejecutarla sin firma humana." : "Supera el umbral: requiere firma de un rol con autoridad suficiente.", "", `**Coste de no actuar:** ${d.costeDeNoActuar}`);
      break;
    case "estado":
      l.push(`**Estado:** ${d.estado}${d.decididaPor ? ` — por **${d.decididaPor.rol}** el ${fmt(d.decididaPor.timestamp)} vía ${d.decididaPor.via}` : ""}`);
      if (d.escaladaA) l.push(`**Escalada** a ${d.escaladaA.rol} por ${d.escaladaA.por} (${fmt(d.escaladaA.timestamp)}).`);
      if (d.feedback) l.push(`**Motivo de denegación:** "${d.feedback}"`);
      if (d.motivoInvalidacion) l.push(`**Invalidada:** ${d.motivoInvalidacion}`);
      if (d.resultadoEjecucion?.length) l.push("", "**Resultado de la ejecución**", "", ...d.resultadoEjecucion.map((r) => `- ${r.canal} · ${r.proveedor} · ${r.ok ? "OK" : "FALLO"} — ${r.detalle}`));
      l.push("", "**Traza**", "", ...traza.slice(0, 8).map((x) => `- ${fmt(x.timestamp)} · ${x.tipo}: ${x.texto}`));
      break;
    case "modelo":
      l.push("**Modelos que intervinieron**", "", ...(d.procesadoPor ?? []).map((p) => `- ${p.tarea}: \`${p.modelo}\` · ${p.latenciaMs} ms`));
      l.push("", `Los eventos de entrada se clasificaron con el enrutador ligero (ver \`procesadoPor\` de cada evento). ${e.iaDisponible ? "" : "_Sin LLM disponible en el servidor: esta respuesta se compone de la traza registrada._"}`);
      break;
    default:
      l.push(`**${t!.titulo}** — ${d.estado}, urgencia ${d.urgencia}, riesgo ${d.riesgo}/100.`, "", t!.resumen, "", "**Datos clave**", "");
      for (const x of evidencia.slice(0, 3)) l.push(linea(x, c));
      l.push("", "**Doctrina**", "", ...seccionReglas(reglas), "", "Pregunta por *evidencia*, *doctrina*, *alternativas*, *riesgo* o *qué pasa si no actuamos* para más detalle.");
  }
  return { respuesta: l.join("\n"), citas: c.lista, reglasAplicadas: reglas.map((r) => r.id), decisionId: d.id };
}

const SISTEMA_INTERROGATORIO =
  "Eres el agente de decisión de un centro de mando de emergencias municipal, interrogado por el Comité Asesor (supervisión humana). Responde en español, en Markdown breve con secciones y listas, sin especular. SOLO puedes usar la evidencia, las reglas de doctrina y la traza que se te dan. Cita la evidencia INLINE en el texto con el marcador [n] (el número de la lista de EVIDENCIA) justo después de la frase que la usa, y devuelve también los ids en evidenciaIds. Si la información no está en esos datos, dilo explícitamente.";

const EsquemaRespuesta = z.object({ respuesta: z.string(), evidenciaIds: z.array(z.string()), reglaIds: z.array(z.string()) });

const SIN_LLM = "sin-llm · compuesta de la traza";

export async function preguntar(pregunta: string, e: EstadoSistema, decisionId?: string): Promise<RespuestaAgente> {
  const t0 = Date.now();
  const d = decisionId ? e.decisiones.find((x) => x.id === decisionId) : undefined;
  if (decisionId && !d) throw new Error(`Decisión ${decisionId} no encontrada`);
  if (!llmDisponible()) return { ...responderPorPlantilla(pregunta, e, d), modelo: SIN_LLM, latenciaMs: Date.now() - t0 };
  const { reglas, traza, evidencia } = contexto(e, d);
  const numerada = evidencia.slice(0, 20);
  const contextoTexto = `PREGUNTA: ${pregunta}\n\n${d ? `DECISIÓN: ${d.tarjeta.titulo} · estado ${d.estado} · urgencia ${d.urgencia} · riesgo ${d.riesgo}\nRAZONAMIENTO: ${d.tarjeta.plan.razonamiento}\nACCIONES: ${d.tarjeta.plan.acciones.map((a) => `${a.recurso}: ${a.accion}`).join("; ")}\nCOSTE DE NO ACTUAR: ${d.costeDeNoActuar}\nALTERNATIVAS DESCARTADAS: ${(d.alternativasDescartadas ?? []).map((a) => `${a.opcion} (${a.motivo})`).join("; ") || "no registradas"}\n${d.feedback ? `FEEDBACK DEL MANDO: ${d.feedback}\n` : ""}` : ""}EVIDENCIA (usa [n]):\n${numerada.map((x, i) => `[${i + 1}] id=${x.id} · ${x.fuente} · ${x.descripcion} · ${fmt(x.timestamp)} · confianza ${Math.round(x.confianza * 100)} %`).join("\n")}\n\nDOCTRINA:\n${reglas.map((r) => `- [${r.id}] ${r.reglaNormalizada} (origen ${r.origen.rol})`).join("\n") || "- ninguna"}\n\nTRAZA:\n${traza.map((x) => `- ${fmt(x.timestamp)} ${x.tipo}: ${x.texto}`).join("\n")}`;
  try {
    const r = await generarEstructurado(EsquemaRespuesta, {
      system: SISTEMA_INTERROGATORIO,
      user: contextoTexto,
      nivel: "plan",
      maxTokens: 1500,
      timeoutMs: 180_000, // Ollama local puede tardar; Claude responde en segundos
      effort: "low",
    });
    const o = r.datos;
    // citas = la lista numerada tal cual, para que [n] del texto coincida con la posición 1-based
    return {
      respuesta: o.respuesta,
      citas: numerada,
      reglasAplicadas: reglas.filter((x) => o.reglaIds.includes(x.id)).map((x) => x.id),
      modelo: r.proveedor === "ollama" ? `ollama/${r.modelo}` : r.modelo,
      latenciaMs: r.latenciaMs,
      decisionId: d?.id,
    };
  } catch (err) {
    console.warn("[agentes] ningún LLM respondió, respuesta compuesta de la traza:", err instanceof Error ? err.message : err);
    return { ...responderPorPlantilla(pregunta, e, d), modelo: `${modeloLLM("plan")} sin respuesta → ${SIN_LLM}`, latenciaMs: Date.now() - t0 };
  }
}
