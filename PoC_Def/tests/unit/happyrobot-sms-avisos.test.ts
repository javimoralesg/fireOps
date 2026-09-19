// Pruebas de lib/happyrobot/sms-avisos.ts (SMS del agente del 112 al teléfono del .env) y de la
// definición del workflow «Atalaya · SMS saliente» (scripts/happyrobot-sms.mjs). Sin red: `fetch`
// se sustituye por un doble y el Estado es el REAL en memoria (eventos de verdad).
// DUEÑO: sesión fireops-00 (2026-09-19).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AvisoLlamada, ResultadoAviso } from "@/lib/happyrobot/entrante";

const dobles = vi.hoisted(() => ({ estado: undefined as unknown }));
vi.mock("@/lib/motor/estado", async (importar) => {
  const mod = await importar<typeof import("@/lib/motor/estado")>();
  return { ...mod, obtenerEstado: () => dobles.estado as InstanceType<typeof mod.Estado> };
});

import { Estado } from "@/lib/motor/estado";
import {
  anotarResultadoSms,
  enmascarar,
  enviarSmsAgente,
  enviarSmsAvisoRegistrado,
  estadoSmsAvisos,
  herramientaEnviarSms,
  MAX_SMS,
  recortarSms,
  respuestaHerramientaSinDatos,
  smsDelAgente,
  smsDesdeCuerpo,
  smsRecientes,
  textoSmsAgente,
  textoSmsAviso,
  VARIABLE_TELEFONO_AVISOS,
  veredictoCorto,
} from "@/lib/happyrobot/sms-avisos";
import { clasificarNodosSms, configEnviarSms, configWebhookResultado, cuerpoResultadoSms, EVENTOS_SMS, payloadPruebaSms, PARAMS_SMS } from "@/scripts/happyrobot-sms.mjs";
import { PARAMETROS_SMS, SALIDAS_MUESTRA, cuerpoSms } from "@/scripts/happyrobot-entrante.mjs";

const estado = () => dobles.estado as Estado;
const CLAVES = ["HAPPYROBOT_API_KEY", "HAPPYROBOT_WORKFLOW_SLUG_SMS", "HAPPYROBOT_WEBHOOK_SECRET", "TELEFONO_AVISOS_SMS", "DESTINO_DEMO", "HAPPYROBOT_API_BASE", "HAPPYROBOT_ENVIRONMENT"] as const;
const previo: Record<string, string | undefined> = {};

const AVISO: AvisoLlamada = {
  runId: "run-1",
  telefono: "+34600000000",
  municipio: "Navalacruz",
  lugar: "N-403 km 62",
  queVe: "Una columna de humo negro que avanza hacia el pueblo",
  tipo: "humo",
  personasEnRiesgo: false,
  viviendasCerca: true,
};
const RESULTADO: ResultadoAviso = {
  registrado: true,
  observacionId: "obs-1",
  impacto: "nuevo_foco",
  verificacion: "Foco nuevo declarado",
  foco: { id: "inc-1", nombre: "Incendio de Navalacruz", municipio: "Navalacruz", estado: "detectado", confianza: 0.7 },
  geolocalizada: true,
  enAnalisis: false,
  extraccion: "determinista",
  mensajeParaLocutor: "Aviso registrado.",
};
const A_LAS_12 = new Date("2026-09-19T10:00:00Z"); // 12:00 en Madrid (CEST)

let fetchDoble: ReturnType<typeof vi.fn>;
const respuestaOk = (cuerpo: unknown = { id: "run-sms-1" }, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  dobles.estado = new Estado();
  for (const k of CLAVES) previo[k] = process.env[k];
  process.env.HAPPYROBOT_API_KEY = "sk_live_prueba";
  process.env.HAPPYROBOT_WORKFLOW_SLUG_SMS = "slugsms";
  process.env.HAPPYROBOT_WEBHOOK_SECRET = "secreto-prueba";
  process.env.HAPPYROBOT_API_BASE = "https://hr.invalid";
  process.env.HAPPYROBOT_ENVIRONMENT = "production";
  process.env.TELEFONO_AVISOS_SMS = "+34611222333";
  delete process.env.DESTINO_DEMO;
  fetchDoble = vi.fn(async () => respuestaOk());
  vi.stubGlobal("fetch", fetchDoble);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of CLAVES) {
    if (previo[k] === undefined) delete process.env[k];
    else process.env[k] = previo[k];
  }
});

