// Pruebas de lib/motor/estado.ts · versión, notificación coalescida, registro
// de cambios y sellos de identidad. DUEÑO: constructor L (añadidas por P).
import { describe, expect, it } from "vitest";
import type { Incendio, Unidad } from "@/lib/dominio/tipos";
import { Estado } from "@/lib/motor/estado";
import { fundirSnapshot } from "@/lib/cliente/useEstado";

/** Espera a que salga la notificación coalescida (setImmediate). */
const vuelta = () => new Promise<void>((r) => setImmediate(r));

function incendio(id: string, areaHa = 1): Incendio {
  return {
    id,
    nombre: `Foco ${id}`,
    punto: { lat: 40, lon: -4 },
    estado: "activo",
    detectadoEn: "2026-09-19T10:00:00.000Z",
    origen: "manual",
    areaHa,
    nivelGravedad: 1,
    confianza: 0.9,
  } as unknown as Incendio;
}

function unidad(id: string): Unidad {
  return { id, nombre: `Unidad ${id}`, tipo: "brigada", estado: "disponible", base: { lat: 40, lon: -4 } } as unknown as Unidad;
}

describe("tocar / notificación coalescida", () => {
  it("cada mutación sube la versión de forma síncrona", () => {
    const e = new Estado();
    const v = e.version;
    e.guardar(e.incendios, incendio("i1"));
    e.guardar(e.incendios, incendio("i2"));
    expect(e.version).toBe(v + 2);
  });

  it("cien mutaciones seguidas producen UNA sola notificación, con la versión final", async () => {
    const e = new Estado();
    const versiones: number[] = [];
    e.suscribir(() => versiones.push(e.version));
    for (let i = 0; i < 100; i++) e.guardar(e.unidades, unidad(`u${i}`));
    expect(versiones).toHaveLength(0); // aún no ha salido: es asíncrona
    await vuelta();
    expect(versiones).toEqual([e.version]);
  });

  it("la notificación siempre llega, también tras un hueco entre mutaciones", async () => {
    const e = new Estado();
    let avisos = 0;
    e.suscribir(() => { avisos += 1; });
    e.registrarEvento("observacion", "uno");
    await vuelta();
    e.registrarEvento("observacion", "dos");
    await vuelta();
    expect(avisos).toBe(2);
  });

  it("un suscriptor que falla no impide que avisen a los demás", async () => {
    const e = new Estado();
    let bueno = 0;
    e.suscribir(() => { throw new Error("roto"); });
    e.suscribir(() => { bueno += 1; });
    e.marcarServicio("Supabase", true);
    await vuelta();
    expect(bueno).toBe(1);
  });

  it("darse de baja corta los avisos", async () => {
    const e = new Estado();
    let avisos = 0;
    const baja = e.suscribir(() => { avisos += 1; });
    baja();
    e.guardar(e.incendios, incendio("i1"));
    await vuelta();
    expect(avisos).toBe(0);
  });

  it("el snapshot que recibe el suscriptor es legible (perezoso) y con `{real:true}` es el de verdad", async () => {
    const e = new Estado();
    let leido: number | undefined;
    let real: unknown;
    e.suscribir((s) => { leido = s.incendios.length; });
    e.suscribir((s) => { real = s; }, { real: true });
    e.guardar(e.incendios, incendio("i1"));
    await vuelta();
    expect(leido).toBe(1);
    expect(real).toBe(e.snapshot());
  });

  it("`lote` agrupa varias mutaciones en un solo aviso", async () => {
    const e = new Estado();
    let avisos = 0;
    e.suscribir(() => { avisos += 1; });
    e.lote(() => {
      e.guardar(e.incendios, incendio("i1"));
      e.guardar(e.incendios, incendio("i2"));
    });
    await vuelta();
    expect(avisos).toBe(1);
    expect(e.incendios.size).toBe(2);
  });
});

describe("snapshot perezoso y cacheado por versión", () => {
  it("dos llamadas sin mutaciones devuelven el MISMO objeto", () => {
    const e = new Estado();
    e.guardar(e.incendios, incendio("i1"));
    expect(e.snapshot()).toBe(e.snapshot());
  });

  it("una mutación invalida la caché", () => {
    const e = new Estado();
    const antes = e.snapshot();
    e.guardar(e.incendios, incendio("i1"));
    expect(e.snapshot()).not.toBe(antes);
  });

  it("las colecciones que no cambian conservan la referencia del array", () => {
    const e = new Estado();
    e.guardar(e.unidades, unidad("u1"));
    const s1 = e.snapshot();
    e.guardar(e.incendios, incendio("i1"));
    const s2 = e.snapshot();
    expect(s2.unidades).toBe(s1.unidades);
    expect(s2.incendios).not.toBe(s1.incendios);
  });

  it("`snapshotTexto` serializa una sola vez por versión", () => {
    const e = new Estado();
    e.guardar(e.incendios, incendio("i1"));
    const t = e.snapshotTexto();
    expect(e.snapshotTexto()).toBe(t);
    expect(JSON.parse(t).version).toBe(e.version);
  });
});

