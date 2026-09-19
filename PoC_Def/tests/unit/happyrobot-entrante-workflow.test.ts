// Pruebas de scripts/happyrobot-entrante.mjs · la definición del workflow «Atalaya · 112
// entrante» que se manda a la API de HappyRobot, y su coherencia con la app
// (lib/happyrobot/entrante.ts) y con la guía (docs/HAPPYROBOT.md). Sin red.
// DUEÑO: sesión fireops-82 (2026-09-19).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  clasificarNodos,
  cuerpoColgar,
  cuerpoConsultar,
  cuerpoRegistrar,
  cuerpoSms,
  definirNodosEntrante,
  EVENTOS_ENTRANTE,
  MARCAS,
  NOMBRES_NODOS,
  PARAMETROS_REGISTRAR,
  PARAMETROS_SMS,
  resolverMarcas,
  SALIDAS_MUESTRA,
  urlsEntrante,
} from "@/scripts/happyrobot-entrante.mjs";
import { avisoDesdeCuerpo } from "@/lib/happyrobot/entrante";

const NUMERO = { id: "3052015413857617248", name: "Test", number: "+15734018744" };
const OPCIONES = { urlPublica: "https://ejemplo.trycloudflare.com/", secreto: "secreto-prueba", numero: NUMERO, prompt: "Eres el operador del 112. Usa consultar_zona y registrar_aviso." };

type Nodo = { type: string; name: string; event_id?: string; parent_node_index?: number; configuration?: Record<string, unknown>; prompt?: Record<string, unknown>; function?: { parameters: { name: string; required: boolean; binding: { mode: string } }[] } };
type ConfWebhook = { url: { children: { text: string }[] }[]; headers: { key: string; value: { children: { text: string }[] }[] }[]; body: { raw: string } };
const textoDe = (p: { children: { text: string }[] }[]) => p.map((x) => x.children.map((c) => c.text).join("")).join("");

