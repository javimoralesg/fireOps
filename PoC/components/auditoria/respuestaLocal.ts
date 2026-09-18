// Fallback determinista del interrogatorio a la IA.
// Cuando POST /api/agentes/preguntar no existe o falla, responde SOLO con lo que
// consta en la traza de la decisión (tarjeta, evidencia, doctrina, riesgo, feedback…).
// Nunca inventa datos: si algo no está registrado, lo dice.

import type { Decision, EstadoSistema, Evidencia, ReglaDoctrina } from "@/lib/tipos-sistema";
import { ESTADO_UI, focoUI, formatearHora, formatearValor, fuenteUI, nombreRol, TAREA_UI } from "./ui";

export interface RespuestaIA {
  respuesta: string; // markdown; las citas se marcan como [n] (índice 1-based en `citas`)
  citas: Evidencia[];
  reglasAplicadas: string[];
  modelo: string;
  latenciaMs: number;
}

export const MODELO_TRAZA = "traza-determinista";

export type Intencion =
  | "porque"
  | "evidencia"
  | "doctrina"
  | "no_actuar"
  | "alternativas"
  | "riesgo"
  | "estado"
  | "modelo"
  | "resumen";

function normalizar(t: string) {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const PATRONES: [Intencion, RegExp][] = [
  ["alternativas", /alternativ|descart|otra opcion|otras opciones|en lugar de|opcion b|plan b/],
  ["no_actuar", /no actu|no hac|si no |no lo hac|coste|costo|consecuencia|esperamos|esperar|inaccion|que pasa si/],
  ["doctrina", /doctrina|regla|restriccion|norma|protocolo|aprendid/],
  ["evidencia", /evidencia|dato|fuente|respald|sensor|prueba|basa|en que te|confianza|medicion/],
  ["modelo", /modelo|llm|claude|latencia|procesad|que ia|haiku|sonnet|opus/],
  ["riesgo", /riesgo|umbral|autonom|firma|peligro|grave/],
  ["estado", /quien|aprob|deneg|estado|ejecut|resultado|invalid|feedback|decidi/],
  ["porque", /por que|porque|razon|motivo|justific|explica|para que|objetivo/],
];

export function detectarIntencion(pregunta: string): Intencion {
  const t = normalizar(pregunta);
  for (const [intencion, re] of PATRONES) if (re.test(t)) return intencion;
  return "resumen";
}

/** Acumula citas y devuelve el marcador [n] de cada evidencia. */
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

function lineaEvidencia(e: Evidencia, citas: Citas) {
  const guion = e.fuente === "Escenario" ? " · _dato de guion_" : "";
  return `- **${fuenteUI(e.fuente).etiqueta}** · ${e.descripcion} — \`${formatearValor(e.valor, e.unidad === "confianza" ? undefined : e.unidad)}\` · confianza ${Math.round((e.confianza ?? 0) * 100)} %${guion} ${citas.marca(e)}`;
}

function porConfianza(ev: Evidencia[]) {
  return [...ev].sort((a, b) => (b.confianza ?? 0) - (a.confianza ?? 0));
}

function reglasDe(d: Decision, doctrina: ReglaDoctrina[]) {
  const porId = new Map(doctrina.map((r) => [r.id, r]));
  return d.reglasAplicadas.map((id) => ({ id, regla: porId.get(id) }));
}

const SIN_REGISTRO = "_No consta en la traza._";

function responderDecision(intencion: Intencion, d: Decision, estado: EstadoSistema): { texto: string; citas: Citas } {
  const citas = new Citas();
  const t = d.tarjeta;
  const plan = t?.plan;
  const ev = porConfianza(d.evidencia ?? []);
  const umbral = estado.umbralAutonomia;
  const l: string[] = [];

  switch (intencion) {
    case "porque": {
      l.push(`**Propuesta:** ${t?.titulo ?? focoUI(d.foco)}`);
      if (t?.resumen) l.push("", t.resumen);
      l.push("", "**Razonamiento registrado por el agente**", "", plan?.razonamiento ? `> ${plan.razonamiento.replace(/\n+/g, "\n> ")}` : SIN_REGISTRO);
      if (t?.protocolo) l.push("", `**Protocolo:** \`${t.protocolo.codigo}\` — ${t.protocolo.nombre}`);
      if (plan?.acciones?.length) {
        l.push("", `**Acciones propuestas (${plan.acciones.length})**`, "");
        for (const a of plan.acciones) l.push(`- **${a.recurso}**: ${a.accion} · ETA ${a.eta} · prioridad ${a.prioridad}`);
      }
      if (ev.length) {
        l.push("", "**Datos principales en los que se apoya**", "");
        for (const e of ev.slice(0, 3)) l.push(lineaEvidencia(e, citas));
      }
      break;
    }
    case "evidencia": {
      if (!ev.length) {
        l.push("La propuesta **no aporta evidencia** en su traza. Conviene pedir datos antes de firmar.");
        break;
      }
      const fuentes = new Set(ev.map((e) => e.fuente));
      const bajas = ev.filter((e) => (e.confianza ?? 0) < 0.5).length;
      const guion = ev.filter((e) => e.fuente === "Escenario").length;
      l.push(`La traza registra **${ev.length} datos** de **${fuentes.size} fuentes**, ordenados por confianza:`, "");
      for (const e of ev.slice(0, 10)) l.push(lineaEvidencia(e, citas));
      if (ev.length > 10) l.push("", `…y ${ev.length - 10} más en el panel de traza.`);
      if (bajas) l.push("", `**Atención:** ${bajas} ${bajas === 1 ? "dato tiene" : "datos tienen"} confianza inferior al 50 %.`);
      if (guion) l.push("", `**Nota:** ${guion} ${guion === 1 ? "dato procede" : "datos proceden"} del guion de la demo, no de una fuente real.`);
      break;
    }
    case "doctrina": {
      const reglas = reglasDe(d, estado.doctrina);
      if (!reglas.length) {
        l.push("La traza **no registra ninguna regla de doctrina** aplicada al generar esta propuesta.");
      } else {
        l.push(`Al proponer se aplicaron **${reglas.length} ${reglas.length === 1 ? "regla" : "reglas"} de doctrina**:`, "");
        for (const { id, regla } of reglas) {
          if (!regla) l.push(`- \`${id}\` — la regla ya no está en la doctrina vigente.`);
          else
            l.push(
              `- **${regla.reglaNormalizada}** (\`${id}\`) — ${regla.ambito === "global" ? "permanente" : "solo este incidente"}, aprendida de ${nombreRol(regla.origen.rol)}: _"${regla.texto}"_${regla.activa ? "" : " · **desactivada**"}`,
            );
        }
      }
      if (plan?.restricciones?.length) {
        l.push("", "**Restricciones que el plan declara respetar**", "");
        for (const r of plan.restricciones) l.push(`- ${r}`);
      }
      if (t?.protocolo) l.push("", `Protocolo de referencia: \`${t.protocolo.codigo}\` — ${t.protocolo.nombre}.`);
      break;
    }
    case "no_actuar": {
      l.push("**Coste de no actuar registrado por el agente**", "", d.costeDeNoActuar ? `> ${d.costeDeNoActuar}` : SIN_REGISTRO);
      l.push("", `- Urgencia: **${d.urgencia}** · riesgo **${d.riesgo}/100**`);
      if (d.plazo) l.push(`- Plazo útil para decidir: hasta las **${formatearHora(d.plazo)}**`);
      if (t?.domino?.length) {
        l.push("", "**Efecto dominó calculado sobre el grafo de dependencias**", "");
        for (const x of [...t.domino].sort((a, b) => b.riesgo - a.riesgo))
          l.push(`- **${x.infraestructura}** — riesgo ${x.riesgo} %${x.ruta?.length ? ` · vía ${x.ruta.join(" → ")}` : ""}`);
      }
      const grafo = ev.filter((e) => e.fuente === "Grafo");
      if (grafo.length) {
        l.push("");
        for (const e of grafo.slice(0, 3)) l.push(lineaEvidencia(e, citas));
      }
      break;
    }
    case "alternativas": {
      const alts = d.alternativasDescartadas ?? [];
      if (alts.length) {
        l.push(`El agente consideró y **descartó ${alts.length} ${alts.length === 1 ? "alternativa" : "alternativas"}**:`, "");
        for (const a of alts) l.push(`- **${a.opcion}** → ${a.motivo}`);
        l.push("", "Además, sobre cómo cambió la propuesta:", "");
      } else {
        l.push("La traza **no guarda un registro explícito de alternativas descartadas**. Esto es lo que sí consta sobre cómo cambió la propuesta:", "");
      }
      l.push(`- Versión del plan: **v${plan?.version ?? 1}**${plan && plan.version > 1 ? ` (se replanificó ${plan.version - 1} ${plan.version - 1 === 1 ? "vez" : "veces"})` : ""}`);
      if (plan?.restricciones?.length) l.push(`- Restricciones que descartaron opciones: ${plan.restricciones.map((r) => `_${r}_`).join("; ")}`);
      const reglas = reglasDe(d, estado.doctrina).filter((r) => r.regla);
      for (const { regla } of reglas) l.push(`- Doctrina aplicada: _${regla!.reglaNormalizada}_`);
      if (d.feedback) l.push(`- Feedback humano: _"${d.feedback}"_`);
      if (d.motivoInvalidacion) l.push(`- Invalidada: ${d.motivoInvalidacion}`);
      if (!plan?.restricciones?.length && !reglas.length && !d.feedback && !d.motivoInvalidacion && (plan?.version ?? 1) <= 1)
        l.push("- No hay restricciones, feedback ni replanificaciones registradas: es la primera propuesta del agente.");
      break;
    }
    case "riesgo": {
      const supera = d.riesgo > umbral;
      l.push(`Riesgo estimado: **${d.riesgo}/100** · umbral de autonomía vigente: **${umbral}/100**.`, "");
      l.push(
        supera
          ? "- El riesgo **supera el umbral**: la IA no puede ejecutarla sola y **requiere firma humana**."
          : "- El riesgo está **por debajo del umbral**: la IA puede ejecutarla de forma autónoma (queda registrada para auditoría).",
      );
      l.push(`- Urgencia **${d.urgencia}**${t?.severidad ? ` · severidad **${t.severidad}**` : ""}`);
      if (t?.domino?.length) {
        const peor = [...t.domino].sort((a, b) => b.riesgo - a.riesgo)[0];
        l.push(`- Mayor impacto en cadena: **${peor.infraestructura}** (${peor.riesgo} %)`);
      }
      break;
    }
    case "estado": {
      l.push(`Estado: **${ESTADO_UI[d.estado]?.etiqueta ?? d.estado}**.`, "");
      if (d.decididaPor) l.push(`- Decidida por **${nombreRol(d.decididaPor.rol)}** vía ${d.decididaPor.via} a las ${formatearHora(d.decididaPor.timestamp)}.`);
      else if (d.estado === "auto") l.push("- Ejecutada por la IA sin firma humana (riesgo bajo el umbral).");
      else if (d.estado === "pendiente") l.push("- Aún no la ha firmado nadie.");
      if (d.feedback) l.push(`- Feedback: _"${d.feedback}"_`);
      if (d.motivoInvalidacion) l.push(`- Motivo de invalidación: ${d.motivoInvalidacion}`);
      if (d.resultadoEjecucion?.length) {
        l.push("", "**Ejecución**", "");
        for (const r of d.resultadoEjecucion)
          l.push(`- ${r.ok ? "**OK**" : "**FALLO**"} · ${r.canal} vía ${r.proveedor} · ref \`${r.ref}\` · ${r.detalle} (${formatearHora(r.timestamp)})`);
      }
      break;
    }
    case "modelo": {
      const p = d.procesadoPor ?? [];
      if (!p.length) l.push("La traza no registra qué modelo generó esta propuesta.");
      else {
        l.push("**Modelos que intervinieron en esta propuesta**", "");
        for (const x of p) l.push(`- \`${x.modelo}\` · ${TAREA_UI[x.tarea] ?? x.tarea} · ${x.latenciaMs} ms`);
        if (p.some((x) => x.modelo.includes("plantilla") || x.modelo.includes("determinista")))
          l.push("", "**Nota:** la propuesta se generó con una plantilla determinista, sin modelo de lenguaje.");
      }
      l.push("", `IA disponible en el servidor: **${estado.iaDisponible ? "sí" : "no"}**.`);
      break;
    }
    default: {
      l.push(`**${t?.titulo ?? focoUI(d.foco)}** · ${ESTADO_UI[d.estado]?.corta ?? d.estado}`, "");
      if (t?.resumen) l.push(t.resumen, "");
      l.push(`- Riesgo **${d.riesgo}/100** (umbral ${umbral}) · urgencia **${d.urgencia}**`);
      l.push(`- ${d.evidencia?.length ?? 0} datos de evidencia · ${d.reglasAplicadas.length} reglas de doctrina aplicadas`);
      if (ev[0]) l.push(`- Dato más fiable: ${ev[0].descripcion} ${citas.marca(ev[0])}`);
      l.push("", "Puedes preguntar por qué se propone, qué evidencia la respalda, qué reglas aplicó, qué pasa si no se actúa o qué alternativas se descartaron.");
    }
  }
  return { texto: l.join("\n"), citas };
}

function responderGeneral(intencion: Intencion, estado: EstadoSistema): string {
  const ds = estado.decisiones;
  const l: string[] = [];
  const cuenta = (e: string) => ds.filter((d) => d.estado === e).length;
  if (intencion === "doctrina") {
    if (!estado.doctrina.length) return "La IA **no ha aprendido todavía ninguna regla** de doctrina en este incidente.";
    l.push(`La doctrina vigente tiene **${estado.doctrina.length} reglas** aprendidas del feedback humano:`, "");
    for (const r of estado.doctrina)
      l.push(`- **${r.reglaNormalizada}** — ${r.ambito === "global" ? "permanente" : "este incidente"}, aplicada ${r.vecesAplicada} ${r.vecesAplicada === 1 ? "vez" : "veces"}, de ${nombreRol(r.origen.rol)}${r.activa ? "" : " · desactivada"}`);
    return l.join("\n");
  }
  if (intencion === "modelo") {
    const m = new Map<string, { n: number; ms: number }>();
    for (const d of ds) for (const p of d.procesadoPor ?? []) {
      const x = m.get(p.modelo) ?? { n: 0, ms: 0 };
      x.n++;
      x.ms += p.latenciaMs;
      m.set(p.modelo, x);
    }
    if (!m.size) return "Ninguna decisión registra todavía qué modelo la generó.";
    l.push("**Modelos registrados en las trazas**", "");
    for (const [k, v] of m) l.push(`- \`${k}\` · ${v.n} ${v.n === 1 ? "tarea" : "tareas"} · media ${Math.round(v.ms / v.n)} ms`);
    l.push("", `IA disponible en el servidor: **${estado.iaDisponible ? "sí" : "no"}**.`);
    return l.join("\n");
  }
  if (!ds.length) return "Todavía **no hay propuestas de la IA** en este incidente. Cuando el agente proponga una decisión aparecerá en la lista y podrás interrogarlo.";
  l.push(`En **${estado.incidente.titulo}** la IA ha hecho **${ds.length} ${ds.length === 1 ? "propuesta" : "propuestas"}**:`, "");
  l.push(`- Pendientes de firma: **${cuenta("pendiente")}** · ejecutadas: **${cuenta("ejecutada") + cuenta("ejecutando")}** · autónomas: **${cuenta("auto")}** · denegadas: **${cuenta("denegada")}** · invalidadas: **${cuenta("invalidada")}**`);
  l.push(`- Umbral de autonomía vigente: **${estado.umbralAutonomia}/100** · reglas de doctrina aprendidas: **${estado.doctrina.length}**`);
  const pend = ds.filter((d) => d.estado === "pendiente").sort((a, b) => b.riesgo - a.riesgo);
  if (pend.length) {
    l.push("", "**Pendientes, de mayor a menor riesgo**", "");
    for (const d of pend) l.push(`- ${d.tarjeta?.titulo ?? focoUI(d.foco)} — riesgo ${d.riesgo}, urgencia ${d.urgencia}`);
  }
  l.push("", "Selecciona una decisión en la lista para interrogar al agente sobre ella.");
  return l.join("\n");
}

/** Respuesta construida solo a partir de la traza. `decision` null = pregunta general. */
export function respuestaLocal(pregunta: string, decision: Decision | null, estado: EstadoSistema | null): RespuestaIA {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const intencion = detectarIntencion(pregunta);
  let respuesta: string;
  let citas: Evidencia[] = [];
  let reglas: string[] = [];
  if (!estado) {
    respuesta = "No hay estado del sistema disponible todavía; no puedo responder sin traza.";
  } else if (decision) {
    const r = responderDecision(intencion, decision, estado);
    respuesta = r.texto;
    citas = r.citas.lista;
    reglas = intencion === "doctrina" || intencion === "alternativas" || intencion === "porque" ? decision.reglasAplicadas : [];
  } else {
    respuesta = responderGeneral(intencion, estado);
  }
  const t1 = typeof performance !== "undefined" ? performance.now() : 0;
  return { respuesta, citas, reglasAplicadas: reglas, modelo: MODELO_TRAZA, latenciaMs: Math.max(0, Math.round(t1 - t0)) };
}
