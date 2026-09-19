// =====================================================================
// Actas deterministas · RED DE NO REGRESIÓN de la fase F1.
// Prueba de CLASE 1 (caracterización exacta): sin IA, sin red.
//
// ESTE FICHERO SE ESCRIBE ANTES DE TOCAR lib/motor/actas.ts Y NO SE EDITA
// DESPUÉS. F1 quita la narrativa de IA de las actas de acción; lo que
// tiene que seguir intacto es esto: los HECHOS del acta y su huella
// SHA-256. Si alguna de estas pruebas cambia durante F1, es que la fase
// se ha llevado por delante algo que prometía conservar.
//
// La huella es la garantía fuerte: se calcula sobre el contenido, así que
// cualquier alteración de un solo carácter la cambia y la prueba cae.
// DUEÑO: constructor L (escrito en la fase F1 de la migración).
// =====================================================================
import { describe, expect, it } from "vitest";
import { actaAccionDeterminista, actaDecisionDeterminista, huellaDe } from "@/lib/motor/actas";
import { cadenaDe } from "@/lib/motor/auditoria";
import { Estado } from "@/lib/motor/estado";
import type { Accion, Decision, TrazaCiclo, Unidad } from "@/lib/dominio/tipos";
import { incendio as fabricaIncendio, unidad as fabricaUnidad } from "./ayudas/dominio";

/** Estado mínimo con un foco, una unidad y la ficha del agente que decide. */
function estadoConTodo(): Estado {
  const e = new Estado();
  const inc = fabricaIncendio({ id: "inc-1", nombre: "Incendio de Navalacruz" });
  e.guardar(e.incendios, inc);
  const u: Unidad = fabricaUnidad("bomberos", { id: "uni-1", nombre: "Bomberos de Ávila", incendioId: "inc-1" });
  e.guardar(e.unidades, u);
  e.agentes.set("coordinador", {
    id: "coordinador",
    nombre: "Coordinador de medios",
    categoria: "planificacion",
    descripcion: "Jefe de operaciones",
    estado: "observando",
    modelo: "glm5.3-flash",
    contadores: { ciclos: 3, decisiones: 1, acciones: 2, errores: 0 },
    pausado: false,
    controlHumano: false,
    cadenciaSeg: 90,
  });
  return e;
}

const ACCION: Accion = {
  id: "acc-1",
  tipo: "desplegar_unidad",
  descripcion: "Enviar Bomberos de Ávila al sector A de Incendio de Navalacruz (12 min por carretera)",
  objetivo: { unidadId: "uni-1" },
  parametros: { sector: "A", incendioId: "inc-1", ataqueInicial: true, minutosCarretera: 12 },
  estado: "ejecutada",
  autorizadaPor: "ia",
  ordenadaEn: "2026-09-19T14:05:00.000Z",
  ejecutadaEn: "2026-09-19T14:05:03.000Z",
  resultado: {
    en: "2026-09-19T14:05:03.000Z",
    proveedor: "OSRM",
    referencia: "ruta-1",
    resumen: "Bomberos de Ávila en ruta al sector A: 18,4 km, 12 min por carretera.",
    exito: true,
    datos: { ruta: { distanciaM: 18400, duracionS: 720 } },
  },
};

const DECISION: Decision = {
  id: "dec-1",
  ejecucionId: "ejec-1",
  agenteId: "coordinador",
  incendioId: "inc-1",
  titulo: "Ataque inicial — Incendio de Navalacruz",
  resumen: "Enviar Bomberos de Ávila a la cabeza del incendio.",
  razonamiento: "El foco no tiene unidades asignadas: la doctrina exige ataque inicial.",
  prioridad: 1,
  riesgo: 25,
  competencia: "autonoma",
  estado: "ejecutada",
  acciones: [ACCION],
  evidencias: [
    { id: "ev-1", fuente: "Open-Meteo", resumen: "Viento del SO a 35 km/h", url: "https://open-meteo.com", en: "2026-09-19T14:00:00.000Z", confianza: 0.9 },
  ],
  fundamentos: [
    { chunkId: "chk-1", documento: "Directriz Básica RD 893/2013", seccion: "3.2", cita: "El director de extinción dirige las operaciones.", similitud: 0.81 },
  ],
  creadaEn: "2026-09-19T14:04:00.000Z",
  creadaEnMundo: "2026-09-19T14:04:00.000Z",
  decididaEn: "2026-09-19T14:05:00.000Z",
  decididaPor: "ia",
  historial: [
    { en: "2026-09-19T14:04:00.000Z", enMundo: "2026-09-19T14:04:00.000Z", estado: "propuesta", quien: "coordinador", motivo: "Propuesta por el agente" },
    { en: "2026-09-19T14:05:00.000Z", enMundo: "2026-09-19T14:05:00.000Z", estado: "aprobada", quien: "ia" },
    { en: "2026-09-19T14:05:03.000Z", enMundo: "2026-09-19T14:05:03.000Z", estado: "ejecutada", quien: "ia", motivo: "1 de 1 acciones con éxito" },
  ],
};

