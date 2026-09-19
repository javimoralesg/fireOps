// Pruebas de lib/simulacion/contencion.ts (extinción realista, constructor K).
// DUEÑO: constructor L.
import { describe, expect, it } from "vitest";
import {
  LLUVIA_QUE_APAGA_MM,
  MINUTOS_CONTROLADO_A_EXTINGUIDO,
  MINUTOS_ESTABILIZADO_A_CONTROLADO,
  aporteDeUnidad,
  calcularContencion,
  esVentanaAerea,
  factorAtaque,
  factorExtincion,
  factorVientoLinea,
  hayMediosAereos,
  horaDeMundo,
  minutosEntre,
  tocaDeclararControlado,
  tocaDeclararExtinguido,
} from "@/lib/simulacion/contencion";
import { perimetroM } from "@/lib/simulacion/geometria";
import { propagar } from "@/lib/simulacion/propagacion";
import { accion, decision, incendio, meteo, unidad } from "./ayudas/dominio";

/** Foco ya crecido (perímetro de varios km) para que la contención tarde. */
function focoCrecido() {
  const base = incendio();
  const r = propagar(base, 60);
  return incendio({ perimetro: r.perimetro, areaHa: r.areaHa, frente: r.frente });
}

describe("factores de la línea de control", () => {
  it("el viento hasta 30 km/h no penaliza; por encima sí, con suelo en 0,2", () => {
    expect(factorVientoLinea(0)).toBe(1);
    expect(factorVientoLinea(30)).toBe(1);
    expect(factorVientoLinea(50)).toBeCloseTo(0.55, 2);
    expect(factorVientoLinea(100)).toBe(0.2);
  });

  it("el ataque directo en un foco pequeño rinde 2,5× y en uno grande 1×", () => {
    // Los cortes concretos los afina el constructor K; aquí se fija la FORMA:
    // meseta alta para focos pequeños, meseta baja para grandes, y monótona.
    expect(factorAtaque(0)).toBe(2.5);
    expect(factorAtaque(500)).toBe(2.5);
    expect(factorAtaque(50_000)).toBe(1);
    const serie = [0, 1000, 2000, 3000, 4000, 6000, 10_000].map(factorAtaque);
    for (let i = 1; i < serie.length; i++) expect(serie[i]).toBeLessThanOrEqual(serie[i - 1]);
    expect(Math.min(...serie)).toBe(1);
    expect(Math.max(...serie)).toBe(2.5);
  });

  it("una BRIF abre más línea que una autobomba, y la guardia civil ninguna", () => {
    const brif = aporteDeUnidad(unidad("brif", { dotacion: { personas: 12, vehiculos: 1 } }), "matorral", 10, 2000);
    const bomberos = aporteDeUnidad(unidad("bomberos", { dotacion: { personas: 5, vehiculos: 1 } }), "matorral", 10, 2000);
    const gc = aporteDeUnidad(unidad("guardia_civil"), "matorral", 10, 2000);
    expect(brif.ritmoMmin).toBeGreaterThan(bomberos.ritmoMmin);
    expect(gc.ritmoMmin).toBe(0);
    expect(gc.motivo).toContain("no construye línea");
  });

  it("los medios aéreos no construyen línea (enfrían la cabeza)", () => {
    expect(aporteDeUnidad(unidad("medios_aereos"), "matorral", 10, 2000).ritmoMmin).toBe(0);
  });

  it("abrir línea cuesta menos en bosque que en pasto (el pasto se reaviva)", () => {
    const enBosque = aporteDeUnidad(unidad("brif"), "bosque", 10, 2000).ritmoMmin;
    const enPasto = aporteDeUnidad(unidad("brif"), "pasto", 10, 2000).ritmoMmin;
    expect(enPasto).toBeGreaterThan(enBosque);
  });
});

