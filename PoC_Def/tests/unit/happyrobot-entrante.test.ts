// Pruebas de lib/happyrobot/entrante.ts · 112 virtual por TELÉFONO (HappyRobot).
// DUEÑO: sesión fireops-82 (2026-09-19). Lo puro se prueba tal cual; el registro del
// aviso, con la centralita, el verificador y Nominatim sustituidos por dobles (sin red)
// pero con el Estado REAL en memoria, para que guardar/actualizar/eventos sean los de verdad.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Incendio, Observacion } from "@/lib/dominio/tipos";

const dobles = vi.hoisted(() => ({
  estado: undefined as unknown,
  extraccionIA: true,
  demoraMs: 0,
  contador: 0,
  procesarEntrada: vi.fn(),
  verificar: vi.fn(),
  geocodificar: vi.fn(),
  // Modelo rápido de mentira para la interpretación del lugar: sin él, situar_lugar haría una llamada real a la IA.
  iaDisponible: false,
  completarJson: vi.fn(),
}));

vi.mock("@/lib/motor/estado", async (importar) => {
  const mod = await importar<typeof import("@/lib/motor/estado")>();
  return { ...mod, obtenerEstado: () => dobles.estado as InstanceType<typeof mod.Estado> };
});
vi.mock("@/lib/agentes/percepcion/centralita", () => ({ procesarEntrada: (...a: unknown[]) => dobles.procesarEntrada(...a) }));
vi.mock("@/lib/agentes/analisis/verificador", () => ({ verificarObservacionAhora: (...a: unknown[]) => dobles.verificar(...a) }));
vi.mock("@/lib/fuentes/nominatim", () => ({ geocodificar: (...a: unknown[]) => dobles.geocodificar(...a) }));
vi.mock("@/lib/ia/llm", () => ({ proveedorDisponible: () => dobles.iaDisponible, completarJson: (...a: unknown[]) => dobles.completarJson(...a) }));

import { Estado } from "@/lib/motor/estado";
import {
  adjuntarTranscripcion,
  avisoDesdeCuerpo,
  esAfirmativo,
  estadoEntrante,
  extraccionDeterminista,
  formatearTelefono,
  MARCA_DETERMINISTA,
  MARCA_TRANSCRIPCION,
  mensajeParaLocutor,
  normalizarTipo,
  observacionDeLlamada,
  registrarAvisoDeLlamada,
  textoDeAviso,
  type AvisoLlamada,
} from "@/lib/happyrobot/entrante";

const NAVALACRUZ = { lat: 40.44, lon: -4.99 };
const estado = () => dobles.estado as Estado;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

beforeEach(() => {
  dobles.estado = new Estado();
  dobles.iaDisponible = false;
  dobles.completarJson.mockReset();
  delete (globalThis as { __atalayaSituadoPorRun?: unknown }).__atalayaSituadoPorRun;
  dobles.extraccionIA = true;
  dobles.demoraMs = 0;
  dobles.contador = 0;
  dobles.geocodificar.mockReset().mockResolvedValue({ punto: NAVALACRUZ, nombre: "Navalacruz", url: "" });
  // Centralita de mentira con el MISMO contrato que la real: guarda la observación ANTES de
  // su primer await (la herramienta cuenta con ello para contestar aunque la IA tarde).
  dobles.procesarEntrada.mockReset().mockImplementation(async (entrada: { canal: Observacion["canal"]; texto: string; remitente?: string; referenciaExterna?: string; punto?: { lat: number; lon: number } }) => {
    const e = estado();
    const obs: Observacion = { id: `obs-${++dobles.contador}`, canal: entrada.canal, recibidaEn: new Date().toISOString(), texto: entrada.texto, remitente: entrada.remitente, referenciaExterna: entrada.referenciaExterna, punto: entrada.punto };
    e.guardar(e.observaciones, obs);
    if (dobles.demoraMs) await dormir(dobles.demoraMs);
    if (!dobles.extraccionIA) return e.observaciones.get(obs.id)!;
    return e.actualizar(e.observaciones, obs.id, { extraccion: { esIncendio: true, tipo: "humo", gravedad: "moderada", resumen: "Humo en Navalacruz (modelo)", fiabilidad: 0.8, municipio: "Navalacruz" } })!;
  });
  // Verificador de mentira: con punto y extracción declara foco; si no, "registrada".
  dobles.verificar.mockReset().mockImplementation(async (id: string) => {
    const e = estado();
    const obs = e.observaciones.get(id);
    if (!obs || obs.impacto) return undefined;
    if (!obs.punto || !obs.extraccion) {
      e.actualizar(e.observaciones, id, { impacto: "registrada", verificacion: "Aviso sin localización o sin extracción" });
      return { impacto: "registrada" };
    }
    const inc = { id: "inc-1", nombre: "Incendio de Navalacruz", municipio: "Navalacruz", estado: "detectado", confianza: obs.extraccion.fiabilidad, centro: obs.punto } as unknown as Incendio;
    e.guardar(e.incendios, inc);
    e.actualizar(e.observaciones, id, { impacto: "nuevo_foco", incendioId: inc.id, verificacion: "Foco nuevo declarado" });
    return { impacto: "nuevo_foco", incendioId: inc.id };
  });
});

// ---------------------------------------------------------------------------
describe("formatearTelefono · el número de HappyRobot legible", () => {
  it("americano +1 en 3-3-4 y español +34 en grupos de tres", () => {
    expect(formatearTelefono("+15734018744")).toBe("+1 573 401 8744");
    expect(formatearTelefono("+34600111222")).toBe("+34 600 111 222");
  });
  it("lo que no es E.164 se devuelve tal cual (nunca se inventa un formato)", () => {
    expect(formatearTelefono("112")).toBe("112");
    expect(formatearTelefono(" 900 123 456 ")).toBe("900 123 456");
  });
});