/** El payload que salió hacia HappyRobot en la última llamada a fetch. */
function payloadEnviado(): Record<string, unknown> {
  const [, init] = fetchDoble.mock.calls.at(-1) as [string, RequestInit];
  return (JSON.parse(String(init.body)) as { payload: Record<string, unknown> }).payload;
}

// ---------------------------------------------------------------------------
describe("estadoSmsAvisos · qué falta, con el nombre exacto de la variable", () => {
  it("con clave, workflow y teléfono está ok y enseña el destino legible", () => {
    expect(estadoSmsAvisos()).toMatchObject({ ok: true, destino: "+34611222333", destinoEnmascarado: "+346***33", slug: "slugsms", variable: VARIABLE_TELEFONO_AVISOS });
    expect(estadoSmsAvisos().detalle).toBe("SMS del 112 → +34 611 222 333 (workflow slugsms)");
  });
  it("sin TELEFONO_AVISOS_SMS cae a DESTINO_DEMO; sin ninguno, lo dice", () => {
    delete process.env.TELEFONO_AVISOS_SMS;
    process.env.DESTINO_DEMO = "+34699888777";
    expect(estadoSmsAvisos()).toMatchObject({ ok: true, destino: "+34699888777" });
    delete process.env.DESTINO_DEMO;
    expect(estadoSmsAvisos()).toMatchObject({ ok: false });
    expect(estadoSmsAvisos().detalle).toBe("HappyRobot: el 112 no puede mandar SMS · Falta TELEFONO_AVISOS_SMS (o DESTINO_DEMO)");
  });
  it("sin workflow de SMS o con un teléfono que no es E.164, lo dice (nada simulado)", () => {
    delete process.env.HAPPYROBOT_WORKFLOW_SLUG_SMS;
    expect(estadoSmsAvisos().detalle).toContain("Falta HAPPYROBOT_WORKFLOW_SLUG_SMS");
    process.env.HAPPYROBOT_WORKFLOW_SLUG_SMS = "slugsms";
    process.env.TELEFONO_AVISOS_SMS = "600 111 222";
    expect(estadoSmsAvisos()).toMatchObject({ ok: false });
    expect(estadoSmsAvisos().detalle).toMatch(/E\.164/);
  });
});

