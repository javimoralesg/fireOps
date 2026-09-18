// Política de autonomía de la IA: qué tipos de actuación puede gestionar sola,
// cuáles propone pero firma una persona y cuáles quedan reservadas a personas.
//
// Archivo COMPARTIDO y de solo datos + funciones puras (sin imports de servidor
// ni de React), al estilo de lib/roles.ts: lo usa el motor (lib/server/motor.ts)
// al crear cada decisión y la UI para explicar quién gestiona cada propuesta.
// Dueño: poc-c5. Guía: docs/politica-autonomia.md.
//
// Tres capas se combinan en un veredicto por decisión:
//   1. Catálogo de actuaciones, rankeado por riesgo mínimo (el "suelo": la IA no
//      puede autoasignarse un riesgo menor que el de la categoría más grave que toca).
//   2. Modo de cada categoría: `autonoma` (la IA ejecuta si el riesgo no supera el
//      umbral), `supervisada` (la IA propone; firma una persona, siempre) o `humano`
//      (reservada a personas: la IA prepara el expediente, nunca ejecuta).
//   3. Umbral de autonomía global (EstadoSistema.umbralAutonomia) y límites de firma
//      por rol (lib/roles.ts: riesgoMaxDecision, escalarA).
// Lo que no está en el catálogo nunca se ejecuta solo: lista blanca, no lista negra.

import { ROLES, ROLES_LISTA, escalarA, puede, puedeDecidir, type RolId } from "./roles";

export type ModoCompetencia = "autonoma" | "supervisada" | "humano";

export type CategoriaId =
  | "informe"
  | "consulta"
  | "aviso_interno"
  | "voluntariado"
  | "comunicacion_publica"
  | "despliegue"
  | "proteccion_infraestructura"
  | "trafico_parcial"
  | "trafico_total"
  | "confinamiento"
  | "evacuacion"
  | "suministros"
  | "alerta_masiva"
  | "situacion_operativa"
  | "medios_privados";

export interface CategoriaAccion {
  id: CategoriaId;
  nombre: string;
  /** Qué actuaciones concretas incluye, en una frase. */
  descripcion: string;
  ejemplos: string[];
  /** Suelo de riesgo 0-100: posición en el ranking y mínimo que se aplica a la decisión. */
  riesgoMinimo: number;
  modo: ModoCompetencia;
  /** Rol mínimo que puede firmar, además del que exija el riesgo (solo roles con permiso `decidir`). */
  firmaMinima?: RolId;
  /** ¿Se puede deshacer en minutos sin daño? */
  reversible: boolean;
  /** ¿Restringe derechos o libertades de la población (movilidad, propiedad, confinamiento)? */
  afectaDerechos: boolean;
  /** Referencia normativa o de plan que justifica el modo por defecto. */
  base: string;
  /** Heurística de clasificación sobre el texto normalizado (sin tildes, minúsculas) de la decisión. */
  patrones: RegExp[];
}

/** Cambio puntual sobre una categoría del catálogo (lo que guarda la política). */
export interface AjusteCategoria {
  modo?: ModoCompetencia;
  riesgoMinimo?: number;
  /** `null` = sin firma mínima propia (manda solo el riesgo). */
  firmaMinima?: RolId | null;
}

export interface CambioPolitica {
  timestamp: string;
  rol: RolId;
  categoria: CategoriaId | "todas";
  texto: string;
}

export interface PoliticaAutonomia {
  version: 1;
  ajustes: Partial<Record<CategoriaId, AjusteCategoria>>;
  historial: CambioPolitica[];
  actualizadaEn?: string;
}

/** Resultado de aplicar la política a una decisión concreta. Se guarda en Decision.competencia. */
export interface VeredictoCompetencia {
  modo: ModoCompetencia;
  /** Categorías detectadas, de más a menos restrictiva. */
  categorias: CategoriaId[];
  /** La que manda (primera de `categorias`); null si la decisión queda fuera del catálogo. */
  categoriaDominante: CategoriaId | null;
  /** Riesgo que estimó la IA al proponer. */
  riesgoPropuesto: number;
  /** max(riesgoPropuesto, suelo de la categoría dominante). Es el que compara con umbral y límites de rol. */
  riesgoEfectivo: number;
  /** Umbral de autonomía aplicado. */
  umbral: number;
  /** Rol mínimo que puede firmar; null si la IA puede ejecutar sola. */
  firmaMinima: RolId | null;
  /** Explicación en una frase, para la timeline y la UI. */
  motivo: string;
  evaluadaEn: string;
}

