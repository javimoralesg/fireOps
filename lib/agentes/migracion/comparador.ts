import type { Accion, Decision, Evidencia, Fundamento } from "../../dominio/tipos";
import { AGENTE_CANONICO_POR_LEGACY } from "../identidad";

type Json = null | boolean | number | string | Json[] | { [clave: string]: Json };

/** Atribución equivalente entre los productores antiguos y los cinco lógicos. */
export const AGENTE_LOGICO_POR_LEGACY: Readonly<Record<string, string>> = AGENTE_CANONICO_POR_LEGACY;

const CAMPOS_PROSA = new Set([
  "descripcion", "resumen", "razonamiento", "motivo", "comentario", "comentarioHumano",
  "texto", "textoSms", "mensaje", "cuerpo", "contenido", "guion", "asunto", "titulo", "cita",
]);
const CAMPOS_VOLATILES = new Set([
  "id", "ejecucionId", "trazaId", "informeId", "informeIds", "comunicadoId", "referencia",
  "creadaEn", "creadaEnMundo", "decididaEn", "ejecutadaEn", "ordenadaEn", "en", "enMundo",
  "calculadoEn", "actualizadoEn", "generadoEn", "historial", "decisionesPrevias", "sustituyeA",
]);

export interface OpcionesNormalizacion {
  /** Permite atribuir ids legacy a su agente lógico; se combina con el mapa por defecto. */
  aliasAgentes?: Readonly<Record<string, string>>;
  /** Redondeo para evitar ruido de coma flotante (6 por defecto). */
  decimales?: number;
}

export interface AccionSemantica {
  tipo: Accion["tipo"];
  objetivo?: Json;
  parametros: Json;
  estado: Accion["estado"];
  resultado?: { exito: boolean; proveedor: string };
}

export interface DecisionSemantica {
  agenteLogicoId: string;
  incendioId?: string;
  clusterId?: string;
  prioridad: Decision["prioridad"];
  riesgo: number;
  competencia: Decision["competencia"];
  estado: Decision["estado"];
  acciones: AccionSemantica[];
  evidencias: Json[];
  fundamentos: Json[];
  tieneAlertasLegales: boolean;
}

export interface DiferenciaSemantica {
  clave: string;
  campos: string[];
  antes: DecisionSemantica;
  despues: DecisionSemantica;
}

export interface ComparacionSemantica {
  equivalentes: boolean;
  faltan: DecisionSemantica[];
  sobran: DecisionSemantica[];
  cambios: DiferenciaSemantica[];
}

function jsonEstable(valor: unknown, decimales: number): Json | undefined {
  if (valor === undefined || typeof valor === "function" || typeof valor === "symbol") return undefined;
  if (valor === null || typeof valor === "boolean" || typeof valor === "string") return valor;
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return String(valor);
    return Number(valor.toFixed(decimales));
  }
  if (Array.isArray(valor)) {
    return valor
      .map((elemento) => jsonEstable(elemento, decimales))
      .filter((elemento): elemento is Json => elemento !== undefined)
      .sort((a, b) => serializar(a).localeCompare(serializar(b)));
  }
  const salida: Record<string, Json> = {};
  for (const clave of Object.keys(valor as Record<string, unknown>).sort()) {
    if (CAMPOS_PROSA.has(clave) || CAMPOS_VOLATILES.has(clave)) continue;
    const hijo = jsonEstable((valor as Record<string, unknown>)[clave], decimales);
    if (hijo !== undefined) salida[clave] = hijo;
  }
  return salida;
}

function serializar(valor: Json | DecisionSemantica | AccionSemantica): string {
  return JSON.stringify(valor);
}

function normalizarEvidencia(e: Evidencia, decimales: number): Json {
  return jsonEstable({ fuente: e.fuente, confianza: e.confianza }, decimales) ?? {};
}

function normalizarFundamento(f: Fundamento, decimales: number): Json {
  return jsonEstable({ documento: f.documento, seccion: f.seccion, similitud: f.similitud }, decimales) ?? {};
}

export function normalizarAccion(accion: Accion, opciones: OpcionesNormalizacion = {}): AccionSemantica {
  const decimales = opciones.decimales ?? 6;
  const objetivo = jsonEstable(accion.objetivo, decimales);
  return {
    tipo: accion.tipo,
    ...(objetivo === undefined || serializar(objetivo) === "{}" ? {} : { objetivo }),
    parametros: jsonEstable(accion.parametros, decimales) ?? {},
    estado: accion.estado,
    ...(accion.resultado ? { resultado: { exito: accion.resultado.exito, proveedor: accion.resultado.proveedor } } : {}),
  };
}

