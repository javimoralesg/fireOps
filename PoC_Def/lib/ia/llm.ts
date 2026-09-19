// =====================================================================
// ATALAYA INCENDIOS · Punto único de acceso al LLM
// ---------------------------------------------------------------------
// DUEÑO: constructor C.
// Proveedores compatibles con la API de OpenAI a través del SDK `openai`
// (7.19.0): helmcode (UE, POR DEFECTO), groq y openai. Tres papeles:
// razonamiento, rapido y vision, cada uno con su modelo por variable de
// entorno.
//
// HelmCode es el proveedor principal (clave de Javi, tarifa plana, inferencia
// en la UE — argumento de peso para una plataforma de la administración
// española). Groq y OpenAI quedan conmutables con LLM_PROVEEDOR.
//
// Reglas que impone Groq y que aquí se respetan (docs/investigacion-apis-ia.md):
//   · `response_format: json_schema` NO se puede combinar con `tools` ni con
//     `stream: true`. Aquí nunca se usan tools ni streaming.
//   · `strict: true` exige que todo objeto declare `additionalProperties:false`
//     y que TODAS sus propiedades estén en `required`: por eso se endurece el
//     JSON Schema que produce zod antes de mandarlo.
//   · 429 devuelve la cabecera `retry-after` en segundos.
//
// NADA SIMULADO: sin clave del proveedor, cada llamada lanza un error claro
// que la interfaz enseña tal cual. Jamás se devuelve una respuesta inventada.
//
// Dependencias externas: `openai` (SDK), `zod` v4 (`z.toJSONSchema`).
// =====================================================================

import { AsyncLocalStorage } from "node:async_hooks";
import OpenAI from "openai";
import { z, type ZodType } from "zod";
import { anotarLlamadaIA, resumir } from "../motor/traza";

export type PapelLLM = "razonamiento" | "rapido" | "vision";

export interface ImagenLLM {
  base64: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
}

/**
 * Prioridad en la cola de concurrencia.
 *   "alta"   → cadena de mando: supervisor, asesor legal, coordinador,
 *              protección a la población y portavoz. Son las llamadas que
 *              marcan los tiempos de la sala.
 *   "normal" → percepción y trabajo de fondo: prensa, cámaras, aprendizaje.
 *              Pueden esperar.
 *   "baja"   → auditoría a posteriori (narrativa de las actas). Tiene UN hueco
 *              propio (LLM_CONCURRENCIA_BAJA, 1 por defecto) que NO compite con
 *              los de "alta"/"normal": redactar un acta no puede volver a
 *              retrasar una aprobación ni el ciclo de un agente de decisión.
 * MEDIDO 2026-09-19: con LLM_CONCURRENCIA=4 y 16 agentes, una evaluación del
 * supervisor llegaba a esperar 60-190 s detrás de las llamadas de percepción.
 */
export type PrioridadLLM = "alta" | "normal" | "baja";

export interface PeticionJson<T> {
  /** true para herramientas del humano (consultas del conocimiento, informes a demanda) que deben funcionar aunque el mundo esté en pausa. */
  permitirEnPausa?: boolean;
  /** Prioridad en la cola (por defecto "normal"). */
  prioridad?: PrioridadLLM;
  system?: string;
  user: string;
  esquema: ZodType<T>;
  nombreEsquema?: string;
  papel?: PapelLLM;
  imagenes?: ImagenLLM[];
  maxTokens?: number;
  temperatura?: number;
  signal?: AbortSignal;
  /**
   * Pedir la respuesta SIN razonamiento previo (HelmCode qwen3.6: `enable_thinking: false`;
   * Groq: `reasoning_effort: low`). Para tareas cortas con una persona esperando al
   * teléfono: medido el 19-09, qwen3.6 tarda 16-23 s razonando y 0,2-2 s sin razonar
   * (sesión fireops-82, interpretación del lugar dictado al 112).
   */
  sinRazonar?: boolean;
}

export interface RespuestaLLM<T> {
  datos: T;
  modelo: string;
  proveedor: string;
  latenciaMs: number;
}

export type NombreProveedor = "groq" | "helmcode" | "openai";

interface ConfiguracionProveedor {
  nombre: NombreProveedor;
  baseURL: string;
  clave?: string;
  variableClave: string;
  /** El proveedor admite `reasoning_effort` (Groq y modelos gpt-oss/qwen). */
  admiteEsfuerzoRazonamiento: boolean;
}

// ---------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 90_000);
const MAX_TOKENS_POR_DEFECTO = Number(process.env.LLM_MAX_TOKENS ?? 4096);
/**
 * Mínimo de tokens de salida. qwen3.6 y deepseek-v4-flash razonan antes de
 * responder (`reasoning_content`) y con un tope bajo se gastan el presupuesto
 * pensando y devuelven `content: null`. Verificado 2026-09-19.
 */
const MIN_TOKENS_SALIDA = Number(process.env.LLM_MIN_TOKENS ?? 1500);

