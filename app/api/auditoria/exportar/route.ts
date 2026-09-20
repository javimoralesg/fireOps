// GET /api/auditoria/exportar?decisionId=… · Expediente Markdown descargable
// con TODAS las actas de una decisión concatenadas. DUEÑO: constructor A.
import type { NextRequest } from "next/server";
import { obtenerEstado } from "@/lib/motor/estado";
import { error } from "@/lib/motor/respuestas";
import { cadenaDe } from "@/lib/motor/auditoria";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function nombreArchivo(id: string): string {
  const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `expediente-${id}-${sello}.md`;
}

export async function GET(peticion: NextRequest): Promise<Response> {
  const decisionId = peticion.nextUrl.searchParams.get("decisionId")?.trim();
  if (!decisionId) return error("Hace falta decisionId", 400);

  const estado = obtenerEstado();
  const d = estado.decisiones.get(decisionId);
  if (!d) return error(`No hay ninguna decisión con id ${decisionId}`, 404);

  const cadena = await cadenaDe(estado, d);
  const agente = cadena.agente;
  const incendio = cadena.incendio;

  const partes: string[] = [
    `# Expediente de auditoría · ${d.titulo}`,
    "",
    `Generado el ${new Date().toISOString()} · ejecución \`${d.ejecucionId}\` (${estado.ejecucion.nombre})`,
    "",
    "| Campo | Valor |",
    "|---|---|",
    `| Decisión | \`${d.id}\` |`,
    `| Estado final | ${d.estado} |`,
    `| Agente | ${agente?.nombre ?? d.agenteId} (\`${d.agenteId}\`, ${agente?.modelo ?? "modelo desconocido"}) |`,
    `| Incendio | ${incendio ? `${incendio.nombre} — ${incendio.municipio}, ${incendio.provincia}` : "—"} |`,
    `| Propuesta | ${d.creadaEn} (mundo ${d.creadaEnMundo}) |`,
    `| Competencia | ${d.competencia} · riesgo ${d.riesgo} · prioridad ${d.prioridad} |`,
    `| Decidida por | ${d.decididaPor ?? "—"}${d.decididaEn ? ` el ${d.decididaEn}` : ""} |`,
    `| Traza de origen | \`${d.trazaId ?? "—"}\` (${cadena.origenTraza}) |`,
    `| Acciones | ${d.acciones.length} |`,
    `| Actas | ${cadena.informes.length} |`,
    "",
    "## Cadena de custodia (cambios de estado)",
    "",
    cadena.historial.length
      ? ["| Cuándo | Hora de mundo | Estado | Quién | Motivo |", "|---|---|---|---|---|", ...cadena.historial.map((h) => `| ${h.en} | ${h.enMundo} | **${h.estado}** | ${h.quien} | ${h.motivo ?? ""} |`)].join("\n")
      : "_Sin historial registrado._",
    "",
    "## Registro de eventos relacionados",
    "",
    cadena.eventos.length
      ? cadena.eventos.map((e) => `- \`${e.en}\` [${e.nivel}] **${e.tipo}** — ${e.mensaje}`).join("\n")
      : "_Sin eventos._",
    "",
  ];

  if (cadena.trazaOrigen) {
    const t = cadena.trazaOrigen;
    partes.push(
      "## Traza del ciclo que la originó",
      "",
      `- \`${t.id}\` · motivo **${t.motivo}** · estado **${t.estado}**${t.duracionMs ? ` · ${t.duracionMs} ms` : ""}`,
      `- Entradas que vio el agente: ${t.entradas ?? "(no anotado)"}`,
      `- Conclusión: ${t.resumen ?? "(sin resumen)"}`,
      t.error ? `- Error: ${t.error}` : "",
      "",
      `### Llamadas a modelos de IA (${t.llamadasIA.length})`,
      "",
      t.llamadasIA.length
        ? t.llamadasIA
            .map((l) => `- \`${l.en}\` ${l.papel} · ${l.proveedor}/${l.modelo} · ${l.latenciaMs} ms${l.error ? ` · ERROR ${l.error}` : ""}\n  - Pregunta: ${l.promptResumen}\n  - Respuesta: ${l.respuestaResumen}`)
            .join("\n")
        : "_Ninguna: la decisión no usó IA._",
      "",
    );
  }

  partes.push(`## Actas (${cadena.informes.length})`, "");
  if (!cadena.informes.length) {
    partes.push("_No se generó ningún acta para esta decisión._", "");
  }
  for (const [i, informe] of cadena.informes.entries()) {
    partes.push(
      "---",
      "",
      `## Acta ${i + 1} de ${cadena.informes.length} · ${informe.tipo}${informe.estadoDecision ? ` · estado "${informe.estadoDecision}"` : ""}`,
      "",
      `\`${informe.id}\` · generada ${informe.generadoEn} · modelo ${informe.modelo} · narrativa de IA: ${informe.conNarrativaIA ? "sí" : "no"}`,
      informe.huella ? `SHA-256 del acta: \`${informe.huella}\`` : "",
      "",
      informe.contenido,
      "",
    );
  }

  const markdown = partes.filter((l) => l !== undefined).join("\n");
  return new Response(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombreArchivo(d.id)}"`,
      "Cache-Control": "no-store",
    },
  });
}
