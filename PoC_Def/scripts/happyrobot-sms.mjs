// =====================================================================
// ATALAYA INCENDIOS · Workflow «Atalaya · SMS saliente» montado de cero por API
// ---------------------------------------------------------------------
// Lo importa scripts/happyrobot-workflows.mjs (órdenes `sms` y `sms-prueba`).
// La plantilla `sms-agent` exige credenciales de Twilio y dejó un cascarón de
// 0 nodos sin publicar (medido el 19-09-2026: slug vp2qk6qpb5sh), así que el
// workflow se completa nodo a nodo, conservando el slug que ya está en .env.local:
//   1. Trigger «Predefined request» (b329e750-…): cada param llega como @clave
//      (lib/happyrobot/cliente.ts manda { payload: {…} } a /workflows/{slug}/runs).
//   2. Acción «Send text» (integración Text, 01936a40-…, sin credenciales: sale
//      por el número americano de la organización): to = @telefono, body = @texto.
//   3. Webhook POST a @webhook_url con x-webhook-secret: @secreto → Atalaya
//      /api/webhooks/happyrobot/resultado (cierra la acción de una decisión o, si
//      el SMS lo mandó el agente del 112, se anota por el run: lib/happyrobot/sms-avisos.ts).
// Las funciones `config*`/`cuerpo*`/`clasificar*` son PURAS y las prueba
// tests/unit/happyrobot-sms-avisos.test.ts; `montarSms`, `publicarSms` y
// `probarSms` hablan con la API v2 a través del `api(metodo, ruta, cuerpo)` que
// se les pasa. NADA SIMULADO: cada paso enseña la respuesta real y, si algo
// falla, se para. `probarSms` manda un SMS DE VERDAD.
// =====================================================================

export const EVENTOS_SMS = {
  predefinedRequest: "b329e750-2e0e-4618-ba65-e04bb6a93c5f", // Webhook · Predefined request (params → @clave)
  sendText: "01936a40-189c-7579-b457-c6ac150b4bed", // Text · Send text (to, body; sin credenciales)
  sendSms: "019e3b65-e185-7c44-b042-67de4be40728", // Text · Send SMS (to, body, smsConfig: toll-free o Twilio propio) · alternativa
  webhookPost: "01926f2b-2973-7ebf-ada1-e984251e27ec", // Webhook · POST
};

export const NOMBRE_SMS = "Atalaya · SMS saliente";
export const NOMBRES_NODOS_SMS = {
  trigger: "Atalaya dispara por API",
  enviar: "SMS al destinatario",
  resultado: "Devolver resultado a Atalaya",
};

/**
 * Params del trigger: TODO lo que puede mandar Atalaya en el payload de un SMS
 * (lib/happyrobot/cliente.ts enviarSms + contexto del ejecutor, y los campos del
 * SMS del agente del 112 de lib/happyrobot/sms-avisos.ts).
 */
export const PARAMS_SMS = [
  "canal", "decisionId", "accionId", "incendioId",
  "telefono", "phone_number", "destino", "texto", "mensaje",
  "municipio", "incendio", "organismo", "nivel", "superficieHa", "tituloDecision", "resumenDecision",
  "motivo", "origen", "runLlamada", "observacionId",
  "webhook_url", "secreto",
];

export const texto = (t) => [{ type: "paragraph", children: [{ text: t }] }];
/** Campo "paragraph" (Plate) con una variable del trigger: @clave. */
export const variable = (grupo, id) => [{ type: "paragraph", children: [{ text: "" }, { type: "variable", children: [{ text: "" }], group_id: grupo, variable_id: id }, { text: "" }] }];
export const ref = (grupo, id) => `{{$var:${grupo}.${id}}}`;
export const lista = (r) => (Array.isArray(r) ? r : r?.data ?? []);

export function configTriggerSms(previa = {}) {
  return { ...previa, params: PARAMS_SMS };
}

export function configEnviarSms(triggerId, previa = {}) {
  return { ...previa, to: variable(triggerId, "telefono"), body: variable(triggerId, "texto") };
}

/** Cuerpo del webhook de resultado: los ids tal cual + el run + las salidas del nodo de envío si las hay. */
export function cuerpoResultadoSms(triggerId, salidas = [], nodoEnvioId) {
  const c = {
    decisionId: ref(triggerId, "decisionId"),
    accionId: ref(triggerId, "accionId"),
    incendioId: ref(triggerId, "incendioId"),
    ref: ref("current", "run_id"),
    run_url: ref("current", "run_url"),
    ok: true,
    status: "completed",
    canal: "sms",
    en: ref("time", "now_iso"),
    destino: ref(triggerId, "telefono"),
    motivo: ref(triggerId, "motivo"),
    origen: ref(triggerId, "origen"),
    runLlamada: ref(triggerId, "runLlamada"),
    observacionId: ref(triggerId, "observacionId"),
  };
  if (nodoEnvioId) for (const id of salidas) c[`sms_${String(id).replace(/\W/g, "_")}`] = ref(nodoEnvioId, id);
  return c;
}

