import { afterEach, describe, expect, it, vi } from "vitest";
import { agenteDesactivadoPorEscenario } from "@/lib/dominio/fuentes-deteccion";
import { CAPACIDADES_POR_AGENTE, IDS_AGENTES_CANONICOS, buscarAgenteCompatible, resolverIdentidadAgente } from "@/lib/agentes/identidad";
import { AGENTES_LOGICOS, capacidadConPadrePorId, obtenerTareasEjecutables } from "@/lib/agentes/logicos";
import { registrarAgentes } from "@/lib/agentes/registro";
import { Estado, establecerEstado } from "@/lib/motor/estado";
import { despertar, estadoDelNucleo, recargarAgentes } from "@/lib/motor/orquestador";
import { anotarTraza, ejecutarConTraza } from "@/lib/motor/traza";
import {
  agregarDeltasAlPadre,
  capacidadesDespertadasPor,
  capacidadesEjecutables,
  fichaPadreDe,
  padresDelCatalogo,
} from "./ayudas/topologia-16-a-5";

afterEach(() => vi.unstubAllEnvs());

describe("corte 16 → 5 · integración local de topología", () => {
  it("expone exactamente 5 fichas lógicas y 16 capacidades programables", () => {
    expect(padresDelCatalogo()).toEqual(IDS_AGENTES_CANONICOS);
    expect(AGENTES_LOGICOS).toHaveLength(5);
    expect(Object.values(CAPACIDADES_POR_AGENTE).flat()).toHaveLength(16);

    const ids = AGENTES_LOGICOS.flatMap((agente) => agente.capacidades.map((capacidad) => capacidad.id));
    expect(new Set(ids).size).toBe(16);
    expect(AGENTES_LOGICOS.every((agente) => agente.capacidades.every((capacidad) => typeof capacidad.ciclo === "function"))).toBe(true);

    const tareas = obtenerTareasEjecutables();
    expect(tareas).toHaveLength(16);
    expect(new Set(tareas.map(({ tareaId }) => tareaId)).size).toBe(16);
    expect(tareas.every(({ tareaId, agenteId, capacidadId }) => tareaId === `${agenteId}/${capacidadId}`)).toBe(true);
  });

  it("registra cinco fichas cuando la topología activa es five", () => {
    vi.stubEnv("AGENT_TOPOLOGY", "five");
    const estado = new Estado();
    registrarAgentes(estado);

    // Intención de migración: la UI ve padres; las capacidades no crean 16
    // fichas duplicadas en la topología nueva.
    expect([...estado.agentes.keys()]).toEqual(IDS_AGENTES_CANONICOS);
    expect(estado.agentes.size).toBe(5);
  });

  it("al despertar por un id legacy resuelve capacidad y padre lógico", () => {
    const identidad = resolverIdentidadAgente("vigia_camaras");
    expect(identidad).toMatchObject({ agenteId: "observador", capacidadId: "vigia_camaras", esAlias: true });
    expect(capacidadConPadrePorId("vigia_camaras")).toMatchObject({ agenteId: "observador", capacidadId: "vigia_camaras" });

    vi.stubEnv("AGENT_TOPOLOGY", "five");
    const estado = new Estado();
    registrarAgentes(estado);
    expect(buscarAgenteCompatible([...estado.agentes.values()], "vigia_camaras")?.id).toBe("observador");
  });

  it("el orquestador registra 5 fichas y encola por separado las capacidades del padre", async () => {
    vi.stubEnv("AGENT_TOPOLOGY", "five");
    const estado = new Estado();
    establecerEstado(estado);

    await expect(recargarAgentes()).resolves.toBe(5);
    expect([...estado.agentes.keys()]).toEqual(IDS_AGENTES_CANONICOS);

    despertar("observador", "prueba de padre");
    const enCola = new Set(estadoDelNucleo().enCola);
    expect(CAPACIDADES_POR_AGENTE.observador.every((capacidadId) => enCola.has(capacidadId))).toBe(true);
    expect(enCola.has("observador")).toBe(false);
  });

  it("despierta las capacidades correctas para cada evento, sin despertar al padre equivocado", () => {
    const esperado: Record<string, string[]> = {
      incendio_nuevo: ["vigia_camaras", "meteorologo", "prensa_redes", "patrones", "coordinador", "proteccion_poblacion"],
      incendio_actualizado: ["propagacion", "coordinador", "proteccion_poblacion", "portavoz"],
      observacion: ["verificador"],
      camara_positiva: ["verificador"],
      satelite: ["verificador"],
      viento_gira: ["propagacion", "coordinador", "proteccion_poblacion"],
      peligro_sube: ["coordinador", "proteccion_poblacion"],
      unidad_llega: ["propagacion", "coordinador"],
      decision_propuesta: ["asesor_legal", "supervisor"],
      decision_aprobada: ["despachador", "memoria"],
      decision_denegada: ["coordinador", "redactor", "memoria"],
      decision_ejecutada: ["portavoz", "redactor"],
      decision_escalada: ["portavoz", "redactor", "memoria"],
      accion_fallida: ["memoria"],
      poblacion_avisada: ["portavoz"],
      agente: ["supervisor"],
    };

    for (const [evento, ids] of Object.entries(esperado)) {
      expect(capacidadesDespertadasPor(evento as never).map(({ capacidadId }) => capacidadId).sort(), evento).toEqual([...ids].sort());
      for (const capacidadId of ids) expect(fichaPadreDe(capacidadId)).toBe(capacidadConPadrePorId(capacidadId)?.agenteId);
    }
  });

  it("pausa y control humano por alias afectan la ficha padre, no una ficha fantasma legacy", () => {
    vi.stubEnv("AGENT_TOPOLOGY", "five");
    const estado = new Estado();
    registrarAgentes(estado);
    const destino = buscarAgenteCompatible([...estado.agentes.values()], "supervisor");
    expect(destino?.id).toBe("guardian");

    const ficha = estado.agentes.get(destino!.id)!;
    estado.actualizar(estado.agentes, ficha.id, { pausado: true, controlHumano: true, estado: "pausado" });
    expect(estado.agentes.get("guardian")).toMatchObject({ pausado: true, controlHumano: true, estado: "pausado" });
    expect(estado.agentes.has("supervisor")).toBe(false);
  });

  it("desactivar satélite excluye solo esa capacidad y mantiene activo al resto de observador", () => {
    const ejecucion = { fuentesDesactivadas: ["satelite"] as ("satelite")[] };
    expect(agenteDesactivadoPorEscenario(ejecucion, "satelite")?.id).toBe("satelite");
    expect(agenteDesactivadoPorEscenario(ejecucion, "observador")).toBeUndefined();

    const tareas = obtenerTareasEjecutables();
    const ejecutables = capacidadesEjecutables(tareas, ["satelite"]);
    expect(ejecutables.some(({ capacidadId }) => capacidadId === "satelite")).toBe(false);

    const capacidadesObservador = tareas
      .filter(({ agenteId }) => agenteId === "observador")
      .map(({ capacidadId }) => capacidadId);
    const capacidadesObservadorActivas = ejecutables
      .filter(({ agenteId }) => agenteId === "observador")
      .map(({ capacidadId }) => capacidadId);
    expect(capacidadesObservadorActivas).toEqual(capacidadesObservador.filter((id) => id !== "satelite"));
    expect(capacidadesObservadorActivas).toHaveLength(5);
  });

  it("agrega trazas y contadores de capacidades en la ficha padre", async () => {
    vi.stubEnv("AGENT_TOPOLOGY", "five");
    const estado = new Estado();
    registrarAgentes(estado);
    const padre = estado.agentes.get("observador");
    expect(padre).toBeDefined();

    await ejecutarConTraza(estado, "observador", "capacidad:vigia_camaras", async () => {
      anotarTraza({ resumen: "ciclo de prueba", eventos: 1 });
    });
    const actualizado = estado.agentes.get("observador")!;
    expect(actualizado.trazas?.at(-1)?.motivo).toBe("capacidad:vigia_camaras");

    expect(agregarDeltasAlPadre([
      { capacidadId: "vigia_camaras", ciclos: 1, acciones: 2, trazaId: "t-vigia" },
      { capacidadId: "satelite", ciclos: 3, decisiones: 1, trazaId: "t-satelite" },
    ]).get("observador")).toEqual({ ciclos: 4, decisiones: 1, acciones: 2, errores: 0, trazas: ["t-vigia", "t-satelite"] });
  });
});