describe("calcularContencion", () => {
  it("sin unidades trabajando no se controla nada", () => {
    const r = calcularContencion(focoCrecido(), [], 60);
    expect(r.contencion.fraccion).toBe(0);
    expect(r.contencion.ritmoMmin).toBe(0);
    expect(r.contencion.unidadesTrabajando).toBe(0);
  });

  it("solo cuentan las unidades EN INTERVENCIÓN sobre ESE foco", () => {
    const foco = focoCrecido();
    const unidades = [
      unidad("brif", { id: "u1", estado: "en_ruta" }),
      unidad("brif", { id: "u2", estado: "en_intervencion", incendioId: "otro-foco" }),
      unidad("brif", { id: "u3", estado: "en_intervencion", incendioId: foco.id }),
    ];
    const r = calcularContencion(foco, unidades, 30);
    expect(r.contencion.unidadesTrabajando).toBe(1);
    expect(r.aportes.map((a) => a.unidadId)).toEqual(["u3"]);
  });

  it("la línea se acumula entre pasos y nunca supera el perímetro total", () => {
    const foco = focoCrecido();
    const unidades = [unidad("maquinaria", { id: "m1", dotacion: { personas: 2, vehiculos: 2 } })];
    let actual = foco;
    for (let i = 0; i < 40; i++) {
      const r = calcularContencion(actual, unidades, 30);
      actual = { ...actual, contencion: r.contencion };
      expect(r.contencion.perimetroControladoM).toBeLessThanOrEqual(r.contencion.perimetroTotalM + 0.01);
      expect(r.contencion.fraccion).toBeGreaterThanOrEqual(0);
      expect(r.contencion.fraccion).toBeLessThanOrEqual(1);
    }
    expect(actual.contencion!.fraccion).toBeCloseTo(1, 2);
  });

  it("el perímetro total sale de la geometría real del foco", () => {
    const foco = focoCrecido();
    const r = calcularContencion(foco, [], 10);
    expect(r.contencion.perimetroTotalM).toBeCloseTo(perimetroM(foco.perimetro), 0);
  });

  it("más medios cierran el perímetro antes", () => {
    const foco = focoCrecido();
    const uno = calcularContencion(foco, [unidad("brif", { id: "a" })], 60).contencion.fraccion;
    const tres = calcularContencion(
      foco,
      [unidad("brif", { id: "a" }), unidad("brif", { id: "b" }), unidad("maquinaria", { id: "c" })],
      60,
    ).contencion.fraccion;
    expect(tres).toBeGreaterThan(uno);
  });

  it("la explicación es legible para la sala", () => {
    const r = calcularContencion(focoCrecido(), [unidad("brif", { id: "a" })], 60);
    expect(typeof r.contencion.explicacion).toBe("string");
    expect(r.contencion.explicacion!.length).toBeGreaterThan(10);
  });
});

describe("factorExtincion · efecto sobre la propagación", () => {
  it("sin contención el factor es 1 (el fuego va a su aire)", () => {
    const d = factorExtincion(incendio());
    expect(d.factor).toBe(1);
    expect(d.explicacion).toContain("sin efecto");
  });

  it("el factor cae con la fracción controlada, según (1 − f)^1,5", () => {
    const conMitad = factorExtincion(
      incendio({ contencion: { perimetroTotalM: 1000, perimetroControladoM: 500, fraccion: 0.5, ritmoMmin: 5, unidadesTrabajando: 1, mediosAereos: false, calculadoEn: "2026-09-19T14:00:00.000Z" } }),
    );
    expect(conMitad.factorContencion).toBeCloseTo(Math.pow(0.5, 1.5), 3);
    expect(conMitad.factor).toBeLessThan(0.4);
  });

  it("perímetro cerrado del todo → factor 0: el fuego deja de avanzar", () => {
    const d = factorExtincion(
      incendio({ contencion: { perimetroTotalM: 1000, perimetroControladoM: 1000, fraccion: 1, ritmoMmin: 5, unidadesTrabajando: 2, mediosAereos: false, calculadoEn: "2026-09-19T14:00:00.000Z" } }),
    );
    expect(d.factor).toBe(0);
    expect(propagar(incendio(), 60, d.factor).frente?.velocidadMmin).toBe(0);
  });

  it("los medios aéreos solo cuentan de día y con viento < 40 km/h", () => {
    const base = incendio({ meteo: meteo({ vientoKmh: 10, rachasKmh: 12 }) });
    const deDia = factorExtincion(base, { mediosAereos: true, ahoraMundo: "2026-09-19T12:00:00.000Z" });
    const deNoche = factorExtincion(base, { mediosAereos: true, ahoraMundo: "2026-09-19T02:00:00.000Z" });
    const conViento = factorExtincion(incendio({ meteo: meteo({ vientoKmh: 60, rachasKmh: 70 }) }), {
      mediosAereos: true,
      ahoraMundo: "2026-09-19T12:00:00.000Z",
    });
    expect(deDia.aereosOperativos).toBe(true);
    expect(deDia.factorAereos).toBeLessThan(1);
    expect(deNoche.aereosOperativos).toBe(false);
    expect(deNoche.factorAereos).toBe(1);
    expect(conViento.aereosOperativos).toBe(false);
    expect(conViento.explicacion).toContain("viento");
  });

  it("una lluvia mayor de 5 mm en 24 h deja el avance en el 20 %", () => {
    const d = factorExtincion(incendio(), { lluvia24Mm: LLUVIA_QUE_APAGA_MM + 1 });
    expect(d.factorLluvia).toBe(0.2);
    expect(d.explicacion).toContain("lluvia");
  });
});

