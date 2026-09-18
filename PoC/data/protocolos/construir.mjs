#!/usr/bin/env node
/**
 * Construye el corpus local de normativa de proteccion civil y su indice vectorial.
 *
 * Node ESM puro, sin dependencias npm. Usa `pdftotext` (poppler) cuando esta
 * disponible para los planes publicados solo en PDF; si no lo esta, esos
 * documentos se omiten y se anota el motivo.
 *
 * Uso:
 *   node data/protocolos/construir.mjs               # descarga + trocea + indexa
 *   node data/protocolos/construir.mjs --solo-indexar # reindexa los .md ya descargados
 *   node data/protocolos/construir.mjs --solo-descargar
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIRECTORIO = path.dirname(fileURLToPath(import.meta.url));
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODELO = process.env.OLLAMA_MODEL_EMBED || "all-minilm:l6-v2";
const LOTE = 32;
const MIN_FRAGMENTO = 600;
const MAX_FRAGMENTO = 900;
const MIN_UTIL = 120; // por debajo de esto un fragmento no aporta nada al RAG
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const args = new Set(process.argv.slice(2));
const soloIndexar = args.has("--solo-indexar");
const soloDescargar = args.has("--solo-descargar");

/* ------------------------------------------------------------------ */
/* Catalogo de fuentes                                                 */
/* ------------------------------------------------------------------ */

