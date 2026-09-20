// =====================================================================
// ATALAYA INCENDIOS · SMS del agente del 112 virtual al teléfono del .env
// ---------------------------------------------------------------------
// Propósito: que el agente de voz que atiende el 112 (workflow «Atalaya · 112
// entrante», lib/happyrobot/entrante.ts) pueda mandar SMS "de avisos y demás" al
// teléfono configurado en TELEFONO_AVISOS_SMS (o, si está vacío, DESTINO_DEMO):
//   · AUTOMÁTICO: cada aviso que registra la herramienta registrar_aviso sale por
//     SMS con lo dictado y el veredicto (POST /api/happyrobot/aviso lo lanza en
//     segundo plano para no retrasar la respuesta al agente).
//   · HERRAMIENTA enviar_sms: texto libre que el agente decide mandar (personas
//     atrapadas, cambio de situación, mensaje que pide la persona) →
//     POST /api/happyrobot/sms → `herramientaEnviarSms`.
// Sale por el workflow «Atalaya · SMS saliente» (HAPPYROBOT_WORKFLOW_SLUG_SMS, nodo
// «Send text» desde el número americano; lo monta `scripts/happyrobot-workflows.mjs
// sms`) a través de `dispararWorkflow("sms")` del cliente. El DESTINO ES SIEMPRE EL
// DEL .env: el agente no elige números. El resultado del workflow vuelve por
// /api/webhooks/happyrobot/resultado; como detrás no hay Decision/Accion, aquí se
// anota por la referencia del run (`anotarResultadoSms`).
// DUEÑO: sesión fireops-00 (2026-09-19). Dependencias: cliente, entrante (solo
// `observacionDeLlamada` y tipos), telefono, estado. NADA SIMULADO: sin teléfono o
// sin workflow, el error lleva el nombre exacto de la variable y queda como evento
// accion_fallida; nunca se finge un envío.
// =====================================================================

import { obtenerEstado } from "../motor/estado";
import { dispararWorkflow, motivoNoDisponible, slugDe } from "./cliente";
import { observacionDeLlamada, type AvisoLlamada, type ResultadoAviso, type TipoAviso } from "./entrante";
import { formatearTelefono } from "./telefono";

export const VARIABLE_TELEFONO_AVISOS = "TELEFONO_AVISOS_SMS";
/** Si TELEFONO_AVISOS_SMS está vacío se usa el móvil de la demo. */
export const VARIABLE_TELEFONO_RESERVA = "DESTINO_DEMO";
/** Mismo tope que aplica el cliente al texto del SMS. */
export const MAX_SMS = 300;
export const PREFIJO_SMS = "ATALAYA 112";
const AGENTE_ID = "centralita";
const MAX_REGISTRO = 200;

const variable = (clave: string): string | undefined => process.env[clave]?.trim() || undefined;
const mensajeDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Teléfono E.164 que recibe los SMS del agente: TELEFONO_AVISOS_SMS > DESTINO_DEMO. */
export const telefonoAvisos = (): string | undefined => variable(VARIABLE_TELEFONO_AVISOS) ?? variable(VARIABLE_TELEFONO_RESERVA);

/** Mismo formato que el acta del ejecutor: "+34600111222" → "+346***22". */
export function enmascarar(destino: string): string {
  const v = destino.trim();
  return v.length <= 5 ? "***" : `${v.slice(0, 4)}***${v.slice(-2)}`;
}

export interface EstadoSmsAvisos {
  ok: boolean;
  /** Texto listo para la barra de servicios ("HappyRobot: el 112 no puede mandar SMS · Falta …"). */
  detalle: string;
  variable: string;
  /** Teléfono completo (solo para uso interno del servidor). */
  destino?: string;
  destinoEnmascarado?: string;
  slug?: string;
}

