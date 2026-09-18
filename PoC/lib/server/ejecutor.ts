// Ejecución de acciones fuera del sistema. Orden de preferencia:
//   1. HappyRobot (plataforma del reto): ver conectores/happyrobot.ts (dueño poc-b5)
//   2. Twilio (SMS + llamada de voz) si hay credenciales
//   Sin canal configurado NO se finge nada: la acción queda ok=false, proveedor
//   "Ninguno", y el mando lo ve. Las órdenes internas se registran en el
//   cuaderno de mando (proveedor "Cuaderno"), que es un registro real.

import type { AccionPlan, TarjetaDecision } from "../types";
import type { CanalAccion, Decision, ResultadoAccion } from "../tipos-sistema";
import { dispararHappyRobot, happyrobotDisponible } from "./conectores/happyrobot";

const env = (k: string) => process.env[k]?.trim() || undefined;

export type ProveedorEjecucion = "HappyRobot" | "Twilio" | "Ninguno";

export function twilioDisponible(): boolean {
  return Boolean(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_FROM"));
}

export function proveedorDisponible(): ProveedorEjecucion {
  if (happyrobotDisponible()) return "HappyRobot";
  if (twilioDisponible()) return "Twilio";
  return "Ninguno";
}

function canalPara(a: AccionPlan): CanalAccion {
  const t = `${a.recurso} ${a.accion}`.toLowerCase();
  if (/llamad|hospital|residencia|confirmar/.test(t)) return "voz";
  if (/sms|aviso|alerta|vecin|poblaci/.test(t)) return "sms";
  if (/email|correo|prensa|comunicado/.test(t)) return "email";
  if (/ticket|limpieza|movilidad|emt|mantenimiento/.test(t)) return "ticket";
  return "interno";
}

async function twilio(canal: CanalAccion, a: AccionPlan, t: TarjetaDecision): Promise<ResultadoAccion> {
  const sid = env("TWILIO_ACCOUNT_SID")!;
  const auth = Buffer.from(`${sid}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64");
  const to = env("DESTINO_DEMO");
  if (!to) return { accionId: a.id, canal, proveedor: "Twilio", ref: "-", ok: false, detalle: "Falta DESTINO_DEMO (número E.164)", timestamp: new Date().toISOString() };
  const esVoz = canal === "voz";
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/${esVoz ? "Calls" : "Messages"}.json`;
  const texto = `[Centro de Mando] ${a.recurso}: ${a.accion} ${esVoz ? "" : "— " + t.plan.mensajeAlerta}`.slice(0, esVoz ? 600 : 320);
  const body = new URLSearchParams(
    esVoz
      ? { To: to, From: env("TWILIO_FROM")!, Twiml: `<Response><Say language="es-ES">${texto.replace(/[<>&]/g, " ")}</Say></Response>` }
      : { To: to, From: env("TWILIO_FROM")!, Body: texto },
  );
  const res = await fetch(url, { method: "POST", headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15000) });
  const j = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; status?: string };
  return { accionId: a.id, canal: esVoz ? "voz" : "sms", proveedor: "Twilio", ref: j.sid ?? "-", ok: res.ok, detalle: res.ok ? `Twilio ${j.status ?? "queued"} → ${to}` : `Twilio ${res.status}: ${j.message ?? ""}`, timestamp: new Date().toISOString() };
}

export async function ejecutarDecision(d: Decision): Promise<ResultadoAccion[]> {
  const proveedor = proveedorDisponible();
  const t = d.tarjeta;
  const resultados: ResultadoAccion[] = [];
  // Solo las acciones con canal externo salen del sistema; el resto se registran como orden interna.
  let externasEnviadas = 0;
  for (const a of t.plan.acciones) {
    const canal = canalPara(a);
    const timestamp = new Date().toISOString();
    if (canal === "interno" || externasEnviadas >= 2) {
      resultados.push({ accionId: a.id, canal: "interno", proveedor: "Cuaderno", ref: `orden-${a.id}`, ok: true, detalle: "Orden registrada en el cuaderno de mando (sin canal externo)", timestamp });
      continue;
    }
    if (proveedor === "Ninguno") {
      resultados.push({ accionId: a.id, canal, proveedor: "Ninguno", ref: "-", ok: false, detalle: `Sin canal ${canal} configurado (HappyRobot o Twilio en .env.local): pendiente de envío manual`, timestamp });
      continue;
    }
    try {
      resultados.push(proveedor === "HappyRobot" ? await dispararHappyRobot(canal, a, t, d) : await twilio(canal, a, t));
      externasEnviadas += 1;
    } catch (err) {
      resultados.push({ accionId: a.id, canal, proveedor, ref: "-", ok: false, detalle: err instanceof Error ? err.message : String(err), timestamp });
    }
  }
  return resultados;
}

/** Escalado por voz: HappyRobot llama al cargo, le lee el resumen y recoge aprobar/denegar + motivo (vuelve por webhook /resultado). */
export async function llamarCargo(d: Decision, rol: string): Promise<ResultadoAccion> {
  const t = d.tarjeta;
  const accion: AccionPlan = { id: `escalado-${d.id}`, recurso: `Cargo: ${rol}`, accion: `Aprobación por voz de "${t.titulo}" (riesgo ${d.riesgo}). Resumen: ${t.resumen}`, eta: "ahora", prioridad: "alta" };
  if (!happyrobotDisponible()) {
    return { accionId: accion.id, canal: "voz", proveedor: "Ninguno", ref: "-", ok: false, detalle: "HappyRobot no configurado: el escalado por voz no se ha realizado", timestamp: new Date().toISOString() };
  }
  try {
    return await dispararHappyRobot("voz", accion, t, d);
  } catch (err) {
    return { accionId: accion.id, canal: "voz", proveedor: "HappyRobot", ref: "-", ok: false, detalle: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() };
  }
}
