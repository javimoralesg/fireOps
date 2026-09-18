// Lecciones aprendidas para el post-mortem: Claude si hay clave; si no, reglas
// deterministas derivadas de lo que pasó (denegaciones, invalidaciones, tiempos).

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { EstadoSistema } from "../tipos-sistema";
import { iaDisponible } from "./proponente";

function leccionesSinLLM(e: EstadoSistema): string[] {
  const out: string[] = [];
  const den = e.decisiones.filter((d) => d.estado === "denegada");
  const inv = e.decisiones.filter((d) => d.estado === "invalidada");
  const auto = e.decisiones.filter((d) => d.estado === "auto");
  if (den.length) out.push(`El mando corrigió ${den.length} propuesta(s); las reglas resultantes (${e.doctrina.map((r) => `"${r.reglaNormalizada}"`).join(", ")}) deben incorporarse al protocolo escrito para no depender de la memoria del sistema.`);
  if (inv.length) out.push(`${inv.length} propuesta(s) quedaron invalidadas por el cambio de viento: conviene fijar un plazo máximo de firma más corto para decisiones sensibles a la meteorología.`);
  if (auto.length) out.push(`${auto.length} acción(es) de bajo riesgo se ejecutaron automáticamente sin incidencias; puede valorarse subir el umbral de autonomía para avisos informativos.`);
  if (e.proveedorEjecucion === "Ninguno") out.push("Las acciones externas no se enviaron: sin canal configurado (HappyRobot/Twilio). En producción deben ir por un canal real con confirmación de recepción.");
  if (e.entorno.trafico && e.entorno.trafico.cargaMedia > 70) out.push(`La carga de tráfico media en el entorno fue del ${e.entorno.trafico.cargaMedia} %: los cortes totales de vías deben evitarse en franjas de alta demanda.`);
  out.push("Verificar en cada crisis la fiabilidad de las fuentes ciudadanas y de redes antes de escalar (se detectaron vídeos reciclados).");
  return out;
}

export async function lecciones(e: EstadoSistema): Promise<string[]> {
  const base = leccionesSinLLM(e);
  if (!iaDisponible()) return base;
  try {
    const client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
    const res = await client.messages.parse({
      model: process.env.CLAUDE_MODEL || "claude-opus-5",
      max_tokens: 1500,
      output_config: { effort: "low", format: zodOutputFormat(z.object({ lecciones: z.array(z.string()).min(3).max(8) })) },
      messages: [{ role: "user", content: `Eres el analista de un centro de mando de emergencias municipal. Redacta lecciones aprendidas concretas y accionables (3-8 frases en español) a partir de esta cronología y decisiones:\n\n${e.timeline.slice().reverse().map((t) => `${t.tick} ${t.tipo}: ${t.texto}`).join("\n")}\n\nDoctrina fijada por el mando:\n${e.doctrina.map((r) => `- ${r.reglaNormalizada}`).join("\n") || "- ninguna"}` }],
    });
    return res.parsed_output?.lecciones ?? base;
  } catch {
    return base;
  }
}