/** Subconjunto de Decision que hace falta para clasificar (evita importar tipos-sistema). */
export interface DecisionClasificable {
  foco: string;
  riesgo: number;
  tarjeta: {
    titulo: string;
    resumen: string;
    plan: { acciones: { recurso: string; accion: string }[]; mensajeAlerta: string };
  };
  /** Si el proponente ya etiquetó categorías del catálogo, se usan en vez de la heurística. */
  categorias?: string[];
}

export const POLITICA_VACIA: PoliticaAutonomia = { version: 1, ajustes: {}, historial: [] };

export const MODO_ORDEN: Record<ModoCompetencia, number> = { humano: 2, supervisada: 1, autonoma: 0 };

export const MODO_ETIQUETA: Record<ModoCompetencia, { corta: string; larga: string; quien: string }> = {
  autonoma: { corta: "IA autónoma", larga: "La IA decide y ejecuta sola", quien: "IA" },
  supervisada: { corta: "Firma humana", larga: "La IA propone; firma una persona", quien: "IA propone · persona firma" },
  humano: { corta: "Reservada", larga: "Reservada a personas: la IA solo prepara el expediente", quien: "Persona" },
};

// ---------------------------------------------------------------------------
// Catálogo por defecto (ranking de menor a mayor riesgo)
// ---------------------------------------------------------------------------