export function configWebhookResultado(triggerId, cuerpo) {
  return {
    url: variable(triggerId, "webhook_url"),
    params: [],
    headers: [
      { key: "x-webhook-secret", value: variable(triggerId, "secreto") },
      { key: "content-type", value: texto("application/json") },
    ],
    authType: "none",
    ignore5XX: false,
    contentType: "application/json",
    xssProtection: true,
    responseHeaders: [],
    webhookSchemaVersion: 2,
    body: { raw: JSON.stringify(cuerpo), parts: [], contentType: "application/json", schemaVersion: 2 },
  };
}

/** Localiza los tres papeles en lo que devuelve GET /versions/{id}/nodes. */
export function clasificarNodosSms(nodos) {
  return {
    trigger: nodos.find((n) => !n.parent_id && n.type !== "prompt"),
    enviar: nodos.find((n) => n.event_id === EVENTOS_SMS.sendText || n.event_id === EVENTOS_SMS.sendSms),
    resultado: nodos.find((n) => n.event_id === EVENTOS_SMS.webhookPost),
  };
}

/** Payload de un SMS de prueba con la MISMA forma que manda Atalaya (todos los params, vacíos los que no aplican). */
export function payloadPruebaSms({ destino, texto: textoSms, webhookUrl = "", secreto = "", organismo = "Atalaya Incendios" }) {
  if (!/^\+\d{7,15}$/.test(String(destino || ""))) throw new Error("Falta el destino E.164 del SMS (+34…)");
  if (!textoSms || !String(textoSms).trim()) throw new Error("Falta el texto del SMS");
  const t = String(textoSms).slice(0, 300);
  const p = Object.fromEntries(PARAMS_SMS.map((k) => [k, ""]));
  return {
    ...p,
    canal: "sms",
    telefono: destino, phone_number: destino, destino,
    texto: t, mensaje: t,
    organismo,
    motivo: "prueba",
    origen: "scripts/happyrobot-workflows.mjs sms-prueba",
    webhook_url: webhookUrl,
    secreto,
  };
}

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------

