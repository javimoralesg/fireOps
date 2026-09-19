// =====================================================================
// ATALAYA INCENDIOS · Grafo de intervención de una incidencia
// ---------------------------------------------------------------------
// DUEÑO: constructor G. Sin dependencias (lo usan el lienzo y el expediente).
//
// Se pintan SIEMPRE los agentes de la aplicación, cada uno en la columna de su
// categoría (petición de Javi, 2026-09-19): así se ve el dispositivo entero y
// quién está callado. Los que ahora mismo no hacen nada sobre ESTE incendio
// salen atenuados y con la etiqueta "inactivo ahora"; los que trabajan, en
// color pleno (y con halo si están razonando).
//
// Las aristas son traspasos que han ocurrido de verdad: observación →
// verificador → incendio; decisión: agente proponente → asesor legal →
// supervisor → humano o autónomo → ejecución → unidad, población o canal
// (HappyRobot, Telegram, email). Cada arista lleva sus `hitos`: lo que se
// compartió por ella (el texto de la observación, la decisión con sus
// acciones, el resultado real de la llamada o la ruta OSRM), que es lo que
// enseña el panel al pinchar el enlace.
// =====================================================================

import type { Accion, CategoriaAgente, Decision, Observacion, Snapshot, TipoAccion, TrazaCiclo } from "@/lib/dominio/tipos";
import { canalDeAccion as canalHumanoDeAccion, destinoDeAccion, enmascarar, idsDeFoco, textoDelResultado } from "./hilo";

export type TipoNodo = "agente" | "incendio" | "humano" | "autonomo" | "unidad" | "poblaciones" | "canal" | "motor";
export type TonoNodo = "marca" | "fuego" | "info" | "exito" | "aviso" | "peligro" | "neutro";

/** Lo que viajó por una arista: es lo que se enseña al pinchar el enlace. */
export interface HitoArista {
  /** ISO real. */
  en: string;
  tipo: "observacion" | "decision" | "evaluacion" | "accion" | "acta" | "analisis";
  titulo: string;
  detalle?: string;
  /** "llamada", "SMS", "Telegram", "email"… */
  canal?: string;
  /** Destinatario ya enmascarado (teléfonos y correos nunca enteros en pantalla). */
  destino?: string;
  /** Transcripción, confirmación o resumen devuelto por el proveedor. */
  respuesta?: string;
  proveedor?: string;
  referencia?: string;
  exito?: boolean;
  /** "OSRM 22,6 km / 73 min · sector A". */
  ruta?: string;
  decisionId?: string;
  accionId?: string;
  observacionId?: string;
  informeId?: string;
}

export interface NodoFlujo {
  id: string;
  etiqueta: string;
  sub?: string;
  tipo: TipoNodo;
  tono: TonoNodo;
  /** 0 percepción · 1 análisis · 2 planificación · 3 supervisión/humano · 4 ejecución · 5 destinos. */
  columna: number;
  /** Orden dentro de la columna (menor primero). */
  orden: number;
  /** "3 ciclos · 2 decisiones · 4 acciones". */
  contadores: { etiqueta: string; valor: number }[];
  /** false = no está haciendo nada sobre esta incidencia ahora mismo (se atenúa). */
  activo: boolean;
  /** true si el agente está razonando ahora mismo sobre este incendio. */
  pensando?: boolean;
  /** Id del agente (solo nodos de tipo "agente"). */
  agenteId?: string;
}

export interface AristaFlujo {
  id: string;
  origen: string;
  destino: string;
  etiqueta?: string;
  /** true/false si el traspaso tiene resultado real; undefined si no aplica. */
  exito?: boolean;
  /** Milisegundos (Date.parse) de cada traspaso, para los pulsos. */
  momentos: number[];
  cuenta: number;
  /** Lo que se compartió por esta arista, lo más reciente al final. */
  hitos: HitoArista[];
}

export interface GrafoFlujo {
  nodos: NodoFlujo[];
  aristas: AristaFlujo[];
}

const COLUMNA_CATEGORIA: Record<CategoriaAgente, number> = {
  percepcion: 0,
  analisis: 1,
  planificacion: 2,
  supervision: 3,
  aprendizaje: 3,
  ejecucion: 4,
  comunicacion: 4,
};