/** Qué le falta al canal, con el nombre EXACTO de la variable. */
export function estadoSmsAvisos(): EstadoSmsAvisos {
  const destino = telefonoAvisos();
  const slug = slugDe("sms");
  const base = { variable: VARIABLE_TELEFONO_AVISOS, destino, destinoEnmascarado: destino ? enmascarar(destino) : undefined, slug };
  const motivo = motivoNoDisponible("sms");
  if (motivo) return { ok: false, detalle: `HappyRobot: el 112 no puede mandar SMS · ${motivo} (ejecuta scripts/happyrobot-workflows.mjs sms)`, ...base };
  if (!destino) return { ok: false, detalle: `HappyRobot: el 112 no puede mandar SMS · Falta ${VARIABLE_TELEFONO_AVISOS} (o ${VARIABLE_TELEFONO_RESERVA})`, ...base };
  if (!/^\+\d{7,15}$/.test(destino.replace(/[\s().-]/g, ""))) {
    return { ok: false, detalle: `HappyRobot: el 112 no puede mandar SMS · ${VARIABLE_TELEFONO_AVISOS} debe ser un teléfono E.164 (+34…), no "${destino}"`, ...base };
  }
  return { ok: true, detalle: `SMS del 112 → ${formatearTelefono(destino)} (workflow ${slug})`, ...base };
}

// ---------------------------------------------------------------------
// Texto de los SMS (≤ 300 caracteres, una sola línea)
// ---------------------------------------------------------------------

/** Una línea, sin dobles espacios; si pasa del tope se corta con "...". */
export function recortarSms(t: string, max = MAX_SMS): string {
  const limpio = t.replace(/\s+/g, " ").trim();
  return limpio.length <= max ? limpio : `${limpio.slice(0, max - 3).trimEnd()}...`;
}

export const horaMadrid = (d: Date = new Date()): string => new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }).format(d);

const TIPO_CORTO: Record<TipoAviso, string> = { humo: "Humo", llamas: "Llamas", ambos: "Humo y llamas", olor: "Olor a quemado", otro: "Posible incendio" };

/** El veredicto del verificador en una frase corta, solo hechos del estado. */
export function veredictoCorto(r: Pick<ResultadoAviso, "impacto" | "foco" | "enAnalisis" | "geolocalizada">): string {
  switch (r.impacto) {
    case "nuevo_foco":
      return `Foco nuevo declarado: ${r.foco?.nombre ?? "sin nombre"}${r.foco ? ` (${r.foco.estado}, confianza ${Math.round(r.foco.confianza * 100)}%)` : ""}.`;
    case "confirma":
    case "agrava":
      return `Confirma foco conocido${r.foco?.nombre ? `: ${r.foco.nombre}` : ""}.`;
    case "duplicada":
      return "Duplica un aviso reciente de la zona.";
    case "ruido":
      return "Sin incendio conocido en la zona; queda anotado.";
    default:
      if (r.enAnalisis) return "Situando el lugar; pendiente de verificar.";
      return r.geolocalizada ? "Pendiente de verificar." : "Sin localizar en el mapa; pendiente de verificar.";
  }
}

export interface ContextoSmsAviso {
  /** true si es la segunda llamada a registrar_aviso en la misma conversación (amplía el aviso). */
  ampliacion?: boolean;
  ahora?: Date;
}

/**
 * RGPD (minimización, petición de Javi del 19-09): un SMS NUNCA lleva datos de quien
 * llama. Ni su número, ni sus palabras literales (pueden contener nombres, direcciones
 * de su casa u otros teléfonos). Si alguien necesita el contacto, está en la ficha del
 * aviso en la sala (`Ref obs-…`), con acceso controlado. Además, cualquier secuencia
 * con forma de teléfono o de correo que llegue en el texto se tacha antes de enviar.
 */
const TELEFONO_EN_TEXTO = /\+?\d(?:[\s-]?\d){8,}/g;
const CORREO_EN_TEXTO = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/** Tacha teléfonos (9 cifras o más, con espacios o guiones) y correos de un texto que va a salir por SMS. */
export function anonimizarSms(texto: string): string {
  return texto.replace(CORREO_EN_TEXTO, "[correo oculto]").replace(TELEFONO_EN_TEXTO, "[tel. oculto]");
}