export function normalizarDecision(decision: Decision, opciones: OpcionesNormalizacion = {}): DecisionSemantica {
  const decimales = opciones.decimales ?? 6;
  const aliases = { ...AGENTE_LOGICO_POR_LEGACY, ...opciones.aliasAgentes };
  const acciones = decision.acciones.map((a) => normalizarAccion(a, opciones));
  acciones.sort((a, b) => serializar(a).localeCompare(serializar(b)));
  const evidencias = decision.evidencias.map((e) => normalizarEvidencia(e, decimales));
  evidencias.sort((a, b) => serializar(a).localeCompare(serializar(b)));
  const fundamentos = decision.fundamentos.map((f) => normalizarFundamento(f, decimales));
  fundamentos.sort((a, b) => serializar(a).localeCompare(serializar(b)));
  return {
    agenteLogicoId: aliases[decision.agenteId] ?? decision.agenteId,
    ...(decision.incendioId ? { incendioId: decision.incendioId } : {}),
    ...(decision.clusterId ? { clusterId: decision.clusterId } : {}),
    prioridad: decision.prioridad,
    riesgo: Number(decision.riesgo.toFixed(decimales)),
    competencia: decision.competencia,
    estado: decision.estado,
    acciones,
    evidencias,
    fundamentos,
    tieneAlertasLegales: Boolean(decision.alertasLegales?.length),
  };
}

/** Clave de emparejamiento: productor lógico, foco y tipos/objetivos de acción. */
function claveDecision(decision: DecisionSemantica): string {
  return serializar({
    agenteLogicoId: decision.agenteLogicoId,
    incendioId: decision.incendioId ?? null,
    clusterId: decision.clusterId ?? null,
    acciones: decision.acciones.map(({ tipo, objetivo }) => ({ tipo, objetivo })),
  } as unknown as Json);
}

function diferencias(a: unknown, b: unknown, ruta = ""): string[] {
  if (Object.is(a, b)) return [];
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return [ruta || "$"];
  if (Array.isArray(a) !== Array.isArray(b)) return [ruta || "$"];
  const aa = a as Record<string, unknown>;
  const bb = b as Record<string, unknown>;
  const claves = [...new Set([...Object.keys(aa), ...Object.keys(bb)])].sort();
  return claves.flatMap((clave) => diferencias(aa[clave], bb[clave], ruta ? `${ruta}.${clave}` : clave));
}

/** Compara colecciones como multiconjuntos; el orden de emisión no importa. */
export function compararDecisiones(
  antes: readonly Decision[],
  despues: readonly Decision[],
  opciones: OpcionesNormalizacion = {},
): ComparacionSemantica {
  const a = antes.map((d) => normalizarDecision(d, opciones));
  const b = despues.map((d) => normalizarDecision(d, opciones));
  const gruposA = new Map<string, DecisionSemantica[]>();
  const gruposB = new Map<string, DecisionSemantica[]>();
  for (const decision of a) gruposA.set(claveDecision(decision), [...(gruposA.get(claveDecision(decision)) ?? []), decision]);
  for (const decision of b) gruposB.set(claveDecision(decision), [...(gruposB.get(claveDecision(decision)) ?? []), decision]);

  const faltan: DecisionSemantica[] = [];
  const sobran: DecisionSemantica[] = [];
  const cambios: DiferenciaSemantica[] = [];
  for (const clave of new Set([...gruposA.keys(), ...gruposB.keys()])) {
    const ga = (gruposA.get(clave) ?? []).sort((x, y) => serializar(x).localeCompare(serializar(y)));
    const gb = (gruposB.get(clave) ?? []).sort((x, y) => serializar(x).localeCompare(serializar(y)));
    const comunes = Math.min(ga.length, gb.length);
    for (let i = 0; i < comunes; i += 1) {
      const campos = diferencias(ga[i], gb[i]);
      if (campos.length) cambios.push({ clave, campos, antes: ga[i], despues: gb[i] });
    }
    faltan.push(...ga.slice(comunes));
    sobran.push(...gb.slice(comunes));
  }
  return { equivalentes: !faltan.length && !sobran.length && !cambios.length, faltan, sobran, cambios };
}
