// =====================================================================
// Ingesta ciudadana (centralita + verificador) y cámaras DGT.
// DUEÑO: constructor L. El punto de la ingesta (Navalacruz, Ávila) está
// lejos del foco del escenario para que el verificador tenga que decidir
// si crea un foco nuevo de verdad.
// =====================================================================
import { describe, expect, it } from "vitest";
import type { Observacion, Snapshot } from "@/lib/dominio/tipos";
import { api, enviar, esperarHasta, km, medir, obtener, snapshot } from "./ayudas";

const NAVALACRUZ = { lat: 40.44, lon: -4.99 };

describe("Ingesta de un aviso ciudadano", () => {
  // ---------------------------------------------------------------- (m)
  it("(m) un aviso web se extrae con IA (esIncendio + gravedad) en ≤ 30 s", async () => {
    const t0 = Date.now();
    const r = await enviar<{ observacion: Observacion }>("/api/ingesta/observacion", {
      canal: "web",
      texto: "Veo mucho humo en el monte junto a Navalacruz, Ávila, cerca de la carretera",
      lat: NAVALACRUZ.lat,
      lon: NAVALACRUZ.lon,
      remitente: "Pruebas L",
    });
    const observacion = r.observacion;
    medir("(m) ingesta aceptada", Date.now() - t0, `${observacion.id} · canal ${observacion.canal}`);
    expect(observacion.id).toBeTruthy();

    const { valor, ms } = await esperarHasta(
      "observación con extracción de la IA",
      (s: Snapshot) => {
        const o = s.observaciones.find((x) => x.id === observacion.id);
        return o?.extraccion ? o : undefined;
      },
      30_000,
      1000,
    );
    medir(
      "(m) extracción",
      ms,
      `esIncendio=${valor.extraccion!.esIncendio} · gravedad=${valor.extraccion!.gravedad} · tipo=${valor.extraccion!.tipo} · lugar=${valor.extraccion!.lugarTexto ?? valor.extraccion!.municipio ?? "—"}`,
    );
    expect(valor.extraccion!.esIncendio).toBe(true);
    expect(["leve", "moderada", "grave", "critica"]).toContain(valor.extraccion!.gravedad);
  }, 180_000);

  it("(m) el verificador resuelve el aviso en ≤ 90 s y no se inventa focos", async () => {
    const s0 = await snapshot();
    const vivos = (s: Snapshot) =>
      s.incendios.filter((i) => km(NAVALACRUZ, i.centro) < 5 && !["extinguido", "descartado", "fusionado"].includes(i.estado));
    const antes = vivos(s0).length;

    const { valor: obs, ms } = await esperarHasta(
      "la observación queda verificada con un impacto",
      (s) => {
        const o = [...s.observaciones].reverse().find((y) => y.canal === "web" && y.remitente === "Pruebas L");
        return o?.impacto ? o : undefined;
      },
      90_000,
      2000,
    );
    const despues = vivos(await snapshot());
    medir(
      "(m) veredicto del verificador",
      ms,
      `impacto ${obs.impacto} · focos a < 5 km de Navalacruz ${antes} → ${despues.length} · ${(obs.verificacion ?? "").slice(0, 180)}`,
    );

    expect(["nuevo_foco", "confirma", "agrava", "duplicada", "registrada", "ruido"]).toContain(obs.impacto);
    // Sea cual sea el veredicto, tiene que estar explicado: nada sin motivo.
    expect((obs.verificacion ?? "").trim().length).toBeGreaterThan(20);

    if (obs.impacto === "nuevo_foco") {
      // Si declara foco, el foco tiene que existir de verdad y estar cerca. No se
      // compara contra `antes` porque el verificador puede haber actuado ya entre
      // el POST de la observación y esta prueba (medido: veredicto en 0,0 s).
      expect(despues.length).toBeGreaterThanOrEqual(1);
      const nuevo = despues[despues.length - 1];
      medir("(m) foco nuevo", ms, `${nuevo.nombre} · ${nuevo.municipio} · ${nuevo.estado} · confianza ${nuevo.confianza}`);
    } else {
      // Y si NO lo declara, no puede haber aparecido ningún foco ahí: el criterio
      // conservador del verificador es "una sola fuente ciudadana no basta".
      // Medido el 19-09: `registrada`, confianza 0,30, "a la espera de más fuentes".
      expect(despues.length, "el verificador no declaró foco pero apareció uno igualmente").toBe(antes);
    }
  }, 240_000);
});

describe("Cámaras públicas", () => {
  // ---------------------------------------------------------------- (n)
  it("(n) el catálogo completo de cámaras pasa de 2.000", async () => {
    const t0 = Date.now();
    const r = await obtener<{ total: number; vigiladas: number; camaras: { id: string; urlImagen: string; fuente: string }[] }>(
      "/api/camaras?todas=1",
    );
    medir("(n) catálogo de cámaras", Date.now() - t0, `${r.total} cámaras (${r.camaras.length} servidas) · ${r.vigiladas} vigiladas`);
    expect(r.total).toBeGreaterThan(2000);
    expect(r.camaras.length).toBeGreaterThan(2000);
    for (const c of r.camaras.slice(0, 5)) {
      expect(c.id).toBeTruthy();
      expect(c.urlImagen).toBeTruthy();
    }
  }, 180_000);

  it("(n) el proxy de imagen devuelve un JPEG real", async () => {
    const t0 = Date.now();
    const r = await obtener<{ camaras: { id: string; fuente: string }[] }>("/api/camaras?todas=1");
    const dgt = r.camaras.filter((c) => c.fuente === "DGT");
    expect(dgt.length).toBeGreaterThan(0);

    // Alguna cámara puede estar caída en ese momento: se prueban varias.
    let conseguida: { id: string; tipo: string; bytes: number } | undefined;
    for (const c of dgt.slice(0, 8)) {
      const img = await api(`/api/camaras/${encodeURIComponent(c.id)}/imagen`, { intentos: 1, timeoutMs: 30_000 }).catch(() => undefined);
      if (img && img.estado === 200 && (img.cabeceras.get("content-type") ?? "").includes("image")) {
        conseguida = { id: c.id, tipo: img.cabeceras.get("content-type")!, bytes: img.texto.length };
        break;
      }
    }
    medir("(n) imagen de cámara", Date.now() - t0, conseguida ? `${conseguida.id} · ${conseguida.tipo} · ~${conseguida.bytes} bytes` : "ninguna cámara respondió");
    expect(conseguida, "ninguna de las 8 cámaras DGT probadas devolvió una imagen").toBeTruthy();
    expect(conseguida!.tipo).toMatch(/image\/(jpeg|jpg)/);
    expect(conseguida!.bytes).toBeGreaterThan(1000);
  }, 240_000);
});
