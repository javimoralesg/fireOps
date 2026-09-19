// Pruebas de lib/dominio/fuentes-deteccion.ts y lib/motor/escenario.ts · fuentes
// de detección conmutables (escenario del mando). DUEÑO: sesión actual (estilo L).
// Deterministas y SIN red: `cambiarFuentesDesactivadas` se llama con
// `efectosExternos: false`, así ni despierta agentes ni toca Supabase.
import { describe, expect, it } from "vitest";
import type { Camara, EstadoAgenteApp, FocoSatelite, Incendio, Observacion, Punto } from "@/lib/dominio/tipos";
import {
  CATALOGO_FUENTES,
  IDS_FUENTES,
  TEXTO_SIMULACRO,
  agenteDesactivadoPorEscenario,
  canalPuedeDeclararFoco,
  esSimulacro,
  fuenteActiva,
  fuenteQueBloquea,
  fuentesDesactivadas,
  normalizarFuentes,
  resumenFuentes,
} from "@/lib/dominio/fuentes-deteccion";
import { Estado } from "@/lib/motor/estado";
import { cambiarFuentesDesactivadas, descartarFocosDeFuentesApagadas, sincronizarAgentesConEscenario } from "@/lib/motor/escenario";
import { incendio, poblacion } from "./ayudas/dominio";

const TODAS = [...IDS_FUENTES];
const SIN_RED = { efectosExternos: false } as const;

function ficha(id: string): EstadoAgenteApp {
  return {
    id,
    nombre: id,
    categoria: "percepcion",
    descripcion: "Prueba",
    modelo: "determinista",
    estado: "observando",
    cadenciaSeg: 60,
    contadores: { ciclos: 0, decisiones: 0, acciones: 0, errores: 0 },
    pausado: false,
    controlHumano: false,
  };
}

function camara(id: string, fuente: Camara["fuente"], punto: Punto, vigilada: boolean): Camara {
  return { id, nombre: id, punto, fuente, urlImagen: `/api/camaras/${id}/imagen`, intervaloSeg: 20, vigilada, historial: [] };
}

/** Estado con los tres agentes que importan, un foco activo y tres cámaras (dos fijas, una móvil). */
function estadoDePrueba(): Estado {
  const e = new Estado();
  for (const id of ["satelite", "prensa_redes", "verificador"]) e.agentes.set(id, ficha(id));
  const foco = incendio({ id: "inc-1", centro: { lat: 40.44, lon: -4.99 }, estado: "activo" });
  e.incendios.set(foco.id, foco);
  e.camaras.set("dgt:cerca", camara("dgt:cerca", "DGT", { lat: 40.5, lon: -4.95 }, true)); // ~8 km
  e.camaras.set("dgt:lejos", camara("dgt:lejos", "DGT", { lat: 41.9, lon: -4.99 }, true)); // ~160 km
  e.camaras.set("movil:tel1", camara("movil:tel1", "Movil", { lat: 40.45, lon: -4.98 }, true));
  return e;
}

describe("catálogo de fuentes de detección", () => {
  it("tiene las cuatro fuentes, sin ids repetidos y en el mismo orden que IDS_FUENTES", () => {
    expect(CATALOGO_FUENTES.map((f) => f.id)).toEqual(["satelite", "prensa_redes", "camaras_fijas", "avisos_ciudadanos"]);
    expect(new Set(IDS_FUENTES).size).toBe(4);
    expect(IDS_FUENTES).toEqual(CATALOGO_FUENTES.map((f) => f.id));
  });

  it("normaliza: quita desconocidos y duplicados y ordena como el catálogo", () => {
    expect(normalizarFuentes(["prensa_redes", "satelite", "prensa_redes", "ovni"])).toEqual(["satelite", "prensa_redes"]);
    expect(normalizarFuentes(undefined)).toEqual([]);
  });
});