describe("texto de los SMS · una línea, ≤ 300 caracteres, primero lo importante", () => {
  it("el SMS del aviso lleva dónde, riesgo, veredicto y referencia, y NADA de quien llama (RGPD)", () => {
    const t = textoSmsAviso({ ...AVISO, personasEnRiesgo: true, tamano: "como un campo de fútbol" }, RESULTADO, { ahora: A_LAS_12 });
    expect(t).toBe("ATALAYA 112 12:00: Humo en N-403 km 62, Navalacruz. PERSONAS EN RIESGO. Viviendas cerca. Tamano: como un campo de fútbol. Foco nuevo declarado: Incendio de Navalacruz (detectado, confianza 70%). Ref obs-1.");
    // Ni el número de quien llama ni sus palabras literales (el SMS real del 19-09 llevaba las dos cosas).
    expect(t).not.toContain("600000000");
    expect(t).not.toMatch(/Llamante/);
    expect(t).not.toContain("Una columna de humo negro");
    expect(t).not.toContain("\n");
    expect(t.length).toBeLessThanOrEqual(MAX_SMS);
  });
  it("una ampliación se marca, y lo que dicta la persona (aunque sea muy largo) no entra en el SMS", () => {
    const t = textoSmsAviso({ ...AVISO, queVe: "humo ".repeat(120) }, RESULTADO, { ampliacion: true, ahora: A_LAS_12 });
    expect(t).toMatch(/^ATALAYA 112 12:00 \(ampliacion\): /);
    expect(t).toContain("Ref obs-1.");
    expect(t.length).toBeLessThanOrEqual(MAX_SMS);
    expect(t).not.toContain("humo humo");
  });
  it("veredictoCorto cubre todos los impactos y el caso sin situar", () => {
    expect(veredictoCorto({ impacto: "confirma", foco: RESULTADO.foco, enAnalisis: false, geolocalizada: true })).toBe("Confirma foco conocido: Incendio de Navalacruz.");
    expect(veredictoCorto({ impacto: "duplicada", foco: null, enAnalisis: false, geolocalizada: true })).toMatch(/Duplica/);
    expect(veredictoCorto({ impacto: "ruido", foco: null, enAnalisis: false, geolocalizada: true })).toMatch(/Sin incendio conocido/);
    expect(veredictoCorto({ impacto: null, foco: null, enAnalisis: true, geolocalizada: false })).toMatch(/Situando el lugar/);
    expect(veredictoCorto({ impacto: null, foco: null, enAnalisis: false, geolocalizada: false })).toMatch(/Sin localizar/);
    expect(veredictoCorto({ impacto: "registrada", foco: null, enAnalisis: false, geolocalizada: true })).toBe("Pendiente de verificar.");
  });
  it("el SMS de la herramienta lleva cabecera «(agente)» y nunca el número de quien llama", () => {
    expect(textoSmsAgente("Dos personas atrapadas en la N-403", { telefonoLlamante: "+34600000000", ahora: A_LAS_12 })).toBe("ATALAYA 112 12:00 (agente): Dos personas atrapadas en la N-403");
    // Aunque el agente lo escriba en el texto, se tacha.
    expect(textoSmsAgente("Llamante +34 653 07 09 26, correo ana@correo.es, dos atrapados", { ahora: A_LAS_12 })).toBe("ATALAYA 112 12:00 (agente): Llamante [tel. oculto], correo [correo oculto], dos atrapados");
    expect(textoSmsAgente("hola", { telefonoLlamante: "{{$var:x.from}}", ahora: A_LAS_12 })).toBe("ATALAYA 112 12:00 (agente): hola");
    expect(recortarSms("a".repeat(400)).length).toBe(MAX_SMS);
    expect(enmascarar("+34611222333")).toBe("+346***33");
  });
});