function configuracion(nombre: NombreProveedor): ConfiguracionProveedor {
  switch (nombre) {
    case "helmcode":
      return {
        nombre,
        baseURL: process.env.HELMCODE_API_BASE?.trim() || "https://api.helmcode.com/v1",
        clave: process.env.HELMCODE_API_KEY?.trim(),
        variableClave: "HELMCODE_API_KEY",
        admiteEsfuerzoRazonamiento: false,
      };
    case "openai":
      return {
        nombre,
        baseURL: process.env.OPENAI_API_BASE?.trim() || "https://api.openai.com/v1",
        clave: process.env.OPENAI_API_KEY?.trim(),
        variableClave: "OPENAI_API_KEY",
        admiteEsfuerzoRazonamiento: false,
      };
    case "groq":
      return {
        nombre: "groq",
        baseURL: process.env.GROQ_API_BASE?.trim() || "https://api.groq.com/openai/v1",
        clave: process.env.GROQ_API_KEY?.trim(),
        variableClave: "GROQ_API_KEY",
        admiteEsfuerzoRazonamiento: true,
      };
    default:
      return configuracion("helmcode");
  }
}

function normalizarProveedor(valor: string | undefined): NombreProveedor {
  const v = valor?.trim().toLowerCase();
  if (v === "groq" || v === "openai") return v;
  return "helmcode";
}

/** Proveedor configurado para un papel (visión puede tener el suyo propio). */
function proveedorDe(papel: PapelLLM): ConfiguracionProveedor {
  if (papel === "vision" && process.env.LLM_VISION_PROVEEDOR?.trim()) {
    return configuracion(normalizarProveedor(process.env.LLM_VISION_PROVEEDOR));
  }
  return configuracion(normalizarProveedor(process.env.LLM_PROVEEDOR));
}

/** Modelos por defecto de cada proveedor, verificados en docs/investigacion-apis-ia.md. */
const MODELOS_POR_DEFECTO: Record<NombreProveedor, Record<PapelLLM, string>> = {
  // HelmCode: deepseek-v4-flash razona con 1M de contexto; qwen3.6 es rápido y ve.
  // MEDIDO 2026-09-19 con la clave real (misma pregunta de supervisión,
  // json_schema strict): glm5.3-flash 6,1 s · qwen3.6 5,1 s · glm5.2 5,9 s ·
  // deepseek-v4-flash 66 s (3.136 tokens de razonamiento) · gemma4 supera el
  // tiempo máximo. Por eso el papel de razonamiento usa glm5.3-flash: en una
  // sala de mando, un supervisor que tarda un minuto por decisión no sirve.
  helmcode: { razonamiento: "glm5.3-flash", rapido: "qwen3.6", vision: "qwen3.6" },
  groq: { razonamiento: "openai/gpt-oss-120b", rapido: "openai/gpt-oss-20b", vision: "qwen/qwen3.8-27b" },
  openai: { razonamiento: "gpt-4.1", rapido: "gpt-4.1-mini", vision: "gpt-4.1-mini" },
};

/** Modelo que usa cada papel (variable de entorno, o el defecto del proveedor activo). */
export function modeloPara(papel: PapelLLM): string {
  const variable =
    papel === "vision"
      ? process.env.LLM_MODELO_VISION
      : papel === "rapido"
        ? process.env.LLM_MODELO_RAPIDO
        : process.env.LLM_MODELO_RAZONAMIENTO;
  if (variable?.trim()) return variable.trim();
  return MODELOS_POR_DEFECTO[proveedorDe(papel).nombre][papel];
}

/** ¿Hay clave para el proveedor por defecto? Si es false, todo fallará de forma visible. */
export function proveedorDisponible(): boolean {
  return Boolean(proveedorDe("razonamiento").clave);
}

/** Nombre del proveedor activo, para la barra de estado y los informes. */
export function proveedorActivo(): NombreProveedor {
  return proveedorDe("razonamiento").nombre;
}

/** Mensaje de error único para "falta la clave", igual en toda la aplicación. */
export function motivoIndisponible(): string | undefined {
  const c = proveedorDe("razonamiento");
  if (c.clave) return undefined;
  return `Sin proveedor de IA: falta ${c.variableClave} en .env.local (LLM_PROVEEDOR=${c.nombre}). Ninguna respuesta se inventa.`;
}

// ---------------------------------------------------------------------
// Clientes (uno por proveedor, cacheados en el proceso)
// ---------------------------------------------------------------------

interface CacheLLM {
  clientes?: Map<string, OpenAI>;
  estadisticas?: EstadisticasLLM;
}

type ConCache = typeof globalThis & { __atalayaLLM?: CacheLLM };
const cache: CacheLLM = ((globalThis as ConCache).__atalayaLLM ??= {});

function cliente(c: ConfiguracionProveedor): OpenAI {
  if (!c.clave) {
    throw new Error(
      `Sin proveedor de IA: falta ${c.variableClave} en .env.local (proveedor "${c.nombre}"). ` +
        `La plataforma no inventa respuestas: configura la clave y vuelve a intentarlo.`,
    );
  }
  cache.clientes ??= new Map();
  const llave = `${c.nombre}|${c.baseURL}|${c.clave.slice(-6)}`;
  let existente = cache.clientes.get(llave);
  if (!existente) {
    existente = new OpenAI({ apiKey: c.clave, baseURL: c.baseURL, maxRetries: 0, timeout: TIMEOUT_MS });
    cache.clientes.set(llave, existente);
  }
  return existente;
}

