// =====================================================================
// ATALAYA INCENDIOS · Cliente de HappyRobot (instancia EU)
// ---------------------------------------------------------------------
// Propósito: disparar los workflows de voz, SMS y email de la plataforma
// del reto y verificar los webhooks que devuelven el resultado.
// DUEÑO: constructor D. Dependencias externas: HappyRobot API v2.
//
// Contrato verificado (ver docs/HAPPYROBOT.md y la referencia
// ../crisis-mando-ai/lib/server/conectores/happyrobot.ts):
//
//   POST {HAPPYROBOT_API_BASE}/api/v2/workflows/{slug}/runs?environment=production
//   Authorization: Bearer sk_live_…
//   { "payload": { … } }        cada clave llega al workflow como @clave
//
//   GET  {HAPPYROBOT_API_BASE}/api/v2/workflows        (lista, con slug y
//        latest_version.is_published) → la usa /api/happyrobot/salud.
//
// La organización del reto está en la instancia EUROPEA
// (https://platform.eu.happyrobot.ai). La global responde 401 con la misma clave.
//
// NADA SIMULADO: si falta el slug del workflow o la clave, estas funciones
// lanzan un error con el nombre EXACTO de la variable que falta, y la
// pantalla lo enseña en rojo ("HappyRobot: falta el workflow de voz").
// =====================================================================

import { urlPublica } from "../motor/entorno";

export type CanalHappyRobot = "voz" | "sms" | "email";

export interface PeticionLlamada {
  telefono: string;
  guion: string;
  contexto: Record<string, unknown>;
  decisionId: string;
  accionId: string;
  incendioId?: string;
}

export interface PeticionMensaje {
  destino: string;
  texto: string;
  asunto?: string;
  contexto: Record<string, unknown>;
  decisionId: string;
  accionId: string;
  incendioId?: string;
}

export interface ResultadoEnvio {
  referencia: string;
  proveedor: "HappyRobot";
  url?: string;
  datos?: Record<string, unknown>;
  /** AUDITORÍA: payload enviado, SIN el secreto del webhook ni la clave de API. */
  peticion?: Record<string, unknown>;
  /** AUDITORÍA: respuesta cruda de la plataforma, recortada a 2 KB. */
  respuesta?: string;
  /** AUDITORÍA: milisegundos que tardó la llamada HTTP. */
  duracionMs?: number;
  /** AUDITORÍA: URL exacta a la que se disparó el workflow. */
  urlPeticion?: string;
}

export interface WorkflowHappyRobot {
  id?: string;
  slug: string;
  nombre: string;
  publicado: boolean;
  entorno?: string;
  /** true si es uno de los slugs que Atalaya tiene configurados ("entrante" = el 112 virtual por teléfono, lib/happyrobot/entrante.ts). */
  usadoPorAtalaya?: CanalHappyRobot | "entrante";
}

const TIMEOUT_MS = 20_000;

const variable = (clave: string): string | undefined => process.env[clave]?.trim() || undefined;

/** Base de la API sin barra final. */
export const apiBase = (): string => (variable("HAPPYROBOT_API_BASE") ?? "https://platform.eu.happyrobot.ai").replace(/\/+$/, "");
export const entorno = (): string => variable("HAPPYROBOT_ENVIRONMENT") ?? "production";

/** Nombre de la variable de entorno con el slug de cada canal. */
export const VARIABLE_SLUG: Record<CanalHappyRobot, string> = {
  voz: "HAPPYROBOT_WORKFLOW_SLUG_VOZ",
  sms: "HAPPYROBOT_WORKFLOW_SLUG_SMS",
  email: "HAPPYROBOT_WORKFLOW_SLUG_EMAIL",
};

const NOMBRE_CANAL: Record<CanalHappyRobot, string> = { voz: "voz", sms: "SMS", email: "email" };

export const slugDe = (canal: CanalHappyRobot): string | undefined => variable(VARIABLE_SLUG[canal]);

/** ¿Se puede usar este canal ahora mismo? (clave + slug configurados). */
export function happyrobotDisponible(canal: CanalHappyRobot): boolean {
  return Boolean(variable("HAPPYROBOT_API_KEY") && slugDe(canal));
}

/**
 * Motivo por el que un canal NO está disponible, con el nombre exacto de la
 * variable que falta. `undefined` si está listo. La UI lo enseña tal cual.
 */
export function motivoNoDisponible(canal: CanalHappyRobot): string | undefined {
  if (!variable("HAPPYROBOT_API_KEY")) return "Falta HAPPYROBOT_API_KEY";
  if (!slugDe(canal)) return `Falta ${VARIABLE_SLUG[canal]}`;
  return undefined;
}

