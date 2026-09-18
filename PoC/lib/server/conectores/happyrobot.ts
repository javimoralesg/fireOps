// Conector HappyRobot (plataforma del reto): dispara workflows (llamada de voz,
// SMS, email) y recibe resultados por webhook. DUEÑO: poc-b5 (integración real).
// ejecutor.ts solo llama a happyrobotDisponible() y dispararHappyRobot().

import type { AccionPlan, TarjetaDecision } from "../../types";
import type { CanalAccion, Decision, ResultadoAccion } from "../../tipos-sistema";
import { urlPublica } from "../perifericos/registro";

const env = (k: string) => process.env[k]?.trim() || undefined;

/**
 * Hay HappyRobot si existe al menos una URL de trigger. La API key solo hace falta
 * cuando el "Webhook trigger" del workflow tiene activada "Enhanced Security"
 * (entonces exige la cabecera x-api-key); sin ella el trigger acepta el POST tal cual.
 */
export function happyrobotDisponible(): boolean {
  return Boolean(
    env("HAPPYROBOT_TRIGGER_URL") ||
      env("HAPPYROBOT_TRIGGER_URL_VOZ") ||
      env("HAPPYROBOT_TRIGGER_URL_SMS") ||
      env("HAPPYROBOT_TRIGGER_URL_EMAIL") ||
      env("HAPPYROBOT_TRIGGER_URL_TICKET"),
  );
}

/** URL del workflow a disparar según canal (permite un trigger por canal si la plataforma lo requiere). */
function triggerUrl(canal: CanalAccion): string | undefined {
  const porCanal: Record<string, string | undefined> = {
    voz: env("HAPPYROBOT_TRIGGER_URL_VOZ"),
    sms: env("HAPPYROBOT_TRIGGER_URL_SMS"),
    email: env("HAPPYROBOT_TRIGGER_URL_EMAIL"),
    ticket: env("HAPPYROBOT_TRIGGER_URL_TICKET"),
  };
  return porCanal[canal] ?? env("HAPPYROBOT_TRIGGER_URL");
}

/**
 * URL a la que HappyRobot debe devolver el resultado. Túnel único compartido con poc-07:
 * data/url-publica.txt (la escribe scripts/tunel.sh) > PUBLIC_BASE_URL. Una IP de LAN no sirve
 * porque HappyRobot no puede alcanzarla, así que en ese caso no se envía callback.
 */
async function callbackUrl(): Promise<string | undefined> {
  const pub = await urlPublica();
  if (pub.origen === "lan") return undefined;
  return `${pub.url}/api/webhooks/happyrobot/resultado`;
}

/** Cabeceras del trigger: x-api-key es la que entiende HappyRobot; Bearer se mantiene por compatibilidad. */
function cabecerasTrigger(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  const key = env("HAPPYROBOT_API_KEY");
  if (key) {
    h["x-api-key"] = key;
    h.authorization = `Bearer ${key}`;
  }
  return h;
}

/**
 * Dispara un workflow de HappyRobot. Payload genérico hasta conocer el contrato real;
 * el resultado de la conversación debe volver a POST /api/webhooks/happyrobot/resultado
 * con { decisionId, accionId, ref, ok, detalle, canal }.
 */
export async function dispararHappyRobot(canal: CanalAccion, a: AccionPlan, t: TarjetaDecision, d: Decision): Promise<ResultadoAccion> {
  const url = triggerUrl(canal);
  if (!url) {
    return { accionId: a.id, canal, proveedor: "HappyRobot", ref: "-", ok: false, detalle: `Sin URL de trigger HappyRobot para el canal ${canal}`, timestamp: new Date().toISOString() };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: cabecerasTrigger(),
    body: JSON.stringify({
      canal,
      destino: env("DESTINO_DEMO"),
      decisionId: d.id,
      accionId: a.id,
      recurso: a.recurso,
      instruccion: a.accion,
      mensaje: t.plan.mensajeAlerta,
      resumenIncidente: t.resumen,
      callbackUrl: await callbackUrl(),
      secreto: env("HAPPYROBOT_WEBHOOK_SECRET"),
    }),
    signal: AbortSignal.timeout(15000),
  });
  const cuerpo = await res.text();
  let ref = `hr-${Date.now()}`;
  try {
    const j = JSON.parse(cuerpo);
    ref = j.id ?? j.run_id ?? j.call_id ?? j.session_id ?? ref;
  } catch {
    /* respuesta no JSON */
  }
  return {
    accionId: a.id,
    canal,
    proveedor: "HappyRobot",
    ref,
    ok: res.ok,
    detalle: res.ok ? `Workflow disparado en HappyRobot (${res.status})` : `HappyRobot ${res.status}: ${cuerpo.slice(0, 200)}`,
    timestamp: new Date().toISOString(),
  };
}