const TRAZA: TrazaCiclo = {
  id: "traza-1",
  inicio: "2026-09-19T14:03:58.000Z",
  fin: "2026-09-19T14:04:00.000Z",
  duracionMs: 2000,
  estado: "ok",
  motivo: "incendio_nuevo",
  entradas: "1 incendios activos, 24 unidades libres, viento SO 35 km/h",
  resumen: "Ataque inicial propuesto",
  llamadasIA: [
    { en: "2026-09-19T14:03:59.000Z", proveedor: "helmcode", modelo: "qwen3-embedding", papel: "embeddings", latenciaMs: 287, promptResumen: "…", respuestaResumen: "…" },
  ],
  decisiones: ["dec-1"],
  observaciones: [],
  eventos: 1,
};

describe("acta de decisión · los hechos que tiene que llevar siempre", () => {
  const { titulo, contenido } = actaDecisionDeterminista(estadoConTodo(), DECISION, TRAZA);

  it("se titula por la decisión y su estado", () => {
    expect(titulo).toBe("Acta de decisión · Ataque inicial — Incendio de Navalacruz · ejecutada");
  });

  it("identifica decisión, ejecución, agente e incendio", () => {
    expect(contenido).toContain("`dec-1`");
    expect(contenido).toContain("`ejec-1`");
    expect(contenido).toContain("Coordinador de medios");
    expect(contenido).toContain("Incendio de Navalacruz");
    expect(contenido).toContain("Navalacruz, Ávila");
  });

  it("deja por escrito quién decidió, con qué riesgo y bajo qué competencia", () => {
    expect(contenido).toContain("**riesgo** 25");
    expect(contenido).toContain("**competencia** autonoma");
    expect(contenido).toContain("**Decidida por**: ia");
  });

  it("lleva el historial completo de estados con quién y por qué", () => {
    expect(contenido).toContain("Historial de estados (3)");
    for (const estado of ["propuesta", "aprobada", "ejecutada"]) expect(contenido).toContain(`→ **${estado}**`);
    expect(contenido).toContain("1 de 1 acciones con éxito");
  });

  it("lleva cada acción con su resultado REAL, no con la intención", () => {
    expect(contenido).toContain("Acciones (1)");
    expect(contenido).toContain("**desplegar_unidad**");
    expect(contenido).toContain("ÉXITO vía OSRM");
    expect(contenido).toContain("ref. ruta-1");
  });

  it("lleva evidencias con su fuente y su URL", () => {
    expect(contenido).toContain("Evidencias (1)");
    expect(contenido).toContain("Open-Meteo");
    expect(contenido).toContain("https://open-meteo.com");
  });

  it("lleva los fundamentos normativos con su cita y su similitud", () => {
    expect(contenido).toContain("Fundamentos normativos (1)");
    expect(contenido).toContain("Directriz Básica RD 893/2013");
    expect(contenido).toContain("similitud 0.81");
  });

  it("lleva la traza del ciclo que la originó", () => {
    expect(contenido).toContain("traza-1");
    expect(contenido).toContain("incendio_nuevo");
    expect(contenido).toContain("24 unidades libres");
  });

  it("es reproducible: mismas entradas, mismo contenido y misma huella", () => {
    const otra = actaDecisionDeterminista(estadoConTodo(), DECISION, TRAZA);
    expect(otra.contenido).toBe(contenido);
    expect(huellaDe(otra.contenido)).toBe(huellaDe(contenido));
  });

  it("la huella es un SHA-256 de 64 hexadecimales y cambia con el contenido", () => {
    expect(huellaDe(contenido)).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDe(contenido)).not.toBe(huellaDe(`${contenido} `));
  });

  it("no lanza aunque falte la traza, el incendio o el agente", () => {
    const vacio = new Estado();
    const r = actaDecisionDeterminista(vacio, { ...DECISION, incendioId: undefined }, undefined);
    expect(r.contenido).toContain("**Incendio**: —");
    expect(r.contenido).toContain("No se conserva la traza");
  });
});

