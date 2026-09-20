// =====================================================================
// ATALAYA INCENDIOS · Agente "asesor_legal" (planificación)
// ---------------------------------------------------------------------
// Propósito: antes de que una decisión llegue al humano, comprobar contra
// la normativa (RD 893/2013, Ley 43/2003 de Montes, Ley 17/2015, planes
// INFO) que quien la va a ejecutar tiene competencia para ello y que no se
// salta ningún trámite. Si no es conforme, escribe `alertasLegales` y la
// decisión sube a competencia "humano". DUEÑO: constructor D.
// Dependencias: lib/conocimiento/consulta (RAG, constructor C), lib/ia/llm.
// =====================================================================
import { z } from "zod";
import type { Decision, Fundamento } from "../../dominio/tipos";
import type { Agente, ContextoAgente, ResultadoCiclo } from "../../motor/contratos";
import { buscarFundamentos } from "../../conocimiento/consulta";
import { completarJson, modeloPara, proveedorDisponible } from "../../ia/llm";
import { obtenerEstado } from "../../motor/estado";

const ESQUEMA = z.object({
  conforme: z.boolean(),
  alertas: z.array(z.string()),
  fundamentosClave: z.array(z.string()),
});

export interface RevisionLegal {
  conforme: boolean;
  alertas: string[];
  fundamentos: Fundamento[];
  fundamentosClave: string[];
  /** Motivo por el que no se ha podido revisar (sin RAG, sin LLM…). */
  sinRevisar?: string;
}

/** Estados en los que una decisión todavía admite que le cambiemos la competencia. */
const REVISABLES: Decision["estado"][] = ["propuesta", "pendiente_humano"];

/**
 * Revisa la legalidad de una decisión. Exportada aparte para que el
 * orquestador (A) pueda llamarla dentro de su pipeline sin esperar al ciclo.
 */
export async function revisarLegalidad(decision: Decision, signal?: AbortSignal): Promise<RevisionLegal> {
  const estado = obtenerEstado();
  const incendio = decision.incendioId ? estado.incendios.get(decision.incendioId) : undefined;
  const territorio = incendio?.comunidad;

  const consulta =
    `${decision.titulo}. ${decision.resumen}. Acciones: ${decision.acciones.map((a) => `${a.tipo} (${a.descripcion})`).join("; ")}. ` +
    `¿Quién tiene competencia para ordenar esto en un incendio forestal en ${territorio || "España"} y qué trámites exige la normativa?`;

  // Si A ya rellenó los fundamentos, se reutilizan (no se gasta otra búsqueda).
  let fundamentos: Fundamento[] = decision.fundamentos ?? [];
  if (!fundamentos.length) {
    try {
      fundamentos = await buscarFundamentos(consulta, { k: 6, territorio });
    } catch {
      fundamentos = [];
    }
  }

  if (!proveedorDisponible()) {
    return { conforme: true, alertas: [], fundamentos, fundamentosClave: [], sinRevisar: "Sin proveedor de IA configurado: la decisión no se ha podido revisar legalmente." };
  }

  const contexto = fundamentos.length
    ? fundamentos.map((f, i) => `[${i + 1}] ${f.documento}${f.seccion ? ` · ${f.seccion}` : ""}: "${f.cita}"`).join("\n")
    : "No hay fragmentos normativos recuperados del grafo de conocimiento.";

  const r = await completarJson({
    // Cola prioritaria de lib/ia/llm.ts: Pipeline: el asesor legal corre dentro del camino de cada decisión.
    prioridad: "alta",
    system:
      "Eres el asesor jurídico de una sala de coordinación de incendios forestales en España. Compruebas que cada decisión " +
      "respeta el reparto de competencias y los trámites de la normativa de protección civil y montes:\n" +
      "- RD 893/2013 (Directriz Básica de emergencias por incendios forestales): niveles 0-3, Director del Plan, quien declara cada nivel.\n" +
      "- Ley 17/2015 del Sistema Nacional de Protección Civil: deberes de información a la población y colaboración.\n" +
      "- Ley 43/2003 de Montes: competencias autonómicas y coordinación estatal.\n" +
      "- RD 393/2007 (autoprotección) y los planes INFO autonómicos.\n\n" +
      "Marca 'conforme: false' SOLO si hay un problema real de competencia o de trámite (por ejemplo, ordenar una evacuación o " +
      "elevar el nivel sin que lo firme el Director del Plan, o cortar una carretera sin la autoridad de tráfico). " +
      "Cada alerta es una frase en español que diga QUÉ falta y QUIÉN debe hacerlo. Si no hay problema, devuelve la lista vacía.",
    user:
      `DECISIÓN A REVISAR\nAgente: ${decision.agenteId}\nTítulo: ${decision.titulo}\nResumen: ${decision.resumen}\n` +
      `Razonamiento: ${decision.razonamiento}\nAcciones: ${decision.acciones.map((a) => `- ${a.tipo}: ${a.descripcion}`).join("\n")}\n` +
      `Incendio: ${incendio ? `${incendio.nombre} (${incendio.municipio}, ${incendio.comunidad}), nivel ${incendio.nivelGravedad}` : "sin incendio asociado"}\n\n` +
      `FRAGMENTOS NORMATIVOS RECUPERADOS:\n${contexto}`,
    esquema: ESQUEMA,
    nombreEsquema: "revision_legal",
    papel: "rapido",
    // Ver verificador: por debajo de ~4000 los modelos razonadores vuelven vacíos.
    maxTokens: 4000,
    signal,
  });

  return { conforme: r.datos.conforme, alertas: r.datos.alertas, fundamentos, fundamentosClave: r.datos.fundamentosClave };
}

