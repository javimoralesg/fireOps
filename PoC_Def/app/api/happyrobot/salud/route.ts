// GET /api/happyrobot/salud · Qué canales de HappyRobot están configurados, qué
// workflows existen en la plataforma y cuáles están publicados. Es la pantalla que
// dice en rojo "HappyRobot: falta el workflow de voz". DUEÑO: constructor D.
import { estadoCanal, entorno, listarWorkflows, slugDe, urlLlamadaWeb, urlWebhookResultado, VARIABLE_SLUG, type CanalHappyRobot } from "@/lib/happyrobot/cliente";
import { desincronizado, estadoEntrante, leerWorkflowEntrante, urlPublicaResponde } from "@/lib/happyrobot/entrante";
import { arrancarRecuperacionLlamadas, ultimaRecuperacion } from "@/lib/happyrobot/recuperar-llamadas";
import { estadoSmsAvisos } from "@/lib/happyrobot/sms-avisos";
import { urlPublica } from "@/lib/motor/entorno";
import { estadoTelegram, infoWebhook, telegramDisponible } from "@/lib/telegram/cliente";
import { obtenerEstado } from "@/lib/motor/estado";
import { json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Canales que Atalaya usa de verdad. La VOZ SALIENTE está DESACTIVADA (19-09): el troncal no llama a España (SIP 403). */
const CANALES: CanalHappyRobot[] = ["sms", "email"];
const DETALLE_VOZ = "Voz saliente desactivada (solo SMS): el número americano no puede llamar a España (SIP 403 Forbidden, medido el 19-09). Las acciones «llamar» salen por SMS.";

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

  // 112 virtual por teléfono (sesión fireops-82): número, workflow y a qué URLs
  // apuntan sus herramientas (deben ser la URL pública viva: túnel o PUBLIC_BASE_URL).
  const base = urlPublica();
  const situacion = estadoEntrante();
  // Y a qué URL dispara DE VERDAD el workflow publicado: si el túnel cambió y nadie
  // ejecutó «sincronizar», el agente contesta pero no puede registrar nada (medido el 19-09).
  let urlEnPlataforma: string | undefined;
  let errorPlataforma: string | undefined;
  // ¿Está publicado y vivo? Si una sincronización falla al publicar, el número deja de atender.
  let publicado = true;
  if (situacion.ok) {
    try {
      const w = await leerWorkflowEntrante();
      urlEnPlataforma = w.urlRegistrar;
      publicado = w.publicado && w.vivo;
    } catch (e) {
      errorPlataforma = e instanceof Error ? e.message : String(e);
    }
  }
  const fueraDeSitio = desincronizado(base, urlEnPlataforma);
  // Y si esa URL vive: un túnel zombi (medido el 19-09) hace que el agente conteste sin poder registrar nada.
  const vida = situacion.ok ? await urlPublicaResponde(base) : { viva: false };
  const entrante = {
    ...situacion,
    ok: situacion.ok && publicado && !fueraDeSitio && vida.viva,
    detalle: !publicado
      ? "HappyRobot: el workflow del 112 entrante NO está publicado: el número no atiende · ejecuta scripts/happyrobot-workflows.mjs sincronizar"
      : fueraDeSitio
      ? `HappyRobot: el 112 entrante apunta a ${urlEnPlataforma} y la URL pública actual es ${base} · ejecuta scripts/happyrobot-workflows.mjs sincronizar`
      : situacion.ok && !vida.viva
        ? `HappyRobot: el 112 entrante contesta pero no puede registrar avisos · ${vida.motivo}`
        : situacion.detalle,
    urlPublicaViva: vida.viva,
    herramientas: base
      ? { consultarZona: `${base}/api/happyrobot/contexto`, registrarAviso: `${base}/api/happyrobot/aviso`, enviarSms: `${base}/api/happyrobot/sms`, alColgar: `${base}/api/webhooks/happyrobot/llamada` }
      : null,
    urlEnPlataforma: urlEnPlataforma ?? null,
    publicado,
    desincronizado: fueraDeSitio,
    // Llamadas que no llegaron y se recuperaron de HappyRobot (lib/happyrobot/recuperar-llamadas.ts).
    recuperacion: (arrancarRecuperacionLlamadas(), ultimaRecuperacion() ?? null),
    errorPlataforma: errorPlataforma ?? null,
  };

  // SMS del agente del 112 al teléfono del .env (lib/happyrobot/sms-avisos.ts): sin el número completo.
  const { destino: _telefonoSms, ...smsAvisos } = estadoSmsAvisos();
  void _telefonoSms;

  const listos = canales.filter((c) => c.ok).length;
  return json({
    entrante,
    ok: listos === CANALES.length && !errorWorkflows,
    resumen: errorWorkflows
      ? `HappyRobot no responde: ${errorWorkflows}`
      : listos === CANALES.length
        ? "HappyRobot listo (SMS y email; voz saliente desactivada)"
        : `HappyRobot: faltan ${CANALES.length - listos} workflow(s) por configurar`,
    entorno: entorno(),
    urlWebhookResultado: urlWebhookResultado() ?? null,
    urlLlamadaWeb: urlLlamadaWeb() ?? null,
    smsAvisos,
    voz: { desactivada: true, detalle: DETALLE_VOZ, slug: slugDe("voz") ?? null },
    canales,
    workflows,
    errorWorkflows: errorWorkflows ?? null,
    telegram: { ...estadoTelegram(), webhook: webhookTelegram ?? null },
  });
}