describe("definirNodosEntrante · los once nodos que se mandan a la API", () => {
  const nodos = definirNodosEntrante(OPCIONES) as Nodo[];
  const porNombre = (n: string) => nodos.find((x) => x.name === n)!;

  it("trigger «Inbound to number» con el número de la organización, y el agente colgado de él", () => {
    // trigger + agente + 4 herramientas × (tool + webhook) + webhook de colgar
    expect(nodos).toHaveLength(11);
    expect(nodos[0]).toMatchObject({ type: "trigger", event_id: EVENTOS_ENTRANTE.inboundToNumber, name: NOMBRES_NODOS.trigger });
    expect((nodos[0].configuration as { numbers: unknown[] }).numbers).toEqual([{ id: NUMERO.id, name: "Test", number: "+15734018744" }]);
    expect(nodos[1]).toMatchObject({ type: "agent", event_id: EVENTOS_ENTRANTE.inboundVoiceAgent, parent_node_index: 0 });
  });

  it("el agente habla español de España, graba y lleva el prompt y el saludo inicial", () => {
    const agente = nodos[1];
    const conf = agente.configuration as { agent: { languages: { static: { id: string } }[]; language_accents: { static: { id: string } }[]; voices: { static: { name: string } }[] }; record: boolean };
    expect(conf.agent.languages[0].static.id).toBe("es");
    expect(conf.agent.language_accents[0].static.id).toBe("es-es");
    expect(conf.agent.voices[0].static.name).toBe("Ana HR");
    expect(conf.record).toBe(true);
    expect((agente.configuration as { enable_denoised_stt: boolean }).enable_denoised_stt).toBe(true);
    expect(agente.prompt).toMatchObject({ prompt_md: OPCIONES.prompt, initial_message_uninterruptible: true });
    const saludo = textoDe(agente.prompt!.initial_message as { children: { text: string }[] }[]);
    expect(saludo).toMatch(/^Emergencias, dígame/);
    // Ni "112" ni "forestales" en voz alta (petición de Javi, 19-09).
    expect(saludo).not.toMatch(/112|ciento doce|forestal/i);
  });

  it("las cuatro herramientas cuelgan del agente y sus parámetros los rellena el agente (binding agent)", () => {
    const situar = porNombre(NOMBRES_NODOS.situar);
    const consultar = porNombre(NOMBRES_NODOS.consultar);
    const registrar = porNombre(NOMBRES_NODOS.registrar);
    const sms = porNombre(NOMBRES_NODOS.sms);
    expect(sms).toMatchObject({ type: "tool", parent_node_index: 1 });
    // enviar_sms: solo texto (y motivo); el destino es el del .env, el agente no lo elige.
    expect(sms.function!.parameters.map((p) => `${p.name}${p.required ? "*" : ""}`)).toEqual(["texto*", "motivo"]);
    expect(situar).toMatchObject({ type: "tool", parent_node_index: 1 });
    expect(consultar).toMatchObject({ type: "tool", parent_node_index: 1 });
    expect(registrar).toMatchObject({ type: "tool", parent_node_index: 1 });
    expect(situar.function!.parameters.map((p) => `${p.name}${p.required ? "*" : ""}`)).toEqual(["lugar*", "municipio"]);
    // El agente pasa a registrar_aviso las coordenadas confirmadas con la persona.
    expect(registrar.function!.parameters.map((p) => p.name)).toEqual(expect.arrayContaining(["lat", "lon"]));
    expect(consultar.function!.parameters.map((p) => p.name)).toEqual(["lugar"]);
    // Solo pueblo y qué ve son obligatorios: el agente no debe interrogar a quien llama.
    expect(registrar.function!.parameters.filter((p) => p.required).map((p) => p.name)).toEqual(["municipio", "que_ve"]);
    for (const p of [...situar.function!.parameters, ...consultar.function!.parameters, ...registrar.function!.parameters, ...sms.function!.parameters]) expect(p.binding.mode).toBe("agent");
  });

  it("cada herramienta tiene su Webhook POST hijo hacia Atalaya con el secreto, y hay otro al colgar bajo el agente", () => {
    const iSituar = nodos.indexOf(porNombre(NOMBRES_NODOS.situar));
    const iConsultar = nodos.indexOf(porNombre(NOMBRES_NODOS.consultar));
    const iRegistrar = nodos.indexOf(porNombre(NOMBRES_NODOS.registrar));
    const iSms = nodos.indexOf(porNombre(NOMBRES_NODOS.sms));
    const webhooks = nodos.filter((n) => n.event_id === EVENTOS_ENTRANTE.webhookPost);
    expect(webhooks.map((w) => w.name).sort()).toEqual([NOMBRES_NODOS.situarAccion, NOMBRES_NODOS.consultarAccion, NOMBRES_NODOS.registrarAccion, NOMBRES_NODOS.smsAccion, NOMBRES_NODOS.colgar].sort());
    expect(porNombre(NOMBRES_NODOS.situarAccion).parent_node_index).toBe(iSituar);
    expect(porNombre(NOMBRES_NODOS.consultarAccion).parent_node_index).toBe(iConsultar);
    expect(porNombre(NOMBRES_NODOS.registrarAccion).parent_node_index).toBe(iRegistrar);
    expect(porNombre(NOMBRES_NODOS.smsAccion).parent_node_index).toBe(iSms);
    expect(porNombre(NOMBRES_NODOS.colgar).parent_node_index).toBe(1);
    const u = urlsEntrante(OPCIONES.urlPublica);
    const esperadas: Record<string, string> = { [NOMBRES_NODOS.situarAccion]: u.situar, [NOMBRES_NODOS.consultarAccion]: u.consultar, [NOMBRES_NODOS.registrarAccion]: u.registrar, [NOMBRES_NODOS.smsAccion]: u.sms, [NOMBRES_NODOS.colgar]: u.colgar };
    for (const w of webhooks) {
      const c = w.configuration as unknown as ConfWebhook;
      expect(textoDe(c.url)).toBe(esperadas[w.name]);
      expect(textoDe(c.url)).not.toMatch(/localhost|\/\/$/);
      const secreto = c.headers.find((h) => h.key === "x-webhook-secret")!;
      expect(textoDe(secreto.value)).toBe("secreto-prueba");
      expect(() => JSON.parse(c.body.raw)).not.toThrow();
    }
  });

  it("sin URL https, sin secreto, sin número o sin prompt se niega (nada simulado)", () => {
    expect(() => definirNodosEntrante({ ...OPCIONES, urlPublica: "http://localhost:3000" })).toThrow(/URL pública https/);
    expect(() => definirNodosEntrante({ ...OPCIONES, secreto: "" })).toThrow(/HAPPYROBOT_WEBHOOK_SECRET/);
    expect(() => definirNodosEntrante({ ...OPCIONES, numero: undefined })).toThrow(/número de teléfono/);
    expect(() => definirNodosEntrante({ ...OPCIONES, prompt: "  " })).toThrow(/prompt/);
  });
});