describe("normalizarTipo / esAfirmativo · lo que dicta la persona", () => {
  it("humo, llamas, ambos, olor u otro", () => {
    expect(normalizarTipo("humo negro")).toBe("humo");
    expect(normalizarTipo("se ve fuego")).toBe("llamas");
    expect(normalizarTipo("humo y llamas")).toBe("ambos");
    expect(normalizarTipo("huele a quemado")).toBe("olor");
    expect(normalizarTipo("una explosión")).toBe("otro");
    expect(normalizarTipo("")).toBeUndefined();
    expect(normalizarTipo(undefined)).toBeUndefined();
  });
  it("sí/no en las formas que llegan del agente de voz", () => {
    expect(esAfirmativo("sí")).toBe(true);
    expect(esAfirmativo("Si, hay gente")).toBe(true);
    expect(esAfirmativo(true)).toBe(true);
    expect(esAfirmativo("no")).toBe(false);
    expect(esAfirmativo("nadie")).toBe(false);
    expect(esAfirmativo("")).toBeUndefined();
    expect(esAfirmativo("no sé")).toBe(false); // "no…" cuenta como negativo
    expect(esAfirmativo("quizá")).toBeUndefined();
  });
});

describe("avisoDesdeCuerpo · lo que manda el nodo Webhook de registrar_aviso", () => {
  it("lee los nombres snake_case del workflow y deduce el tipo si no viene", () => {
    const r = avisoDesdeCuerpo({
      run_id: "run-9",
      municipio: "Navalacruz",
      lugar: "N-403 km 62",
      que_ve: "Una columna de humo negro",
      personas_en_riesgo: "no",
      viviendas_cerca: "sí",
      tamano: "como un campo de fútbol",
      telefono: "no lo ha dicho",
      telefono_llamante: "+34600000000",
    });
    expect(r.error).toBeUndefined();
    expect(r.aviso).toMatchObject({ runId: "run-9", municipio: "Navalacruz", lugar: "N-403 km 62", tipo: "humo", personasEnRiesgo: false, viviendasCerca: true, tamano: "como un campo de fútbol" });
    // "no lo ha dicho" no es un teléfono: se usa el del llamante.
    expect(r.aviso?.telefono).toBe("+34600000000");
  });
  it("el teléfono dictado manda sobre el del llamante, y las variables sin resolver de HappyRobot se ignoran", () => {
    const r = avisoDesdeCuerpo({ que_ve: "fuego", telefono: "+34 611 22 33 44", telefono_llamante: "+15734018744", lugar: "{{$var:abc.lugar}}", municipio: "Ávila" });
    expect(r.aviso?.telefono).toBe("+34 611 22 33 44");
    expect(r.aviso?.lugar).toBeUndefined();
    expect(r.aviso?.municipio).toBe("Ávila");
    expect(r.aviso?.tipo).toBe("llamas");
  });
  it("sin qué ve ni dónde, es un error 422 explicado", () => {
    const r = avisoDesdeCuerpo({ run_id: "x", telefono: "+34600000000" });
    expect(r.error).toMatch(/que_ve, lugar, municipio/);
  });
  it("acepta coordenadas como texto y municipio solo (qué ve se completa)", () => {
    const r = avisoDesdeCuerpo({ municipio: "Navalacruz", lat: "40.44", lon: "-4.99" });
    expect(r.aviso?.punto).toEqual({ lat: 40.44, lon: -4.99 });
    expect(r.aviso?.queVe).toMatch(/Navalacruz/);
  });
});

describe("textoDeAviso / extraccionDeterminista · sin modelo, solo lo dictado", () => {
  it("el texto lleva todos los campos dictados, ordenados", () => {
    const t = textoDeAviso(AVISO);
    expect(t).toMatch(/^Llamada al 112 virtual \(teléfono \+34600000000\)\./);
    expect(t).toContain("Qué ve: Una columna de humo negro");
    expect(t).toContain("Dónde: N-403 km 62, Navalacruz");
    expect(t).toContain("Viviendas cerca: sí");
    expect(t).toContain("Personas en riesgo: no");
  });
  it("gravedad con el criterio de la centralita y marca de determinista en el resumen", () => {
    expect(extraccionDeterminista(AVISO)).toMatchObject({ esIncendio: true, tipo: "humo", gravedad: "grave", fiabilidad: 0.7, municipio: "Navalacruz", lugarTexto: "N-403 km 62" });
    expect(extraccionDeterminista(AVISO).resumen).toContain(MARCA_DETERMINISTA);
    expect(extraccionDeterminista({ ...AVISO, personasEnRiesgo: true }).gravedad).toBe("critica");
    expect(extraccionDeterminista({ ...AVISO, viviendasCerca: false, tipo: "llamas" }).gravedad).toBe("moderada");
    expect(extraccionDeterminista({ ...AVISO, viviendasCerca: false }).gravedad).toBe("leve");
    expect(extraccionDeterminista({ ...AVISO, tipo: "ambos" }).tipo).toBe("incendio_activo");
    // Sin municipio ni lugar la fiabilidad baja; si no habla de fuego, casi nula.
    expect(extraccionDeterminista({ queVe: "humo", tipo: "humo" }).fiabilidad).toBe(0.4);
    expect(extraccionDeterminista({ queVe: "un coche mal aparcado", tipo: "otro" })).toMatchObject({ esIncendio: false, fiabilidad: 0.2 });
  });
});

