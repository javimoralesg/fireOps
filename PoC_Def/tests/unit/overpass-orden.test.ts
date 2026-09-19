// =====================================================================
// Overpass · el orden de los espejos se corrige solo.
// Prueba de CLASE 1: sin red (no se consulta ningún espejo de verdad).
//
// Por qué existe. La lista de espejos estaba ordenada "por salud medida",
// a mano, y caducó en horas:
//
//   2026-09-19 (constructor T): maps.mail.ru era el único vivo → primero,
//     con tope de 26 s. overpass-api.de "rechaza la conexión".
//   2026-09-19, más tarde: medido contra los tres, justo al revés —
//     maps.mail.ru se cuelga >30 s, private.coffee se cuelga, y
//     overpass-api.de contesta en 1,5 s.
//
// Con la lista caducada, CADA consulta empezaba esperando 26 s a un muerto.
// Un proceso recién arrancado no cargaba el entorno de un foco en 90 s y el
// foco se quedaba con 0 pueblos; uno con horas de vida iba bien porque su
// cortacircuitos ya había aprendido. En una demo, arrancar en frío era el
// peor escenario posible.
//
// Lo que se comprueba aquí es que eso no puede repetirse: el orden sale de
// la latencia medida, no de lo que alguien escribió hace dos semanas.
// DUEÑO: constructor L (escrito en la fase F3 de la migración).
// =====================================================================
import { beforeEach, describe, expect, it } from "vitest";
import { latenciasOverpass, servidoresOverpass } from "@/lib/fuentes/overpass";

type Global = typeof globalThis & {
  __atalayaOverpassLatencias?: Map<string, { latenciaMs: number; en: number }>;
  __atalayaOverpassMuertos?: Map<string, { hasta: number; motivo: string; fallos: number }>;
};
const g = globalThis as Global;

const anotar = (host: string, latenciaMs: number) =>
  (g.__atalayaOverpassLatencias ??= new Map()).set(host, { latenciaMs, en: Date.now() });

beforeEach(() => {
  g.__atalayaOverpassLatencias = new Map();
  g.__atalayaOverpassMuertos = new Map();
});

describe("sin haber probado nada, se respeta la semilla", () => {
  it("el primero es el espejo que se midió sano al escribir el código", () => {
    // Si algún día hay que cambiar la semilla, que sea con una medida delante.
    expect(latenciasOverpass()[0].host).toBe("overpass-api.de");
  });

  it("los tres espejos siguen en la lista", () => {
    expect(latenciasOverpass().map((s) => s.host).sort()).toEqual(
      ["maps.mail.ru", "overpass-api.de", "overpass.private.coffee"].sort(),
    );
  });

  it("ninguno tiene latencia todavía", () => {
    for (const s of latenciasOverpass()) expect(s.latenciaMs).toBeUndefined();
  });
});

describe("el que responde se pone delante", () => {
  it("un espejo con latencia medida adelanta a los que no se han probado", () => {
    anotar("overpass.private.coffee", 900);
    expect(latenciasOverpass()[0].host).toBe("overpass.private.coffee");
  });

  it("entre varios medidos, manda el más rápido", () => {
    anotar("maps.mail.ru", 23_000);
    anotar("overpass-api.de", 1_500);
    anotar("overpass.private.coffee", 8_000);

    expect(latenciasOverpass().map((s) => s.host)).toEqual([
      "overpass-api.de",
      "overpass.private.coffee",
      "maps.mail.ru",
    ]);
  });

  it("el caso real de hoy: el orden se da la vuelta solo", () => {
    // La semilla pone overpass-api.de primero. Si mañana se cae y el que
    // responde es maps.mail.ru, el orden cambia sin tocar una línea.
    anotar("maps.mail.ru", 7_000);
    expect(latenciasOverpass()[0].host).toBe("maps.mail.ru");
  });

  it("expone cuándo se midió, para poder desconfiar de un dato viejo", () => {
    anotar("overpass-api.de", 1_500);
    const medido = latenciasOverpass().find((s) => s.host === "overpass-api.de");
    expect(medido?.latenciaMs).toBe(1_500);
    expect(medido?.medidaHaceS).toBeGreaterThanOrEqual(0);
  });
});

describe("el cortacircuitos sigue informando aparte", () => {
  it("sin fallos, los tres constan como vivos", () => {
    for (const s of servidoresOverpass()) expect(s.vivo).toBe(true);
  });

  it("un espejo en cortacircuitos se declara caído con su motivo y su cuenta atrás", () => {
    g.__atalayaOverpassMuertos!.set("maps.mail.ru", { hasta: Date.now() + 120_000, motivo: "504 Gateway Time-out", fallos: 3 });
    const caido = servidoresOverpass().find((s) => s.host === "maps.mail.ru");

    expect(caido?.vivo).toBe(false);
    expect(caido?.motivo).toContain("504");
    expect(caido?.vuelveEnS).toBeGreaterThan(0);
    // Nada inventado: si está caído, se dice y se dice por qué.
    expect(caido?.vuelveEnS).toBeLessThanOrEqual(120);
  });
});