describe("cuerpos de los webhooks · variables de HappyRobot y coherencia con la app", () => {
  it("las marcas se sustituyen por los ids reales y quedan referencias {{$var:id.campo}} a todos los parámetros", () => {
    const ids = { situar: "id-situar", consultar: "id-consultar", registrar: "id-registrar", sms: "id-sms", agente: "id-agente" };
    const raw = resolverMarcas(JSON.stringify(cuerpoRegistrar(MARCAS.registrar, MARCAS.agente)), ids);
    expect(raw).not.toMatch(/__HERRAMIENTA|__AGENTE/);
    const cuerpo = JSON.parse(raw) as Record<string, string>;
    for (const p of PARAMETROS_REGISTRAR as { name: string }[]) expect(cuerpo[p.name]).toBe(`{{$var:id-registrar.${p.name}}}`);
    expect(cuerpo.telefono_llamante).toBe("{{$var:id-agente.from}}");
    expect(cuerpo.run_id).toBe("{{$var:current.run_id}}");
    expect(cuerpo.canal).toBe("llamada");
  });

  it("los nombres de los parámetros de registrar_aviso son los que lee avisoDesdeCuerpo en la app", () => {
    // Simula lo que HappyRobot manda una vez resueltas las variables.
    const cuerpo: Record<string, string> = { run_id: "run-77", telefono_llamante: "+15734018744" };
    for (const p of PARAMETROS_REGISTRAR as { name: string; example: string }[]) cuerpo[p.name] = p.example;
    const r = avisoDesdeCuerpo(cuerpo);
    expect(r.error).toBeUndefined();
    expect(r.aviso?.punto).toEqual({ lat: 40.45287, lon: -3.72556 });
    expect(r.aviso).toMatchObject({
      runId: "run-77",
      municipio: "Navalacruz",
      lugar: "N-403 km 62, junto a la ermita",
      queVe: "Una columna de humo negro que sube desde el pinar y avanza hacia el pueblo",
      tipo: "humo",
      personasEnRiesgo: false,
      viviendasCerca: true,
      tamano: "como un campo de fútbol",
      telefono: "+34600111222",
    });
  });

  it("consultar_zona manda el lugar y el webhook de colgar la transcripción y el número del llamante", () => {
    expect(cuerpoConsultar("t1")).toMatchObject({ lugar: "{{$var:t1.lugar}}", canal: "llamada" });
    expect(cuerpoColgar("a1")).toMatchObject({ run_id: "{{$var:current.run_id}}", telefono: "{{$var:a1.from}}", transcripcion: "{{$var:a1.transcript}}", duracion_seg: "{{$var:a1.duration}}", canal: "llamada" });
  });

  it("enviar_sms manda el texto y el motivo del agente, el run y el número del llamante; nunca un destino", () => {
    const raw = resolverMarcas(JSON.stringify(cuerpoSms(MARCAS.sms, MARCAS.agente)), { situar: "s", consultar: "c", registrar: "r", sms: "id-sms", agente: "id-agente" });
    const cuerpo = JSON.parse(raw) as Record<string, string>;
    expect(cuerpo).toEqual({ run_id: "{{$var:current.run_id}}", canal: "llamada", texto: "{{$var:id-sms.texto}}", motivo: "{{$var:id-sms.motivo}}", telefono_llamante: "{{$var:id-agente.from}}" });
    for (const p of PARAMETROS_SMS as { name: string }[]) expect(cuerpo[p.name]).toBe(`{{$var:id-sms.${p.name}}}`);
    // El destino lo pone Atalaya (TELEFONO_AVISOS_SMS): el agente no puede mandar a otro número.
    expect(Object.keys(cuerpo)).not.toContain("telefono");
    expect(Object.keys(cuerpo)).not.toContain("destino");
  });

  it("las salidas de muestra (Tool Call Result) tienen la forma que devuelve la app", () => {
    expect(SALIDAS_MUESTRA.registrar).toMatchObject({ registrado: true, impacto: "nuevo_foco", geolocalizada: true });
    expect(typeof SALIDAS_MUESTRA.registrar.mensajeParaLocutor).toBe("string");
    expect(Array.isArray(SALIDAS_MUESTRA.consultar.incendiosCercanos)).toBe(true);
    expect(SALIDAS_MUESTRA.sms).toMatchObject({ enviado: true });
    expect(typeof SALIDAS_MUESTRA.sms.mensajeParaLocutor).toBe("string");
    expect(SALIDAS_MUESTRA.colgar).toMatchObject({ recibido: true, adjuntada: true });
  });
});