describe("medios aéreos y ventana operativa", () => {
  it("la ventana diurna es 07:00–21:00 hora de Madrid", () => {
    expect(esVentanaAerea("2026-09-19T10:00:00.000Z")).toBe(true); // 12:00 en Madrid
    expect(esVentanaAerea("2026-09-19T02:00:00.000Z")).toBe(false); // 04:00 en Madrid
    expect(horaDeMundo("2026-09-19T10:00:00.000Z")).toBe(12);
  });

  it("hayMediosAereos los detecta por unidad en ruta/intervención o por acción ejecutada", () => {
    const porUnidad = hayMediosAereos("inc-prueba", [unidad("medios_aereos", { estado: "en_ruta" })], []);
    const porAccion = hayMediosAereos(
      "inc-prueba",
      [],
      [decision([accion("solicitar_medios_aereos", { estado: "ejecutada" })], { incendioId: "inc-prueba" })],
    );
    const sinNada = hayMediosAereos(
      "inc-prueba",
      [unidad("bomberos")],
      [decision([accion("solicitar_medios_aereos", { estado: "pendiente" })], { incendioId: "inc-prueba" })],
    );
    expect(porUnidad).toBe(true);
    expect(porAccion).toBe(true);
    expect(sinNada).toBe(false);
  });
});

describe("hitos de estado del incendio", () => {
  const conHito = (campo: "estabilizadoEn" | "controladoEn", en: string, estado: "estabilizado" | "controlado") =>
    incendio({
      estado,
      contencion: {
        perimetroTotalM: 1000,
        perimetroControladoM: 1000,
        fraccion: 1,
        ritmoMmin: 0,
        unidadesTrabajando: 1,
        mediosAereos: false,
        calculadoEn: en,
        [campo]: en,
      },
    });

  it("tras 60 min de mundo estabilizado toca proponer «controlado»", () => {
    const f = conHito("estabilizadoEn", "2026-09-19T14:00:00.000Z", "estabilizado");
    expect(tocaDeclararControlado(f, "2026-09-19T14:30:00.000Z")).toBe(false);
    expect(tocaDeclararControlado(f, "2026-09-19T15:00:00.000Z")).toBe(true);
    expect(MINUTOS_ESTABILIZADO_A_CONTROLADO).toBe(60);
  });

  it("tras 120 min de mundo controlado toca proponer «extinguido»", () => {
    const f = conHito("controladoEn", "2026-09-19T14:00:00.000Z", "controlado");
    expect(tocaDeclararExtinguido(f, "2026-09-19T15:00:00.000Z")).toBe(false);
    expect(tocaDeclararExtinguido(f, "2026-09-19T16:00:00.000Z")).toBe(true);
    expect(MINUTOS_CONTROLADO_A_EXTINGUIDO).toBe(120);
  });

  it("minutosEntre nunca devuelve negativos ni NaN", () => {
    expect(minutosEntre("2026-09-19T14:00:00Z", "2026-09-19T15:00:00Z")).toBe(60);
    expect(minutosEntre("2026-09-19T15:00:00Z", "2026-09-19T14:00:00Z")).toBe(0);
    expect(minutosEntre(undefined, "2026-09-19T14:00:00Z")).toBe(0);
  });
});
