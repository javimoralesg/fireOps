// =====================================================================
// Conocimiento (RAG), política de autonomía y salud de servicios.
// DUEÑO: constructor L. Se ejecuta DESPUÉS de 00-escenario, con el mundo
// ya poblado (hacen falta decisiones vivas para la reevaluación).
// =====================================================================
import { describe, expect, it } from "vitest";
import type { PoliticaAutonomia } from "@/lib/dominio/tipos";
import { api, medir, obtener, snapshot } from "./ayudas";

describe("Conocimiento · RAG sobre la normativa real", () => {
  // ---------------------------------------------------------------- (j)
  it("(j) responde quién puede ordenar una evacuación, con fundamentos citados", async () => {
    const t0 = Date.now();
    const r = await api("/api/conocimiento/consultar", {
      metodo: "POST",
      cuerpo: { pregunta: "¿Quién puede ordenar la evacuación de un pueblo en un incendio forestal?" },
      timeoutMs: 180_000,
    });
    const cuerpo = r.json as {
      respuesta?: string;
      fundamentos?: { documento: string; cita: string; similitud: number }[];
      explicados?: { documento: string; similitud: number }[];
      error?: string;
    };
    const fundamentos = cuerpo.fundamentos ?? cuerpo.explicados ?? [];
    medir(
      "(j) consulta al conocimiento",
      Date.now() - t0,
      `HTTP ${r.estado} · ${fundamentos.length} fundamento(s) · mejor similitud ${Math.max(0, ...fundamentos.map((f) => f.similitud)).toFixed(3)} · respuesta ${cuerpo.respuesta?.length ?? 0} caracteres`,
    );

    expect(r.estado, cuerpo.error ?? "").toBe(200);
    expect(fundamentos.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...fundamentos.map((f) => f.similitud))).toBeGreaterThan(0.3);
    expect((cuerpo.respuesta ?? "").trim().length).toBeGreaterThan(20);
    // Cada fundamento cita un documento real del corpus.
    for (const f of fundamentos) expect(f.documento.trim().length).toBeGreaterThan(0);
  }, 240_000);

  it("(j) el grafo de conocimiento devuelve nodos y aristas", async () => {
    const t0 = Date.now();
    const grafo = await obtener<{ nodos?: unknown[]; aristas?: unknown[] }>("/api/conocimiento/grafo");
    medir("(j) grafo de conocimiento", Date.now() - t0, `${grafo.nodos?.length ?? 0} nodos · ${grafo.aristas?.length ?? 0} aristas`);
    expect(Array.isArray(grafo.nodos)).toBe(true);
    expect(Array.isArray(grafo.aristas)).toBe(true);
    expect(grafo.nodos!.length).toBeGreaterThan(0);
    expect(grafo.aristas!.length).toBeGreaterThan(0);
  }, 120_000);
});

