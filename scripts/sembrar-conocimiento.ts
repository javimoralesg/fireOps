// =====================================================================
// ATALAYA INCENDIOS · Siembra del grafo de conocimiento
// ---------------------------------------------------------------------
// DUEÑO: constructor C.
// Ingiere todos los .md/.txt de `data/protocolos` y deja el índice listo en
// `data/conocimiento/indice.json` (y en Supabase si hay credenciales).
//
//   npx tsx scripts/sembrar-conocimiento.ts
//   npx tsx scripts/sembrar-conocimiento.ts --forzar      (reindexa todo)
//   npx tsx scripts/sembrar-conocimiento.ts --consulta "¿…?"
//
// Precalienta el modelo de embeddings antes de nada: en Railway la primera
// carga descarga ~120 MB si se usa el respaldo local.
// =====================================================================

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

function cargarEnv(ruta = ".env.local"): void {
  try {
    for (const linea of readFileSync(ruta, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linea);
      if (!m) continue;
      if (!(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    console.warn("[sembrar] no encuentro .env.local: uso las variables del entorno.");
  }
}

cargarEnv();

/** Ámbito y territorio de cada documento del corpus inicial, por prefijo de nombre. */
const AMBITOS: { prefijo: string; ambito: "nacional" | "comunidad" | "provincia" | "municipio" | "interno"; territorio?: string }[] = [
  { prefijo: "platercam", ambito: "comunidad", territorio: "Comunidad de Madrid" },
  { prefijo: "pemam", ambito: "municipio", territorio: "Madrid" },
];

function clasificar(nombre: string): { ambito: "nacional" | "comunidad" | "provincia" | "municipio" | "interno"; territorio?: string } {
  const encontrado = AMBITOS.find((a) => nombre.startsWith(a.prefijo));
  return encontrado ? { ambito: encontrado.ambito, territorio: encontrado.territorio } : { ambito: "nacional" };
}

async function main(): Promise<void> {
  const forzar = process.argv.includes("--forzar");
  const iConsulta = process.argv.indexOf("--consulta");
  const consulta = iConsulta >= 0 ? process.argv[iConsulta + 1] : undefined;

  const { precalentar, estadisticasEmbeddings, DIMENSIONES, modeloEmbeddings, proveedorEmbeddings } = await import(
    "../lib/ia/embeddings"
  );
  const { ingerirDocumentoDetallado } = await import("../lib/conocimiento/ingesta");
  const { guardarIndice, listarDocumentos, resumenConocimiento } = await import("../lib/conocimiento/almacen");

  console.log(`\n=== Siembra del conocimiento ===`);
  console.log(`Embeddings: ${proveedorEmbeddings()} / ${modeloEmbeddings()} · ${DIMENSIONES} dimensiones`);

  const t0 = Date.now();
  const calentado = await precalentar();
  if (calentado.cargaMs) console.log(`Modelo local cargado en ${calentado.cargaMs} ms`);

  const directorio = path.join(process.cwd(), "data", "protocolos");
  const archivos = readdirSync(directorio).filter((f) => /\.(md|txt)$/i.test(f) && f !== "README.md");
  if (!archivos.length) {
    console.error(`No hay documentos en ${directorio}.`);
    process.exit(1);
  }

  const yaIndexados = new Set((await listarDocumentos()).map((d) => d.nombreArchivo));
  let total = 0;

  for (const archivo of archivos) {
    if (!forzar && yaIndexados.has(archivo)) {
      console.log(`· ${archivo} — ya indexado (usa --forzar para rehacerlo)`);
      continue;
    }
    const texto = readFileSync(path.join(directorio, archivo), "utf8");
    const { ambito, territorio } = clasificar(archivo);
    try {
      const r = await ingerirDocumentoDetallado({ nombreArchivo: archivo, texto, ambito, territorio });
      total += r.documento.numChunks;
      console.log(
        `· ${archivo} → ${r.documento.numChunks} fragmentos · ${(r.tiempos.totalMs / 1000).toFixed(1)} s ` +
          `(embeddings ${(r.tiempos.embeddingsMs / 1000).toFixed(1)} s, entidades ${(r.tiempos.entidadesMs / 1000).toFixed(1)} s)`,
      );
    } catch (e) {
      console.error(`· ${archivo} → ERROR: ${e instanceof Error ? e.message : e}`);
    }
  }

  await guardarIndice();
  const resumen = await resumenConocimiento();
  console.log(
    `\nÍndice: ${resumen.documentos} documentos, ${resumen.chunks} fragmentos ` +
      `(${total} nuevos) · Supabase: ${resumen.enSupabase ? "sí" : "no configurado"}`,
  );
  console.log(`Embeddings: ${JSON.stringify(estadisticasEmbeddings())}`);
  console.log(`Tiempo total: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  if (consulta) {
    const { buscarFundamentosExplicados } = await import("../lib/conocimiento/consulta");
    console.log(`\n--- Consulta de prueba: "${consulta}" ---`);
    const fundamentos = await buscarFundamentosExplicados(consulta, { k: 6 });
    for (const f of fundamentos) {
      console.log(`\n[${f.similitud.toFixed(3)} · ${f.motivo}] ${f.documento} §${f.seccion ?? "—"}`);
      console.log(`   ${f.cita}`);
    }
  }
}

void main();
