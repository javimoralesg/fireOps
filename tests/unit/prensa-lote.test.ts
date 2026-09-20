// =====================================================================
// F4 · prensa y redes analizan por lote.
// Prueba de CLASE 1: sin red, sin IA.
//
// Antes era UNA llamada por artículo (hasta 6 por ciclo, cada 180 s),
// reenviando en cada una el mismo prompt de sistema. Agrupar aquí es seguro
// porque el análisis de un titular no depende del anterior.
//
// LO QUE NO SE AGRUPA, y esta prueba lo deja escrito: el verificador. Ese
// procesa uno a uno A PROPÓSITO, porque un aviso puede crear el foco que el
// siguiente debe confirmar. Agruparlo reintroduciría el bug de "dos avisos
// del mismo fuego abren dos focos" que ya está arreglado.
// DUEÑO: constructor L (escrito en la fase F4 de la migración).
// =====================================================================
import { describe, expect, it } from "vitest";
import { esquemaLote } from "@/lib/agentes/percepcion/prensaRedes";
import { verificador } from "@/lib/agentes/analisis/verificador";
import { esquemaJson } from "@/lib/ia/llm";

describe("el esquema del lote pide una extracción por artículo, con su id", () => {
  it("acepta varias extracciones identificadas", () => {
    const r = esquemaLote.safeParse({
      extracciones: [
        { id: "a1", esIncendio: true, situacion: "activo", municipio: "Navalacruz", provincia: "Ávila", resumen: "Incendio activo", gravedad: "grave", fiabilidad: 0.9, areaHa: 120, nivelDeclarado: 1, mediosMencionados: "UME" },
        { id: "b2", esIncendio: false, situacion: "desconocido", municipio: "", provincia: "", resumen: "No es un incendio forestal", gravedad: "leve", fiabilidad: 0.4, areaHa: null, nivelDeclarado: null, mediosMencionados: "" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rechaza una extracción sin id: sin id no se puede devolver al artículo", () => {
    const sinId = { esIncendio: true, situacion: "activo", municipio: "", provincia: "", resumen: "x", gravedad: "leve", fiabilidad: 0.5, areaHa: null, nivelDeclarado: null, mediosMencionados: "" };
    expect(esquemaLote.safeParse({ extracciones: [sinId] }).success).toBe(false);
  });

  it("un lote vacío es válido: puede no haber nada que extraer", () => {
    expect(esquemaLote.safeParse({ extracciones: [] }).success).toBe(true);
  });

  it("se endurece bien para el modo strict del proveedor", () => {
    // Aquí se ve para qué sirvió exportar `esquemaJson` en la fase F0.
    const js = esquemaJson(esquemaLote) as Record<string, unknown>;
    expect(js.additionalProperties).toBe(false);
    const items = ((js.properties as Record<string, Record<string, unknown>>).extracciones.items) as Record<string, unknown>;
    expect(items.additionalProperties).toBe(false);
    expect(items.required).toEqual(expect.arrayContaining(["id", "esIncendio", "municipio", "gravedad"]));
  });
});

describe("el verificador NO se agrupa, y es a propósito", () => {
  it("sigue despertando aviso a aviso", () => {
    expect(verificador.despiertaCon).toEqual(expect.arrayContaining(["observacion", "satelite", "camara_positiva"]));
  });

  it("su código deja escrito por qué procesa uno a uno", async () => {
    // Si alguien agrupa el verificador en el futuro, que al menos tenga que
    // borrar esta prueba y leer el motivo.
    const fuente = await import("node:fs/promises").then((fs) => fs.readFile("lib/agentes/analisis/verificador.ts", "utf8"));
    expect(fuente).toContain("el anterior puede haber");
    expect(fuente).toContain("dos avisos del mismo fuego en el mismo ciclo abrían dos focos");
  });
});
