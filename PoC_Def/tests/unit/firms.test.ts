// Pruebas de lib/fuentes/firms.ts · agrupación y reconocimiento de fuentes
// estáticas (sesión riesgo-fundado, 2026-09-19). Deterministas y SIN red.
import { describe, expect, it } from "vitest";
import type { FocoSatelite } from "@/lib/dominio/tipos";
import { DIAS_FUENTE_ESTATICA, MAX_DIAS_FIRMS, agruparFocos, diasConDeteccion, esFuenteEstatica } from "@/lib/fuentes/firms";

/** Píxel VIIRS en (lat, lon) el día `fecha` (YYYY-MM-DD). */
function px(lat: number, lon: number, fecha: string, extra: Partial<FocoSatelite> = {}): FocoSatelite {
  return {
    id: `firms:${lat},${lon}:${fecha}`,
    punto: { lat, lon },
    fuente: "VIIRS_NOAA20",
    frp: 3,
    confianza: "nominal",
    fechaHora: `${fecha}T02:30:00.000Z`,
    diaNoche: "N",
    ...extra,
  };
}

// La refinería de Tarragona (la Pobla de Mafumet) tal y como la ve FIRMS: cada
// noche un puñado de píxeles en el mismo sitio.
const REFINERIA = { lat: 41.182, lon: 1.227 };
const MONTE = { lat: 40.293, lon: -4.219 };

describe("fuentes estáticas de FIRMS", () => {
  const historico = [
    px(REFINERIA.lat, REFINERIA.lon, "2026-09-15"),
    px(REFINERIA.lat + 0.004, REFINERIA.lon, "2026-09-17"),
    px(REFINERIA.lat, REFINERIA.lon + 0.005, "2026-09-19"),
    px(REFINERIA.lat, REFINERIA.lon, "2026-09-19"), // segundo píxel el mismo día: no cuenta como otro día
    px(MONTE.lat, MONTE.lon, "2026-09-19"),
    px(MONTE.lat + 0.003, MONTE.lon, "2026-09-19"),
  ];

  it("cuenta días distintos con detección a menos de 2 km, no píxeles", () => {
    expect(diasConDeteccion(REFINERIA, historico)).toBe(3);
    expect(diasConDeteccion(MONTE, historico)).toBe(1);
    expect(diasConDeteccion({ lat: 43.0, lon: -3.0 }, historico)).toBe(0);
  });

  it("un punto visto en ≥ 3 de los últimos días es fuente estática; un fuego de hoy no", () => {
    expect(DIAS_FUENTE_ESTATICA).toBe(3);
    expect(MAX_DIAS_FIRMS).toBe(5);
    expect(esFuenteEstatica(REFINERIA, historico)).toBe(true);
    expect(esFuenteEstatica(MONTE, historico)).toBe(false);
  });

  it("dos días no bastan: una quema de dos noches seguidas sigue mereciendo aviso", () => {
    const dosDias = [px(MONTE.lat, MONTE.lon, "2026-09-18"), px(MONTE.lat, MONTE.lon, "2026-09-19")];
    expect(esFuenteEstatica(MONTE, dosDias)).toBe(false);
  });

  it("sin histórico nada es estático", () => {
    expect(esFuenteEstatica(REFINERIA, [])).toBe(false);
  });

  it("agruparFocos junta los píxeles a menos de 2 km y suma la potencia", () => {
    const hoy = historico.filter((f) => f.fechaHora.startsWith("2026-09-19"));
    const grupos = agruparFocos(hoy, 2);
    expect(grupos).toHaveLength(2);
    expect(grupos.every((g) => g.focos.length === 2 && g.frpTotal === 6)).toBe(true);
  });
});