/** @type {Array<Record<string, unknown>>} */
const FUENTES = [
  {
    tipo: "boe",
    slug: "ley-17-2015-sistema-nacional-proteccion-civil",
    titulo_corto: "Ley 17/2015 Sistema Nacional de Protección Civil",
    identificador: "BOE-A-2015-7730",
    titulo: "Ley 17/2015, de 9 de julio, del Sistema Nacional de Protección Civil",
    url: "https://www.boe.es/buscar/act.php?id=BOE-A-2015-7730",
    fuente: "https://www.boe.es/diario_boe/xml.php?id=BOE-A-2015-7730",
    vigencia: "vigente",
  },
  {
    tipo: "boe",
    slug: "rd-524-2023-norma-basica-proteccion-civil",
    titulo_corto: "RD 524/2023 Norma Básica de Protección Civil",
    identificador: "BOE-A-2023-14679",
    titulo:
      "Real Decreto 524/2023, de 20 de junio, por el que se aprueba la Norma Básica de Protección Civil",
    url: "https://www.boe.es/buscar/act.php?id=BOE-A-2023-14679",
    fuente: "https://www.boe.es/diario_boe/xml.php?id=BOE-A-2023-14679",
    vigencia: "vigente",
  },
  {
    tipo: "boe",
    slug: "rd-393-2007-norma-basica-autoproteccion",
    titulo_corto: "RD 393/2007 Norma Básica de Autoprotección",
    identificador: "BOE-A-2007-6237",
    titulo:
      "Real Decreto 393/2007, de 23 de marzo, por el que se aprueba la Norma Básica de Autoprotección de los centros, establecimientos y dependencias dedicados a actividades que puedan dar origen a situaciones de emergencia",
    url: "https://www.boe.es/buscar/act.php?id=BOE-A-2007-6237",
    fuente: "https://www.boe.es/diario_boe/xml.php?id=BOE-A-2007-6237",
    vigencia: "vigente",
  },
  {
    tipo: "boe",
    slug: "rd-407-1992-norma-basica-proteccion-civil-derogada",
    titulo_corto: "RD 407/1992 Norma Básica de Protección Civil (derogada)",
    identificador: "BOE-A-1992-9364",
    titulo:
      "Real Decreto 407/1992, de 24 de abril, por el que se aprueba la Norma Básica de Protección Civil (DEROGADA por el RD 524/2023)",
    url: "https://www.boe.es/buscar/act.php?id=BOE-A-1992-9364",
    fuente: "https://www.boe.es/diario_boe/xml.php?id=BOE-A-1992-9364",
    vigencia: "derogada",
  },
  {
    tipo: "pdf",
    slug: "platercam-2019",
    titulo_corto: "PLATERCAM, Plan Territorial de Protección Civil de la Comunidad de Madrid",
    identificador: "BOCM-20190514-22",
    titulo:
      "PLATERCAM. Plan Territorial de Protección Civil de la Comunidad de Madrid (Acuerdo de 30 de abril de 2019, BOCM núm. 113 de 14/05/2019)",
    url: "https://www.comunidad.madrid/transparencia/informacion-institucional/planes-programas/plan-territorial-proteccion-civil-comunidad-madrid",
    fuente:
      "https://www.comunidad.madrid/transparencia/sites/default/files/plan/document/acuerdo_de_30_de_abril_de_2019.pdf",
    vigencia: "vigente",
    ruido: [
      /^BOCM\b.*BOLET[IÍ]N OFICIAL DE LA COMUNIDAD DE MADRID\s*$/i,
      /^B\.O\.C\.M\. N[uú]m\./i,
      /^BOCM-\d{8}-\d+$/,
      /^http:\/\/www\.bocm\.es/i,
      /^D\. ?L\.: ?M\./i,
      /^ISSN /i,
      /^P[aá]g\. \d+$/i,
      /^\(\d{2}\/[\d.]+\/\d{2}\)$/,
    ],
  },
  {
    tipo: "pdf",
    slug: "pemam-madrid",
    titulo_corto: "PEMAM, Plan Territorial de Emergencia Municipal del Ayuntamiento de Madrid",
    identificador: "PEMAM",
    titulo:
      "PEMAM. Plan Territorial de Emergencia Municipal del Ayuntamiento de Madrid",
    url: "https://transparencia.madrid.es/portales/transparencia/es/Organizacion/Planes-y-memorias/Plan-Territorial-de-Emergencia-Municipal-del-Ayuntamiento-de-Madrid-PEMAM-/?vgnextfmt=default&vgnextoid=22561c5234ee5810VgnVCM2000001f4a900aRCRD",
    fuente:
      "https://transparencia.madrid.es/FWProjects/transparencia/PlanesYMemorias/Planes/SeguridadEmergencias/Ficheros/PlanEmergenciasAyuntmaientoMadrid.pdf",
    vigencia: "vigente",
    referer: "https://transparencia.madrid.es/",
    // Se indexa el cuerpo del plan y los anexos con contenido operativo.
    // Se descartan el Anexo 2 (entorno municipal: tablas estadisticas), y los
    // anexos 10-13 (directorio de interlocutores, catalogo de medios,
    // herramientas y cartografia): son tablas, telefonos y planos sin texto util.
    paginas: [
      [1, 57],
      [224, 405],
    ],
    ruido: [
      /^MADRID$/,
      /^Portavoz, seguridad y\s*$/i,
      /^\s*emergencias\s*$/i,
      /^Direcci[oó]n General de Emergencias y Protecci[oó]n Civil$/i,
      /^Portavoz, seguridad y\s+Direcci[oó]n General de Emergencias y Protecci[oó]n Civil$/i,
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

const log = (...m) => console.log(...m);

function hoy() {
  return new Date().toISOString();
}

function normalizarEspacios(s) {
  return s.replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
}

const ENTIDADES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  ntilde: "ñ",
  Ntilde: "Ñ",
  uuml: "ü",
  Uuml: "Ü",
  ordm: "º",
  ordf: "ª",
  deg: "°",
  laquo: "«",
  raquo: "»",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  euro: "€",
  middot: "·",
};

function decodificarEntidades(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => (n in ENTIDADES ? ENTIDADES[n] : m));
}

async function descargar(url, { referer } = {}) {
  const cabeceras = { "User-Agent": UA, Accept: "*/*" };
  if (referer) cabeceras.Referer = referer;
  let ultimo = null;
  for (let intento = 1; intento <= 3; intento += 1) {
    try {
      const r = await fetch(url, {
        headers: cabeceras,
        redirect: "follow",
        signal: AbortSignal.timeout(120_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      ultimo = e;
      log(`   reintento ${intento}/3 (${e instanceof Error ? e.message : String(e)})`);
      await new Promise((res) => setTimeout(res, 1500 * intento));
    }
  }
  throw new Error(`No se pudo descargar ${url}: ${ultimo}`);
}

function hayPdftotext() {
  const r = spawnSync("pdftotext", ["-v"], { encoding: "utf8" });
  return r.status === 0 || (r.stderr || "").includes("pdftotext");
}

/* ------------------------------------------------------------------ */
/* Extraccion: BOE XML                                                 */
/* ------------------------------------------------------------------ */

/**
 * El XML consolidado del BOE trae el articulado en el ultimo <texto>, con
 * parrafos <p class="..."> donde la clase indica el rol estructural.
 * Devuelve secciones {referencia, epigrafe, parrafos[]}.
 */
function seccionesDesdeBoe(xml) {
  const inicio = xml.lastIndexOf("<texto>");
  const fin = xml.lastIndexOf("</texto>");
  if (inicio < 0 || fin < 0) throw new Error("El XML del BOE no contiene <texto>");
  const cuerpo = xml.slice(inicio + "<texto>".length, fin);

  const parrafos = [];
  const re = /<p class="([^"]*)"[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(cuerpo)) !== null) {
    const clase = m[1];
    const texto = normalizarEspacios(
      decodificarEntidades(m[2].replace(/<[^>]+>/g, " ")),
    ).replace(/^\[precepto\]\s*/, "");
    if (texto) parrafos.push({ clase, texto });
  }

  const secciones = [];
  let actual = null;
  let contexto = "";
  let numeroPendiente = "";

  const abrir = (referencia, epigrafe) => {
    actual = { referencia, epigrafe, parrafos: [] };
    secciones.push(actual);
  };

  for (const { clase, texto } of parrafos) {
    if (clase === "titulo_num" || clase === "capitulo_num" || clase === "anexo_num") {
      numeroPendiente = texto;
      continue;
    }
    if (clase === "titulo_tit" || clase === "capitulo_tit" || clase === "anexo_tit") {
      contexto = numeroPendiente ? `${numeroPendiente}. ${texto}` : texto;
      numeroPendiente = "";
      abrir(abreviarReferencia(contexto), contexto);
      continue;
    }
    if (clase === "capitulo" || clase === "seccion" || clase === "subseccion" || clase === "anexo") {
      contexto = texto;
      abrir(abreviarReferencia(texto), texto);
      continue;
    }
    if (clase === "articulo") {
      const ref = abreviarReferencia(texto);
      const epigrafe = contexto ? `${contexto} — ${texto}` : texto;
      abrir(ref, epigrafe);
      actual.parrafos.push(texto);
      continue;
    }
    if (clase === "centro_redonda" || clase === "centro_negrita" || clase === "centro_cursiva") {
      if (/^(PRE[AÁ]MBULO|EXPOSICI[OÓ]N DE MOTIVOS)$/i.test(texto)) {
        contexto = "Preámbulo";
        abrir("Preámbulo", "Preámbulo");
        continue;
      }
      if (actual) actual.parrafos.push(texto);
      continue;
    }
    if (clase === "firma_rey" || clase === "firma_ministro") continue;
    if (!actual) abrir("Preámbulo", "Preámbulo");
    actual.parrafos.push(texto);
  }

  return secciones.filter((s) => s.parrafos.join(" ").length > 40);
}

/** "Artículo 12. Planes" -> "Art. 12"; "CAPÍTULO III. ..." -> "Cap. III". */
function abreviarReferencia(texto) {
  const t = texto.trim();
  let m = /^Art[íi]culo\s+(único|\d+\.?º?)(\s+(?:bis|ter|qu[áa]ter|quinquies|sexies))?/i.exec(t);
  if (m) {
    const numero = m[1].replace(/\.$/, "");
    return `Art. ${numero}${m[2] ? ` ${m[2].trim().toLowerCase()}` : ""}`;
  }
  m = /^CAP[ÍI]TULO\s+([IVXLC\d]+)/i.exec(t);
  if (m) return `Cap. ${m[1]}`;
  m = /^T[ÍI]TULO\s+([IVXLC\d]+)/i.exec(t);
  if (m) return `Tít. ${m[1]}`;
  m = /^ANEXO\s*([IVXLC\d]*)/i.exec(t);
  if (m) return `Anexo ${m[1]}`.trim();
  m = /^SECCI[ÓO]N\s+([\w.ª]+)/i.exec(t);
  if (m) return `Secc. ${m[1]}`;
  m = /^(Disposici[óo]n\s+(?:adicional|transitoria|derogatoria|final)\s+[\wúé]+)/i.exec(t);
  if (m) return m[1];
  m = /^(\d+(?:\.\d+)*)\.?\s/.exec(t);
  if (m) return `Apdo. ${m[1]}`;
  return t.length > 60 ? `${t.slice(0, 57)}…` : t.replace(/\.$/, "");
}

/* ------------------------------------------------------------------ */
/* Extraccion: PDF via pdftotext                                       */
/* ------------------------------------------------------------------ */

function textoDesdePdf(buffer, fuente) {
  const tmp = path.join(os.tmpdir(), `protocolo-${createHash("sha1").update(fuente.slug).digest("hex").slice(0, 10)}.pdf`);
  fs.writeFileSync(tmp, buffer);
  const salida = `${tmp}.txt`;
  try {
    const trozos = [];
    const rangos = Array.isArray(fuente.paginas) ? fuente.paginas : [null];
    for (const rango of rangos) {
      const argv = ["-layout", "-enc", "UTF-8"];
      if (rango) argv.push("-f", String(rango[0]), "-l", String(rango[1]));
      argv.push(tmp, salida);
      const r = spawnSync("pdftotext", argv, { encoding: "utf8" });
      if (r.status !== 0) throw new Error(`pdftotext fallo: ${r.stderr || r.status}`);
      trozos.push(fs.readFileSync(salida, "utf8"));
    }
    return trozos.join("\n\f\n");
  } finally {
    for (const f of [tmp, salida]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* nada */
      }
    }
  }
}