describe("reglas del escenario", () => {
  it("sin nada apagado es operación real; con las cuatro es simulacro", () => {
    expect(fuentesDesactivadas(undefined)).toEqual([]);
    expect(esSimulacro({ fuentesDesactivadas: [] })).toBe(false);
    expect(esSimulacro({ fuentesDesactivadas: ["satelite", "prensa_redes", "camaras_fijas"] })).toBe(false);
    expect(esSimulacro({ fuentesDesactivadas: TODAS })).toBe(true);
    expect(fuenteActiva({ fuentesDesactivadas: ["satelite"] }, "satelite")).toBe(false);
    expect(fuenteActiva({ fuentesDesactivadas: ["satelite"] }, "prensa_redes")).toBe(true);
  });

  it("apaga al agente de la fuente y a ningún otro", () => {
    const e = { fuentesDesactivadas: ["satelite" as const] };
    expect(agenteDesactivadoPorEscenario(e, "satelite")?.id).toBe("satelite");
    expect(agenteDesactivadoPorEscenario(e, "prensa_redes")).toBeUndefined();
    expect(agenteDesactivadoPorEscenario(e, "verificador")).toBeUndefined();
    expect(agenteDesactivadoPorEscenario({ fuentesDesactivadas: ["prensa_redes"] }, "prensa_redes")?.id).toBe("prensa_redes");
    // Cámaras fijas y avisos ciudadanos no apagan agentes enteros (el vigía y la
    // centralita siguen: uno por los móviles, la otra para contestar al ciudadano).
    expect(agenteDesactivadoPorEscenario({ fuentesDesactivadas: ["camaras_fijas", "avisos_ciudadanos"] }, "vigia_camaras")).toBeUndefined();
    expect(agenteDesactivadoPorEscenario({ fuentesDesactivadas: ["camaras_fijas", "avisos_ciudadanos"] }, "centralita")).toBeUndefined();
  });

  it("bloquea los canales de la fuente apagada y deja pasar el resto", () => {
    const soloSatelite = { fuentesDesactivadas: ["satelite" as const] };
    expect(fuenteQueBloquea(soloSatelite, { canal: "satelite" })?.id).toBe("satelite");
    expect(canalPuedeDeclararFoco(soloSatelite, { canal: "prensa" })).toBe(true);
    expect(canalPuedeDeclararFoco(soloSatelite, { canal: "telegram" })).toBe(true);

    const sinCiudadanos = { fuentesDesactivadas: ["avisos_ciudadanos" as const] };
    for (const canal of ["llamada", "sms", "email", "telegram", "web"] as const) {
      expect(canalPuedeDeclararFoco(sinCiudadanos, { canal })).toBe(false);
    }
    expect(canalPuedeDeclararFoco(sinCiudadanos, { canal: "prensa" })).toBe(true);
  });

  it("con las cámaras fijas apagadas, la cámara de móvil sigue declarando y la fija no", () => {
    const sinFijas = { fuentesDesactivadas: ["camaras_fijas" as const] };
    expect(canalPuedeDeclararFoco(sinFijas, { canal: "camara", referenciaExterna: "movil:abc" })).toBe(true);
    expect(canalPuedeDeclararFoco(sinFijas, { canal: "camara", referenciaExterna: "dgt:123" })).toBe(false);
    expect(canalPuedeDeclararFoco(sinFijas, { canal: "camara" })).toBe(false);
  });

  it("la mano y el sensor pasan siempre, incluso en simulacro", () => {
    const simulacro = { fuentesDesactivadas: TODAS };
    expect(canalPuedeDeclararFoco(simulacro, { canal: "manual" })).toBe(true);
    expect(canalPuedeDeclararFoco(simulacro, { canal: "sensor" })).toBe(true);
    expect(canalPuedeDeclararFoco(simulacro, { canal: "camara", referenciaExterna: "movil:abc" })).toBe(true);
    expect(canalPuedeDeclararFoco(simulacro, { canal: "satelite" })).toBe(false);
  });

  it("resume las fuentes apagadas para la insignia", () => {
    expect(resumenFuentes(undefined)).toBeUndefined();
    expect(resumenFuentes({ fuentesDesactivadas: [] })).toBeUndefined();
    expect(resumenFuentes({ fuentesDesactivadas: ["satelite"] })).toBe("Sin satélite");
    expect(resumenFuentes({ fuentesDesactivadas: ["satelite", "prensa_redes"] })).toBe("Fuentes apagadas: satélite, prensa y redes");
    expect(resumenFuentes({ fuentesDesactivadas: TODAS })).toBe(TEXTO_SIMULACRO);
  });
});