// ---------------------------------------------------------------------------
describe("enviarSmsAgente · sale por el workflow de SMS al teléfono del .env, con acta", () => {
  it("dispara el workflow con el teléfono del .env y deja evento accion_ejecutada y registro por run", async () => {
    const r = await enviarSmsAgente({ texto: "ATALAYA 112: prueba", origen: "herramienta_enviar_sms", motivo: "dato_nuevo", runId: "run-1", observacionId: "obs-1", incendioId: "inc-1" });
    expect(fetchDoble).toHaveBeenCalledTimes(1);
    const [url] = fetchDoble.mock.calls[0] as [string];
    expect(url).toBe("https://hr.invalid/api/v2/workflows/slugsms/runs?environment=production");
    const p = payloadEnviado();
    expect(p).toMatchObject({ canal: "sms", telefono: "+34611222333", phone_number: "+34611222333", destino: "+34611222333", texto: "ATALAYA 112: prueba", mensaje: "ATALAYA 112: prueba", motivo: "dato_nuevo", origen: "herramienta_enviar_sms", runLlamada: "run-1", observacionId: "obs-1", incendioId: "inc-1", decisionId: "", accionId: "", secreto: "secreto-prueba" });
    // Todo lo que se manda está declarado como param del trigger del workflow.
    for (const k of Object.keys(p)) expect(PARAMS_SMS, `param ${k} sin declarar en PARAMS_SMS`).toContain(k);

    expect(r).toMatchObject({ referencia: "run-sms-1", destino: "+346***33", origen: "herramienta_enviar_sms", runId: "run-1" });
    expect(smsDelAgente("run-sms-1")).toBe(r);
    expect(smsRecientes()[0]).toBe(r);
    const ev = estado().eventos.at(-1)!;
    expect(ev).toMatchObject({ tipo: "accion_ejecutada", agenteId: "centralita", incendioId: "inc-1", nivel: "info" });
    expect(ev.mensaje).toBe("112 virtual: SMS del agente enviado a +346***33 (run run-sms-1).");
    expect(ev.datos).toMatchObject({ canal: "sms", referencia: "run-sms-1", destino: "+346***33", runLlamada: "run-1" });
    // Auditoría sin secretos: el payload del acta no lleva el secreto del webhook.
    expect(JSON.stringify(ev.datos)).not.toContain("secreto-prueba");
    expect((ev.datos as { peticion: Record<string, unknown> }).peticion.telefono).toBe("+34611222333");
  });

  it("el teléfono no lo elige quien llama: siempre el del .env, y el texto se recorta a 300", async () => {
    await enviarSmsAgente({ texto: "x".repeat(500), origen: "aviso_registrado" });
    const p = payloadEnviado();
    expect(p.telefono).toBe("+34611222333");
    expect(String(p.texto).length).toBe(MAX_SMS);
  });

  it("sin workflow de SMS no llama a HappyRobot: lanza con la variable y deja evento accion_fallida", async () => {
    delete process.env.HAPPYROBOT_WORKFLOW_SLUG_SMS;
    await expect(enviarSmsAgente({ texto: "hola", origen: "aviso_registrado", runId: "run-2" })).rejects.toThrow(/Falta HAPPYROBOT_WORKFLOW_SLUG_SMS/);
    expect(fetchDoble).not.toHaveBeenCalled();
    expect(estado().eventos.at(-1)).toMatchObject({ tipo: "accion_fallida", agenteId: "centralita", nivel: "aviso", datos: { canal: "sms", runLlamada: "run-2" } });
    expect(estado().eventos.at(-1)!.mensaje).toMatch(/SMS no enviado a \+346\*\*\*33: Falta HAPPYROBOT_WORKFLOW_SLUG_SMS/);
  });

  it("sin teléfono en el .env lo dice; si HappyRobot responde mal, el error llega con el código real", async () => {
    delete process.env.TELEFONO_AVISOS_SMS;
    await expect(enviarSmsAgente({ texto: "hola", origen: "aviso_registrado" })).rejects.toThrow("Falta TELEFONO_AVISOS_SMS (o DESTINO_DEMO)");
    process.env.TELEFONO_AVISOS_SMS = "+34611222333";
    fetchDoble.mockResolvedValueOnce(respuestaOk({ error: "no live version" }, 404));
    await expect(enviarSmsAgente({ texto: "hola", origen: "aviso_registrado" })).rejects.toThrow(/HappyRobot 404 en sms/);
    expect(estado().eventos.filter((e) => e.tipo === "accion_fallida")).toHaveLength(2);
  });

  it("el resultado que devuelve el workflow se anota por referencia y deja evento; una referencia ajena no", async () => {
    await enviarSmsAgente({ texto: "hola", origen: "aviso_registrado", runId: "run-1" });
    const antes = estado().eventos.length;
    const r = anotarResultadoSms("run-sms-1", { ref: "run-sms-1", ok: true, status: "completed" }, true, "completado");
    expect(r?.resultado).toMatchObject({ ok: true, resumen: "completado" });
    expect(estado().eventos.length).toBe(antes + 1);
    expect(estado().eventos.at(-1)).toMatchObject({ tipo: "accion_ejecutada", datos: { referencia: "run-sms-1", runLlamada: "run-1" } });
    expect(anotarResultadoSms("run-de-una-decision", {}, true, "x")).toBeUndefined();
  });
});

describe("enviarSmsAvisoRegistrado · el SMS automático del aviso nunca rompe la herramienta", () => {
  it("con todo configurado manda el texto del aviso con motivo según el riesgo", async () => {
    const r = await enviarSmsAvisoRegistrado({ ...AVISO, personasEnRiesgo: true }, RESULTADO);
    expect(r?.origen).toBe("aviso_registrado");
    expect(r?.motivo).toBe("personas_en_riesgo");
    expect(String(payloadEnviado().texto)).toMatch(/^ATALAYA 112 \d\d:\d\d: Humo en N-403 km 62, Navalacruz\. PERSONAS EN RIESGO\./);
    expect(estado().eventos.at(-1)).toMatchObject({ tipo: "accion_ejecutada", nivel: "aviso", incendioId: "inc-1" });
    const r2 = await enviarSmsAvisoRegistrado(AVISO, RESULTADO, { ampliacion: true });
    expect(r2?.motivo).toBe("ampliacion_aviso");
  });
  it("sin configurar devuelve undefined (no lanza) y el fallo queda como evento visible", async () => {
    delete process.env.TELEFONO_AVISOS_SMS;
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(enviarSmsAvisoRegistrado(AVISO, RESULTADO)).resolves.toBeUndefined();
    aviso.mockRestore();
    expect(fetchDoble).not.toHaveBeenCalled();
    expect(estado().eventos.at(-1)).toMatchObject({ tipo: "accion_fallida" });
  });
});

