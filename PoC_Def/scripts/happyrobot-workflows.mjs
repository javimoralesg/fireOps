#!/usr/bin/env node
// =====================================================================
// ATALAYA INCENDIOS · Crear y publicar los workflows de HappyRobot por API
// ---------------------------------------------------------------------
// Uso (desde la raíz del repo, con .env.local relleno):
//   node scripts/happyrobot-workflows.mjs crear        # 4 workflows desde plantilla
//   node scripts/happyrobot-workflows.mjs configurar   # prompts, voz, número, webhook
//   node scripts/happyrobot-workflows.mjs publicar     # publica en producción
//   node scripts/happyrobot-workflows.mjs env          # escribe los slugs en .env.local
//   node scripts/happyrobot-workflows.mjs limpiar --confirmar   # borra cascarones vacíos
//   node scripts/happyrobot-workflows.mjs todo         # crear + configurar + publicar + env
//   node scripts/happyrobot-workflows.mjs estado       # qué hay en la plataforma
//   node scripts/happyrobot-workflows.mjs entrante     # 112 por TELÉFONO: crea/sincroniza y publica «Atalaya · 112 entrante»
//   node scripts/happyrobot-workflows.mjs sincronizar  # igual que `entrante` (repetir cuando cambie la URL del túnel)
//   node scripts/happyrobot-workflows.mjs sms          # SMS saliente: completa el workflow nodo a nodo (Send text) y lo publica
//   node scripts/happyrobot-workflows.mjs sms-prueba [+34…] [texto]   # manda un SMS REAL por ese workflow y enseña el run
//
// Estado entre pasos: data/happyrobot-workflows.json (ids, slugs, nodos).
// Contrato verificado el 2026-09-19 contra /api/v2/docs/json de la instancia EU.
// NADA SIMULADO: cada paso enseña la respuesta real; si algo falla, se para.
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import { elegirNumero, montarEntrante, NOMBRE_ENTRANTE, publicarEntrante } from "./happyrobot-entrante.mjs";
import { montarSms, NOMBRE_SMS, probarSms, publicarSms } from "./happyrobot-sms.mjs";
import { PROMPT_ENTRANTE, PROMPT_SALIENTE } from "./prompts-happyrobot.mjs";

const RAIZ = path.resolve(new URL(".", import.meta.url).pathname, "..");
const ENV_PATH = path.join(RAIZ, ".env.local");
const ESTADO_PATH = path.join(RAIZ, "data", "happyrobot-workflows.json");