/** Frase para la pantalla: "HappyRobot: falta el workflow de voz". */
export function estadoCanal(canal: CanalHappyRobot): { ok: boolean; detalle: string } {
  const motivo = motivoNoDisponible(canal);
  if (!motivo) return { ok: true, detalle: `Workflow de ${NOMBRE_CANAL[canal]} configurado (${slugDe(canal)})` };
  return { ok: false, detalle: `HappyRobot: falta el workflow de ${NOMBRE_CANAL[canal]} · ${motivo}` };
}

/**
 * URL pública a la que HappyRobot debe devolver el resultado. La resuelve
 * `urlPublica()` del núcleo (túnel de Cloudflare > PUBLIC_BASE_URL). Una URL
 * de localhost no sirve: HappyRobot no puede alcanzarla, así que no se manda.
 */
export function urlWebhookResultado(): string | undefined {
  const base = urlPublica();
  if (!base || base.startsWith("http://localhost") || base.startsWith("http://127.")) return undefined;
  return `${base}/api/webhooks/happyrobot/resultado`;
}

/** URL del workflow entrante "Web Call" para el botón "Llamar al 112 virtual". */
export const urlLlamadaWeb = (): string | undefined => variable("HAPPYROBOT_WEB_CALL_URL");

export const secretoWebhook = (): string | undefined => variable("HAPPYROBOT_WEBHOOK_SECRET");

/** Verifica la cabecera `x-webhook-secret` de un webhook entrante. */
export function verificarWebhook(cabeceras: Headers): boolean {
  const esperado = secretoWebhook();
  if (!esperado) return false;
  const recibido = cabeceras.get("x-webhook-secret") ?? cabeceras.get("X-Webhook-Secret");
  return typeof recibido === "string" && recibido.trim() === esperado;
}

function cabeceras(): Record<string, string> {
  const clave = variable("HAPPYROBOT_API_KEY");
  const h: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (clave) {
    h.authorization = `Bearer ${clave}`;
    // Cubre el modo "Enhanced Security" del Webhook trigger, que usa x-api-key.
    h["x-api-key"] = clave;
  }
  return h;
}

/** Extrae el identificador del run de la respuesta, sea cual sea su forma. */
function referenciaDe(cuerpo: string): { referencia: string; datos?: Record<string, unknown> } {
  try {
    const j = JSON.parse(cuerpo) as Record<string, unknown> & { data?: Record<string, unknown> };
    const candidatos = [j.id, j.run_id, j.runId, j.call_id, j.session_id, j.data?.id, j.data?.run_id];
    const ref = candidatos.find((c) => typeof c === "string" && c) as string | undefined;
    return { referencia: ref ?? `hr-${Date.now().toString(36)}`, datos: j };
  } catch {
    return { referencia: `hr-${Date.now().toString(36)}` };
  }
}

/** URL de la ejecución en la plataforma (para que el humano la abra desde la sala). */
function urlDelRun(slug: string, referencia: string): string {
  return `${apiBase()}/workflows/${encodeURIComponent(slug)}/runs/${encodeURIComponent(referencia)}`;
}

/**
 * Dispara un workflow. Es la única puerta de salida hacia HappyRobot: si
 * falta configuración lanza con el nombre de la variable; si la API responde
 * mal, lanza con el código y el cuerpo recortado. Nunca devuelve un éxito falso.
 */
export async function dispararWorkflow(canal: CanalHappyRobot, payload: Record<string, unknown>, signal?: AbortSignal): Promise<ResultadoEnvio> {
  const motivo = motivoNoDisponible(canal);
  if (motivo) throw new Error(motivo);
  const slug = slugDe(canal) as string;
  const url = `${apiBase()}/api/v2/workflows/${encodeURIComponent(slug)}/runs?environment=${encodeURIComponent(entorno())}`;

  const cuerpoEnviado = {
    payload: {
      canal,
      ...payload,
      webhook_url: urlWebhookResultado(),
      secreto: secretoWebhook(),
    },
  };

  // Copia del payload para el acta: sin el secreto del webhook (nunca se audita un secreto).
  const { secreto: _secreto, ...payloadAuditable } = cuerpoEnviado.payload as Record<string, unknown>;
  void _secreto;

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: cabeceras(),
      body: JSON.stringify(cuerpoEnviado),
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`HappyRobot no responde en ${canal} tras ${Date.now() - t0} ms: ${e instanceof Error ? e.message : String(e)}`);
  }
  const texto = await res.text();
  const duracionMs = Date.now() - t0;
  if (!res.ok) throw new Error(`HappyRobot ${res.status} en ${canal}: ${texto.slice(0, 220)}`);
  const { referencia, datos } = referenciaDe(texto);
  return {
    referencia,
    proveedor: "HappyRobot",
    url: urlDelRun(slug, referencia),
    datos,
    peticion: payloadAuditable,
    respuesta: texto.slice(0, 2048),
    duracionMs,
    urlPeticion: url,
  };
}

