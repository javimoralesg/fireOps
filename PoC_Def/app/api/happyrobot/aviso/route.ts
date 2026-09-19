// POST /api/happyrobot/aviso · Herramienta «registrar_aviso» del agente de voz del
// 112 virtual (workflow «Atalaya · 112 entrante»). El nodo Webhook de la herramienta
// manda lo que la persona dictó (municipio, lugar, qué ve, riesgo, teléfono, run_id)
// con la cabecera x-webhook-secret; aquí se registra la observación, se sitúa, se
// verifica en el acto y se devuelve al agente qué decir (`mensajeParaLocutor`).
// DUEÑO: sesión fireops-82 (2026-09-19). Lógica en lib/happyrobot/entrante.ts.
import { verificarWebhook } from "@/lib/happyrobot/cliente";
import { avisoDesdeCuerpo, avisoSinDatos, observacionDeLlamada, registrarAvisoDeLlamada } from "@/lib/happyrobot/entrante";
import { enviarSmsAvisoRegistrado } from "@/lib/happyrobot/sms-avisos";
import { obtenerEstado } from "@/lib/motor/estado";
import { arrancarOrquestador } from "@/lib/motor/orquestador";
import { error, json, mensajeDeError } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request): Promise<Response> {
  if (!verificarWebhook(peticion.headers)) return error("Cabecera x-webhook-secret ausente o incorrecta", 401);

  let bruto: unknown;
  try {
    bruto = await peticion.json();
  } catch {
    return error("El cuerpo debe ser JSON", 400);
  }
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return error("El cuerpo debe ser un objeto JSON", 400);
  const obj = bruto as Record<string, unknown>;
  // HappyRobot puede envolver los argumentos de la herramienta en data/payload/arguments.
  const anidado = (obj.data ?? obj.payload ?? obj.arguments ?? obj.parameters) as Record<string, unknown> | undefined;
  const cuerpo = anidado && typeof anidado === "object" && !Array.isArray(anidado) ? { ...anidado, ...obj } : obj;

  const leido = avisoDesdeCuerpo(cuerpo);
  // Sin datos mínimos (o prueba de nodo de HappyRobot, con todo vacío): 200 con la forma completa y
  // registrado:false. Un 422 dejaba al agente sin ver ningún campo de la respuesta (medido el 19-09).
  if (!leido.aviso) return json(avisoSinDatos(leido.error ?? "Aviso no válido"));

  arrancarOrquestador();
  try {
    // ¿Segunda llamada a la herramienta en la misma conversación? Amplía el aviso y el SMS lo dice.
    const ampliacion = Boolean(leido.aviso.runId && observacionDeLlamada(obtenerEstado(), leido.aviso.runId));
    const resultado = await registrarAvisoDeLlamada(leido.aviso);
    // SMS del aviso al teléfono del .env (TELEFONO_AVISOS_SMS; lib/happyrobot/sms-avisos.ts, sesión
    // fireops-00): en segundo plano para no retrasar la respuesta al agente de voz. El envío o su
    // fallo quedan como evento; la respuesta a la herramienta no cambia.
    void enviarSmsAvisoRegistrado(leido.aviso, resultado, { ampliacion });
    return json(resultado);
  } catch (e) {
    return error(`No se pudo registrar el aviso de la llamada: ${mensajeDeError(e)}`, 500);
  }
}
