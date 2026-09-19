// Regresión del merge main → migración: las herramientas del 112 pueden usar la IA
// mientras el mundo está pausado. Ese permiso debe sobrevivir también al reintento que
// repara una primera respuesta cuyo JSON no cumple el esquema.
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const dobles = vi.hoisted(() => ({ crear: vi.fn() }));

vi.mock("openai", () => ({
  default: class OpenAIFalso {
    chat = { completions: { create: dobles.crear } };
  },
}));

const bandera = globalThis as { __atalayaMundoPausado?: boolean };
const claveAnterior = process.env.HELMCODE_API_KEY;
const proveedorAnterior = process.env.LLM_PROVEEDOR;

afterEach(() => {
  bandera.__atalayaMundoPausado = false;
  dobles.crear.mockReset();
  if (claveAnterior === undefined) delete process.env.HELMCODE_API_KEY;
  else process.env.HELMCODE_API_KEY = claveAnterior;
  if (proveedorAnterior === undefined) delete process.env.LLM_PROVEEDOR;
  else process.env.LLM_PROVEEDOR = proveedorAnterior;
});

describe("completarJson · reparación durante una pausa", () => {
  it("propaga permitirEnPausa al reintento de reparación", async () => {
    process.env.LLM_PROVEEDOR = "helmcode";
    process.env.HELMCODE_API_KEY = "clave-de-prueba";
    bandera.__atalayaMundoPausado = true;

    dobles.crear
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"valor":7}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"valor":"reparado"}' } }],
        usage: { prompt_tokens: 20, completion_tokens: 5 },
      });

    const { completarJson } = await import("@/lib/ia/llm");
    const respuesta = await completarJson({
      user: "Devuelve un valor",
      esquema: z.object({ valor: z.string() }),
      permitirEnPausa: true,
      sinRazonar: true,
      papel: "rapido",
    });

    expect(respuesta.datos).toEqual({ valor: "reparado" });
    expect(dobles.crear).toHaveBeenCalledTimes(2);
    expect(dobles.crear.mock.calls[1][0]).toMatchObject({
      response_format: { type: "json_object" },
      chat_template_kwargs: { enable_thinking: false },
    });
  });
});
