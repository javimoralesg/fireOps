// =====================================================================
// ATALAYA INCENDIOS · Workflow «Atalaya · 112 entrante» (llamar AL número de HappyRobot)
// ---------------------------------------------------------------------
// Lo importa scripts/happyrobot-workflows.mjs (órdenes `entrante` y `sincronizar`).
// Las funciones `definir*`/`cuerpo*`/`config*` son PURAS y las prueba
// tests/unit/happyrobot-entrante-workflow.test.ts; `montarEntrante`,
// `sincronizarEntrante` y `publicarEntrante` hablan con la API v2 a través del
// `api(metodo, ruta, cuerpo)` que se les pasa.
//
// Contrato VERIFICADO el 2026-09-19 contra la instancia EU (sesión fireops-82):
//   · El trigger «Inbound to number» (integración "Phone calls") es el que engancha
//     el número: configuration.numbers = [{ id, name, number }], con los datos de
//     GET /phone-numbers/. Con la versión publicada en producción, las llamadas al
//     número entran por este workflow.
//   · El agente se crea con type:"agent" + `prompt` y la plataforma le cuelga el
//     nodo prompt; las herramientas (type:"tool") quedan bajo ESE nodo prompt (la
//     API las reubica aunque se les dé el agente como padre).
//   · Un nodo Webhook POST bajo una herramienta es lo que se ejecuta al invocarla;
//     su respuesta es el "Tool Call Result" que lee el agente. PUT …/custom-output
//     fija la forma de esa respuesta sin URL viva, y así la versión se publica.
//   · PUT sobre un nodo NO cambia su event_id: el trigger telefónico se crea de cero.
//   · Variables: {{$var:<idNodo>.<campo>}}. Del agente entrante: from (número del
//     llamante), transcript, duration, call_end_event. De la herramienta: sus params.
// NADA SIMULADO: cada paso enseña la respuesta real y, si algo falla, se para.
// =====================================================================

export const EVENTOS_ENTRANTE = {
  inboundToNumber: "0192a20c-cb70-7bf2-977a-b7edc14dcd66", // Phone calls · Inbound to number (trigger)
  inboundVoiceAgent: "0192e5dc-08df-78bf-a549-f43c6bf9f087", // AI Agent · Inbound Voice Agent
  webhookPost: "01926f2b-2973-7ebf-ada1-e984251e27ec", // Webhook · POST
};

export const NOMBRE_ENTRANTE = "Atalaya · 112 entrante";
// Nombre de la persona-agente (puede decirlo si le preguntan con quién habla): sin "112" (petición de Javi, 19-09).
export const NOMBRE_AGENTE_ENTRANTE = "Atalaya · Emergencias";
export const NOMBRES_NODOS = {
  trigger: "Llamada al 112 virtual",
  agente: "Centralita 112",
  situar: "situar_lugar",
  situarAccion: "Situar el lugar en Atalaya",
  consultar: "consultar_zona",
  consultarAccion: "Consultar focos cercanos en Atalaya",
  registrar: "registrar_aviso",
  registrarAccion: "Registrar el aviso en Atalaya",
  sms: "enviar_sms",
  smsAccion: "Enviar SMS desde Atalaya",
  colgar: "Entregar la llamada a Atalaya",
};

export const VOZ_ES = { id: "31hktsdrgix8", name: "Ana HR" }; // es-ES, proveedor happyrobot
export const IDIOMA = { id: "es", name: "Spanish" };
export const ACENTO = { id: "es-es", name: "Spanish (Spain)" };
export const MODELO = { type: "static", static: { id: "gpt-4.1", name: "gpt-4.1" } };
// Sin "ciento doce" ni "incendios forestales" (petición de Javi tras escuchar las llamadas del 19-09).
export const MENSAJE_INICIAL = "Emergencias, dígame. ¿Qué ocurre y dónde está?";
/** Tope duro de la llamada (segundos). Medido el 19-09: sin tope corto y con las herramientas caídas se alargaba varios minutos. */
export const DURACION_MAX_SEG = 240;

/** Marcas en los cuerpos de los webhooks que se sustituyen por los ids reales tras crear los nodos. */
export const MARCAS = { situar: "__HERRAMIENTA_SITUAR__", consultar: "__HERRAMIENTA_CONSULTAR__", registrar: "__HERRAMIENTA_REGISTRAR__", sms: "__HERRAMIENTA_SMS__", agente: "__AGENTE__" };

