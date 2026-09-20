// Pruebas de lib/agentes/ejecucion/ejecutor.ts · VOZ SALIENTE DESACTIVADA (Javi, 19-09-2026: «que sea solo
// SMS»). Todo lo que era llamada sale por SMS al mismo destino y el acta lo dice. HappyRobot, Telegram y OSRM
// se sustituyen por dobles; el Estado es el REAL en memoria. DUEÑO: sesión fireops-00.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Accion, Decision, Observacion, Poblacion } from "@/lib/dominio/tipos";
import type { ContextoAgente } from "@/lib/motor/contratos";

const dobles = vi.hoisted(() => ({ enviarSms: vi.fn(), llamar: vi.fn(), enviarEmail: vi.fn() }));
vi.mock("@/lib/happyrobot/cliente", async (importar) => {
  const mod = await importar<typeof import("@/lib/happyrobot/cliente")>();
  return { ...mod, enviarSms: (...a: unknown[]) => dobles.enviarSms(...a), llamar: (...a: unknown[]) => dobles.llamar(...a), enviarEmail: (...a: unknown[]) => dobles.enviarEmail(...a) };
});
vi.mock("@/lib/agentes/ejecucion/despachador", () => ({ asignar: vi.fn(), retirar: vi.fn() }));
vi.mock("@/lib/telegram/cliente", () => ({ chatDemo: () => undefined, enviarMensaje: vi.fn(), enviarMensajeTrazado: vi.fn() }));

import { Estado } from "@/lib/motor/estado";
import { ejecutorAcciones, VOZ_DESACTIVADA } from "@/lib/agentes/ejecucion/ejecutor";
import { asignar } from "@/lib/agentes/ejecucion/despachador";
import type { Incendio, Unidad } from "@/lib/dominio/tipos";

const CLAVES = [
  "DESTINO_DEMO",
  "TELEFONO_AVISOS_SMS",
  "EMAIL_DEMO",
  "HAPPYROBOT_API_KEY",
  "HAPPYROBOT_WORKFLOW_SLUG_SMS",
  "HAPPYROBOT_WORKFLOW_SLUG_EMAIL",
  "ATALAYA_EFECTOS_INTERCEPTADOS",
] as const;
const previo: Record<string, string | undefined> = {};
let estado: Estado;

const envio = (referencia: string) => ({ referencia, proveedor: "HappyRobot" as const, peticion: { telefono: "…" }, respuesta: "{}", duracionMs: 5, urlPeticion: "https://hr.invalid" });
const ctx = (): ContextoAgente => ({
  estado,
  snapshot: estado.snapshot(),
  ahoraMundo: estado.reloj.ahoraMundo,
  minutosMundoDesdeUltimoCiclo: 0,
  registrar: vi.fn(),
  informarTarea: vi.fn(),
  lecciones: [],
  abortSignal: new AbortController().signal,
});
const decision = (acciones: Accion[] = []): Decision => ({
  id: "dec-1",
  ejecucionId: "ej-1",
  agenteId: "proteccion_poblacion",
  incendioId: "inc-1",
  titulo: "Aviso a Salobral",
  resumen: "Incendio forestal a 2 km de Salobral: activen el plan municipal.",
  razonamiento: "El frente avanza hacia el casco urbano.",
  prioridad: 2,
  riesgo: 20,
  competencia: "autonoma",
  estado: "aprobada",
  acciones,
  evidencias: [],
  fundamentos: [],
  creadaEn: new Date().toISOString(),
  creadaEnMundo: new Date().toISOString(),
});
const accion = (tipo: Accion["tipo"], extra: Partial<Accion> = {}): Accion => ({ id: "acc-1", tipo, descripcion: `Acción ${tipo}`, parametros: {}, estado: "pendiente", ...extra });
const SALOBRAL: Poblacion = { id: "pob-1", nombre: "Salobral", centro: { lat: 40.6, lon: -4.75 }, tipo: "pueblo", incendioId: "inc-1", distanciaKm: 2.1, rumboDesdeFuegoGrados: 90, riesgo: "alto", estadoAviso: "sin_avisar", telefono: "+34600000001" };

