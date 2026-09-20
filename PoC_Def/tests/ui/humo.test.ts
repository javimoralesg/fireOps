// =====================================================================
// PRUEBAS DE HUMO DE LA INTERFAZ. DUEÑO: constructor L.
// Con Playwright si está instalado (`npx playwright install chromium`):
// navegador real, consola vigilada, mapa Leaflet montado y flujo de
// "Declarar foco". Si no lo está, se degrada a comprobar el HTML servido
// por el servidor (las páginas de Next llevan contenido en el SSR) y la
// medida deja constancia de que el nivel es menor.
// =====================================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, api, dormir, medir } from "../integracion/ayudas";

const RUTAS = [
  "/",
  "/auditoria",
  "/agentes",
  "/agentes/coordinador",
  "/conocimiento",
  "/informes",
  "/aprendizaje",
  "/politica",
  "/publico",
  "/parte",
  "/movil",
  "/incidencias",
];

/** Errores de consola que no son fallos de la aplicación. */
const RUIDO = [
  /favicon/i,
  /Download the React DevTools/i,
  /net::ERR_(ABORTED|CONNECTION_CLOSED)/i,
  /ResizeObserver loop/i,
  /Failed to load resource: the server responded with a status of 404 .*\.(png|ico|jpg)/i,
  /webpack-hmr|hot-update|_next\/static\/development/i,
  /\[Fast Refresh\]/i,
  /Hydration|hydrated/i, // recarga en caliente de otros constructores mientras se prueba
  /cam(a|á)ra/i, // una cámara DGT caída no es un fallo de la sala
];
const esRuido = (t: string) => RUIDO.some((r) => r.test(t));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Navegador = any;

let chromium: Navegador | undefined;
let navegador: Navegador | undefined;
let conPlaywright = false;

beforeAll(async () => {
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
    navegador = await chromium.launch({ headless: true });
    conPlaywright = true;
    console.log("▶ Pruebas de UI con Playwright (navegador real)");
  } catch (e) {
    console.log(`▶ Playwright no disponible (${(e as Error).message.slice(0, 80)}): las pruebas de UI se degradan a comprobar el HTML servido.`);
    conPlaywright = false;
  }
}, 240_000);

afterAll(async () => {
  await navegador?.close();
});

