// Pruebas de lib/cliente/zona.ts · filtro por zona de la sala (recuadro/lazo).
// DUEÑO: constructor E. Deterministas y sin red.
import { describe, expect, it } from "vitest";
import type { Decision, Evento, FocoSatelite, Snapshot, Unidad } from "@/lib/dominio/tipos";
import { crearPruebaZona, filtrarSnapshotPorZona, limitesZona, puntoEnZona, zonaValida, type ZonaSeleccion } from "@/lib/cliente/zona";
import { incendio, poblacion } from "./ayudas/dominio";

/** Recuadro alrededor de Ávila-Navalacruz: lat 40,2–40,8 · lon -5,3 – -4,5. */
const RECUADRO: ZonaSeleccion = {
  tipo: "recuadro",
  puntos: [
    [40.2, -5.3],
    [40.2, -4.5],
    [40.8, -4.5],
    [40.8, -5.3],
  ],
  creadaEn: 1,
};

/** Lazo en forma de L (cóncavo): el cuadrante superior derecho queda FUERA. */
const LAZO_L: ZonaSeleccion = {
  tipo: "lazo",
  puntos: [
    [0, 0],
    [0, 10],
    [5, 10],
    [5, 5],
    [10, 5],
    [10, 0],
  ],
  creadaEn: 2,
};

function unidad(p: Partial<Unidad>): Unidad {
  return {
    id: "u",
    nombre: "Unidad",
    tipo: "bomberos",
    base: { nombre: "Parque", punto: { lat: 40.65, lon: -4.7 } },
    posicion: { lat: 40.65, lon: -4.7 },
    estado: "disponible",
    velocidadKmh: 60,
    dotacion: { personas: 4, vehiculos: 1 },
    fuente: "OSM",
    ...p,
  };
}

function decision(p: Partial<Decision>): Decision {
  return {
    id: "d",
    ejecucionId: "e",
    agenteId: "coordinador",
    titulo: "Decisión",
    resumen: "",
    razonamiento: "",
    prioridad: 3,
    riesgo: 10,
    competencia: "supervisada",
    estado: "pendiente_humano",
    acciones: [],
    evidencias: [],
    fundamentos: [],
    creadaEn: "2026-09-19T14:00:00.000Z",
    creadaEnMundo: "2026-09-19T14:00:00.000Z",
    ...p,
  };
}

function evento(p: Partial<Evento>): Evento {
  return { id: "ev", en: "2026-09-19T14:00:00.000Z", enMundo: "2026-09-19T14:00:00.000Z", tipo: "sistema", mensaje: "", nivel: "info", ...p };
}

function satelite(id: string, lat: number, lon: number): FocoSatelite {
  return { id, punto: { lat, lon }, fuente: "MODIS", frp: 12, confianza: "nominal", fechaHora: "2026-09-19T14:00:00.000Z", diaNoche: "D" };
}

const DENTRO = incendio({ id: "inc-dentro", centro: { lat: 40.44, lon: -4.99 } });
const FUERA = incendio({ id: "inc-fuera", nombre: "Incendio lejano", centro: { lat: 41.6, lon: 2.1 } });

