// =====================================================================
// ATALAYA INCENDIOS · Llamada ENTRANTE al 112 virtual (número de HappyRobot)
// ---------------------------------------------------------------------
// Propósito: el ciudadano llama al número de la organización en HappyRobot
// (+1 573 401 8744) y le atiende un "Inbound Voice Agent" en español: el
// workflow «Atalaya · 112 entrante», que monta por API
// `scripts/happyrobot-workflows.mjs entrante`. Durante la conversación el
// agente llama a dos herramientas de Atalaya:
//   · consultar_zona   → POST /api/happyrobot/contexto   ¿hay ya fuego cerca?
//   · registrar_aviso  → POST /api/happyrobot/aviso      datos dictados → observación → foco
// y al colgar, un nodo Webhook manda la transcripción a
// /api/webhooks/happyrobot/llamada, que la ADJUNTA a la observación de ese
// run (misma llamada = una sola observación, nunca dos).
//
// Aquí vive la lógica; las rutas solo verifican el secreto, validan y llaman.
// Flujo de `registrarAvisoDeLlamada`:
//   1. idempotencia por `run_id`: las peticiones del mismo run van EN SERIE (la
//      plataforma reintenta la herramienta si tardamos, y dos a la vez creaban dos
//      observaciones); un reintento con los mismos datos y sin punto nuevo no
//      cambia nada (`registro: "repetido"`, sin segundo SMS) y una segunda llamada
//      con datos nuevos AMPLÍA la observación, no crea otra (`registro: "ampliacion"`);
//   2. sitúa el aviso con Nominatim a partir de municipio/lugar dictados;
//   3. lo entrega a la centralita (`procesarEntrada`, canal "llamada"), que lo
//      guarda al instante y lo extrae con el modelo rápido;
//   4. espera como mucho ESPERA_EXTRACCION_MS (la herramienta no puede
//      colgar la llamada): si la IA no ha terminado, contesta "en análisis" y
//      remata en segundo plano;
//   5. si no hay proveedor de IA o falló, la extracción sale de los datos que
//      la persona dictó al agente (determinista y marcada como tal en el
//      resumen: no es una invención del modelo, es lo que se dijo);
//   6. verifica la observación EN EL ACTO (`verificarObservacionAhora`): el
//      verificador decide si declara el foco, lo confirma o lo deja registrado;
//   7. devuelve al agente qué decirle a la persona (`mensajeParaLocutor`).
// DUEÑO: sesión fireops-82 (2026-09-19), sobre el contrato del constructor D
// (scripts/happyrobot-entrante.mjs). Dependencias: centralita, verificador, nominatim,
// estado. NADA SIMULADO: si falta configuración se dice qué variable falta.
// =====================================================================

import type { ExtraccionObservacion, Incendio, Observacion, Punto } from "../dominio/tipos";
import { enEspana } from "../dominio/espana";
import { obtenerEstado, type Estado } from "../motor/estado";
import { apiBase } from "./cliente";
import { formatearTelefono, pareceTelefono } from "./telefono";
import { transcripcionLegible } from "./transcripcion";

export { formatearTelefono };

export const VARIABLE_SLUG_ENTRANTE = "HAPPYROBOT_WORKFLOW_SLUG_ENTRANTE";
export const VARIABLE_NUMERO_ENTRANTE = "HAPPYROBOT_NUMERO_ENTRANTE";
export const NOMBRE_WORKFLOW_ENTRANTE = "Atalaya · 112 entrante";
/**
 * Tope de espera a la extracción de IA de la centralita antes de contestar al agente
 * de voz. 0 = NO esperar (por defecto): medido el 19-09, qwen3.6 tardó 14 s y una
 * herramienta que tarda eso deja al agente mudo; la extracción determinista de lo
 * dictado basta para declarar el foco y el modelo refina después en segundo plano.
 */
export const ESPERA_EXTRACCION_MS = 0;
/** Tope (ms) para situar el aviso con Nominatim antes de contestar: si no llega, se sitúa en segundo plano. */
export const ESPERA_GEOCODIFICACION_MS = 3000;
/** Marca en el texto de la observación bajo la que se adjunta la transcripción al colgar. */
export const MARCA_TRANSCRIPCION = "Transcripción completa de la llamada:";
/** Marca en el resumen de la extracción cuando no la hizo el modelo sino los datos dictados. */
export const MARCA_DETERMINISTA = "Extracción determinista de los datos dictados al agente (sin modelo de IA)";

const variable = (clave: string): string | undefined => process.env[clave]?.trim() || undefined;

/** Número E.164 del 112 virtual (el comprado en HappyRobot). */
export const numeroEntrante = (): string | undefined => variable(VARIABLE_NUMERO_ENTRANTE);
/** Slug del workflow «Atalaya · 112 entrante» en la plataforma. */
export const slugEntrante = (): string | undefined => variable(VARIABLE_SLUG_ENTRANTE);

export interface EstadoEntrante {
  ok: boolean;
  /** Texto listo para la barra de servicios ("HappyRobot: falta el 112 entrante · Falta …"). */
  detalle: string;
  numero?: string;
  numeroLegible?: string;
  slug?: string;
}

/** Qué le falta al canal entrante, con el nombre EXACTO de la variable. */
export function estadoEntrante(): EstadoEntrante {
  const numero = numeroEntrante();
  const slug = slugEntrante();
  const base = { numero, numeroLegible: numero ? formatearTelefono(numero) : undefined, slug };
  if (!variable("HAPPYROBOT_API_KEY")) return { ok: false, detalle: "HappyRobot: falta el 112 entrante · Falta HAPPYROBOT_API_KEY", ...base };
  if (!slug) return { ok: false, detalle: `HappyRobot: falta el 112 entrante · Falta ${VARIABLE_SLUG_ENTRANTE} (ejecuta scripts/happyrobot-workflows.mjs entrante)`, ...base };
  if (!numero) return { ok: false, detalle: `HappyRobot: falta el número del 112 entrante · Falta ${VARIABLE_NUMERO_ENTRANTE}`, ...base };
  if (!variable("HAPPYROBOT_WEBHOOK_SECRET")) return { ok: false, detalle: "HappyRobot: falta el 112 entrante · Falta HAPPYROBOT_WEBHOOK_SECRET", ...base };
  return { ok: true, detalle: `112 virtual en el ${formatearTelefono(numero)} (workflow ${slug})`, ...base };
}

// ---------------------------------------------------------------------
// ¿A qué URL apunta el workflow publicado? (para avisar si el túnel cambió)
// ---------------------------------------------------------------------

/** Nombre del nodo Webhook de registrar_aviso en la plataforma (scripts/happyrobot-entrante.mjs). */
const NODO_REGISTRAR = "Registrar el aviso en Atalaya";