const TONO_CATEGORIA: Record<CategoriaAgente, TonoNodo> = {
  percepcion: "info",
  analisis: "marca",
  planificacion: "marca",
  supervision: "aviso",
  aprendizaje: "neutro",
  ejecucion: "exito",
  comunicacion: "marca",
};

const ACCIONES_UNIDAD: TipoAccion[] = ["desplegar_unidad", "reasignar_unidad", "retirar_unidad", "solicitar_medios_aereos"];
const ACCIONES_POBLACION: TipoAccion[] = ["avisar_poblacion", "confinar_poblacion", "evacuar_poblacion"];

/** Minutos de MUNDO sin señal sobre este foco tras los que un agente se da por inactivo. */
export const MINUTOS_MUNDO_ACTIVIDAD = 5;
/**
 * Suelo en tiempo REAL de esa ventana. Con el reloj acelerado (×12) cinco
 * minutos de mundo son 25 s reales, menos que la cadencia de casi todos los
 * agentes: sin este suelo parpadearían a "inactivo" entre ciclo y ciclo.
 */
const SUELO_ACTIVIDAD_MS = 120_000;

/** Nodo del motor que ejecuta las comunicaciones (no es un agente de la lista). */
const NODO_EJECUTOR = "motor:comunicaciones";

/** Agente de percepción que suele traer cada canal de observación. */
function agenteDeCanal(canal: string): string {
  switch (canal) {
    case "camara":
      return "vigia_camaras";
    case "satelite":
      return "satelite";
    case "prensa":
    case "rrss":
      return "prensa_redes";
    case "llamada":
    case "sms":
    case "email":
    case "telegram":
    case "web":
      return "centralita";
    default:
      return "humano";
  }
}

/** Canal externo por el que se ejecuta una comunicación. */
function canalExterno(tipo: TipoAccion, proveedor?: string): string | undefined {
  if (proveedor?.trim()) return proveedor.trim();
  switch (tipo) {
    case "llamar":
    case "enviar_sms":
      return "HappyRobot";
    case "enviar_telegram":
      return "Telegram";
    case "enviar_email":
      return "Email";
    case "publicar_comunicado":
      return "Portal ciudadano";
    case "abrir_ticket":
      return "Ticket interno";
    default:
      return undefined;
  }
}

/** ¿Esta traza de agente habla de este incendio? */
export function trazaDeIncendio(traza: TrazaCiclo, idsDecision: Set<string>, idsObservacion: Set<string>): boolean {
  if (traza.decisiones.some((d) => idsDecision.has(d))) return true;
  if (traza.observaciones.some((o) => idsObservacion.has(o))) return true;
  return false;
}

/** Trazas de un agente que tienen que ver con este incendio, de más nueva a más vieja. */
export function trazasDeAgenteEnIncendio(snapshot: Snapshot | undefined, agenteId: string, incendioId: string): TrazaCiclo[] {
  if (!snapshot) return [];
  const agente = snapshot.agentes.find((a) => a.id === agenteId);
  if (!agente?.trazas?.length) return [];
  const idsFoco = idsDeFoco(snapshot, incendioId);
  const idsDecision = new Set(snapshot.decisiones.filter((d) => d.incendioId && idsFoco.has(d.incendioId)).map((d) => d.id));
  const trazasDirectas = new Set(
    snapshot.decisiones.filter((d) => d.incendioId && idsFoco.has(d.incendioId) && d.trazaId).map((d) => d.trazaId as string),
  );
  const idsObservacion = new Set(snapshot.observaciones.filter((o) => o.incendioId && idsFoco.has(o.incendioId)).map((o) => o.id));
  const candidatas = agente.trazas.filter((t) => trazasDirectas.has(t.id) || trazaDeIncendio(t, idsDecision, idsObservacion));
  // Si el agente está trabajando ahora sobre este foco, sus últimos ciclos cuentan
  // aunque todavía no hayan producido ninguna decisión ni observación.
  const lista = candidatas.length ? candidatas : agente.incendioId && idsFoco.has(agente.incendioId) ? agente.trazas : [];
  return [...lista].sort((a, b) => b.inicio.localeCompare(a.inicio));
}