export const CATALOGO: CategoriaAccion[] = [
  {
    id: "informe",
    nombre: "Informes y actas",
    descripcion: "Redactar SITREP, actas de decisión y borradores de post-mortem a partir de la evidencia.",
    ejemplos: ["SITREP cada 30 min", "Acta de la decisión aprobada"],
    riesgoMinimo: 5,
    modo: "autonoma",
    reversible: true,
    afectaDerechos: false,
    base: "PEMAM · CECOP: la información al mando es continua y no compromete a nadie.",
    patrones: [/\b(sitrep|informe de situacion|acta de decision|post-?mortem)\b/],
  },
  {
    id: "consulta",
    nombre: "Verificación y recogida de información",
    descripcion: "Llamar o consultar para confirmar datos: capacidad de urgencias, censo de una residencia, estado de un sensor.",
    ejemplos: ["Llamada al jefe de guardia para confirmar camas", "Confirmar censo de la residencia"],
    riesgoMinimo: 10,
    modo: "autonoma",
    reversible: true,
    afectaDerechos: false,
    base: "Norma Básica (RD 524/2023): evaluación continua de la situación.",
    patrones: [/\b(confirmar|verificar|comprobar|consultar|recabar)\b/],
  },
  {
    id: "aviso_interno",
    nombre: "Comunicación interna a servicios",
    descripcion: "Avisos por SMS, radio o llamada a bomberos, SAMUR, policía, hospitales, EMT o compañías de servicios.",
    ejemplos: ["SMS a Policía Municipal con el corte", "Preaviso al hospital de humo denso"],
    riesgoMinimo: 15,
    modo: "autonoma",
    reversible: true,
    afectaDerechos: false,
    base: "PEMAM · CECOP: coordinación de servicios intervinientes.",
    patrones: [
      /\b(preaviso|preavisar|avisar|notificar|alertar|comunicar) (a|al|a la|a los|a las) (bomberos|samur|policia|hospital|urgencias|servicios|dotaciones|efectivos|pma|cecop|metro|emt|canal|companias?)/,
      /\b(aviso en paneles|paneles de mensaje variable|por radio|emisora)\b/,
    ],
  },
  {
    id: "voluntariado",
    nombre: "Tareas para voluntariado",
    descripcion: "Proponer tareas de bajo riesgo a la Agrupación de Voluntarios: mantas, agua, apoyo logístico, acompañamiento.",
    ejemplos: ["Llevar mantas al polideportivo", "Reparto de agua en el punto de encuentro"],
    riesgoMinimo: 15,
    modo: "autonoma",
    reversible: true,
    afectaDerechos: false,
    base: "Ley 17/2015 · voluntariado de protección civil; la publicación la controla la Coordinación de Voluntariado.",
    patrones: [/voluntari/],
  },
  {
    id: "comunicacion_publica",
    nombre: "Comunicación a la población",
    descripcion: "Comunicados oficiales, notas a medios, publicación en portal y redes, desmentido de bulos.",
    ejemplos: ["Comunicado: evitar la zona, cerrar ventanas", "Desmentir vídeos reciclados"],
    riesgoMinimo: 30,
    modo: "supervisada",
    reversible: false,
    afectaDerechos: false,
    base: "PEMAM · Gabinete de Información: una sola voz oficial.",
    patrones: [
      /\b(comunicado|nota de prensa|rueda de prensa|nota a (los )?medios|redes sociales|portal|desmentir|desmentido|bulo|bulos|portavoz)\b/,
      /\b(aviso|informar|informacion|recomendaciones|mensaje) a la (poblacion|ciudadania|vecindad)\b/,
    ],
  },
  {
    id: "despliegue",
    nombre: "Despliegue de medios propios",
    descripcion: "Movilizar dotaciones de bomberos, SAMUR y policía, fijar perímetro, montar el puesto de mando avanzado.",
    ejemplos: ["2 autobombas + escala al incendio", "Perímetro de 300 m"],
    riesgoMinimo: 35,
    modo: "supervisada",
    reversible: true,
    afectaDerechos: false,
    base: "PEMAM · Dirección Técnica: mando de los grupos de acción.",
    patrones: [/\b(despleg\w*|despliegue|moviliz\w*|dotaci\w*|autobomba\w*|autoescala|perimetro|puesto de mando avanzado|pma|reposicionar|preposicionar)\b/],
  },
  {
    id: "proteccion_infraestructura",
    nombre: "Protección de infraestructuras críticas",
    descripcion: "Medidas sobre hospitales, subestaciones o centros de comunicaciones: sellar tomas de aire, desviar ambulancias, rutas alternativas.",
    ejemplos: ["Sellar urgencias del hospital", "Desviar ambulancias a otro centro"],
    riesgoMinimo: 35,
    modo: "supervisada",
    reversible: true,
    afectaDerechos: false,
    base: "Ley 8/2011 de infraestructuras críticas; PEMAM · continuidad asistencial.",
    patrones: [
      /\b(sellar|tomas? de aire|climatizacion|plan de contingencia|desviar ambulancias|ruta alternativa|carril de emergencia)\b/,
      /\b(proteger|proteccion|asegurar)\b.*\b(hospital|subestacion|centro 112|deposito|potabilizadora|infraestructura)\b/,
    ],
  },
  {
    id: "trafico_parcial",
    nombre: "Restricción parcial de tráfico",
    descripcion: "Cortar un carril, un acceso o una calle secundaria; desvíos, regulación semafórica, desvío de líneas de autobús.",
    ejemplos: ["Corte del carril derecho de la M-30", "Desvío de las líneas 8 y 148"],
    riesgoMinimo: 45,
    modo: "supervisada",
    reversible: true,
    afectaDerechos: true,
    base: "PEMAM · regulación de tráfico; Policía Municipal.",
    patrones: [
      /\b(corte parcial|cortar (un |el )?carril|corte del carril|desvio|desviar|regulacion semaforica|restringir (el )?(trafico|acceso)|corte de (trafico|via|calle)|cortar c\/|cortar (la )?calle)\b/,
      /\bcort\w* (c\/|calle|dr\.|avda|avenida|paseo|plaza|glorieta)/,
    ],
  },
  {
    id: "trafico_total",
    nombre: "Corte total de vías principales",
    descripcion: "Cerrar por completo autovías, túneles o ejes estructurantes (M-30, A-3, Calle 30).",
    ejemplos: ["Corte total de la M-30 sur entre salidas 11 y 13"],
    riesgoMinimo: 65,
    modo: "supervisada",
    firmaMinima: "director_tecnico",
    reversible: true,
    afectaDerechos: true,
    base: "PEMAM · Dirección Técnica; coordinación con DGT y Centro de Gestión de Tráfico.",
    patrones: [/\b(corte total|cierre total|cerrar (por completo )?(la |el )?(m-?30|m-?40|a-?[1-6]|autovia|autopista|tunel|calle 30))\b/],
  },
  {
    id: "confinamiento",
    nombre: "Confinamiento de población",
    descripcion: "Ordenar a vecinos permanecer en sus casas con ventanas cerradas o no salir de un recinto.",
    ejemplos: ["Confinamiento de los bloques 50-60", "Confinar un colegio"],
    riesgoMinimo: 60,
    modo: "humano",
    reversible: true,
    afectaDerechos: true,
    base: "Ley 17/2015 art. 7 bis (deber de colaboración) y art. 5; medida que restringe la libertad de movimientos.",
    patrones: [/\bconfina\w*\b/],
  },
  {
    id: "evacuacion",
    nombre: "Evacuación de población",
    descripcion: "Trasladar residentes de viviendas, residencias, colegios u hospitales a un lugar seguro.",
    ejemplos: ["Evacuar la residencia de mayores al polideportivo", "Desalojar una manzana"],
    riesgoMinimo: 75,
    modo: "humano",
    firmaMinima: "director_tecnico",
    reversible: false,
    afectaDerechos: true,
    base: "PEMAM · EV-01 evacuación de población vulnerable; RD 524/2023 dirección única.",
    patrones: [/\b(evacua\w*|desaloj\w*)\b/],
  },
  {
    id: "suministros",
    nombre: "Corte de suministros básicos",
    descripcion: "Interrumpir o restablecer electricidad, gas o agua en una zona; desconectar una subestación.",
    ejemplos: ["Desconectar la subestación de Arganzuela", "Cortar el gas en la manzana"],
    riesgoMinimo: 75,
    modo: "humano",
    firmaMinima: "director_tecnico",
    reversible: false,
    afectaDerechos: true,
    base: "Ley 8/2011 (infraestructuras críticas); coordinación con operadores (REE, Naturgy, Canal).",
    patrones: [/\b(cortar|corte|interrumpir|desconectar|restablecer) (de |del |el |la )?(suministro|gas|electricidad|luz|agua|subestacion|linea de alta)\b/],
  },
  {
    id: "alerta_masiva",
    nombre: "Alerta masiva (ES-Alert, sirenas)",
    descripcion: "Difusión por cell broadcast a todos los móviles de una zona, sirenas o megafonía masiva.",
    ejemplos: ["ES-Alert al distrito de Arganzuela con confinamiento"],
    riesgoMinimo: 85,
    modo: "humano",
    firmaMinima: "director_plan",
    reversible: false,
    afectaDerechos: false,
    base: "ES-Alert (Red de Alerta Nacional, RD 524/2023): la activa la autoridad de protección civil; permiso `autorizar_es_alert`.",
    patrones: [/\b(es-? ?alert|alerta masiva|cell ?broadcast|sirenas?|difusion masiva|aviso masivo|112 inverso)\b/],
  },
  {
    id: "situacion_operativa",
    nombre: "Situación operativa y medios estatales",
    descripcion: "Elevar la situación operativa (0→1→2), activar planes especiales o pedir medios del Estado (UME).",
    ejemplos: ["Declarar situación 2", "Solicitar la UME"],
    riesgoMinimo: 90,
    modo: "humano",
    firmaMinima: "director_plan",
    reversible: false,
    afectaDerechos: false,
    base: "RD 524/2023 · situaciones operativas 0-3; permiso `elevar_situacion`.",
    patrones: [/\b(situacion operativa|situacion [0-3]|ume|unidad militar de emergencias|medios estatales|interes nacional|activar (el )?plan (territorial|especial)|nivel [1-3])\b/],
  },
  {
    id: "medios_privados",
    nombre: "Requisa y restricción de derechos",
    descripcion: "Requisar bienes o medios privados, prestaciones personales obligatorias, restricciones generales de movimiento.",
    ejemplos: ["Requisar maquinaria de una obra", "Toque de queda en un barrio"],
    riesgoMinimo: 95,
    modo: "humano",
    firmaMinima: "director_plan",
    reversible: false,
    afectaDerechos: true,
    base: "Ley 17/2015 art. 7 bis y 7 ter; Ley 4/1981 de estados de alarma.",
    patrones: [/\b(requis\w*|movilizacion de (medios|bienes|recursos) privados|expropia\w*|prestacion personal|restriccion de (derechos|movimientos)|toque de queda)\b/],
  },
];