/** Base (sin ruta) de una URL de herramienta: "https://x.trycloudflare.com/api/happyrobot/aviso" → "https://x.trycloudflare.com". */
export function baseDeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** true si la URL publicada en HappyRobot no es la URL pública actual de Atalaya. */
export function desincronizado(urlPublicaActual: string | undefined, urlEnPlataforma: string | undefined): boolean {
  const a = baseDeUrl(urlPublicaActual ? `${urlPublicaActual}/` : undefined);
  const b = baseDeUrl(urlEnPlataforma);
  return Boolean(a && b && a !== b);
}

/**
 * ¿Responde de verdad la URL pública? Se pide /api/salud a la propia URL (mismo
 * criterio que GET /api/movil/enlace). Un túnel zombi deja un dominio que no resuelve
 * (ENOTFOUND): el agente de voz contesta, pero ninguna herramienta llega a Atalaya.
 */
export async function urlPublicaResponde(base: string | undefined, tiempoMaxMs = 6000): Promise<{ viva: boolean; motivo?: string }> {
  if (!base) return { viva: false, motivo: "no hay URL pública (arranca scripts/tunel.sh o pon PUBLIC_BASE_URL)" };
  if (!/^https:\/\//.test(base)) return { viva: false, motivo: "la URL pública no es HTTPS" };
  try {
    const r = await fetch(`${base}/api/salud`, { cache: "no-store", signal: AbortSignal.timeout(tiempoMaxMs) });
    return r.ok ? { viva: true } : { viva: false, motivo: `la URL pública responde ${r.status}` };
  } catch (e) {
    const codigo = (e as { cause?: { code?: string } }).cause?.code;
    if (codigo === "ENOTFOUND") return { viva: false, motivo: "el túnel guardado ya no existe (su dominio no resuelve): cierra ese cloudflared y abre scripts/tunel.sh" };
    if (e instanceof Error && e.name === "TimeoutError") return { viva: false, motivo: "la URL pública no contesta (tiempo agotado)" };
    return { viva: false, motivo: `la URL pública no contesta: ${e instanceof Error ? e.message : String(e)}` };
  }
}

interface NodoPlataforma {
  name?: string;
  configuration?: { url?: { children?: { text?: string }[] }[] };
}

/**
 * Lee de la plataforma la URL a la que dispara el webhook de registrar_aviso del
 * workflow entrante publicado. Una sola pasada (lista de workflows + nodos de la
 * última versión); si algo falla, lanza con el motivo real.
 */
export async function urlRegistrarEnPlataforma(signal?: AbortSignal): Promise<string | undefined> {
  return (await leerWorkflowEntrante(signal)).urlRegistrar;
}

export interface WorkflowEntranteEnPlataforma {
  /** URL a la que dispara la herramienta registrar_aviso en la versión actual. */
  urlRegistrar?: string;
  /** La versión actual está publicada y viva: si no, el número NO atiende llamadas. */
  publicado: boolean;
  vivo: boolean;
  entorno?: string;
}

/**
 * Estado real del workflow «Atalaya · 112 entrante» en HappyRobot: a qué URL dispara y
 * si está publicado y vivo. Medido el 19-09: una sincronización que falla al publicar deja
 * la versión despublicada y el número deja de atender sin que nada lo avise.
 */
export async function leerWorkflowEntrante(signal?: AbortSignal): Promise<WorkflowEntranteEnPlataforma> {
  const clave = variable("HAPPYROBOT_API_KEY");
  const slug = slugEntrante();
  if (!clave) throw new Error("Falta HAPPYROBOT_API_KEY");
  if (!slug) throw new Error(`Falta ${VARIABLE_SLUG_ENTRANTE}`);
  const cabeceras = { authorization: `Bearer ${clave}`, accept: "application/json" };
  const senal = signal ?? AbortSignal.timeout(15_000);
  const rw = await fetch(`${apiBase()}/api/v2/workflows/${encodeURIComponent(slug)}`, { headers: cabeceras, cache: "no-store", signal: senal });
  if (!rw.ok) throw new Error(`HappyRobot ${rw.status} al leer el workflow ${slug}`);
  type Version = { id?: string; is_published?: boolean; is_live?: boolean; environment?: string };
  const w = (await rw.json()) as { data?: { latest_version?: Version }; latest_version?: Version };
  const version = w.data?.latest_version ?? w.latest_version;
  const versionId = version?.id;
  if (!versionId) throw new Error(`El workflow ${slug} no tiene versión`);
  const rn = await fetch(`${apiBase()}/api/v2/versions/${versionId}/nodes`, { headers: cabeceras, cache: "no-store", signal: senal });
  if (!rn.ok) throw new Error(`HappyRobot ${rn.status} al leer los nodos de ${slug}`);
  const bruto = (await rn.json()) as { data?: NodoPlataforma[] } | NodoPlataforma[];
  const nodos = Array.isArray(bruto) ? bruto : (bruto.data ?? []);
  const nodo = nodos.find((n) => n.name === NODO_REGISTRAR);
  const texto = nodo?.configuration?.url?.map((p) => (p.children ?? []).map((c) => c.text ?? "").join("")).join("").trim();
  return { urlRegistrar: texto || undefined, publicado: Boolean(version?.is_published), vivo: Boolean(version?.is_live), entorno: version?.environment };
}

// ---------------------------------------------------------------------
// Lo que dicta la persona (parámetros de la herramienta registrar_aviso)
// ---------------------------------------------------------------------

export type TipoAviso = "humo" | "llamas" | "ambos" | "olor" | "otro";

export interface AvisoLlamada {
  /** Run de HappyRobot: identifica la llamada (idempotencia y enganche de la transcripción). */
  runId?: string;
  /** Teléfono que dicta la persona o, si no, el del llamante. */
  telefono?: string;
  municipio?: string;
  lugar?: string;
  /** Qué ve, con sus palabras. */
  queVe: string;
  tipo?: TipoAviso;
  personasEnRiesgo?: boolean;
  viviendasCerca?: boolean;
  tamano?: string;
  punto?: Punto;
}

const TIPO_TEXTO: Record<TipoAviso, string> = {
  humo: "humo",
  llamas: "llamas",
  ambos: "humo y llamas",
  olor: "olor a quemado",
  otro: "otro",
};

/** "humo negro" → humo · "se ve fuego" → llamas · "humo y llamas" → ambos. */
export function normalizarTipo(v: unknown): TipoAviso | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const t = v.toLowerCase();
  const humo = /humo/.test(t);
  const llamas = /llama|fuego|incendio|arde|ardiendo|quem[aá]ndose/.test(t);
  if (humo && llamas) return "ambos";
  if (llamas) return "llamas";
  if (humo) return "humo";
  if (/olor|huele/.test(t)) return "olor";
  return "otro";
}

/** "sí"/"no"/true/false/"hay gente"/"nadie" → booleano; vacío → undefined. */
export function esAfirmativo(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const t = String(v).trim().toLowerCase();
  // Sin \b: en JavaScript solo reconoce letras ASCII y fallaría justo después de la "í" de "sí".
  const fin = "(?![a-z\u00e0-\u00ff])";
  if (new RegExp(`^(s[ií]${fin}|true|yes|1$|hay${fin}|claro|afirmativo|correcto)`).test(t)) return true;
  if (new RegExp(`^(no${fin}|false|0$|ning[uú]n|nadie|negativo|nada${fin})`).test(t)) return false;
  return undefined;
}