/**
 * SMS automático del aviso registrado: dónde, riesgo, veredicto y referencia. Sin
 * datos de quien llama (ni número ni cita literal): ver `anonimizarSms`.
 */
export function textoSmsAviso(a: AvisoLlamada, r: ResultadoAviso, ctx: ContextoSmsAviso = {}): string {
  const donde = [a.lugar, a.municipio].filter(Boolean).join(", ") || "lugar sin precisar";
  const partes = [`${PREFIJO_SMS} ${horaMadrid(ctx.ahora)}${ctx.ampliacion ? " (ampliacion)" : ""}: ${TIPO_CORTO[a.tipo ?? "otro"]} en ${donde}.`];
  if (a.personasEnRiesgo) partes.push("PERSONAS EN RIESGO.");
  if (a.viviendasCerca) partes.push("Viviendas cerca.");
  if (a.tamano) partes.push(`Tamano: ${a.tamano}.`);
  partes.push(veredictoCorto(r));
  partes.push(`Ref ${r.observacionId}.`);
  return anonimizarSms(recortarSms(partes.join(" ")));
}

/**
 * SMS de la herramienta enviar_sms: el texto del agente con cabecera. SIN el número de
 * quien llama (RGPD); `telefonoLlamante` se acepta por compatibilidad y no se usa.
 */
export function textoSmsAgente(texto: string, ctx: { telefonoLlamante?: string; ahora?: Date } = {}): string {
  return anonimizarSms(recortarSms(`${PREFIJO_SMS} ${horaMadrid(ctx.ahora)} (agente): ${texto.trim()}`));
}

// ---------------------------------------------------------------------
// Envío y registro
// ---------------------------------------------------------------------

export type OrigenSms = "aviso_registrado" | "herramienta_enviar_sms";

export interface PeticionSmsAgente {
  /** Texto FINAL del SMS (ya con cabecera); se recorta a MAX_SMS. */
  texto: string;
  origen: OrigenSms;
  motivo?: string;
  /** Run de HappyRobot de la llamada (identifica la conversación). */
  runId?: string;
  observacionId?: string;
  incendioId?: string;
}

export interface RegistroSms {
  /** Run del workflow de SMS en HappyRobot (lo que devuelve el webhook como `ref`). */
  referencia: string;
  en: string;
  /** Destino enmascarado. */
  destino: string;
  texto: string;
  origen: OrigenSms;
  motivo?: string;
  runId?: string;
  observacionId?: string;
  incendioId?: string;
  urlRun?: string;
  resultado?: { en: string; ok: boolean; resumen: string };
}

const CLAVE_GLOBAL = "__atalayaSmsAgente";

/** Registro en memoria de los SMS del agente (sobrevive a la recarga en caliente de Next, como el Estado). */
function registro(): Map<string, RegistroSms> {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!(g[CLAVE_GLOBAL] instanceof Map)) g[CLAVE_GLOBAL] = new Map<string, RegistroSms>();
  return g[CLAVE_GLOBAL] as Map<string, RegistroSms>;
}

export const smsDelAgente = (referencia: string): RegistroSms | undefined => registro().get(referencia);

/** Los últimos SMS del agente, el más reciente primero. */
export function smsRecientes(limite = 20): RegistroSms[] {
  return [...registro().values()].reverse().slice(0, limite);
}

/**
 * Manda un SMS al teléfono del .env por el workflow de SMS de HappyRobot. Es la
 * única puerta de salida de los SMS del agente: si falta configuración lanza con
 * el nombre de la variable y deja un evento accion_fallida; si sale, deja un
 * evento accion_ejecutada con la auditoría del envío (payload sin secretos,
 * respuesta cruda, duración) y lo apunta en el registro por referencia del run.
 */