/** Palabras que el reconocimiento de voz debe favorecer (nombres de sitio y jerga del aviso). */
// La plataforma rechaza keyterms de más de 50 caracteres (medido: la versión quedó sin publicar).
export const KEYTERM_MAX = 50;
export const KEYTERMS = ["incendio", "humo", "llamas", "punto kilométrico", "cortafuegos", "urbanización", "ermita", "paraje", "Avenida Complutense", "Ciudad Universitaria", "Aravaca", "Moncloa", "Navalacruz", "Ávila", "ETSI de Telecomunicación"].filter((k) => k.length <= KEYTERM_MAX);

export const texto = (t) => [{ type: "paragraph", children: [{ text: t }] }];
export const ref = (grupo, id) => `{{$var:${grupo}.${id}}}`;
export const lista = (r) => (Array.isArray(r) ? r : r?.data ?? []);

/** Endpoints de Atalaya que usa el workflow, a partir de la URL pública https. */
export function urlsEntrante(urlPublica) {
  const base = String(urlPublica || "").replace(/\/+$/, "");
  return {
    situar: `${base}/api/happyrobot/situar`,
    consultar: `${base}/api/happyrobot/contexto`,
    registrar: `${base}/api/happyrobot/aviso`,
    sms: `${base}/api/happyrobot/sms`,
    colgar: `${base}/api/webhooks/happyrobot/llamada`,
    salud: `${base}/api/happyrobot/salud`,
  };
}