describe("mensajeParaLocutor · lo que el agente le dice a la persona", () => {
  it("cada veredicto tiene su frase y siempre termina con el consejo de seguridad", () => {
    const foco = { nombre: "Incendio de Navalacruz", municipio: "Navalacruz" };
    expect(mensajeParaLocutor({ impacto: "nuevo_foco", foco, geolocalizada: true })).toMatch(/foco nuevo en Navalacruz/);
    expect(mensajeParaLocutor({ impacto: "confirma", foco, geolocalizada: true })).toMatch(/ya lo tenemos localizado \(Incendio de Navalacruz\)/);
    expect(mensajeParaLocutor({ impacto: "agrava", foco, geolocalizada: true })).toMatch(/su aviso lo confirma/);
    expect(mensajeParaLocutor({ impacto: "duplicada", geolocalizada: true })).toMatch(/coincide con otro aviso/);
    expect(mensajeParaLocutor({ impacto: "ruido", geolocalizada: true })).toMatch(/no consta un incendio/);
    expect(mensajeParaLocutor({ geolocalizada: true })).toMatch(/primer aviso de esa zona/);
    expect(mensajeParaLocutor({ geolocalizada: true, enAnalisis: true })).toMatch(/analizando ahora mismo/);
    for (const impacto of ["nuevo_foco", "registrada", undefined] as const) expect(mensajeParaLocutor({ impacto, geolocalizada: true })).toMatch(/Aléjese del humo/);
  });
  it("sin localización pide el pueblo o la carretera; con personas en peligro, que los medios ya salen", () => {
    expect(mensajeParaLocutor({ geolocalizada: false })).toMatch(/No he podido situar el lugar/);
    expect(mensajeParaLocutor({ geolocalizada: true })).not.toMatch(/No he podido situar/);
    expect(mensajeParaLocutor({ geolocalizada: true, personasEnRiesgo: true })).toMatch(/^Los medios ya salen/);
  });
});

describe("estadoEntrante · qué variable falta, con su nombre exacto", () => {
  const claves = ["HAPPYROBOT_API_KEY", "HAPPYROBOT_WORKFLOW_SLUG_ENTRANTE", "HAPPYROBOT_NUMERO_ENTRANTE", "HAPPYROBOT_WEBHOOK_SECRET"] as const;
  const previo: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of claves) previo[k] = process.env[k];
    process.env.HAPPYROBOT_API_KEY = "sk_live_prueba";
    process.env.HAPPYROBOT_WORKFLOW_SLUG_ENTRANTE = "abc123";
    process.env.HAPPYROBOT_NUMERO_ENTRANTE = "+15734018744";
    process.env.HAPPYROBOT_WEBHOOK_SECRET = "secreto";
  });
  afterEach(() => {
    for (const k of claves) {
      if (previo[k] === undefined) delete process.env[k];
      else process.env[k] = previo[k];
    }
  });
  it("con todo puesto está ok y enseña el número legible y el slug", () => {
    expect(estadoEntrante()).toMatchObject({ ok: true, numero: "+15734018744", numeroLegible: "+1 573 401 8744", slug: "abc123" });
    expect(estadoEntrante().detalle).toBe("112 virtual en el +1 573 401 8744 (workflow abc123)");
  });
  it("sin slug o sin número lo dice con el nombre de la variable (nada simulado)", () => {
    delete process.env.HAPPYROBOT_WORKFLOW_SLUG_ENTRANTE;
    expect(estadoEntrante()).toMatchObject({ ok: false });
    expect(estadoEntrante().detalle).toContain("Falta HAPPYROBOT_WORKFLOW_SLUG_ENTRANTE");
    process.env.HAPPYROBOT_WORKFLOW_SLUG_ENTRANTE = "abc123";
    delete process.env.HAPPYROBOT_NUMERO_ENTRANTE;
    expect(estadoEntrante().detalle).toContain("Falta HAPPYROBOT_NUMERO_ENTRANTE");
    process.env.HAPPYROBOT_NUMERO_ENTRANTE = "+15734018744";
    delete process.env.HAPPYROBOT_WEBHOOK_SECRET;
    expect(estadoEntrante().detalle).toContain("Falta HAPPYROBOT_WEBHOOK_SECRET");
  });
});