/** Última traza de un agente relacionada con este incendio. */
export function ultimaTrazaDe(snapshot: Snapshot | undefined, agenteId: string, incendioId: string): TrazaCiclo | undefined {
  return trazasDeAgenteEnIncendio(snapshot, agenteId, incendioId)[0];
}

// ---------------------------------------------------------------------
// Hitos: lo que viaja por cada arista
// ---------------------------------------------------------------------

function hitoObservacion(o: Observacion, titulo: string): HitoArista {
  const e = o.extraccion;
  return {
    en: o.recibidaEn,
    tipo: "observacion",
    titulo,
    detalle: o.texto.slice(0, 800),
    canal: o.canal,
    destino: o.remitente ? enmascarar(o.remitente) : undefined,
    respuesta: e
      ? `${e.esIncendio ? "es incendio" : "no parece incendio"} · ${e.tipo} · gravedad ${e.gravedad} · fiabilidad ${(e.fiabilidad * 100).toFixed(0)} %` +
        (e.lugarTexto ? ` · lugar: ${e.lugarTexto}` : "") +
        (e.municipio ? ` · ${e.municipio}` : "") +
        (e.personasEnRiesgo ? " · PERSONAS EN RIESGO" : "") +
        (e.viviendasCerca ? " · viviendas cerca" : "")
      : undefined,
    referencia: o.referenciaExterna,
    exito: undefined,
    observacionId: o.id,
  };
}

function hitoDecision(d: Decision, titulo: string, en: string, extra?: string): HitoArista {
  return {
    en,
    tipo: "decision",
    titulo,
    detalle:
      `${d.resumen}\n\nPor qué: ${d.razonamiento}` +
      (d.acciones.length ? `\n\nAcciones: ${d.acciones.map((a) => `${a.tipo.replace(/_/g, " ")} — ${a.descripcion} [${a.estado}]`).join("; ")}` : "") +
      (extra ? `\n\n${extra}` : ""),
    respuesta: `estado ${d.estado} · competencia ${d.competencia} · riesgo ${d.riesgo}/100 · prioridad ${d.prioridad}` +
      (d.decididaPor ? ` · decidida por ${d.decididaPor}` : "") +
      (d.comentarioHumano ? ` · «${d.comentarioHumano}»` : ""),
    decisionId: d.id,
  };
}

function hitoAccion(a: Accion, d: Decision, snapshot: Snapshot): HitoArista {
  const unidad = a.objetivo?.unidadId ? snapshot.unidades.find((u) => u.id === a.objetivo?.unidadId) : undefined;
  const destinoBruto = destinoDeAccion(a, snapshot);
  const esContacto = Boolean(a.objetivo?.telefono || a.objetivo?.email);
  const respuesta = a.resultado ? [a.resultado.resumen, textoDelResultado(a)].filter(Boolean).join(" · ") : undefined;
  return {
    en: a.ejecutadaEn ?? a.ordenadaEn ?? d.creadaEn,
    tipo: "accion",
    titulo: a.descripcion,
    detalle: `Acción ${a.tipo.replace(/_/g, " ")} · estado ${a.estado} · de la decisión «${d.titulo}»` + (a.autorizadaPor ? ` · autorizada por ${a.autorizadaPor}` : ""),
    canal: canalHumanoDeAccion(a.tipo),
    destino: destinoBruto ? (esContacto ? enmascarar(destinoBruto) : destinoBruto) : undefined,
    respuesta,
    proveedor: a.resultado?.proveedor,
    referencia: a.resultado?.referencia,
    exito: a.resultado?.exito,
    ruta: unidad?.ruta
      ? `OSRM ${(unidad.ruta.distanciaM / 1000).toFixed(1)} km / ${Math.round(unidad.ruta.duracionS / 60)} min · ${(unidad.ruta.progreso * 100).toFixed(0)} % recorrido` +
        (unidad.sector ? ` · sector ${unidad.sector}` : "")
      : undefined,
    decisionId: d.id,
    accionId: a.id,
    informeId: a.informeId,
  };
}

// ---------------------------------------------------------------------
// Construcción del grafo
// ---------------------------------------------------------------------

/** Máximo de hitos guardados por arista (los más recientes). */
const MAX_HITOS = 12;