describe("cambiarFuentesDesactivadas (solo memoria)", () => {
  it("es no-op si la lista no cambia", async () => {
    const e = estadoDePrueba();
    const version = e.version;
    const r = await cambiarFuentesDesactivadas(e, [], "prueba", SIN_RED);
    expect(r.cambiado).toBe(false);
    expect(e.version).toBe(version);
    expect(e.eventos).toHaveLength(0);
  });

  it("activar el simulacro deja evento «humano», marca a satélite y prensa, y desarma las cámaras fijas", async () => {
    const e = estadoDePrueba();
    const r = await cambiarFuentesDesactivadas(e, [...TODAS].reverse(), "mando de prueba", SIN_RED);
    expect(r.cambiado).toBe(true);
    expect(e.ejecucion.fuentesDesactivadas).toEqual(TODAS); // normalizada
    expect(esSimulacro(e.ejecucion)).toBe(true);

    const ev = e.eventos.find((x) => x.tipo === "humano");
    expect(ev?.mensaje).toContain("SIMULACRO");
    expect(ev?.nivel).toBe("aviso");

    expect(e.agentes.get("satelite")?.estado).toBe("inactivo");
    expect(e.agentes.get("satelite")?.desactivadoPorEscenario).toBe("Satélite (NASA FIRMS)");
    expect(e.agentes.get("prensa_redes")?.desactivadoPorEscenario).toBe("Prensa y redes");
    expect(e.agentes.get("verificador")?.desactivadoPorEscenario).toBeUndefined();

    expect(e.camaras.get("dgt:cerca")?.vigilada).toBe(false);
    expect(e.camaras.get("dgt:lejos")?.vigilada).toBe(false);
    expect(e.camaras.get("movil:tel1")?.vigilada).toBe(true);
  });

  it("volver a la operación real limpia las marcas y rearma solo las fijas a menos de 25 km de un foco activo", async () => {
    const e = estadoDePrueba();
    await cambiarFuentesDesactivadas(e, TODAS, "mando", SIN_RED);
    const r = await cambiarFuentesDesactivadas(e, [], "mando", SIN_RED);
    expect(r.cambiado).toBe(true);
    expect(e.ejecucion.fuentesDesactivadas).toEqual([]);
    expect(e.agentes.get("satelite")?.desactivadoPorEscenario).toBeUndefined();
    expect(e.agentes.get("prensa_redes")?.tareaActual).toBeUndefined();
    expect(e.camaras.get("dgt:cerca")?.vigilada).toBe(true);
    expect(e.camaras.get("dgt:cerca")?.incendioId).toBe("inc-1");
    expect(e.camaras.get("dgt:lejos")?.vigilada).toBe(false);
    const ultimo = e.eventos.filter((x) => x.tipo === "humano").at(-1);
    expect(ultimo?.mensaje).toContain("operación real");
  });

  it("la sincronización de fichas es idempotente y vuelve a poner la marca si alguien la borra", () => {
    const e = estadoDePrueba();
    e.ejecucion = { ...e.ejecucion, fuentesDesactivadas: ["satelite"] };
    sincronizarAgentesConEscenario(e);
    const v1 = e.version;
    sincronizarAgentesConEscenario(e);
    expect(e.version).toBe(v1); // nada que cambiar: no sube la versión
    // "reanudar" o una nueva ejecución reescriben la ficha sin la marca…
    e.actualizar(e.agentes, "satelite", { estado: "observando", tareaActual: undefined, desactivadoPorEscenario: undefined });
    sincronizarAgentesConEscenario(e);
    // …y el siguiente tick la repone.
    expect(e.agentes.get("satelite")?.estado).toBe("inactivo");
    expect(e.agentes.get("satelite")?.desactivadoPorEscenario).toBe("Satélite (NASA FIRMS)");
  });
});

