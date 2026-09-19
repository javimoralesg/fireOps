// Pruebas de lib/happyrobot/webhooks.ts · el resultado de un aviso a población que salió por SMS conserva el
// canal «sms» (revisión del PR, 19-09: el webhook fijaba «llamada» y el evento decía "no contestan al
// teléfono" de un SMS) y el webhook de colgar marca la llamada como atendida para la recuperación.
// El Estado es el REAL en memoria; el orquestador se sustituye por un doble que solo registra el evento.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Accion, Decision, Poblacion } from "@/lib/dominio/tipos";

const dobles = vi.hoisted(() => ({ estado: undefined as unknown, procesarEntrada: vi.fn() }));
vi.mock("@/lib/motor/estado", async (importar) => {
  const mod = await importar<typeof import("@/lib/motor/estado")>();
  return { ...mod, obtenerEstado: () => dobles.estado as InstanceType<typeof mod.Estado> };
});
vi.mock("@/lib/motor/orquestador", () => ({
  emitir: (tipo: string, mensaje: string, extra?: Record<string, unknown>) => (dobles.estado as { registrarEvento: (t: string, m: string, x?: Record<string, unknown>) => unknown }).registrarEvento(tipo, mensaje, extra),
}));
vi.mock("@/lib/agentes/percepcion/centralita", () => ({ procesarEntrada: (...a: unknown[]) => dobles.procesarEntrada(...a) }));

import { Estado } from "@/lib/motor/estado";
import { canalDelContacto, entradaHappyRobot, resultadoHappyRobot, textoResultadoContacto } from "@/lib/happyrobot/webhooks";
import { llamadaAtendida, reiniciarRegistroDeLlamadas, VARIABLE_RUTA_ATENDIDAS } from "@/lib/happyrobot/llamadas-atendidas";

const SECRETO = "s3creto-de-prueba";
const DIR = mkdtempSync(join(tmpdir(), "atalaya-webhooks-"));
let n = 0;
const estado = () => dobles.estado as Estado;

const SALOBRAL: Poblacion = {
  id: "pob-1",
  nombre: "Salobral",
  centro: { lat: 40.6, lon: -4.75 },
  tipo: "pueblo",
  incendioId: "inc-1",
  distanciaKm: 2.1,
  rumboDesdeFuegoGrados: 90,
  riesgo: "alto",
  estadoAviso: "avisando",
  telefono: "+34600000001",
  ultimoContacto: { en: "2026-09-19T18:00:00.000Z", canal: "sms", resultado: "SMS enviado al +346***01 (run run-sms-1)" },
};
/** La acción tal como la deja el ejecutor con la voz saliente desactivada: un SMS y su traza. */
const ACCION_SMS: Accion = {
  id: "acc-1",
  tipo: "avisar_poblacion",
  descripcion: "Avisar a Salobral",
  parametros: {},
  objetivo: { poblacionId: "pob-1" },
  estado: "ejecutada",
  resultado: { en: "2026-09-19T18:00:00.000Z", proveedor: "HappyRobot", referencia: "run-sms-1", resumen: "Salobral: SMS enviado al +346***01 (run run-sms-1).", exito: true, datos: { poblacionId: "pob-1", sms: { referencia: "run-sms-1", destino: "+346***01" }, vozDesactivada: true } },
};
const decision = (accion: Accion): Decision => ({
  id: "dec-1",
  ejecucionId: "ej-1",
  agenteId: "proteccion_poblacion",
  incendioId: "inc-1",
  titulo: "Aviso a Salobral",
  resumen: "Incendio forestal a 2 km de Salobral.",
  razonamiento: "El frente avanza hacia el casco urbano.",
  prioridad: 2,
  riesgo: 20,
  competencia: "autonoma",
  estado: "aprobada",
  acciones: [accion],
  evidencias: [],
  fundamentos: [],
  creadaEn: "2026-09-19T17:59:00.000Z",
  creadaEnMundo: "2026-09-19T17:59:00.000Z",
});