export async function enviarSmsAgente(p: PeticionSmsAgente): Promise<RegistroSms> {
  const estado = obtenerEstado();
  // Última barrera RGPD: aunque el texto venga de otro sitio, no sale ningún teléfono ni correo.
  const texto = anonimizarSms(recortarSms(p.texto));
  const situacion = estadoSmsAvisos();
  const destinoVisible = situacion.destinoEnmascarado ?? "(sin teléfono)";
  const datosBase = { canal: "sms", origen: p.origen, motivo: p.motivo, texto, runLlamada: p.runId, observacionId: p.observacionId, destino: destinoVisible };
  const fallar = (motivo: string): never => {
    estado.registrarEvento("accion_fallida", `112 virtual: SMS no enviado a ${destinoVisible}: ${motivo}`, { agenteId: AGENTE_ID, incendioId: p.incendioId, nivel: "aviso", datos: { ...datosBase, error: motivo } });
    throw new Error(motivo);
  };
  if (!texto) return fallar("El SMS no tiene texto");
  if (!situacion.ok || !situacion.destino) return fallar(situacion.detalle.replace(/^HappyRobot: el 112 no puede mandar SMS · /, ""));
  const destino = situacion.destino;

  let envio;
  try {
    envio = await dispararWorkflow("sms", {
      telefono: destino,
      phone_number: destino,
      destino,
      texto,
      mensaje: texto,
      motivo: p.motivo ?? "",
      origen: p.origen,
      runLlamada: p.runId ?? "",
      observacionId: p.observacionId ?? "",
      incendioId: p.incendioId ?? "",
      organismo: variable("ORGANISMO_NOMBRE") ?? "Centro de Coordinación de Incendios Forestales",
      decisionId: "",
      accionId: "",
    });
  } catch (e) {
    return fallar(mensajeDe(e));
  }

  const r: RegistroSms = {
    referencia: envio.referencia,
    en: new Date().toISOString(),
    destino: enmascarar(destino),
    texto,
    origen: p.origen,
    motivo: p.motivo,
    runId: p.runId,
    observacionId: p.observacionId,
    incendioId: p.incendioId,
    urlRun: envio.url,
  };
  const reg = registro();
  reg.set(r.referencia, r);
  while (reg.size > MAX_REGISTRO) reg.delete(reg.keys().next().value as string);

  estado.registrarEvento(
    "accion_ejecutada",
    `112 virtual: SMS ${p.origen === "aviso_registrado" ? "del aviso" : "del agente"} enviado a ${r.destino} (run ${r.referencia}).`,
    {
      agenteId: AGENTE_ID,
      incendioId: p.incendioId,
      nivel: p.motivo === "personas_en_riesgo" ? "aviso" : "info",
      datos: { ...datosBase, destino: r.destino, referencia: r.referencia, urlRun: envio.url, peticion: envio.peticion, respuesta: envio.respuesta, urlPeticion: envio.urlPeticion, duracionMs: envio.duracionMs },
    },
  );
  return r;
}

/**
 * Resultado que devuelve el workflow de SMS (webhook /resultado) para un SMS del
 * agente: lo anota en el registro y deja evento. `undefined` si la referencia no
 * es de un SMS del agente (entonces el webhook sigue su camino normal).
 */
export function anotarResultadoSms(referencia: string, cuerpo: Record<string, unknown>, ok: boolean, resumen: string): RegistroSms | undefined {
  const r = registro().get(referencia);
  if (!r) return undefined;
  r.resultado = { en: new Date().toISOString(), ok, resumen };
  obtenerEstado().registrarEvento(ok ? "accion_ejecutada" : "accion_fallida", `112 virtual: resultado del SMS a ${r.destino}: ${resumen}`, {
    agenteId: AGENTE_ID,
    incendioId: r.incendioId,
    nivel: ok ? "info" : "aviso",
    datos: { canal: "sms", origen: r.origen, referencia, runLlamada: r.runId, observacionId: r.observacionId, webhook: JSON.stringify(cuerpo).slice(0, 2048) },
  });
  return r;
}

/**
 * SMS automático del aviso que acaba de registrar la herramienta registrar_aviso.
 * Lo lanza la ruta en segundo plano: NUNCA lanza (el fallo ya queda como evento).
 */
