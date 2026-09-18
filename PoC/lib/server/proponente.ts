// Proponente: genera la Decision (tarjeta + urgencia + riesgo + evidencia citada)
// a partir del contexto real. Siempre con un LLM real: Claude si hay
// ANTHROPIC_API_KEY y, si no, Ollama en el propio Mac (conectores/llm.ts).
// Aquí no hay plantillas: si ningún LLM responde, proponer() lanza y el motor
// decide (puede recurrir a plantillaPorTipo, marcada como tal).

import { z } from "zod";
import type { EventoIngesta, ImpactoDomino, PlanPropuesto, TarjetaDecision } from "../types";
import type { CondicionesEntorno, Evidencia, Incidente, ReglaDoctrina, Urgencia } from "../tipos-sistema";
import { esCategoriaId, type CategoriaId } from "../politica-autonomia";
import { generarEstructurado, llmDisponible, modeloLLM } from "./conectores/llm";

export interface ContextoPropuesta {
  incidente: Incidente;
  entorno: CondicionesEntorno;
  eventos: EventoIngesta[];
  domino: ImpactoDomino[];
  doctrina: ReglaDoctrina[];
  evidencia: Evidencia[];
  foco: string;
  descripcionFoco: string;
  planAnterior?: PlanPropuesto;
  feedback?: string;
}

export interface Propuesta {
  tarjeta: TarjetaDecision;
  urgencia: Urgencia;
  riesgo: number;
  costeDeNoActuar: string;
  plazoMinutos: number;
  evidenciaIds: string[];
  alternativasDescartadas: { opcion: string; motivo: string }[];
  /** Categorías del catálogo de la política de autonomía (lib/politica-autonomia.ts) que contiene el plan. */
  categorias?: CategoriaId[];
  generadaPor: "claude" | "ollama" | "plantilla";
  modelo: string;
  latenciaMs: number;
}

/** Hay un LLM real disponible (Claude u Ollama local). Nombre mantenido por compatibilidad. */
export const iaDisponible = () => llmDisponible();
export const MODELO_PLAN = () => modeloLLM("plan");

const CATEGORIAS = "informe, consulta, aviso_interno, voluntariado, comunicacion_publica, despliegue, proteccion_infraestructura, trafico_parcial, trafico_total, confinamiento, evacuacion, suministros, alerta_masiva, situacion_operativa, medios_privados";

// Sin restricciones numéricas en el esquema (min/max) para que lo acepten todos
// los proveedores; los límites se aplican al validar la salida.
const EsquemaPropuesta = z.object({
  titulo: z.string(),
  resumen: z.string(),
  severidad: z.enum(["critica", "alta", "media"]),
  protocolo: z.object({ codigo: z.string(), nombre: z.string() }),
  razonamiento: z.string(),
  acciones: z.array(z.object({ recurso: z.string(), accion: z.string(), eta: z.string(), prioridad: z.enum(["alta", "media", "baja"]) })),
  mensajeAlerta: z.string(),
  urgencia: z.enum(["critica", "alta", "media", "baja"]),
  riesgo: z.number(),
  costeDeNoActuar: z.string(),
  plazoMinutos: z.number(),
  evidenciaIds: z.array(z.string()),
  alternativasDescartadas: z.array(z.object({ opcion: z.string(), motivo: z.string() })),
  categorias: z.array(z.string()),
});

const SISTEMA = `Eres el sistema de apoyo a la decisión del Centro de Mando de Crisis de un Ayuntamiento español. Propones UNA decisión concreta para que un cargo público (alcalde o director de emergencias) la apruebe o deniegue. Reglas:
- Basa cada afirmación en la evidencia numerada que recibes; cita sus ids en evidenciaIds. No inventes datos.
- Respeta TODAS las reglas de doctrina activas: son órdenes del mando aprendidas de decisiones anteriores.
- Si hay feedback de una denegación, el nuevo plan debe cumplirlo explícitamente y explicar qué cambia.
- Acciones concretas: recurso responsable, qué hace, ETA. Entre 2 y 6.
- riesgo (0-100) mide el daño potencial de la acción si es errónea (cortar una autovía = alto; enviar un aviso informativo = bajo).
- plazoMinutos (1-180): minutos hasta que la decisión deje de ser útil.
- mensajeAlerta: texto breve que se enviará por SMS/voz a los responsables.
- alternativasDescartadas: 1-4 opciones que consideraste y por qué no las propones (con datos).
- categorias: tipos de actuación del catálogo que contiene el plan (${CATEGORIAS}); incluye todos los que apliquen, la más grave manda.
- Redacta en español, sobrio, sin adjetivos vacíos. Protocolo: usa códigos plausibles del PEMAM (Plan de Emergencias Municipal de Madrid).`;