const peticion = (ruta: string, cuerpo: unknown) =>
  new Request(`http://atalaya.test${ruta}`, { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": SECRETO }, body: JSON.stringify(cuerpo) });
/** Cuerpo que manda el nodo Webhook del workflow «Atalaya · SMS saliente» (docs/HAPPYROBOT.md §3.2). */
const resultadoSms = (extra: Record<string, unknown> = {}) => ({
  decisionId: "dec-1",
  accionId: "acc-1",
  incendioId: "inc-1",
  ref: "run-sms-1",
  run_url: "https://platform.happyrobot.ai/runs/run-sms-1",
  ok: true,
  status: "completed",
  canal: "sms",
  en: "2026-09-19T18:00:05Z",
  destino: "+346***01",
  ...extra,
});

beforeEach(() => {
  process.env.HAPPYROBOT_WEBHOOK_SECRET = SECRETO;
  process.env[VARIABLE_RUTA_ATENDIDAS] = join(DIR, `atendidas-${++n}.json`);
  rmSync(process.env[VARIABLE_RUTA_ATENDIDAS], { force: true });
  reiniciarRegistroDeLlamadas();
  dobles.estado = new Estado();
  dobles.procesarEntrada.mockReset().mockImplementation(async (e: { canal: string; texto: string; referenciaExterna?: string }) => {
    const obs = { id: `obs-${n}`, canal: e.canal, recibidaEn: new Date().toISOString(), texto: e.texto, referenciaExterna: e.referenciaExterna };
    estado().guardar(estado().observaciones, obs as never);
    return obs;
  });
  estado().guardar(estado().poblaciones, SALOBRAL);
  estado().guardar(estado().decisiones, decision(ACCION_SMS));
});

describe("canalDelContacto / textoResultadoContacto · el canal lo dice la acción, no el webhook", () => {
  it("aviso a población por SMS → sms; «llamar» convertida en SMS → sms; sin nada anotado, el cuerpo o llamada", () => {
    expect(canalDelContacto(ACCION_SMS)).toBe("sms");
    expect(canalDelContacto({ tipo: "llamar", resultado: { en: "", proveedor: "HappyRobot", resumen: "", exito: true, datos: { canal: "sms", vozDesactivada: true } } })).toBe("sms");
    expect(canalDelContacto({ tipo: "enviar_email" })).toBe("email");
    expect(canalDelContacto({ tipo: "avisar_poblacion" }, { canal: "sms" })).toBe("sms");
    expect(canalDelContacto({ tipo: "avisar_poblacion" }, { canal: "voz" })).toBe("llamada");
    expect(canalDelContacto({ tipo: "avisar_poblacion" })).toBe("llamada");
  });

  it("por SMS habla de entrega, nunca de si contestan al teléfono", () => {
    expect(textoResultadoContacto("sms", { fallido: false })).toBe("SMS entregado al ayuntamiento");
    expect(textoResultadoContacto("sms", { fallido: true, detalle: "undelivered" })).toBe("el SMS al ayuntamiento no se ha podido entregar (undelivered)");
    expect(textoResultadoContacto("llamada", { fallido: true })).toBe("no contestan al teléfono del ayuntamiento");
    expect(textoResultadoContacto("llamada", { fallido: false, confirmado: true })).toBe("el ayuntamiento confirma que activa el aviso");
  });
});

describe("POST /api/webhooks/happyrobot/resultado · aviso a población que salió por SMS", () => {
  it("SMS entregado: el pueblo pasa a «avisado», el último contacto sigue siendo por sms y el evento habla del SMS", async () => {
    const res = await resultadoHappyRobot(peticion("/api/webhooks/happyrobot/resultado", resultadoSms()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ recibido: true, decisionId: "dec-1", accionId: "acc-1", ok: true });

    const pob = estado().poblaciones.get("pob-1")!;
    expect(pob.estadoAviso).toBe("avisado");
    expect(pob.ultimoContacto).toMatchObject({ canal: "sms", resultado: "SMS entregado (HappyRobot)" });

    const evento = estado().eventos.find((e) => e.tipo === "poblacion_avisada");
    expect(evento?.mensaje).toBe("Salobral: SMS entregado al ayuntamiento.");
    expect(evento?.mensaje).not.toMatch(/tel[eé]fono|contestan/);
    expect(evento?.nivel).toBe("info");
    expect(evento?.datos).toMatchObject({ canal: "sms", entregado: true });

    // La acción conserva lo que había y añade el resultado; no inventa "contestada".
    const accion = estado().decisiones.get("dec-1")!.acciones[0];
    expect(accion.estado).toBe("ejecutada");
    expect(accion.resultado?.resumen).toBe("Salobral: SMS enviado al +346***01 (run run-sms-1). → SMS entregado (HappyRobot)");
    expect(accion.resultado?.datos).toMatchObject({ sms: { referencia: "run-sms-1" }, contestada: undefined });
    expect(estado().ejecucion.metricas.llamadasContestadas).toBe(0);
  });

  it("SMS no entregado: «sin_respuesta», canal sms y el evento (nivel aviso) dice que el SMS no llegó y por qué", async () => {
    const res = await resultadoHappyRobot(peticion("/api/webhooks/happyrobot/resultado", resultadoSms({ ok: false, status: "failed", error: "undelivered" })));
    expect(res.status).toBe(200);
    const pob = estado().poblaciones.get("pob-1")!;
    expect(pob.estadoAviso).toBe("sin_respuesta");
    expect(pob.ultimoContacto).toMatchObject({ canal: "sms", resultado: "SMS no entregado (HappyRobot)" });
    const evento = estado().eventos.find((e) => e.tipo === "poblacion_avisada");
    expect(evento?.mensaje).toBe("Salobral: el SMS al ayuntamiento no se ha podido entregar (undelivered).");
    expect(evento?.nivel).toBe("aviso");
    expect(estado().eventos.some((e) => e.tipo === "accion_fallida")).toBe(true);
  });

  it("una llamada de verdad (acción sin traza de SMS) sigue con la lógica de «contestada»", async () => {
    const llamada: Accion = { ...ACCION_SMS, resultado: { ...ACCION_SMS.resultado!, datos: { poblacionId: "pob-1", llamada: { referencia: "run-voz-1" } } } };
    estado().guardar(estado().decisiones, decision(llamada));
    estado().actualizar(estado().poblaciones, "pob-1", { ultimoContacto: { en: "2026-09-19T18:00:00.000Z", canal: "llamada", resultado: "Llamando" } });
    await resultadoHappyRobot(peticion("/api/webhooks/happyrobot/resultado", { decisionId: "dec-1", accionId: "acc-1", ref: "run-voz-1", ok: true, status: "completed", canal: "voz", contestada: false }));
    const pob = estado().poblaciones.get("pob-1")!;
    expect(pob.estadoAviso).toBe("sin_respuesta");
    expect(pob.ultimoContacto?.canal).toBe("llamada");
    expect(estado().eventos.find((e) => e.tipo === "poblacion_avisada")?.mensaje).toBe("Salobral: no contestan al teléfono del ayuntamiento.");
  });

  it("sin secreto correcto, 401 y nada cambia", async () => {
    const res = await resultadoHappyRobot(new Request("http://atalaya.test/api/webhooks/happyrobot/resultado", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(resultadoSms()) }));
    expect(res.status).toBe(401);
    expect(estado().poblaciones.get("pob-1")!.estadoAviso).toBe("avisando");
  });
});

describe("POST /api/webhooks/happyrobot/llamada · al colgar, la llamada queda marcada como atendida", () => {
  it("con observación previa del run adjunta la transcripción y marca el run; sin ella, crea la observación y también lo marca", async () => {
    estado().guardar(estado().observaciones, { id: "obs-directo", canal: "llamada", recibidaEn: new Date().toISOString(), texto: "Llamada al 112 virtual (teléfono +34600000000).\nQué ve: humo", referenciaExterna: "run-ok" });
    const r1 = await entradaHappyRobot(peticion("/api/webhooks/happyrobot/llamada", { run_id: "run-ok", canal: "llamada", telefono: "+34600000000", transcripcion: JSON.stringify([{ role: "user", content: "Veo humo en el monte" }]) }), "llamada");
    await expect(r1.json()).resolves.toMatchObject({ recibido: true, observacionId: "obs-directo", adjuntada: true });
    expect(llamadaAtendida("run-ok")).toBe(true);

    const r2 = await entradaHappyRobot(peticion("/api/webhooks/happyrobot/llamada", { run_id: "run-sin-herramienta", canal: "llamada", transcripcion: JSON.stringify([{ role: "user", content: "Hay fuego en Navalacruz" }]) }), "llamada");
    await expect(r2.json()).resolves.toMatchObject({ recibido: true });
    expect(dobles.procesarEntrada).toHaveBeenCalledTimes(1);
    expect(llamadaAtendida("run-sin-herramienta")).toBe(true);

    // Una llamada colgada sin hablar no registra nada y no se marca (la recuperación decidirá con la API).
    const r3 = await entradaHappyRobot(peticion("/api/webhooks/happyrobot/llamada", { run_id: "run-muda", canal: "llamada", transcripcion: "[]" }), "llamada");
    await expect(r3.json()).resolves.toMatchObject({ recibido: false });
    expect(llamadaAtendida("run-muda")).toBe(false);
  });
});