const RE_ENCABEZADO_ANEXO = /^(ANEXO\s+[IVXLC\d]+)\s*[:.\-]?\s*(.{0,90})$/i;
// Numeracion jerarquica (5.2.1) o entero seguido de separador (1.- / 1.)
const RE_ENCABEZADO_NUM = /^(\d+(?:\.\d+){1,3})\s*[.\-–—]*\s+(.{3,85})$|^(\d{1,2})\s*[.\-–—]+\s+(.{3,85})$/;

/** Decide si una linea de un PDF es un encabezado de apartado y no una fila de tabla. */
function encabezadoPdf(linea) {
  const anexo = RE_ENCABEZADO_ANEXO.exec(linea);
  if (anexo && linea.length < 110) {
    return {
      referencia: anexo[1].replace(/^ANEXO/i, "Anexo").replace(/\s+/, " "),
      epigrafe: anexo[2] ? normalizarEspacios(anexo[2]) : "",
      nivel: 1,
    };
  }
  if (linea.length > 95 || /[,;]$/.test(linea)) return null;
  const m = RE_ENCABEZADO_NUM.exec(linea);
  if (!m) return null;
  const numero = m[1] ?? m[3];
  const resto = normalizarEspacios(m[2] ?? m[4] ?? "");
  if (!/^[A-ZÁÉÍÓÚÜÑ]/.test(resto)) return null; // "5.2 millones de..." no es titulo
  if (/^\d/.test(resto)) return null; // fila de tabla: "2010 173.000"
  if (/\d{3,}/.test(resto)) return null; // cifras largas: datos, no titulos
  return { referencia: `Apdo. ${numero}`, epigrafe: resto, nivel: numero.split(".").length };
}