// ---------------------------------------------------------------------------
describe("registrarAvisoDeLlamada · la herramienta registrar_aviso", () => {
  it("con IA: sitúa el aviso, lo entrega a la centralita, lo verifica en el acto y devuelve el foco y qué decir", async () => {
    const r = await registrarAvisoDeLlamada(AVISO, { esperaMs: 2000 });

    // Geocodifica lugar + municipio (dentro de España) y pasa el punto a la centralita.
    expect(dobles.geocodificar).toHaveBeenCalledWith("N-403 km 62, Navalacruz, España");
    expect(dobles.procesarEntrada).toHaveBeenCalledTimes(1);
    expect(dobles.procesarEntrada.mock.calls[0][0]).toMatchObject({ canal: "llamada", remitente: "+34600000000", referenciaExterna: "run-1", punto: NAVALACRUZ });
    expect(dobles.verificar).toHaveBeenCalledTimes(1);

    expect(r).toMatchObject({ registrado: true, impacto: "nuevo_foco", geolocalizada: true, enAnalisis: false, extraccion: "ia" });
    expect(r.foco).toMatchObject({ id: "inc-1", nombre: "Incendio de Navalacruz", municipio: "Navalacruz" });
    expect(r.mensajeParaLocutor).toMatch(/foco nuevo en Navalacruz/);
    const obs = observacionDeLlamada(estado(), "run-1");
    expect(obs?.impacto).toBe("nuevo_foco");
    expect(obs?.texto).toContain("Qué ve: Una columna de humo negro");
  });

  it("sin proveedor de IA: la extracción sale de lo dictado, marcada como determinista, y el foco se declara igual", async () => {
    dobles.extraccionIA = false;
    const r = await registrarAvisoDeLlamada(AVISO, { esperaMs: 2000 });
    expect(r.extraccion).toBe("determinista");
    expect(r.impacto).toBe("nuevo_foco");
    const obs = observacionDeLlamada(estado(), "run-1");
    expect(obs?.extraccion?.resumen).toContain(MARCA_DETERMINISTA);
    expect(obs?.extraccion).toMatchObject({ gravedad: "grave", fiabilidad: 0.7 });
  });

  it("misma llamada dos veces (mismo run): amplía la observación y no crea otra", async () => {
    await registrarAvisoDeLlamada(AVISO, { esperaMs: 2000 });
    const r2 = await registrarAvisoDeLlamada({ ...AVISO, queVe: "Ahora también se ven llamas", tipo: "llamas" }, { esperaMs: 2000 });
    expect(dobles.procesarEntrada).toHaveBeenCalledTimes(1);
    expect([...estado().observaciones.values()].filter((o) => o.canal === "llamada")).toHaveLength(1);
    expect(r2.observacionId).toBe("obs-1");
    expect(r2.impacto).toBe("nuevo_foco");
    expect(observacionDeLlamada(estado(), "run-1")?.texto).toContain("Actualización durante la misma llamada:\nLlamada al 112 virtual");
  });

  it("no espera a la IA: contesta al momento con la extracción determinista y el foco declarado; el modelo refina después", async () => {
    dobles.demoraMs = 300;
    const t0 = Date.now();
    const r = await registrarAvisoDeLlamada(AVISO); // esperaMs por defecto: 0 (medido: la IA tardaba 14 s y dejaba mudo al agente)
    expect(Date.now() - t0).toBeLessThan(250);
    expect(r).toMatchObject({ enAnalisis: false, extraccion: "determinista", impacto: "nuevo_foco", geolocalizada: true });
    expect(dobles.verificar).toHaveBeenCalledTimes(1);
    await dormir(450);
    // La IA ha terminado: su extracción sustituye a la determinista y el foco sigue siendo el mismo.
    const obs = observacionDeLlamada(estado(), "run-1");
    expect(obs?.extraccion?.resumen).toContain("(modelo)");
    expect(obs?.impacto).toBe("nuevo_foco");
    expect(dobles.verificar).toHaveBeenCalledTimes(1);
  });

  it("si Nominatim tarda más que su tope, contesta «en análisis», sitúa en segundo plano y entonces declara el foco", async () => {
    dobles.demoraMs = 300; // la IA también tarda, como en la realidad
    dobles.geocodificar.mockImplementation(() => new Promise((r) => setTimeout(() => r({ punto: NAVALACRUZ, nombre: "Navalacruz", url: "" }), 300)));
    const r = await registrarAvisoDeLlamada(AVISO, { esperaGeoMs: 50 });
    expect(r).toMatchObject({ enAnalisis: true, geolocalizada: false, impacto: null, extraccion: "determinista" });
    expect(r.mensajeParaLocutor).toMatch(/analizando ahora mismo/);
    expect(r.mensajeParaLocutor).not.toMatch(/No he podido situar/);
    expect(dobles.verificar).not.toHaveBeenCalled();
    await dormir(450);
    const obs = observacionDeLlamada(estado(), "run-1");
    expect(obs?.punto).toEqual(NAVALACRUZ);
    expect(obs?.impacto).toBe("nuevo_foco");
    expect(dobles.verificar).toHaveBeenCalledTimes(1);
  });

  it("una observación verificada sin punto («registrada») se vuelve a verificar cuando llega el punto", async () => {
    dobles.geocodificar.mockResolvedValue(undefined);
    await registrarAvisoDeLlamada({ ...AVISO, runId: "run-5" }, { esperaMs: 2000 });
    const e = estado();
    const obs = observacionDeLlamada(e, "run-5")!;
    // El ciclo del verificador la dejó "registrada" por falta de localización…
    e.actualizar(e.observaciones, obs.id, { impacto: "registrada", verificacion: "Aviso por llamada sin localización: no se puede declarar foco." });
    // …y la persona vuelve a llamar a la herramienta con el punto.
    const r = await registrarAvisoDeLlamada({ ...AVISO, runId: "run-5", punto: NAVALACRUZ }, { esperaMs: 2000 });
    expect(r.impacto).toBe("nuevo_foco");
    expect(dobles.verificar).toHaveBeenCalledTimes(1);
  });

  it("si Nominatim no sitúa el lugar, registra sin punto, no declara foco y se lo dice a la persona", async () => {
    dobles.geocodificar.mockResolvedValue(undefined);
    const r = await registrarAvisoDeLlamada({ ...AVISO, runId: "run-2" }, { esperaMs: 2000 });
    expect(r.geolocalizada).toBe(false);
    // Sin punto no se verifica en el acto (quedaría "registrada" para siempre): lo hará el ciclo del verificador.
    expect(r.impacto).toBeNull();
    expect(dobles.verificar).not.toHaveBeenCalled();
    expect(r.foco).toBeNull();
    expect(r.mensajeParaLocutor).toMatch(/No he podido situar el lugar/);
    // Probó las consultas de la más concreta a la más vaga (la vía sola no se prueba si hay municipio).
    expect(dobles.geocodificar.mock.calls.map((c) => c[0])).toEqual(["N-403 km 62, Navalacruz, España", "Navalacruz, España"]);
  });

  it("un punto dictado dentro de España se usa sin geocodificar; uno de fuera se ignora", async () => {
    await registrarAvisoDeLlamada({ ...AVISO, runId: "run-3", punto: { lat: 40.5, lon: -5 } }, { esperaMs: 2000 });
    expect(dobles.geocodificar).not.toHaveBeenCalled();
    await registrarAvisoDeLlamada({ ...AVISO, runId: "run-4", punto: { lat: 48.85, lon: 2.35 } }, { esperaMs: 2000 });
    expect(dobles.geocodificar).toHaveBeenCalled();
    expect(observacionDeLlamada(estado(), "run-4")?.punto).toEqual(NAVALACRUZ);
  });

  it("si la centralita falla, el error llega tal cual (nunca un éxito fingido)", async () => {
    dobles.procesarEntrada.mockRejectedValueOnce(new Error("La entrada no trae texto"));
    await expect(registrarAvisoDeLlamada(AVISO, { esperaMs: 2000 })).rejects.toThrow("La entrada no trae texto");
  });
});

