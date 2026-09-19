// Pruebas de lib/motor/saneamientoEspana.ts · lo heredado fuera de España se
// descarta o se elimina; lo de dentro no se toca. DUEÑO: sesión 2026-09-19.
// Sin red: el cierre del foco se inyecta (no pasa por el orquestador ni OSRM).
import { beforeEach, describe, expect, it } from "vitest";
import type { Camara, FocoSatelite, Hospital, Observacion } from "@/lib/dominio/tipos";
import { Estado } from "@/lib/motor/estado";
import { QUIEN_SANEAMIENTO, describirSaneamiento, sanearFueraEspana } from "@/lib/motor/saneamientoEspana";
import { incendio, poblacion, unidad } from "./ayudas/dominio";

const AVILA = { lat: 40.6566, lon: -4.6818 };
const ARGEL = { lat: 36.7538, lon: 3.0588 };
const SETUBAL = { lat: 38.5244, lon: -8.8882 };
const ELVAS = { lat: 38.881, lon: -7.163 };
const BADAJOZ = { lat: 38.8794, lon: -6.9707 };

function observacion(id: string, punto?: { lat: number; lon: number }, impacto?: Observacion["impacto"]): Observacion {
  return { id, canal: "web", recibidaEn: new Date().toISOString(), texto: "humo", punto, impacto };
}

function camara(id: string, punto: { lat: number; lon: number }): Camara {
  return { id, nombre: id, punto, vigilada: false } as Camara;
}

function hospital(id: string, punto: { lat: number; lon: number }): Hospital {
  return { id, nombre: id, punto, tipo: "hospital" } as Hospital;
}

function focoSatelite(id: string, punto: { lat: number; lon: number }): FocoSatelite {
  return { id, punto, fuente: "VIIRS_SNPP", frp: 5, confianza: "nominal", fechaHora: new Date().toISOString(), diaNoche: "D" };
}

