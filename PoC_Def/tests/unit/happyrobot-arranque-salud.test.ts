// El servidor arranca la recuperación de llamadas perdidas y la salud detecta un túnel muerto.
// DUEÑO: sesión fireops-82 (2026-09-19). Sin red (fetch sustituido).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { urlPublicaResponde } from "@/lib/happyrobot/entrante";

afterEach(() => vi.unstubAllGlobals());

describe("arranque del servidor", () => {
  it("instrumentation.ts arranca la recuperación de llamadas perdidas (sin esto, un corte del túnel las perdía)", () => {
    const fuente = readFileSync(fileURLToPath(new URL("../../instrumentation.ts", import.meta.url)), "utf8");
    expect(fuente).toMatch(/import\("\.\/lib\/happyrobot\/recuperar-llamadas"\)/);
    expect(fuente).toMatch(/arrancarRecuperacionLlamadas\(\)/);
  });
});

describe("urlPublicaResponde · la salud ve el túnel muerto", () => {
  it("dominio que ya no existe (túnel dado de baja) → no viva, con el motivo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); }));
    const r = await urlPublicaResponde("https://muerto.trycloudflare.com");
    expect(r.viva).toBe(false);
    expect(r.motivo).toMatch(/ya no existe/);
  });
  it("502/530 de Cloudflare (la app o el túnel no llegan) → no viva, con el código", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 530 })));
    const r = await urlPublicaResponde("https://x.trycloudflare.com");
    expect(r).toEqual({ viva: false, motivo: "la URL pública responde 530" });
  });
  it("sin URL o sin https → no viva; 200 → viva", async () => {
    expect((await urlPublicaResponde(undefined)).viva).toBe(false);
    expect((await urlPublicaResponde("http://localhost:3000")).motivo).toMatch(/HTTPS/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    expect(await urlPublicaResponde("https://vivo.trycloudflare.com")).toEqual({ viva: true });
  });
});

describe("leerWorkflowEntrante · la salud ve el workflow despublicado (el número no atiende)", () => {
  const respuesta = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { "content-type": "application/json" } });
  const plataforma = (version: Record<string, unknown>) =>
    vi.fn(async (url: string) =>
      url.includes("/workflows/")
        ? respuesta({ data: { latest_version: { id: "v1", ...version } } })
        : respuesta({ data: [{ name: "Registrar el aviso en Atalaya", configuration: { url: [{ children: [{ text: "https://t.trycloudflare.com/api/happyrobot/aviso" }] }] } }] }),
    );

  it("publicado y vivo → lo dice, con la URL de la herramienta", async () => {
    process.env.HAPPYROBOT_API_KEY = "sk_live_prueba";
    process.env.HAPPYROBOT_WORKFLOW_SLUG_ENTRANTE = "dzftt0y1041x";
    vi.stubGlobal("fetch", plataforma({ is_published: true, is_live: true, environment: "production" }));
    const { leerWorkflowEntrante } = await import("@/lib/happyrobot/entrante");
    expect(await leerWorkflowEntrante()).toEqual({ urlRegistrar: "https://t.trycloudflare.com/api/happyrobot/aviso", publicado: true, vivo: true, entorno: "production" });
  });

  it("despublicado a medias (lo que dejó una sincronización fallida el 19-09) → publicado/vivo false", async () => {
    process.env.HAPPYROBOT_API_KEY = "sk_live_prueba";
    process.env.HAPPYROBOT_WORKFLOW_SLUG_ENTRANTE = "dzftt0y1041x";
    vi.stubGlobal("fetch", plataforma({ is_published: false, is_live: false, environment: "production" }));
    const { leerWorkflowEntrante } = await import("@/lib/happyrobot/entrante");
    const w = await leerWorkflowEntrante();
    expect(w.publicado).toBe(false);
    expect(w.vivo).toBe(false);
  });

  it("la ruta de salud lo convierte en ok:false con el aviso en rojo", () => {
    const fuente = readFileSync(fileURLToPath(new URL("../../app/api/happyrobot/salud/route.ts", import.meta.url)), "utf8");
    expect(fuente).toMatch(/ok: situacion\.ok && publicado && !fueraDeSitio && vida\.viva/);
    expect(fuente).toMatch(/NO está publicado: el número no atiende/);
  });
});