function seccionesDesdePdf(texto, fuente) {
  const ruido = Array.isArray(fuente.ruido) ? fuente.ruido : [];
  const lineas = [];
  for (const bruta of texto.split("\n")) {
    const l = normalizarEspacios(bruta);
    if (!l) {
      lineas.push("");
      continue;
    }
    if (/^\f?\s*\d{1,4}\s*$/.test(l)) continue; // numero de pagina suelto
    if (ruido.some((re) => re.test(l))) continue;
    lineas.push(l.replace(/\f/g, ""));
  }

  const secciones = [];
  let anexoActual = ""; // ultimo "Anexo N" visto: da contexto a los apartados que siguen
  let actual = { referencia: "Preliminar", epigrafe: "Preliminar", parrafos: [] };
  secciones.push(actual);

  for (const l of lineas) {
    if (!l) {
      actual.parrafos.push("");
      continue;
    }
    const enc = encabezadoPdf(l);
    if (enc) {
      const esAnexo = enc.referencia.startsWith("Anexo");
      if (esAnexo) anexoActual = enc.referencia;
      const referencia = esAnexo || !anexoActual ? enc.referencia : `${anexoActual} · ${enc.referencia}`;
      const epigrafe = enc.epigrafe || enc.referencia;
      actual = { referencia, epigrafe, parrafos: [] };
      secciones.push(actual);
      continue;
    }
    actual.parrafos.push(l);
  }

  // une lineas sueltas en parrafos y descarta secciones vacias o tabulares
  return secciones
    .map((s) => ({
      referencia: s.referencia,
      epigrafe: s.epigrafe,
      parrafos: unirLineas(s.parrafos),
    }))
    .filter((s) => {
      const t = s.parrafos.join(" ");
      return t.length > 80 && proporcionLetras(t) > 0.6;
    });
}

