// =====================================================================
// ATALAYA INCENDIOS · Hilo de una incidencia (fusión cronológica)
// ---------------------------------------------------------------------
// DUEÑO: constructor G. Sin dependencias (ni React ni Node): lo usan tanto
// el visor del navegador (components/incidencia/HiloIncidencia.tsx) como las
// rutas de servidor (app/api/incidencias/[id]/{hilo,expediente}).
//
// Propósito: reunir en UNA sola línea de tiempo todo lo que le ha pasado a un
// incendio —observaciones, decisiones y cada cambio de estado, acciones con su
// resultado REAL (canal, destino enmascarado, proveedor, referencia externa,
// transcripción), movimientos y llegadas de unidades, avisos a poblaciones,
// comunicados y actas— para poder leerlo como un hilo de noticias y auditarlo.
//
// Regla: nada se inventa. Si un dato no consta, la entrada lo dice.
// =====================================================================

import type { Accion, Decision, Snapshot, TipoAccion } from "@/lib/dominio/tipos";

export type CategoriaHilo = "comunicaciones" | "decisiones" | "unidades" | "percepcion" | "actas";

export const CATEGORIAS_HILO: { id: CategoriaHilo; etiqueta: string }[] = [
  { id: "comunicaciones", etiqueta: "Comunicaciones" },
  { id: "decisiones", etiqueta: "Decisiones" },
  { id: "unidades", etiqueta: "Unidades" },
  { id: "percepcion", etiqueta: "Percepción" },
  { id: "actas", etiqueta: "Actas" },
];

export type IconoHilo =
  | "llamada"
  | "sms"
  | "telegram"
  | "email"
  | "comunicado"
  | "decision"
  | "estado"
  | "unidad"
  | "poblacion"
  | "observacion"
  | "camara"
  | "satelite"
  | "prensa"
  | "acta"
  | "meteo"
  | "incendio"
  | "sistema";

export type TonoHilo = "neutro" | "peligro" | "aviso" | "exito" | "info" | "marca" | "fuego";

export interface InsigniaHilo {
  texto: string;
  tono: TonoHilo;
}

export interface EntradaHilo {
  id: string;
  /** ISO real. */
  en: string;
  /** ISO de mundo (si no consta, el real). */
  enMundo: string;
  categoria: CategoriaHilo;
  icono: IconoHilo;
  /** Una frase. */
  titulo: string;
  /** Segunda línea con el detalle verificable. */
  detalle?: string;
  /** Agente, canal o persona responsable. */
  actor?: string;
  insignias: InsigniaHilo[];
  decisionId?: string;
  accionId?: string;
  informeId?: string;
  /** true/false si la entrada tiene un resultado real; undefined si no aplica. */
  exito?: boolean;
  /** Texto adicional donde también busca el buscador. */
  busqueda: string;
}

// ---------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------

/** Teléfonos y correos se guardan enteros en el acta, pero en pantalla se enmascaran. */
export function enmascarar(destino?: string): string {
  const d = (destino ?? "").trim();
  if (!d) return "destino no consta";
  if (d.includes("@")) {
    const [usuario, dominio] = d.split("@");
    const visible = usuario.slice(0, Math.min(2, usuario.length));
    return `${visible}${"•".repeat(Math.max(1, usuario.length - visible.length))}@${dominio}`;
  }
  const soloDigitos = d.replace(/[^\d+]/g, "");
  if (soloDigitos.length >= 6) {
    return `${soloDigitos.slice(0, 4)}${"•".repeat(Math.max(2, soloDigitos.length - 6))}${soloDigitos.slice(-2)}`;
  }
  return d;
}

const ACCIONES_UNIDAD: TipoAccion[] = ["desplegar_unidad", "reasignar_unidad", "retirar_unidad", "solicitar_medios_aereos"];
const ACCIONES_COMUNICACION: TipoAccion[] = [
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
];

