// Pruebas de lib/dominio/espana.ts · "¿está en España?". DUEÑO: sesión 2026-09-19.
// Referencias: capitales, islas y plazas, y parejas de pueblos a ambos lados
// de la frontera (a 1-5 km unos de otros) para comprobar que el contorno corta
// donde debe. Sin red: el contorno va embebido.
import { describe, expect, it } from "vitest";
import { CAJA_ESPANA, describirFueraEspana, enEspana } from "@/lib/dominio/espana";

const DENTRO: Record<string, [number, number]> = {
  Madrid: [40.4168, -3.7038],
  "Palma (Mallorca)": [39.5696, 2.6502],
  "Maó (Menorca)": [39.8885, 4.2658],
  "Ibiza": [38.9067, 1.4206],
  "Las Palmas de Gran Canaria": [28.1235, -15.4363],
  "Santa Cruz de Tenerife": [28.4636, -16.2518],
  "Valverde (El Hierro)": [27.8096, -17.9158],
  "Arrecife (Lanzarote)": [28.963, -13.5477],
  Ceuta: [35.8894, -5.3198],
  Melilla: [35.2923, -2.9381],
  "Llívia (enclave en Francia)": [42.4636, 1.9811],
  "Badajoz (frontera con Portugal)": [38.8794, -6.9707],
  "Olivenza (frontera con Portugal)": [38.685, -7.101],
  "Ayamonte (frontera con Portugal)": [37.213, -7.404],
  "Tui (frontera con Portugal)": [42.047, -8.644],
  "Irún (frontera con Francia)": [43.3378, -1.7888],
  "La Jonquera (frontera con Francia)": [42.419, 2.874],
  "Puigcerdà (frontera con Francia)": [42.432, 1.928],
  "La Seu d'Urgell (frontera con Andorra)": [42.3582, 1.4574],
  "La Línea de la Concepción (junto a Gibraltar)": [36.1681, -5.3487],
  Tarifa: [36.0143, -5.6044],
};

const FUERA: Record<string, [number, number]> = {
  Lisboa: [38.7223, -9.1393],
  Oporto: [41.1579, -8.6291],
  "Elvas (a 12 km de Badajoz)": [38.881, -7.163],
  "Vila Real de Santo António (frente a Ayamonte)": [37.194, -7.416],
  "Valença (frente a Tui)": [42.0303, -8.6447],
  "Hendaya (frente a Irún)": [43.3583, -1.7742],
  "Le Perthus (frente a La Jonquera)": [42.464, 2.862],
  "Bourg-Madame (frente a Puigcerdà)": [42.433, 1.947],
  Bayona: [43.4929, -1.4748],
  Perpiñán: [42.6887, 2.8948],
  "Andorra la Vella": [42.5063, 1.5218],
  Gibraltar: [36.1408, -5.3536],
  Tánger: [35.7595, -5.834],
  "Nador (junto a Melilla)": [35.1681, -2.9335],
  "Mar de Alborán (alta mar)": [36.5, -3.0],
  "Mar de Alborán alrededor de la isla": [35.9, -3.0],
  "Canal entre Tenerife y La Gomera": [28.1, -17.15],
  "Canal entre Fuerteventura y Lanzarote": [28.8, -13.75],
  "Canal entre Mallorca y Menorca": [39.95, 3.75],
  "Mar alrededor de las Columbretes": [39.85, 0.7],
  "Atlántico (entre Canarias y la península)": [32.0, -12.0],
  "Funchal (Madeira)": [32.6669, -16.9241],
};

describe("enEspana", () => {
  it.each(Object.entries(DENTRO))("%s está dentro", (_, [lat, lon]) => {
    expect(enEspana({ lat, lon })).toBe(true);
  });

  it.each(Object.entries(FUERA))("%s está fuera", (_, [lat, lon]) => {
    expect(enEspana({ lat, lon })).toBe(false);
  });

  it("un punto ausente o no finito cuenta como fuera", () => {
    expect(enEspana(undefined)).toBe(false);
    expect(enEspana(null)).toBe(false);
    expect(enEspana({ lat: Number.NaN, lon: -3.7 })).toBe(false);
    expect(enEspana({ lat: 40.4, lon: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("la caja envolvente va de El Hierro a Menorca y de Melilla al Cantábrico", () => {
    const [[sur, oeste], [norte, este]] = CAJA_ESPANA;
    expect(sur).toBeLessThan(27.5);
    expect(oeste).toBeLessThan(-18.3);
    expect(norte).toBeGreaterThan(43.7);
    expect(este).toBeGreaterThan(4.3);
  });

  it("es rápida: 100.000 comprobaciones en menos de un segundo", () => {
    const t0 = performance.now();
    let dentro = 0;
    for (let i = 0; i < 100_000; i += 1) {
      const lat = 27 + (i % 1000) * 0.017;
      const lon = -19 + Math.floor(i / 1000) * 0.24;
      if (enEspana({ lat, lon })) dentro += 1;
    }
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(dentro).toBeGreaterThan(0);
  });
});

describe("describirFueraEspana", () => {
  it("cita las coordenadas con cuatro decimales y el motivo", () => {
    const texto = describirFueraEspana({ lat: 38.7223, lon: -9.1393 });
    expect(texto).toContain("38.7223, -9.1393");
    expect(texto).toContain("fuera de España");
  });
});