describe("apagar el satélite retira lo que SOLO sostenía el satélite", () => {
  /** inc-1 (manual, activo) + un foco de satélite sin confirmar + otro de satélite ya confirmado, cada uno con sus pueblos. */
  function conFocosDeSatelite(): Estado {
    const e = estadoDePrueba();
    const sat = incendio({ id: "inc-sat", nombre: "Incendio de la Pobla de Mafumet", origen: "satelite", estado: "detectado", confianza: 0.7, centro: { lat: 41.18, lon: 1.23 } });
    const satConfirmado = incendio({ id: "inc-sat-ok", nombre: "Incendio confirmado", origen: "satelite", estado: "confirmado", centro: { lat: 42.0, lon: 0.5 } });
    e.incendios.set(sat.id, sat);
    e.incendios.set(satConfirmado.id, satConfirmado);
    e.poblaciones.set("osm:node/puigdelfi", poblacion("Puigdelfí", 1.6, 45, { id: "osm:node/puigdelfi", incendioId: "inc-sat", riesgo: "medio" }));
    e.poblaciones.set("osm:node/perafort", poblacion("Perafort", 2.4, 90, { id: "osm:node/perafort", incendioId: "inc-sat", riesgo: "medio" }));
    e.poblaciones.set("osm:node/navalacruz", poblacion("Navalacruz", 3, 10, { id: "osm:node/navalacruz", incendioId: "inc-1", riesgo: "alto" }));
    e.poblaciones.set("osm:node/otro", poblacion("Otro", 2, 10, { id: "osm:node/otro", incendioId: "inc-sat-ok" }));
    return e;
  }

  it("descarta los focos de satélite sin confirmar y borra sus pueblos; respeta el resto", async () => {
    const e = conFocosDeSatelite();
    const r = await cambiarFuentesDesactivadas(e, ["satelite"], "mando", SIN_RED);
    expect(r.cambiado).toBe(true);
    expect(e.incendios.get("inc-sat")?.estado).toBe("descartado");
    expect(e.incendios.get("inc-sat-ok")?.estado).toBe("confirmado");
    expect(e.incendios.get("inc-1")?.estado).toBe("activo");
    expect(e.poblaciones.has("osm:node/puigdelfi")).toBe(false);
    expect(e.poblaciones.has("osm:node/perafort")).toBe(false);
    expect(e.poblaciones.has("osm:node/navalacruz")).toBe(true);
    expect(e.poblaciones.has("osm:node/otro")).toBe(true);
    const humano = e.eventos.find((x) => x.tipo === "humano");
    expect(humano?.mensaje).toContain("1 foco de satélite sin confirmar descartado");
    expect(e.eventos.some((x) => x.incendioId === "inc-sat" && x.mensaje.includes("descartado"))).toBe(true);
  });

  it("apagar otra fuente no toca los focos de satélite", async () => {
    const e = conFocosDeSatelite();
    await cambiarFuentesDesactivadas(e, ["prensa_redes"], "mando", SIN_RED);
    expect(e.incendios.get("inc-sat")?.estado).toBe("detectado");
    expect(e.poblaciones.has("osm:node/puigdelfi")).toBe(true);
    expect(e.eventos.find((x) => x.tipo === "humano")?.mensaje).not.toContain("descartado");
  });

  it("volver a apagar el satélite con todo ya descartado no vuelve a contar nada", async () => {
    const e = conFocosDeSatelite();
    await cambiarFuentesDesactivadas(e, ["satelite"], "mando", SIN_RED);
    await cambiarFuentesDesactivadas(e, [], "mando", SIN_RED);
    await cambiarFuentesDesactivadas(e, ["satelite"], "mando", SIN_RED);
    const ultimo = e.eventos.filter((x) => x.tipo === "humano").at(-1);
    expect(ultimo?.mensaje).not.toContain("descartado");
  });

  it("un pueblo compartido con otro foco vivo no se borra: pasa a ese foco con distancia y riesgo recalculados", async () => {
    const e = conFocosDeSatelite();
    // Lo cargó el foco de satélite, pero está a ~5 km del foco manual inc-1 (40.44, -4.99).
    e.poblaciones.set(
      "osm:node/compartido",
      poblacion("Compartido", 20, 0, { id: "osm:node/compartido", incendioId: "inc-sat", centro: { lat: 40.485, lon: -4.99 }, riesgo: "bajo", etaFrenteMin: 30 }),
    );
    await cambiarFuentesDesactivadas(e, ["satelite"], "mando", SIN_RED);
    const p = e.poblaciones.get("osm:node/compartido");
    expect(p?.incendioId).toBe("inc-1");
    expect(p?.distanciaKm).toBeCloseTo(5, 0);
    expect(p?.riesgo).toBe("bajo");
    expect(p?.etaFrenteMin).toBeUndefined();
    expect(p?.motivoRiesgo).toContain("Incendio de prueba");
    // El que no tiene ningún foco vivo cerca sí se borra.
    expect(e.poblaciones.has("osm:node/puigdelfi")).toBe(false);
  });

  it("usa el cierre inyectado y, si falla, descarta a secas sin dejar pueblos colgando", async () => {
    const e = conFocosDeSatelite();
    e.ejecucion = { ...e.ejecucion, fuentesDesactivadas: ["satelite"] };
    const cerrados: string[] = [];
    const descartados = await descartarFocosDeFuentesApagadas(e, "mando", async (id) => {
      cerrados.push(id);
      throw new Error("OSRM caído");
    });
    expect(descartados.map((d) => `${d.foco.id}:${d.fuente.id}`)).toEqual(["inc-sat:satelite"]);
    expect(cerrados).toEqual(["inc-sat"]);
    expect(e.incendios.get("inc-sat")?.estado).toBe("descartado");
    expect(e.poblaciones.has("osm:node/puigdelfi")).toBe(false);
    expect(e.eventos.some((x) => x.tipo === "sistema" && x.mensaje.includes("OSRM caído"))).toBe(true);
  });
});