function unirLineas(lineas) {
  const parrafos = [];
  let buffer = "";
  const cerrar = () => {
    const t = normalizarEspacios(buffer);
    if (t) parrafos.push(t);
    buffer = "";
  };
  for (const l of lineas) {
    if (!l) {
      cerrar();
      continue;
    }
    if (/^[-•·–—]\s/.test(l) || /^\d+[.)]\s/.test(l)) cerrar();
    buffer = buffer ? `${buffer} ${l}` : l;
    if (/[.:;]$/.test(l)) cerrar();
  }
  cerrar();
  return parrafos;
}

function proporcionLetras(t) {
  if (!t.length) return 0;
  const letras = t.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]/g, "").length;
  return letras / t.length;
}

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */

function escribirMarkdown(fuente, secciones) {
  const cab = [
    "---",
    `id: ${fuente.slug}`,
    `identificador: ${fuente.identificador}`,
    `titulo: ${JSON.stringify(fuente.titulo)}`,
    `titulo_corto: ${JSON.stringify(fuente.titulo_corto)}`,
    `url: ${fuente.url}`,
    `fuente_descarga: ${fuente.fuente}`,
    `descargado: ${hoy()}`,
    `vigencia: ${fuente.vigencia}`,
    `secciones: ${secciones.length}`,
    "---",
    "",
  ];
  const cuerpo = secciones.map((s) => {
    const titulo = s.epigrafe && s.epigrafe !== s.referencia ? `${s.referencia} — ${s.epigrafe}` : s.referencia;
    return `## ${titulo.replace(/\n/g, " ")}\n\n${s.parrafos.join("\n\n")}\n`;
  });
  const destino = path.join(DIRECTORIO, `${fuente.slug}.md`);
  fs.writeFileSync(destino, `${cab.join("\n")}${cuerpo.join("\n")}`, "utf8");
  return destino;
}

function leerMarkdown(archivo) {
  const bruto = fs.readFileSync(archivo, "utf8");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(bruto);
  if (!m) throw new Error(`Sin cabecera YAML: ${archivo}`);
  const meta = {};
  for (const linea of m[1].split("\n")) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(linea.trim());
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"')) {
      try {
        v = JSON.parse(v);
      } catch {
        /* se deja tal cual */
      }
    }
    meta[kv[1]] = v;
  }
  const secciones = [];
  const partes = m[2].split(/^## /m).slice(1);
  for (const parte of partes) {
    const salto = parte.indexOf("\n");
    const encabezado = (salto < 0 ? parte : parte.slice(0, salto)).trim();
    const texto = (salto < 0 ? "" : parte.slice(salto + 1)).trim();
    const guion = encabezado.indexOf(" — ");
    const referencia = guion > 0 ? encabezado.slice(0, guion).trim() : encabezado;
    if (texto) secciones.push({ referencia, epigrafe: encabezado, texto });
  }
  return { meta, secciones };
}

/* ------------------------------------------------------------------ */
/* Troceado                                                            */
/* ------------------------------------------------------------------ */