function textoContexto(c: ContextoPropuesta) {
  const v = c.entorno.viento;
  return `INCIDENTE: ${c.incidente.titulo} — ${c.incidente.ubicacion.nombre} — fase ${c.incidente.fase}, minuto ${c.incidente.tick * 5}.
QUÉ HAY QUE DECIDIR AHORA (${c.foco}): ${c.descripcionFoco}

ENTORNO: viento ${v.velocidadKmh} km/h del ${v.direccionTexto} (${v.fuente}); ${c.entorno.aire ? `PM2.5 ${c.entorno.aire.pm25} µg/m³; ` : ""}${c.entorno.trafico ? `tráfico: ${c.entorno.trafico.sensoresCercanos} sensores en 1,5 km, carga media ${c.entorno.trafico.cargaMedia} %${c.entorno.trafico.sensorPeor ? `, peor ${c.entorno.trafico.sensorPeor.descripcion} ${c.entorno.trafico.sensorPeor.carga} %` : ""}` : ""}

EVIDENCIA (id · fuente · descripción · confianza):
${c.evidencia.map((e) => `- ${e.id} · ${e.fuente} · ${e.descripcion} · ${Math.round(e.confianza * 100)} %`).join("\n")}

EVENTOS RECIENTES:
${c.eventos.slice(0, 8).map((e) => `- [${e.fuente}] ${e.titulo}: ${e.detalle}`).join("\n")}

EFECTO DOMINÓ (grafo de infraestructuras, riesgo/100):
${c.domino.map((d) => `- ${d.infraestructura} ${d.riesgo} · ${d.ruta.join(" → ")}`).join("\n") || "- ninguno"}

DOCTRINA ACTIVA (obligatoria):
${c.doctrina.map((r) => `- [${r.id}] ${r.reglaNormalizada}`).join("\n") || "- ninguna"}
${c.planAnterior ? `\nPLAN ANTERIOR (v${c.planAnterior.version}) DENEGADO:\n${c.planAnterior.acciones.map((a) => `- ${a.recurso}: ${a.accion}`).join("\n")}\nFEEDBACK DEL MANDO: "${c.feedback}"` : ""}`;
}

const acotar = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number.isFinite(n) ? n : min)));

/** Propuesta generada por el LLM real disponible. Lanza si no hay ninguno o la salida no es válida. */
export async function proponer(c: ContextoPropuesta): Promise<Propuesta> {
  const r = await generarEstructurado(EsquemaPropuesta, {
    system: SISTEMA,
    user: textoContexto(c),
    nivel: "plan",
    maxTokens: 4000,
    timeoutMs: 300_000,
    effort: "low",
  });
  const p = r.datos;
  if (!p.acciones.length) throw new Error(`${r.modelo}: plan sin acciones`);
  const version = (c.planAnterior?.version ?? 0) + 1;
  const plan: PlanPropuesto = {
    version,
    razonamiento: p.razonamiento,
    acciones: p.acciones.slice(0, 6).map((a, i) => ({ id: `a${version}-${i + 1}`, ...a })),
    mensajeAlerta: p.mensajeAlerta,
    restricciones: [...(c.planAnterior?.restricciones ?? []), ...(c.feedback ? [c.feedback] : [])],
  };
  const idsValidos = new Set(c.evidencia.map((e) => e.id));
  return {
    tarjeta: { incidenteId: c.incidente.id, titulo: p.titulo, resumen: p.resumen, severidad: p.severidad, protocolo: p.protocolo, domino: c.domino, plan },
    urgencia: p.urgencia,
    riesgo: acotar(p.riesgo, 0, 100),
    costeDeNoActuar: p.costeDeNoActuar,
    plazoMinutos: acotar(p.plazoMinutos, 1, 180),
    evidenciaIds: p.evidenciaIds.filter((id) => idsValidos.has(id)),
    alternativasDescartadas: p.alternativasDescartadas.slice(0, 4),
    categorias: p.categorias.filter(esCategoriaId).slice(0, 5),
    generadaPor: r.proveedor === "anthropic" ? "claude" : "ollama",
    modelo: r.modelo,
    latenciaMs: r.latenciaMs,
  };
}

/** Convierte el comentario de una denegación en una regla operativa con el LLM; si no hay LLM o falla, usa la normalización determinista del llamador. */
export async function normalizarRegla(texto: string, fallback: (t: string) => string): Promise<string> {
  if (!llmDisponible()) return fallback(texto);
  try {
    const r = await generarEstructurado(z.object({ regla: z.string() }), {
      nivel: "ligero",
      maxTokens: 400,
      timeoutMs: 90_000,
      effort: "low",
      user: `Un cargo público ha denegado un plan de emergencia con este comentario: "${texto}". Reescríbelo como una regla operativa breve, general y verificable (una frase, en español) que el sistema deba respetar en todas las decisiones futuras.`,
    });
    return r.datos.regla.trim() || fallback(texto);
  } catch (err) {
    console.warn("[proponente/normalizarRegla]", err instanceof Error ? err.message : err);
    return fallback(texto);
  }
}
