// =====================================================================
// ATALAYA INCENDIOS · Prueba de extremo a extremo de la capa de IA
// ---------------------------------------------------------------------
// DUEÑO: constructor C.
// Ejercita, con llamadas REALES y midiendo latencias: los tres papeles del
// LLM (razonamiento, rápido, visión), la salida estructurada con json_schema,
// los embeddings, y una consulta al grafo de conocimiento.
//
//   npx tsx scripts/probar-ia.ts
//
// Sin clave del proveedor, cada prueba falla con su mensaje: es lo correcto,
// la plataforma no inventa respuestas.
// =====================================================================

import { readFileSync } from "node:fs";
import { z } from "zod";

// Carga .env.local sin dependencias (el script se ejecuta fuera de Next).
export function cargarEnv(ruta = ".env.local"): void {
  try {
    for (const linea of readFileSync(ruta, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linea);
      if (!m) continue;
      const valor = m[2].trim().replace(/^["']|["']$/g, "").replace(/\s+#.*$/, "");
      if (!(m[1] in process.env)) process.env[m[1]] = valor;
    }
  } catch {
    console.warn(`[probar-ia] no encuentro ${ruta}: uso las variables del entorno.`);
  }
}

cargarEnv();

async function main(): Promise<void> {
  const { completarJson, completarTexto, estadisticasLLM, modeloPara, proveedorActivo, proveedorDisponible } = await import(
    "../lib/ia/llm"
  );
  const { DIMENSIONES, estadisticasEmbeddings, incrustarConsulta, incrustarPasajes, modeloEmbeddings, proveedorEmbeddings, similitudCoseno } =
    await import("../lib/ia/embeddings");

  const resultados: { prueba: string; ok: boolean; ms: number; detalle: string }[] = [];

  async function probar(nombre: string, fn: () => Promise<string>): Promise<void> {
    const t0 = Date.now();
    try {
      const detalle = await fn();
      resultados.push({ prueba: nombre, ok: true, ms: Date.now() - t0, detalle });
      console.log(`  ✓ ${nombre} · ${Date.now() - t0} ms · ${detalle}`);
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e);
      resultados.push({ prueba: nombre, ok: false, ms: Date.now() - t0, detalle });
      console.log(`  ✗ ${nombre} · ${Date.now() - t0} ms · ${detalle}`);
    }
  }

  console.log("\n=== Atalaya · prueba de la capa de IA ===");
  console.log(`Proveedor LLM     : ${proveedorActivo()} (disponible: ${proveedorDisponible()})`);
  console.log(`  razonamiento    : ${modeloPara("razonamiento")}`);
  console.log(`  rápido          : ${modeloPara("rapido")}`);
  console.log(`  visión          : ${modeloPara("vision")}`);
  console.log(`Embeddings        : ${proveedorEmbeddings()} / ${modeloEmbeddings()} · ${DIMENSIONES} dimensiones\n`);

  // --- 1. Razonamiento con salida estructurada -------------------------
  const EsquemaDecision = z.object({
    quienOrdena: z.string(),
    requiereAutoridadHumana: z.boolean(),
    justificacion: z.string(),
  });

  await probar("LLM razonamiento · json_schema", async () => {
    const r = await completarJson({
      papel: "razonamiento",
      nombreEsquema: "competencia_evacuacion",
      system: "Eres un asesor de protección civil español. Responde con hechos del ordenamiento español.",
      user: "¿Quién puede ordenar la evacuación de un pueblo en un incendio forestal con el plan en situación operativa 2?",
      esquema: EsquemaDecision,
      maxTokens: 2000,
    });
    return `${r.modelo} → ${r.datos.quienOrdena.slice(0, 80)}`;
  });

  // --- 2. Papel rápido -------------------------------------------------
  const EsquemaTriaje = z.object({
    esIncendio: z.boolean(),
    gravedad: z.enum(["leve", "moderada", "grave", "critica"]),
    municipio: z.string(),
  });

  await probar("LLM rápido · json_schema", async () => {
    const r = await completarJson({
      papel: "rapido",
      nombreEsquema: "triaje_aviso",
      user: "Clasifica este aviso al 112: «Columna de humo negro en el pinar de Navalacruz, viento fuerte, se ven llamas desde la carretera».",
      esquema: EsquemaTriaje,
      maxTokens: 1500,
    });
    return `${r.modelo} → ${r.datos.gravedad} en ${r.datos.municipio}`;
  });

  // --- 3. Texto libre (informes) ---------------------------------------
  await probar("LLM texto libre (markdown)", async () => {
    const r = await completarTexto({
      papel: "razonamiento",
      system: "Redactas partes de situación para un centro de coordinación de emergencias. Español, markdown, conciso.",
      user: "Escribe dos frases de parte de situación de un incendio forestal en Ávila con viento del suroeste a 35 km/h.",
      maxTokens: 1500,
    });
    return `${r.modelo} → ${r.datos.replace(/\s+/g, " ").slice(0, 90)}…`;
  });

  // --- 4. Visión (imagen sintética mínima, solo para validar el transporte)
  await probar("LLM visión · imagen base64", async () => {
    // PNG rojo de 1×1: basta para comprobar que el data URL viaja bien.
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const r = await completarJson({
      papel: "vision",
      nombreEsquema: "analisis_camara",
      user: "¿Se ve humo o fuego en la imagen? Responde en español.",
      imagenes: [{ base64: png, mime: "image/png" }],
      esquema: z.object({ humo: z.boolean(), fuego: z.boolean(), descripcion: z.string() }),
      maxTokens: 1500,
    });
    return `${r.modelo} → humo=${r.datos.humo} fuego=${r.datos.fuego}`;
  });

  // --- 5. Embeddings ---------------------------------------------------
  await probar("Embeddings · pregunta y pasajes", async () => {
    const pregunta = "¿Quién puede ordenar la evacuación de un pueblo en un incendio de nivel 2?";
    const pasajes = [
      "La dirección del plan de comunidad autónoma corresponde al órgano competente de la comunidad autónoma, que podrá ordenar la evacuación de la población amenazada.",
      "El monte es todo terreno en el que vegetan especies forestales arbóreas, arbustivas, de matorral o herbáceas.",
    ];
    const [v, vs] = await Promise.all([incrustarConsulta(pregunta), incrustarPasajes(pasajes)]);
    const s0 = similitudCoseno(v, vs[0]);
    const s1 = similitudCoseno(v, vs[1]);
    if (v.length !== DIMENSIONES) throw new Error(`dimensiones ${v.length} ≠ ${DIMENSIONES}`);
    return `coseno relevante=${s0.toFixed(3)} · irrelevante=${s1.toFixed(3)} ${s0 > s1 ? "(ordena bien)" : "(NO ORDENA BIEN)"}`;
  });

  // --- 6. Consulta al grafo de conocimiento ----------------------------
  await probar("Conocimiento · consultarProtocolo", async () => {
    const { consultarProtocolo } = await import("../lib/conocimiento/consulta");
    const r = await consultarProtocolo("¿Quién puede ordenar la evacuación de un pueblo en un incendio de nivel 2?");
    if (!r.fundamentos.length) throw new Error("sin fundamentos: ¿has ejecutado scripts/sembrar-conocimiento.ts?");
    return `${r.fundamentos.length} fundamentos · ${r.fundamentos[0].documento} §${r.fundamentos[0].seccion ?? "—"} (${r.fundamentos[0].similitud.toFixed(3)})`;
  });

  // --- Resumen ---------------------------------------------------------
  console.log("\n--- Resumen ---");
  for (const r of resultados) console.log(`${r.ok ? "OK  " : "FALL"} ${r.ms.toString().padStart(6)} ms  ${r.prueba}`);
  console.log("\nContadores del LLM:", JSON.stringify(estadisticasLLM().porPapel, null, 2));
  console.log("Contadores de embeddings:", JSON.stringify(estadisticasEmbeddings(), null, 2));

  process.exit(resultados.every((r) => r.ok) ? 0 : 1);

}

void main();