export async function enviarSmsAvisoRegistrado(a: AvisoLlamada, r: ResultadoAviso, ctx: ContextoSmsAviso = {}): Promise<RegistroSms | undefined> {
  try {
    return await enviarSmsAgente({
      texto: textoSmsAviso(a, r, ctx),
      origen: "aviso_registrado",
      motivo: a.personasEnRiesgo ? "personas_en_riesgo" : ctx.ampliacion ? "ampliacion_aviso" : "aviso_registrado",
      runId: a.runId,
      observacionId: r.observacionId,
      incendioId: r.foco?.id,
    });
  } catch (e) {
    console.warn("[112 entrante] SMS del aviso no enviado:", mensajeDe(e));
    return undefined;
  }
}

// ---------------------------------------------------------------------
// Herramienta enviar_sms del agente (POST /api/happyrobot/sms)
// ---------------------------------------------------------------------

export interface PeticionSmsHerramienta {
  texto: string;
  motivo?: string;
  runId?: string;
  telefonoLlamante?: string;
}

/**
 * Respuesta de la herramienta. SIEMPRE con las cinco claves (null cuando no aplican): la
 * plataforma solo deja ver al agente los campos que aparecen en la respuesta de prueba
 * (hallazgo de fireops-82, 19-09), y la ruta contesta 200 también a esa prueba.
 */
export interface RespuestaHerramientaSms {
  enviado: boolean;
  referencia: string | null;
  /** Destino enmascarado. */
  destino: string | null;
  error: string | null;
  /** Lo que el agente le dice a la persona, tal cual. */
  mensajeParaLocutor: string;
}

/** Respuesta cuando el cuerpo no trae texto (también a la prueba de nodo de la plataforma, que manda las variables sin resolver). */
export function respuestaHerramientaSinDatos(error: string): RespuestaHerramientaSms {
  return { enviado: false, referencia: null, destino: null, error, mensajeParaLocutor: "No he podido mandar el SMS: no tengo texto que enviar." };
}

/** Primer valor con contenido; descarta variables sin resolver de HappyRobot ("{{$var:…}}"). */
function primero(c: Record<string, unknown>, claves: string[]): string | undefined {
  for (const k of claves) {
    const v = c[k];
    if (typeof v === "string" && v.trim() && !/^\{\{\$var:/.test(v.trim()) && !["null", "undefined"].includes(v.trim().toLowerCase())) return v.trim();
  }
  return undefined;
}

/** Lee el cuerpo que manda el nodo Webhook de la herramienta (nombres en snake_case) de forma tolerante. */
export function smsDesdeCuerpo(c: Record<string, unknown>): { peticion: PeticionSmsHerramienta; error?: undefined } | { peticion?: undefined; error: string } {
  const texto = primero(c, ["texto", "mensaje", "sms", "body", "message"]);
  if (!texto) return { error: "El SMS no trae texto (texto)" };
  return {
    peticion: {
      texto,
      motivo: primero(c, ["motivo", "razon", "reason"]),
      runId: primero(c, ["run_id", "runId", "referencia_externa", "referenciaExterna"]),
      telefonoLlamante: primero(c, ["telefono_llamante", "from", "caller", "caller_number"]),
    },
  };
}

/** La herramienta: manda el texto del agente al teléfono del .env y le dice qué contar a la persona. */
export async function herramientaEnviarSms(p: PeticionSmsHerramienta): Promise<RespuestaHerramientaSms> {
  const obs = p.runId ? observacionDeLlamada(obtenerEstado(), p.runId) : undefined;
  try {
    const r = await enviarSmsAgente({
      texto: textoSmsAgente(p.texto, { telefonoLlamante: p.telefonoLlamante }),
      origen: "herramienta_enviar_sms",
      motivo: p.motivo,
      runId: p.runId,
      observacionId: obs?.id,
      incendioId: obs?.incendioId,
    });
    return { enviado: true, referencia: r.referencia, destino: r.destino, error: null, mensajeParaLocutor: "Ya lo he pasado por SMS a la sala de coordinación." };
  } catch (e) {
    return { enviado: false, referencia: null, destino: null, error: mensajeDe(e), mensajeParaLocutor: "No he podido mandar el SMS a la sala, pero el aviso queda registrado y la sala lo tiene en pantalla." };
  }
}