describe("herramienta enviar_sms · lo que manda el nodo Webhook y lo que lee el agente", () => {
  it("lee texto/mensaje, motivo, run y llamante; ignora variables sin resolver; sin texto, error explicado", () => {
    expect(smsDesdeCuerpo({ run_id: "run-1", texto: "Dos personas atrapadas", motivo: "personas_en_riesgo", telefono_llamante: "+34600000000" })).toEqual({
      peticion: { texto: "Dos personas atrapadas", motivo: "personas_en_riesgo", runId: "run-1", telefonoLlamante: "+34600000000" },
    });
    expect(smsDesdeCuerpo({ mensaje: "hola", motivo: "{{$var:t.motivo}}" }).peticion).toMatchObject({ texto: "hola", motivo: undefined });
    expect(smsDesdeCuerpo({ texto: "{{$var:t.texto}}" }).error).toMatch(/no trae texto/);
    // La ruta contesta 200 con las cinco claves también en ese caso (la plataforma solo enseña al agente los campos que ve en la prueba).
    expect(respuestaHerramientaSinDatos("El SMS no trae texto (texto)")).toEqual({ enviado: false, referencia: null, destino: null, error: "El SMS no trae texto (texto)", mensajeParaLocutor: expect.stringMatching(/no tengo texto/) });
  });
  it("los parámetros de la herramienta en la plataforma son los que lee la app, y la salida de muestra tiene la forma de la respuesta", async () => {
    const cuerpo: Record<string, string> = { run_id: "run-1", telefono_llamante: "+34600000000" };
    for (const p of PARAMETROS_SMS as { name: string; example: string }[]) cuerpo[p.name] = p.example;
    const leido = smsDesdeCuerpo(cuerpo);
    expect(leido.peticion).toMatchObject({ motivo: "personas_en_riesgo", runId: "run-1" });
    expect(leido.peticion?.texto).toMatch(/Navalacruz/);
    expect(Object.keys(cuerpoSms("t", "a"))).toEqual(expect.arrayContaining(["texto", "motivo", "run_id", "telefono_llamante"]));
    const r = await herramientaEnviarSms(leido.peticion!);
    expect(r).toMatchObject({ enviado: true, referencia: "run-sms-1", destino: "+346***33", error: null });
    expect(Object.keys(SALIDAS_MUESTRA.sms).sort()).toEqual(Object.keys(r).sort());
    expect(String(payloadEnviado().texto)).toMatch(/^ATALAYA 112 \d\d:\d\d \(agente\): Dos personas atrapadas/);
  });
  it("si no puede mandar, contesta enviado:false con el error y una frase honesta para la persona", async () => {
    delete process.env.HAPPYROBOT_WORKFLOW_SLUG_SMS;
    const r = await herramientaEnviarSms({ texto: "hola", runId: "run-9" });
    expect(r).toMatchObject({ enviado: false, referencia: null, destino: null });
    expect(r.error).toMatch(/Falta HAPPYROBOT_WORKFLOW_SLUG_SMS/);
    expect(r.mensajeParaLocutor).toMatch(/No he podido mandar el SMS/);
  });
});