// ---------------------------------------------------------------------
// Contadores de uso (para /api/aprendizaje y la barra de estado)
// ---------------------------------------------------------------------

export interface ContadorPapel {
  llamadas: number;
  tokensEntrada: number;
  tokensSalida: number;
  errores: number;
  latenciaTotalMs: number;
  /** Latencia media en milisegundos (0 si no hubo llamadas). */
  latenciaMediaMs: number;
  ultimoError?: string;
}

export interface EstadisticasLLM {
  proveedor: NombreProveedor;
  disponible: boolean;
  modelos: Record<PapelLLM, string>;
  porPapel: Record<PapelLLM, ContadorPapel>;
}

function contadorVacio(): ContadorPapel {
  return { llamadas: 0, tokensEntrada: 0, tokensSalida: 0, errores: 0, latenciaTotalMs: 0, latenciaMediaMs: 0 };
}

function contadores(): Record<PapelLLM, ContadorPapel> {
  cache.estadisticas ??= {
    proveedor: proveedorActivo(),
    disponible: proveedorDisponible(),
    modelos: { razonamiento: modeloPara("razonamiento"), rapido: modeloPara("rapido"), vision: modeloPara("vision") },
    porPapel: { razonamiento: contadorVacio(), rapido: contadorVacio(), vision: contadorVacio() },
  };
  return cache.estadisticas.porPapel;
}

/** Contadores en memoria de uso del LLM (llamadas, tokens, errores, latencia). */
export function estadisticasLLM(): EstadisticasLLM {
  const porPapel = contadores();
  return {
    proveedor: proveedorActivo(),
    disponible: proveedorDisponible(),
    modelos: { razonamiento: modeloPara("razonamiento"), rapido: modeloPara("rapido"), vision: modeloPara("vision") },
    porPapel: {
      razonamiento: { ...porPapel.razonamiento },
      rapido: { ...porPapel.rapido },
      vision: { ...porPapel.vision },
    },
  };
}

function anotarExito(papel: PapelLLM, latenciaMs: number, uso?: { prompt_tokens?: number; completion_tokens?: number }): void {
  const c = contadores()[papel];
  c.llamadas += 1;
  c.latenciaTotalMs += latenciaMs;
  c.latenciaMediaMs = Math.round(c.latenciaTotalMs / c.llamadas);
  c.tokensEntrada += uso?.prompt_tokens ?? 0;
  c.tokensSalida += uso?.completion_tokens ?? 0;
}

function anotarError(papel: PapelLLM, mensaje: string): void {
  const c = contadores()[papel];
  c.errores += 1;
  c.ultimoError = mensaje;
}

// ---------------------------------------------------------------------
// JSON Schema: zod v4 → esquema que Groq acepta en modo strict
// ---------------------------------------------------------------------

/** Palabras clave que el modo strict de los proveedores suele rechazar. */
const CLAVES_NO_SOPORTADAS = [
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "pattern", "format", "minItems", "maxItems",
  "uniqueItems", "default", "$schema", "contentEncoding", "contentMediaType",
  "propertyNames", "patternProperties", "minProperties", "maxProperties", "examples",
];

/**
 * Endurece el JSON Schema en el sitio: cada objeto declara
 * `additionalProperties: false` y lista TODAS sus propiedades en `required`
 * (lo exige `strict: true`), y se quitan las palabras clave no soportadas.
 */
export function endurecer(nodo: unknown): unknown {
  if (Array.isArray(nodo)) return nodo.map(endurecer);
  if (!nodo || typeof nodo !== "object") return nodo;
  const obj = { ...(nodo as Record<string, unknown>) };
  for (const clave of CLAVES_NO_SOPORTADAS) delete obj[clave];

  // `anyOf` con null (zod .nullable()) se conserva; el resto se recorre.
  for (const [clave, valor] of Object.entries(obj)) {
    if (clave === "properties" && valor && typeof valor === "object") {
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(valor as Record<string, unknown>)) props[k] = endurecer(v);
      obj.properties = props;
    } else if (clave === "$defs" && valor && typeof valor === "object") {
      const defs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(valor as Record<string, unknown>)) defs[k] = endurecer(v);
      obj.$defs = defs;
    } else if (clave !== "required" && clave !== "enum") {
      obj[clave] = endurecer(valor);
    }
  }

  if (obj.type === "object" || (obj.properties && typeof obj.properties === "object")) {
    obj.additionalProperties = false;
    obj.required = Object.keys((obj.properties ?? {}) as Record<string, unknown>);
  }
  return obj;
}

/**
 * EXPORTADA junto con `endurecer` (fase F0 de la migración, fallo L-2 de
 * docs/PRUEBAS.md): el endurecimiento del JSON Schema solo se validaba de rebote,
 * cuando una llamada real con `strict: true` fallaba. La fase F3 toca el esquema
 * más grande del sistema, así que necesita unitarias deterministas. Cambio
 * aditivo: no altera el comportamiento.
 */