beforeEach(() => {
  estado = new Estado();
  for (const k of CLAVES) {
    previo[k] = process.env[k];
    delete process.env[k];
  }
  // Estas pruebas sustituyen los envíos por dobles, pero atraviesan las mismas
  // compuertas que producción. Configuramos expresamente los canales para que
  // el resultado no dependa del .env.local de quien ejecute la suite.
  process.env.HAPPYROBOT_API_KEY = "unit-test";
  process.env.HAPPYROBOT_WORKFLOW_SLUG_SMS = "unit-test-sms";
  process.env.HAPPYROBOT_WORKFLOW_SLUG_EMAIL = "unit-test-email";
  dobles.enviarSms.mockReset().mockResolvedValue(envio("run-sms-1"));
  dobles.llamar.mockReset().mockRejectedValue(new Error("la voz saliente no debe usarse"));
  dobles.enviarEmail.mockReset().mockResolvedValue(envio("run-email-1"));
});
afterEach(() => {
  for (const k of CLAVES) {
    if (previo[k] === undefined) delete process.env[k];
    else process.env[k] = previo[k];
  }
});

describe("ejecutor · la voz saliente está desactivada: todo sale por SMS", () => {
  it("una acción «llamar» manda el guion por SMS al mismo destino (≤ 300) y el acta lo dice", async () => {
    const guion = "Buenos días, le llamo del Centro de Coordinación. Hay un incendio a dos kilómetros del casco urbano. ".repeat(5);
    const r = await ejecutorAcciones.ejecutar(accion("llamar", { objetivo: { telefono: "+34611222333" }, parametros: { guion } }), decision(), ctx());
    expect(dobles.llamar).not.toHaveBeenCalled();
    expect(dobles.enviarSms).toHaveBeenCalledTimes(1);
    const p = dobles.enviarSms.mock.calls[0][0] as { destino: string; texto: string; decisionId: string; accionId: string };
    expect(p).toMatchObject({ destino: "+34611222333", decisionId: "dec-1", accionId: "acc-1" });
    expect(p.texto.length).toBeLessThanOrEqual(300);
    expect(p.texto.startsWith("Buenos días, le llamo")).toBe(true);
    expect(r.estado).toBe("ejecutada");
    expect(r.resultado?.resumen).toBe(`${VOZ_DESACTIVADA}: SMS enviado a +346***33 (run run-sms-1).`);
    expect(r.resultado?.datos).toMatchObject({ vozDesactivada: true, canal: "sms", referencia: "run-sms-1" });
  });

  it("avisar a una población va SOLO por SMS: un envío, contacto por «sms» y estado «avisando»", async () => {
    estado.guardar(estado.poblaciones, SALOBRAL);
    const c = ctx();
    const a = accion("avisar_poblacion", { objetivo: { poblacionId: "pob-1" }, parametros: { guion: "Guion largo de llamada que ya no se usa", sms: "Salobral: incendio a 2 km. Activen el plan municipal. Información: 112." } });
    const r = await ejecutorAcciones.ejecutar(a, decision([a]), c);
    expect(dobles.llamar).not.toHaveBeenCalled();
    expect(dobles.enviarSms).toHaveBeenCalledTimes(1);
    expect(dobles.enviarSms.mock.calls[0][0]).toMatchObject({ destino: "+34600000001", texto: "(Aviso a población) Salobral: incendio a 2 km. Activen el plan municipal. Información: 112." });
    expect(r.estado).toBe("ejecutada");
    expect(r.resultado?.resumen).toMatch(/^Salobral: SMS enviado al \+346\*\*\*01 \(run run-sms-1\)\./);
    expect(r.resultado?.resumen).not.toMatch(/llamada/i);
    expect(r.resultado?.datos).toMatchObject({ vozDesactivada: true, sms: { referencia: "run-sms-1" } });
    const pob = estado.poblaciones.get("pob-1")!;
    expect(pob.estadoAviso).toBe("avisando");
    expect(pob.ultimoContacto).toMatchObject({ canal: "sms" });
    expect((c.registrar as ReturnType<typeof vi.fn>).mock.calls.map((x) => x[0])).toContain("poblacion_avisada");
  });

  it("sin teléfono en OSM cae al del .env (TELEFONO_AVISOS_SMS vale igual que DESTINO_DEMO); sin ninguno, falla y lo dice", async () => {
    estado.guardar(estado.poblaciones, { ...SALOBRAL, telefono: undefined });
    const a = accion("avisar_poblacion", { objetivo: { poblacionId: "pob-1" }, parametros: { sms: "Aviso." } });
    const sinTelefono = await ejecutorAcciones.ejecutar(a, decision([a]), ctx());
    expect(sinTelefono.estado).toBe("fallida");
    expect(sinTelefono.resultado?.resumen).toMatch(/Falta DESTINO_DEMO o TELEFONO_AVISOS_SMS/);
    expect(estado.poblaciones.get("pob-1")!.estadoAviso).toBe("sin_respuesta");
    expect(dobles.enviarSms).not.toHaveBeenCalled();

    process.env.TELEFONO_AVISOS_SMS = "+34699000111";
    const conReserva = await ejecutorAcciones.ejecutar(a, decision([a]), ctx());
    expect(conReserva.estado).toBe("ejecutada");
    expect(dobles.enviarSms.mock.calls[0][0]).toMatchObject({ destino: "+34699000111" });
  });

  it("un SMS suelto a una población lleva la etiqueta «(Aviso a población)»; a otro destino, no", async () => {
    await ejecutorAcciones.ejecutar(accion("enviar_sms", { objetivo: { telefono: "+34611222333", poblacionId: "pob-1" }, parametros: { sms: "Activen el plan municipal." } }), decision(), ctx());
    expect((dobles.enviarSms.mock.calls[0][0] as { texto: string }).texto).toBe("(Aviso a población) Activen el plan municipal.");
    await ejecutorAcciones.ejecutar(accion("enviar_sms", { objetivo: { telefono: "+34611222333" }, parametros: { sms: "Activen el plan municipal." } }), decision(), ctx());
    expect((dobles.enviarSms.mock.calls[1][0] as { texto: string }).texto).toBe("Activen el plan municipal.");
    // Un texto que ya viene etiquetado no se etiqueta dos veces.
    await ejecutorAcciones.ejecutar(accion("enviar_sms", { objetivo: { telefono: "+34611222333", poblacionId: "pob-1" }, parametros: { sms: "(Aviso a población) Ya etiquetado." } }), decision(), ctx());
    expect((dobles.enviarSms.mock.calls[2][0] as { texto: string }).texto).toBe("(Aviso a población) Ya etiquetado.");
  });

  it("pedir confirmación a quien avisó por llamada también va por SMS", async () => {
    const obs: Observacion = { id: "obs-1", canal: "llamada", recibidaEn: new Date().toISOString(), texto: "Veo humo", remitente: "+34600000002" };
    estado.guardar(estado.observaciones, obs);
    const r = await ejecutorAcciones.ejecutar(accion("solicitar_confirmacion", { parametros: { observacionId: "obs-1", canal: "llamada" } }), decision(), ctx());
    expect(dobles.llamar).not.toHaveBeenCalled();
    expect(dobles.enviarSms).toHaveBeenCalledTimes(1);
    expect(dobles.enviarSms.mock.calls[0][0]).toMatchObject({ destino: "+34600000002" });
    expect(r.resultado?.resumen).toMatch(/por SMS \(run run-sms-1\)/);
  });

  it("solicitar medios aéreos: parte por correo y aviso por SMS al organismo, sin llamada", async () => {
    process.env.DESTINO_DEMO = "+34699000222";
    process.env.EMAIL_DEMO = process.env.EMAIL_DEMO || "demo@example.com";
    const r = await ejecutorAcciones.ejecutar(accion("solicitar_medios_aereos", { parametros: { tipo: "dos hidroaviones", motivo: "El frente avanza hacia el pinar." } }), decision(), ctx());
    expect(dobles.llamar).not.toHaveBeenCalled();
    expect(dobles.enviarEmail).toHaveBeenCalledTimes(1);
    expect(dobles.enviarSms).toHaveBeenCalledTimes(1);
    const sms = dobles.enviarSms.mock.calls[0][0] as { destino: string; texto: string };
    expect(sms.destino).toBe("+34699000222");
    expect(sms.texto).toMatch(/solicitamos dos hidroaviones/);
    expect(sms.texto.length).toBeLessThanOrEqual(300);
    expect(r.estado).toBe("ejecutada");
    expect(r.resultado?.resumen).toMatch(/SMS al organismo \(run run-sms-1\)/);
    expect(r.resultado?.resumen).not.toMatch(/llamada/i);
  });
});