export function categoriaDeAccion(tipo: TipoAccion): CategoriaHilo {
  if (ACCIONES_UNIDAD.includes(tipo)) return "unidades";
  if (ACCIONES_COMUNICACION.includes(tipo)) return "comunicaciones";
  return "decisiones";
}

function iconoDeAccion(tipo: TipoAccion): IconoHilo {
  switch (tipo) {
    case "llamar":
      return "llamada";
    case "enviar_sms":
      return "sms";
    case "enviar_telegram":
      return "telegram";
    case "enviar_email":
      return "email";
    case "publicar_comunicado":
      return "comunicado";
    case "avisar_poblacion":
    case "confinar_poblacion":
    case "evacuar_poblacion":
      return "poblacion";
    case "desplegar_unidad":
    case "reasignar_unidad":
    case "retirar_unidad":
    case "solicitar_medios_aereos":
      return "unidad";
    default:
      return "decision";
  }
}

/** Canal humano de una acción de comunicación ("llamada", "SMS", "Telegram", "email"). */
export function canalDeAccion(tipo: TipoAccion): string | undefined {
  switch (tipo) {
    case "llamar":
      return "llamada";
    case "enviar_sms":
      return "SMS";
    case "enviar_telegram":
      return "Telegram";
    case "enviar_email":
      return "email";
    default:
      return undefined;
  }
}

/** Destino declarado de una acción, sin enmascarar (para el expediente). */
export function destinoDeAccion(a: Accion, snapshot: Snapshot): string | undefined {
  const o = a.objetivo;
  if (!o) return undefined;
  if (o.telefono) return o.telefono;
  if (o.email) return o.email;
  if (o.unidadId) return snapshot.unidades.find((u) => u.id === o.unidadId)?.nombre ?? o.unidadId;
  if (o.poblacionId) return snapshot.poblaciones.find((p) => p.id === o.poblacionId)?.nombre ?? o.poblacionId;
  if (o.camaraId) return snapshot.camaras.find((c) => c.id === o.camaraId)?.nombre ?? o.camaraId;
  if (o.punto) return `${o.punto.lat.toFixed(4)}, ${o.punto.lon.toFixed(4)}`;
  return undefined;
}

const CLAVES_TEXTO = /(transcrip|confirm|respuesta|mensaje|contest|resumen|texto|dijo)/i;

/** Transcripción o confirmación devuelta por el proveedor, si la hay. */
export function textoDelResultado(a: Accion): string | undefined {
  const datos = a.resultado?.datos;
  if (!datos) return undefined;
  for (const [clave, valor] of Object.entries(datos)) {
    if (!CLAVES_TEXTO.test(clave)) continue;
    if (typeof valor === "string" && valor.trim()) return `${clave}: ${valor.trim()}`;
    if (typeof valor === "boolean") return `${clave}: ${valor ? "sí" : "no"}`;
  }
  return undefined;
}

/** Frase con el resultado REAL de una acción: proveedor, referencia y qué pasó. */
export function detalleDeAccion(a: Accion, snapshot: Snapshot): string {
  const trozos: string[] = [];
  const canal = canalDeAccion(a.tipo);
  if (canal) trozos.push(`Canal ${canal}`);
  const destino = destinoDeAccion(a, snapshot);
  if (destino) trozos.push(`a ${a.objetivo?.telefono || a.objetivo?.email ? enmascarar(destino) : destino}`);

  if (ACCIONES_UNIDAD.includes(a.tipo)) {
    const u = a.objetivo?.unidadId ? snapshot.unidades.find((x) => x.id === a.objetivo?.unidadId) : undefined;
    if (u) {
      trozos.push(`${u.nombre} (${u.tipo.replace(/_/g, " ")})`);
      if (u.ruta) {
        trozos.push(
          `ruta OSRM ${(u.ruta.distanciaM / 1000).toFixed(1)} km / ${Math.round(u.ruta.duracionS / 60)} min` +
            (u.ruta.progreso > 0 ? ` · ${Math.round(u.ruta.progreso * 100)} % recorrido` : ""),
        );
      }
      const sector = u.sector ?? (typeof a.parametros?.sector === "string" ? (a.parametros.sector as string) : undefined);
      if (sector) trozos.push(`sector ${sector}`);
    }
  }

  const r = a.resultado;
  if (r) {
    trozos.push(`${r.proveedor}: ${r.resumen}`);
    if (r.referencia) trozos.push(`ref. ${r.referencia}`);
    const texto = textoDelResultado(a);
    if (texto) trozos.push(texto);
  } else if (a.estado === "pendiente" || a.estado === "ejecutando") {
    trozos.push("todavía sin resultado del proveedor");
  } else {
    trozos.push("sin resultado registrado");
  }
  return trozos.join(" · ");
}