export function esquemaJson<T>(esquema: ZodType<T>): Record<string, unknown> {
  // zod v4 trae `z.toJSONSchema`. `io: "output"` describe lo que el modelo debe
  // producir; `unrepresentable: "any"` evita que tipos exóticos rompan la
  // conversión (se quedan como esquema libre).
  const bruto = z.toJSONSchema(esquema as z.ZodType, {
    target: "draft-2020-12",
    io: "output",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  return endurecer(bruto) as Record<string, unknown>;
}

// ---------------------------------------------------------------------
// Construcción de mensajes
// ---------------------------------------------------------------------

type Mensaje = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function construirMensajes(system: string | undefined, user: string, imagenes?: ImagenLLM[]): Mensaje[] {
  const mensajes: Mensaje[] = [];
  if (system) mensajes.push({ role: "system", content: system });
  if (imagenes?.length) {
    mensajes.push({
      role: "user",
      content: [
        { type: "text", text: user },
        ...imagenes.map((img) => ({
          type: "image_url" as const,
          image_url: { url: `data:${img.mime};base64,${img.base64}` },
        })),
      ],
    });
  } else {
    mensajes.push({ role: "user", content: user });
  }
  return mensajes;
}

// ---------------------------------------------------------------------
// Errores: 429, esquema rechazado
// ---------------------------------------------------------------------

interface ErrorApi {
  status?: number;
  headers?: Record<string, string> | Headers;
  message?: string;
  error?: { message?: string };
}

function estado(e: unknown): number | undefined {
  return typeof e === "object" && e !== null ? (e as ErrorApi).status : undefined;
}

function mensajeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function segundosReintento(e: unknown): number | undefined {
  const cab = typeof e === "object" && e !== null ? (e as ErrorApi).headers : undefined;
  if (!cab) return undefined;
  const bruto = cab instanceof Headers ? cab.get("retry-after") : cab["retry-after"] ?? cab["Retry-After"];
  const n = Number(bruto);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** El proveedor no admite `json_schema` con este modelo (400 con mensaje explícito). */
function rechazaEsquema(e: unknown): boolean {
  if (estado(e) !== 400) return false;
  const m = mensajeError(e).toLowerCase();
  return (
    m.includes("json_schema") ||
    m.includes("response_format") ||
    m.includes("schema") ||
    m.includes("structured output")
  );
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** El modelo agotó el presupuesto razonando y no devolvió contenido. */
class ErrorSinContenido extends Error {
  readonly sinContenido = true;
}

// ---------------------------------------------------------------------
// Llamada base
// ---------------------------------------------------------------------

interface OpcionesLlamada {
  permitirEnPausa?: boolean;
  prioridad?: PrioridadLLM;
  papel: PapelLLM;
  mensajes: Mensaje[];
  maxTokens: number;
  temperatura?: number;
  signal?: AbortSignal;
  formato?: OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"];
  /** Ver `PeticionJson.sinRazonar`. */
  sinRazonar?: boolean;
}

interface ResultadoCrudo {
  texto: string;
  latenciaMs: number;
  modelo: string;
  proveedor: NombreProveedor;
}

/** Texto plano del último mensaje de usuario, para la traza (sin imágenes). */
function textoDelPrompt(mensajes: Mensaje[]): string {
  const ultimo = [...mensajes].reverse().find((m) => m.role === "user");
  if (!ultimo) return "";
  const c = ultimo.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((parte) => (parte.type === "text" ? parte.text : `[${parte.type}]`))
      .join(" ");
  }
  return "";
}

/**
 * Una llamada de chat. Reintenta UNA vez ante 429 respetando `retry-after`;
 * si vuelve a fallar, lanza un error legible.
 */
// ---------------------------------------------------------------------
// Cola de concurrencia: con 16 agentes pidiendo a la vez, el proveedor
// degrada de ~6 s a >60 s por petición. Se limita a LLM_CONCURRENCIA
// (por defecto 4) peticiones simultáneas; el resto espera en orden.
// ---------------------------------------------------------------------
const CONCURRENCIA_MAX = Math.max(1, Number(process.env.LLM_CONCURRENCIA ?? 4));
/** Huecos reservados al carril "baja" (actas). Independientes de CONCURRENCIA_MAX. */
const CONCURRENCIA_BAJA = Math.max(1, Number(process.env.LLM_CONCURRENCIA_BAJA ?? 1));
let enCurso = 0;
let enCursoBaja = 0;
// DOS colas (constructor M, 2026-09-19). Con una sola, la evaluación del
// supervisor de una decisión de ataque inicial entraba detrás de las llamadas
// de prensa y de las cámaras y esperaba minutos. Ahora la cadena de mando pasa
// delante; dentro de cada cola el orden sigue siendo estricto (FIFO), así que
// nadie se queda atrás para siempre mientras haya turnos que liberar.
const colaAlta: (() => void)[] = [];
const colaNormal: (() => void)[] = [];
/** TERCER carril (constructor S, 2026-09-19): actas de auditoría, con su propio hueco. */
const colaBaja: (() => void)[] = [];

/**
 * Prioridad "por ambiente": la fija `conPrioridadLLM` alrededor de un bloque y
 * la heredan todas las llamadas que salgan de dentro, aunque las haga otro
 * módulo (p. ej. el redactor de informes cuando lo invocan las actas). Así no
 * hay que cambiar la firma de nadie para mandar su trabajo al carril lento.
 */
const almacenPrioridad = new AsyncLocalStorage<PrioridadLLM>();

/** Ejecuta `fn` marcando todas sus llamadas al LLM con esta prioridad (si no piden una explícita). */
export function conPrioridadLLM<T>(prioridad: PrioridadLLM, fn: () => T): T {
  return almacenPrioridad.run(prioridad, fn);
}

function prioridadEfectiva(pedida?: PrioridadLLM): PrioridadLLM {
  return pedida ?? almacenPrioridad.getStore() ?? "normal";
}

async function adquirirTurno(prioridadPedida?: PrioridadLLM, signal?: AbortSignal): Promise<() => void> {
  const prioridad = prioridadEfectiva(prioridadPedida);
  const baja = prioridad === "baja";
  const cola = baja ? colaBaja : prioridad === "alta" ? colaAlta : colaNormal;
  const hayHueco = () => (baja ? enCursoBaja < CONCURRENCIA_BAJA : enCurso < CONCURRENCIA_MAX);
  if (!hayHueco()) {
    await new Promise<void>((resolver, rechazar) => {
      const entrada = () => resolver();
      cola.push(entrada);
      signal?.addEventListener(
        "abort",
        () => {
          const i = cola.indexOf(entrada);
          if (i >= 0) cola.splice(i, 1);
          rechazar(Object.assign(new Error("Request was aborted."), { name: "AbortError" }));
        },
        { once: true },
      );
    });
  }
  if (baja) enCursoBaja += 1;
  else enCurso += 1;
  return () => {
    if (baja) {
      enCursoBaja -= 1;
      colaBaja.shift()?.();
      return;
    }
    enCurso -= 1;
    const siguiente = colaAlta.shift() ?? colaNormal.shift();
    if (siguiente) siguiente();
  };
}

/** Estado de la cola (para /api/salud y las trazas). */
export function estadoColaLLM(): {
  enCurso: number;
  esperando: number;
  maximo: number;
  esperandoAlta: number;
  esperandoNormal: number;
  esperandoBaja: number;
  enCursoBaja: number;
  maximoBaja: number;
} {
  return {
    enCurso,
    esperando: colaAlta.length + colaNormal.length + colaBaja.length,
    maximo: CONCURRENCIA_MAX,
    esperandoAlta: colaAlta.length,
    esperandoNormal: colaNormal.length,
    esperandoBaja: colaBaja.length,
    enCursoBaja,
    maximoBaja: CONCURRENCIA_BAJA,
  };
}

/** true mientras el mundo está en pausa (bandera que fija lib/motor/reloj.ts). */
export function mundoEnPausa(): boolean {
  return (globalThis as { __atalayaMundoPausado?: boolean }).__atalayaMundoPausado === true;
}

/**
 * Peticiones vivas contra el proveedor. Se guardan para poder cortarlas TODAS
 * cuando el mando pulsa "Parar": sin esto, una llamada ya lanzada seguía hasta
 * completarse (medido 2026-09-19: 5 respuestas completas durante 30 s de pausa),
 * y "pausado" no era verdad. Vive en globalThis para sobrevivir al hot reload.
 */
const enVuelo: Set<AbortController> = ((globalThis as ConCache & { __atalayaLLMEnVuelo?: Set<AbortController> }).__atalayaLLMEnVuelo ??= new Set());

/**
 * Corta todas las llamadas a la IA que estén en curso y vacía la cola de espera.
 * La llama lib/motor/reloj.ts al pausar el mundo y el orquestador al aplicar la
 * pausa global. Es idempotente y nunca lanza.
 */
export function abortarLlamadasIA(motivo = "Mundo en pausa"): number {
  let cortadas = 0;
  for (const c of [...enVuelo]) {
    try {
      c.abort(Object.assign(new Error(`${motivo}: llamada a la IA cancelada`), { name: "AbortError" }));
      cortadas += 1;
    } catch {
      /* abortar nunca debe tumbar al que pausa */
    }
    enVuelo.delete(c);
  }
  return cortadas;
}

async function llamar(...args: Parameters<typeof llamarSinCola>): ReturnType<typeof llamarSinCola> {
  const enPausa = () => mundoEnPausa() && !args[0]?.permitirEnPausa;
  if (enPausa()) {
    throw Object.assign(new Error("Mundo en pausa: no se hacen llamadas a la IA hasta reanudar"), { name: "AbortError" });
  }
  const liberar = await adquirirTurno(args[0]?.prioridad, args[0]?.signal);
  try {
    // Segunda comprobación: entre entrar en la cola y salir de ella pueden pasar
    // decenas de segundos y el mando puede haber pulsado "Parar" en medio.
    if (enPausa()) {
      throw Object.assign(new Error("Mundo en pausa: no se hacen llamadas a la IA hasta reanudar"), { name: "AbortError" });
    }
    return await llamarSinCola(...args);
  } finally {
    liberar();
  }
}

async function llamarSinCola(o: OpcionesLlamada): Promise<ResultadoCrudo> {
  const conf = proveedorDe(o.papel);
  const api = cliente(conf);
  const modelo = modeloPara(o.papel);

  const maxTokens = Math.max(o.maxTokens, MIN_TOKENS_SALIDA);
  const cuerpo: Record<string, unknown> = {
    model: modelo,
    messages: o.mensajes,
    max_completion_tokens: maxTokens,
    // Groq convierte 0 a 1e-8; usamos un valor bajo pero > 0.
    temperature: o.temperatura ?? 0.2,
  };
  if (o.formato) cuerpo.response_format = o.formato;
  // `reasoning_effort: low` acelera mucho el papel rápido en Groq (gpt-oss/qwen).
  if (conf.admiteEsfuerzoRazonamiento && (o.papel === "rapido" || o.sinRazonar)) cuerpo.reasoning_effort = "low";
  // HelmCode sirve qwen3 con plantilla vLLM: sin esto razona siempre antes de contestar.
  if (o.sinRazonar && conf.nombre === "helmcode") cuerpo.chat_template_kwargs = { enable_thinking: false };

  const ejecutar = async (): Promise<ResultadoCrudo> => {
    const t0 = Date.now();
    // Controlador propio registrado en `enVuelo`: así "Parar" corta también las
    // peticiones que ya están en el aire, incluidas las lanzadas en segundo plano
    // (actas, supervisor a posteriori) que no heredan el signal de ningún ciclo.
    const propio = new AbortController();
    const heredado = o.signal ?? AbortSignal.timeout(TIMEOUT_MS);
    const propagar = () => propio.abort(heredado.reason);
    if (heredado.aborted) propagar();
    else heredado.addEventListener("abort", propagar, { once: true });
    if (!o.permitirEnPausa) enVuelo.add(propio);
    let r: OpenAI.Chat.Completions.ChatCompletion;
    try {
      r = (await api.chat.completions.create(
        cuerpo as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        { signal: propio.signal },
      )) as OpenAI.Chat.Completions.ChatCompletion;
    } finally {
      enVuelo.delete(propio);
      heredado.removeEventListener("abort", propagar);
    }
    const latenciaMs = Date.now() - t0;
    const texto = r.choices?.[0]?.message?.content ?? "";
    anotarExito(o.papel, latenciaMs, r.usage);
    if (!texto.trim()) {
      // Se gastó el presupuesto razonando: se reintenta una vez con el doble.
      const razonando = Boolean(
        (r.choices?.[0]?.message as unknown as { reasoning_content?: string; reasoning?: string })?.reasoning_content ??
          (r.choices?.[0]?.message as unknown as { reasoning?: string })?.reasoning,
      );
      throw new ErrorSinContenido(
        `${modelo} devolvió contenido vacío${razonando ? " tras razonar" : ""} ` +
          `(${r.usage?.completion_tokens ?? "?"} tokens de salida, tope ${maxTokens}).`,
      );
    }
    anotarLlamadaIA({
      proveedor: conf.nombre,
      modelo,
      papel: o.papel,
      latenciaMs,
      tokensEntrada: r.usage?.prompt_tokens,
      tokensSalida: r.usage?.completion_tokens,
      promptResumen: resumir(textoDelPrompt(o.mensajes)),
      respuestaResumen: resumir(texto),
    });
    console.log(
      `[llm] ${conf.nombre}/${modelo} papel=${o.papel} ${latenciaMs} ms · ` +
        `${r.usage?.prompt_tokens ?? "?"}→${r.usage?.completion_tokens ?? "?"} tok · ${texto.length} car`,
    );
    return { texto, latenciaMs, modelo, proveedor: conf.nombre };
  };

  try {
    return await ejecutar();
  } catch (e) {
    if (e instanceof ErrorSinContenido && maxTokens < MAX_TOKENS_POR_DEFECTO * 2) {
      console.warn(`[llm] ${e.message} Reintento con el doble de tokens.`);
      cuerpo.max_completion_tokens = maxTokens * 2;
      try {
        return await ejecutar();
      } catch (e2) {
        anotarError(o.papel, mensajeError(e2));
        throw e2;
      }
    }
    if (estado(e) === 429) {
      const seg = segundosReintento(e) ?? 5;
      console.warn(`[llm] 429 en ${conf.nombre}/${modelo}: espero ${seg} s y reintento una vez`);
      await espera(Math.min(seg, 30) * 1000);
      try {
        return await ejecutar();
      } catch (e2) {
        anotarError(o.papel, mensajeError(e2));
        anotarLlamadaIA({
          proveedor: conf.nombre,
          modelo,
          papel: o.papel,
          latenciaMs: 0,
          promptResumen: resumir(textoDelPrompt(o.mensajes)),
          respuestaResumen: "",
          error: mensajeError(e2),
        });
        throw new Error(
          `Límite de ${conf.nombre === "groq" ? "Groq" : conf.nombre} alcanzado (${modelo}): ` +
            `${mensajeError(e2)}. El plan gratuito permite 30 peticiones/min y 8.000 tokens/min por modelo.`,
        );
      }
    }
    anotarError(o.papel, mensajeError(e));
    anotarLlamadaIA({
      proveedor: conf.nombre,
      modelo,
      papel: o.papel,
      latenciaMs: 0,
      promptResumen: resumir(textoDelPrompt(o.mensajes)),
      respuestaResumen: "",
      error: mensajeError(e),
    });
    throw e;
  }
}

// ---------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------

function extraerJson(texto: string): string {
  const limpio = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const inicio = limpio.indexOf("{");
  const fin = limpio.lastIndexOf("}");
  if (inicio >= 0 && fin > inicio) return limpio.slice(inicio, fin + 1);
  return limpio;
}

/**
 * Pide al modelo una salida que cumpla un esquema zod.
 *
 * 1. Intenta `response_format: json_schema` con `strict: true`.
 * 2. Si el proveedor lo rechaza (400), repite con `json_object` metiendo el
 *    esquema en el system y valida con zod.
 * 3. Si la validación falla, hace UN reintento de reparación pasándole el error.
 *
 * Nunca se combina con `tools` ni con `stream` (Groq no lo permite).
 */
export async function completarJson<T>(p: PeticionJson<T>): Promise<RespuestaLLM<T>> {
  const papel = p.papel ?? "razonamiento";
  const nombre = (p.nombreEsquema ?? "respuesta").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  const esquema = esquemaJson(p.esquema);
  const maxTokens = p.maxTokens ?? MAX_TOKENS_POR_DEFECTO;
  const mensajes = construirMensajes(p.system, p.user, p.imagenes);

  let crudo: ResultadoCrudo;
  try {
    crudo = await llamar({
      papel,
      mensajes,
      maxTokens,
      temperatura: p.temperatura,
      signal: p.signal,
      permitirEnPausa: p.permitirEnPausa,
      prioridad: p.prioridad,
      sinRazonar: p.sinRazonar,
      formato: { type: "json_schema", json_schema: { name: nombre, strict: true, schema: esquema } },
    });
  } catch (e) {
    if (!rechazaEsquema(e)) throw e;
    console.warn(`[llm] el proveedor rechazó json_schema (${mensajeError(e)}); repito con json_object`);
    const systemConEsquema =
      `${p.system ?? ""}\n\nResponde ÚNICAMENTE con un objeto JSON válido que cumpla este JSON Schema, ` +
      `sin texto alrededor ni bloques de código:\n${JSON.stringify(esquema)}`.trim();
    crudo = await llamar({
      papel,
      mensajes: construirMensajes(systemConEsquema, p.user, p.imagenes),
      maxTokens,
      temperatura: p.temperatura,
      signal: p.signal,
      permitirEnPausa: p.permitirEnPausa,
      prioridad: p.prioridad,
      sinRazonar: p.sinRazonar,
      formato: { type: "json_object" },
    });
  }

  const primero = p.esquema.safeParse(seguroJson(crudo.texto));
  if (primero.success) {
    return { datos: primero.data, modelo: crudo.modelo, proveedor: crudo.proveedor, latenciaMs: crudo.latenciaMs };
  }

  // Reintento único de reparación: se le enseña su propia salida y el error.
  console.warn(`[llm] salida no válida para "${nombre}": ${primero.error.message.slice(0, 300)}. Reparando…`);
  const reparacion = await llamar({
    papel,
    mensajes: construirMensajes(
      `Corriges JSON mal formado para que cumpla un esquema. Responde solo con el JSON corregido.`,
      `Este JSON no cumple el esquema.\n\nEsquema:\n${JSON.stringify(esquema)}\n\n` +
        `JSON recibido:\n${crudo.texto.slice(0, 6000)}\n\nErrores de validación:\n${primero.error.message.slice(0, 2000)}`,
      undefined,
    ),
    maxTokens,
    temperatura: 0.1,
    signal: p.signal,
    prioridad: p.prioridad,
    sinRazonar: p.sinRazonar,
    formato: { type: "json_object" },
  });

  const segundo = p.esquema.safeParse(seguroJson(reparacion.texto));
  if (segundo.success) {
    return {
      datos: segundo.data,
      modelo: reparacion.modelo,
      proveedor: reparacion.proveedor,
      latenciaMs: crudo.latenciaMs + reparacion.latenciaMs,
    };
  }
  anotarError(papel, `esquema "${nombre}" no validado tras reparación`);
  throw new Error(
    `El modelo ${reparacion.modelo} no devolvió un JSON válido para "${nombre}" ni tras el reintento de reparación: ` +
      segundo.error.message.slice(0, 300),
  );
}

function seguroJson(texto: string): unknown {
  try {
    return JSON.parse(extraerJson(texto));
  } catch {
    return null;
  }
}

/** Texto libre (markdown de informes y comunicados). */
export async function completarTexto(p: Omit<PeticionJson<unknown>, "esquema">): Promise<RespuestaLLM<string>> {
  const papel = p.papel ?? "razonamiento";
  const crudo = await llamar({
    papel,
    mensajes: construirMensajes(p.system, p.user, p.imagenes),
    maxTokens: p.maxTokens ?? MAX_TOKENS_POR_DEFECTO,
    temperatura: p.temperatura,
    signal: p.signal,
    permitirEnPausa: p.permitirEnPausa,
    prioridad: p.prioridad,
  });
  if (!crudo.texto.trim()) {
    throw new Error(`El modelo ${crudo.modelo} devolvió una respuesta vacía.`);
  }
  return { datos: crudo.texto, modelo: crudo.modelo, proveedor: crudo.proveedor, latenciaMs: crudo.latenciaMs };
}

// ---------------------------------------------------------------------
// Audio: transcripción (STT) y locución (TTS)
// ---------------------------------------------------------------------

export interface TranscripcionAudio {
  texto: string;
  modelo: string;
  proveedor: string;
  latenciaMs: number;
}

const MODELO_STT: Record<NombreProveedor, string> = {
  // HelmCode publica el id exacto "whisper" (verificado en GET /v1/models).
  helmcode: "whisper",
  groq: "whisper-large-v3-turbo",
  openai: "whisper-1",
};

/**
 * Transcribe audio en español (llamadas al 112, partes de campo).
 * `bytes` es el contenido del fichero; `mime` su tipo (audio/mpeg, audio/wav…).
 */
export async function transcribirAudio(
  bytes: ArrayBuffer | Uint8Array,
  mime = "audio/mpeg",
  opciones: { nombreArchivo?: string; idioma?: string; signal?: AbortSignal } = {},
): Promise<TranscripcionAudio> {
  const conf = proveedorDe("rapido");
  const api = cliente(conf);
  const modelo = process.env.LLM_MODELO_TRANSCRIPCION?.trim() || MODELO_STT[conf.nombre];
  const extension = mime.split("/")[1]?.split(";")[0] || "mp3";
  const datos = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const archivo = new File([datos as BlobPart], opciones.nombreArchivo ?? `audio.${extension}`, { type: mime });

  const t0 = Date.now();
  try {
    const r = await api.audio.transcriptions.create(
      { file: archivo, model: modelo, language: opciones.idioma ?? "es", temperature: 0, response_format: "json" },
      { signal: opciones.signal ?? AbortSignal.timeout(TIMEOUT_MS) },
    );
    const latenciaMs = Date.now() - t0;
    anotarLlamadaIA({
      proveedor: conf.nombre,
      modelo,
      papel: "audio",
      latenciaMs,
      promptResumen: `audio ${mime} · ${(datos.byteLength / 1024).toFixed(0)} kB`,
      respuestaResumen: resumir(r.text),
    });
    console.log(`[llm] transcripción ${conf.nombre}/${modelo} ${latenciaMs} ms · ${r.text.length} car`);
    return { texto: r.text, modelo, proveedor: conf.nombre, latenciaMs };
  } catch (e) {
    anotarError("rapido", mensajeError(e));
    anotarLlamadaIA({
      proveedor: conf.nombre,
      modelo,
      papel: "audio",
      latenciaMs: Date.now() - t0,
      promptResumen: `audio ${mime}`,
      respuestaResumen: "",
      error: mensajeError(e),
    });
    throw new Error(`No se pudo transcribir el audio con ${modelo}: ${mensajeError(e)}`);
  }
}

export interface LocucionVoz {
  audio: Uint8Array;
  mime: string;
  modelo: string;
  proveedor: string;
  latenciaMs: number;
}

const MODELO_TTS: Record<NombreProveedor, string | undefined> = {
  // kokoro: 67 voces, < 1 s de latencia, y sí tiene español (Groq solo inglés y árabe).
  helmcode: "kokoro",
  groq: undefined,
  openai: "gpt-4o-mini-tts",
};

/**
 * Genera una locución en español (avisos grabados, guiones de llamada).
 * Devuelve los bytes del audio; el llamador decide si los sirve o los guarda.
 */
export async function sintetizarVoz(
  texto: string,
  opciones: { voz?: string; formato?: "wav" | "mp3" | "opus"; signal?: AbortSignal } = {},
): Promise<LocucionVoz> {
  const conf = proveedorDe("rapido");
  const modelo = process.env.LLM_MODELO_VOZ?.trim() || MODELO_TTS[conf.nombre];
  if (!modelo) {
    throw new Error(
      `El proveedor "${conf.nombre}" no tiene voz en español (Groq solo ofrece inglés y árabe). ` +
        `Usa LLM_PROVEEDOR=helmcode (kokoro) o define LLM_MODELO_VOZ.`,
    );
  }
  const api = cliente(conf);
  const formato = opciones.formato ?? "wav";
  const t0 = Date.now();
  try {
    const r = await api.audio.speech.create(
      { model: modelo, input: texto, voice: opciones.voz ?? process.env.LLM_VOZ?.trim() ?? "alloy", response_format: formato },
      { signal: opciones.signal ?? AbortSignal.timeout(TIMEOUT_MS) },
    );
    const audio = new Uint8Array(await r.arrayBuffer());
    const latenciaMs = Date.now() - t0;
    anotarLlamadaIA({
      proveedor: conf.nombre,
      modelo,
      papel: "audio",
      latenciaMs,
      promptResumen: resumir(texto),
      respuestaResumen: `${(audio.byteLength / 1024).toFixed(0)} kB de audio ${formato}`,
    });
    return { audio, mime: `audio/${formato}`, modelo, proveedor: conf.nombre, latenciaMs };
  } catch (e) {
    anotarError("rapido", mensajeError(e));
    throw new Error(`No se pudo generar la locución con ${modelo}: ${mensajeError(e)}`);
  }
}
