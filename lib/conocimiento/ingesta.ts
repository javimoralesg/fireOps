// =====================================================================
// ATALAYA INCENDIOS · Ingesta de documentos → fragmentos → grafo
// ---------------------------------------------------------------------
// DUEÑO: constructor C.
// Un documento de texto o markdown entra y sale convertido en fragmentos
// ("chunks") de unos 700 caracteres troceados por su estructura legal
// (encabezados markdown, "Artículo 12", "CAPÍTULO III", "ANEXO I"), cada uno
// con:
//   · entidades  — organismos, cargos, niveles y acciones (regex + LLM rápido)
//   · relaciones — "sigue" (fragmento anterior/siguiente), "referencia"
//                  (menciones a "artículo N" dentro del mismo documento) y
//                  "menciona" (entidad), que el grafo deriva de `entidades`
//   · embedding  — 384 dimensiones con prefijo "passage: " (familia E5)
//
// El resultado se guarda en el índice local y, si hay Supabase, también allí.
//
// Dependencias externas: lib/ia/embeddings, lib/ia/llm (opcional y tolerante).
// =====================================================================

import { z } from "zod";
import type { AmbitoDocumento, Documento } from "../dominio/tipos";
import { incrustarPasajes } from "../ia/embeddings";
import { completarJson, proveedorDisponible } from "../ia/llm";
import { guardarDocumento, type ChunkIndexado } from "./almacen";

const TAMANO_OBJETIVO = Number(process.env.CONOCIMIENTO_TAMANO_CHUNK ?? 700);
const SOLAPE = Number(process.env.CONOCIMIENTO_SOLAPE_CHUNK ?? 100);
const CHUNKS_POR_LOTE_LLM = 10;
/**
 * Tope de lotes al LLM por documento. MEDIDO 2026-09-19: con qwen3.6 cada lote
 * cuesta 10-17 s porque el modelo razona antes de responder, así que sembrar el
 * corpus entero con LLM llevaría media hora. Con 3 lotes se enriquecen los ~30
 * primeros fragmentos de cada documento (los que llevan el articulado clave) y
 * el resto se queda con la regex, que ya reconoce órganos, roles, niveles y
 * acciones. `CONOCIMIENTO_MAX_LOTES_LLM=0` lo desactiva del todo.
 */
const MAX_LOTES_LLM = Number(process.env.CONOCIMIENTO_MAX_LOTES_LLM ?? 3);

// ---------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------

/** Quita la cabecera YAML `---…---` y devuelve título y cuerpo. */
function separarCabecera(texto: string): { titulo?: string; url?: string; cuerpo: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(texto);
  if (!m) return { cuerpo: texto };
  const cabecera = m[1];
  const leer = (clave: string): string | undefined => {
    const c = new RegExp(`^${clave}:\\s*(.+)$`, "m").exec(cabecera);
    if (!c) return undefined;
    return c[1].trim().replace(/^"(.*)"$/, "$1");
  };
  return { titulo: leer("titulo") ?? leer("titulo_corto"), url: leer("url"), cuerpo: m[2] };
}

const RE_ENCABEZADO_MD = /^(#{1,6})\s+(.+)$/;
/**
 * Epígrafes con enunciado, muy frecuentes en las directrices básicas:
 *   "3.4.1 Órganos de coordinación …: Cuando por motivo de …"
 *   "e) Confinamiento, evacuación y albergue: El plan preverá …"
 * Sin esto, TODO el Título III del RD 893/2013 sería una única sección de
 * cientos de fragmentos etiquetados "Tít. III" y la recuperación se perdería.
 */
const RE_EPIGRAFE = /^((?:\d+(?:\.\d+)*|[a-z]|[ivxlc]+)[).])\s+([^:.]{5,120}):\s*(.*)$/i;