describe("actas y auditoría durante el corte de topología", () => {
  it("atribuye una decisión legacy a su ficha lógica registrada", async () => {
    const estado = estadoConTodo();
    const coordinador = estado.agentes.get("coordinador")!;
    estado.agentes.delete("coordinador");
    estado.agentes.set("planificador_operativo", {
      ...coordinador,
      id: "planificador_operativo",
      nombre: "Planificador operativo",
    });

    expect(actaDecisionDeterminista(estado, DECISION).contenido).toContain("Planificador operativo");
    await expect(cadenaDe(estado, DECISION)).resolves.toMatchObject({
      agente: { id: "planificador_operativo", nombre: "Planificador operativo" },
    });
  });
});

describe("acta de acción · lo que F1 tiene que conservar", () => {
  const { titulo, contenido } = actaAccionDeterminista(estadoConTodo(), DECISION, ACCION, TRAZA);

  it("se titula por la acción y su estado", () => {
    expect(titulo).toBe(`Acta de acción · ${ACCION.descripcion} · ejecutada`);
  });

  it("identifica la acción, su tipo y la decisión de origen", () => {
    expect(contenido).toContain("`acc-1`");
    expect(contenido).toContain("**tipo** desplegar_unidad");
    expect(contenido).toContain("`dec-1`");
  });

  it("deja por escrito quién la autorizó y cuándo se ordenó", () => {
    expect(contenido).toContain("**Autorizada por**: ia");
    expect(contenido).toContain("2026-09-19T14:05:00.000Z");
  });

  it("nombra al destinatario real, no solo su id", () => {
    expect(contenido).toContain("Bomberos de Ávila");
  });

  it("incluye los parámetros exactos de la orden", () => {
    expect(contenido).toContain('"sector": "A"');
    expect(contenido).toContain('"ataqueInicial": true');
  });

  it("incluye qué pasó de verdad: proveedor, referencia y datos reales", () => {
    expect(contenido).toContain("**Resultado**: ÉXITO");
    expect(contenido).toContain("**Proveedor**: OSRM");
    expect(contenido).toContain("**Referencia externa**: ruta-1");
    expect(contenido).toContain('"distanciaM": 18400');
  });

  it("dice con todas las letras cuando una acción no llegó a ejecutarse", () => {
    const sinResultado = actaAccionDeterminista(estadoConTodo(), DECISION, { ...ACCION, resultado: undefined }, TRAZA);
    expect(sinResultado.contenido).toContain("no llegó a ejecutarse");
  });

  it("registra el FALLO igual de bien que el éxito", () => {
    const fallida = actaAccionDeterminista(estadoConTodo(), DECISION, {
      ...ACCION,
      estado: "fallida",
      resultado: { en: "2026-09-19T14:05:03.000Z", proveedor: "HappyRobot", resumen: "Falta HAPPYROBOT_WORKFLOW_SLUG_VOZ", exito: false },
    }, TRAZA);
    expect(fallida.contenido).toContain("**Resultado**: FALLO");
    expect(fallida.contenido).toContain("Falta HAPPYROBOT_WORKFLOW_SLUG_VOZ");
  });

  it("es reproducible: mismas entradas, mismo contenido y misma huella", () => {
    const otra = actaAccionDeterminista(estadoConTodo(), DECISION, ACCION, TRAZA);
    expect(otra.contenido).toBe(contenido);
    expect(huellaDe(otra.contenido)).toBe(huellaDe(contenido));
  });

  it("la huella es un SHA-256 de 64 hexadecimales", () => {
    expect(huellaDe(contenido)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("el acta determinista se basta sola", () => {
  it("sin IA, un acta de acción sigue siendo auditable de punta a punta", () => {
    // Esta es LA prueba que autoriza el cambio de F1: quitar la narrativa no
    // quita nada de lo que hace falta para defender la acción ante una comisión.
    const { contenido } = actaAccionDeterminista(estadoConTodo(), DECISION, ACCION, TRAZA);
    const imprescindibles = [
      "acc-1",                       // qué acción
      "desplegar_unidad",            // de qué tipo
      "dec-1",                       // de qué decisión venía
      "Autorizada por",              // quién dio la orden
      "Bomberos de Ávila",           // a quién
      "sector",                      // con qué instrucciones
      "Resultado",                   // qué pasó
      "OSRM",                        // con qué proveedor
      "traza-1",                     // con qué razonamiento detrás
    ];
    for (const trozo of imprescindibles) expect(contenido).toContain(trozo);
    expect(huellaDe(contenido)).toMatch(/^[0-9a-f]{64}$/);
  });
});