// ---- .env.local --------------------------------------------------------
function leerEnv() {
  const env = {};
  if (!fs.existsSync(ENV_PATH)) return env;
  for (const linea of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !linea.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const ENV = leerEnv();
const BASE = (ENV.HAPPYROBOT_API_BASE || "https://platform.eu.happyrobot.ai").replace(/\/$/, "");
const CLAVE = ENV.HAPPYROBOT_API_KEY;
const ENTORNO = ENV.HAPPYROBOT_ENVIRONMENT || "production";
if (!CLAVE) {
  console.error("Falta HAPPYROBOT_API_KEY en .env.local");
  process.exit(1);
}
function urlPublica() {
  const f = path.join(RAIZ, "data", "url-publica.txt");
  if (fs.existsSync(f)) {
    const u = fs.readFileSync(f, "utf8").trim();
    if (u.startsWith("https://")) return u.replace(/\/$/, "");
  }
  const u = (ENV.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  return u.startsWith("https://") ? u : undefined;
}

// ---- API ---------------------------------------------------------------
async function api(metodo, ruta, cuerpo) {
  // Content-Type solo con cuerpo: un DELETE con "application/json" y sin cuerpo lo rechaza la API (400).
  const res = await fetch(`${BASE}/api/v2${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${CLAVE}`, ...(cuerpo === undefined ? {} : { "Content-Type": "application/json" }) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  let datos;
  try { datos = texto ? JSON.parse(texto) : undefined; } catch { datos = texto; }
  if (!res.ok) throw new Error(`${metodo} ${ruta} → HTTP ${res.status}: ${texto.slice(0, 600)}`);
  return datos;
}
const lista = (r) => (Array.isArray(r) ? r : r?.data ?? []);

// ---- Constantes verificadas en la organización -------------------------
const EVENTO = {
  incomingHook: "01929b66-a335-7514-a159-cae2fe715286",   // trigger "Incoming hook" (payload → data.*)
  predefinedRequest: "b329e750-2e0e-4618-ba65-e04bb6a93c5f", // trigger "Predefined request" (params → nombre directo)
  outboundVoice: "0192e5dc-090a-7f57-87a0-76308ed6ef28",  // Outbound Voice Agent
  webhookPost: "01926f2b-2973-7ebf-ada1-e984251e27ec",    // Webhook → POST
};
const NUMERO_USA = "+15734018744";        // comprado en la organización (SIP trunk configurado)
const VOZ_ES = { id: "31hktsdrgix8", name: "Ana HR" };       // es-ES, proveedor happyrobot
const IDIOMA = { id: "es", name: "Spanish" };
const ACENTO = { id: "es-es", name: "Spanish (Spain)" };
const MODELO = { type: "static", static: { id: "gpt-4.1", name: "gpt-4.1" } };

// Definición de los cuatro workflows (nombre, plantilla, agente)
const WORKFLOWS = {
  voz:     { nombre: "Atalaya · Llamada saliente", plantilla: "voice-agent",         agente: "Atalaya · Sala de coordinación", icono: "phone",   variable: "HAPPYROBOT_WORKFLOW_SLUG_VOZ" },
  sms:     { nombre: "Atalaya · SMS saliente",     plantilla: "sms-agent",           agente: "Atalaya · SMS",                  icono: "message", variable: "HAPPYROBOT_WORKFLOW_SLUG_SMS" },
  email:   { nombre: "Atalaya · Email saliente",   plantilla: "email-agent",         agente: "Atalaya · Email",                icono: "mail",    variable: "HAPPYROBOT_WORKFLOW_SLUG_EMAIL" },
  entrante:{ nombre: "Atalaya · 112 entrante",     plantilla: null /* se monta de cero: trigger telefónico */, agente: "Atalaya · Centralita 112", icono: "phone", variable: "HAPPYROBOT_WORKFLOW_SLUG_ENTRANTE" },
};

// ---- Prompts (viven en scripts/prompts-happyrobot.mjs, no se duplican aquí) --------

// ---- Formato de variables de la plataforma ------------------------------
// En campos "paragraph" (Plate): objeto variable. En cuerpos raw y prompts: {{$var:grupo.variable}}.
const texto = (t) => ({ text: t });
const variable = (grupo, id) => ({ type: "variable", children: [{ text: "" }], group_id: grupo, variable_id: id });
const parrafo = (...hijos) => [{ type: "paragraph", children: [texto(""), ...hijos, texto("")] }];
const ref = (grupo, id) => `{{$var:${grupo}.${id}}}`;

// ---- Estado local --------------------------------------------------------
function leerEstado() {
  return fs.existsSync(ESTADO_PATH) ? JSON.parse(fs.readFileSync(ESTADO_PATH, "utf8")) : {};
}
function guardarEstado(e) {
  fs.mkdirSync(path.dirname(ESTADO_PATH), { recursive: true });
  fs.writeFileSync(ESTADO_PATH, JSON.stringify(e, null, 2));
}
/**
 * Cambia UNA entrada sobre lo que hay en disco AHORA (relee, cambia, guarda). Las órdenes que se
 * encadenan («configurar» → «sms» → «entrante») no se pisan: antes «configurar» guardaba una copia
 * vieja después de que «sms» escribiera la suya y borraba la entrada sms recién creada (revisión
 * del PR, 19-09).
 */
function actualizarEstado(clave, valor) {
  const e = leerEstado();
  e[clave] = valor;
  guardarEstado(e);
  return e;
}

// ---- Payload de muestra: define las variables data.* del trigger ---------
function payloadMuestra(canal) {
  const destino = ENV.DESTINO_DEMO || "+34600000000";
  const base = {
    canal,
    decisionId: "dec-demo", accionId: "acc-demo", incendioId: "inc-demo",
    incendio: "Incendio de Navalacruz (Navalacruz, Ávila)", municipio: "Navalacruz",
    organismo: ENV.ORGANISMO_NOMBRE || "Centro de Coordinación de Incendios Forestales",
    nivel: "1", superficieHa: "12", tituloDecision: "Aviso preventivo", resumenDecision: "El frente avanza hacia el casco urbano",
    webhook_url: `${urlPublica() || "https://atalaya.invalid"}/api/webhooks/happyrobot/resultado`,
    secreto: ENV.HAPPYROBOT_WEBHOOK_SECRET || "secreto-demo",
  };
  if (canal === "voz") return { ...base, telefono: destino, phone_number: destino, destino, guion: "Buenos días, le llamo del centro de coordinación. Hay un incendio a dos kilómetros del casco urbano. Le pedimos que active el plan municipal.", mensaje: "…" };
  if (canal === "sms") return { ...base, telefono: destino, phone_number: destino, destino, texto: "Atalaya: incendio a 2 km. Active el plan municipal.", mensaje: "…" };
  return { ...base, destino: ENV.EMAIL_DEMO || "demo@example.com", email: ENV.EMAIL_DEMO || "demo@example.com", asunto: "Atalaya · comunicación operativa", subject: "…", texto: "Parte formal de prueba", mensaje: "…", cuerpo: "…" };
}

// =====================================================================
// PASOS
// =====================================================================
async function estado() {
  const wfs = lista(await api("GET", "/workflows"));
  console.log(`${wfs.length} workflows en ${BASE}:`);
  for (const w of wfs) {
    const v = w.latest_version || {};
    const det = await api("GET", `/versions/${v.id}/`).catch(() => ({}));
    console.log(`  ${w.slug}  ${w.name.padEnd(46)} publicado=${v.is_published} entorno=${v.environment} nodos=${det.node_count ?? "?"} ${JSON.stringify(det.node_counts_by_type || {})}`);
  }
}

async function crear() {
  const est = leerEstado();
  const existentes = lista(await api("GET", "/workflows"));
  for (const [clave, def] of Object.entries(WORKFLOWS)) {
    if (clave === "entrante") continue; // lo monta «entrante» desde cero (trigger «Inbound to number», scripts/happyrobot-entrante.mjs)
    if (clave === "sms") continue; // lo completa «sms» nodo a nodo (la plantilla sms-agent exige Twilio; scripts/happyrobot-sms.mjs)
    if (est[clave]?.id) { console.log(`· ${def.nombre}: ya creado (${est[clave].slug}), no lo repito`); continue; }
    // La plataforma no admite dos workflows con el mismo nombre: si hay uno, o se adopta o se borra.
    for (const w of existentes.filter((x) => x.name === def.nombre)) {
      const v = w.latest_version || {};
      const det = await api("GET", `/versions/${v.id}/`);
      if ((det.node_count ?? 0) > 1) {
        est[clave] = { id: w.id, slug: w.slug, versionId: v.id, nombre: def.nombre };
        actualizarEstado(clave, est[clave]);
        console.log(`· ${def.nombre}: ya existe con ${det.node_count} nodos (${w.slug}); lo adopto en vez de crear otro`);
        break;
      }
      if (v.is_published) await api("POST", `/versions/${v.id}/unpublish`, {});
      await api("DELETE", `/workflows/${w.id}`);
      console.log(`· ${def.nombre}: borrado el cascarón vacío ${w.slug} (${det.node_count ?? 0} nodos)`);
    }
    if (est[clave]?.id) continue;
    try {
      const w = await api("POST", "/workflows/", {
        name: def.nombre, icon: def.icono, skip_test_all: true,
        from_template: { template: def.plantilla, inputs: { agent_name: def.agente } },
      });
      est[clave] = { id: w.id, slug: w.slug, versionId: w.latest_version?.id, nombre: def.nombre };
      actualizarEstado(clave, est[clave]);
      console.log(`✔ ${def.nombre}: slug=${w.slug} versión=${w.latest_version?.id}`);
    } catch (e) {
      console.log(`✘ ${def.nombre} (plantilla ${def.plantilla}): ${e.message}`);
      if (/credential|integration|twilio|gmail|sip/i.test(e.message)) console.log(`    → la plantilla exige credenciales en la organización; ese canal se monta a mano (guía 3.2 / 3.3).`);
    }
  }
  await mostrarNodos(est);
}

async function mostrarNodos(est) {
  for (const [clave, w] of Object.entries(est)) {
    if (!w?.versionId) continue;
    const nodos = lista(await api("GET", `/versions/${w.versionId}/nodes`));
    console.log(`\n${w.nombre} (${w.slug}) · ${nodos.length} nodos:`);
    for (const n of nodos) console.log(`   - [${n.type}] ${n.name}  id=${n.id} evento=${n.event_id ?? "-"} padre=${n.parent_id ?? "-"}`);
  }
}

function clasificar(nodos) {
  const trigger = nodos.find((n) => !n.parent_id && n.type !== "prompt");
  const agente = nodos.find((n) => n.event_id === EVENTO.outboundVoice) || nodos.find((n) => n.type === "agent") || nodos.find((n) => n.parent_id === trigger?.id && n.type !== "prompt");
  const prompt = nodos.find((n) => n.type === "prompt" && n.parent_id === agente?.id) || nodos.find((n) => n.type === "prompt");
  const webhook = nodos.find((n) => n.event_id === EVENTO.webhookPost);
  return { trigger, agente, prompt, webhook };
}

/** Variables del trigger: Incoming hook las expone como data.<clave>; Predefined request como <clave>. */
function idVar(trigger, clave) {
  return trigger.event_id === EVENTO.predefinedRequest ? clave : `data.${clave}`;
}

async function actualizarNodo(versionId, nodo, cuerpo) {
  // El discriminador debe coincidir con el tipo real del nodo. GET devuelve los triggers y los
  // agentes de voz como "action", pero la versión los cuenta como "trigger"/"agent": se prueban en orden.
  let intentos;
  if (nodo.type === "prompt") intentos = ["prompt"];
  else if (!nodo.parent_id) intentos = ["trigger", "action"];
  else if (nodo.event_id === EVENTO.outboundVoice || nodo.type === "agent") intentos = ["agent", "action"];
  else intentos = [nodo.type, "agent"];
  let ultimo;
  for (const tipo of intentos) {
    const base = tipo === "prompt" || !nodo.event_id ? { type: tipo } : { type: tipo, event_id: nodo.event_id };
    try { return await api("PUT", `/versions/${versionId}/nodes/${nodo.id}`, { ...base, ...cuerpo }); }
    catch (e) { ultimo = e; }
  }
  throw ultimo;
}

async function configurarSaliente(clave, w) {
  const canal = clave;
  const nodos = lista(await api("GET", `/versions/${w.versionId}/nodes`));
  const { trigger, agente, prompt, webhook } = clasificar(nodos);
  if (!trigger) throw new Error("no hay trigger");
  const T = trigger.id;

  // 1. Trigger: payload de muestra (Incoming hook) o params (Predefined request)
  const muestra = payloadMuestra(canal);
  if (trigger.event_id === EVENTO.predefinedRequest) {
    await actualizarNodo(w.versionId, trigger, { name: "Atalaya dispara por API", configuration: { ...trigger.configuration, params: Object.keys(muestra) } });
  } else {
    await actualizarNodo(w.versionId, trigger, { name: "Atalaya dispara por API", configuration: { ...trigger.configuration }, webhook_payload: muestra });
  }
  console.log(`   ✔ trigger ${trigger.event_id === EVENTO.predefinedRequest ? "Predefined request (params)" : "Incoming hook (payload de muestra)"}`);

  // 2. Agente de voz: destino, número, voz e idioma
  if (canal === "voz" && agente) {
    const conf = {
      ...agente.configuration,
      to: parrafo(variable(T, idVar(trigger, "telefono"))),
      from_number: { type: "static", static: { id: NUMERO_USA, name: NUMERO_USA } },
      agent: {
        ...(agente.configuration?.agent || {}),
        name: [{ type: "paragraph", children: [texto(WORKFLOWS.voz.agente)] }],
        voices: [{ type: "static", static: VOZ_ES }],
        languages: [{ type: "static", static: IDIOMA }],
        language_accents: [{ type: "static", static: ACENTO }],
      },
      record: true,
      voice_mail: "hangup",
      max_call_duration: 300,
      gracefully_handle_invalid_phone: true,
      business_hours_setting_name: "default",
    };
    await actualizarNodo(w.versionId, agente, { name: "Llamada al ayuntamiento", configuration: conf });
    console.log(`   ✔ agente de voz: to=@telefono, desde ${NUMERO_USA}, voz ${VOZ_ES.name} (es-ES)`);
  }
  if (canal === "sms" && agente) {
    const conf = { ...agente.configuration };
    if ("to" in conf || !conf.to) conf.to = parrafo(variable(T, idVar(trigger, "telefono")));
    if ("body" in conf || "message" in conf) { conf.body = parrafo(variable(T, idVar(trigger, "texto"))); conf.message = conf.body; }
    await actualizarNodo(w.versionId, agente, { name: "SMS al ayuntamiento", configuration: conf }).catch((e) => console.log(`   ⚠ SMS: no he podido fijar destino/cuerpo por API (${e.message.slice(0, 160)}). Revisa el nodo en la plataforma: To=@telefono, Body=@texto.`));
  }
  if (canal === "email" && agente) {
    const conf = { ...agente.configuration, to: parrafo(variable(T, idVar(trigger, "destino"))), subject: parrafo(variable(T, idVar(trigger, "asunto"))), body: parrafo(variable(T, idVar(trigger, "texto"))) };
    await actualizarNodo(w.versionId, agente, { name: "Email al organismo", configuration: conf }).catch((e) => console.log(`   ⚠ Email: no he podido fijar destino/asunto/cuerpo por API (${e.message.slice(0, 160)}). Revisa el nodo en la plataforma.`));
  }

  // 3. Prompt: el de la guía, con las @variables convertidas al formato de la plataforma
  if (prompt && canal === "voz") {
    const md = PROMPT_SALIENTE.replace(/@(\w+)/g, (_, v) => ref(T, idVar(trigger, v)));
    const inicial = [{ type: "paragraph", children: [texto("Buenos días, le llamo del "), variable(T, idVar(trigger, "organismo")), texto(". "), variable(T, idVar(trigger, "guion"))] }];
    await actualizarNodo(w.versionId, prompt, { prompt_md: md, initial_message: inicial, initial_message_uninterruptible: false, model: MODELO });
    console.log(`   ✔ prompt (${md.length} caracteres) y mensaje inicial con @organismo y @guion`);
  }

  // 4. Webhook de resultado hacia Atalaya (POST @webhook_url con x-webhook-secret)
  const padre = agente || trigger;
  let nodoWebhook = webhook;
  if (!nodoWebhook) {
    const creado = await api("POST", `/versions/${w.versionId}/nodes`, {
      nodes: [{ type: "action", event_id: EVENTO.webhookPost, name: "Devolver resultado a Atalaya", parent_node_id: padre.id, configuration: configWebhook(T, trigger, canal, agente, []) }],
    });
    nodoWebhook = lista(creado)[0];
    console.log(`   ✔ nodo Webhook POST creado (${nodoWebhook.id})`);
  }
  // 5. Variables de salida del agente (transcripción, resumen…) que ve el webhook
  const vars = lista(await api("GET", `/versions/${w.versionId}/nodes/${nodoWebhook.id}/available-vars`));
  const grupoAgente = agente ? vars.find((g) => g.id === agente.id || g.id === agente.persistent_id) : undefined;
  const salidas = (grupoAgente?.variables || []).map((v) => v.id).filter((id) => !id.startsWith("agent."));
  const elegidas = salidas.filter((id) => /transcript|summary|resumen|answered|contestad|confirm|outcome|status|duration|sentiment/i.test(id));
  await actualizarNodo(w.versionId, nodoWebhook, { name: "Devolver resultado a Atalaya", configuration: configWebhook(T, trigger, canal, agente, elegidas) });
  console.log(`   ✔ webhook: ${elegidas.length ? "incluye " + elegidas.join(", ") : "sin variables de salida del agente todavía (aparecen tras la primera prueba)"}`);
  if (salidas.length) console.log(`     variables que expone el agente: ${salidas.slice(0, 30).join(", ")}`);
  const webhookProbar = nodoWebhook.id;
  return { trigger: T, agente: agente?.id, prompt: prompt?.id, webhook: webhookProbar };
}

function configWebhook(T, trigger, canal, agente, salidas) {
  const cuerpo = {
    decisionId: ref(T, idVar(trigger, "decisionId")),
    accionId: ref(T, idVar(trigger, "accionId")),
    incendioId: ref(T, idVar(trigger, "incendioId")),
    ref: "{{$var:current.run_id}}",
    run_url: "{{$var:current.run_url}}",
    ok: true,
    status: "completed",
    canal,
    en: "{{$var:time.now_iso}}",
  };
  for (const id of salidas) cuerpo[id.replace(/\W/g, "_")] = ref(agente.id, id);
  return {
    url: parrafo(variable(T, idVar(trigger, "webhook_url"))),
    params: [],
    headers: [
      { key: "x-webhook-secret", value: parrafo(variable(T, idVar(trigger, "secreto"))) },
      { key: "content-type", value: [{ type: "paragraph", children: [texto("application/json")] }] },
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

// ---- 112 entrante: llamada AL número de HappyRobot ----------------------
// Todo el montaje vive en scripts/happyrobot-entrante.mjs (contrato verificado el
// 2026-09-19). Idempotente: crea el workflow si no existe (o si lo que hay es un
// cascarón sin trigger telefónico), sincroniza número, voz, prompt y las URLs de las
// herramientas con la URL pública ACTUAL, publica y escribe las variables en .env.local.
async function entrante() {
  const publica = urlPublica();
  if (!publica) {
    console.log("✘ Sin URL pública https (data/url-publica.txt vía scripts/tunel.sh, o PUBLIC_BASE_URL): el agente de voz no podría llamar a Atalaya. Abre el túnel y repite «entrante».");
    return;
  }
  if (!ENV.HAPPYROBOT_WEBHOOK_SECRET) {
    console.log("✘ Falta HAPPYROBOT_WEBHOOK_SECRET en .env.local: las herramientas del agente no podrían autenticarse.");
    return;
  }
  const numero = await elegirNumero(api, ENV.HAPPYROBOT_NUMERO_ENTRANTE);
  console.log(`\n${NOMBRE_ENTRANTE} · número ${numero.number} · URL pública ${publica}`);
  const r = await montarEntrante(api, { urlPublica: publica, secreto: ENV.HAPPYROBOT_WEBHOOK_SECRET, numero, prompt: PROMPT_ENTRANTE });
  actualizarEstado("entrante", { id: r.workflow.id, slug: r.workflow.slug, versionId: r.versionId, nombre: NOMBRE_ENTRANTE, numero: numero.number, numeroId: numero.id, urlPublica: publica, nodos: r.ids });
  await publicarEntrante(api, r.versionId, ENTORNO);
  env();
  console.log(`\n==> Llama al ${numero.number}: te atiende «${NOMBRE_ENTRANTE}» y registra el aviso en ${publica}.`);
  console.log(`    Comprobación: curl -s ${publica}/api/happyrobot/salud | jq .entrante`);
}

async function configurar() {
  for (const clave of ["voz", "sms", "email", "entrante"]) {
    if (clave === "entrante") { await entrante(); continue; }
    if (clave === "sms") { await sms(); continue; }
    // Se relee en cada paso: «sms» y «entrante» acaban de escribir su entrada y una copia vieja la pisaría.
    const w = leerEstado()[clave];
    if (!w?.versionId) { console.log(`· ${WORKFLOWS[clave].nombre}: no creado, lo salto`); continue; }
    console.log(`\n${w.nombre} (${w.slug})`);
    try {
      const ids = await configurarSaliente(clave, w);
      actualizarEstado(clave, { ...w, nodos: ids });
    } catch (e) {
      console.log(`   ✘ ${e.message}`);
    }
  }
}

async function publicar() {
  const est = leerEstado();
  for (const clave of ["voz", "sms", "email", "entrante"]) {
    if (clave === "entrante") continue; // lo publica la orden «entrante»
    if (clave === "sms") continue; // lo publica la orden «sms»
    const w = est[clave];
    if (!w?.versionId) continue;
    if (clave === "voz" && !(ENV.DESTINO_DEMO || ENV.TELEFONO_AVISOS_SMS)) {
      console.log(`· ${w.nombre}: NO publico. Al publicar, la plataforma prueba los nodos sin probar y el de voz marcaría el teléfono de muestra. Pon DESTINO_DEMO=+34… en .env.local, repite "configurar" y luego "publicar".`);
      continue;
    }
    try {
      const r = await api("POST", `/versions/${w.versionId}/publish`, { environment: ENTORNO, force: true });
      console.log(`✔ ${w.nombre}: publicado=${r.is_published} vivo=${r.is_live} entorno=${r.environment}`);
      if (r.test_errors?.length) console.log(`   avisos de prueba: ${JSON.stringify(r.test_errors).slice(0, 500)}`);
      if (r.missing_variables?.length) console.log(`   variables sin resolver: ${JSON.stringify(r.missing_variables).slice(0, 500)}`);
    } catch (e) {
      console.log(`✘ ${w.nombre}: ${e.message}`);
    }
  }
}

function env() {
  const est = leerEstado();
  let contenido = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const poner = (variable, valor) => {
    if (!valor) return;
    const re = new RegExp(`^${variable}=.*$`, "m");
    contenido = re.test(contenido) ? contenido.replace(re, `${variable}=${valor}`) : contenido.trimEnd() + `\n${variable}=${valor}\n`;
    console.log(`  ${variable}=${valor}`);
  };
  for (const clave of ["voz", "sms", "email"]) poner(WORKFLOWS[clave].variable, est[clave]?.slug);
  // 112 por teléfono: slug del workflow y número al que llamar (lib/happyrobot/entrante.ts).
  poner(WORKFLOWS.entrante.variable, est.entrante?.slug);
  poner("HAPPYROBOT_NUMERO_ENTRANTE", est.entrante?.numero);
  fs.writeFileSync(ENV_PATH, contenido);
  console.log(`\n.env.local actualizado. Reinicia npm run dev para que la app lea las variables nuevas.`);
}

async function limpiar() {
  if (!process.argv.includes("--confirmar")) { console.log("Borra los cascarones vacíos creados a mano (0 nodos). Añade --confirmar para hacerlo."); }
  const est = leerEstado();
  const mios = new Set(Object.values(est).map((w) => w?.slug).filter(Boolean));
  const wfs = lista(await api("GET", "/workflows"));
  for (const w of wfs) {
    if (!w.name.startsWith("Atalaya · ") || mios.has(w.slug) || w.name.includes("laboratorio")) continue;
    const v = w.latest_version || {};
    const det = await api("GET", `/versions/${v.id}/`);
    const vacio = (det.node_count ?? 0) <= 1;
    console.log(`  ${w.slug} ${w.name} nodos=${det.node_count} publicado=${v.is_published} → ${vacio ? "borrable" : "TIENE CONTENIDO, no lo toco"}`);
    if (!vacio || !process.argv.includes("--confirmar")) continue;
    if (v.is_published) await api("POST", `/versions/${v.id}/unpublish`, {}).catch((e) => console.log(`   unpublish: ${e.message}`));
    await api("DELETE", `/workflows/${w.id}`);
    console.log(`   ✔ borrado`);
  }
}

// ---- SMS saliente: workflow completo nodo a nodo -----------------------
// La plantilla sms-agent exige credenciales de Twilio y dejó un cascarón vacío (0 nodos,
// sin publicar). El montaje real (trigger «Predefined request» → «Send text» → webhook de
// resultado) vive en scripts/happyrobot-sms.mjs y conserva el slug que ya está en .env.local.
// Lo usan las acciones enviar_sms del ejecutor y los SMS del agente del 112
// (lib/happyrobot/sms-avisos.ts → TELEFONO_AVISOS_SMS).
async function sms() {
  const r = await montarSms(api, { log: console.log });
  actualizarEstado("sms", { id: r.workflow.id, slug: r.workflow.slug, versionId: r.versionId, nombre: NOMBRE_SMS, nodos: r.ids, salidas: r.salidas });
  await publicarSms(api, r.versionId, ENTORNO);
  env();
  console.log(`\n==> SMS listo: Atalaya dispara POST /api/v2/workflows/${r.workflow.slug}/runs?environment=${ENTORNO} con { payload: { telefono, texto, … } }.`);
  console.log(`    Prueba real: node scripts/happyrobot-workflows.mjs sms-prueba +34… "texto"`);
}

/** Manda un SMS DE VERDAD por el workflow publicado (destino: argumento, TELEFONO_AVISOS_SMS o DESTINO_DEMO). */
async function smsPrueba() {
  const est = leerEstado();
  const slug = est.sms?.slug || ENV.HAPPYROBOT_WORKFLOW_SLUG_SMS;
  if (!slug) { console.log("✘ No hay workflow de SMS: ejecuta antes «sms»."); return; }
  const arg = (process.argv[3] || "").trim();
  const esTelefono = /^\+\d{7,15}$/.test(arg);
  const destino = esTelefono ? arg : ENV.TELEFONO_AVISOS_SMS || ENV.DESTINO_DEMO;
  if (!destino) { console.log("✘ Falta el destino: pásalo como argumento (+34…) o pon TELEFONO_AVISOS_SMS / DESTINO_DEMO en .env.local."); return; }
  const textoSms = (esTelefono ? process.argv[4] : process.argv[3]) || `Atalaya 112: SMS de prueba del workflow ${slug} (${new Date().toLocaleTimeString("es-ES")}).`;
  const publica = urlPublica();
  console.log(`\n${NOMBRE_SMS} (${slug}) → ${destino} · webhook de resultado: ${publica ? publica + "/api/webhooks/happyrobot/resultado" : "(sin URL pública: no habrá retorno)"}`);
  await probarSms(api, { slug, entorno: ENTORNO, destino, texto: textoSms, webhookUrl: publica ? `${publica}/api/webhooks/happyrobot/resultado` : "", secreto: ENV.HAPPYROBOT_WEBHOOK_SECRET || "" });
}

// ---- main ---------------------------------------------------------------
const orden = process.argv[2] || "estado";
const pasos = { estado, crear, configurar, publicar, env, limpiar, entrante, sincronizar: entrante, sms, "sms-prueba": smsPrueba, todo: async () => { await crear(); await configurar(); await publicar(); env(); } };
if (!pasos[orden]) { console.error(`Orden desconocida: ${orden}. Usa: ${Object.keys(pasos).join(" | ")}`); process.exit(1); }
pasos[orden]().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