const RE_ESTRUCTURA_LEGAL =
  /^(Art[íi]culo\s+(?:único|\d+[.º]?(?:\s+(?:bis|ter|qu[áa]ter|quinquies|sexies))?)|CAP[ÍI]TULO\s+[IVXLC\d]+|T[ÍI]TULO\s+[IVXLC\d]+|ANEXO\s*[IVXLC\d]*|SECCI[ÓO]N\s+[\w.ª]+|Disposici[óo]n\s+(?:adicional|transitoria|derogatoria|final)\s+\w+|PRE[ÁA]MBULO)\b/i;

interface Seccion {
  titulo: string;
  parrafos: string[];
}

/** Trocea el cuerpo en secciones por encabezado markdown o estructura legal. */
function seccionar(cuerpo: string): Seccion[] {
  const lineas = cuerpo.split(/\r?\n/);
  const secciones: Seccion[] = [];
  let actual: Seccion = { titulo: "Introducción", parrafos: [] };
  let acumulado: string[] = [];

  const cerrarParrafo = () => {
    const t = acumulado.join(" ").replace(/\s+/g, " ").trim();
    if (t) actual.parrafos.push(t);
    acumulado = [];
  };
  const abrir = (titulo: string) => {
    cerrarParrafo();
    if (actual.parrafos.length) secciones.push(actual);
    actual = { titulo: titulo.replace(/\s+/g, " ").trim().slice(0, 160), parrafos: [] };
  };

  for (const linea of lineas) {
    const enc = RE_ENCABEZADO_MD.exec(linea);
    if (enc) {
      abrir(enc[2]);
      continue;
    }
    const limpia = linea.trim();
    if (!limpia) {
      cerrarParrafo();
      continue;
    }
    if (RE_ESTRUCTURA_LEGAL.test(limpia) && limpia.length < 200) {
      abrir(limpia);
      // El propio enunciado del artículo también es contenido citable.
      acumulado.push(limpia);
      cerrarParrafo();
      continue;
    }
    const epigrafe = RE_EPIGRAFE.exec(limpia);
    if (epigrafe) {
      // La sección hereda el contexto del artículo/título en el que está.
      const contexto = actual.titulo.split(" » ")[0];
      abrir(`${contexto} » ${epigrafe[1]} ${epigrafe[2]}`);
      acumulado.push(`${epigrafe[1]} ${epigrafe[2]}: ${epigrafe[3]}`.trim());
      cerrarParrafo();
      continue;
    }
    acumulado.push(limpia);
  }
  cerrarParrafo();
  if (actual.parrafos.length) secciones.push(actual);
  return secciones;
}

/** Une los párrafos de una sección en trozos de ~700 caracteres con 100 de solape. */
function trocearSeccion(seccion: Seccion): string[] {
  const trozos: string[] = [];
  let actual = "";

  const empujar = () => {
    const t = actual.trim();
    if (t) trozos.push(t);
    actual = "";
  };

  for (const parrafo of seccion.parrafos) {
    // Un párrafo enorme (frecuente en el BOE) se parte por frases.
    const piezas = parrafo.length > TAMANO_OBJETIVO * 1.6 ? partirPorFrases(parrafo) : [parrafo];
    for (const pieza of piezas) {
      if (actual && actual.length + pieza.length + 1 > TAMANO_OBJETIVO) {
        empujar();
        // Solape: se arrastra la cola del trozo anterior para no cortar una idea.
        const anterior = trozos[trozos.length - 1] ?? "";
        actual = anterior.length > SOLAPE ? `…${anterior.slice(-SOLAPE)} ` : "";
      }
      actual += (actual ? " " : "") + pieza;
    }
  }
  empujar();
  return trozos.filter((t) => t.replace(/^…\S*\s/, "").length > 40);
}

function partirPorFrases(parrafo: string): string[] {
  const frases = parrafo.split(/(?<=[.;:])\s+/);
  const piezas: string[] = [];
  let actual = "";
  for (const f of frases) {
    if (actual && actual.length + f.length > TAMANO_OBJETIVO) {
      piezas.push(actual);
      actual = "";
    }
    actual += (actual ? " " : "") + f;
  }
  if (actual) piezas.push(actual);
  return piezas;
}