export const asesorLegal: Agente = {
  id: "asesor_legal",
  nombre: "Asesor legal",
  categoria: "planificacion",
  descripcion: "Comprueba contra la normativa quién puede ordenar cada cosa y añade fundamentos y alertas legales a las decisiones.",
  modelo: modeloPara("rapido"),
  cadenciaSeg: 120,
  despiertaCon: ["decision_propuesta"],

  async ciclo(ctx: ContextoAgente): Promise<ResultadoCiclo> {
    const { estado } = ctx;
    const pendientes = [...estado.decisiones.values()].filter(
      (d) => REVISABLES.includes(d.estado) && d.alertasLegales === undefined && d.agenteId !== "humano",
    );
    if (!pendientes.length) {
      ctx.informarTarea("Sin decisiones pendientes de revisión legal");
      return { resumen: "Sin decisiones que revisar" };
    }

    ctx.informarTarea(`Revisando la legalidad de ${pendientes.length} decisión(es)`);
    let noConformes = 0;
    let revisadas = 0;
    let sinRevisar = 0;

    for (const decision of pendientes) {
      if (ctx.abortSignal.aborted) break;
      try {
        const revision = await revisarLegalidad(decision, ctx.abortSignal);
        if (revision.sinRevisar) {
          sinRevisar += 1;
          ctx.registrar("agente", `${decision.titulo}: ${revision.sinRevisar}`, { incendioId: decision.incendioId, nivel: "aviso", datos: { decisionId: decision.id } });
          continue;
        }
        revisadas += 1;

        const actual = estado.decisiones.get(decision.id);
        if (!actual || !REVISABLES.includes(actual.estado)) continue;

        const cambios: Partial<Decision> = {
          alertasLegales: revision.alertas,
          fundamentos: revision.fundamentos.length ? revision.fundamentos : actual.fundamentos,
        };
        if (!revision.conforme && revision.alertas.length) {
          noConformes += 1;
          cambios.competencia = "humano";
          cambios.estado = actual.estado === "propuesta" ? "propuesta" : "pendiente_humano";
        }
        estado.actualizar(estado.decisiones, decision.id, cambios);

        if (!revision.conforme && revision.alertas.length) {
          ctx.registrar("decision_escalada", `Alerta legal en "${decision.titulo}": ${revision.alertas[0]} Pasa a decisión humana.`, {
            incendioId: decision.incendioId,
            nivel: "aviso",
            datos: { decisionId: decision.id, alertas: revision.alertas },
          });
        }
      } catch (e) {
        sinRevisar += 1;
        ctx.registrar("agente", `El asesor legal no ha podido revisar "${decision.titulo}": ${e instanceof Error ? e.message : String(e)}`, {
          incendioId: decision.incendioId,
          nivel: "aviso",
        });
      }
    }

    return {
      resumen: `${revisadas} decisión(es) revisadas${noConformes ? `, ${noConformes} con alerta legal (pasan a humano)` : " sin alertas"}${sinRevisar ? `, ${sinRevisar} sin revisar` : ""}`,
    };
  },
};