/** PUT tolerante con el discriminador: GET devuelve los triggers como "action". */
async function actualizar(api, versionId, nodo, cuerpo, tipos) {
  let ultimo;
  for (const tipo of tipos) {
    try {
      return await api("PUT", `/versions/${versionId}/nodes/${nodo.id}`, { type: tipo, event_id: nodo.event_id, ...cuerpo });
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo;
}

/**
 * Deja «Atalaya · SMS saliente» completo y sincronizado: crea el workflow si no
 * existe, añade los nodos que falten (conserva el slug del cascarón) y vuelve a
 * poner params, destino/cuerpo y el webhook de resultado. Idempotente. Si la
 * versión está publicada la despublica (la API no deja editar una versión viva)
 * y la vuelve a publicar quien llama (`publicarSms`).
 */
export async function montarSms(api, { log = console.log } = {}) {
  const wfs = lista(await api("GET", "/workflows"));
  let w = wfs.find((x) => x.name === NOMBRE_SMS);
  let creadoAhora = false;
  if (!w) {
    w = await api("POST", "/workflows/", { name: NOMBRE_SMS, icon: "message" });
    creadoAhora = true;
    log(`✔ workflow creado: slug=${w.slug}`);
  } else {
    log(`· ${NOMBRE_SMS}: ya existe (${w.slug}); completo y sincronizo sus nodos`);
  }
  const versionId = w.latest_version?.id;
  if (!versionId) throw new Error(`El workflow ${w.slug} no tiene versión`);
  const version = await api("GET", `/versions/${versionId}/`);
  if (version.is_published) {
    await api("POST", `/versions/${versionId}/unpublish`, {});
    log("· versión despublicada para poder editarla (se vuelve a publicar al final)");
  }
  const leer = async () => clasificarNodosSms(lista(await api("GET", `/versions/${versionId}/nodes`)));
  let c = await leer();

  if (!c.trigger) {
    await api("POST", `/versions/${versionId}/nodes`, {
      nodes: [{ type: "trigger", event_id: EVENTOS_SMS.predefinedRequest, name: NOMBRES_NODOS_SMS.trigger, configuration: configTriggerSms() }],
    });
    c = await leer();
    if (!c.trigger) throw new Error("La API no devuelve el trigger recién creado");
    log(`✔ trigger «Predefined request» creado (${c.trigger.id}) con ${PARAMS_SMS.length} params`);
  }
  if (!c.enviar) {
    await api("POST", `/versions/${versionId}/nodes`, {
      nodes: [{ type: "action", event_id: EVENTOS_SMS.sendText, name: NOMBRES_NODOS_SMS.enviar, parent_node_id: c.trigger.id, configuration: configEnviarSms(c.trigger.id) }],
    });
    c = await leer();
    if (!c.enviar) throw new Error("La API no devuelve el nodo «Send text» recién creado");
    log(`✔ acción «Send text» creada (${c.enviar.id}): to=@telefono, body=@texto`);
  }
  if (!c.resultado) {
    await api("POST", `/versions/${versionId}/nodes`, {
      nodes: [{ type: "action", event_id: EVENTOS_SMS.webhookPost, name: NOMBRES_NODOS_SMS.resultado, parent_node_id: c.enviar.id, configuration: configWebhookResultado(c.trigger.id, cuerpoResultadoSms(c.trigger.id)) }],
    });
    c = await leer();
    if (!c.resultado) throw new Error("La API no devuelve el webhook de resultado recién creado");
    log(`✔ webhook de resultado creado (${c.resultado.id}) → @webhook_url con x-webhook-secret`);
  }

  const T = c.trigger.id;
  await actualizar(api, versionId, c.trigger, { name: NOMBRES_NODOS_SMS.trigger, configuration: configTriggerSms(c.trigger.configuration) }, ["trigger", "action"]);
  await actualizar(api, versionId, c.enviar, { name: NOMBRES_NODOS_SMS.enviar, configuration: configEnviarSms(T, c.enviar.configuration) }, ["action"]);
  let salidas = [];
  try {
    const vars = lista(await api("GET", `/versions/${versionId}/nodes/${c.resultado.id}/available-vars`));
    const grupo = vars.find((g) => g.id === c.enviar.id || g.id === c.enviar.persistent_id);
    salidas = (grupo?.variables || []).map((v) => v.id).filter((id) => !/^agent\./.test(String(id)));
  } catch (e) {
    log(`   ⚠ available-vars: ${String(e.message).slice(0, 160)}`);
  }
  await actualizar(api, versionId, c.resultado, { name: NOMBRES_NODOS_SMS.resultado, configuration: configWebhookResultado(T, cuerpoResultadoSms(T, salidas, c.enviar.id)) }, ["action"]);
  log(`   ✔ sincronizado: ${PARAMS_SMS.length} params, to/body y webhook de resultado${salidas.length ? ` (+ salidas del SMS: ${salidas.join(", ")})` : ""}`);
  return { workflow: w, versionId, creadoAhora, ids: { trigger: T, enviar: c.enviar.id, resultado: c.resultado.id }, salidas };
}

export async function publicarSms(api, versionId, entorno = "production", log = console.log) {
  const r = await api("POST", `/versions/${versionId}/publish`, { environment: entorno, force: true });
  log(`✔ ${NOMBRE_SMS}: publicado=${r.is_published} vivo=${r.is_live} entorno=${r.environment}`);
  if (r.test_errors?.length) log(`   avisos de prueba: ${JSON.stringify(r.test_errors).slice(0, 600)}`);
  if (r.missing_variables?.length) log(`   variables sin resolver: ${JSON.stringify(r.missing_variables).slice(0, 600)}`);
  return r;
}

/**
 * Dispara un run REAL del workflow (manda un SMS de verdad al destino) y enseña
 * qué hizo cada nodo. Devuelve { runId, run, nodos } para poder mirarlo.
 */
export async function probarSms(api, { slug, entorno = "production", destino, texto: textoSms, webhookUrl, secreto, log = console.log, esperaMs = 45_000 }) {
  const payload = payloadPruebaSms({ destino, texto: textoSms, webhookUrl, secreto });
  const r = await api("POST", `/workflows/${encodeURIComponent(slug)}/runs?environment=${encodeURIComponent(entorno)}`, { payload });
  const runId = r?.id ?? r?.run_id ?? r?.data?.id ?? r?.data?.run_id;
  log(`✔ run lanzado: ${runId ?? JSON.stringify(r).slice(0, 300)}`);
  if (!runId) return { run: r };
  const fin = Date.now() + esperaMs;
  let run;
  let nodos = [];
  while (Date.now() < fin) {
    await new Promise((x) => setTimeout(x, 3000));
    run = await api("GET", `/runs/${runId}`).then((x) => x?.data ?? x).catch((e) => ({ error: e.message }));
    nodos = lista(await api("GET", `/runs/${runId}/nodes`).catch(() => []));
    const estado = run?.status ?? run?.state ?? run?.error;
    log(`   · run ${estado ?? "?"} · nodos: ${nodos.map((n) => `${n.name ?? n.node_name ?? n.id}=${n.status ?? n.state ?? "?"}`).join(", ") || "sin datos aún"}`);
    if (estado && !/running|pending|queued|in_progress|started|processing/i.test(String(estado))) break;
  }
  for (const n of nodos) {
    const err = n.error ?? n.error_message ?? n.output?.error;
    if (err) log(`   ✘ ${n.name ?? n.id}: ${JSON.stringify(err).slice(0, 500)}`);
  }
  return { runId, run, nodos };
}