// ---------------------------------------------------------------------
// Entidades
// ---------------------------------------------------------------------

const PATRONES_ENTIDAD: { re: RegExp; normaliza?: (m: RegExpMatchArray) => string }[] = [
  // Cargos y órganos de dirección
  { re: /\b(Director(?:a)? (?:del|de la|de) [A-ZÁÉÍÓÚÑ][\wáéíóúñ]*(?: [a-záéíóúñ]+){0,4})/g },
  { re: /\b(Director(?:a)? (?:Técnico|de Extinción|de Operaciones|del Plan))/gi },
  { re: /\b(CECOP(?:I)?|CECOPAL|CECOD|CENEM|CPI|PMA|Puesto de Mando Avanzado)\b/g },
  { re: /\b(Consejo Nacional de Protección Civil|Comisión Nacional de Protección Civil)\b/g },
  { re: /\b(Unidad Militar de Emergencias|UME)\b/g },
  { re: /\b(Delegado del Gobierno|Subdelegado del Gobierno|Alcalde|Alcaldesa)\b/gi },
  { re: /\b(Guardia Civil|SEPRONA|Protección Civil|Agentes Forestales|Cuerpo de Bomberos|BRIF|Cruz Roja)\b/g },
  { re: /\b(Ministerio del Interior|Ministerio para la Transición Ecológica|Comunidad Autónoma|Administración General del Estado)\b/g },
  // Niveles y situaciones operativas
  { re: /\b(situación operativa\s+(?:0|1|2|3|E))\b/gi, normaliza: (m) => `Situación operativa ${m[1].split(/\s+/).pop()}` },
  { re: /\bnivel\s+(0|1|2|3)\b/gi, normaliza: (m) => `Nivel ${m[1]}` },
  { re: /\b(índice de gravedad potencial\s*(?:0|1|2|3)?)/gi, normaliza: () => "Índice de gravedad potencial" },
  { re: /\b(interés nacional)\b/gi, normaliza: () => "Interés nacional" },
  // Acciones operativas
  { re: /\b(evacuaci[óo]n|evacuar)\b/gi, normaliza: () => "evacuación" },
  { re: /\b(confinamiento|confinar)\b/gi, normaliza: () => "confinamiento" },
  { re: /\b(alejamiento)\b/gi, normaliza: () => "alejamiento" },
  { re: /\b(aviso a la poblaci[óo]n|información a la población)\b/gi, normaliza: () => "aviso a la población" },
  { re: /\b(albergue|realojo)\b/gi, normaliza: () => "albergue" },
  { re: /\b(medios extraordinarios|medios aéreos)\b/gi },
  { re: /\b(interfaz urbano[- ]forestal)\b/gi, normaliza: () => "interfaz urbano-forestal" },
  { re: /\b(plan de autoprotecci[óo]n)\b/gi, normaliza: () => "plan de autoprotección" },
  { re: /\b(zona de alto riesgo)\b/gi, normaliza: () => "zona de alto riesgo" },
];

function entidadesPorRegex(texto: string): string[] {
  const encontradas = new Set<string>();
  for (const { re, normaliza } of PATRONES_ENTIDAD) {
    for (const m of texto.matchAll(re)) {
      const valor = (normaliza ? normaliza(m) : m[1] ?? m[0]).trim();
      if (valor.length > 2 && valor.length < 90) encontradas.add(valor);
    }
  }
  return [...encontradas].slice(0, 12);
}

const EsquemaEntidades = z.object({
  fragmentos: z.array(
    z.object({
      indice: z.number().int(),
      organismos: z.array(z.string()),
      roles: z.array(z.string()),
      niveles: z.array(z.string()),
      acciones: z.array(z.string()),
    }),
  ),
});

/**
 * Enriquece las entidades con el modelo rápido, por lotes de 10 fragmentos.
 * Es TOLERANTE: si no hay proveedor o falla (por ejemplo, 429 de Groq), se
 * queda con lo que sacó la regex y sigue.
 */
