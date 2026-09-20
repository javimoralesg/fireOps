import { describe, expect, it } from "vitest";
import { cancelarAccionesPendientes, comprobarDependencias, ordenarPorDependencias, validarDependencias } from "@/lib/agentes/ejecucion/ejecutor";
import { accion, decision } from "./ayudas/dominio";

describe("dependencias entre acciones", () => {
  it("acepta datos antiguos sin dependeDe", () => {
    expect(validarDependencias([accion("vigilar_camara")])).toEqual({ valida: true, errores: [] });
  });

  it("ordena el DAG antes de ejecutar aunque venga invertido", () => {
    const previa = accion("vigilar_camara", { id: "previa" });
    const posterior = accion("enviar_sms", { id: "posterior", dependeDe: ["previa"] });
    expect(ordenarPorDependencias([posterior, previa]).map((a) => a.id)).toEqual(["previa", "posterior"]);
  });

  it("rechaza referencias inexistentes, IDs duplicados y ciclos", () => {
    expect(validarDependencias([accion("enviar_sms", { dependeDe: ["ausente"] })]).valida).toBe(false);
    expect(validarDependencias([accion("enviar_sms"), accion("enviar_email", { id: "acc-enviar_sms" })]).valida).toBe(false);
    const a = accion("enviar_sms", { id: "a", dependeDe: ["b"] });
    const b = accion("enviar_email", { id: "b", dependeDe: ["a"] });
    expect(validarDependencias([a, b]).valida).toBe(false);
  });

  it("una dependiente espera y queda lista solo cuando su requisito fue ejecutado", () => {
    const previa = accion("vigilar_camara", { id: "previa" });
    const posterior = accion("enviar_sms", { id: "posterior", dependeDe: ["previa"] });
    expect(comprobarDependencias(posterior, decision([previa, posterior])).lista).toBe(false);
    expect(comprobarDependencias(posterior, decision([{ ...previa, estado: "ejecutada" }, posterior])).lista).toBe(true);
  });

  it("denegación o caducidad cancelan lo pendiente sin revertir lo ejecutado", () => {
    const ejecutada = accion("vigilar_camara", { id: "hecha", estado: "ejecutada", ejecutadaEn: "2026-09-19T10:00:00Z" });
    const enCurso = accion("enviar_sms", { id: "en-curso", estado: "ejecutando" });
    const pendiente = accion("evacuar_poblacion", { id: "espera", dependeDe: ["hecha"] });
    const resultado = cancelarAccionesPendientes([ejecutada, enCurso, pendiente]);
    expect(resultado[0]).toEqual(ejecutada);
    expect(resultado[1]).toEqual(enCurso);
    expect(resultado[2].estado).toBe("cancelada");
  });
});