/** Foco de la decisión (motor) → categoría segura aunque el texto no case con ningún patrón. */
export const FOCO_A_CATEGORIA: Record<string, CategoriaId> = {
  despliegue_inicial: "despliegue",
  corte_m30: "trafico_parcial",
  hospital: "proteccion_infraestructura",
  evacuacion: "evacuacion",
  comunicado: "comunicacion_publica",
};

const IDS = new Set<string>(CATALOGO.map((c) => c.id));

export function esCategoriaId(x: unknown): x is CategoriaId {
  return typeof x === "string" && IDS.has(x);
}

// ---------------------------------------------------------------------------
// Política: catálogo por defecto + ajustes
// ---------------------------------------------------------------------------

const ROLES_QUE_FIRMAN: RolId[] = ROLES_LISTA.filter((r) => puede(r.id, "decidir")).map((r) => r.id);

export function esRolQueFirma(x: unknown): x is RolId {
  return typeof x === "string" && (ROLES_QUE_FIRMAN as string[]).includes(x);
}

function limpiarAjuste(a: AjusteCategoria | undefined): AjusteCategoria {
  if (!a) return {};
  const out: AjusteCategoria = {};
  if (a.modo && a.modo in MODO_ORDEN) out.modo = a.modo;
  if (typeof a.riesgoMinimo === "number" && Number.isFinite(a.riesgoMinimo)) out.riesgoMinimo = Math.round(Math.max(0, Math.min(100, a.riesgoMinimo)));
  if (a.firmaMinima === null) out.firmaMinima = null;
  else if (esRolQueFirma(a.firmaMinima)) out.firmaMinima = a.firmaMinima;
  return out;
}