function insigniasDeAccion(a: Accion): InsigniaHilo[] {
  const salida: InsigniaHilo[] = [{ texto: a.tipo.replace(/_/g, " "), tono: "neutro" }];
  if (a.resultado) salida.push({ texto: a.resultado.exito ? "Éxito" : "Fallo", tono: a.resultado.exito ? "exito" : "peligro" });
  else salida.push({ texto: a.estado.replace(/_/g, " "), tono: a.estado === "fallida" ? "peligro" : "neutro" });
  if (a.autorizadaPor) salida.push({ texto: a.autorizadaPor.startsWith("humano") ? a.autorizadaPor : "autorizada por IA", tono: a.autorizadaPor.startsWith("humano") ? "marca" : "info" });
  return salida;
}

const TONO_ESTADO_DECISION: Record<Decision["estado"], TonoHilo> = {
  propuesta: "neutro",
  pendiente_humano: "aviso",
  aprobada: "exito",
  denegada: "peligro",
  ejecutando: "info",
  ejecutada: "exito",
  fallida: "peligro",
  escalada: "aviso",
  caducada: "neutro",
};

// ---------------------------------------------------------------------
// Construcción del hilo
// ---------------------------------------------------------------------

/** Eventos que ya cuentan las decisiones y las acciones: se omiten para no duplicar. */
const EVENTOS_OMITIDOS = new Set([
  "decision_propuesta",
  "decision_aprobada",
  "decision_denegada",
  "decision_ejecutada",
  "decision_escalada",
  "accion_ejecutada",
  "accion_fallida",
]);

function categoriaDeEvento(tipo: string): CategoriaHilo {
  if (tipo === "unidad_movida" || tipo === "unidad_llega") return "unidades";
  if (tipo === "poblacion_avisada" || tipo === "comunicado") return "comunicaciones";
  if (["observacion", "camara_positiva", "satelite", "viento_gira", "peligro_sube", "incendio_nuevo", "incendio_actualizado", "incendio_cerrado"].includes(tipo)) {
    return "percepcion";
  }
  return "decisiones";
}

function iconoDeEvento(tipo: string): IconoHilo {
  if (tipo === "unidad_movida" || tipo === "unidad_llega") return "unidad";
  if (tipo === "poblacion_avisada") return "poblacion";
  if (tipo === "comunicado") return "comunicado";
  if (tipo === "camara_positiva") return "camara";
  if (tipo === "satelite") return "satelite";
  if (tipo === "viento_gira" || tipo === "peligro_sube") return "meteo";
  if (tipo.startsWith("incendio")) return "incendio";
  if (tipo === "observacion") return "observacion";
  return "sistema";
}

function iconoDeObservacion(canal: string): IconoHilo {
  switch (canal) {
    case "llamada":
      return "llamada";
    case "sms":
      return "sms";
    case "telegram":
      return "telegram";
    case "email":
      return "email";
    case "camara":
      return "camara";
    case "satelite":
      return "satelite";
    case "prensa":
    case "rrss":
      return "prensa";
    default:
      return "observacion";
  }
}