/**
 * Llamada de voz saliente: el agente lee el guion y recoge la respuesta.
 * DESACTIVADA en el ejecutor desde el 19-09-2026 (SIP 403: el troncal no llama a España); se
 * conserva por si los organizadores habilitan el destino. Ver VOZ_DESACTIVADA en el ejecutor.
 */
export async function llamar(p: PeticionLlamada): Promise<ResultadoEnvio> {
  if (!p.telefono) throw new Error("Falta el teléfono de destino (¿DESTINO_DEMO sin valor?)");
  return dispararWorkflow("voz", {
    telefono: p.telefono,
    phone_number: p.telefono,
    destino: p.telefono,
    guion: p.guion,
    mensaje: p.guion,
    decisionId: p.decisionId,
    accionId: p.accionId,
    incendioId: p.incendioId,
    ...p.contexto,
  });
}

/** SMS saliente (número americano de la plataforma; destino en E.164). */
export async function enviarSms(p: PeticionMensaje): Promise<ResultadoEnvio> {
  if (!p.destino) throw new Error("Falta el teléfono de destino (¿DESTINO_DEMO sin valor?)");
  return dispararWorkflow("sms", {
    telefono: p.destino,
    phone_number: p.destino,
    destino: p.destino,
    texto: p.texto.slice(0, 300),
    mensaje: p.texto.slice(0, 300),
    decisionId: p.decisionId,
    accionId: p.accionId,
    incendioId: p.incendioId,
    ...p.contexto,
  });
}

/** Email saliente (parte formal a organismos). */
export async function enviarEmail(p: PeticionMensaje): Promise<ResultadoEnvio> {
  if (!p.destino) throw new Error("Falta el correo de destino (¿EMAIL_DEMO sin valor?)");
  return dispararWorkflow("email", {
    destino: p.destino,
    email: p.destino,
    asunto: p.asunto ?? "Atalaya · comunicación operativa",
    subject: p.asunto ?? "Atalaya · comunicación operativa",
    texto: p.texto,
    mensaje: p.texto,
    cuerpo: p.texto,
    decisionId: p.decisionId,
    accionId: p.accionId,
    incendioId: p.incendioId,
    ...p.contexto,
  });
}

interface WorkflowApi {
  id?: string;
  slug?: string;
  name?: string;
  title?: string;
  latest_version?: { is_published?: boolean; is_live?: boolean; environment?: string };
}

/**
 * Lista los workflows de la organización (para la pantalla de salud).
 * Una sola petición; si la API falla, lanza con el código real.
 */
export async function listarWorkflows(signal?: AbortSignal): Promise<WorkflowHappyRobot[]> {
  if (!variable("HAPPYROBOT_API_KEY")) throw new Error("Falta HAPPYROBOT_API_KEY");
  const url = `${apiBase()}/api/v2/workflows`;
  const res = await fetch(url, { headers: cabeceras(), cache: "no-store", signal: signal ?? AbortSignal.timeout(TIMEOUT_MS) });
  const texto = await res.text();
  if (!res.ok) throw new Error(`HappyRobot ${res.status} al listar workflows: ${texto.slice(0, 220)}`);
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw new Error(`HappyRobot devolvió algo que no es JSON al listar workflows: ${texto.slice(0, 120)}`);
  }
  const lista: WorkflowApi[] = Array.isArray(bruto)
    ? (bruto as WorkflowApi[])
    : ((bruto as { data?: WorkflowApi[]; workflows?: WorkflowApi[]; items?: WorkflowApi[] }).data ??
       (bruto as { workflows?: WorkflowApi[] }).workflows ??
       (bruto as { items?: WorkflowApi[] }).items ??
       []);

  const porCanal = new Map<string, CanalHappyRobot | "entrante">();
  for (const canal of ["voz", "sms", "email"] as CanalHappyRobot[]) {
    const s = slugDe(canal);
    if (s) porCanal.set(s, canal);
  }
  // Workflow del 112 entrante (llamada AL número de HappyRobot): lib/happyrobot/entrante.ts.
  const entrante = variable("HAPPYROBOT_WORKFLOW_SLUG_ENTRANTE");
  if (entrante) porCanal.set(entrante, "entrante");

  return lista.map((w) => ({
    id: w.id,
    slug: w.slug ?? "",
    nombre: w.name ?? w.title ?? w.slug ?? "(sin nombre)",
    publicado: Boolean(w.latest_version?.is_published),
    entorno: w.latest_version?.environment,
    usadoPorAtalaya: w.slug ? porCanal.get(w.slug) : undefined,
  }));
}