/** Catálogo con los ajustes de la política aplicados, ordenado por riesgo mínimo ascendente. */
export function catalogoEfectivo(politica: PoliticaAutonomia = POLITICA_VACIA): CategoriaAccion[] {
  return CATALOGO.map((c) => {
    const a = limpiarAjuste(politica.ajustes[c.id]);
    const { firmaMinima, ...resto } = c;
    const firma = a.firmaMinima === null ? undefined : (a.firmaMinima ?? firmaMinima);
    return { ...resto, ...(firma ? { firmaMinima: firma } : {}), modo: a.modo ?? c.modo, riesgoMinimo: a.riesgoMinimo ?? c.riesgoMinimo };
  }).sort((x, y) => x.riesgoMinimo - y.riesgoMinimo || MODO_ORDEN[x.modo] - MODO_ORDEN[y.modo]);
}

/** ¿La categoría tiene algún ajuste respecto al catálogo por defecto? */
export function estaAjustada(politica: PoliticaAutonomia, id: CategoriaId): boolean {
  const a = limpiarAjuste(politica.ajustes[id]);
  return Object.keys(a).length > 0;
}

function describirAjuste(c: CategoriaAccion, a: AjusteCategoria): string {
  const partes: string[] = [];
  if (a.modo) partes.push(`modo → ${MODO_ETIQUETA[a.modo].corta.toLowerCase()}`);
  if (typeof a.riesgoMinimo === "number") partes.push(`riesgo mínimo → ${a.riesgoMinimo}`);
  if (a.firmaMinima === null) partes.push("firma mínima → según riesgo");
  else if (a.firmaMinima) partes.push(`firma mínima → ${ROLES[a.firmaMinima].nombre}`);
  return `${c.nombre}: ${partes.join(", ") || "sin cambios"}`;
}

/** Devuelve una política nueva con el ajuste aplicado (inmutable) y el cambio anotado en el historial. */
export function aplicarAjuste(politica: PoliticaAutonomia, id: CategoriaId, ajuste: AjusteCategoria, rol: RolId, ahora = new Date().toISOString()): PoliticaAutonomia {
  const base = CATALOGO.find((c) => c.id === id);
  if (!base) throw new Error(`Categoría desconocida: ${id}`);
  const limpio = limpiarAjuste(ajuste);
  const actual = limpiarAjuste(politica.ajustes[id]);
  const fusion: AjusteCategoria = { ...actual, ...limpio };
  // Un ajuste que coincide con el valor por defecto no es un ajuste.
  if (fusion.modo === base.modo) delete fusion.modo;
  if (fusion.riesgoMinimo === base.riesgoMinimo) delete fusion.riesgoMinimo;
  if ((fusion.firmaMinima ?? undefined) === base.firmaMinima || (fusion.firmaMinima === null && !base.firmaMinima)) delete fusion.firmaMinima;
  const ajustes = { ...politica.ajustes };
  if (Object.keys(fusion).length) ajustes[id] = fusion;
  else delete ajustes[id];
  const cambio: CambioPolitica = { timestamp: ahora, rol, categoria: id, texto: describirAjuste(base, limpio) };
  return { version: 1, ajustes, historial: [cambio, ...politica.historial].slice(0, 100), actualizadaEn: ahora };
}