describe("sanearFueraEspana", () => {
  let estado: Estado;
  beforeEach(() => {
    estado = new Estado();
  });

  it("descarta los focos abiertos fuera y deja los de dentro (incluida la frontera)", async () => {
    const dentro = incendio({ id: "inc-avila", centro: AVILA, estado: "activo" });
    const frontera = incendio({ id: "inc-badajoz", centro: BADAJOZ, estado: "confirmado" });
    const argel = incendio({ id: "inc-argel", centro: ARGEL, estado: "activo" });
    const setubal = incendio({ id: "inc-setubal", centro: SETUBAL, estado: "detectado" });
    const yaCerrado = incendio({ id: "inc-elvas", centro: ELVAS, estado: "extinguido" });
    for (const i of [dentro, frontera, argel, setubal, yaCerrado]) estado.guardar(estado.incendios, i);

    const cerrados: string[] = [];
    const r = await sanearFueraEspana(estado, {
      forzar: true,
      cerrar: async (id, quien) => {
        expect(quien).toBe(QUIEN_SANEAMIENTO);
        cerrados.push(id);
        estado.actualizar(estado.incendios, id, { estado: "descartado" });
      },
    });

    expect(r?.focos).toBe(2);
    expect(cerrados.sort()).toEqual(["inc-argel", "inc-setubal"]);
    expect(estado.incendios.get("inc-avila")?.estado).toBe("activo");
    expect(estado.incendios.get("inc-badajoz")?.estado).toBe("confirmado");
    expect(estado.incendios.get("inc-elvas")?.estado).toBe("extinguido");
    expect(estado.eventos.some((e) => e.incendioId === "inc-argel" && /fuera de España/.test(e.mensaje))).toBe(true);
  });

  it("si el cierre ordenado falla, el foco queda descartado igualmente", async () => {
    estado.guardar(estado.incendios, incendio({ id: "inc-argel", centro: ARGEL, estado: "activo" }));
    const r = await sanearFueraEspana(estado, {
      forzar: true,
      cerrar: async () => {
        throw new Error("OSRM caído");
      },
    });
    expect(r?.focos).toBe(1);
    expect(estado.incendios.get("inc-argel")?.estado).toBe("descartado");
  });

  it("elimina unidades con base fuera, pueblos, hospitales, cámaras y satélite fuera; marca avisos como ruido", async () => {
    estado.guardar(estado.unidades, unidad("bomberos", { id: "u-avila", base: { nombre: "Parque Ávila", punto: AVILA }, posicion: AVILA }));
    estado.guardar(estado.unidades, unidad("bomberos", { id: "u-argel", base: { nombre: "Caserne Alger", punto: ARGEL }, posicion: ARGEL }));
    estado.guardar(estado.poblaciones, poblacion("Navaluenga", 5, 90, { id: "p-dentro", centro: AVILA }));
    estado.guardar(estado.poblaciones, poblacion("Elvas", 5, 90, { id: "p-elvas", centro: ELVAS }));
    estado.guardar(estado.hospitales, hospital("h-dentro", AVILA));
    estado.guardar(estado.hospitales, hospital("h-setubal", SETUBAL));
    estado.guardar(estado.camaras, camara("c-dentro", BADAJOZ));
    estado.guardar(estado.camaras, camara("c-fuera", ELVAS));
    estado.guardar(estado.focosSatelite, focoSatelite("s-dentro", AVILA));
    estado.guardar(estado.focosSatelite, focoSatelite("s-fuera", ARGEL));
    estado.guardar(estado.observaciones, observacion("o-dentro", AVILA));
    estado.guardar(estado.observaciones, observacion("o-sin-punto"));
    estado.guardar(estado.observaciones, observacion("o-fuera", SETUBAL));
    estado.guardar(estado.observaciones, observacion("o-fuera-ya-ruido", SETUBAL, "ruido"));

    const r = await sanearFueraEspana(estado, { forzar: true });

    expect(r).toEqual({ focos: 0, unidades: 1, poblaciones: 1, hospitales: 1, camaras: 1, satelite: 1, observaciones: 1 });
    expect([...estado.unidades.keys()]).toEqual(["u-avila"]);
    expect([...estado.poblaciones.keys()]).toEqual(["p-dentro"]);
    expect([...estado.hospitales.keys()]).toEqual(["h-dentro"]);
    expect([...estado.camaras.keys()]).toEqual(["c-dentro"]);
    expect([...estado.focosSatelite.keys()]).toEqual(["s-dentro"]);
    expect(estado.observaciones.get("o-fuera")?.impacto).toBe("ruido");
    expect(estado.observaciones.get("o-fuera")?.verificacion).toMatch(/fuera de España/);
    expect(estado.observaciones.get("o-dentro")?.impacto).toBeUndefined();
    expect(estado.observaciones.get("o-sin-punto")?.impacto).toBeUndefined();
    expect(estado.eventos.at(-1)?.mensaje).toContain("Saneamiento");
  });

  it("con todo dentro no registra ningún evento", async () => {
    estado.guardar(estado.incendios, incendio({ id: "inc-avila", centro: AVILA, estado: "activo" }));
    const antes = estado.eventos.length;
    const r = await sanearFueraEspana(estado, { forzar: true });
    expect(r).toEqual({ focos: 0, unidades: 0, poblaciones: 0, hospitales: 0, camaras: 0, satelite: 0, observaciones: 0 });
    expect(estado.eventos.length).toBe(antes);
  });

  it("sin `forzar` deja un minuto entre pasadas", async () => {
    await sanearFueraEspana(estado, { forzar: true });
    expect(await sanearFueraEspana(estado)).toBeUndefined();
  });
});

describe("describirSaneamiento", () => {
  it("cuenta en singular y plural y omite los ceros", () => {
    expect(describirSaneamiento({ focos: 1, unidades: 3, poblaciones: 0, hospitales: 0, camaras: 0, satelite: 12, observaciones: 1 })).toBe(
      "1 foco, 3 unidades, 12 detecciones de satélite, 1 aviso",
    );
  });
});