export function configWebhook(url, secreto, cuerpo) {
  return {
    url: texto(url),
    params: [],
    headers: [
      { key: "x-webhook-secret", value: texto(secreto) },
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

export function configAgente(nombreAgente = NOMBRE_AGENTE_ENTRANTE) {
  return {
    agent: {
      name: texto(nombreAgente),
      voices: [{ type: "static", static: VOZ_ES }],
      languages: [{ type: "static", static: IDIOMA }],
      language_accents: [{ type: "static", static: ACENTO }],
    },
    record: true,
    // Ruido de sala: el reconocimiento de voz limpia el fondo para que un murmullo no corte al agente.
    enable_denoised_stt: true,
    keyterms: KEYTERMS,
    // Una llamada de aviso tiene que durar uno o dos minutos: tope duro de 4.
    max_call_duration: DURACION_MAX_SEG,
    business_hours_setting_name: "default",
  };
}

/** Parámetros que el agente rellena al llamar a cada herramienta (binding "agent"). */
export const PARAMETROS_SITUAR = [
  { name: "lugar", desc: "Lo que dice la persona del sitio: calle y número, carretera y kilómetro, paraje, urbanización o edificio conocido. Números en cifras (30, no 'treinta')", example: "Avenida Complutense 30", required: true },
  { name: "municipio", desc: "Municipio o pueblo más cercano; vacío si aún no lo ha dicho", example: "Madrid", required: false },
];
export const PARAMETROS_CONSULTAR = [
  { name: "lugar", desc: "Municipio o lugar que dice la persona (pueblo, carretera y punto kilométrico, paraje)", example: "Navalacruz, Ávila", required: true },
];
export const PARAMETROS_REGISTRAR = [
  { name: "municipio", desc: "Municipio o pueblo más cercano, tal y como lo dice la persona", example: "Navalacruz", required: true },
  { name: "lugar", desc: "Referencia del sitio si la da: carretera y punto kilométrico, paraje, ermita, urbanización, cortafuegos; vacío si solo dice el pueblo", example: "N-403 km 62, junto a la ermita", required: false },
  { name: "que_ve", desc: "Qué ve la persona con sus palabras: humo o llamas, color del humo, si avanza y hacia dónde, cuánto ocupa", example: "Una columna de humo negro que sube desde el pinar y avanza hacia el pueblo", required: true },
  { name: "tipo", desc: "humo, llamas, humo y llamas, olor a quemado u otro", example: "humo", required: false },
  { name: "personas_en_riesgo", desc: "sí o no: personas, ganado o coches atrapados o en peligro", example: "no", required: false },
  { name: "viviendas_cerca", desc: "sí o no: casas, urbanización o carretera con tráfico cerca del fuego", example: "sí", required: false },
  { name: "tamano", desc: "Tamaño con las palabras de la persona", example: "como un campo de fútbol", required: false },
  { name: "telefono", desc: "Teléfono de contacto que dicte la persona; vacío si no lo dice", example: "+34600111222", required: false },
  { name: "lat", desc: "Latitud que devolvió situar_lugar una vez confirmado el sitio con la persona; vacío si no se pudo situar", example: "40.45287", required: false },
  { name: "lon", desc: "Longitud que devolvió situar_lugar una vez confirmado el sitio; vacío si no se pudo situar", example: "-3.72556", required: false },
];
/** Herramienta enviar_sms: texto libre al teléfono de TELEFONO_AVISOS_SMS (lib/happyrobot/sms-avisos.ts). El agente NO elige el número. */
export const PARAMETROS_SMS = [
  { name: "texto", desc: "Texto del SMS para la sala, en una o dos frases: qué pasa, dónde y qué hay que saber ya (personas atrapadas, cambio de situación, dato nuevo tras registrar, mensaje que pide la persona)", example: "Dos personas atrapadas en una casa junto a la N-403 km 62, Navalacruz; el humo ya llega a la carretera", required: true },
  { name: "motivo", desc: "Por qué se manda: personas_en_riesgo, cambio_situacion, dato_nuevo, peticion_persona u otro", example: "personas_en_riesgo", required: false },
];
const parametro = (p) => ({ name: p.name, description: texto(p.desc), example: p.example, required: p.required, binding: { mode: "agent" } });

export function cuerpoSituar(toolId) {
  return { lugar: ref(toolId, "lugar"), municipio: ref(toolId, "municipio"), canal: "llamada", run_id: ref("current", "run_id") };
}
export function cuerpoConsultar(toolId) {
  return { lugar: ref(toolId, "lugar"), canal: "llamada", run_id: ref("current", "run_id") };
}
export function cuerpoRegistrar(toolId, agenteId) {
  return {
    run_id: ref("current", "run_id"),
    canal: "llamada",
    telefono: ref(toolId, "telefono"),
    telefono_llamante: ref(agenteId, "from"),
    municipio: ref(toolId, "municipio"),
    lugar: ref(toolId, "lugar"),
    que_ve: ref(toolId, "que_ve"),
    tipo: ref(toolId, "tipo"),
    personas_en_riesgo: ref(toolId, "personas_en_riesgo"),
    viviendas_cerca: ref(toolId, "viviendas_cerca"),
    tamano: ref(toolId, "tamano"),
    lat: ref(toolId, "lat"),
    lon: ref(toolId, "lon"),
  };
}
export function cuerpoSms(toolId, agenteId) {
  return { run_id: ref("current", "run_id"), canal: "llamada", texto: ref(toolId, "texto"), motivo: ref(toolId, "motivo"), telefono_llamante: ref(agenteId, "from") };
}
export function cuerpoColgar(agenteId) {
  return {
    run_id: ref("current", "run_id"),
    run_url: ref("current", "run_url"),
    en: ref("time", "now_iso"),
    canal: "llamada",
    telefono: ref(agenteId, "from"),
    transcripcion: ref(agenteId, "transcript"),
    duracion_seg: ref(agenteId, "duration"),
    fin: ref(agenteId, "call_end_event"),
  };
}

/** Respuestas de muestra de Atalaya: fijan el "Tool Call Result" (custom-output) sin URL viva. */
export const SALIDAS_MUESTRA = {
  situar: {
    encontrado: true,
    precision: "direccion",
    nombre: "Edificio B, ETSI de Telecomunicación",
    municipio: "Madrid",
    provincia: "Madrid",
    lat: 40.45287,
    lon: -3.72556,
    consulta: "Avenida Complutense 30, Madrid",
    interpretacion: "Avenida Complutense 30, Ciudad Universitaria, Madrid",
    correcciones: "Arabaca → Aravaca; treinta → 30",
    origen: "ia",
    mensajeParaLocutor: "Localizado en Avenida Complutense 30, Madrid.",
  },
  consultar: {
    incendiosCercanos: [{ nombre: "Incendio de Navalacruz", distanciaKm: 3.2, estado: "activo", consejo: "Prepárese para salir y esté pendiente del teléfono." }],
    consejoGeneral: "Tiene un incendio activo cerca. El más próximo, Incendio de Navalacruz, está a 3,2 kilómetros. Prepárese para salir y esté pendiente del teléfono.",
  },
  registrar: {
    registrado: true,
    observacionId: "obs-demo",
    registro: "nuevo",
    impacto: "nuevo_foco",
    verificacion: "Foco nuevo declarado (Incendio de Navalacruz) por extracción fiable (0.70)",
    foco: { id: "inc-demo", nombre: "Incendio de Navalacruz", municipio: "Navalacruz", estado: "detectado", confianza: 0.7 },
    geolocalizada: true,
    enAnalisis: false,
    extraccion: "ia",
    mensajeParaLocutor: "Aviso registrado. La sala ha abierto un foco nuevo en Navalacruz y está enviando medios. Aléjese del humo, nunca ladera arriba, y no se acerque a mirar.",
  },
  sms: { enviado: true, referencia: "run-sms-demo", destino: "+346***22", error: null, mensajeParaLocutor: "Ya lo he pasado por SMS a la sala de coordinación." },
  colgar: { recibido: true, observacionId: "obs-demo", impacto: "nuevo_foco", adjuntada: true },
};

/**
 * Las tres herramientas del agente, cada una con su nodo `tool` y su Webhook POST hijo
 * (lo que se ejecuta al invocarla) y la respuesta de muestra que fija su Tool Call Result.
 */
export function definicionHerramientas({ urlPublica, secreto }) {
  const u = urlsEntrante(urlPublica);
  return {
    situar: {
      tool: {
        type: "tool",
        name: NOMBRES_NODOS.situar,
        function: {
          description: texto("Sitúa en el mapa el lugar que dice la persona (calle y número, carretera y kilómetro, paraje, pueblo) y devuelve con qué precisión y una frase para confirmarlo con ella. Úsala en cuanto tengas una referencia y cada vez que la persona corrija el sitio."),
          // Frase exacta mientras espera. El tipo "fixed" NO se puede fijar por la API (descarta el texto
          // y publicar falla con "Missing required fields: message", medido el 19-09): "ai" con la frase literal.
          message: { type: "ai", description: texto("Di exactamente «Lo busco en el mapa.» y nada más.") },
          parameters: PARAMETROS_SITUAR.map(parametro),
        },
      },
      accion: { type: "action", event_id: EVENTOS_ENTRANTE.webhookPost, name: NOMBRES_NODOS.situarAccion, configuration: configWebhook(u.situar, secreto, cuerpoSituar(MARCAS.situar)) },
      muestra: SALIDAS_MUESTRA.situar,
    },
    consultar: {
      tool: {
        type: "tool",
        name: NOMBRES_NODOS.consultar,
        function: {
          description: texto("Consulta en Atalaya si ya hay un incendio conocido cerca del lugar que dice la persona y qué consejo darle. Solo si la persona pregunta si ya se sabe del fuego o qué debe hacer."),
          message: { type: "ai", description: texto("Di brevemente que lo compruebas en el sistema.") },
          parameters: PARAMETROS_CONSULTAR.map(parametro),
        },
      },
      accion: { type: "action", event_id: EVENTOS_ENTRANTE.webhookPost, name: NOMBRES_NODOS.consultarAccion, configuration: configWebhook(u.consultar, secreto, cuerpoConsultar(MARCAS.consultar)) },
      muestra: SALIDAS_MUESTRA.consultar,
    },
    registrar: {
      tool: {
        type: "tool",
        name: NOMBRES_NODOS.registrar,
        function: {
          description: texto("Registra el aviso en Atalaya (sala de coordinación): crea la observación, la sitúa en el mapa con las coordenadas confirmadas y, si procede, declara el foco. Úsala UNA sola vez por llamada, en cuanto tengas municipio y qué ve; nunca una segunda vez aunque la persona añada datos."),
          // Frase exacta (en la llamada de las 18:33 dijo "lo paso a la sala" dos veces seguidas).
          message: { type: "ai", description: texto("Di exactamente «Un momento, lo paso a la sala.» y nada más; no la repitas.") },
          parameters: PARAMETROS_REGISTRAR.map(parametro),
        },
      },
      accion: { type: "action", event_id: EVENTOS_ENTRANTE.webhookPost, name: NOMBRES_NODOS.registrarAccion, configuration: configWebhook(u.registrar, secreto, cuerpoRegistrar(MARCAS.registrar, MARCAS.agente)) },
      muestra: SALIDAS_MUESTRA.registrar,
    },
    // SMS al teléfono del .env (TELEFONO_AVISOS_SMS): POST /api/happyrobot/sms → lib/happyrobot/sms-avisos.ts (sesión fireops-00).
    sms: {
      tool: {
        type: "tool",
        name: NOMBRES_NODOS.sms,
        function: {
          description: texto("Manda un SMS a la sala de coordinación (teléfono fijo de Atalaya: tú no eliges el número). El aviso que registras ya llega por SMS automáticamente, así que úsala SOLO para lo que la sala deba saber ya y no quepa en registrar_aviso: personas atrapadas o heridas, un cambio de situación después de registrar, un dato nuevo, o un mensaje que la persona pide expresamente que transmitas. Una o dos frases, con el pueblo."),
          message: { type: "ai", description: texto("Di brevemente que lo pasas por SMS a la sala.") },
          parameters: PARAMETROS_SMS.map(parametro),
        },
      },
      accion: { type: "action", event_id: EVENTOS_ENTRANTE.webhookPost, name: NOMBRES_NODOS.smsAccion, configuration: configWebhook(u.sms, secreto, cuerpoSms(MARCAS.sms, MARCAS.agente)) },
      muestra: SALIDAS_MUESTRA.sms,
    },
  };
}

/** Orden fijo de las herramientas (el mismo en la creación y en la sincronización). */
export const ORDEN_HERRAMIENTAS = ["situar", "consultar", "registrar", "sms"];

/**
 * Los nodos del workflow, listos para POST /versions/{id}/nodes (una sola petición,
 * encadenados por parent_node_index): trigger, agente (+prompt automático), tres
 * herramientas con su webhook y el webhook de colgar. Los cuerpos de los webhooks llevan
 * MARCAS que `sincronizarEntrante` sustituye por los ids reales.
 */
export function definirNodosEntrante({ urlPublica, secreto, numero, prompt, mensajeInicial = MENSAJE_INICIAL, nombreAgente = NOMBRE_AGENTE_ENTRANTE }) {
  if (!numero?.id || !numero?.number) throw new Error("Falta el número de teléfono ({id, number} de GET /phone-numbers/)");
  if (!/^https:\/\//.test(String(urlPublica || ""))) throw new Error("Falta la URL pública https (túnel o PUBLIC_BASE_URL): sin ella el agente no puede llamar a Atalaya");
  if (!secreto) throw new Error("Falta HAPPYROBOT_WEBHOOK_SECRET");
  if (!prompt || !prompt.trim()) throw new Error("Falta el prompt del agente entrante (docs/HAPPYROBOT.md §3.4)");
  const u = urlsEntrante(urlPublica);
  const herramientas = definicionHerramientas({ urlPublica, secreto });
  const nodos = [
    {
      type: "trigger",
      event_id: EVENTOS_ENTRANTE.inboundToNumber,
      name: NOMBRES_NODOS.trigger,
      configuration: { numbers: [{ id: numero.id, name: numero.name ?? numero.number, number: numero.number }], require_webcall_auth: true, open_runs_page_on_trigger: false },
    },
    {
      type: "agent",
      event_id: EVENTOS_ENTRANTE.inboundVoiceAgent,
      name: NOMBRES_NODOS.agente,
      parent_node_index: 0,
      configuration: configAgente(nombreAgente),
      // El saludo se dice entero aunque haya ruido: si no, el agente arranca a medias.
      prompt: { prompt_md: prompt, initial_message: texto(mensajeInicial), initial_message_uninterruptible: true },
    },
  ];
  for (const clave of ORDEN_HERRAMIENTAS) {
    const h = herramientas[clave];
    nodos.push({ ...h.tool, parent_node_index: 1 });
    nodos.push({ ...h.accion, parent_node_index: nodos.length - 1 });
  }
  nodos.push({ type: "action", event_id: EVENTOS_ENTRANTE.webhookPost, name: NOMBRES_NODOS.colgar, parent_node_index: 1, configuration: configWebhook(u.colgar, secreto, cuerpoColgar(MARCAS.agente)) });
  return nodos;
}

/** Localiza cada nodo por su papel (nombres de NOMBRES_NODOS; el prompt, por tipo). */
export function clasificarNodos(nodos) {
  const porNombre = (n) => nodos.find((x) => x.name === n);
  const trigger = nodos.find((n) => !n.parent_id && n.event_id === EVENTOS_ENTRANTE.inboundToNumber) ?? nodos.find((n) => !n.parent_id);
  const agente = nodos.find((n) => n.event_id === EVENTOS_ENTRANTE.inboundVoiceAgent);
  return {
    trigger,
    agente,
    prompt: nodos.find((n) => n.type === "prompt" && n.parent_id === agente?.id) ?? nodos.find((n) => n.type === "prompt"),
    situar: porNombre(NOMBRES_NODOS.situar),
    situarAccion: porNombre(NOMBRES_NODOS.situarAccion),
    consultar: porNombre(NOMBRES_NODOS.consultar),
    consultarAccion: porNombre(NOMBRES_NODOS.consultarAccion),
    registrar: porNombre(NOMBRES_NODOS.registrar),
    registrarAccion: porNombre(NOMBRES_NODOS.registrarAccion),
    sms: porNombre(NOMBRES_NODOS.sms),
    smsAccion: porNombre(NOMBRES_NODOS.smsAccion),
    colgar: porNombre(NOMBRES_NODOS.colgar),
  };
}

/**
 * Campos de la respuesta de un nodo que el agente debe ver: todos los que genera la
 * plataforma a partir de la salida de muestra (`fields[].path` del inspect). Sin exponerlos,
 * el agente recibe {"steps":[]} y habla a ciegas.
 */
export function camposAExponer(nodo) {
  return [...new Set((nodo?.fields || []).map((f) => f?.path).filter((p) => typeof p === "string" && p))];
}

export function resolverMarcas(raw, ids) {
  return String(raw).split(MARCAS.situar).join(ids.situar).split(MARCAS.consultar).join(ids.consultar).split(MARCAS.registrar).join(ids.registrar).split(MARCAS.sms).join(ids.sms ?? MARCAS.sms).split(MARCAS.agente).join(ids.agente);
}

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------

/** El número de la organización: el de HAPPYROBOT_NUMERO_ENTRANTE si está, o el único/primero. */
export async function elegirNumero(api, preferido) {
  const numeros = lista(await api("GET", "/phone-numbers/"));
  if (!numeros.length) throw new Error("La organización no tiene ningún número de teléfono en HappyRobot (Telephony)");
  if (preferido) {
    const n = numeros.find((x) => x.number === preferido);
    if (!n) throw new Error(`El número ${preferido} (HAPPYROBOT_NUMERO_ENTRANTE) no está en la organización: hay ${numeros.map((x) => x.number).join(", ")}`);
    return n;
  }
  return numeros[0];
}

/** PUT tolerante con el discriminador: GET devuelve triggers y agentes como "action". */
async function actualizar(api, versionId, nodo, cuerpo, tipos) {
  let ultimo;
  for (const tipo of tipos) {
    try {
      return await api("PUT", `/versions/${versionId}/nodes/${nodo.id}`, { type: tipo, ...(tipo === "prompt" ? {} : { event_id: nodo.event_id }), ...cuerpo });
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo;
}

/**
 * Deja el workflow apuntando a la URL pública actual: número, voz, prompt, las tres
 * URLs con el secreto y las salidas de muestra. Si la versión está publicada, la
 * despublica antes (la API no deja editar una versión viva) y la vuelve a publicar
 * quien llama. Devuelve los ids reales de las herramientas y del agente.
 */
export async function sincronizarEntrante(api, opciones) {
  const { versionId, urlPublica, secreto, numero, prompt, mensajeInicial = MENSAJE_INICIAL, nombreAgente = NOMBRE_AGENTE_ENTRANTE, log = console.log } = opciones;
  if (!/^https:\/\//.test(String(urlPublica || ""))) throw new Error("Falta la URL pública https (abre scripts/tunel.sh o pon PUBLIC_BASE_URL)");
  const version = await api("GET", `/versions/${versionId}/`);
  if (version.is_published) {
    await api("POST", `/versions/${versionId}/unpublish`, {});
    log("· versión despublicada para poder editarla (se vuelve a publicar al final)");
  }
  let c = clasificarNodos(lista(await api("GET", `/versions/${versionId}/nodes`)));
  for (const papel of ["trigger", "agente", "prompt", "colgar"]) if (!c[papel]) throw new Error(`El workflow no tiene el nodo «${papel}»: bórralo en la plataforma y repite «entrante»`);
  // Herramientas que falten (p. ej. situar_lugar añadida después de crear el workflow): se crean
  // bajo el nodo prompt, que es donde la plataforma las cuelga, con su Webhook POST hijo.
  const herramientas = definicionHerramientas({ urlPublica, secreto });
  for (const clave of ORDEN_HERRAMIENTAS) {
    if (c[clave]) continue;
    const h = herramientas[clave];
    await api("POST", `/versions/${versionId}/nodes`, { nodes: [{ ...h.tool, parent_node_id: c.prompt.id }, { ...h.accion, parent_node_index: 0 }] });
    log(`   ✔ herramienta «${h.tool.name}» creada (faltaba) con su webhook`);
  }
  c = clasificarNodos(lista(await api("GET", `/versions/${versionId}/nodes`)));
  for (const [papel, n] of Object.entries(c)) if (!n) throw new Error(`El workflow no tiene el nodo «${papel}» tras crearlo: revisa la plataforma`);
  const ids = { situar: c.situar.id, consultar: c.consultar.id, registrar: c.registrar.id, sms: c.sms.id, agente: c.agente.id };
  const u = urlsEntrante(urlPublica);

  await actualizar(api, versionId, c.trigger, { name: NOMBRES_NODOS.trigger, configuration: { ...c.trigger.configuration, numbers: [{ id: numero.id, name: numero.name ?? numero.number, number: numero.number }] } }, ["action", "trigger"]);
  log(`   ✔ trigger «Inbound to number» → ${numero.number}`);
  await actualizar(api, versionId, c.agente, { name: NOMBRES_NODOS.agente, configuration: { ...c.agente.configuration, ...configAgente(nombreAgente) } }, ["action", "agent"]);
  log(`   ✔ agente entrante: voz ${VOZ_ES.name} (es-ES), grabación activada`);
  await actualizar(api, versionId, c.prompt, { prompt_md: prompt, initial_message: texto(mensajeInicial), initial_message_uninterruptible: true, model: MODELO }, ["prompt"]);
  log(`   ✔ prompt (${prompt.length} caracteres) y saludo inicial`);
  // Definición de las herramientas (descripción y parámetros): también se resincroniza, para que un
  // cambio en PARAMETROS_* llegue a la plataforma sin recrear el workflow.
  for (const clave of ORDEN_HERRAMIENTAS) {
    const h = herramientas[clave];
    await api("PUT", `/versions/${versionId}/nodes/${c[clave].id}`, { type: "tool", name: h.tool.name, function: h.tool.function });
  }
  log(`   ✔ herramientas: situar_lugar (${PARAMETROS_SITUAR.length}), consultar_zona (${PARAMETROS_CONSULTAR.length}), registrar_aviso (${PARAMETROS_REGISTRAR.length}; obligatorios: ${PARAMETROS_REGISTRAR.filter((p) => p.required).map((p) => p.name).join(", ")}) y enviar_sms (${PARAMETROS_SMS.length})`);

  const poner = async (nodo, url, cuerpo, muestra) => {
    const raw = resolverMarcas(JSON.stringify(cuerpo), ids);
    await actualizar(api, versionId, nodo, { name: nodo.name, configuration: configWebhook(url, secreto, JSON.parse(raw)) }, ["action"]);
    await api("PUT", `/versions/${versionId}/nodes/${nodo.id}/custom-output`, { data: muestra });
  };
  await poner(c.situarAccion, u.situar, cuerpoSituar(MARCAS.situar), SALIDAS_MUESTRA.situar);
  await poner(c.consultarAccion, u.consultar, cuerpoConsultar(MARCAS.consultar), SALIDAS_MUESTRA.consultar);
  await poner(c.registrarAccion, u.registrar, cuerpoRegistrar(MARCAS.registrar, MARCAS.agente), SALIDAS_MUESTRA.registrar);
  await poner(c.smsAccion, u.sms, cuerpoSms(MARCAS.sms, MARCAS.agente), SALIDAS_MUESTRA.sms);
  await poner(c.colgar, u.colgar, cuerpoColgar(MARCAS.agente), SALIDAS_MUESTRA.colgar);
  log(`   ✔ herramientas y webhook de colgar → ${urlPublica} (x-webhook-secret puesto)`);
  // Publicar exige haber "abierto" el Tool Call Result de cada herramienta (lo que el agente
  // recibe de sus nodos hijos): `inspect` lo deja reconocido (ack) a partir de la salida de
  // muestra. NO se usa `sync`/`generate`: ejecutarían el webhook de verdad contra Atalaya y
  // cada sincronización registraría un aviso de prueba.
  // Y EXPONER sus campos: por defecto la plataforma los deja ocultos y el agente recibe
  // {"steps":[]} en vez de la respuesta de Atalaya (medido el 19-09 en la llamada de las 17:56: el
  // agente llamó cinco veces a situar_lugar a ciegas y se inventó la confirmación y las coordenadas).
  for (const herramienta of [c.situar, c.consultar, c.registrar, c.sms]) {
    const r = await api("POST", `/versions/${versionId}/tools/${herramienta.id}/tool-call-result/inspect`, {});
    const d = r?.data ?? r;
    for (const nodo of d?.nodes || []) {
      const campos = camposAExponer(nodo);
      if (campos.length) await api("PUT", `/versions/${versionId}/tools/${herramienta.id}/tool-call-result/visibility`, { node_id: nodo.node_id, exposed_fields: campos });
    }
    const r2 = await api("POST", `/versions/${versionId}/tools/${herramienta.id}/tool-call-result/inspect`, {});
    const d2 = r2?.data ?? r2;
    const estados = (d2?.nodes || [])
      .map((n) => `${n.name}: ${n.state}${n.error ? " (" + n.error + ")" : ""} · ${(n.fields || []).filter((f) => f.exposed).length}/${(n.fields || []).length} campos visibles`)
      .join("; ");
    const ocultos = (d2?.nodes || []).flatMap((n) => (n.fields || []).filter((f) => !f.exposed).map((f) => f.path));
    if (ocultos.length) throw new Error(`${herramienta.name}: el agente no vería ${ocultos.join(", ")} (la plataforma no los ha expuesto)`);
    log(`   ✔ Tool Call Result de ${herramienta.name}: ${d2?.ack_state ?? "?"} · ${estados || "sin nodos"}`);
  }
  return ids;
}

/**
 * Crea el workflow si no existe (o si lo que hay es un cascarón sin trigger
 * telefónico) y lo sincroniza. Idempotente: se puede lanzar cada vez que cambia
 * la URL del túnel.
 */
export async function montarEntrante(api, opciones) {
  const log = opciones.log ?? console.log;
  const wfs = lista(await api("GET", "/workflows"));
  let w = wfs.find((x) => x.name === NOMBRE_ENTRANTE);
  let versionId;
  let creadoAhora = false;
  if (w) {
    const v = w.latest_version || {};
    const det = await api("GET", `/versions/${v.id}/`);
    const eventos = (det.events || []).map((e) => e.event_id);
    if (eventos.includes(EVENTOS_ENTRANTE.inboundToNumber) && (det.node_count ?? 0) >= 7) {
      versionId = v.id;
      log(`· ${NOMBRE_ENTRANTE}: ya montado (${w.slug}, ${det.node_count} nodos); sincronizo URLs, número y prompt`);
    } else {
      if (v.is_published) await api("POST", `/versions/${v.id}/unpublish`, {});
      await api("DELETE", `/workflows/${w.id}`);
      log(`· ${NOMBRE_ENTRANTE}: borrado el cascarón ${w.slug} (${det.node_count ?? 0} nodos, sin trigger telefónico)`);
      w = undefined;
    }
  }
  if (!w) {
    w = await api("POST", "/workflows/", { name: NOMBRE_ENTRANTE, icon: "phone" });
    versionId = w.latest_version.id;
    creadoAhora = true;
    log(`✔ workflow creado: slug=${w.slug} versión=${versionId}`);
    const nodos = definirNodosEntrante(opciones);
    const creados = lista(await api("POST", `/versions/${versionId}/nodes`, { nodes: nodos }));
    log(`✔ ${creados.length} nodos creados: trigger telefónico, agente (+prompt), situar_lugar, consultar_zona, registrar_aviso, enviar_sms y webhook de colgar`);
  }
  const ids = await sincronizarEntrante(api, { ...opciones, versionId, log });
  return { workflow: w, versionId, creadoAhora, ids };
}

export async function publicarEntrante(api, versionId, entorno = "production", log = console.log) {
  const r = await api("POST", `/versions/${versionId}/publish`, { environment: entorno, force: true });
  log(`✔ ${NOMBRE_ENTRANTE}: publicado=${r.is_published} vivo=${r.is_live} entorno=${r.environment}`);
  if (r.test_errors?.length) log(`   avisos de prueba: ${JSON.stringify(r.test_errors).slice(0, 600)}`);
  if (r.missing_variables?.length) log(`   variables sin resolver: ${JSON.stringify(r.missing_variables).slice(0, 600)}`);
  return r;
}