describe("adjuntarTranscripcion · al colgar, la transcripción va a la observación del run", () => {
  it("adjunta una sola vez, completa el remitente y registra el evento", async () => {
    await registrarAvisoDeLlamada({ ...AVISO, telefono: undefined }, { esperaMs: 2000 });
    const eventosAntes = estado().eventos.length;
    const a = adjuntarTranscripcion("run-1", "Operador: 112… Ciudadano: veo humo en la N-403…", "+34600000000");
    expect(a?.id).toBe("obs-1");
    expect(a?.texto).toContain(`${MARCA_TRANSCRIPCION}\nOperador: 112…`);
    expect(a?.remitente).toBe("+34600000000");
    expect(estado().eventos.length).toBe(eventosAntes + 1);
    expect(estado().eventos.at(-1)).toMatchObject({ tipo: "observacion", agenteId: "centralita", datos: { observacionId: "obs-1", referenciaExterna: "run-1", adjuntada: true } });
    // Segunda entrega del mismo webhook: no duplica el texto.
    const b = adjuntarTranscripcion("run-1", "otra vez", "+34600000000");
    expect(b?.texto.split(MARCA_TRANSCRIPCION)).toHaveLength(2);
    expect([...estado().observaciones.values()]).toHaveLength(1);
  });
  it("un run desconocido devuelve undefined (el webhook creará la observación)", () => {
    expect(adjuntarTranscripcion("run-inexistente", "hola")).toBeUndefined();
  });
});

describe("desincronizado · la URL publicada en HappyRobot frente a la URL pública actual", () => {
  it("distinto túnel → desincronizado; mismo origen con o sin ruta → en orden; sin datos → no se afirma nada", async () => {
    const { baseDeUrl, desincronizado } = await import("@/lib/happyrobot/entrante");
    expect(baseDeUrl("https://a.trycloudflare.com/api/happyrobot/aviso")).toBe("https://a.trycloudflare.com");
    expect(baseDeUrl("no es una url")).toBeUndefined();
    expect(desincronizado("https://nuevo.trycloudflare.com", "https://viejo.trycloudflare.com/api/happyrobot/aviso")).toBe(true);
    expect(desincronizado("https://a.trycloudflare.com", "https://a.trycloudflare.com/api/happyrobot/aviso")).toBe(false);
    expect(desincronizado(undefined, "https://a.trycloudflare.com/api/happyrobot/aviso")).toBe(false);
    expect(desincronizado("https://a.trycloudflare.com", undefined)).toBe(false);
  });
});

describe("preprocesado de la dirección dictada · lo que el reconocimiento de voz nos da", () => {
  it("números en letras → cifras", async () => {
    const { numeroEnPalabras } = await import("@/lib/happyrobot/entrante");
    expect(numeroEnPalabras("treinta")).toBe(30);
    expect(numeroEnPalabras("cuarenta y dos")).toBe(42);
    expect(numeroEnPalabras("ciento doce")).toBe(112);
    expect(numeroEnPalabras("doscientos quince")).toBe(215);
    expect(numeroEnPalabras("veintiséis")).toBe(26);
    expect(numeroEnPalabras("complutense")).toBeUndefined();
  });

  it("normaliza abreviaturas y números: lo que dictó la persona en la llamada real", async () => {
    const { normalizarDireccion, viaConNumero } = await import("@/lib/happyrobot/entrante");
    expect(normalizarDireccion("Avenida Complutense treinta, Técnica Superior de Ingeniería de Autorcomunicación")).toBe("Avenida Complutense 30, Técnica Superior de Ingeniería de Autorcomunicación");
    expect(normalizarDireccion("Avda. Complutense treinta")).toBe("Avenida Complutense 30");
    expect(normalizarDireccion("c/ Mayor quince")).toBe("Calle Mayor 15");
    expect(normalizarDireccion("N-403 p.k. 62")).toBe("N-403 km 62");
    expect(normalizarDireccion("ctra. de Ávila kilómetro cuarenta y dos")).toBe("Carretera de Ávila km 42");
    // La vía con su número, sin la coletilla del reconocimiento de voz.
    expect(viaConNumero("Avenida Complutense treinta, Técnica Superior de Ingeniería de Autorcomunicación")).toBe("Avenida Complutense 30");
    expect(viaConNumero("N-403 km 62, junto a la ermita")).toBe("N-403 km 62");
    expect(viaConNumero("junto a la ermita")).toBeUndefined();
  });

  it("las consultas van de la más precisa a la más vaga y el municipio a secas es la última", async () => {
    const { candidatasConPrecision } = await import("@/lib/happyrobot/entrante");
    const c = candidatasConPrecision({ lugar: "Avenida Complutense treinta, Técnica Superior de Ingeniería de Autorcomunicación", municipio: "Arabaca, Madrid" });
    expect(c[0]).toEqual({ consulta: "Avenida Complutense 30, Madrid", precision: "direccion" });
    expect(c[1]).toEqual({ consulta: "Avenida Complutense 30, Arabaca, Madrid", precision: "direccion" });
    expect(c.at(-1)).toEqual({ consulta: "Madrid", precision: "municipio" });
    expect(c.find((x) => x.consulta === "Arabaca, Madrid")?.precision).toBe("barrio");
    expect(candidatasConPrecision({ lugar: "junto a la ermita", municipio: "Navalacruz" })).toEqual([
      { consulta: "junto a la ermita, Navalacruz", precision: "lugar" },
      { consulta: "Navalacruz", precision: "municipio" },
    ]);
    expect(candidatasConPrecision({})).toEqual([]);
  });

  it("situarLugar devuelve la precisión de la consulta que acertó y una frase para confirmar o pedir más", async () => {
    const { situarLugar } = await import("@/lib/happyrobot/entrante");
    const a = { lugar: "Avenida Complutense treinta, Técnica Superior de Ingeniería de Autorcomunicación", municipio: "Madrid" };
    // Nominatim real (medido): la vía con número resuelve en la ETSIT; el municipio a secas en la Puerta del Sol.
    dobles.geocodificar.mockImplementation(async (q: string) =>
      q.startsWith("Avenida Complutense 30, Madrid") ? { punto: { lat: 40.45287, lon: -3.72556 }, nombre: "Edificio B, ETSI de Telecomunicación", municipio: "Madrid", provincia: "Madrid", url: "" } : q === "Madrid, España" ? { punto: NAVALACRUZ, nombre: "Madrid", municipio: "Madrid", url: "" } : undefined,
    );
    const r = await situarLugar(a);
    expect(r).toMatchObject({ encontrado: true, precision: "direccion", lat: 40.45287, lon: -3.72556, municipio: "Madrid", consulta: "Avenida Complutense 30, Madrid" });
    // Con una dirección se confirma con la calle y el número, no con la etiqueta del mapa ("ETSI…").
    expect(r.mensajeParaLocutor).toBe("Lo tengo en Avenida Complutense 30, Madrid. ¿Es ahí?");
    expect(dobles.geocodificar).toHaveBeenCalledTimes(1);

    // Solo el municipio: el agente tiene que pedir una referencia más.
    const r2 = await situarLugar({ lugar: "por el monte", municipio: "Madrid" });
    expect(r2).toMatchObject({ encontrado: true, precision: "municipio" });
    expect(r2.mensajeParaLocutor).toMatch(/Solo tengo el municipio, Madrid/);

    dobles.geocodificar.mockResolvedValue(undefined);
    const r3 = await situarLugar({ lugar: "no sé", municipio: "Xyz" });
    expect(r3).toMatchObject({ encontrado: false, precision: "ninguna" });
    expect(r3.mensajeParaLocutor).toMatch(/No encuentro ese lugar/);
    expect((await situarLugar({})).precision).toBe("ninguna");
  });

  it("registrar_aviso con lat/lon confirmados por situar_lugar no vuelve a geocodificar", async () => {
    const r = avisoDesdeCuerpo({ run_id: "run-8", municipio: "Madrid", lugar: "Avenida Complutense 30", que_ve: "llamas", lat: "40.45287", lon: "-3.72556" });
    const res = await registrarAvisoDeLlamada(r.aviso!, { esperaMs: 2000 });
    expect(dobles.geocodificar).not.toHaveBeenCalled();
    expect(observacionDeLlamada(estado(), "run-8")?.punto).toEqual({ lat: 40.45287, lon: -3.72556 });
    expect(res.impacto).toBe("nuevo_foco");
  });
});