function snapshot(): Snapshot {
  return {
    version: 1,
    generadoEn: "2026-09-19T14:00:00.000Z",
    reloj: { inicioReal: "", inicioMundo: "", factor: 12, ahoraMundo: "", pausado: false, tick: 0 },
    ejecucion: {
      id: "e",
      nombre: "Ejecución",
      inicio: "",
      estado: "activa",
      metricas: {
        incendios: 2,
        decisionesPropuestas: 0,
        decisionesAprobadas: 0,
        decisionesDenegadas: 0,
        decisionesAutonomas: 0,
        escaladasAHumano: 0,
        poblacionesAvisadas: 0,
        poblacionesEnPeligroSinAvisar: 0,
        llamadasRealizadas: 0,
        llamadasContestadas: 0,
        falsosPositivosCamara: 0,
      },
    },
    incendios: [DENTRO, FUERA],
    clusters: [
      { id: "c-dentro", incendios: ["inc-dentro"], tipo: "independientes", analisis: "", recomendacion: "", detectadoEn: "", actualizadoEn: "" },
      { id: "c-fuera", incendios: ["inc-fuera"], tipo: "independientes", analisis: "", recomendacion: "", detectadoEn: "", actualizadoEn: "" },
    ],
    unidades: [
      unidad({ id: "u-asignada-dentro", incendioId: "inc-dentro", estado: "en_ruta", posicion: { lat: 41.0, lon: 2.0 } }), // fuera geográficamente, pero de un foco de dentro
      unidad({ id: "u-asignada-fuera", incendioId: "inc-fuera", estado: "en_ruta", posicion: { lat: 40.5, lon: -4.9 } }), // dentro geográficamente, pero de un foco de fuera
      unidad({ id: "u-base-dentro" }),
      unidad({ id: "u-base-fuera", posicion: { lat: 41.6, lon: 2.0 }, base: { nombre: "Parque lejano", punto: { lat: 41.6, lon: 2.0 } } }),
    ],
    poblaciones: [poblacion("Navalacruz", 3, 45, { incendioId: "inc-dentro" }), poblacion("Lejana", 3, 45, { incendioId: "inc-fuera" })],
    hospitales: [
      { id: "h-dentro", nombre: "Hospital de Ávila", punto: { lat: 40.66, lon: -4.69 }, tipo: "hospital" },
      { id: "h-fuera", nombre: "Hospital lejano", punto: { lat: 41.6, lon: 2.1 }, tipo: "hospital" },
    ],
    camaras: [],
    focosSatelite: [satelite("s-dentro", 40.5, -5.0), satelite("s-fuera", 41.7, 2.2)],
    observaciones: [],
    decisiones: [
      decision({ id: "d-dentro", incendioId: "inc-dentro" }),
      decision({ id: "d-fuera", incendioId: "inc-fuera" }),
      decision({ id: "d-general" }),
    ],
    comunicados: [],
    agentes: [],
    avisosMeteo: [],
    eventos: [evento({ id: "ev-dentro", incendioId: "inc-dentro" }), evento({ id: "ev-fuera", incendioId: "inc-fuera" }), evento({ id: "ev-sistema" })],
    politica: {
      reglas: [],
      umbralHumano: 80,
      umbralSupervisada: 40,
      puntuacionMinimaSupervisor: 60,
      nivelGravedadHumano: 2,
      minutosCaducidad: 30,
      actualizadaEn: "",
      actualizadaPor: "",
    },
    lecciones: [],
    servicios: {},
  };
}

describe("puntoEnZona", () => {
  it("dentro y fuera de un recuadro", () => {
    expect(puntoEnZona({ lat: 40.44, lon: -4.99 }, RECUADRO.puntos)).toBe(true);
    expect(puntoEnZona({ lat: 41.6, lon: 2.1 }, RECUADRO.puntos)).toBe(false);
    expect(puntoEnZona({ lat: 40.5, lon: -5.31 }, RECUADRO.puntos)).toBe(false); // justo fuera por el oeste
  });

  it("respeta la concavidad de un lazo (la muesca de la L queda fuera)", () => {
    const dentro = crearPruebaZona(LAZO_L.puntos);
    expect(dentro({ lat: 2, lon: 2 })).toBe(true);
    expect(dentro({ lat: 2, lon: 8 })).toBe(true);
    expect(dentro({ lat: 8, lon: 2 })).toBe(true);
    expect(dentro({ lat: 8, lon: 8 })).toBe(false);
  });

  it("con menos de 3 vértices nada está dentro", () => {
    expect(puntoEnZona({ lat: 0, lon: 0 }, [[0, 0], [1, 1]])).toBe(false);
  });

  it("límites de la zona", () => {
    expect(limitesZona(RECUADRO)).toEqual([
      [40.2, -5.3],
      [40.8, -4.5],
    ]);
  });
});