function trocear(texto) {
  const unidades = texto
    .split(/\n{2,}/)
    .flatMap((p) => dividirLargo(normalizarEspacios(p)))
    .filter(Boolean);

  const trozos = [];
  let actual = "";
  let colaAnterior = "";

  for (const u of unidades) {
    const candidato = actual ? `${actual} ${u}` : `${colaAnterior}${u}`;
    if (candidato.length > MAX_FRAGMENTO && actual.length >= MIN_UTIL) {
      trozos.push(actual);
      colaAnterior = solapamiento(actual);
      actual = `${colaAnterior}${u}`;
      continue;
    }
    actual = candidato;
    if (actual.length >= MIN_FRAGMENTO) {
      trozos.push(actual);
      colaAnterior = solapamiento(actual);
      actual = "";
    }
  }
  if (actual.trim().length >= MIN_UTIL) trozos.push(actual);
  else if (actual.trim() && trozos.length) trozos[trozos.length - 1] += ` ${actual.trim()}`;
  else if (actual.trim()) trozos.push(actual.trim());
  return trozos.map((t) => normalizarEspacios(t)).filter((t) => t.length >= MIN_UTIL);
}

/** Ultima frase del trozo anterior (max ~150 chars) como solapamiento. */
function solapamiento(trozo) {
  const frases = trozo.split(/(?<=[.;:])\s+/);
  const ultima = frases[frases.length - 1] || "";
  if (ultima.length > 20 && ultima.length <= 150) return `${ultima} `;
  return "";
}

/** Parte un parrafo monolitico mas largo que MAX_FRAGMENTO en frases. */
function dividirLargo(p) {
  if (p.length <= MAX_FRAGMENTO) return [p];
  const frases = p.split(/(?<=[.;])\s+/);
  const salida = [];
  let buffer = "";
  for (const f of frases) {
    if (f.length > MAX_FRAGMENTO) {
      if (buffer) {
        salida.push(buffer);
        buffer = "";
      }
      for (let i = 0; i < f.length; i += MAX_FRAGMENTO) salida.push(f.slice(i, i + MAX_FRAGMENTO));
      continue;
    }
    if ((buffer ? buffer.length + 1 : 0) + f.length > MAX_FRAGMENTO) {
      if (buffer) salida.push(buffer);
      buffer = f;
    } else {
      buffer = buffer ? `${buffer} ${f}` : f;
    }
  }
  if (buffer) salida.push(buffer);
  return salida;
}

/* ------------------------------------------------------------------ */
/* Embeddings                                                          */
/* ------------------------------------------------------------------ */

/**
 * all-minilm:l6-v2 admite 512 tokens (el Modelfile de Ollama trae num_ctx=256, se
 * sube por peticion). Se recorta la entrada para no rozar el limite; el texto
 * completo del fragmento se conserva igualmente en `texto`.
 */
const MAX_ENTRADA = 1100;

function textoParaEmbeber(f) {
  // Se embebe el epigrafe de la seccion + el texto. NO se antepone el titulo del
  // documento: al repetirse en cientos de fragmentos diluye el vector y hace que
  // todo el documento se parezca a cualquier consulta generica.
  return `${f.epigrafe}. ${f.texto}`.slice(0, MAX_ENTRADA);
}