/** Vuelve al catálogo por defecto (se conserva el historial). */
export function restablecerPolitica(politica: PoliticaAutonomia, rol: RolId, ahora = new Date().toISOString()): PoliticaAutonomia {
  const cambio: CambioPolitica = { timestamp: ahora, rol, categoria: "todas", texto: "Política restablecida al catálogo por defecto" };
  return { version: 1, ajustes: {}, historial: [cambio, ...politica.historial].slice(0, 100), actualizadaEn: ahora };
}

/** Acepta lo que venga de disco o de la red y devuelve una política válida. */
export function normalizarPolitica(x: unknown): PoliticaAutonomia {
  if (!x || typeof x !== "object") return { ...POLITICA_VACIA, ajustes: {}, historial: [] };
  const o = x as Partial<PoliticaAutonomia>;
  const ajustes: PoliticaAutonomia["ajustes"] = {};
  if (o.ajustes && typeof o.ajustes === "object") {
    for (const [k, v] of Object.entries(o.ajustes)) {
      if (!esCategoriaId(k)) continue;
      const a = limpiarAjuste(v as AjusteCategoria);
      if (Object.keys(a).length) ajustes[k] = a;
    }
  }
  const historial = Array.isArray(o.historial)
    ? o.historial.filter((h): h is CambioPolitica => !!h && typeof h === "object" && typeof (h as CambioPolitica).texto === "string").slice(0, 100)
    : [];
  return { version: 1, ajustes, historial, actualizadaEn: typeof o.actualizadaEn === "string" ? o.actualizadaEn : undefined };
}

// ---------------------------------------------------------------------------
// Clasificación y veredicto
// ---------------------------------------------------------------------------

export function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Texto operativo de la decisión: lo que se va a EJECUTAR (foco, título, acciones,
 * mensaje de alerta). El resumen no entra: es narrativa y suele citar lo que se
 * descarta ("un corte total colapsaría…; se propone corte parcial").
 */
function textoDe(d: DecisionClasificable): string {
  const t = d.tarjeta;
  return normalizarTexto([d.foco, t.titulo, t.plan.mensajeAlerta, ...t.plan.acciones.map((a) => `${a.recurso}: ${a.accion}`)].join("\n"));
}

function ordenarRestrictivas(ids: Iterable<CategoriaId>, catalogo: CategoriaAccion[]): CategoriaId[] {
  const por = new Map(catalogo.map((c) => [c.id, c]));
  return [...new Set(ids)]
    .map((id) => por.get(id))
    .filter((c): c is CategoriaAccion => !!c)
    .sort((a, b) => MODO_ORDEN[b.modo] - MODO_ORDEN[a.modo] || b.riesgoMinimo - a.riesgoMinimo)
    .map((c) => c.id);
}

/**
 * Categorías del catálogo que toca una decisión, de más a menos restrictiva.
 * Si el proponente etiquetó `categorias`, se usan; si no, foco + heurística de texto.
 * Ni el resumen ni las alternativas descartadas se miran: mencionar "evacuar" para rechazarlo no es evacuar.
 */
export function clasificarDecision(d: DecisionClasificable, catalogo: CategoriaAccion[] = CATALOGO): CategoriaId[] {
  const etiquetadas = (d.categorias ?? []).filter(esCategoriaId);
  if (etiquetadas.length) return ordenarRestrictivas(etiquetadas, catalogo);
  const texto = textoDe(d);
  const ids = new Set<CategoriaId>();
  const porFoco = FOCO_A_CATEGORIA[d.foco];
  if (porFoco) ids.add(porFoco);
  for (const c of catalogo) if (c.patrones.some((p) => p.test(texto))) ids.add(c.id);
  if (ids.has("trafico_total")) ids.delete("trafico_parcial");
  return ordenarRestrictivas(ids, catalogo);
}

const rango = (r: RolId) => ROLES[r].riesgoMaxDecision;

/** De dos roles que firman, el de más autoridad (por límite de riesgo). */
function masAlto(a: RolId, b: RolId | undefined): RolId {
  if (!b) return a;
  return rango(b) > rango(a) ? b : a;
}

/** Rol mínimo que puede firmar una decisión con este riesgo y (opcionalmente) una firma mínima de categoría. */
export function firmaRequerida(riesgo: number, firmaCategoria?: RolId): RolId {
  return masAlto(escalarA(riesgo), firmaCategoria);
}