// ---------------------------------------------------------------------------
describe("situar_lugar con IA · interpreta lo dictado antes de buscarlo", () => {
  /** Interpretación que devolvería el modelo para la llamada real de las 17:56. */
  const interpretacion = (consultas: { consulta: string; precision: "direccion" | "lugar" | "barrio" | "municipio" }[], extra: Record<string, unknown> = {}) => ({
    lugarCorregido: "Avenida Complutense 30, Ciudad Universitaria, Madrid",
    via: "Avenida Complutense",
    numero: "30",
    kilometro: "",
    lugarConocido: "Escuela Técnica Superior de Ingenieros de Telecomunicación",
    barrio: "Ciudad Universitaria",
    municipio: "Madrid",
    provincia: "Madrid",
    municipioDeducido: true,
    correcciones: "Autorcomunicación → Telecomunicación; treinta → 30",
    consultas,
    ...extra,
  });
  const ETSIT = { punto: { lat: 40.45287, lon: -3.72556 }, nombre: "Edificio B, ETSI de Telecomunicación", municipio: "Madrid", provincia: "Madrid", url: "" };

  it("consultasDeInterpretacion quita «España», repetidas y vacías, y se queda con cuatro", async () => {
    const { consultasDeInterpretacion } = await import("@/lib/happyrobot/ubicacion-ia");
    const c = consultasDeInterpretacion(interpretacion([
      { consulta: "Avenida Complutense 30, Madrid, España", precision: "direccion" },
      { consulta: "avenida complutense 30,  Madrid", precision: "direccion" },
      { consulta: "  ", precision: "lugar" },
      { consulta: "ETSI de Telecomunicación, Madrid", precision: "lugar" },
      { consulta: "Avenida Complutense, Madrid", precision: "lugar" },
      { consulta: "Ciudad Universitaria, Madrid", precision: "barrio" },
      { consulta: "Madrid", precision: "municipio" },
    ]));
    expect(c.map((x) => x.consulta)).toEqual(["Avenida Complutense 30, Madrid", "ETSI de Telecomunicación, Madrid", "Avenida Complutense, Madrid", "Ciudad Universitaria, Madrid"]);
  });

  it("unirCandidatas pone primero las de la IA y no repite las de las reglas", async () => {
    const { unirCandidatas } = await import("@/lib/happyrobot/entrante");
    const u = unirCandidatas(
      [{ consulta: "ETSI de Telecomunicación, Madrid", precision: "lugar" }, { consulta: "Avenida Complutense 30, Madrid", precision: "direccion" }],
      [{ consulta: "Avenida Complutense 30, Madrid", precision: "direccion" }, { consulta: "Madrid", precision: "municipio" }],
    );
    expect(u).toEqual([
      { consulta: "ETSI de Telecomunicación, Madrid", precision: "lugar", origen: "ia" },
      { consulta: "Avenida Complutense 30, Madrid", precision: "direccion", origen: "ia" },
      { consulta: "Madrid", precision: "municipio", origen: "reglas" },
    ]);
  });

  it("donde las reglas no llegan, la IA acierta: «la escuela de teleco de la complutense» sin pueblo", async () => {
    const { situarLugar } = await import("@/lib/happyrobot/entrante");
    dobles.iaDisponible = true;
    dobles.completarJson.mockResolvedValue({ datos: interpretacion([{ consulta: "ETSI de Telecomunicación, Madrid", precision: "lugar" }, { consulta: "Madrid", precision: "municipio" }]) });
    dobles.geocodificar.mockImplementation(async (q: string) => (q === "ETSI de Telecomunicación, Madrid, España" ? ETSIT : undefined));
    const r = await situarLugar({ lugar: "la escuela de teleco de la complutense" });
    expect(r).toMatchObject({ encontrado: true, precision: "lugar", origen: "ia", lat: 40.45287, lon: -3.72556, consulta: "ETSI de Telecomunicación, Madrid" });
    expect(r.interpretacion).toBe("Avenida Complutense 30, Ciudad Universitaria, Madrid");
    expect(r.correcciones).toMatch(/Telecomunicación/);
    // Con un lugar se dice su nombre, sin siglas leídas letra a letra.
    expect(r.mensajeParaLocutor).toBe("Lo tengo en Edificio B, Escuela de Ingenieros de Telecomunicación, Madrid. ¿Es ahí?");
    // Al modelo le llega lo dictado tal cual, con prioridad alta y un tope de tiempo.
    const peticion = dobles.completarJson.mock.calls[0][0] as { user: string; papel: string; prioridad: string; signal: AbortSignal };
    expect(peticion.user).toContain("la escuela de teleco de la complutense");
    // Sin razonar (qwen3.6 tardaba 16-23 s pensando) y aunque la sala esté en pausa: hay alguien al teléfono.
    expect(peticion).toMatchObject({ papel: "rapido", prioridad: "alta", sinRazonar: true, permitirEnPausa: true });
    expect(peticion.signal).toBeInstanceOf(AbortSignal);
  });

  it("si la IA no contesta a tiempo, siguen solas las reglas y la respuesta llega igual", async () => {
    const { situarLugar } = await import("@/lib/happyrobot/entrante");
    dobles.iaDisponible = true;
    dobles.completarJson.mockImplementation(
      (p: { signal: AbortSignal }) => new Promise((_, rechazar) => p.signal.addEventListener("abort", () => rechazar(new Error("Tiempo agotado")))),
    );
    dobles.geocodificar.mockImplementation(async (q: string) => (q === "Avenida Complutense 30, Madrid, España" ? ETSIT : undefined));
    const t0 = Date.now();
    const r = await situarLugar({ lugar: "Avenida Complutense treinta", municipio: "Madrid" }, { tiempoMaxIaMs: 60 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r).toMatchObject({ encontrado: true, precision: "direccion", origen: "reglas", interpretacion: null, correcciones: null });
  });

  it("la respuesta tiene SIEMPRE todas las claves (HappyRobot solo deja ver al agente las que existen)", async () => {
    const { situarLugar, situarSinDatos } = await import("@/lib/happyrobot/entrante");
    const claves = ["encontrado", "precision", "nombre", "municipio", "provincia", "lat", "lon", "consulta", "interpretacion", "correcciones", "origen", "mensajeParaLocutor"].sort();
    dobles.geocodificar.mockResolvedValue(undefined);
    expect(Object.keys(await situarLugar({ lugar: "no sé", municipio: "Xyz" })).sort()).toEqual(claves);
    expect(Object.keys(situarSinDatos()).sort()).toEqual(claves);
    expect(situarSinDatos()).toMatchObject({ encontrado: false, precision: "ninguna", lat: null, lon: null });
  });

  it("registrar_aviso usa el punto que situar_lugar encontró en la llamada, no las coordenadas que repite el agente", async () => {
    const { situarLugar } = await import("@/lib/happyrobot/entrante");
    dobles.geocodificar.mockImplementation(async (q: string) => (q === "Avenida Complutense 30, Madrid, España" ? ETSIT : undefined));
    await situarLugar({ lugar: "Avenida Complutense treinta", municipio: "Madrid" }, { runId: "run-17" });
    dobles.geocodificar.mockClear();
    // El agente de la llamada real registró 40.4527, -3.7281 sin haber visto la respuesta: se ignora.
    const r = avisoDesdeCuerpo({ run_id: "run-17", municipio: "Madrid", lugar: "Avenida Complutense 30", que_ve: "llamas en la escuela", lat: "40.4527", lon: "-3.7281" });
    await registrarAvisoDeLlamada(r.aviso!, { esperaMs: 2000 });
    expect(observacionDeLlamada(estado(), "run-17")?.punto).toEqual(ETSIT.punto);
    expect(dobles.geocodificar).not.toHaveBeenCalled();
  });

  it("el centroide del municipio no se guarda como punto confirmado de la llamada", async () => {
    const { situarLugar, puntoSituadoEnLlamada } = await import("@/lib/happyrobot/entrante");
    dobles.geocodificar.mockImplementation(async (q: string) => (q === "Madrid, España" ? { punto: { lat: 40.41678, lon: -3.70351 }, nombre: "Madrid", municipio: "Madrid", url: "" } : undefined));
    const r = await situarLugar({ lugar: "por aquí", municipio: "Madrid" }, { runId: "run-18" });
    expect(r.precision).toBe("municipio");
    expect(puntoSituadoEnLlamada("run-18")).toBeUndefined();
  });
});

describe("avisoSinDatos · registrar_aviso sin lo mínimo", () => {
  it("responde con las mismas claves que un registro, registrado:false y qué pedir", async () => {
    const { avisoSinDatos } = await import("@/lib/happyrobot/entrante");
    const vacio = avisoSinDatos("El aviso no trae ni qué ve ni dónde");
    const lleno = await registrarAvisoDeLlamada(AVISO, { esperaMs: 2000 });
    for (const k of Object.keys(lleno)) expect(vacio).toHaveProperty(k);
    expect(vacio).toMatchObject({ registrado: false, observacionId: null, motivo: "El aviso no trae ni qué ve ni dónde" });
    expect(vacio.mensajeParaLocutor).toMatch(/necesito el pueblo y qué está viendo/);
  });
});

describe("precisionDeConsulta · la precisión la deciden las reglas, no la etiqueta del modelo", () => {
  it("vía con número → dirección; edificio o vía sin número → lugar; barrio → barrio; municipio → municipio", async () => {
    const { precisionDeConsulta, consultasDeInterpretacion } = await import("@/lib/happyrobot/ubicacion-ia");
    const i = { municipio: "Madrid", provincia: "Madrid", barrio: "Ciudad Universitaria" };
    expect(precisionDeConsulta("Avenida Complutense 30, Madrid", i)).toBe("direccion");
    expect(precisionDeConsulta("N-403 km 62, Navalacruz", { municipio: "Navalacruz", provincia: "Ávila", barrio: "" })).toBe("direccion");
    expect(precisionDeConsulta("ETSI de Telecomunicación, Madrid", i)).toBe("lugar");
    expect(precisionDeConsulta("Avenida Complutense, Madrid", i)).toBe("lugar");
    expect(precisionDeConsulta("Ciudad Universitaria, Madrid", i)).toBe("barrio");
    expect(precisionDeConsulta("Madrid", i)).toBe("municipio");
    expect(precisionDeConsulta("Madrid, Comunidad de Madrid", i)).toBe("municipio");
    // Lo que pasó en la prueba real: el modelo etiquetó "municipio" una dirección completa.
    const c = consultasDeInterpretacion({
      lugarCorregido: "", via: "", numero: "", kilometro: "", lugarConocido: "", barrio: "", municipio: "Madrid", provincia: "Madrid", municipioDeducido: true, correcciones: "",
      consultas: [{ consulta: "Avenida Complutense 30, Madrid", precision: "municipio" }],
    });
    expect(c).toEqual([{ consulta: "Avenida Complutense 30, Madrid", precision: "direccion" }]);
  });
});

describe("frases para la voz · pulidas tras la llamada de las 18:46", () => {
  it("paraVoz quita las siglas que el agente leía letra a letra", async () => {
    const { paraVoz } = await import("@/lib/happyrobot/entrante");
    expect(paraVoz("Edificio B, ETSI de Telecomunicación")).toBe("Edificio B, Escuela de Ingenieros de Telecomunicación");
    expect(paraVoz("C/ Mayor 15, Avda. de América")).toBe("Calle Mayor 15, Avenida de América");
    expect(paraVoz("IES Ramiro de Maeztu")).toBe("Instituto Ramiro de Maeztu");
  });

  it("el cierre es corto y el consejo depende de si arde un edificio o el monte", async () => {
    const { esAvisoUrbano } = await import("@/lib/happyrobot/entrante");
    expect(esAvisoUrbano({ queVe: "un incendio increíble", lugar: "Edificio B, ETSI de Telecomunicación" })).toBe(true);
    expect(esAvisoUrbano({ queVe: "hay gente encerrada en la facultad", lugar: "Avenida Complutense 30" })).toBe(true);
    expect(esAvisoUrbano({ queVe: "columna de humo en el pinar", lugar: "N-403 km 62" })).toBe(false);
    const urbano = mensajeParaLocutor({ impacto: "nuevo_foco", foco: { nombre: "Incendio de Madrid", municipio: "Madrid" }, geolocalizada: true, urbano: true });
    expect(urbano).toBe("Aviso registrado. La sala ha abierto un foco nuevo en Madrid y está enviando medios. Aléjese del humo y del edificio, y no vuelva a entrar.");
    expect(urbano).not.toMatch(/ladera|barranco/);
    const monte = mensajeParaLocutor({ impacto: "nuevo_foco", foco: { nombre: "Incendio de Navalacruz", municipio: "Navalacruz" }, geolocalizada: true });
    expect(monte).toMatch(/nunca ladera arriba/);
    // Más corto que el cierre de la llamada real (182 caracteres).
    expect(urbano.length).toBeLessThan(140);
  });

  it("registrar_aviso usa el consejo urbano cuando el aviso habla de un edificio", async () => {
    const r = await registrarAvisoDeLlamada({ ...AVISO, runId: "run-urbano", queVe: "un incendio en la escuela", lugar: "Avenida Complutense 30" }, { esperaMs: 2000 });
    expect(r.mensajeParaLocutor).toMatch(/Aléjese del humo y del edificio/);
  });

  it("la transcripción que llega en JSON al colgar se guarda legible en la ficha", async () => {
    await registrarAvisoDeLlamada({ ...AVISO, runId: "run-json" }, { esperaMs: 2000 });
    const json = JSON.stringify([
      { role: "assistant", content: "Emergencias, dígame. ¿Qué ocurre y dónde está?", start: 420 },
      { role: "user", content: "En Avenida Complutense treinta, en Madrid.", start: 4430 },
      { role: "tool", name: "situar_lugar", content: "{\"encontrado\":true}" },
    ]);
    const o = adjuntarTranscripcion("run-json", json, "+34600000000");
    expect(o?.texto).toContain(`${MARCA_TRANSCRIPCION}\nOperador: Emergencias, dígame. ¿Qué ocurre y dónde está?\nPersona: En Avenida Complutense treinta, en Madrid.`);
    expect(o?.texto).not.toContain('"role"');
  });
});

describe("consultas de la IA · la coma antes del municipio (pausa al leerla)", () => {
  it("«Avenida Complutense 30 Madrid» → «Avenida Complutense 30, Madrid»", async () => {
    const { consultasDeInterpretacion } = await import("@/lib/happyrobot/ubicacion-ia");
    const c = consultasDeInterpretacion({
      lugarCorregido: "", via: "", numero: "", kilometro: "", lugarConocido: "", barrio: "", municipio: "Madrid", provincia: "Madrid", municipioDeducido: false, correcciones: "",
      consultas: [{ consulta: "Avenida Complutense 30 Madrid", precision: "direccion" }, { consulta: "Madrid", precision: "municipio" }],
    });
    expect(c.map((x) => x.consulta)).toEqual(["Avenida Complutense 30, Madrid", "Madrid"]);
  });
});