export function construirGrafo(snapshot: Snapshot | undefined, incendioId: string): GrafoFlujo {
  if (!snapshot) return { nodos: [], aristas: [] };

  const incendio = snapshot.incendios.find((i) => i.id === incendioId);
  // Un foco absorbido por fusión aporta su intervención a la misma incidencia.
  const idsFoco = idsDeFoco(snapshot, incendioId);
  const deEsteFoco = (id?: string) => Boolean(id && idsFoco.has(id));

  const decisiones = snapshot.decisiones.filter((d) => deEsteFoco(d.incendioId));
  const observaciones = snapshot.observaciones.filter((o) => deEsteFoco(o.incendioId));
  const unidades = snapshot.unidades.filter((u) => deEsteFoco(u.incendioId));
  const poblaciones = snapshot.poblaciones.filter((p) => deEsteFoco(p.incendioId));
  const eventos = snapshot.eventos.filter((e) => deEsteFoco(e.incendioId));
  const informes = (snapshot.informes ?? []).filter((i) => deEsteFoco(i.incendioId));

  const idsDecision = new Set(decisiones.map((d) => d.id));
  const idsObservacion = new Set(observaciones.map((o) => o.id));
  const trazasDirectas = new Set(decisiones.filter((d) => d.trazaId).map((d) => d.trazaId as string));
  for (const i of snapshot.informes ?? []) if (i.decisionId && idsDecision.has(i.decisionId)) informes.push(i);

  const nodos = new Map<string, NodoFlujo>();
  const aristas = new Map<string, AristaFlujo>();

  function momento(iso?: string): number[] {
    if (!iso) return [];
    const t = Date.parse(iso);
    return Number.isFinite(t) ? [t] : [];
  }

  function unir(origen: string, destino: string, etiqueta?: string, exito?: boolean, en?: string, hito?: HitoArista): void {
    if (!origen || !destino || origen === destino) return;
    if (!nodos.has(origen) || !nodos.has(destino)) return;
    const id = `${origen}→${destino}`;
    const previa = aristas.get(id);
    if (!previa) {
      aristas.set(id, { id, origen, destino, etiqueta, exito, momentos: momento(en), cuenta: 1, hitos: hito ? [hito] : [] });
      return;
    }
    previa.cuenta += 1;
    previa.momentos.push(...momento(en));
    if (!previa.etiqueta && etiqueta) previa.etiqueta = etiqueta;
    if (exito === false) previa.exito = false;
    else if (exito === true && previa.exito !== false) previa.exito = true;
    if (hito) previa.hitos.push(hito);
  }

  // --- Nodo del propio incendio (el centro del relato) ----------------
  nodos.set("incendio", {
    id: "incendio",
    etiqueta: incendio?.nombre ?? "Incidencia",
    sub: incendio
      ? `${incendio.estado} · ${incendio.areaHa.toFixed(0)} ha${(incendio.focosAbsorbidos?.length ?? 0) > 0 ? ` · +${incendio.focosAbsorbidos?.length} absorbidos` : ""}`
      : undefined,
    tipo: "incendio",
    tono: "fuego",
    columna: 1,
    orden: -10,
    activo: true,
    contadores: [
      { etiqueta: "observaciones", valor: observaciones.length },
      { etiqueta: "decisiones", valor: decisiones.length },
    ],
  });

  // --- TODOS los agentes de la aplicación, activos o no ----------------
  const factor = Math.max(1, snapshot.reloj?.factor || 12);
  const ventanaMs = Math.max((MINUTOS_MUNDO_ACTIVIDAD * 60_000) / factor, SUELO_ACTIVIDAD_MS);
  const ahora = Date.now();

  /**
   * Señales que NO llevan `agenteId` pero son inequívocamente de un agente:
   * la observación que trajo un canal, la verificación, el despliegue que aplicó
   * el despachador, los fundamentos del asesor legal, la nota del supervisor y
   * las actas del redactor. Sin esto, un agente que acaba de trabajar en el foco
   * saldría gris solo porque su traza no citaba decisiones.
   */
  function sellosAtribuidos(agenteId: string): number[] {
    const fechas: (string | undefined)[] = [];
    for (const o of observaciones) {
      if (agenteDeCanal(o.canal) === agenteId) fechas.push(o.recibidaEn);
      if (agenteId === "verificador" && (o.verificacion || o.impacto)) fechas.push(o.recibidaEn);
    }
    if (agenteId === "despachador") {
      for (const d of decisiones) for (const a of d.acciones) if (ACCIONES_UNIDAD.includes(a.tipo)) fechas.push(a.ejecutadaEn ?? a.ordenadaEn);
      for (const u of unidades) fechas.push(u.ultimaOrden?.en, u.ultimoContacto?.en);
    }
    if (agenteId === "asesor_legal") for (const d of decisiones) if (d.fundamentos.length || d.alertasLegales?.length) fechas.push(d.creadaEn);
    if (agenteId === "supervisor") for (const d of decisiones) if (d.evaluacion) fechas.push(d.evaluacion.en);
    if (agenteId === "redactor") for (const i of informes) fechas.push(i.generadoEn);
    return fechas.filter((f): f is string => Boolean(f)).map((f) => Date.parse(f));
  }

  for (const ficha of snapshot.agentes) {
    const decisionesAgente = decisiones.filter((d) => d.agenteId === ficha.id);
    const trazasAquí = (ficha.trazas ?? []).filter((t) => trazasDirectas.has(t.id) || trazaDeIncendio(t, idsDecision, idsObservacion));
    const eventosAquí = eventos.filter((e) => e.agenteId === ficha.id);

    const trabajandoAhora = Boolean(ficha.incendioId && idsFoco.has(ficha.incendioId)) && !ficha.pausado;
    const cicloEnCurso = trabajandoAhora && (ficha.trazas ?? []).some((t) => t.estado === "en_curso");
    const sellos = [
      ...trazasAquí.map((t) => Date.parse(t.fin ?? t.inicio)),
      ...eventosAquí.map((e) => Date.parse(e.en)),
      ...decisionesAgente.map((d) => Date.parse(d.creadaEn)),
      ...sellosAtribuidos(ficha.id),
    ].filter((n) => Number.isFinite(n));
    const ultimaSenal = sellos.length ? Math.max(...sellos) : undefined;
    const activo = cicloEnCurso || trabajandoAhora || (ultimaSenal !== undefined && ahora - ultimaSenal < ventanaMs);

    nodos.set(ficha.id, {
      id: ficha.id,
      etiqueta: ficha.nombre,
      // `tareaActual` es global: solo se enseña si el agente está en ESTE foco.
      sub: ficha.pausado
        ? "pausado por el mando"
        : trabajandoAhora
          ? ficha.tareaActual?.slice(0, 44) || ficha.modelo
          : activo
            ? "activo aquí hace un momento"
            : "inactivo ahora",
      tipo: "agente",
      tono: activo ? TONO_CATEGORIA[ficha.categoria] : "neutro",
      columna: COLUMNA_CATEGORIA[ficha.categoria],
      orden: 0,
      activo,
      agenteId: ficha.id,
      pensando: ficha.estado === "razonando" && trabajandoAhora,
      contadores: [
        { etiqueta: "ciclos", valor: trazasAquí.length },
        { etiqueta: "decisiones", valor: decisionesAgente.length },
        { etiqueta: "acciones", valor: decisionesAgente.reduce((n, d) => n + d.acciones.filter((a) => a.ordenadaEn || a.ejecutadaEn).length, 0) },
      ],
    });
  }

  // --- Humano, "autónomo" y el motor que ejecuta las comunicaciones -----
  const decisionesHumanas = decisiones.filter(
    (d) => d.estado === "pendiente_humano" || d.estado === "escalada" || (d.decididaPor ?? "").startsWith("humano") || d.agenteId === "humano",
  );
  nodos.set("humano", {
    id: "humano",
    etiqueta: "Humano (mando)",
    sub: decisionesHumanas.length ? "decide sobre esta incidencia" : "sin nada pendiente aquí",
    tipo: "humano",
    tono: decisionesHumanas.length ? "marca" : "neutro",
    columna: 3,
    orden: 10,
    activo: decisionesHumanas.length > 0,
    contadores: [{ etiqueta: "decisiones", valor: decisionesHumanas.length }],
  });

  const decisionesAutonomas = decisiones.filter((d) => d.competencia === "autonoma" && !decisionesHumanas.includes(d));
  nodos.set("autonomo", {
    id: "autonomo",
    etiqueta: "Autónomo",
    sub: decisionesAutonomas.length ? "sin pasar por el mando" : "todavía sin decisiones autónomas",
    tipo: "autonomo",
    tono: decisionesAutonomas.length ? "info" : "neutro",
    columna: 3,
    orden: 20,
    activo: decisionesAutonomas.length > 0,
    contadores: [{ etiqueta: "decisiones", valor: decisionesAutonomas.length }],
  });

  const accionesComunicacion = decisiones.flatMap((d) =>
    d.acciones.filter((a) => !ACCIONES_UNIDAD.includes(a.tipo) && (a.ordenadaEn || a.ejecutadaEn)).map((a) => ({ a, d })),
  );
  if (accionesComunicacion.length) {
    nodos.set(NODO_EJECUTOR, {
      id: NODO_EJECUTOR,
      etiqueta: "Ejecutor de comunicaciones",
      sub: "motor de ejecución (no es un agente)",
      tipo: "motor",
      tono: "exito",
      columna: 4,
      orden: 50,
      activo: true,
      contadores: [{ etiqueta: "acciones", valor: accionesComunicacion.length }],
    });
  }

  // --- Unidades asignadas ---------------------------------------------
  unidades.forEach((u, i) => {
    nodos.set(`uni:${u.id}`, {
      id: `uni:${u.id}`,
      etiqueta: u.nombre,
      sub: `${u.estado.replace(/_/g, " ")}${u.sector ? ` · sector ${u.sector}` : ""}`,
      tipo: "unidad",
      tono: u.estado === "en_intervencion" ? "exito" : u.estado === "en_ruta" ? "aviso" : "neutro",
      columna: 5,
      orden: i,
      activo: u.estado === "en_ruta" || u.estado === "en_intervencion" || u.estado === "asignada",
      contadores: [
        { etiqueta: "personas", valor: u.dotacion.personas },
        { etiqueta: "vehículos", valor: u.dotacion.vehiculos },
      ],
    });
  });

  // --- Poblaciones avisadas -------------------------------------------
  const avisadas = poblaciones.filter((p) => p.estadoAviso !== "sin_avisar");
  nodos.set("poblaciones", {
    id: "poblaciones",
    etiqueta: "Poblaciones avisadas",
    sub: avisadas.length ? avisadas.slice(0, 3).map((p) => p.nombre).join(", ") : "ninguna avisada todavía",
    tipo: "poblaciones",
    tono: avisadas.length ? "aviso" : "neutro",
    columna: 5,
    orden: 100,
    activo: avisadas.length > 0,
    contadores: [
      { etiqueta: "avisadas", valor: avisadas.length },
      { etiqueta: "en el entorno", valor: poblaciones.length },
    ],
  });

  // --- Canales externos usados de verdad -------------------------------
  const usoCanal = new Map<string, { total: number; fallos: number }>();
  for (const { a } of accionesComunicacion) {
    const canal = canalExterno(a.tipo, a.resultado?.proveedor);
    if (!canal) continue;
    const previo = usoCanal.get(canal) ?? { total: 0, fallos: 0 };
    previo.total += 1;
    if (a.resultado && !a.resultado.exito) previo.fallos += 1;
    usoCanal.set(canal, previo);
  }
  let ordenCanal = 200;
  for (const [canal, uso] of usoCanal) {
    nodos.set(`canal:${canal}`, {
      id: `canal:${canal}`,
      etiqueta: canal,
      sub: "canal externo",
      tipo: "canal",
      tono: uso.fallos ? "peligro" : "info",
      columna: 5,
      orden: ordenCanal++,
      activo: true,
      contadores: [
        { etiqueta: "envíos", valor: uso.total },
        { etiqueta: "fallos", valor: uso.fallos },
      ],
    });
  }

  // --- Aristas: percepción → verificación → incendio --------------------
  for (const o of observaciones) {
    const origen = agenteDeCanal(o.canal);
    if (!nodos.has(origen)) continue;
    if (nodos.has("verificador") && origen !== "verificador") {
      unir(origen, "verificador", o.canal, undefined, o.recibidaEn, hitoObservacion(o, `Observación por ${o.canal}`));
      unir("verificador", "incendio", "verifica", undefined, o.recibidaEn, hitoObservacion(o, `Verificada: ${o.verificacion ?? o.impacto ?? "sin veredicto"}`));
    } else {
      unir(origen, "incendio", o.canal, undefined, o.recibidaEn, hitoObservacion(o, `Observación por ${o.canal}`));
    }
  }
  // Analistas que trabajan sobre el foco (propagación, meteo, patrones).
  for (const id of ["propagacion", "meteorologo", "patrones"]) {
    if (!nodos.has(id)) continue;
    const suyos = eventos.filter((e) => e.agenteId === id).slice(-MAX_HITOS);
    if (!suyos.length) continue;
    for (const e of suyos) {
      unir(id, "incendio", "análisis", undefined, e.en, {
        en: e.en,
        tipo: "analisis",
        titulo: e.mensaje,
        detalle: `Evento ${e.tipo.replace(/_/g, " ")} (${e.nivel}) · hora de mundo ${e.enMundo}`,
      });
    }
  }

  // --- Aristas: decisión → autorización → ejecución → destino -----------
  for (const d of decisiones) {
    const proponente = nodos.has(d.agenteId) ? d.agenteId : "incendio";
    unir("incendio", proponente, "situación", undefined, d.creadaEn, hitoDecision(d, `Situación que motivó «${d.titulo}»`, d.creadaEn));

    let anterior = proponente;
    if ((d.fundamentos.length > 0 || (d.alertasLegales?.length ?? 0) > 0) && nodos.has("asesor_legal")) {
      unir(anterior, "asesor_legal", `${d.fundamentos.length} fundamentos`, undefined, d.creadaEn, {
        en: d.creadaEn,
        tipo: "decision",
        titulo: `Revisión legal de «${d.titulo}»`,
        detalle:
          (d.fundamentos.length
            ? d.fundamentos.map((f) => `[${f.documento} §${f.seccion ?? "—"}] «${f.cita}» (similitud ${f.similitud.toFixed(3)})`).join("\n\n")
            : "Sin fundamentos citados.") +
          (d.alertasLegales?.length ? `\n\nAlertas legales: ${d.alertasLegales.join("; ")}` : ""),
        decisionId: d.id,
      });
      anterior = "asesor_legal";
    }
    if (d.evaluacion && nodos.has("supervisor")) {
      unir(anterior, "supervisor", `nota ${d.evaluacion.puntuacion}`, d.evaluacion.aprueba, d.evaluacion.en, {
        en: d.evaluacion.en,
        tipo: "evaluacion",
        titulo: `Evaluación de «${d.titulo}»: ${d.evaluacion.puntuacion}/100`,
        detalle: d.evaluacion.criterios.map((c) => `${c.nombre}: ${c.puntuacion} — ${c.comentario}`).join("\n"),
        respuesta: `${d.evaluacion.aprueba ? "aprueba" : "suspende"} · modelo ${d.evaluacion.modelo}` + (d.evaluacion.motivoEscalado ? ` · escalado: ${d.evaluacion.motivoEscalado}` : ""),
        exito: d.evaluacion.aprueba,
        decisionId: d.id,
      });
      anterior = "supervisor";
    }

    const esHumana = decisionesHumanas.includes(d);
    let decisor = anterior;
    if (esHumana) {
      const etiqueta = d.estado === "denegada" ? "denegada" : d.estado === "pendiente_humano" ? "requiere mando" : d.estado === "escalada" ? "escalada" : "aprobada por el mando";
      unir(anterior, "humano", etiqueta, d.estado === "denegada" ? false : d.estado === "pendiente_humano" || d.estado === "escalada" ? undefined : true, d.decididaEn ?? d.creadaEn, hitoDecision(d, `Al mando: «${d.titulo}»`, d.decididaEn ?? d.creadaEn));
      decisor = "humano";
    } else if (d.competencia === "autonoma") {
      unir(anterior, "autonomo", "autónoma", true, d.creadaEn, hitoDecision(d, `Decidida sin humano: «${d.titulo}»`, d.creadaEn));
      decisor = "autonomo";
    }

    for (const a of d.acciones) {
      if (!a.ordenadaEn && !a.ejecutadaEn) continue;
      const esDeUnidad = ACCIONES_UNIDAD.includes(a.tipo);
      const ejecutor = esDeUnidad ? "despachador" : NODO_EJECUTOR;
      const nodoEjecutor = nodos.has(ejecutor) ? ejecutor : decisor;
      const hito = hitoAccion(a, d, snapshot);
      if (nodoEjecutor !== decisor) unir(decisor, nodoEjecutor, "orden", undefined, a.ordenadaEn ?? d.decididaEn, hito);

      const cuando = a.ejecutadaEn ?? a.ordenadaEn;
      const etiqueta = `${a.tipo.replace(/_/g, " ")}${a.resultado?.referencia ? ` · ${a.resultado.referencia}` : ""}`;
      const unidadId = a.objetivo?.unidadId ? `uni:${a.objetivo.unidadId}` : undefined;
      const canal = canalExterno(a.tipo, a.resultado?.proveedor);

      if (unidadId && nodos.has(unidadId)) unir(nodoEjecutor, unidadId, etiqueta, a.resultado?.exito, cuando, hito);
      else if (ACCIONES_POBLACION.includes(a.tipo)) unir(nodoEjecutor, "poblaciones", etiqueta, a.resultado?.exito, cuando, hito);
      else if (canal && nodos.has(`canal:${canal}`)) unir(nodoEjecutor, `canal:${canal}`, etiqueta, a.resultado?.exito, cuando, hito);
      else unir(nodoEjecutor, "incendio", etiqueta, a.resultado?.exito, cuando, hito);

      // Una llamada o un SMS a un pueblo llega al pueblo: el canal es el medio.
      if (canal && nodos.has(`canal:${canal}`) && a.objetivo?.poblacionId) unir(`canal:${canal}`, "poblaciones", "aviso entregado", a.resultado?.exito, cuando, hito);
      if (canal && nodos.has(`canal:${canal}`) && unidadId && nodos.has(unidadId)) unir(`canal:${canal}`, unidadId, "orden transmitida", a.resultado?.exito, cuando, hito);
    }
  }

  // --- El redactor levanta acta de lo ocurrido --------------------------
  if (nodos.has("redactor")) {
    for (const acta of informes.slice(-MAX_HITOS)) {
      unir("incendio", "redactor", "acta", undefined, acta.generadoEn, {
        en: acta.generadoEn,
        tipo: "acta",
        titulo: acta.titulo,
        detalle: `${acta.tipo}${acta.estadoDecision ? ` · estado «${acta.estadoDecision}»` : ""} · ${acta.conNarrativaIA ? `narrativa de ${acta.modelo}` : "acta determinista"}`,
        referencia: acta.huella?.slice(0, 16),
        decisionId: acta.decisionId,
        informeId: acta.id,
      });
    }
  }

  // Solo los hitos más recientes: el panel enseña lo último, no un archivo.
  for (const a of aristas.values()) {
    a.hitos.sort((x, y) => x.en.localeCompare(y.en));
    if (a.hitos.length > MAX_HITOS) a.hitos = a.hitos.slice(-MAX_HITOS);
    if (a.momentos.length > 40) a.momentos = a.momentos.slice(-40);
  }

  return { nodos: [...nodos.values()], aristas: [...aristas.values()] };
}

/** Lo mínimo que hace falta para colocar un nodo (así el lienzo puede memoizarlo). */
export type NodoColocable = Pick<NodoFlujo, "id" | "columna" | "orden" | "etiqueta">;

/** Disposición automática por columnas: la que usa el botón «Reordenar». */
export function disposicionAutomatica(nodos: NodoColocable[]): Record<string, { x: number; y: number }> {
  const porColumna = new Map<number, NodoColocable[]>();
  for (const n of nodos) {
    const lista = porColumna.get(n.columna) ?? [];
    lista.push(n);
    porColumna.set(n.columna, lista);
  }
  const salida: Record<string, { x: number; y: number }> = {};
  const separacionX = 230;
  const separacionY = 78;
  for (const [columna, lista] of porColumna) {
    lista.sort((a, b) => a.orden - b.orden || a.etiqueta.localeCompare(b.etiqueta));
    const alto = (lista.length - 1) * separacionY;
    lista.forEach((n, i) => {
      salida[n.id] = { x: 120 + columna * separacionX, y: 300 - alto / 2 + i * separacionY };
    });
  }
  return salida;
}

export const TITULOS_COLUMNA = ["Percepción", "Análisis", "Planificación", "Supervisión y mando", "Ejecución", "Destinos reales"];