async function entidadesConLlm(trozos: { indice: number; texto: string }[]): Promise<Map<number, string[]>> {
  const salida = new Map<number, string[]>();
  if (!proveedorDisponible()) return salida;

  const lotes: (typeof trozos)[] = [];
  for (let i = 0; i < trozos.length; i += CHUNKS_POR_LOTE_LLM) lotes.push(trozos.slice(i, i + CHUNKS_POR_LOTE_LLM));

  const aProcesar = MAX_LOTES_LLM > 0 ? lotes.slice(0, MAX_LOTES_LLM) : [];
  for (const lote of aProcesar) {
    try {
      const r = await completarJson({
        papel: "rapido",
        nombreEsquema: "entidades_normativa",
        system:
          "Eres un analista de normativa española de protección civil. Extraes entidades de fragmentos legales. " +
          "No inventes: si un fragmento no menciona nada de una categoría, devuelve lista vacía.",
        user:
          "Para cada fragmento devuelve sus entidades:\n" +
          "- organismos: instituciones y servicios (por ejemplo «CECOPI», «Unidad Militar de Emergencias»).\n" +
          "- roles: cargos o funciones de mando (por ejemplo «Director del Plan», «Director Técnico de Extinción»).\n" +
          "- niveles: niveles o situaciones operativas (por ejemplo «Nivel 2», «Situación operativa 2», «Interés nacional»).\n" +
          "- acciones: medidas operativas (por ejemplo «evacuación», «confinamiento», «aviso a la población»).\n\n" +
          lote.map((t) => `### Fragmento ${t.indice}\n${t.texto.slice(0, 1200)}`).join("\n\n"),
        esquema: EsquemaEntidades,
        maxTokens: 4000,
      });
      for (const f of r.datos.fragmentos) {
        salida.set(f.indice, [...f.organismos, ...f.roles, ...f.niveles, ...f.acciones].map((s) => s.trim()).filter(Boolean));
      }
    } catch (e) {
      console.warn(
        `[conocimiento] entidades por LLM no disponibles, sigo solo con regex: ${e instanceof Error ? e.message : e}`,
      );
      break;
    }
  }
  if (lotes.length > aProcesar.length) {
    console.log(
      `[conocimiento] entidades por LLM limitadas a ${aProcesar.length}/${lotes.length} lotes (CONOCIMIENTO_MAX_LOTES_LLM)`,
    );
  }
  return salida;
}

// ---------------------------------------------------------------------
// Relaciones
// ---------------------------------------------------------------------

const RE_REFERENCIA_ARTICULO = /art[íi]culo\s+(\d+(?:\.\d+)?)/gi;

/** Número de artículo que encabeza una sección ("Art. 12 — …" o "Artículo 12."). */
function articuloDeSeccion(seccion: string | undefined): string | undefined {
  if (!seccion) return undefined;
  const m = /^(?:Art\.|Art[íi]culo)\s+(\d+)/i.exec(seccion) ?? /—\s*Art[íi]culo\s+(\d+)/i.exec(seccion);
  return m?.[1];
}

// ---------------------------------------------------------------------
// Ingesta
// ---------------------------------------------------------------------

export function idDesdeNombre(nombreArchivo: string): string {
  const base = nombreArchivo
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `doc_${base || "documento"}`;
}

export interface ResultadoIngesta {
  documento: Documento;
  /** Milisegundos totales y desglose, para saber dónde se va el tiempo. */
  tiempos: { troceadoMs: number; entidadesMs: number; embeddingsMs: number; totalMs: number };
}

/**
 * Ingiere un documento completo. Devuelve la ficha del `Documento`; los
 * fragmentos quedan en el índice (memoria + fichero + Supabase).
 */
export async function ingerirDocumento(p: {
  nombreArchivo: string;
  titulo?: string;
  texto: string;
  ambito: AmbitoDocumento;
  territorio?: string;
}): Promise<Documento> {
  return (await ingerirDocumentoDetallado(p)).documento;
}

