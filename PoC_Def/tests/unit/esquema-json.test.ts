// =====================================================================
// Endurecimiento del JSON Schema que se manda al proveedor de IA.
// Prueba de CLASE 1 (caracterización exacta): no hay red ni modelo, solo
// la transformación zod → JSON Schema en modo `strict`.
//
// Por qué existe (fase F0 de la migración, fallo L-2 de docs/PRUEBAS.md):
// hasta ahora un error aquí solo se veía cuando una llamada real fallaba
// contra HelmCode. La fase F3 funde coordinador + protección + patrones en
// un único esquema, el más grande del sistema: sin esta red, un fallo de
// endurecimiento aparecería como "el mando no planifica" en mitad de la demo.
// DUEÑO: constructor L (escrito en la fase F0).
// =====================================================================
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { endurecer, esquemaJson } from "@/lib/ia/llm";

/** Lee un nodo del esquema por ruta de propiedades ("a.b" → esquema.properties.a.properties.b). */
function propiedad(esquema: Record<string, unknown>, ruta: string): Record<string, unknown> {
  let nodo = esquema;
  for (const paso of ruta.split(".")) {
    const props = nodo.properties as Record<string, Record<string, unknown>> | undefined;
    if (!props?.[paso]) throw new Error(`No existe la propiedad "${paso}" en la ruta "${ruta}"`);
    nodo = props[paso];
  }
  return nodo;
}

describe("endurecer · lo que exige el modo strict", () => {
  it("todo objeto declara additionalProperties: false", () => {
    const r = endurecer({ type: "object", properties: { a: { type: "string" } } }) as Record<string, unknown>;
    expect(r.additionalProperties).toBe(false);
  });

  it("todo objeto lista TODAS sus propiedades en required, no solo las obligatorias", () => {
    const r = endurecer({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" } },
      required: ["a"],
    }) as Record<string, unknown>;
    expect(r.required).toEqual(["a", "b"]);
  });

  it("baja hasta los objetos anidados", () => {
    const r = endurecer({
      type: "object",
      properties: { dentro: { type: "object", properties: { x: { type: "string" } } } },
    }) as Record<string, unknown>;
    const dentro = propiedad(r, "dentro");
    expect(dentro.additionalProperties).toBe(false);
    expect(dentro.required).toEqual(["x"]);
  });

  it("entra en los elementos de un array", () => {
    const r = endurecer({
      type: "object",
      properties: { lista: { type: "array", items: { type: "object", properties: { y: { type: "number" } } } } },
    }) as Record<string, unknown>;
    const items = propiedad(r, "lista").items as Record<string, unknown>;
    expect(items.additionalProperties).toBe(false);
    expect(items.required).toEqual(["y"]);
  });

  it("quita las palabras clave que el modo strict rechaza", () => {
    const r = endurecer({
      type: "object",
      properties: {
        n: { type: "number", minimum: 0, maximum: 100, multipleOf: 5 },
        s: { type: "string", minLength: 1, maxLength: 20, pattern: "^a", format: "email" },
        l: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true },
      },
      $schema: "https://json-schema.org/draft/2020-12/schema",
    }) as Record<string, unknown>;

    expect(r.$schema).toBeUndefined();
    for (const clave of ["minimum", "maximum", "multipleOf"]) expect(propiedad(r, "n")[clave]).toBeUndefined();
    for (const clave of ["minLength", "maxLength", "pattern", "format"]) expect(propiedad(r, "s")[clave]).toBeUndefined();
    for (const clave of ["minItems", "maxItems", "uniqueItems"]) expect(propiedad(r, "l")[clave]).toBeUndefined();
  });

  it("conserva enum tal cual: es lo que ata al modelo a los valores válidos", () => {
    const r = endurecer({
      type: "object",
      properties: { rumbo: { type: "string", enum: ["cabeza", "cola"] } },
    }) as Record<string, unknown>;
    expect(propiedad(r, "rumbo").enum).toEqual(["cabeza", "cola"]);
  });

  it("no toca lo que no es un objeto", () => {
    expect(endurecer("texto")).toBe("texto");
    expect(endurecer(42)).toBe(42);
    expect(endurecer(null)).toBe(null);
  });

  it("es puro: no muta el esquema que recibe", () => {
    const original = { type: "object", properties: { a: { type: "string", minLength: 3 } } };
    const copia = structuredClone(original);
    endurecer(original);
    expect(original).toEqual(copia);
  });
});

describe("esquemaJson · el esquema que de verdad viaja al proveedor", () => {
  it("convierte un zod con restricciones en un esquema que strict acepta", () => {
    const esquema = z.object({
      titulo: z.string(),
      prioridad: z.number().int().min(1).max(5),
      sectores: z.array(z.object({ nombre: z.string(), rumbo: z.enum(["cabeza", "cola"]) })),
    });
    const r = esquemaJson(esquema);

    expect(r.additionalProperties).toBe(false);
    expect(r.required).toEqual(expect.arrayContaining(["titulo", "prioridad", "sectores"]));
    // Los min/max de zod no sobreviven: strict los rechaza y el rango se sostiene en el prompt.
    expect(propiedad(r, "prioridad").minimum).toBeUndefined();
    expect(propiedad(r, "prioridad").maximum).toBeUndefined();

    const items = propiedad(r, "sectores").items as Record<string, unknown>;
    expect(items.additionalProperties).toBe(false);
    expect(items.required).toEqual(expect.arrayContaining(["nombre", "rumbo"]));
    expect((items.properties as Record<string, Record<string, unknown>>).rumbo.enum).toEqual(["cabeza", "cola"]);
  });

  it("un campo opcional de zod sigue saliendo en required (lo exige strict)", () => {
    const r = esquemaJson(z.object({ obligatorio: z.string(), suelto: z.string().optional() }));
    expect(r.required).toEqual(expect.arrayContaining(["obligatorio", "suelto"]));
  });

  it("no quedan palabras clave prohibidas en ninguna rama del esquema", () => {
    const prohibidas = new Set([
      "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
      "minLength", "maxLength", "pattern", "format", "minItems", "maxItems",
      "uniqueItems", "default", "$schema", "propertyNames", "patternProperties",
      "minProperties", "maxProperties", "examples",
    ]);
    const r = esquemaJson(
      z.object({
        texto: z.string().min(2).max(50),
        lista: z.array(z.object({ n: z.number().min(0) })).min(1),
        anidado: z.object({ dentro: z.object({ f: z.number().int() }) }),
      }),
    );

    const encontradas: string[] = [];
    const recorrer = (nodo: unknown, ruta: string): void => {
      if (Array.isArray(nodo)) return nodo.forEach((n, i) => recorrer(n, `${ruta}[${i}]`));
      if (!nodo || typeof nodo !== "object") return;
      for (const [clave, valor] of Object.entries(nodo as Record<string, unknown>)) {
        if (prohibidas.has(clave)) encontradas.push(`${ruta}.${clave}`);
        recorrer(valor, `${ruta}.${clave}`);
      }
    };
    recorrer(r, "raiz");
    expect(encontradas).toEqual([]);
  });
});