/** ¿Puede este rol firmar la decisión según el veredicto? (límite por riesgo + firma mínima de la categoría). */
export function puedeFirmar(rol: RolId, v: Pick<VeredictoCompetencia, "riesgoEfectivo" | "firmaMinima"> | undefined | null, riesgoSiNoHayVeredicto?: number): boolean {
  if (!v) return typeof riesgoSiNoHayVeredicto === "number" ? puedeDecidir(rol, riesgoSiNoHayVeredicto) : puede(rol, "decidir");
  if (!puedeDecidir(rol, v.riesgoEfectivo)) return false;
  return v.firmaMinima === null || rango(rol) >= rango(v.firmaMinima);
}

/**
 * Veredicto de la política para una decisión: quién la gestiona y por qué.
 * Determinista y puro: el motor y la UI obtienen exactamente el mismo resultado.
 */
export function evaluarCompetencia(d: DecisionClasificable, politica: PoliticaAutonomia = POLITICA_VACIA, umbral: number, ahora = new Date().toISOString()): VeredictoCompetencia {
  const catalogo = catalogoEfectivo(politica);
  const por = new Map(catalogo.map((c) => [c.id, c]));
  const categorias = clasificarDecision(d, catalogo);
  const cats = categorias.map((id) => por.get(id)!);
  const dominante = cats[0] ?? null;
  const riesgoPropuesto = Math.round(Math.max(0, Math.min(100, d.riesgo)));
  const riesgoEfectivo = Math.max(riesgoPropuesto, dominante?.riesgoMinimo ?? 0);
  const u = Math.max(0, Math.min(100, Math.round(umbral)));
  const suelo = riesgoEfectivo > riesgoPropuesto ? ` (la IA estimó ${riesgoPropuesto}; el suelo de la categoría es ${riesgoEfectivo})` : "";

  let modo: ModoCompetencia;
  let motivo: string;
  if (!dominante) {
    modo = "supervisada";
    motivo = `Actuación fuera del catálogo: por política, la IA no ejecuta sola lo que no está catalogado. Riesgo ${riesgoEfectivo}.`;
  } else if (dominante.modo === "humano") {
    modo = "humano";
    motivo = `"${dominante.nombre}" está reservada a personas: la IA prepara el expediente pero no ejecuta. Riesgo ${riesgoEfectivo}${suelo}.`;
  } else if (dominante.modo === "supervisada") {
    modo = "supervisada";
    motivo = `"${dominante.nombre}" exige firma humana por política, sea cual sea el riesgo. Riesgo ${riesgoEfectivo}${suelo}.`;
  } else if (riesgoEfectivo <= u) {
    modo = "autonoma";
    motivo = `"${dominante.nombre}" es autónoma y el riesgo ${riesgoEfectivo} no supera el umbral ${u}${suelo}.`;
  } else {
    modo = "supervisada";
    motivo = `"${dominante.nombre}" es autónoma, pero el riesgo ${riesgoEfectivo} supera el umbral ${u}: firma humana${suelo}.`;
  }

  // La firma mínima más alta de todas las categorías que toca la decisión (no solo la dominante).
  const firmaCategoria = cats.reduce<RolId | undefined>((acc, c) => (c.firmaMinima ? masAlto(c.firmaMinima, acc) : acc), undefined);
  const firmaMinima = modo === "autonoma" ? null : firmaRequerida(riesgoEfectivo, firmaCategoria);
  if (firmaMinima && firmaCategoria && firmaMinima === firmaCategoria && rango(firmaCategoria) > rango(escalarA(riesgoEfectivo))) {
    motivo += ` Firma mínima por categoría: ${ROLES[firmaMinima].nombre}.`;
  }

  return { modo, categorias, categoriaDominante: dominante?.id ?? null, riesgoPropuesto, riesgoEfectivo, umbral: u, firmaMinima, motivo, evaluadaEn: ahora };
}

/** Resumen de la política para cabeceras: cuántas categorías hay en cada modo con el umbral dado. */
export function resumenPolitica(politica: PoliticaAutonomia, umbral: number): Record<ModoCompetencia, number> & { bajoUmbral: number } {
  const cat = catalogoEfectivo(politica);
  const r = { autonoma: 0, supervisada: 0, humano: 0, bajoUmbral: 0 };
  for (const c of cat) {
    r[c.modo] += 1;
    if (c.modo === "autonoma" && c.riesgoMinimo <= umbral) r.bajoUmbral += 1;
  }
  return r;
}
