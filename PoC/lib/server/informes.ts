// Generación de informes en Markdown: SITREP periódico y acta de decisión.
// Para una administración pública el acta es la trazabilidad legal de quién
// decidió qué, cuándo, con qué datos y qué alternativas se descartaron.

import type { Decision, EstadoSistema, Informe } from "../tipos-sistema";
import { nuevoId, registrar } from "./estado";

const fmt = (iso: string) => new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid" });

export function actaDecision(e: EstadoSistema, d: Decision): Informe {
  const t = d.tarjeta;
  const reglas = e.doctrina.filter((r) => d.reglasAplicadas.includes(r.id));
  const md = `# Acta de decisión ${d.id}

**Incidente:** ${e.incidente.titulo} (${e.incidente.id})
**Decisión:** ${t.titulo}
**Estado:** ${d.estado.toUpperCase()}${d.decididaPor ? ` — por ${d.decididaPor.rol} el ${fmt(d.decididaPor.timestamp)} vía ${d.decididaPor.via}` : ""}
**Urgencia / riesgo:** ${d.urgencia} / ${d.riesgo}/100 · **Plazo:** ${fmt(d.plazo)}
**Protocolo aplicado:** ${t.protocolo.codigo} · ${t.protocolo.nombre}

## Resumen de situación
${t.resumen}

## Razonamiento de la propuesta (plan v${t.plan.version})
${t.plan.razonamiento}

## Datos en los que se basa
| Fuente | Dato | Valor | Hora | Confianza |
|---|---|---|---|---|
${d.evidencia.map((ev) => `| ${ev.fuente} | ${ev.descripcion} | ${ev.valor}${ev.unidad ? " " + ev.unidad : ""} | ${fmt(ev.timestamp)} | ${Math.round(ev.confianza * 100)} % |`).join("\n")}

## Impacto en cascada (grafo de infraestructuras)
${t.domino.map((x) => `- **${x.infraestructura}** — riesgo ${x.riesgo}/100 · ruta: ${x.ruta.join(" → ")}`).join("\n") || "- Sin impacto en infraestructuras críticas."}

## Acciones ${d.estado === "ejecutada" || d.estado === "auto" ? "ejecutadas" : "propuestas"}
${t.plan.acciones.map((a, i) => `${i + 1}. [${a.prioridad.toUpperCase()}] **${a.recurso}** — ${a.accion} (ETA ${a.eta})`).join("\n")}

${d.resultadoEjecucion?.length ? `## Resultado de la ejecución
| Acción | Canal | Proveedor | Referencia | OK | Detalle |
|---|---|---|---|---|---|
${d.resultadoEjecucion.map((r) => `| ${r.accionId} | ${r.canal} | ${r.proveedor} | ${r.ref} | ${r.ok ? "✅" : "❌"} | ${r.detalle} |`).join("\n")}
` : ""}
## Reglas de doctrina aplicadas
${reglas.map((r) => `- ${r.reglaNormalizada} _(origen: ${r.origen.rol}, ${fmt(r.origen.timestamp)})_`).join("\n") || "- Ninguna."}

${d.feedback ? `## Motivo de la denegación\n> ${d.feedback}\n` : ""}
## Coste de no actuar
${d.costeDeNoActuar}

---
_Generado automáticamente el ${fmt(new Date().toISOString())} por el Centro de Mando de Crisis AI. La decisión final es humana._
`;
  const inf: Informe = { id: nuevoId("inf"), tipo: "acta_decision", incidenteId: e.incidente.id, decisionId: d.id, generadoEn: new Date().toISOString(), titulo: `Acta — ${t.titulo}`, markdown: md };
  e.informes.unshift(inf);
  d.informeId = inf.id;
  registrar(e, "informe", `Acta de decisión generada: ${t.titulo}`, inf.id);
  return inf;
}

export function sitrep(e: EstadoSistema): Informe {
  const pend = e.decisiones.filter((d) => d.estado === "pendiente");
  const ejec = e.decisiones.filter((d) => d.estado === "ejecutada" || d.estado === "auto");
  const den = e.decisiones.filter((d) => d.estado === "denegada");
  const v = e.entorno.viento;
  const md = `# SITREP · ${e.incidente.titulo}

**Hora:** ${fmt(new Date().toISOString())} · **Tick:** ${e.incidente.tick} · **Fase:** ${e.incidente.fase}
**Inicio del incidente:** ${fmt(e.incidente.iniciadoEn)}

## Condiciones del entorno (datos reales)
- Viento: ${v.velocidadKmh} km/h del ${v.direccionTexto} (${v.fuente}, ${fmt(v.timestamp)})
${e.entorno.aire ? `- Calidad del aire: PM2.5 ${e.entorno.aire.pm25} µg/m³, CO ${e.entorno.aire.co} µg/m³` : ""}
${e.entorno.trafico ? `- Tráfico: ${e.entorno.trafico.sensoresCercanos} sensores en 1,5 km, carga media ${e.entorno.trafico.cargaMedia} %${e.entorno.trafico.sensorPeor ? `, peor punto ${e.entorno.trafico.sensorPeor.descripcion} (${e.entorno.trafico.sensorPeor.carga} %)` : ""}` : ""}
${e.entorno.demandaElectricaMW ? `- Demanda eléctrica nacional: ${e.entorno.demandaElectricaMW.valor.toLocaleString("es-ES")} MW` : ""}

## Decisiones
- Pendientes de firma: **${pend.length}**${pend.length ? " — " + pend.map((d) => `${d.tarjeta.titulo} (${d.urgencia})`).join("; ") : ""}
- Ejecutadas: **${ejec.length}**
- Denegadas: **${den.length}**

## Últimos eventos
${e.eventos.slice(0, 6).map((ev) => `- [${ev.fuente}] ${ev.titulo} — ${ev.detalle}`).join("\n")}

## Doctrina activa
${e.doctrina.filter((r) => r.activa).map((r) => `- ${r.reglaNormalizada}`).join("\n") || "- Sin reglas todavía."}

## Cronología reciente
${e.timeline.slice(0, 10).map((t) => `- ${fmt(t.timestamp)} · ${t.tipo}: ${t.texto}`).join("\n")}
`;
  const inf: Informe = { id: nuevoId("inf"), tipo: "sitrep", incidenteId: e.incidente.id, generadoEn: new Date().toISOString(), titulo: `SITREP tick ${e.incidente.tick}`, markdown: md };
  e.informes.unshift(inf);
  registrar(e, "informe", `SITREP generado (tick ${e.incidente.tick})`, inf.id);
  return inf;
}

/** Post-mortem oficial al cerrar la incidencia: árbol de decisiones, datos, doctrina y lecciones. */
export function postMortem(e: EstadoSistema, lecciones: string[]): Informe {
  const orden = [...e.decisiones].sort((a, b) => a.creadaEn.localeCompare(b.creadaEn));
  const ejecutadas = orden.filter((d) => d.estado === "ejecutada" || d.estado === "auto");
  const denegadas = orden.filter((d) => d.estado === "denegada");
  const invalidadas = orden.filter((d) => d.estado === "invalidada");
  const externas = ejecutadas.flatMap((d) => d.resultadoEjecucion ?? []).filter((r) => r.canal !== "interno");
  const md = `# Informe post-mortem · ${e.incidente.titulo}

**Identificador:** ${e.incidente.id} · **Inicio:** ${fmt(e.incidente.iniciadoEn)} · **Cierre:** ${fmt(new Date().toISOString())}
**Duración operativa:** ${e.incidente.tick} ciclos de decisión · **Fase final:** ${e.incidente.fase}
**Modo de datos:** ${e.modoDatos} · **Proveedor de ejecución:** ${e.proveedorEjecucion} · **IA:** ${e.iaDisponible ? "LLM real" : "sin LLM (plantillas)"}

## 1. Resumen ejecutivo
Se gestionaron **${orden.length} propuestas**: ${ejecutadas.length} ejecutadas (${ejecutadas.filter((d) => d.estado === "auto").length} automáticas bajo umbral ${e.umbralAutonomia}), ${denegadas.length} denegadas por el mando, ${invalidadas.length} invalidadas por cambio de condiciones. Se dispararon ${externas.length} acciones fuera del sistema (${externas.filter((r) => r.ok).length} confirmadas). El mando fijó ${e.doctrina.length} regla(s) de doctrina que quedan incorporadas para futuras crisis.

## 2. Árbol de decisiones
${orden.map((d, i) => `${i + 1}. **${d.tarjeta.titulo}** — ${d.estado.toUpperCase()}${d.decididaPor ? ` por ${d.decididaPor.rol} (${fmt(d.decididaPor.timestamp)})` : ""} · urgencia ${d.urgencia}, riesgo ${d.riesgo}${d.feedback ? `\n   - Motivo de denegación: "${d.feedback}"` : ""}${d.motivoInvalidacion ? `\n   - Invalidada: ${d.motivoInvalidacion}` : ""}${d.informeId ? `\n   - Acta: ${d.informeId}` : ""}`).join("\n")}

## 3. Datos utilizados (fuentes)
${Array.from(new Set(orden.flatMap((d) => d.evidencia.map((x) => x.fuente)))).map((f) => `- ${f}`).join("\n")}

## 4. Acciones ejecutadas fuera del sistema
| Decisión | Canal | Proveedor | Referencia | Resultado |
|---|---|---|---|---|
${ejecutadas.flatMap((d) => (d.resultadoEjecucion ?? []).filter((r) => r.canal !== "interno").map((r) => `| ${d.tarjeta.titulo} | ${r.canal} | ${r.proveedor} | ${r.ref} | ${r.ok ? "OK" : "FALLO"} — ${r.detalle} |`)).join("\n") || "| — | — | — | — | Sin acciones externas |"}

## 5. Doctrina aprendida (se aplica a futuras crisis)
${e.doctrina.map((r) => `- ${r.activa ? "✅" : "⛔"} ${r.reglaNormalizada} _(origen: ${r.origen.rol}, aplicada ${r.vecesAplicada} veces)_`).join("\n") || "- Ninguna."}

## 6. Lecciones y recomendaciones
${lecciones.map((l) => `- ${l}`).join("\n")}

## 7. Cronología completa
${[...e.timeline].reverse().map((t) => `- ${fmt(t.timestamp)} · T${t.tick} · ${t.tipo}: ${t.texto}`).join("\n")}

---
_Documento generado automáticamente por el Centro de Mando de Crisis AI para su revisión y firma por el responsable municipal. Las decisiones registradas fueron adoptadas por personas; la IA propuso y ejecutó bajo supervisión._
`;
  const inf: Informe = { id: nuevoId("inf"), tipo: "post_mortem", incidenteId: e.incidente.id, generadoEn: new Date().toISOString(), titulo: `Post-mortem — ${e.incidente.titulo}`, markdown: md };
  e.informes.unshift(inf);
  registrar(e, "informe", "Informe post-mortem generado", inf.id);
  return inf;
}