describe("apagar cualquier fuente retira lo que SOLO sostenía esa fuente (prensa, cámaras fijas, avisos)", () => {
  function obs(id: string, canal: Observacion["canal"], extra: Partial<Observacion> = {}): Observacion {
    return { id, canal, recibidaEn: "2026-09-19T14:00:00.000Z", texto: "prueba", punto: { lat: 39.8, lon: -1.1 }, impacto: "nuevo_foco", ...extra };
  }

  /**
   * inc-1 (manual, activo) + un foco sin confirmar por cada fuente apagable, uno
   * de cámara de MÓVIL, uno de prensa corroborado por una llamada (sin llegar a
   * confirmado) y uno de prensa ya confirmado. Todos lejos entre sí para que
   * ningún pueblo pase a otro foco.
   */
  function conFocosDeTodo(): Estado {
    const e = estadoDePrueba();
    const observaciones: Observacion[] = [
      obs("o-prensa", "prensa", { remitente: "EL PAÍS", incendioId: "inc-prensa" }),
      obs("o-dgt", "camara", { referenciaExterna: "dgt:123", incendioId: "inc-dgt", punto: { lat: 40.1, lon: -3.2 } }),
      obs("o-movil", "camara", { referenciaExterna: "movil:tel1", incendioId: "inc-movil", punto: { lat: 40.45, lon: -4.98 } }),
      obs("o-llamada", "llamada", { incendioId: "inc-llamada", punto: { lat: 38.5, lon: -0.5 } }),
      obs("o-prensa-2", "prensa", { incendioId: "inc-prensa-llamada", punto: { lat: 37.5, lon: -4.5 } }),
      obs("o-llamada-2", "llamada", { incendioId: "inc-prensa-llamada", punto: { lat: 37.5, lon: -4.5 }, impacto: "confirma" }),
    ];
    for (const o of observaciones) e.observaciones.set(o.id, o);
    const focos: Incendio[] = [
      incendio({ id: "inc-prensa", nombre: "Incendio de Tuéjar", origen: "prensa", estado: "detectado", confianza: 0.7, fuenteDeteccion: "EL PAÍS", observaciones: ["o-prensa"], centro: { lat: 39.8, lon: -1.1 } }),
      incendio({ id: "inc-dgt", nombre: "Incendio de la A-3", origen: "camara", estado: "detectado", confianza: 0.7, fuenteDeteccion: "Cámara A-3 PK 40 (DGT)", observaciones: ["o-dgt"], centro: { lat: 40.1, lon: -3.2 } }),
      incendio({ id: "inc-movil", nombre: "Incendio del móvil", origen: "camara", estado: "detectado", confianza: 0.7, fuenteDeteccion: "Cámara Teléfono de Javi (Movil)", observaciones: ["o-movil"], centro: { lat: 40.45, lon: -4.98 } }),
      incendio({ id: "inc-llamada", nombre: "Incendio de Alcoy", origen: "llamada", estado: "detectado", confianza: 0.55, fuenteDeteccion: "Llamada 112", observaciones: ["o-llamada"], centro: { lat: 38.5, lon: -0.5 } }),
      incendio({ id: "inc-prensa-llamada", nombre: "Incendio de Lucena", origen: "prensa", estado: "detectado", confianza: 0.65, observaciones: ["o-prensa-2", "o-llamada-2"], centro: { lat: 37.5, lon: -4.5 } }),
      incendio({ id: "inc-prensa-ok", nombre: "Incendio de Ponteareas", origen: "prensa", estado: "confirmado", confianza: 0.85, centro: { lat: 42.17, lon: -8.5 } }),
    ];
    for (const f of focos) e.incendios.set(f.id, f);
    e.poblaciones.set("osm:node/tuejar", poblacion("Tuéjar", 1.2, 30, { id: "osm:node/tuejar", incendioId: "inc-prensa", riesgo: "alto" }));
    e.poblaciones.set("osm:node/alcoy", poblacion("Alcoy", 2, 90, { id: "osm:node/alcoy", incendioId: "inc-llamada", riesgo: "medio" }));
    return e;
  }

  const estadoDe = (e: Estado, id: string) => e.incendios.get(id)?.estado;

  it("apagar prensa y redes descarta el foco que solo sostenía la prensa y respeta el confirmado, el corroborado por una llamada y los de otras fuentes", async () => {
    const e = conFocosDeTodo();
    await cambiarFuentesDesactivadas(e, ["prensa_redes"], "mando", SIN_RED);
    expect(estadoDe(e, "inc-prensa")).toBe("descartado");
    expect(estadoDe(e, "inc-prensa-ok")).toBe("confirmado");
    expect(estadoDe(e, "inc-prensa-llamada")).toBe("detectado"); // la llamada sigue activa y lo sostiene
    expect(estadoDe(e, "inc-dgt")).toBe("detectado");
    expect(estadoDe(e, "inc-movil")).toBe("detectado");
    expect(estadoDe(e, "inc-llamada")).toBe("detectado");
    expect(estadoDe(e, "inc-1")).toBe("activo");
    expect(e.poblaciones.has("osm:node/tuejar")).toBe(false);
    expect(e.poblaciones.has("osm:node/alcoy")).toBe(true);
    expect(e.eventos.find((x) => x.tipo === "humano")?.mensaje).toContain("1 foco de prensa y redes sin confirmar descartado");
    const detalle = e.eventos.find((x) => x.incendioId === "inc-prensa" && x.tipo === "incendio_actualizado");
    expect(detalle?.mensaje).toContain("Prensa y redes");
    expect(detalle?.mensaje).toContain("EL PAÍS");
    expect(detalle?.datos).toMatchObject({ origen: "prensa", fuenteApagada: "prensa_redes" });
  });

  it("apagar las cámaras fijas descarta el foco de la cámara DGT y respeta el de la cámara de móvil", async () => {
    const e = conFocosDeTodo();
    await cambiarFuentesDesactivadas(e, ["camaras_fijas"], "mando", SIN_RED);
    expect(estadoDe(e, "inc-dgt")).toBe("descartado");
    expect(estadoDe(e, "inc-movil")).toBe("detectado");
    expect(estadoDe(e, "inc-prensa")).toBe("detectado");
    expect(e.eventos.find((x) => x.tipo === "humano")?.mensaje).toContain("1 foco de cámaras fijas sin confirmar descartado");
  });

  it("sin la observación en memoria (poda o reinicio) decide el origen, y la cámara de móvil se reconoce por fuenteDeteccion", async () => {
    const e = conFocosDeTodo();
    e.observaciones.delete("o-dgt");
    e.observaciones.delete("o-movil");
    await cambiarFuentesDesactivadas(e, ["camaras_fijas"], "mando", SIN_RED);
    expect(estadoDe(e, "inc-dgt")).toBe("descartado");
    expect(estadoDe(e, "inc-movil")).toBe("detectado");
  });

  it("apagar los avisos ciudadanos descarta el foco de la llamada y respeta el de prensa corroborado (la prensa sigue activa)", async () => {
    const e = conFocosDeTodo();
    await cambiarFuentesDesactivadas(e, ["avisos_ciudadanos"], "mando", SIN_RED);
    expect(estadoDe(e, "inc-llamada")).toBe("descartado");
    expect(e.poblaciones.has("osm:node/alcoy")).toBe(false);
    expect(estadoDe(e, "inc-prensa-llamada")).toBe("detectado");
    expect(estadoDe(e, "inc-prensa")).toBe("detectado");
  });

  it("el simulacro deja solo lo confirmado, lo declarado a mano y lo de móvil, y el evento cuenta los descartes por fuente", async () => {
    const e = conFocosDeTodo();
    const r = await cambiarFuentesDesactivadas(e, TODAS, "mando", SIN_RED);
    expect(r.cambiado).toBe(true);
    expect(estadoDe(e, "inc-prensa")).toBe("descartado");
    expect(estadoDe(e, "inc-dgt")).toBe("descartado");
    expect(estadoDe(e, "inc-llamada")).toBe("descartado");
    expect(estadoDe(e, "inc-prensa-llamada")).toBe("descartado"); // sus dos fuentes están apagadas
    expect(estadoDe(e, "inc-movil")).toBe("detectado");
    expect(estadoDe(e, "inc-prensa-ok")).toBe("confirmado");
    expect(estadoDe(e, "inc-1")).toBe("activo");
    expect(e.poblaciones.has("osm:node/tuejar")).toBe(false);
    expect(e.poblaciones.has("osm:node/alcoy")).toBe(false);
    const humano = e.eventos.find((x) => x.tipo === "humano");
    expect(humano?.mensaje).toContain("SIMULACRO");
    expect(humano?.mensaje).toContain("4 focos sin confirmar descartados (prensa y redes 2, cámaras fijas 1, avisos ciudadanos 1)");
    expect(humano?.datos).toMatchObject({ focosDescartados: 4 });
    // Quedan en el mapa exactamente los que el simulacro promete.
    const vivos = e.incendiosActivos().map((i) => i.id).sort();
    expect(vivos).toEqual(["inc-1", "inc-movil", "inc-prensa-ok"]);
  });

  it("apagar el satélite vacía las detecciones crudas de NASA FIRMS (capa del mapa); apagar otra fuente las deja", async () => {
    const punto = (id: string): FocoSatelite => ({ id, punto: { lat: 41.18, lon: 1.23 }, fuente: "VIIRS_NOAA20", frp: 3.2, confianza: "nominal", fechaHora: "2026-09-19T03:02:00.000Z", diaNoche: "N" });
    const e = conFocosDeTodo();
    e.focosSatelite.set("firms:1", punto("firms:1"));
    e.focosSatelite.set("firms:2", punto("firms:2"));
    await cambiarFuentesDesactivadas(e, ["prensa_redes"], "mando", SIN_RED);
    expect(e.focosSatelite.size).toBe(2);
    await cambiarFuentesDesactivadas(e, ["prensa_redes", "satelite"], "mando", SIN_RED);
    expect(e.focosSatelite.size).toBe(0);
  });

  it("encender una fuente de nuevo no descarta nada aunque otras sigan apagadas", async () => {
    const e = conFocosDeTodo();
    await cambiarFuentesDesactivadas(e, ["prensa_redes", "camaras_fijas"], "mando", SIN_RED);
    const antes = e.eventos.length;
    await cambiarFuentesDesactivadas(e, ["camaras_fijas"], "mando", SIN_RED);
    const nuevos = e.eventos.slice(antes);
    expect(nuevos.some((x) => x.mensaje.includes("descartado"))).toBe(false);
    expect(nuevos.at(-1)?.mensaje).toContain("encendidas de nuevo: prensa y redes");
  });
});