// ---------------------------------------------------------------------------
describe("scripts/happyrobot-sms.mjs · el workflow «Atalaya · SMS saliente» que se manda a la API", () => {
  it("el trigger declara todo lo que manda cliente.enviarSms (ejecutor) y el SMS del agente", () => {
    const delEjecutor = ["canal", "telefono", "phone_number", "destino", "texto", "mensaje", "decisionId", "accionId", "incendioId", "organismo", "incendio", "municipio", "nivel", "superficieHa", "tituloDecision", "resumenDecision", "webhook_url", "secreto"];
    for (const k of delEjecutor) expect(PARAMS_SMS).toContain(k);
    expect(new Set(PARAMS_SMS).size).toBe(PARAMS_SMS.length);
  });
  it("«Send text» lee destino y cuerpo del trigger; el webhook devuelve los ids, el run y el canal con el secreto", () => {
    const conf = configEnviarSms("T") as { to: { children: { variable_id?: string; group_id?: string }[] }[]; body: { children: { variable_id?: string }[] }[] };
    expect(conf.to[0].children.find((c) => c.variable_id)).toMatchObject({ group_id: "T", variable_id: "telefono" });
    expect(conf.body[0].children.find((c) => c.variable_id)).toMatchObject({ variable_id: "texto" });
    const cuerpo = cuerpoResultadoSms("T", ["status", "message-id"], "S") as Record<string, unknown>;
    expect(cuerpo).toMatchObject({ decisionId: "{{$var:T.decisionId}}", accionId: "{{$var:T.accionId}}", ref: "{{$var:current.run_id}}", ok: true, status: "completed", canal: "sms", runLlamada: "{{$var:T.runLlamada}}", sms_status: "{{$var:S.status}}", sms_message_id: "{{$var:S.message-id}}" });
    const wh = configWebhookResultado("T", cuerpo) as { url: { children: { variable_id?: string }[] }[]; headers: { key: string; value: { children: { variable_id?: string }[] }[] }[]; body: { raw: string }; ignore5XX: boolean };
    expect(wh.url[0].children.find((c) => c.variable_id)?.variable_id).toBe("webhook_url");
    expect(wh.headers.find((h) => h.key === "x-webhook-secret")!.value[0].children.find((c) => c.variable_id)?.variable_id).toBe("secreto");
    expect(JSON.parse(wh.body.raw)).toEqual(cuerpo);
    expect(wh.ignore5XX).toBe(false);
  });
  it("clasificarNodosSms localiza trigger, envío y webhook; payloadPruebaSms exige destino E.164 y texto", () => {
    const c = clasificarNodosSms([
      { id: "T", type: "action", event_id: EVENTOS_SMS.predefinedRequest, parent_id: null },
      { id: "S", type: "action", event_id: EVENTOS_SMS.sendText, parent_id: "T" },
      { id: "W", type: "action", event_id: EVENTOS_SMS.webhookPost, parent_id: "S" },
    ]) as Record<string, { id: string }>;
    expect({ trigger: c.trigger.id, enviar: c.enviar.id, resultado: c.resultado.id }).toEqual({ trigger: "T", enviar: "S", resultado: "W" });
    expect(() => payloadPruebaSms({ destino: "600111222", texto: "hola" })).toThrow(/E\.164/);
    expect(() => payloadPruebaSms({ destino: "+34600111222", texto: " " })).toThrow(/texto/);
    const p = payloadPruebaSms({ destino: "+34600111222", texto: "hola", secreto: "s" }) as Record<string, string>;
    expect(Object.keys(p).sort()).toEqual([...PARAMS_SMS].sort());
    expect(p).toMatchObject({ telefono: "+34600111222", texto: "hola", canal: "sms", motivo: "prueba", secreto: "s" });
  });
});

describe("anonimizarSms · RGPD: nada que identifique a quien llama sale por SMS", () => {
  it("tacha teléfonos (con o sin prefijo, espacios o guiones) y correos, y respeta horas, kilómetros, coordenadas y referencias", async () => {
    const { anonimizarSms } = await import("@/lib/happyrobot/sms-avisos");
    expect(anonimizarSms("Llamante +34653070926.")).toBe("Llamante [tel. oculto].");
    expect(anonimizarSms("tel 653 07 09 26 o 600-111-222")).toBe("tel [tel. oculto] o [tel. oculto]");
    expect(anonimizarSms("escribir a ana.garcia@gmail.com")).toBe("escribir a [correo oculto]");
    const operativo = "ATALAYA 112 18:47: Llamas en N-403 km 62. Foco nuevo declarado: Incendio en 40.453, -3.726 (detectado, confianza 70%). Ref obs-mu8mebou-gorai.";
    expect(anonimizarSms(operativo)).toBe(operativo);
  });
});
