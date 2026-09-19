// GET /api/happyrobot/salud · Qué canales de HappyRobot están configurados, qué
// workflows existen en la plataforma y cuáles están publicados. Es la pantalla que
// dice en rojo "HappyRobot: falta el workflow de voz". DUEÑO: constructor D.
import { estadoCanal, entorno, listarWorkflows, slugDe, urlLlamadaWeb, urlWebhookResultado, VARIABLE_SLUG, type CanalHappyRobot } from "@/lib/happyrobot/cliente";
import { estadoTelegram, infoWebhook, telegramDisponible } from "@/lib/telegram/cliente";
import { obtenerEstado } from "@/lib/motor/estado";
import { json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CANALES: CanalHappyRobot[] = ["voz", "sms", "email"];

export async function GET(): Promise<Response> {
  const estado = obtenerEstado();

  const canales = CANALES.map((canal) => ({
    canal,
    variable: VARIABLE_SLUG[canal],
    slug: slugDe(canal) ?? null,
    ...estadoCanal(canal),
  }));

  let workflows: unknown[] = [];
  let errorWorkflows: string | undefined;
  try {
    workflows = await listarWorkflows();
    estado.marcarServicio("HappyRobot", true, `${workflows.length} workflow(s) en la organización`);
  } catch (e) {
    errorWorkflows = e instanceof Error ? e.message : String(e);
    estado.marcarServicio("HappyRobot", false, errorWorkflows);
  }

  let webhookTelegram: unknown;
  if (telegramDisponible()) {
    try {
      webhookTelegram = await infoWebhook();
    } catch (e) {
      webhookTelegram = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  const listos = canales.filter((c) => c.ok).length;
  return json({
    ok: listos === CANALES.length && !errorWorkflows,
    resumen: errorWorkflows
      ? `HappyRobot no responde: ${errorWorkflows}`
      : listos === CANALES.length
        ? "HappyRobot listo en los tres canales"
        : `HappyRobot: faltan ${CANALES.length - listos} workflow(s) por configurar`,
    entorno: entorno(),
    urlWebhookResultado: urlWebhookResultado() ?? null,
    urlLlamadaWeb: urlLlamadaWeb() ?? null,
    canales,
    workflows,
    errorWorkflows: errorWorkflows ?? null,
    telegram: { ...estadoTelegram(), webhook: webhookTelegram ?? null },
  });
}