describe("filtrarSnapshotPorZona", () => {
  it("sin zona devuelve el mismo snapshot", () => {
    const s = snapshot();
    expect(filtrarSnapshotPorZona(s, null)).toBe(s);
    expect(filtrarSnapshotPorZona(undefined, RECUADRO)).toBeUndefined();
  });

  it("deja solo los focos de la zona y lo que cuelga de ellos", () => {
    const s = snapshot();
    const f = filtrarSnapshotPorZona(s, RECUADRO)!;
    expect(f).not.toBe(s);
    expect(f.incendios.map((i) => i.id)).toEqual(["inc-dentro"]);
    expect(f.clusters.map((c) => c.id)).toEqual(["c-dentro"]);
    expect(f.poblaciones.map((p) => p.nombre)).toEqual(["Navalacruz"]);
    // Las decisiones y eventos de un foco de fuera se van; los generales se quedan.
    expect(f.decisiones.map((d) => d.id)).toEqual(["d-dentro", "d-general"]);
    expect(f.eventos.map((e) => e.id)).toEqual(["ev-dentro", "ev-sistema"]);
  });

  it("las unidades siguen a su foco; las libres, a su posición", () => {
    const f = filtrarSnapshotPorZona(snapshot(), RECUADRO)!;
    expect(f.unidades.map((u) => u.id)).toEqual(["u-asignada-dentro", "u-base-dentro"]);
  });

  it("lo que solo tiene posición (hospitales, satélite) se filtra por ella", () => {
    const f = filtrarSnapshotPorZona(snapshot(), RECUADRO)!;
    expect(f.hospitales.map((h) => h.id)).toEqual(["h-dentro"]);
    expect(f.focosSatelite.map((x) => x.id)).toEqual(["s-dentro"]);
  });

  it("un foco cuenta si su perímetro entra en la zona aunque el centro quede fuera", () => {
    const s = snapshot();
    // Centro justo al norte del recuadro, con un vértice del perímetro dentro.
    s.incendios = [incendio({ id: "inc-borde", centro: { lat: 40.85, lon: -4.9 }, perimetro: [[40.9, -4.9], [40.79, -4.9], [40.9, -4.8]] })];
    const f = filtrarSnapshotPorZona(s, RECUADRO)!;
    expect(f.incendios.map((i) => i.id)).toEqual(["inc-borde"]);
  });

  it("conserva las referencias de lo que no cambia y no toca agentes, lecciones ni reloj", () => {
    const s = snapshot();
    const f = filtrarSnapshotPorZona(s, RECUADRO)!;
    expect(f.agentes).toBe(s.agentes);
    expect(f.lecciones).toBe(s.lecciones);
    expect(f.camaras).toBe(s.camaras); // vacía: no se ha quitado nada
    expect(f.reloj).toBe(s.reloj);
    expect(f.ejecucion).toBe(s.ejecucion);
    expect(f.politica).toBe(s.politica);
  });

  it("si todo cae dentro devuelve el mismo objeto", () => {
    const s = snapshot();
    const todaEspana: ZonaSeleccion = { tipo: "recuadro", puntos: [[27, -19], [27, 5], [44, 5], [44, -19]], creadaEn: 3 };
    expect(filtrarSnapshotPorZona(s, todaEspana)).toBe(s);
  });
});

describe("zonaValida", () => {
  it("acepta lo guardado y rechaza basura", () => {
    expect(zonaValida(RECUADRO)).toEqual(RECUADRO);
    expect(zonaValida(null)).toBeNull();
    expect(zonaValida({ tipo: "circulo", puntos: RECUADRO.puntos })).toBeNull();
    expect(zonaValida({ tipo: "lazo", puntos: [[0, 0], [1, 1]] })).toBeNull();
    expect(zonaValida({ tipo: "lazo", puntos: [[0, 0], [1, "x"], [2, 2]] })).toBeNull();
    // Sin `creadaEn` se le pone uno (lo guardado por versiones anteriores sigue valiendo).
    expect(zonaValida({ tipo: "lazo", puntos: LAZO_L.puntos })?.creadaEn).toEqual(expect.any(Number));
  });
});