/** Primer valor con contenido; descarta variables sin resolver de HappyRobot ("{{$var:…}}"). */
function primero(c: Record<string, unknown>, claves: string[]): string | undefined {
  for (const k of claves) {
    const v = c[k];
    if (typeof v === "string" && v.trim() && !/^\{\{\$var:/.test(v.trim()) && v.trim().toLowerCase() !== "null" && v.trim().toLowerCase() !== "undefined") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function numeroDe(c: Record<string, unknown>, claves: string[]): number | undefined {
  const t = primero(c, claves);
  if (t === undefined) return undefined;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Lee el cuerpo que manda el nodo Webhook de la herramienta (nombres en
 * snake_case tal y como los declara el workflow) de forma tolerante: acepta
 * también los nombres en camelCase y algunos sinónimos.
 */
export function avisoDesdeCuerpo(c: Record<string, unknown>): { aviso: AvisoLlamada; error?: undefined } | { aviso?: undefined; error: string } {
  const queVe = primero(c, ["que_ve", "queVe", "descripcion", "texto", "mensaje", "observacion"]);
  const municipio = primero(c, ["municipio", "pueblo", "localidad"]);
  const lugar = primero(c, ["lugar", "referencia", "ubicacion", "direccion", "paraje"]);
  if (!queVe && !lugar && !municipio) return { error: "El aviso no trae ni qué ve ni dónde (que_ve, lugar, municipio)" };

  const dicho = primero(c, ["telefono", "telefono_contacto", "phone"]);
  const llamante = primero(c, ["telefono_llamante", "from", "caller", "caller_number"]);
  const telefono = [dicho, llamante].find((t) => pareceTelefono(t));
  const lat = numeroDe(c, ["lat", "latitud", "latitude"]);
  const lon = numeroDe(c, ["lon", "lng", "longitud", "longitude"]);
  const donde = [lugar, municipio].filter(Boolean).join(", ");

  return {
    aviso: {
      runId: primero(c, ["run_id", "runId", "referencia_externa", "referenciaExterna"]),
      telefono,
      municipio,
      lugar,
      queVe: queVe ?? `Aviso de posible incendio en ${donde}`,
      tipo: normalizarTipo(c.tipo) ?? normalizarTipo(queVe),
      personasEnRiesgo: esAfirmativo(c.personas_en_riesgo ?? c.personasEnRiesgo ?? c.personas),
      viviendasCerca: esAfirmativo(c.viviendas_cerca ?? c.viviendasCerca ?? c.viviendas),
      tamano: primero(c, ["tamano", "tamaño", "tamanoEstimado"]),
      punto: lat !== undefined && lon !== undefined ? { lat, lon } : undefined,
    },
  };
}

/** Texto de la observación que entra en la centralita (lo que dictó la persona, ordenado). */
export function textoDeAviso(a: AvisoLlamada): string {
  const lineas = [`Llamada al 112 virtual (${a.telefono ? `teléfono ${a.telefono}` : "teléfono no facilitado"}).`, `Qué ve: ${a.queVe}`];
  if (a.tipo) lineas.push(`Tipo: ${TIPO_TEXTO[a.tipo]}`);
  const donde = [a.lugar, a.municipio].filter(Boolean).join(", ");
  if (donde) lineas.push(`Dónde: ${donde}`);
  if (a.tamano) lineas.push(`Tamaño según la persona: ${a.tamano}`);
  if (a.personasEnRiesgo !== undefined) lineas.push(`Personas en riesgo: ${a.personasEnRiesgo ? "sí" : "no"}`);
  if (a.viviendasCerca !== undefined) lineas.push(`Viviendas cerca: ${a.viviendasCerca ? "sí" : "no"}`);
  return lineas.join("\n");
}

/**
 * Extracción SIN modelo: solo cuando la IA no está o no llegó a tiempo. Sale
 * de los campos que la persona dictó al agente y lo dice en el resumen.
 * Gravedad con el mismo criterio que la centralita: personas en peligro →
 * crítica; viviendas cerca → grave; llamas → moderada; solo humo → leve.
 */
export function extraccionDeterminista(a: AvisoLlamada): ExtraccionObservacion {
  const tipo = a.tipo ?? normalizarTipo(a.queVe) ?? "otro";
  const esIncendio = tipo !== "otro" || /humo|fuego|llama|incendio|quema|arde/i.test(a.queVe);
  const gravedad: ExtraccionObservacion["gravedad"] = a.personasEnRiesgo ? "critica" : a.viviendasCerca ? "grave" : tipo === "llamas" || tipo === "ambos" ? "moderada" : "leve";
  const fiabilidad = !esIncendio ? 0.2 : a.municipio && a.lugar ? 0.7 : a.municipio || a.lugar ? 0.6 : 0.4;
  const donde = [a.lugar, a.municipio].filter(Boolean).join(", ");
  return {
    esIncendio,
    tipo: tipo === "ambos" ? "incendio_activo" : tipo,
    gravedad,
    lugarTexto: a.lugar,
    municipio: a.municipio,
    personasEnRiesgo: a.personasEnRiesgo ?? false,
    viviendasCerca: a.viviendasCerca ?? false,
    tamanoEstimado: a.tamano,
    resumen: `Llamada al 112 virtual: ${a.queVe}${donde ? ` en ${donde}` : ""}. ${MARCA_DETERMINISTA}.`,
    fiabilidad,
  };
}

// ---------------------------------------------------------------------
// Qué le dice el agente a la persona
// ---------------------------------------------------------------------

export interface VeredictoLocutor {
  impacto?: Observacion["impacto"];
  foco?: Pick<Incendio, "nombre" | "municipio"> | null;
  geolocalizada: boolean;
  enAnalisis?: boolean;
  personasEnRiesgo?: boolean;
  /** Fuego en un edificio, un vehículo o una zona urbana: el consejo es otro que en el monte. */
  urbano?: boolean;
}

const URBANO = /\b(edificio|escuela|facultad|colegio|instituto|universidad|casa|piso|vivienda|bloque|portal|nave|garaje|local|tienda|hospital|coche|furgoneta|cami[oó]n|autob[uú]s|fábrica|fabrica|almac[eé]n)\b/i;
/** Una calle con número es casco urbano ("calle Real 1": la llamada de las 19:13 recibió el consejo del monte). */
const CALLE_CON_NUMERO = /\b(calle|avenida|avda|plaza|paseo|glorieta|ronda|traves[ií]a|bulevar)\b[^,]*\b\d{1,4}\b/i;

/** ¿El aviso habla de un edificio o de un vehículo? (decide el consejo de seguridad). */
export function esAvisoUrbano(a: Pick<AvisoLlamada, "queVe" | "lugar">): boolean {
  return URBANO.test(`${a.queVe ?? ""} ${a.lugar ?? ""}`) || CALLE_CON_NUMERO.test(a.lugar ?? "");
}

/** Frases cortas, en español, que el agente de voz lee tal cual. Solo hechos del estado. */
export function mensajeParaLocutor(v: VeredictoLocutor): string {
  const partes: string[] = [];
  if (v.personasEnRiesgo) partes.push("Los medios ya salen.");
  const lugar = v.foco?.municipio ? ` en ${v.foco.municipio}` : "";
  switch (v.impacto) {
    case "nuevo_foco":
      partes.push(`Aviso registrado. La sala ha abierto un foco nuevo${lugar} y está enviando medios.`);
      break;
    case "confirma":
    case "agrava":
      partes.push(`Aviso registrado: ese incendio ya lo tenemos localizado${v.foco?.nombre ? ` (${v.foco.nombre})` : ""} y hay medios en camino; su aviso lo confirma.`);
      break;
    case "duplicada":
      partes.push("Aviso registrado: coincide con otro aviso reciente de la misma zona, que la sala ya está atendiendo.");
      break;
    case "ruido":
      partes.push("Aviso registrado. Con los datos que tenemos no consta un incendio en esa zona, pero queda anotado para la sala.");
      break;
    default:
      partes.push(v.enAnalisis ? "Aviso registrado: la sala lo está analizando ahora mismo." : "Aviso registrado: es el primer aviso de esa zona y la sala lo comprueba ahora mismo.");
  }
  if (!v.geolocalizada && !v.enAnalisis) partes.push("No he podido situar el lugar en el mapa: si puede, dígame el pueblo más cercano o la carretera y el punto kilométrico.");
  // Un consejo, el que toca: en un edificio no tiene sentido "nunca ladera arriba" (llamada de las 18:46).
  partes.push(v.urbano ? "Aléjese del humo y del edificio, y no vuelva a entrar." : "Aléjese del humo, nunca ladera arriba, y no se acerque a mirar.");
  return partes.join(" ");
}

// ---------------------------------------------------------------------
// Registro del aviso
// ---------------------------------------------------------------------

export interface ResultadoAviso {
  registrado: true;
  observacionId: string;
  /**
   * Qué hizo este registro: "nuevo" (primera vez en la llamada), "ampliacion" (misma llamada
   * con datos nuevos: se añaden a la observación) o "repetido" (reintento con los MISMOS
   * datos: no cambia nada). POST /api/happyrobot/aviso decide el SMS con esto.
   */
  registro: "nuevo" | "ampliacion" | "repetido";
  impacto: Observacion["impacto"] | null;
  verificacion: string | null;
  foco: { id: string; nombre: string; municipio: string; estado: string; confianza: number } | null;
  geolocalizada: boolean;
  /** true si el aviso aún no estaba situado (Nominatim en curso) cuando hubo que contestar: se remata en segundo plano. */
  enAnalisis: boolean;
  extraccion: "ia" | "determinista" | "pendiente";
  mensajeParaLocutor: string;
}

/**
 * Respuesta de `registrar_aviso` cuando faltan los datos mínimos (o es la prueba de nodo
 * de HappyRobot, que manda los campos vacíos): la MISMA forma que un registro, con
 * `registrado: false`, para que la plataforma exponga todos los campos al agente y él
 * sepa qué pedir. No registra nada.
 */
export function avisoSinDatos(motivo: string): Omit<ResultadoAviso, "registrado" | "observacionId" | "extraccion" | "registro"> & { registrado: false; observacionId: null; extraccion: null; registro: null; motivo: string } {
  return {
    registrado: false,
    observacionId: null,
    registro: null,
    impacto: null,
    verificacion: null,
    foco: null,
    geolocalizada: false,
    enAnalisis: false,
    extraccion: null,
    motivo,
    mensajeParaLocutor: "Todavía no lo he podido pasar a la sala: necesito el pueblo y qué está viendo.",
  };
}

/** Observación de una llamada concreta (por el run de HappyRobot). */
export function observacionDeLlamada(estado: Estado, runId: string): Observacion | undefined {
  for (const o of estado.observaciones.values()) if (o.canal === "llamada" && o.referenciaExterna === runId) return o;
  return undefined;
}

// ---------------------------------------------------------------------
// Preprocesado de la dirección dictada (lo que llega del reconocimiento de voz)
// ---------------------------------------------------------------------

const UNIDADES: Record<string, number> = { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, dieciséis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21, veintiún: 21, veintidos: 22, veintidós: 22, veintitres: 23, veintitrés: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintiséis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29 };
const DECENAS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const CENTENAS: Record<string, number> = { cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900 };

/** "treinta" → 30, "cuarenta y dos" → 42, "ciento doce" → 112, "doscientos" → 200; undefined si no es un número. */
export function numeroEnPalabras(texto: string): number | undefined {
  const partes = texto.toLowerCase().trim().split(/\s+/).filter((p) => p !== "y");
  if (!partes.length) return undefined;
  let total = 0;
  for (const p of partes) {
    if (p in CENTENAS) total += CENTENAS[p];
    else if (p in DECENAS) total += DECENAS[p];
    else if (p in UNIDADES) total += UNIDADES[p];
    else return undefined;
  }
  return total;
}

const ABREVIATURAS: [RegExp, string][] = [
  [/\b(avda|avd|av)\.?\s/gi, "Avenida "],
  [/\bc\/\s*/gi, "Calle "],
  [/\b(ctra|carr)\.?\s/gi, "Carretera "],
  [/\bp\.?\s?k\.?\s*(\d)/gi, "km $1"],
  [/\bkil[oó]metro\s+/gi, "km "],
  [/\bpza\.?\s/gi, "Plaza "],
  [/\bp[ºo]\.?\s/gi, "Paseo "],
  [/\burb\.?\s/gi, "Urbanización "],
  [/\bn[úu]mero\s+/gi, ""],
  [/\bn[ºo]\.?\s*(\d)/gi, "$1"],
];

const PALABRA_NUMERO = "(?:cien(?:to)?|[a-z]*cientos|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|veinti[a-zé]+|veinte|diecis[eé]is|diecisiete|dieciocho|diecinueve|diez|once|doce|trece|catorce|quince|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)";
const SECUENCIA_NUMERO = new RegExp(`\\b(${PALABRA_NUMERO}(?:\\s+(?:y\\s+)?${PALABRA_NUMERO})*)\\b`, "gi");

/**
 * Normaliza lo que dicta la persona para que Nominatim lo entienda: abreviaturas
 * (avda, c/, ctra, p.k.), números en letras ("treinta" → 30) y espacios/comas.
 */
export function normalizarDireccion(texto: string): string {
  let s = texto.trim().replace(/\s+/g, " ");
  for (const [re, sust] of ABREVIATURAS) s = s.replace(re, sust);
  s = s.replace(SECUENCIA_NUMERO, (m) => {
    const n = numeroEnPalabras(m);
    return n === undefined ? m : String(n);
  });
  return s.replace(/\s*,\s*/g, ", ").replace(/,\s*,/g, ",").replace(/^,|,$/g, "").trim();
}

const VIA = /\b(avenida|calle|carretera|paseo|camino|plaza|glorieta|ronda|travesía|travesia|autovía|autovia|autopista|urbanización|urbanizacion|polígono|poligono|vía|via|bulevar|cuesta|[A-Z]{1,2}-\d{1,4}|N-\d{1,3}|M-\d{1,3})\b/i;

/**
 * La parte de la dirección que Nominatim sí encuentra: la vía con su número
 * ("Avenida Complutense 30"), sin la coletilla que el reconocimiento de voz suele
 * pegar detrás ("Técnica Superior de Ingeniería de…"). undefined si no hay vía.
 */
export function viaConNumero(lugar: string): string | undefined {
  const partes = normalizarDireccion(lugar).split(",").map((p) => p.trim()).filter(Boolean);
  const via = partes.find((p) => VIA.test(p));
  if (!via) return undefined;
  // "Avenida Complutense 30 esquina con…" → hasta el número de portal o de kilómetro. El número va
  // precedido de espacio: el "403" de "N-403" es parte del código de la vía, no el número.
  const m = /^(.*?(?:^|\s)\d{1,4}\b)/.exec(via);
  return (m ? m[1] : via).trim();
}

/**
 * Consultas para Nominatim, de la más precisa a la más vaga. La primera es la vía
 * con número + municipio (lo que de verdad sitúa el punto); el municipio a secas va
 * al final porque su resultado es el centroide del término (Puerta del Sol si es
 * "Madrid"), que es mejor que nada pero no es el sitio.
 */
export type PrecisionLugar = "direccion" | "lugar" | "barrio" | "municipio" | "ninguna";

export interface CandidataGeo {
  consulta: string;
  /** Qué precisión tendría el punto si esta consulta acierta. */
  precision: Exclude<PrecisionLugar, "ninguna">;
}

export function candidatasConPrecision(a: Pick<AvisoLlamada, "lugar" | "municipio">): CandidataGeo[] {
  const municipios = (a.municipio ? normalizarDireccion(a.municipio) : "").split(",").map((m) => m.trim()).filter((m) => m.length > 1);
  const lugar = a.lugar ? normalizarDireccion(a.lugar) : "";
  const via = a.lugar ? viaConNumero(a.lugar) : undefined;
  const ciudad = municipios[municipios.length - 1];
  const barrio = municipios.length > 1 ? municipios[0] : undefined;
  const c: CandidataGeo[] = [];
  if (via && ciudad) c.push({ consulta: `${via}, ${ciudad}`, precision: "direccion" });
  if (via && barrio && ciudad) c.push({ consulta: `${via}, ${barrio}, ${ciudad}`, precision: "direccion" });
  if (lugar && ciudad && lugar !== via) c.push({ consulta: `${lugar}, ${ciudad}`, precision: via ? "direccion" : "lugar" });
  if (lugar && !ciudad) c.push({ consulta: lugar, precision: via ? "direccion" : "lugar" });
  if (via && !ciudad) c.push({ consulta: via, precision: "direccion" });
  if (barrio && ciudad) c.push({ consulta: `${barrio}, ${ciudad}`, precision: "barrio" });
  if (ciudad) c.push({ consulta: ciudad, precision: "municipio" });
  const vistas = new Set<string>();
  return c
    .map((x) => ({ ...x, consulta: x.consulta.replace(/\s*,\s*/g, ", ").trim() }))
    .filter((x) => x.consulta && !vistas.has(x.consulta) && vistas.add(x.consulta));
}

export function candidatasGeocodificacion(a: Pick<AvisoLlamada, "lugar" | "municipio">): string[] {
  return candidatasConPrecision(a).map((c) => c.consulta);
}

/**
 * Respuesta de `situar_lugar`. SIEMPRE con todas las claves (null si no hay dato):
 * HappyRobot solo deja ver al agente los campos que existen en la respuesta de muestra
 * y en la de prueba, y una respuesta a medias le dejaba sin lat/lon (medido el 19-09).
 */
export interface ResultadoSituar {
  encontrado: boolean;
  precision: PrecisionLugar;
  /** Nombre que devuelve Nominatim (calle, edificio, paraje, pueblo), para leerlo en voz alta. */
  nombre: string | null;
  municipio: string | null;
  provincia: string | null;
  lat: number | null;
  lon: number | null;
  /** Consulta que acertó (auditoría). */
  consulta: string | null;
  /** Cómo entendió la IA lo dictado ("Avenida Complutense 30, Madrid"); null si no intervino. */
  interpretacion: string | null;
  /** Qué corrigió la IA de la transcripción ("Arabaca → Aravaca"); null si nada. */
  correcciones: string | null;
  /** Quién propuso la consulta que acertó. */
  origen: "ia" | "reglas" | null;
  mensajeParaLocutor: string;
}

const SIGLAS_PARA_VOZ: [RegExp, string][] = [
  [/\bETSIT?\b/g, "Escuela de Ingenieros"],
  [/\bETS\b/g, "Escuela Técnica"],
  [/\bUPM\b/g, "Universidad Politécnica"],
  [/\bUCM\b/g, "Universidad Complutense"],
  [/\bIES\b/g, "Instituto"],
  [/\bCEIP\b/g, "Colegio"],
  [/\bC\/\s*/g, "Calle "],
  [/\bAvda\.?\s/gi, "Avenida "],
  [/\bCtra\.?\s/gi, "Carretera "],
  [/\bPza\.?\s/gi, "Plaza "],
];

/**
 * Lo que devuelve el mapa, dicho como lo diría una persona: sin siglas leídas letra a
 * letra ("ETSI" → "Escuela de Ingenieros"). Medido en la llamada de las 18:46: "Edificio B,
 * ETSI de Telecomunicación" sonaba raro y la persona tardó 12 s en contestar.
 */
export function paraVoz(texto: string): string {
  let s = texto;
  for (const [re, sust] of SIGLAS_PARA_VOZ) s = s.replace(re, sust);
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Frase del agente tras situar. Con una DIRECCIÓN (la calle y el número que dijo la persona,
 * encontrados tal cual) se AFIRMA y se sigue, sin pedir confirmación: en las llamadas del
 * 19-09 esperar el "sí" costó de 20 a 45 s con silencios y repeticiones. Con un lugar
 * aproximado sí se pregunta ("¿Es ahí?"). Nombres para la voz, sin siglas.
 */
export function mensajeSituar(r: Pick<ResultadoSituar, "precision"> & Partial<Pick<ResultadoSituar, "nombre" | "municipio" | "consulta">>): string {
  const donde = [r.nombre ? paraVoz(r.nombre) : undefined, r.municipio && r.municipio !== r.nombre ? r.municipio : undefined].filter(Boolean).join(", ");
  switch (r.precision) {
    case "direccion":
      return `Localizado en ${r.consulta ? paraVoz(r.consulta) : donde}.`;
    case "lugar":
      return `Lo tengo en ${donde}. ¿Es ahí?`;
    case "barrio":
      return `Lo sitúo en ${donde}, pero sin la calle. ¿Me da una calle y número, o una carretera y kilómetro?`;
    case "municipio":
      return `Solo tengo el municipio, ${r.municipio ?? r.nombre ?? ""}. Para acertar necesito una referencia: calle y número, carretera y kilómetro, o un sitio conocido.`;
    default:
      return "No encuentro ese lugar. ¿Me repite el pueblo y una calle, carretera o paraje, despacio?";
  }
}

const SIN_RESULTADO: Omit<ResultadoSituar, "mensajeParaLocutor" | "interpretacion" | "correcciones"> = {
  encontrado: false,
  precision: "ninguna",
  nombre: null,
  municipio: null,
  provincia: null,
  lat: null,
  lon: null,
  consulta: null,
  origen: null,
};

/** Tope total de `situar_lugar` (IA + Nominatim): la persona espera al teléfono. */
export const TIEMPO_MAX_SITUAR_MS = Number(process.env.HAPPYROBOT_SITUAR_MS ?? 9000);

// Último sitio situado en cada llamada (por run de HappyRobot). `registrar_aviso` usa ESTE
// punto, no las coordenadas que repita el agente: un modelo de voz puede redondearlas o
// inventarlas (medido el 19-09: registró 40.4527, -3.7281 sin haber recibido respuesta).
type GlobalSituar = typeof globalThis & { __atalayaSituadoPorRun?: Map<string, { punto: Punto; resultado: ResultadoSituar; en: number }> };
const situadoPorRun = () => ((globalThis as GlobalSituar).__atalayaSituadoPorRun ??= new Map());

/** Punto que `situar_lugar` encontró en esta llamada, si lo hay (caduca a la hora). */
export function puntoSituadoEnLlamada(runId: string | undefined): Punto | undefined {
  if (!runId) return undefined;
  const r = situadoPorRun().get(runId);
  if (!r || Date.now() - r.en > 3_600_000) return undefined;
  return r.punto;
}

/** Une las consultas de la IA (primero) y las de las reglas, sin repetir, con su origen. */
export function unirCandidatas(ia: CandidataGeo[], reglas: CandidataGeo[]): (CandidataGeo & { origen: "ia" | "reglas" })[] {
  const vistas = new Set<string>();
  const salida: (CandidataGeo & { origen: "ia" | "reglas" })[] = [];
  for (const [lista, origen] of [[ia, "ia"], [reglas, "reglas"]] as const) {
    for (const c of lista) {
      const clave = c.consulta.toLowerCase().replace(/\s+/g, " ").trim();
      if (!clave || vistas.has(clave)) continue;
      vistas.add(clave);
      salida.push({ ...c, origen });
    }
  }
  return salida;
}

/**
 * Herramienta `situar_lugar`: interpreta con IA lo que dicta la persona (corrige la
 * transcripción, separa vía, número, lugar conocido, barrio y municipio), lo busca en
 * Nominatim y dice con qué precisión, para que el AGENTE confirme el sitio en la llamada
 * antes de registrar. La IA y la primera consulta de las reglas arrancan a la vez; si la
 * IA no está o tarda más de su tope, siguen solas las reglas deterministas.
 */
export async function situarLugar(
  a: Pick<AvisoLlamada, "lugar" | "municipio">,
  opciones: { runId?: string; conIA?: boolean; tiempoMaxMs?: number; tiempoMaxIaMs?: number } = {},
): Promise<ResultadoSituar> {
  const t0 = Date.now();
  const tope = opciones.tiempoMaxMs ?? TIEMPO_MAX_SITUAR_MS;
  const reglas = candidatasConPrecision(a);
  const { interpretarLugarConIA, consultasDeInterpretacion } = await import("./ubicacion-ia");
  const iaEnCurso = opciones.conIA === false ? Promise.resolve(undefined) : interpretarLugarConIA(a.lugar, a.municipio, opciones.tiempoMaxIaMs);
  const { geocodificar } = await import("../fuentes/nominatim");
  const buscar = async (consulta: string) => {
    try {
      const lugar = await geocodificar(/españa/i.test(consulta) ? consulta : `${consulta}, España`);
      return lugar && enEspana(lugar.punto) ? lugar : undefined;
    } catch (e) {
      console.warn("[112 entrante] situar_lugar sin geocodificar:", e instanceof Error ? e.message : e);
      return undefined;
    }
  };
  // La mejor consulta de las reglas se lanza ya (Nominatim cachea: si la IA propone la misma, no repite).
  const primeraReglas = reglas[0] ? buscar(reglas[0].consulta) : Promise.resolve(undefined);

  const ia = await iaEnCurso;
  const interpretacion = ia ? ia.interpretacion.lugarCorregido.trim() || null : null;
  const correcciones = ia ? ia.interpretacion.correcciones.trim() || null : null;
  const candidatas = unirCandidatas(ia ? consultasDeInterpretacion(ia.interpretacion) : [], reglas).slice(0, 6);

  let acierto: { c: (typeof candidatas)[number]; lugar: NonNullable<Awaited<ReturnType<typeof buscar>>> } | undefined;
  for (const c of candidatas) {
    const quedan = tope - (Date.now() - t0);
    if (quedan <= 0) break;
    // Cada búsqueda con el tiempo que queda: la cola de Nominatim es compartida (1 petición/s) con
    // el enriquecimiento de los focos y una consulta podía esperar decenas de segundos (medido: 30 s).
    const r = await conTope(reglas[0] && c.consulta === reglas[0].consulta ? primeraReglas : buscar(c.consulta), quedan);
    const lugar = r.listo ? r.valor : undefined;
    if (lugar) {
      acierto = { c, lugar };
      break;
    }
  }
  void primeraReglas.catch(() => undefined);

  if (!acierto) {
    const base = { ...SIN_RESULTADO, interpretacion, correcciones };
    return { ...base, mensajeParaLocutor: mensajeSituar(base) };
  }
  const { c, lugar } = acierto;
  const base = {
    encontrado: true,
    precision: c.precision,
    nombre: lugar.nombre ?? null,
    municipio: lugar.municipio ?? null,
    provincia: lugar.provincia ?? null,
    lat: lugar.punto.lat,
    lon: lugar.punto.lon,
    consulta: c.consulta,
    interpretacion,
    correcciones,
    origen: c.origen,
  } satisfies Omit<ResultadoSituar, "mensajeParaLocutor">;
  const resultado: ResultadoSituar = { ...base, mensajeParaLocutor: mensajeSituar(base) };
  // Solo se recuerda lo que sirve para el mapa: una dirección, un lugar o un barrio (no el centroide del municipio).
  if (opciones.runId && c.precision !== "municipio") situadoPorRun().set(opciones.runId, { punto: lugar.punto, resultado, en: Date.now() });
  return resultado;
}

/**
 * Respuesta de `situar_lugar` cuando no llega nada que situar (la prueba de nodo de
 * HappyRobot manda los campos vacíos): la misma forma completa, sin buscar nada.
 */
export function situarSinDatos(): ResultadoSituar {
  const base = { ...SIN_RESULTADO, interpretacion: null, correcciones: null };
  return { ...base, mensajeParaLocutor: "Necesito el sitio: ¿en qué pueblo está y qué calle, carretera o paraje?" };
}

/** Sitúa el aviso probando `candidatasGeocodificacion` en orden. Solo puntos dentro de España; si nada cuadra, sin punto. */
async function situarAviso(a: AvisoLlamada): Promise<Punto | undefined> {
  const candidatas = candidatasGeocodificacion(a);
  if (!candidatas.length) return undefined;
  const { geocodificar } = await import("../fuentes/nominatim");
  for (const c of candidatas.slice(0, 5)) {
    try {
      const lugar = await geocodificar(/españa/i.test(c) ? c : `${c}, España`);
      if (lugar && enEspana(lugar.punto)) return lugar.punto;
    } catch (e) {
      console.warn("[112 entrante] geocodificación fallida:", e instanceof Error ? e.message : e);
    }
  }
  return undefined;
}

function focoDe(estado: Estado, obs: Observacion): ResultadoAviso["foco"] {
  const inc = obs.incendioId ? estado.incendios.get(obs.incendioId) : undefined;
  return inc ? { id: inc.id, nombre: inc.nombre, municipio: inc.municipio, estado: inc.estado, confianza: inc.confianza } : null;
}

async function verificarAhora(obsId: string): Promise<void> {
  try {
    const { verificarObservacionAhora } = await import("../agentes/analisis/verificador");
    await verificarObservacionAhora(obsId);
  } catch (e) {
    console.warn("[112 entrante] verificación inmediata fallida:", e instanceof Error ? e.message : e);
  }
}

/**
 * Remata una observación de llamada cuando la centralita ha terminado (o no
 * ha podido): sin extracción de IA entra la determinista; sin punto entra el
 * geocodificado aquí; y si nadie la ha verificado, se verifica en el acto.
 */
async function rematar(estado: Estado, obsId: string, a: AvisoLlamada): Promise<Observacion | undefined> {
  const actual = estado.observaciones.get(obsId);
  if (!actual) return undefined;
  const cambios: Partial<Observacion> = {};
  if (!actual.extraccion) cambios.extraccion = extraccionDeterminista(a);
  if (!actual.punto && a.punto) cambios.punto = a.punto;
  const obs = Object.keys(cambios).length ? (estado.actualizar(estado.observaciones, obsId, cambios) ?? { ...actual, ...cambios }) : actual;
  // Sin punto no se verifica todavía: el verificador la dejaría "registrada" para siempre
  // y el punto puede llegar un segundo después (Nominatim o la extracción de IA).
  if (!obs.punto) return obs;
  if (!obs.impacto) await verificarAhora(obsId);
  else if (obs.impacto === "registrada" && /sin localizaci/i.test(obs.verificacion ?? "")) {
    // Se verificó sin punto y ahora lo tiene: segunda oportunidad de declarar el foco.
    estado.actualizar(estado.observaciones, obsId, { impacto: undefined, verificacion: undefined });
    await verificarAhora(obsId);
  }
  return estado.observaciones.get(obsId) ?? obs;
}

/** Espera a `p` como mucho `ms`; si no llega, `listo: false` (la promesa sigue viva). */
async function conTope<T>(p: Promise<T>, ms: number): Promise<{ listo: true; valor: T } | { listo: false }> {
  if (ms <= 0) return { listo: false };
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<{ listo: false }>((r) => {
    temporizador = setTimeout(() => r({ listo: false }), ms);
  });
  try {
    return await Promise.race([p.then((valor) => ({ listo: true as const, valor })), tope]);
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

function resultadoDe(estado: Estado, obs: Observacion, a: AvisoLlamada, enAnalisis: boolean, registro: ResultadoAviso["registro"]): ResultadoAviso {
  const foco = focoDe(estado, obs);
  const geolocalizada = Boolean(obs.punto);
  return {
    registrado: true,
    observacionId: obs.id,
    registro,
    impacto: obs.impacto ?? null,
    verificacion: obs.verificacion ?? null,
    foco,
    geolocalizada,
    enAnalisis,
    extraccion: !obs.extraccion ? "pendiente" : obs.extraccion.resumen.includes(MARCA_DETERMINISTA) ? "determinista" : "ia",
    // El foco recién declarado aún no tiene municipio (se enriquece en segundo plano): se nombra el que dijo la persona.
    mensajeParaLocutor: mensajeParaLocutor({ impacto: obs.impacto, foco: foco ? { ...foco, municipio: foco.municipio || a.municipio || "" } : foco, geolocalizada, enAnalisis, personasEnRiesgo: a.personasEnRiesgo, urbano: esAvisoUrbano(a) }),
  };
}

// Una petición a la vez POR RUN (revisión del PR, 19-09): HappyRobot reintenta la herramienta si la
// respuesta tarda, y dos peticiones del mismo run corriendo a la vez veían las dos "sin observación
// previa", esperaban las dos a Nominatim y creaban dos observaciones. En cola, la segunda entra cuando
// la primera ha terminado y ve su observación. Sobrevive a la recarga en caliente, como el Estado.
type GlobalColaAviso = typeof globalThis & { __atalayaAvisoPorRun?: Map<string, Promise<unknown>> };
const colaAvisoPorRun = () => ((globalThis as GlobalColaAviso).__atalayaAvisoPorRun ??= new Map());

async function enSeriePorRun<T>(runId: string | undefined, tarea: () => Promise<T>): Promise<T> {
  if (!runId) return tarea();
  const colas = colaAvisoPorRun();
  const anterior = colas.get(runId) ?? Promise.resolve();
  // Pase lo que pase con la anterior (también si falló), la siguiente entra después.
  const propia = anterior.then(tarea, tarea);
  colas.set(runId, propia);
  try {
    return await propia;
  } finally {
    if (colas.get(runId) === propia) colas.delete(runId);
  }
}

const compacto = (t: string): string => t.replace(/\s+/g, " ").trim();

/**
 * ¿Estos datos dictados ya están en la observación de la llamada? Entonces es un REINTENTO
 * de la misma petición (la plataforma repite la herramienta si tardamos en contestar), no
 * una ampliación: no se añade texto ni vuelve a salir el SMS. Se mira en el propio texto de
 * la observación (`textoDeAviso` es determinista), así que vale también tras un reinicio.
 */
export function esRepeticion(previa: Pick<Observacion, "texto">, a: AvisoLlamada): boolean {
  return compacto(previa.texto).includes(compacto(textoDeAviso(a)));
}

/**
 * Registra el aviso que la persona dictó al agente de voz y devuelve qué
 * decirle. Es la herramienta `registrar_aviso` del workflow entrante.
 * Contesta en dos o tres segundos: Nominatim con tope, extracción determinista
 * de lo dictado y verificación en el acto; la IA de la centralita refina después.
 * Las peticiones del mismo run se atienden de una en una (`enSeriePorRun`).
 */
export async function registrarAvisoDeLlamada(a: AvisoLlamada, opciones: { esperaMs?: number; esperaGeoMs?: number } = {}): Promise<ResultadoAviso> {
  return enSeriePorRun(a.runId, () => registrarAvisoEnSerie(a, opciones));
}

async function registrarAvisoEnSerie(a: AvisoLlamada, opciones: { esperaMs?: number; esperaGeoMs?: number }): Promise<ResultadoAviso> {
  const estado = obtenerEstado();
  const esperaMs = opciones.esperaMs ?? Number(process.env.HAPPYROBOT_AVISO_ESPERA_MS ?? ESPERA_EXTRACCION_MS);
  const esperaGeoMs = opciones.esperaGeoMs ?? Number(process.env.HAPPYROBOT_AVISO_ESPERA_GEO_MS ?? ESPERA_GEOCODIFICACION_MS);
  // El punto que situar_lugar encontró en ESTA llamada manda sobre las coordenadas que repita el agente.
  const confirmado = puntoSituadoEnLlamada(a.runId);
  if (confirmado) a = { ...a, punto: confirmado };
  const geo = (): Promise<Punto | undefined> => (a.punto && enEspana(a.punto) ? Promise.resolve(a.punto) : situarAviso(a));

  // 1. Misma llamada, segunda vez. Un reintento con los MISMOS datos y sin punto nuevo no cambia nada
  //    (la plataforma repite la herramienta si tardamos): se contesta lo que hay. Con datos nuevos se
  //    amplía la observación existente; si solo llega el punto (situar_lugar acertó después), se aplica
  //    sin repetir el texto. Nunca se crea otra observación.
  if (a.runId) {
    const previa = observacionDeLlamada(estado, a.runId);
    if (previa) {
      const mismosDatos = esRepeticion(previa, a);
      const puntoNuevo = Boolean(!previa.punto && a.punto && enEspana(a.punto));
      if (mismosDatos && !puntoNuevo) return resultadoDe(estado, previa, a, false, "repetido");
      const cambios: Partial<Observacion> = {};
      if (!mismosDatos) cambios.texto = `${previa.texto}\n\nActualización durante la misma llamada:\n${textoDeAviso(a)}`;
      if (!previa.remitente && a.telefono) cambios.remitente = a.telefono;
      let punto = previa.punto;
      let situando: Promise<Punto | undefined> | undefined;
      if (!punto) {
        situando = geo();
        const r = await conTope(situando, esperaGeoMs);
        if (r.listo) {
          punto = r.valor;
          situando = undefined;
          if (punto) cambios.punto = punto;
        }
      }
      if (Object.keys(cambios).length) estado.actualizar(estado.observaciones, previa.id, cambios);
      const obs = (await rematar(estado, previa.id, { ...a, punto })) ?? previa;
      if (situando) void situando.then((p) => rematar(estado, previa.id, { ...a, punto: p })).catch(() => undefined);
      return resultadoDe(estado, obs, a, Boolean(situando), "ampliacion");
    }
  }

  // 2. Situar con tope: si Nominatim tarda, se sigue sin punto y se remata en segundo plano.
  let situando: Promise<Punto | undefined> | undefined = geo();
  const geoListo = await conTope(situando, esperaGeoMs);
  const punto = geoListo.listo ? geoListo.valor : undefined;
  if (geoListo.listo) situando = undefined;
  const conPunto: AvisoLlamada = { ...a, punto };

  // 3. Entregar a la centralita: guarda la observación antes de su primer await y
  //    lanza la extracción de IA, que aquí NO se espera (salvo esperaMs > 0).
  const texto = textoDeAviso(a);
  const { procesarEntrada } = await import("../agentes/percepcion/centralita");
  const enCurso = procesarEntrada({ canal: "llamada", texto, remitente: a.telefono, referenciaExterna: a.runId, punto }).then(
    (o) => ({ ok: true as const, obs: o }),
    (e: unknown) => ({ ok: false as const, error: e }),
  );
  const ia = await conTope(enCurso, esperaMs);
  if (ia.listo && !ia.valor.ok) throw ia.valor.error instanceof Error ? ia.valor.error : new Error(String(ia.valor.error));

  const guardada =
    (ia.listo && ia.valor.ok ? ia.valor.obs : undefined) ??
    (a.runId ? observacionDeLlamada(estado, a.runId) : undefined) ??
    [...estado.observaciones.values()].reverse().find((o) => o.canal === "llamada" && o.texto === texto);
  if (!guardada) throw new Error("La centralita no ha guardado la observación de la llamada");

  // 4. Rematar ya con lo que hay (extracción determinista + verificación si hay punto)…
  const obs = (await rematar(estado, guardada.id, conPunto)) ?? guardada;
  // …y en segundo plano: el punto que falte y la extracción de IA cuando termine.
  if (situando) void situando.then((p) => rematar(estado, guardada.id, { ...a, punto: p })).catch(() => undefined);
  if (!ia.listo) void enCurso.then(async (r) => { if (r.ok) await rematar(estado, r.obs.id, conPunto); });
  return resultadoDe(estado, obs, a, Boolean(situando), "nuevo");
}

/**
 * Al colgar: la transcripción completa se ADJUNTA a la observación que la
 * herramienta creó durante la llamada (identificada por el run). Devuelve
 * undefined si no hay observación de ese run (entonces el webhook crea una).
 */
export function adjuntarTranscripcion(runId: string, transcripcion: string, telefono?: string): Observacion | undefined {
  const estado = obtenerEstado();
  const obs = observacionDeLlamada(estado, runId);
  if (!obs) return undefined;
  const cambios: Partial<Observacion> = {};
  // El webhook de colgar manda la transcripción como texto JSON: en la ficha va legible
  // ("Operador: … / Persona: …"), no en crudo (medido en la llamada de las 18:46).
  const limpia = transcripcionLegible(transcripcion);
  if (limpia && !obs.texto.includes(MARCA_TRANSCRIPCION)) cambios.texto = `${obs.texto}\n\n${MARCA_TRANSCRIPCION}\n${limpia}`;
  if (!obs.remitente && telefono && pareceTelefono(telefono)) cambios.remitente = telefono;
  const actualizada = Object.keys(cambios).length ? (estado.actualizar(estado.observaciones, obs.id, cambios) ?? { ...obs, ...cambios }) : obs;
  estado.registrarEvento(
    "observacion",
    `Llamada al 112 virtual de ${actualizada.remitente ?? "un ciudadano"}: transcripción adjuntada al aviso ${obs.id}${obs.impacto ? ` (${obs.impacto})` : ""}.`,
    { agenteId: "centralita", incendioId: obs.incendioId, nivel: "info", datos: { observacionId: obs.id, referenciaExterna: runId, adjuntada: Boolean(cambios.texto) } },
  );
  return actualizada;
}
