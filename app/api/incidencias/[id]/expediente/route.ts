// GET /api/incidencias/[id]/expediente · Expediente Markdown descargable de una
// incidencia: ficha, hilo cronológico completo (comunicaciones con su resultado
// real incluidas), unidades, poblaciones, cadena de auditoría de cada decisión y
// TODAS las actas del incendio concatenadas. DUEÑO: constructor G.
// Requisito de Javi: "que quede en un sitio todo esto registrado para auditarlo".
import { obtenerEstado } from "@/lib/motor/estado";
import { error } from "@/lib/motor/respuestas";
import { cadenaDeIncendio } from "@/lib/motor/auditoria";
import { construirHilo } from "@/components/incidencia/hilo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function nombreArchivo(id: string): string {
  const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `expediente-incidencia-${id.replace(/[^\w.-]/g, "_")}-${sello}.md`;
}

export async function GET(_peticion: Request, contexto: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await contexto.params;
  const estado = obtenerEstado();
  const incendio = estado.incendios.get(id);
  if (!incendio) return error(`No hay ninguna incidencia con id ${id}`, 404);

  const cadena = await cadenaDeIncendio(id, estado);
  const snapshot = estado.snapshot();
  // El hilo se guarda en orden cronológico ascendente: un expediente se lee hacia delante.
  const hilo = [...construirHilo(snapshot, id)].reverse();

  const partes: string[] = [
    `# Expediente de la incidencia · ${incendio.nombre}`,
    ``,
    `Generado el ${new Date().toISOString()} · hora de mundo ${estado.reloj.ahoraMundo} (×${estado.reloj.factor}) · ` +
      `ejecución \`${estado.ejecucion.id}\` (${estado.ejecucion.nombre})`,
    ``,
    `| Campo | Valor |`,
    `|---|---|`,
    `| Incidencia | \`${incendio.id}\` |`,
    `| Municipio | ${incendio.municipio || "—"}${incendio.provincia ? `, ${incendio.provincia}` : ""}${incendio.comunidad ? ` (${incendio.comunidad})` : ""} |`,
    `| Estado | ${incendio.estado} · nivel de gravedad ${incendio.nivelGravedad} |`,
    `| Superficie | ${incendio.areaHa.toFixed(1)} ha · confianza ${(incendio.confianza * 100).toFixed(0)} % |`,
    `| Centro | ${incendio.centro.lat.toFixed(5)}, ${incendio.centro.lon.toFixed(5)} |`,
    `| Detectado | ${incendio.detectadoEn} (origen ${incendio.origen}) |`,
    `| Frente | ${incendio.frente ? `${incendio.frente.rumboTexto} (${incendio.frente.rumboGrados}°) a ${incendio.frente.velocidadMmin.toFixed(1)} m/min` : "no consta"} |`,
    `| Meteorología | ${incendio.meteo ? `${incendio.meteo.temperaturaC} °C · ${incendio.meteo.humedadPct} % HR · viento ${incendio.meteo.direccionTexto} ${incendio.meteo.vientoKmh} km/h (rachas ${incendio.meteo.rachasKmh}) — ${incendio.meteo.fuente}` : "no consta"} |`,
    `| Peligro | ${incendio.peligro ? `${incendio.peligro.nivel} (${incendio.peligro.valor}/100) — ${incendio.peligro.motivo}` : "no consta"} |`,
    `| Decisiones | ${cadena.decisiones.length} |`,
    `| Observaciones | ${cadena.observaciones.length} |`,
    `| Unidades asignadas | ${cadena.unidades.length} |`,
    `| Poblaciones en el entorno | ${cadena.poblaciones.length} (avisadas: ${cadena.poblaciones.filter((p) => p.estadoAviso !== "sin_avisar").length}) |`,
    `| Actas | ${cadena.informes.length} |`,
    ``,
    `## 1. Hilo cronológico completo (${hilo.length} entradas)`,
    ``,
    `| Hora de mundo | Hora real | Tipo | Qué pasó | Quién | Resultado |`,
    `|---|---|---|---|---|---|`,
    ...(hilo.length
      ? hilo.map((e) => {
          const limpio = (t: string) => t.replace(/\|/g, "／").replace(/\n+/g, " ");
          const resultado = e.exito === true ? "éxito" : e.exito === false ? "FALLO" : e.insignias.map((i) => i.texto).join(", ") || "—";
          return `| ${e.enMundo} | ${e.en} | ${e.categoria} | ${limpio(e.titulo)}${e.detalle ? ` — ${limpio(e.detalle)}` : ""} | ${limpio(e.actor ?? "—")} | ${limpio(resultado)} |`;
        })
      : ["| — | — | — | _Sin actividad registrada._ | — | — |"]),
    ``,
    `## 2. Unidades`,
    ``,
    cadena.unidades.length
      ? cadena.unidades
          .map(
            (u) =>
              `- **${u.nombre}** [${u.tipo}] · ${u.estado} · base ${u.base.nombre} · posición ${u.posicion.lat.toFixed(5)}, ${u.posicion.lon.toFixed(5)}` +
              (u.sector ? ` · sector ${u.sector}` : "") +
              (u.ruta
                ? ` · ruta ${u.ruta.fuente} ${(u.ruta.distanciaM / 1000).toFixed(1)} km / ${Math.round(u.ruta.duracionS / 60)} min · progreso ${(u.ruta.progreso * 100).toFixed(0)} % · salida ${u.ruta.salida} · llegada prevista ${u.ruta.llegadaPrevista}`
                : "") +
              (u.ultimaOrden ? `\n  - Última orden (${u.ultimaOrden.en}, decisión \`${u.ultimaOrden.decisionId}\`): «${u.ultimaOrden.texto}»` : "") +
              (u.ultimoContacto ? `\n  - Último contacto (${u.ultimoContacto.en}) por ${u.ultimoContacto.canal}: ${u.ultimoContacto.resultado}` : ""),
          )
          .join("\n")
      : `_Sin medios asignados._`,
    ``,
    `## 3. Poblaciones y avisos`,
    ``,
    cadena.poblaciones.length
      ? cadena.poblaciones
          .sort((a, b) => (a.etaFrenteMin ?? 1e9) - (b.etaFrenteMin ?? 1e9))
          .map(
            (p) =>
              `- **${p.nombre}** (${p.tipo}${p.habitantes ? `, ${p.habitantes} hab.` : ""}) · riesgo ${p.riesgo} · ${p.distanciaKm.toFixed(1)} km · ` +
              `ETA del frente ${p.etaFrenteMin ?? "—"} min · aviso **${p.estadoAviso}**` +
              (p.ultimoContacto ? ` · último contacto ${p.ultimoContacto.en} por ${p.ultimoContacto.canal}: ${p.ultimoContacto.resultado}` : ""),
          )
          .join("\n")
      : `_Sin núcleos de población cargados._`,
    ``,
    `## 4. Comunicados`,
    ``,
    cadena.comunicados.length
      ? cadena.comunicados.map((c) => `- **${c.titulo}** · ${c.estado}${c.publicadoEn ? ` · ${c.publicadoEn}` : ""} · canales: ${c.canales.join(", ") || "—"}\n\n  > ${c.cuerpo.replace(/\n+/g, "\n  > ")}`).join("\n")
      : `_Ninguno._`,
    ``,
    `## 5. Cadena de auditoría por decisión (${cadena.decisiones.length})`,
    ``,
  ];

  if (!cadena.decisiones.length) partes.push(`_Todavía no hay decisiones para esta incidencia._`, ``);

  for (const [i, c] of cadena.decisiones.entries()) {
    const d = c.decision;
    partes.push(
      `### 5.${i + 1} ${d.titulo}`,
      ``,
      `- \`${d.id}\` · agente **${c.agente?.nombre ?? d.agenteId}** (${d.agenteId}, ${c.agente?.modelo ?? "modelo desconocido"})`,
      `- Estado final **${d.estado}** · competencia ${d.competencia} · riesgo ${d.riesgo}/100 · prioridad ${d.prioridad}`,
      `- Propuesta ${d.creadaEn} (mundo ${d.creadaEnMundo})${d.decididaPor ? ` · decidida por ${d.decididaPor}${d.decididaEn ? ` el ${d.decididaEn}` : ""}` : ""}`,
      ...(d.comentarioHumano ? [`- Comentario del mando: «${d.comentarioHumano}»`] : []),
      `- Razonamiento: ${d.razonamiento}`,
      ...(d.sustituyeA ? [`- Replanificación: sustituye a \`${d.sustituyeA}\`. ${d.motivoReplanificacion ?? ""}`] : []),
      ``,
      `**Cambios de estado**`,
      ``,
      c.historial.length
        ? c.historial.map((h) => `- ${h.en} (mundo ${h.enMundo}) → **${h.estado}** · ${h.quien}${h.motivo ? ` — ${h.motivo}` : ""}`).join("\n")
        : `_Sin historial registrado._`,
      ``,
      `**Acciones y resultado real**`,
      ``,
      c.acciones.length
        ? c.acciones
            .map(
              (a) =>
                `- **${a.tipo}** — ${a.descripcion} · estado ${a.estado}` +
                (a.autorizadaPor ? ` · autorizada por ${a.autorizadaPor}` : "") +
                (a.ordenadaEn ? ` · ordenada ${a.ordenadaEn}` : "") +
                (a.ejecutadaEn ? ` · ejecutada ${a.ejecutadaEn}` : "") +
                (a.resultado
                  ? `\n  - Resultado: **${a.resultado.exito ? "ÉXITO" : "FALLO"}** · ${a.resultado.proveedor}${a.resultado.referencia ? ` · ref. \`${a.resultado.referencia}\`` : ""} — ${a.resultado.resumen}` +
                    (a.resultado.datos ? `\n  - Datos devueltos: \`${JSON.stringify(a.resultado.datos).slice(0, 1200)}\`` : "")
                  : `\n  - Resultado: no consta (la acción no llegó a ejecutarse)`) +
                (a.informe ? `\n  - Acta de la acción: \`${a.informe.id}\`` : ""),
            )
            .join("\n")
        : `_Sin acciones._`,
      ``,
      `**Evidencias** (${c.evidencias.length})`,
      ``,
      c.evidencias.length
        ? c.evidencias.map((e) => `- ${e.fuente} (${e.en}): ${e.resumen}${e.url ? ` — <${e.url}>` : ""}`).join("\n")
        : `_Sin evidencias registradas._`,
      ``,
      `**Fundamentos legales** (${c.fundamentos.length})`,
      ``,
      c.fundamentos.length
        ? c.fundamentos.map((f) => `- [${f.documento} §${f.seccion ?? "—"}] (similitud ${f.similitud.toFixed(3)})\n  > ${f.cita}`).join("\n")
        : `_Sin fundamentos citados._`,
      ...(c.alertasLegales.length ? [`\n**Alertas legales**: ${c.alertasLegales.join("; ")}`] : []),
      ``,
      `**Evaluación del supervisor**`,
      ``,
      c.evaluacion
        ? `- ${c.evaluacion.puntuacion}/100 · ${c.evaluacion.aprueba ? "aprueba" : "suspende"} · modelo ${c.evaluacion.modelo} · ${c.evaluacion.en}` +
          (c.evaluacion.motivoEscalado ? `\n- Motivo de escalado: ${c.evaluacion.motivoEscalado}` : "") +
          `\n${c.evaluacion.criterios.map((cr) => `  - ${cr.nombre}: ${cr.puntuacion} — ${cr.comentario}`).join("\n")}`
        : `_No pasó por el supervisor._`,
      ``,
      `**Traza del ciclo que la originó** (${c.origenTraza})`,
      ``,
      c.trazaOrigen
        ? [
            `- \`${c.trazaOrigen.id}\` · motivo ${c.trazaOrigen.motivo} · ${c.trazaOrigen.estado}${c.trazaOrigen.duracionMs ? ` · ${c.trazaOrigen.duracionMs} ms` : ""}`,
            `- Qué vio: ${c.trazaOrigen.entradas ?? "no anotado"}`,
            `- Qué concluyó: ${c.trazaOrigen.resumen ?? "sin resumen"}`,
            `- Llamadas de IA (${c.trazaOrigen.llamadasIA.length}):`,
            ...c.trazaOrigen.llamadasIA.map(
              (l) => `  - ${l.proveedor}/${l.modelo} (${l.papel}) · ${l.latenciaMs} ms${l.error ? ` · ERROR ${l.error}` : ""}\n    - Pregunta: ${l.promptResumen}\n    - Respuesta: ${l.respuestaResumen}`,
            ),
          ].join("\n")
        : `_No se conserva la traza._`,
      ``,
    );
  }

  partes.push(`## 6. Actas completas de la incidencia (${cadena.informes.length})`, ``);
  if (!cadena.informes.length) partes.push(`_No se ha generado ningún acta para esta incidencia._`, ``);
  for (const [i, informe] of cadena.informes.entries()) {
    partes.push(
      `---`,
      ``,
      `### Acta ${i + 1} de ${cadena.informes.length} · ${informe.tipo}${informe.estadoDecision ? ` · estado "${informe.estadoDecision}"` : ""}`,
      ``,
      `\`${informe.id}\` · generada ${informe.generadoEn} · modelo ${informe.modelo} · narrativa de IA: ${informe.conNarrativaIA ? "sí" : "no"}`,
      ...(informe.huella ? [`SHA-256 del acta: \`${informe.huella}\``] : []),
      ``,
      informe.contenido,
      ``,
    );
  }

  const markdown = partes.join("\n").replace(/\n{3,}/g, "\n\n");
  return new Response(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombreArchivo(incendio.id)}"`,
      "Cache-Control": "no-store",
    },
  });
}