describe("Política de autonomía", () => {
  // ---------------------------------------------------------------- (k)
  it("(k) rechaza con 422 una política incoherente (umbralHumano < umbralSupervisada)", async () => {
    const t0 = Date.now();
    const { politica } = await obtener<{ politica: PoliticaAutonomia }>("/api/politica");
    const r = await api("/api/politica", {
      metodo: "PUT",
      cuerpo: { ...politica, umbralHumano: 20, umbralSupervisada: 60, actualizadaPor: "pruebas L" },
    });
    medir("(k) política incoherente", Date.now() - t0, `HTTP ${r.estado} · ${(r.json as { error?: string })?.error ?? ""}`);
    expect(r.estado).toBe(422);
    expect((r.json as { error?: string }).error ?? "").toMatch(/umbral/i);

    // Y la política guardada NO ha cambiado.
    const despues = await obtener<{ politica: PoliticaAutonomia }>("/api/politica");
    expect(despues.politica.umbralHumano).toBe(politica.umbralHumano);
    expect(despues.politica.umbralSupervisada).toBe(politica.umbralSupervisada);
  }, 120_000);

  it("(k) un cambio válido reevalúa la competencia de las decisiones vivas", async () => {
    const t0 = Date.now();
    const { politica: original } = await obtener<{ politica: PoliticaAutonomia }>("/api/politica");

    try {
      // Endurecer al máximo: TODO pasa a humano (umbralHumano = 1).
      const duro = await obtener<{ politica: PoliticaAutonomia; cambios: string[]; recalculadas: { id: string; de: string; a: string }[] }>(
        "/api/politica",
      ).then(() =>
        api("/api/politica", {
          metodo: "PUT",
          cuerpo: { ...original, umbralHumano: 1, umbralSupervisada: 1, actualizadaPor: "pruebas L" },
        }),
      );
      const cuerpo = duro.json as { politica: PoliticaAutonomia; cambios: string[]; recalculadas: unknown[] };
      medir(
        "(k) política endurecida",
        Date.now() - t0,
        `HTTP ${duro.estado} · ${cuerpo.cambios?.length ?? 0} cambio(s) · ${cuerpo.recalculadas?.length ?? 0} decisión(es) recalculadas`,
      );
      expect(duro.estado).toBe(200);
      expect(cuerpo.politica.umbralHumano).toBe(1);
      expect(cuerpo.cambios.join(" ")).toMatch(/umbral humano/i);

      // Ninguna decisión viva puede quedar como autónoma con este umbral.
      const s = await snapshot();
      const vivas = s.decisiones.filter((d) => ["propuesta", "pendiente_humano", "escalada"].includes(d.estado));
      medir("(k) decisiones vivas tras endurecer", Date.now() - t0, `${vivas.length} viva(s): ${vivas.map((d) => `${d.competencia}`).join(", ") || "ninguna"}`);
      for (const d of vivas) expect(d.competencia).toBe("humano");
    } finally {
      // Devolver SIEMPRE la política original: el servidor es compartido.
      const r = await api("/api/politica", { metodo: "PUT", cuerpo: { ...original, actualizadaPor: original.actualizadaPor } });
      medir("(k) política restaurada", Date.now() - t0, `HTTP ${r.estado}`);
      expect(r.estado).toBe(200);
    }
  }, 180_000);
});

describe("Salud de los servicios", () => {
  // ---------------------------------------------------------------- (l)
  it("(l) /api/salud pinta en verde lo que funciona y en rojo lo que falta, con detalle", async () => {
    const t0 = Date.now();
    const salud = await obtener<{
      ok: boolean;
      ia: { ok: boolean; proveedor: string; modelos: Record<string, string> };
      servicios: Record<string, { ok: boolean; detalle?: string }>;
      integraciones: Record<string, { ok: boolean; detalle?: string }>;
    }>("/api/salud");

    const verdes = Object.entries(salud.servicios).filter(([, v]) => v.ok).map(([k]) => k);
    const rojos = Object.entries(salud.servicios).filter(([, v]) => !v.ok).map(([k]) => k);
    medir("(l) salud", Date.now() - t0, `IA ${salud.ia.proveedor} · verdes: ${verdes.join(", ")} · rojos: ${rojos.join(", ") || "ninguno"}`);

    // En verde: la IA y las fuentes sin clave.
    expect(salud.ia.ok).toBe(true);
    expect(salud.ia.proveedor).toBe("helmcode");
    for (const nombre of ["Open-Meteo", "Overpass", "Nominatim", "Cámaras DGT"]) {
      expect(salud.servicios[nombre], `falta el servicio «${nombre}» en /api/salud`).toBeTruthy();
      expect(salud.servicios[nombre].ok, `${nombre} debería estar en verde`).toBe(true);
    }
    expect(salud.integraciones.OSRM?.ok).toBe(true);

    // En rojo, y con motivo entendible: lo que no tiene clave.
    for (const nombre of ["HappyRobot", "Telegram"]) {
      expect(salud.integraciones[nombre], `falta la integración «${nombre}»`).toBeTruthy();
      expect(salud.integraciones[nombre].ok).toBe(false);
      expect((salud.integraciones[nombre].detalle ?? "").length).toBeGreaterThan(10);
    }
    expect(salud.servicios["NASA FIRMS"]?.ok).toBe(false);
    expect((salud.servicios["NASA FIRMS"]?.detalle ?? "").toUpperCase()).toContain("FIRMS");
  }, 120_000);
});
