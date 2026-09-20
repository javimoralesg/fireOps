// Puerta integral de la migración 16 → 5.
//
// Se ejecuta contra un servidor DEDICADO con LLM real y salidas/persistencia
// interceptadas. Las cuatro fuentes automáticas quedan apagadas: solo recorre
// foco manual → enriquecimiento → planificación → ejecución → auditoría.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Decision, Snapshot } from "@/lib/dominio/tipos";
import { IDS_AGENTES_CANONICOS } from "@/lib/agentes/identidad";
import { api, declararFoco, enviar, esperarEntornoCargado, esperarHasta, esperarValor, medir, obtener, snapshot } from "./ayudas";

const FUENTES_APAGADAS = ["satelite", "prensa_redes", "camaras_fijas", "avisos_ciudadanos"] as const;
const FOCO = { lat: 39.79, lon: -1.05, nombre: "Puerta 16 a 5 aislada" };

interface CadenaAuditoria {
  decision: Decision;
  agente: { id: string; nombre: string } | null;
  trazaOrigen: { agenteId: string; llamadasIA: { proveedor: string; modelo: string; latenciaMs: number }[] } | null;
  informes: { id: string; tipo: string; huella?: string }[];
  acciones: Decision["acciones"];
}

const contexto: { incendioId?: string } = {};

describe("topología five · escenario integral aislado", () => {
  beforeAll(async () => {
    if (process.env.ATALAYA_EFECTOS_INTERCEPTADOS !== "1") {
      throw new Error("Esta puerta exige ATALAYA_EFECTOS_INTERCEPTADOS=1 y un servidor dedicado sin credenciales operativas");
    }
    const salud = await api("/api/salud", { intentos: 1, timeoutMs: 30_000 });
    if (salud.estado !== 200) throw new Error(`El servidor dedicado no responde (${salud.estado}): ${salud.texto.slice(0, 200)}`);

    await enviar("/api/ejecucion", {
      accion: "nueva",
      nombre: "Puerta integral 16 a 5",
      fuentesDesactivadas: FUENTES_APAGADAS,
    });
    await enviar("/api/reloj", { pausado: false });
  }, 120_000);

  afterAll(async () => {
    await enviar("/api/reloj", { pausado: true }).catch(() => undefined);
  }, 30_000);

  it("registra cinco fichas y recorre foco → decisión → acción → auditoría", async () => {
    const inicial = await snapshot();
    expect(inicial.agentes.map((agente) => agente.id)).toEqual(IDS_AGENTES_CANONICOS);
    expect(inicial.ejecucion.fuentesDesactivadas).toEqual(FUENTES_APAGADAS);

    const t0 = Date.now();
    const incendio = await declararFoco(FOCO.lat, FOCO.lon, FOCO.nombre);
    contexto.incendioId = incendio.id;
    const entorno = await esperarEntornoCargado(incendio.id, 240_000);
    const conMedios = entorno.unidades >= 1;
    const resultadoDecision = conMedios
      ? await esperarHasta(
          "ataque inicial ejecutado o finalizado",
          (estado: Snapshot) => estado.decisiones.find(
            (candidata) =>
              candidata.incendioId === incendio.id &&
              /ataque inicial/i.test(candidata.titulo) &&
              ["ejecutando", "ejecutada", "fallida"].includes(candidata.estado),
          ),
          240_000,
          1_500,
        )
      : {
          // Overpass es externo y puede dejar temporalmente el pool sin medios.
          // La puerta sigue recorriendo el pipeline real con una acción interna,
          // sin inventar unidades ni fingir un despacho.
          valor: (await enviar<{ decision: Decision }>("/api/decisiones/manual", {
            incendioId: incendio.id,
            titulo: "Continuidad degradada sin catálogo Overpass",
            resumen: "Abrir una incidencia operativa mientras se recupera el catálogo externo de medios.",
            razonamiento: entorno.fallos.join(" · ") || "El catálogo externo no devolvió unidades.",
            quien: "puerta integral automatizada",
            acciones: [{
              tipo: "abrir_ticket",
              descripcion: "Registrar continuidad degradada por catálogo de medios no disponible",
              parametros: { titulo: "Catálogo de medios no disponible", cuerpo: entorno.fallos.join("\n"), destinatario: "Sala de mando" },
            }],
          })).decision,
          ms: 0,
        };
    const { valor: decision, ms: msDecision } = resultadoDecision;
    medir("five aislado · decisión", msDecision, `${decision.id} · ${decision.estado}`);
    expect(decision.agenteId).toBe(conMedios ? "coordinador" : "humano");
    expect(decision.competencia).toBe(conMedios ? "autonoma" : "humano");

    const { valor: accion, ms: msAccion } = await esperarHasta(
      "despliegue con resultado y ruta",
      (estado: Snapshot) => {
        const actual = estado.decisiones.find((candidata) => candidata.id === decision.id);
        return actual?.acciones.find((candidata) =>
          candidata.tipo === (conMedios ? "desplegar_unidad" : "abrir_ticket") &&
          ["ejecutada", "fallida"].includes(candidata.estado) &&
          candidata.resultado,
        );
      },
      180_000,
      1_500,
    );
    medir("five aislado · acción", msAccion, `${accion.id} · ${accion.estado} · ${accion.resultado?.proveedor}`);
    expect(accion.resultado).toBeDefined();

    const { valor: cadena, ms: msAuditoria } = await esperarValor(
      "cadena con traza LLM y actas",
      async () => {
        const candidata = await obtener<CadenaAuditoria>(`/api/auditoria?decisionId=${encodeURIComponent(decision.id)}`);
        const trazaLista = conMedios ? Boolean(candidata.trazaOrigen?.llamadasIA.length) : true;
        return trazaLista && candidata.informes.length ? candidata : undefined;
      },
      180_000,
      2_000,
    );
    medir(
      "five aislado · auditoría",
      msAuditoria,
      `${cadena.trazaOrigen?.llamadasIA.length ?? 0} llamada(s) IA · ${cadena.informes.length} acta(s)`,
    );
    if (conMedios) {
      expect(cadena.agente?.id).toBe("planificador_operativo");
      expect(cadena.trazaOrigen?.agenteId).toBe("planificador_operativo");
      expect(cadena.trazaOrigen?.llamadasIA.length).toBeGreaterThanOrEqual(1);
    }
    expect(cadena.informes.every((informe) => Boolean(informe.huella))).toBe(true);

    const expediente = await api(`/api/auditoria/exportar?decisionId=${encodeURIComponent(decision.id)}`, { intentos: 1 });
    expect(expediente.estado).toBe(200);
    expect(expediente.cabeceras.get("content-type")).toContain("text/markdown");
    expect(expediente.texto).toContain(decision.id);

    const final = await snapshot();
    expect(final.agentes).toHaveLength(5);
    expect(final.agentes.map((agente) => agente.id)).toEqual(IDS_AGENTES_CANONICOS);
    medir("five aislado · total", Date.now() - t0, `${final.decisiones.length} decisión(es)`);
  }, 660_000);
});
