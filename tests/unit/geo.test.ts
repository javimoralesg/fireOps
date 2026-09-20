// Pruebas de lib/fuentes/geo.ts · geometría esférica. DUEÑO: constructor L.
// Referencias: distancias reales entre capitales (error admitido < 0,5 %).
import { describe, expect, it } from "vitest";
import {
  bbox,
  claveRedondeada,
  destino,
  diferenciaAngular,
  distanciaM,
  gradosATexto,
  haversine,
  interpolarAngulo,
  rumbo,
} from "@/lib/fuentes/geo";

const MADRID = { lat: 40.4168, lon: -3.7038 };
const BARCELONA = { lat: 41.3874, lon: 2.1686 };
const AVILA = { lat: 40.6566, lon: -4.6818 };

describe("haversine", () => {
  it("Madrid–Barcelona ≈ 505 km (±0,5 %)", () => {
    expect(haversine(MADRID, BARCELONA)).toBeCloseTo(504.6, 0);
  });

  it("distancia a uno mismo = 0 y es simétrica", () => {
    expect(haversine(MADRID, MADRID)).toBe(0);
    expect(haversine(MADRID, AVILA)).toBeCloseTo(haversine(AVILA, MADRID), 9);
  });

  it("un grado de latitud ≈ 111,2 km en cualquier longitud", () => {
    expect(haversine({ lat: 40, lon: -3 }, { lat: 41, lon: -3 })).toBeCloseTo(111.2, 0);
  });

  it("distanciaM devuelve metros", () => {
    expect(distanciaM(MADRID, BARCELONA)).toBeCloseTo(haversine(MADRID, BARCELONA) * 1000, 6);
  });
});

describe("rumbo", () => {
  it("hacia el norte es 0°, hacia el este ≈ 90°", () => {
    expect(rumbo({ lat: 40, lon: -3 }, { lat: 41, lon: -3 })).toBeCloseTo(0, 6);
    expect(rumbo({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
  });

  it("Madrid → Barcelona es rumbo nordeste (entre 45° y 90°)", () => {
    const b = rumbo(MADRID, BARCELONA);
    expect(b).toBeGreaterThan(45);
    expect(b).toBeLessThan(90);
  });

  it("siempre devuelve 0..360", () => {
    for (const p of [BARCELONA, AVILA, { lat: -30, lon: 170 }]) {
      const b = rumbo(MADRID, p);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });
});

describe("destino", () => {
  it("10 km al norte sube ~0,0899° de latitud sin mover la longitud", () => {
    const d = destino({ lat: 40, lon: -3 }, 0, 10);
    expect(d.lat).toBeCloseTo(40.0899, 3);
    expect(d.lon).toBeCloseTo(-3, 4);
  });

  it("es la inversa de haversine + rumbo (ida y vuelta < 1 m de error)", () => {
    const d = destino(MADRID, 47.3, 123.4);
    expect(haversine(MADRID, d)).toBeCloseTo(123.4, 2);
    expect(rumbo(MADRID, d)).toBeCloseTo(47.3, 1);
  });

  it("distancia 0 devuelve el mismo punto", () => {
    const d = destino(AVILA, 123, 0);
    expect(haversine(AVILA, d)).toBeLessThan(0.001);
  });
});

describe("gradosATexto", () => {
  it("los cuatro cardinales y un intercardinal", () => {
    expect(gradosATexto(0)).toBe("N");
    expect(gradosATexto(90)).toBe("E");
    expect(gradosATexto(180)).toBe("S");
    expect(gradosATexto(270)).toBe("O");
    expect(gradosATexto(225)).toBe("SO");
    expect(gradosATexto(22.5)).toBe("NNE");
  });

  it("normaliza ángulos fuera de rango", () => {
    expect(gradosATexto(360)).toBe("N");
    expect(gradosATexto(-90)).toBe("O");
    expect(gradosATexto(450)).toBe("E");
  });
});

describe("diferenciaAngular", () => {
  it("nunca pasa de 180 y toma el camino corto", () => {
    expect(diferenciaAngular(10, 350)).toBe(20);
    expect(diferenciaAngular(0, 180)).toBe(180);
    expect(diferenciaAngular(45, 45)).toBe(0);
    expect(diferenciaAngular(350, 10)).toBe(20);
  });
});

describe("interpolarAngulo · interpolación circular", () => {
  it("cruza el norte por el camino corto (350° → 10° pasa por 0°, no por 180°)", () => {
    expect(interpolarAngulo(350, 10, 0.5)).toBeCloseTo(0, 6);
    expect(interpolarAngulo(350, 10, 0.25)).toBeCloseTo(355, 6);
  });

  it("t = 0 y t = 1 devuelven los extremos", () => {
    expect(interpolarAngulo(200, 250, 0)).toBeCloseTo(200, 6);
    expect(interpolarAngulo(200, 250, 1)).toBeCloseTo(250, 6);
  });

  it("el resultado siempre está en 0..360", () => {
    for (const t of [0, 0.3, 0.5, 0.8, 1]) {
      const a = interpolarAngulo(340, 30, t);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(360);
    }
  });
});

describe("bbox", () => {
  it("la caja de 30 km contiene el punto central y es más ancha en longitud que en latitud", () => {
    const [o, s, e, n] = bbox(MADRID, 30);
    expect(MADRID.lon).toBeGreaterThan(o);
    expect(MADRID.lon).toBeLessThan(e);
    expect(MADRID.lat).toBeGreaterThan(s);
    expect(MADRID.lat).toBeLessThan(n);
    expect(e - o).toBeGreaterThan(n - s); // a 40° de latitud
  });

  it("la semialtura en km coincide con el radio pedido (±1 %)", () => {
    const [, s, , n] = bbox(MADRID, 30);
    expect(haversine({ lat: s, lon: MADRID.lon }, { lat: n, lon: MADRID.lon }) / 2).toBeCloseTo(30, 0);
  });
});

describe("claveRedondeada", () => {
  it("dos puntos a menos de la precisión comparten clave de caché", () => {
    expect(claveRedondeada({ lat: 40.44, lon: -4.99 })).toBe(claveRedondeada({ lat: 40.45, lon: -4.98 }));
  });

  it("dos puntos lejanos no la comparten", () => {
    expect(claveRedondeada(MADRID)).not.toBe(claveRedondeada(BARCELONA));
  });
});