async function peticionEmbed(textos) {
  const r = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODELO,
      input: textos,
      truncate: true,
      // all-minilm:l6-v2 se publica con num_ctx=256; el modelo admite 512.
      options: { num_ctx: 512 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const datos = await r.json();
  if (!Array.isArray(datos.embeddings) || datos.embeddings.length !== textos.length) {
    throw new Error("respuesta inesperada de Ollama /api/embed");
  }
  return datos.embeddings;
}

/** Embebe un lote; si Ollama lo rechaza, lo parte a la mitad hasta que entre. */
async function embeber(textos) {
  try {
    return await peticionEmbed(textos);
  } catch (e) {
    if (textos.length === 1) {
      throw new Error(`Ollama /api/embed (${textos[0].length} chars): ${e instanceof Error ? e.message : e}`);
    }
    const mitad = Math.ceil(textos.length / 2);
    const a = await embeber(textos.slice(0, mitad));
    const b = await embeber(textos.slice(mitad));
    return [...a, ...b];
  }
}

function normalizar(v) {
  let suma = 0;
  for (const x of v) suma += x * x;
  const n = Math.sqrt(suma) || 1;
  return v.map((x) => Math.round((x / n) * 1e5) / 1e5);
}

/* ------------------------------------------------------------------ */
/* Programa                                                            */
/* ------------------------------------------------------------------ */

async function main() {
  const incidencias = [];
  const conPdf = hayPdftotext();
  if (!conPdf) incidencias.push("pdftotext (poppler) no disponible: se omiten los planes en PDF.");

  if (!soloIndexar) {
    for (const fuente of FUENTES) {
      log(`\n== ${fuente.slug}`);
      if (fuente.tipo === "pdf" && !conPdf) {
        log("   omitido: sin pdftotext");
        incidencias.push(`${fuente.slug}: omitido, falta pdftotext.`);
        continue;
      }
      let secciones;
      try {
        const buf = await descargar(fuente.fuente, { referer: fuente.referer });
        log(`   descargado ${(buf.length / 1024).toFixed(0)} kB`);
        secciones =
          fuente.tipo === "boe"
            ? seccionesDesdeBoe(buf.toString("utf8"))
            : seccionesDesdePdf(textoDesdePdf(buf, fuente), fuente);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`   ERROR: ${msg}`);
        incidencias.push(`${fuente.slug}: no se pudo obtener (${msg}).`);
        continue;
      }
      const destino = escribirMarkdown(fuente, secciones);
      log(`   ${secciones.length} secciones -> ${path.basename(destino)}`);
    }
  }

  if (soloDescargar) {
    log("\nSolo descarga solicitada, no se indexa.");
    return;
  }

  // --- troceado -----------------------------------------------------
  const archivos = fs
    .readdirSync(DIRECTORIO)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort();
  if (!archivos.length) throw new Error("No hay documentos .md que indexar");

  const fragmentos = [];
  const documentos = [];
  for (const archivo of archivos) {
    const { meta, secciones } = leerMarkdown(path.join(DIRECTORIO, archivo));
    let n = 0;
    for (const s of secciones) {
      const trozos = trocear(s.texto);
      trozos.forEach((texto, i) => {
        const referencia = trozos.length > 1 ? `${s.referencia} (${i + 1}/${trozos.length})` : s.referencia;
        fragmentos.push({
          id: `${meta.id}#${String(fragmentos.length).padStart(5, "0")}`,
          documento: meta.id,
          titulo: meta.titulo,
          titulo_corto: meta.titulo_corto || meta.titulo,
          epigrafe: s.epigrafe,
          url: meta.url,
          referencia,
          texto,
        });
        n += 1;
      });
    }
    documentos.push({
      documento: meta.id,
      identificador: meta.identificador,
      titulo: meta.titulo,
      titulo_corto: meta.titulo_corto || meta.titulo,
      url: meta.url,
      vigencia: meta.vigencia,
      fragmentos: n,
    });
    log(`   ${archivo}: ${n} fragmentos`);
  }
  log(`\nTotal: ${fragmentos.length} fragmentos`);

  // --- embeddings ---------------------------------------------------
  log(`Embeddings con ${MODELO} en ${OLLAMA_URL} (lotes de ${LOTE})…`);
  const t0 = Date.now();
  for (let i = 0; i < fragmentos.length; i += LOTE) {
    const lote = fragmentos.slice(i, i + LOTE);
    const vectores = await embeber(lote.map(textoParaEmbeber));
    lote.forEach((f, j) => {
      f.vector = normalizar(vectores[j]);
      delete f.titulo_corto;
      delete f.epigrafe;
    });
    if ((i / LOTE) % 10 === 0) {
      process.stdout.write(`   ${Math.min(i + LOTE, fragmentos.length)}/${fragmentos.length}\r`);
    }
  }
  const segundos = (Date.now() - t0) / 1000;
  log(`\nEmbeddings listos en ${segundos.toFixed(1)} s`);

  const dimension = fragmentos[0].vector.length;
  const indice = {
    version: 1,
    modelo: MODELO,
    dimension,
    normalizado: true,
    generado: hoy(),
    documentos,
    fragmentos,
  };
  const destino = path.join(DIRECTORIO, "indice.json");
  fs.writeFileSync(destino, JSON.stringify(indice), "utf8");
  log(`indice.json: ${(fs.statSync(destino).size / 1024 / 1024).toFixed(1)} MB, dimension ${dimension}`);

  if (incidencias.length) {
    log("\nIncidencias:");
    for (const i of incidencias) log(` - ${i}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