describe("ejecutor · órdenes a unidades: SMS legible y solo a teléfonos reales", () => {
  const BRUNETE = { id: "inc-1", nombre: "Incendio de Brunete", municipio: "Brunete", centro: { lat: 40.4, lon: -3.99 }, estado: "detectado" } as unknown as Incendio;
  const unidad = (telefono?: string): Unidad => ({ id: "u-1", nombre: "Parque de bomberos · BUL", tipo: "bomberos", base: { nombre: "Parque", punto: { lat: 40.5, lon: -4.1 } }, posicion: { lat: 40.5, lon: -4.1 }, estado: "disponible", velocidadKmh: 60, dotacion: { personas: 5, vehiculos: 1 }, telefono, fuente: "OSM" });
  const asignacion = (u: Unidad) =>
    ({ unidad: u, minutosViaje: 75, urlRuta: "https://osrm.invalid", ruta: { coords: [], distanciaM: 14800, duracionS: 4500, progreso: 0, salida: "2026-09-19T14:49:00.000Z", llegadaPrevista: "2026-09-19T16:04:00.000Z", destino: BRUNETE.centro, fuente: "OSRM" } }) as unknown as Awaited<ReturnType<typeof asignar>>;
  const despliegue = () => accion("desplegar_unidad", { objetivo: { unidadId: "u-1" }, parametros: { incendioId: "inc-1", sector: "A" } });

  it("a un teléfono real de la unidad le llega una orden redactada: adónde, sector, trayecto en horas y minutos y hora local de llegada", async () => {
    const u = unidad("+34911000000");
    estado.guardar(estado.incendios, BRUNETE);
    estado.guardar(estado.unidades, u);
    vi.mocked(asignar).mockResolvedValue(asignacion(u));
    const r = await ejecutorAcciones.ejecutar(despliegue(), decision(), ctx());
    expect(dobles.enviarSms).toHaveBeenCalledTimes(1);
    const sms = dobles.enviarSms.mock.calls[0][0] as { destino: string; texto: string };
    expect(sms.destino).toBe("+34911000000");
    expect(sms.texto).toMatch(/^\(Orden a una unidad\) .+: Parque de bomberos · BUL, salga hacia Incendio de Brunete \(Brunete\), sector A\. Trayecto: 1 h 15 min por carretera\. Llegada prevista: 18:04\.$/);
    expect(sms.texto).not.toMatch(/\d{2,} min por carretera\)|Enviar /);
    expect(r.resultado?.resumen).toBe("Parque de bomberos · BUL en ruta al sector A: 15 km, 1 h 15 min por carretera. Orden enviada por SMS a la unidad (run run-sms-1).");
  });

  it("si el teléfono de la unidad es el de la demo, NO se manda SMS por cada movimiento: la orden queda registrada", async () => {
    process.env.DESTINO_DEMO = "+34699000333";
    const u = unidad("+34699000333");
    estado.guardar(estado.incendios, BRUNETE);
    estado.guardar(estado.unidades, u);
    vi.mocked(asignar).mockResolvedValue(asignacion(u));
    const r = await ejecutorAcciones.ejecutar(despliegue(), decision(), ctx());
    expect(dobles.enviarSms).not.toHaveBeenCalled();
    expect(r.estado).toBe("ejecutada");
    expect(r.resultado?.resumen).toMatch(/solo el de la demo.*sin SMS\.$/);
    expect(r.resultado?.datos?.smsOmitido).toBeDefined();
  });
});