describe("registro de cambios para la persistencia", () => {
  it("guardar / actualizar / eliminar apuntan colección + id", () => {
    const e = new Estado();
    e.guardar(e.incendios, incendio("i1"));
    e.actualizar(e.incendios, "i1", { areaHa: 9 });
    e.guardar(e.unidades, unidad("u1"));
    e.eliminar(e.unidades, "u1");
    const cambios = e.consumirCambios();
    expect([...(cambios.get("incendios") ?? [])]).toEqual(["i1"]);
    expect([...(cambios.get("unidades") ?? [])]).toEqual(["u1"]);
  });

  it("registrarEvento y marcarServicio también se apuntan", () => {
    const e = new Estado();
    const ev = e.registrarEvento("observacion", "hola");
    e.marcarServicio("AEMET", true);
    const cambios = e.consumirCambios();
    expect(cambios.get("eventos")?.has(ev.id)).toBe(true);
    expect(cambios.get("servicios")?.has("AEMET")).toBe(true);
  });

  it("consumirCambios vacía el registro", () => {
    const e = new Estado();
    e.guardar(e.incendios, incendio("i1"));
    expect(e.consumirCambios().size).toBeGreaterThan(0);
    expect(e.consumirCambios().size).toBe(0);
  });

  it("marcarCambio a mano fuerza el re-sellado del item (mutación en sitio)", () => {
    const e = new Estado();
    const i = incendio("i1");
    e.guardar(e.incendios, i);
    const s1 = e.snapshot();
    i.areaHa = 500; // mutación en sitio: la referencia no cambia
    e.marcarCambio("incendios", "i1");
    e.tocar();
    const s2 = e.snapshot();
    expect(s2.incendios).not.toBe(s1.incendios);
  });
});

describe("fusión en el cliente (conservación de identidad)", () => {
  /** Ida y vuelta por JSON, como hace el navegador con el SSE. */
  const porElCable = (e: Estado) => JSON.parse(e.snapshotTexto()) as ReturnType<Estado["snapshot"]>;

  it("un array sin cambios conserva su referencia", () => {
    const e = new Estado();
    e.guardar(e.unidades, unidad("u1"));
    e.guardar(e.incendios, incendio("i1"));
    const previo = fundirSnapshot(porElCable(e));
    e.actualizar(e.incendios, "i1", { areaHa: 33 });
    const nuevo = fundirSnapshot(porElCable(e), previo);
    expect(nuevo.unidades).toBe(previo.unidades);
    expect(nuevo.incendios).not.toBe(previo.incendios);
  });

  it("un item con el mismo id y sin cambios conserva la misma referencia", () => {
    const e = new Estado();
    e.guardar(e.incendios, incendio("i1"));
    e.guardar(e.incendios, incendio("i2"));
    const previo = fundirSnapshot(porElCable(e));
    e.actualizar(e.incendios, "i2", { areaHa: 77 });
    const nuevo = fundirSnapshot(porElCable(e), previo);
    const antesI1 = previo.incendios.find((i) => i.id === "i1");
    expect(nuevo.incendios.find((i) => i.id === "i1")).toBe(antesI1);
    expect(nuevo.incendios.find((i) => i.id === "i2")).not.toBe(previo.incendios.find((i) => i.id === "i2"));
    expect(nuevo.incendios.find((i) => i.id === "i2")?.areaHa).toBe(77);
  });

  it("reloj, ejecucion, politica y servicios conservan referencia si no cambian", () => {
    const e = new Estado();
    e.marcarServicio("AEMET", true, "ok");
    const previo = fundirSnapshot(porElCable(e));
    e.guardar(e.incendios, incendio("i1"));
    const nuevo = fundirSnapshot(porElCable(e), previo);
    expect(nuevo.servicios).toBe(previo.servicios);
    expect(nuevo.politica).toBe(previo.politica);
    expect(nuevo.ejecucion).toBe(previo.ejecucion);
  });

  it("sin sellos (servidor antiguo) sigue fundiendo por comparación estructural", () => {
    const e = new Estado();
    e.guardar(e.incendios, incendio("i1"));
    const sin = () => {
      const s = porElCable(e) as unknown as Record<string, unknown>;
      delete s.sellos;
      return s as unknown as ReturnType<Estado["snapshot"]>;
    };
    const previo = fundirSnapshot(sin());
    const nuevo = fundirSnapshot(sin(), previo);
    expect(nuevo.incendios).toBe(previo.incendios);
  });

  it("no reutiliza colecciones de una ejecución anterior aunque coincidan versión y sellos", () => {
    const anterior = new Estado();
    anterior.ejecucion = { ...anterior.ejecucion, id: "ejecucion-anterior", nombre: "Anterior" };
    anterior.guardar(anterior.incendios, incendio("fuego-anterior"));
    const previo = fundirSnapshot(porElCable(anterior));

    const siguiente = new Estado();
    siguiente.ejecucion = { ...siguiente.ejecucion, id: "ejecucion-nueva", nombre: "Nueva" };
    siguiente.guardar(siguiente.incendios, incendio("fuego-nuevo"));
    const nuevo = fundirSnapshot(porElCable(siguiente), previo);

    expect(nuevo.ejecucion.id).toBe("ejecucion-nueva");
    expect(nuevo.incendios.map((i) => i.id)).toEqual(["fuego-nuevo"]);
    expect(nuevo.incendios).not.toBe(previo.incendios);
  });

  it("el registro incremental no retiene ids de eventos que el propio estado ya podó", () => {
    const e = new Estado();
    for (let i = 0; i < 6_000; i += 1) e.registrarEvento("sistema", `Evento ${i}`);

    const cambios = e.consumirCambios().get("eventos");
    expect(e.eventos).toHaveLength(5_000);
    expect(cambios?.size).toBeLessThanOrEqual(e.eventos.length);
  });
});