describe("clasificarNodos · lo que devuelve GET /versions/{id}/nodes (las herramientas cuelgan del prompt)", () => {
  it("localiza cada papel aunque los triggers y agentes vengan como «action»", () => {
    const nodos = [
      { id: "T", type: "action", name: NOMBRES_NODOS.trigger, event_id: EVENTOS_ENTRANTE.inboundToNumber, parent_id: null },
      { id: "A", type: "action", name: NOMBRES_NODOS.agente, event_id: EVENTOS_ENTRANTE.inboundVoiceAgent, parent_id: "T" },
      { id: "P", type: "prompt", name: "Prompt", parent_id: "A" },
      { id: "H0", type: "tool", name: NOMBRES_NODOS.situar, parent_id: "P" },
      { id: "W0", type: "action", name: NOMBRES_NODOS.situarAccion, event_id: EVENTOS_ENTRANTE.webhookPost, parent_id: "H0" },
      { id: "H1", type: "tool", name: NOMBRES_NODOS.consultar, parent_id: "P" },
      { id: "W1", type: "action", name: NOMBRES_NODOS.consultarAccion, event_id: EVENTOS_ENTRANTE.webhookPost, parent_id: "H1" },
      { id: "H2", type: "tool", name: NOMBRES_NODOS.registrar, parent_id: "P" },
      { id: "W2", type: "action", name: NOMBRES_NODOS.registrarAccion, event_id: EVENTOS_ENTRANTE.webhookPost, parent_id: "H2" },
      { id: "H3", type: "tool", name: NOMBRES_NODOS.sms, parent_id: "P" },
      { id: "W4", type: "action", name: NOMBRES_NODOS.smsAccion, event_id: EVENTOS_ENTRANTE.webhookPost, parent_id: "H3" },
      { id: "W3", type: "action", name: NOMBRES_NODOS.colgar, event_id: EVENTOS_ENTRANTE.webhookPost, parent_id: "A" },
    ];
    const c = clasificarNodos(nodos) as Record<string, { id: string }>;
    expect(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.id]))).toEqual({ trigger: "T", agente: "A", prompt: "P", situar: "H0", situarAccion: "W0", consultar: "H1", consultarAccion: "W1", registrar: "H2", registrarAccion: "W2", sms: "H3", smsAccion: "W4", colgar: "W3" });
  });
});