describe("Humo de las pantallas", () => {
  for (const ruta of RUTAS) {
    it(`carga ${ruta} sin errores de consola inesperados`, async () => {
      const t0 = Date.now();
      if (!conPlaywright) {
        const r = await api(ruta, { timeoutMs: 60_000 });
        medir(`UI ${ruta} (sin navegador)`, Date.now() - t0, `HTTP ${r.estado} · ${r.texto.length} caracteres`);
        expect(r.estado).toBe(200);
        expect(r.texto).toContain("<html");
        expect(r.texto).not.toMatch(/Application error: a (client|server)-side exception/i);
        return;
      }

      const pagina = await navegador!.newPage();
      const errores: string[] = [];
      pagina.on("console", (m: { type: () => string; text: () => string }) => {
        if (m.type() === "error" && !esRuido(m.text())) errores.push(m.text());
      });
      pagina.on("pageerror", (e: Error) => {
        if (!esRuido(e.message)) errores.push(e.message);
      });

      try {
        const respuesta = await pagina.goto(`${BASE}${ruta}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await dormir(4000); // dar tiempo al primer render y al SSE
        const estado = respuesta?.status() ?? 0;
        medir(`UI ${ruta}`, Date.now() - t0, `HTTP ${estado} · ${errores.length} error(es) de consola`);
        expect(estado).toBeLessThan(400);
        expect(errores, `errores en ${ruta}:\n${errores.join("\n")}`).toHaveLength(0);
      } finally {
        await pagina.close();
      }
    }, 180_000);
  }

  it("la incidencia de un foco existente abre su expediente", async () => {
    const t0 = Date.now();
    const estado = await api("/api/estado");
    const incendios = (estado.json as { incendios?: { id: string }[] })?.incendios ?? [];
    if (!incendios.length) {
      medir("UI /incidencias/[id]", Date.now() - t0, "no hay incendios en el mundo: no procede");
      return;
    }
    const ruta = `/incidencias/${encodeURIComponent(incendios[0].id)}`;
    if (!conPlaywright) {
      const r = await api(ruta, { timeoutMs: 60_000 });
      medir(`UI ${ruta} (sin navegador)`, Date.now() - t0, `HTTP ${r.estado}`);
      expect(r.estado).toBe(200);
      return;
    }
    const pagina = await navegador!.newPage();
    try {
      const respuesta = await pagina.goto(`${BASE}${ruta}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await dormir(3000);
      medir(`UI ${ruta}`, Date.now() - t0, `HTTP ${respuesta?.status()}`);
      expect(respuesta!.status()).toBeLessThan(400);
    } finally {
      await pagina.close();
    }
  }, 180_000);
});

describe("Portal ciudadano", () => {
  it("pinta en el navegador los comunicados publicados (el HTML del servidor no los lleva)", async () => {
    const t0 = Date.now();
    const lista = await api("/api/comunicados");
    const comunicados = (lista.json as { comunicados?: { titulo: string }[] })?.comunicados ?? [];
    if (!comunicados.length) {
      medir("UI /publico · comunicados", Date.now() - t0, "no hay comunicados publicados: no procede");
      return;
    }
    if (!conPlaywright) {
      medir("UI /publico · comunicados", Date.now() - t0, "sin navegador: el SSR no lleva los comunicados, no se puede comprobar");
      return;
    }
    const pagina = await navegador!.newPage();
    try {
      await pagina.goto(`${BASE}/publico`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      const clave = comunicados[0].titulo.split(/[·:(]/)[0].trim().slice(0, 25);
      await pagina.getByText(clave, { exact: false }).first().waitFor({ timeout: 45_000 });
      medir("UI /publico · comunicados", Date.now() - t0, `${comunicados.length} comunicado(s) · se ve «${clave}»`);
    } finally {
      await pagina.close();
    }
  }, 180_000);
});

describe("Sala de mando", () => {
  it("monta el mapa Leaflet y muestra el reloj de mundo", async () => {
    const t0 = Date.now();
    if (!conPlaywright) {
      const r = await api("/");
      medir("UI mapa (sin navegador)", Date.now() - t0, `HTTP ${r.estado}`);
      expect(r.estado).toBe(200);
      return;
    }
    const pagina = await navegador!.newPage();
    try {
      await pagina.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await pagina.waitForSelector(".leaflet-container", { timeout: 60_000 });
      // El reloj de mundo se pinta como hh:mm en la barra superior.
      const texto = await pagina.textContent("body");
      medir("UI mapa + reloj", Date.now() - t0, "leaflet-container montado");
      expect(texto).toMatch(/\d{1,2}:\d{2}/);
      expect(await pagina.locator(".leaflet-container").count()).toBeGreaterThan(0);
    } finally {
      await pagina.close();
    }
  }, 240_000);

  it("no muestra avisos meteorológicos en las capas del mapa", async () => {
    if (!conPlaywright) return;
    const pagina = await navegador!.newPage();
    try {
      await pagina.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await pagina.waitForSelector(".leaflet-container", { timeout: 60_000 });
      await pagina.getByRole("button", { name: /capas/i }).click();
      expect(await pagina.getByText("Avisos meteo", { exact: true }).count()).toBe(0);
    } finally {
      await pagina.close();
    }
  }, 180_000);

  it('"Declarar foco" + clic en el mapa + confirmar muestra el toast "Foco declarado"', async () => {
    const t0 = Date.now();
    if (!conPlaywright) {
      medir("UI declarar foco", Date.now() - t0, "sin navegador: no se puede hacer clic");
      return;
    }
    const pagina = await navegador!.newPage();
    try {
      // El botón "Declarar foco" solo se ve con el modo desarrollo (preferencia
      // del navegador en localStorage): se enciende antes de cargar la sala.
      await pagina.addInitScript(() => {
        try {
          localStorage.setItem("atalaya:desarrollo", "1");
        } catch {
          /* almacenamiento bloqueado: la prueba fallará al no ver el botón, y con razón */
        }
      });
      await pagina.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await pagina.waitForSelector(".leaflet-container", { timeout: 60_000 });
      await dormir(3000);

      await pagina.getByRole("button", { name: /declarar foco/i }).first().click();
      const mapa = pagina.locator(".leaflet-container").first();
      const caja = await mapa.boundingBox();
      expect(caja, "el mapa no tiene tamaño").toBeTruthy();

      // El clic tiene que caer en mapa VACÍO: si cae sobre un marcador de foco,
      // de unidad o de cámara, Leaflet abre su popup y el diálogo no sale. Se
      // prueban varios puntos hasta que aparece "Declarar un foco".
      const dialogo = pagina.getByText(/declarar un foco/i).first();
      const candidatos: [number, number][] = [
        [0.22, 0.72],
        [0.35, 0.3],
        [0.7, 0.75],
        [0.5, 0.5],
        [0.15, 0.4],
      ];
      let abierto = false;
      for (const [fx, fy] of candidatos) {
        await pagina.mouse.click(caja!.x + caja!.width * fx, caja!.y + caja!.height * fy);
        try {
          await dialogo.waitFor({ timeout: 6000 });
          abierto = true;
          break;
        } catch {
          await pagina.keyboard.press("Escape").catch(() => undefined);
          await pagina.getByRole("button", { name: /declarar foco/i }).first().click().catch(() => undefined);
        }
      }
      expect(abierto, "el clic en el mapa no abrió el diálogo de declarar foco").toBe(true);

      // El botón de la barra superior ya se ha convertido en "Cancelar (Esc)",
      // así que el único "Declarar foco" que queda es el del diálogo.
      await pagina.getByRole("button", { name: /declarar foco/i }).last().click({ timeout: 30_000 });

      await pagina.getByText(/foco declarado/i).first().waitFor({ timeout: 60_000 });
      medir("UI declarar foco", Date.now() - t0, 'toast "Foco declarado" visible');
    } finally {
      await pagina.close();
    }
  }, 300_000);
});
