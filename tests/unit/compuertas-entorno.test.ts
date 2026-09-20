// Compuertas de integraciones opcionales: una ausencia de .env no es un fallo.
import { afterEach, describe, expect, it } from "vitest";
import type { Accion, Decision } from "@/lib/dominio/tipos";
import { omitirAccionesNoConfiguradas } from "@/lib/agentes/ejecucion/canales-configurados";
import { Estado, establecerEstado } from "@/lib/motor/estado";
import { procesarDecisionPropuesta } from "@/lib/motor/orquestador";

const CLAVES = [
  "HAPPYROBOT_API_KEY",
  "HAPPYROBOT_WORKFLOW_SLUG_SMS",
  "HAPPYROBOT_WORKFLOW_SLUG_EMAIL",
  "DESTINO_DEMO",
  "TELEFONO_AVISOS_SMS",
  "EMAIL_DEMO",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID_DEMO",
] as const;
const previo = new Map<string, string | undefined>();

function limpiarEntorno(): void {
  for (const clave of CLAVES) {
    if (!previo.has(clave)) previo.set(clave, process.env[clave]);
    delete process.env[clave];
  }
}

afterEach(() => {
  for (const clave of CLAVES) {
    const valor = previo.get(clave);
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
  previo.clear();
});

const accion = (tipo: Accion["tipo"], extra: Partial<Accion> = {}): Accion => ({
  id: `acc-${tipo}`,
  tipo,
  descripcion: `Acción ${tipo}`,
  parametros: {},
  estado: "pendiente",
  ...extra,
});

const decision = (acciones: Accion[]): Decision => ({
  id: "dec-env",
  ejecucionId: "ej-env",
  agenteId: "proteccion_poblacion",
  titulo: "Aviso de prueba",
  resumen: "Prueba de configuración de canales.",
  razonamiento: "Prueba unitaria.",
  prioridad: 3,
  riesgo: 10,
  competencia: "autonoma",
  estado: "propuesta",
  acciones,
  evidencias: [],
  fundamentos: [],
  creadaEn: "2026-09-20T00:00:00.000Z",
  creadaEnMundo: "2026-09-20T00:00:00.000Z",
});

describe("compuertas de entorno para acciones externas", () => {
  it("omite el canal ausente, conserva la acción interna y cascada las dependencias", () => {
    limpiarEntorno();
    const sms = accion("enviar_sms", { id: "sms", objetivo: { telefono: "+34600000000" } });
    const ticket = accion("abrir_ticket", { id: "ticket" });
    const posterior = accion("publicar_comunicado", { id: "posterior", dependeDe: ["sms"] });
    const r = omitirAccionesNoConfiguradas([sms, ticket, posterior]);
    expect(r.acciones.map((a) => a.id)).toEqual(["ticket"]);
    expect(r.omitidas).toEqual(expect.arrayContaining([
      expect.objectContaining({ accion: expect.objectContaining({ id: "sms" }), motivo: expect.stringMatching(/HAPPYROBOT_API_KEY/) }),
      expect.objectContaining({ accion: expect.objectContaining({ id: "posterior" }), motivo: expect.stringMatching(/Depende/) }),
    ]));
  });

  it("también exige destino explícito o reserva del entorno", () => {
    limpiarEntorno();
    process.env.HAPPYROBOT_API_KEY = "clave";
    process.env.HAPPYROBOT_WORKFLOW_SLUG_SMS = "sms";
    const sinDestino = accion("enviar_sms");
    expect(omitirAccionesNoConfiguradas([sinDestino]).omitidas[0]?.motivo).toMatch(/DESTINO_DEMO\/TELEFONO_AVISOS_SMS/);
    process.env.DESTINO_DEMO = "+34600000000";
    expect(omitirAccionesNoConfiguradas([sinDestino]).acciones).toHaveLength(1);
  });

  it("no acepta destinos vacíos y sí acepta destinos explícitos de SMS y correo", () => {
    limpiarEntorno();
    process.env.HAPPYROBOT_API_KEY = "clave";
    process.env.HAPPYROBOT_WORKFLOW_SLUG_SMS = "sms";
    process.env.HAPPYROBOT_WORKFLOW_SLUG_EMAIL = "email";
    expect(omitirAccionesNoConfiguradas([accion("enviar_sms", { objetivo: { telefono: "   " } })]).acciones).toHaveLength(0);
    expect(omitirAccionesNoConfiguradas([accion("enviar_email", { objetivo: { email: "   " } })]).acciones).toHaveLength(0);
    expect(omitirAccionesNoConfiguradas([accion("enviar_sms", { objetivo: { telefono: "+34600000000" } })]).acciones).toHaveLength(1);
    expect(omitirAccionesNoConfiguradas([accion("enviar_email", { objetivo: { email: "seprona@example.test" } })]).acciones).toHaveLength(1);
  });

  it("omite transitivamente una cadena dependiente y conserva otra rama", () => {
    limpiarEntorno();
    const sms = accion("enviar_sms", { id: "sms", objetivo: { telefono: "+34600000000" } });
    const segundo = accion("abrir_ticket", { id: "segundo", dependeDe: ["sms"] });
    const tercero = accion("publicar_comunicado", { id: "tercero", dependeDe: ["segundo"] });
    const independiente = accion("abrir_ticket", { id: "independiente" });
    const r = omitirAccionesNoConfiguradas([sms, segundo, tercero, independiente]);
    expect(r.acciones.map((a) => a.id)).toEqual(["independiente"]);
    expect(r.omitidas.map(({ accion: a }) => a.id)).toEqual(expect.arrayContaining(["sms", "segundo", "tercero"]));
  });

  it("si se ha configurado el canal no lo omite: un fallo posterior sigue siendo real", () => {
    limpiarEntorno();
    process.env.HAPPYROBOT_API_KEY = "clave";
    process.env.HAPPYROBOT_WORKFLOW_SLUG_SMS = "sms";
    const sms = accion("enviar_sms", { objetivo: { telefono: "+34600000000" } });
    expect(omitirAccionesNoConfiguradas([sms])).toEqual({ acciones: [sms], omitidas: [] });
  });

  it("una propuesta que queda sin acciones caduca; no se anuncia como ejecutada", async () => {
    limpiarEntorno();
    const estado = new Estado();
    establecerEstado(estado);
    const r = await procesarDecisionPropuesta(decision([accion("enviar_sms", { objetivo: { telefono: "+34600000000" } })]));
    expect(r.estado).toBe("caducada");
    expect(r.acciones).toEqual([]);
    expect(estado.eventos.some((e) => e.tipo === "accion_fallida")).toBe(false);
    expect(estado.eventos.some((e) => e.datos && (e.datos as Record<string, unknown>).omitidaPorConfiguracion === true)).toBe(true);
  });
});