describe("docs/HAPPYROBOT.md · el prompt que lee el script nombra las dos herramientas", () => {
  it("el bloque tras «Nodo 2 · Inbound Voice Agent» existe y cita consultar_zona, registrar_aviso y mensajeParaLocutor", () => {
    const raiz = fileURLToPath(new URL("../..", import.meta.url));
    const doc = readFileSync(`${raiz}docs/HAPPYROBOT.md`, "utf8");
    const i = doc.indexOf("**Nodo 2 · Inbound Voice Agent**");
    expect(i).toBeGreaterThan(0);
    const ini = doc.indexOf("```", i);
    const finLinea = doc.indexOf("\n", ini);
    const prompt = doc.slice(finLinea + 1, doc.indexOf("```", finLinea)).trim();
    expect(prompt.length).toBeGreaterThan(800);
    expect(prompt).toContain("situar_lugar");
    expect(prompt).toContain("consultar_zona");
    expect(prompt).toContain("registrar_aviso");
    expect(prompt).toContain("enviar_sms");
    // Regla explícita: nunca "ciento doce", "112" ni "forestales" en voz alta; y colgar tras despedirse.
    expect(prompt).toMatch(/No digas nunca "ciento doce", "uno uno dos", "112" ni "forestales"/);
    expect(prompt).toMatch(/cuelga/);
    expect(prompt).toMatch(/registra IGUALMENTE/);
    expect(prompt).toContain("mensajeParaLocutor");
    expect(prompt).toMatch(/NUNCA inventes/);
  });
});

describe("keyterms del agente · la plataforma rechaza los de más de 50 caracteres", () => {
  it("ninguna keyterm pasa del tope (medido: la versión quedó sin publicar)", async () => {
    const { KEYTERMS, KEYTERM_MAX } = await import("@/scripts/happyrobot-entrante.mjs");
    expect(KEYTERMS.length).toBeGreaterThan(5);
    for (const k of KEYTERMS as string[]) expect(k.length).toBeLessThanOrEqual(KEYTERM_MAX);
  });
});

describe("camposAExponer · lo que el agente ve de la respuesta de cada herramienta", () => {
  it("expone todos los campos generados, sin repetir ni vacíos (sin esto el agente recibía {\"steps\":[]})", async () => {
    const { camposAExponer } = await import("@/scripts/happyrobot-entrante.mjs");
    expect(camposAExponer({ fields: [{ path: "lat", exposed: false }, { path: "lon", exposed: false }, { path: "lat" }, { path: "" }, {}] })).toEqual(["lat", "lon"]);
    expect(camposAExponer(undefined)).toEqual([]);
  });

  it("la salida de muestra de situar_lugar tiene las mismas claves que la respuesta real", async () => {
    const { SALIDAS_MUESTRA } = await import("@/scripts/happyrobot-entrante.mjs");
    const { situarSinDatos } = await import("@/lib/happyrobot/entrante");
    expect(Object.keys(SALIDAS_MUESTRA.situar).sort()).toEqual(Object.keys(situarSinDatos()).sort());
  });
});

describe("prompt revisado con las llamadas de 19:13-19:51", () => {
  it("no pregunta «¿humo o llamas?», no inventa datos, afirma direcciones y cuelga si todo falla", () => {
    const raiz = fileURLToPath(new URL("../..", import.meta.url));
    const doc = readFileSync(`${raiz}docs/HAPPYROBOT.md`, "utf8");
    const i = doc.indexOf("**Nodo 2 · Inbound Voice Agent**");
    const ini = doc.indexOf("```", i);
    const finLinea = doc.indexOf("\n", ini);
    const prompt = doc.slice(finLinea + 1, doc.indexOf("```", finLinea));
    expect(prompt).toMatch(/no vuelvas a\s+preguntar "¿humo o llamas\?"/);
    expect(prompt).toMatch(/nunca completes datos que no se han dicho/);
    expect(prompt).toMatch(/Si es una afirmación[\s\S]*NO esperes respuesta/);
    expect(prompt).toMatch(/"Su aviso ha quedado grabado y la sala lo va a recibir\. Gracias\s+por avisar\." y cuelga/);
    expect(prompt).not.toMatch(/La sala recibe su llamada igualmente/);
  });
});