/** Igual que `ingerirDocumento` pero devuelve además las latencias medidas. */
export async function ingerirDocumentoDetallado(p: {
  nombreArchivo: string;
  titulo?: string;
  texto: string;
  ambito: AmbitoDocumento;
  territorio?: string;
}): Promise<ResultadoIngesta> {
  const t0 = Date.now();
  const documentoId = idDesdeNombre(p.nombreArchivo);
  const { titulo: tituloCabecera, cuerpo } = separarCabecera(p.texto);
  const titulo = p.titulo?.trim() || tituloCabecera || p.nombreArchivo.replace(/\.[^.]+$/, "");

  const secciones = seccionar(cuerpo);
  const crudos: { indice: number; seccion: string; texto: string }[] = [];
  for (const seccion of secciones) {
    for (const trozo of trocearSeccion(seccion)) {
      crudos.push({ indice: crudos.length, seccion: seccion.titulo, texto: trozo });
    }
  }
  const troceadoMs = Date.now() - t0;

  if (!crudos.length) {
    throw new Error(`El documento "${p.nombreArchivo}" no tiene texto aprovechable (0 fragmentos).`);
  }

  // --- entidades -----------------------------------------------------
  const tEnt = Date.now();
  const porLlm = await entidadesConLlm(crudos.map((c) => ({ indice: c.indice, texto: c.texto })));
  const entidadesPorChunk = crudos.map((c) => {
    const juntas = new Set<string>([...entidadesPorRegex(`${c.seccion}\n${c.texto}`), ...(porLlm.get(c.indice) ?? [])]);
    return [...juntas].slice(0, 16);
  });
  const entidadesMs = Date.now() - tEnt;

  // --- embeddings ----------------------------------------------------
  const tEmb = Date.now();
  // Se antepone la sección al texto: ayuda a que "Artículo 46" recupere bien.
  const embeddings = await incrustarPasajes(crudos.map((c) => `${c.seccion}. ${c.texto}`));
  const embeddingsMs = Date.now() - tEmb;

  // --- relaciones ----------------------------------------------------
  const idDe = (indice: number) => `${documentoId}#${indice}`;
  const porArticulo = new Map<string, string>();
  for (const c of crudos) {
    const art = articuloDeSeccion(c.seccion);
    if (art && !porArticulo.has(art)) porArticulo.set(art, idDe(c.indice));
  }

  const chunks: ChunkIndexado[] = crudos.map((c, i) => {
    const relacionados = new Set<string>();
    if (i > 0) relacionados.add(idDe(i - 1)); // sigue (anterior)
    if (i < crudos.length - 1) relacionados.add(idDe(i + 1)); // sigue (siguiente)
    for (const m of c.texto.matchAll(RE_REFERENCIA_ARTICULO)) {
      const destino = porArticulo.get(m[1].split(".")[0]);
      if (destino && destino !== idDe(i)) relacionados.add(destino); // referencia cruzada
    }
    return {
      id: idDe(i),
      documentoId,
      indice: i,
      seccion: c.seccion,
      texto: c.texto,
      entidades: entidadesPorChunk[i],
      relacionados: [...relacionados],
      embedding: embeddings[i],
      documentoTitulo: titulo,
      ambito: p.ambito,
      territorio: p.territorio,
    };
  });

  const documento: Documento = {
    id: documentoId,
    titulo,
    nombreArchivo: p.nombreArchivo,
    ambito: p.ambito,
    territorio: p.territorio,
    subidoEn: new Date().toISOString(),
    tamanoBytes: Buffer.byteLength(p.texto, "utf8"),
    numChunks: chunks.length,
    estado: "listo",
  };

  await guardarDocumento(documento, chunks);
  const totalMs = Date.now() - t0;
  console.log(
    `[conocimiento] "${titulo}": ${chunks.length} fragmentos · trocear ${troceadoMs} ms · ` +
      `entidades ${entidadesMs} ms · embeddings ${embeddingsMs} ms · total ${totalMs} ms`,
  );
  return { documento, tiempos: { troceadoMs, entidadesMs, embeddingsMs, totalMs } };
}