/**
 * Ids de foco que componen esta incidencia: el propio y todos los que ha
 * absorbido al juntarse (`focosAbsorbidos`, contrato ampliado 2026-09-19).
 * Sus eventos, decisiones y actas conservan su `incendioId` original, así que
 * el hilo del superviviente tiene que mirarlos todos.
 */
export function idsDeFoco(snapshot: Snapshot | undefined, incendioId: string): Set<string> {
  const ids = new Set<string>([incendioId]);
  if (!snapshot) return ids;
  const porVisitar = [incendioId];
  while (porVisitar.length) {
    const actual = porVisitar.pop() as string;
    for (const absorbido of snapshot.incendios.find((i) => i.id === actual)?.focosAbsorbidos ?? []) {
      if (!ids.has(absorbido)) {
        ids.add(absorbido);
        porVisitar.push(absorbido);
      }
    }
  }
  return ids;
}

/**
 * Todo lo ocurrido en un incendio, más reciente primero.
 * `snapshot` puede venir del SSE (navegador) o de `estado.snapshot()` (servidor).
 * Incluye lo de los focos absorbidos, marcado con su procedencia.
 */
export function construirHilo(snapshot: Snapshot | undefined, incendioId: string): EntradaHilo[] {
  if (!snapshot) return [];
  const entradas: EntradaHilo[] = [];
  const idsFoco = idsDeFoco(snapshot, incendioId);
  const nombreFoco = (id?: string) => snapshot.incendios.find((i) => i.id === id)?.nombre ?? id ?? "otro foco";
  /** Marca de procedencia cuando la entrada viene de un foco absorbido. */
  const procedencia = (id?: string): InsigniaHilo[] =>
    id && id !== incendioId ? [{ texto: `foco absorbido · ${nombreFoco(id)}`, tono: "neutro" }] : [];
  const decisiones = snapshot.decisiones.filter((d) => d.incendioId && idsFoco.has(d.incendioId));
  const idsDecision = new Set(decisiones.map((d) => d.id));

  // --- Fusiones de focos ----------------------------------------------
  for (const id of idsFoco) {
    const foco = snapshot.incendios.find((i) => i.id === id);
    if (!foco?.fusionadoEn) continue;
    const superviviente = nombreFoco(foco.fusionadoEn);
    entradas.push({
      id: `fus-${foco.id}`,
      en: foco.actualizadoEn,
      enMundo: foco.actualizadoEn,
      categoria: "percepcion",
      icono: "incendio",
      titulo: `«${foco.nombre}» se unió a «${superviviente}»: los dos focos se juntaron en uno.`,
      detalle: `Todo lo registrado por «${foco.nombre}» (${foco.areaHa.toFixed(0)} ha en el momento de fusionarse) sigue en este hilo con su procedencia marcada.`,
      actor: "verificador",
      insignias: [{ texto: "fusión de focos", tono: "fuego" }],
      busqueda: `fusion ${foco.nombre} ${superviviente} ${foco.id} ${foco.fusionadoEn}`,
    });
  }

  // --- Observaciones -------------------------------------------------
  for (const o of snapshot.observaciones) {
    if (!o.incendioId || !idsFoco.has(o.incendioId)) continue;
    const resumen = o.extraccion?.resumen?.trim() || o.texto.trim();
    entradas.push({
      id: `obs-${o.id}`,
      en: o.recibidaEn,
      enMundo: o.recibidaEn,
      categoria: "percepcion",
      icono: iconoDeObservacion(o.canal),
      titulo: `${o.canal.replace(/_/g, " ")}: ${resumen.slice(0, 160)}`,
      detalle: [o.verificacion, o.remitente ? `remitente ${enmascarar(o.remitente)}` : undefined, o.referenciaExterna ? `ref. ${o.referenciaExterna}` : undefined, o.urlFuente]
        .filter(Boolean)
        .join(" · ") || undefined,
      actor: o.remitente ? enmascarar(o.remitente) : o.canal,
      insignias: [
        { texto: o.canal, tono: "neutro" },
        ...(o.impacto ? [{ texto: o.impacto.replace(/_/g, " "), tono: o.impacto === "nuevo_foco" || o.impacto === "agrava" ? ("peligro" as TonoHilo) : ("info" as TonoHilo) }] : []),
        ...(o.extraccion ? [{ texto: `gravedad ${o.extraccion.gravedad}`, tono: o.extraccion.gravedad === "critica" || o.extraccion.gravedad === "grave" ? ("peligro" as TonoHilo) : ("neutro" as TonoHilo) }] : []),
        ...procedencia(o.incendioId),
      ],
      busqueda: `${o.texto} ${o.canal} ${o.remitente ?? ""} ${o.verificacion ?? ""} ${o.referenciaExterna ?? ""}`,
    });
  }

  // --- Decisiones y cada uno de sus cambios de estado -----------------
  for (const d of decisiones) {
    entradas.push({
      id: `dec-${d.id}`,
      en: d.creadaEn,
      enMundo: d.creadaEnMundo || d.creadaEn,
      categoria: "decisiones",
      icono: "decision",
      titulo: d.titulo,
      detalle: d.resumen,
      actor: d.agenteId,
      decisionId: d.id,
      insignias: [
        { texto: d.estado.replace(/_/g, " "), tono: TONO_ESTADO_DECISION[d.estado] },
        { texto: d.competencia, tono: d.competencia === "autonoma" ? "info" : d.competencia === "humano" ? "aviso" : "neutro" },
        { texto: `prioridad ${d.prioridad}`, tono: d.prioridad <= 2 ? "peligro" : "neutro" },
        ...(d.evaluacion ? [{ texto: `supervisor ${d.evaluacion.puntuacion}/100`, tono: d.evaluacion.aprueba ? ("exito" as TonoHilo) : ("aviso" as TonoHilo) }] : []),
        ...procedencia(d.incendioId),
      ],
      busqueda: `${d.titulo} ${d.resumen} ${d.razonamiento} ${d.agenteId} ${d.id}`,
    });

    for (const h of d.historial ?? []) {
      entradas.push({
        id: `est-${d.id}-${h.en}-${h.estado}`,
        en: h.en,
        enMundo: h.enMundo || h.en,
        categoria: "decisiones",
        icono: "estado",
        titulo: `«${d.titulo}» pasa a ${h.estado.replace(/_/g, " ")}`,
        detalle: h.motivo,
        actor: h.quien,
        decisionId: d.id,
        exito: h.estado === "denegada" || h.estado === "fallida" ? false : undefined,
        insignias: [{ texto: h.estado.replace(/_/g, " "), tono: TONO_ESTADO_DECISION[h.estado] }, { texto: h.quien, tono: h.quien.startsWith("humano") ? "marca" : "neutro" }],
        busqueda: `${d.titulo} ${h.estado} ${h.quien} ${h.motivo ?? ""}`,
      });
    }

    for (const a of d.acciones) {
      if (!a.ejecutadaEn && !a.ordenadaEn && a.estado === "pendiente") continue;
      entradas.push({
        id: `acc-${a.id}`,
        en: a.ejecutadaEn ?? a.ordenadaEn ?? d.creadaEn,
        enMundo: a.ejecutadaEn ?? a.ordenadaEn ?? d.creadaEnMundo,
        categoria: categoriaDeAccion(a.tipo),
        icono: iconoDeAccion(a.tipo),
        titulo: a.descripcion,
        detalle: detalleDeAccion(a, snapshot),
        actor: a.autorizadaPor ?? d.decididaPor ?? d.agenteId,
        decisionId: d.id,
        accionId: a.id,
        informeId: a.informeId,
        exito: a.resultado?.exito,
        insignias: [...insigniasDeAccion(a), ...procedencia(d.incendioId)],
        busqueda: `${a.descripcion} ${a.tipo} ${a.resultado?.resumen ?? ""} ${a.resultado?.referencia ?? ""} ${destinoDeAccion(a, snapshot) ?? ""}`,
      });
    }
  }

  // --- Comunicados ---------------------------------------------------
  for (const c of snapshot.comunicados) {
    if (!c.incendioId || !idsFoco.has(c.incendioId)) continue;
    entradas.push({
      id: `com-${c.id}`,
      en: c.publicadoEn ?? snapshot.generadoEn,
      enMundo: c.publicadoEn ?? snapshot.generadoEn,
      categoria: "comunicaciones",
      icono: "comunicado",
      titulo: `Comunicado: ${c.titulo}`,
      detalle: `${c.cuerpo.slice(0, 220)}${c.cuerpo.length > 220 ? "…" : ""} · canales: ${c.canales.join(", ") || "sin canal"}`,
      actor: c.aprobadoPor ?? "portavoz",
      decisionId: c.decisionId,
      insignias: [{ texto: c.estado.replace(/_/g, " "), tono: c.estado === "publicado" ? "exito" : "aviso" }, ...procedencia(c.incendioId)],
      busqueda: `${c.titulo} ${c.cuerpo} ${c.canales.join(" ")}`,
    });
  }

  // --- Actas ---------------------------------------------------------
  for (const i of snapshot.informes ?? []) {
    if (!(i.incendioId && idsFoco.has(i.incendioId)) && !(i.decisionId && idsDecision.has(i.decisionId))) continue;
    entradas.push({
      id: `inf-${i.id}`,
      en: i.generadoEn,
      enMundo: i.generadoEn,
      categoria: "actas",
      icono: "acta",
      titulo: i.titulo,
      detalle: `${i.tipo}${i.estadoDecision ? ` · estado «${i.estadoDecision}»` : ""} · ${i.conNarrativaIA ? `narrativa de ${i.modelo}` : "acta determinista"}${i.huella ? ` · huella ${i.huella.slice(0, 12)}…` : ""}`,
      actor: i.agenteId ?? "redactor",
      decisionId: i.decisionId,
      informeId: i.id,
      insignias: [
        { texto: i.tipo, tono: "marca" },
        { texto: i.conNarrativaIA ? "con IA" : "determinista", tono: i.conNarrativaIA ? "info" : "neutro" },
        ...procedencia(i.incendioId),
      ],
      busqueda: `${i.titulo} ${i.tipo} ${i.id} ${i.huella ?? ""}`,
    });
  }

  // --- Eventos del registro vivo --------------------------------------
  for (const e of snapshot.eventos) {
    if (!e.incendioId || !idsFoco.has(e.incendioId)) continue;
    if (EVENTOS_OMITIDOS.has(e.tipo)) continue;
    entradas.push({
      id: `ev-${e.id}`,
      en: e.en,
      enMundo: e.enMundo || e.en,
      categoria: categoriaDeEvento(e.tipo),
      icono: iconoDeEvento(e.tipo),
      titulo: e.mensaje,
      actor: e.agenteId,
      insignias: [
        { texto: e.tipo.replace(/_/g, " "), tono: e.nivel === "critico" ? "peligro" : e.nivel === "aviso" ? "aviso" : "neutro" },
        ...procedencia(e.incendioId),
      ],
      busqueda: `${e.mensaje} ${e.tipo} ${e.agenteId ?? ""}`,
    });
  }

  return entradas.sort((a, b) => b.en.localeCompare(a.en));
}

/** Filtra el hilo por categorías activas y texto libre. */
export function filtrarHilo(entradas: EntradaHilo[], categorias: Set<CategoriaHilo>, texto: string): EntradaHilo[] {
  const busqueda = texto.trim().toLowerCase();
  return entradas.filter((e) => {
    if (categorias.size > 0 && !categorias.has(e.categoria)) return false;
    if (busqueda && !`${e.titulo} ${e.detalle ?? ""} ${e.actor ?? ""} ${e.busqueda}`.toLowerCase().includes(busqueda)) return false;
    return true;
  });
}
