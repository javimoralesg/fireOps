// =====================================================================
// Avisos meteorológicos oficiales. DUEÑO: constructor B.
// ---------------------------------------------------------------------
// · Meteoalarm (SIN clave, verificado §3.3): feed Atom con CAP 1.2 embebido
//   https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-spain
//   Meteoalarm reemite los avisos de AEMET → es el sustituto sin clave.
//   El nivel va en cap:parameter "awareness_level" ("2; yellow; Moderate").
// · AEMET (con AEMET_API_KEY, §3.2): patrón de DOS PASOS — la API devuelve
//   {"estado":200,"datos":"https://opendata.aemet.es/opendata/sh/XXXX"} y hay
//   que hacer un segundo GET. La respuesta del segundo paso es un TAR.GZ de
//   XMLs CAP en ISO-8859-15. Aquí se hace el primer paso y se descarga el
//   segundo; si el contenido no es XML plano se informa y se usa Meteoalarm.
// =====================================================================
import type { AvisoMeteo } from "../dominio/tipos";

const URL_METEOALARM = "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-spain";
const BASE_AEMET = "https://opendata.aemet.es/opendata";
const TIMEOUT_MS = 20_000;
const CACHE_MS = 10 * 60_000;

type Global = typeof globalThis & { __atalayaAvisos?: Map<string, { en: number; datos: AvisoMeteo[] }> };
const g = globalThis as Global;
const cache = () => (g.__atalayaAvisos ??= new Map());

export const aemetDisponible = (): boolean => Boolean(process.env.AEMET_API_KEY?.trim());

function entre(texto: string, abre: string, cierra: string): string | undefined {
  const i = texto.indexOf(abre);
  if (i < 0) return undefined;
  const j = texto.indexOf(cierra, i + abre.length);
  return j < 0 ? undefined : texto.slice(i + abre.length, j);
}

const limpiar = (v?: string) =>
  (v ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

function nivelDe(texto: string): AvisoMeteo["nivel"] | undefined {
  const t = texto.toLowerCase();
  if (t.includes("red") || t.includes("rojo") || /\b4\b/.test(t)) return "rojo";
  if (t.includes("orange") || t.includes("naranja") || /\b3\b/.test(t)) return "naranja";
  if (t.includes("yellow") || t.includes("amarillo") || /\b2\b/.test(t)) return "amarillo";
  return undefined;
}

/** Traduce los `cap:event` de Meteoalarm (vienen en inglés) a español. */
function fenomenoEnEspanol(evento: string): string {
  const t = evento.toLowerCase();
  if (t.includes("forest") || t.includes("fire")) return "Incendios forestales";
  if (t.includes("thunder")) return "Tormentas";
  if (t.includes("rain")) return "Lluvias";
  if (t.includes("wind")) return "Viento";
  if (t.includes("high-temperature") || t.includes("high temperature") || t.includes("heat")) return "Temperaturas máximas";
  if (t.includes("low-temperature") || t.includes("low temperature")) return "Temperaturas mínimas";
  if (t.includes("snow") || t.includes("ice")) return "Nieve o hielo";
  if (t.includes("coastal")) return "Fenómenos costeros";
  if (t.includes("fog")) return "Niebla";
  if (t.includes("avalanche")) return "Aludes";
  if (t.includes("flood")) return "Inundaciones";
  return evento.trim() || "Aviso meteorológico";
}

/** Avisos vigentes en España desde Meteoalarm (sin clave). */
export async function avisosMeteoalarmEspana(): Promise<AvisoMeteo[]> {
  const c = cache().get("meteoalarm");
  if (c && Date.now() - c.en < CACHE_MS) return c.datos;

  const res = await fetch(URL_METEOALARM, {
    // OJO: enviar cabecera Accept hace que el feed responda 406 (verificado); solo User-Agent.
    headers: { "User-Agent": "atalaya-incendios/1.0 (HackSpain 2026)" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Meteoalarm ${res.status} ${res.statusText}`);
  const xml = await res.text();

  const ahora = Date.now();
  const avisos: AvisoMeteo[] = [];
  for (const trozo of xml.split("<entry>").slice(1)) {
    const bloque = trozo.split("</entry>")[0];
    const zona = limpiar(entre(bloque, "<cap:areaDesc>", "</cap:areaDesc>"));
    const evento = limpiar(entre(bloque, "<cap:event>", "</cap:event>"));
    const desde = limpiar(entre(bloque, "<cap:effective>", "</cap:effective>")) || limpiar(entre(bloque, "<cap:onset>", "</cap:onset>"));
    const hasta = limpiar(entre(bloque, "<cap:expires>", "</cap:expires>"));
    const geocodigo = limpiar(entre(bloque, "<cap:geocode>", "</cap:geocode>"));
    const enlace = entre(bloque, '<link title="', '"/>');
    const url = enlace ? `https://meteoalarm.org?geocode=${encodeURIComponent(limpiar(entre(bloque, "<value>", "</value>")) || "")}` : undefined;

    // El color va en el <title> del entry ("Yellow Thunderstorm Warning issued
    // for Spain - <zona>"); `cap:severity` sirve de respaldo. En este feed NO
    // hay parámetro awareness_level (comprobado con el feed real de hoy).
    const titulo = limpiar(entre(bloque, "<title>", "</title>"));
    const severidad = limpiar(entre(bloque, "<cap:severity>", "</cap:severity>"));
    const nivel = nivelDe(titulo) ?? nivelDe(evento) ?? (severidad.toLowerCase() === "severe" ? "naranja" : severidad.toLowerCase() === "extreme" ? "rojo" : severidad.toLowerCase() === "moderate" ? "amarillo" : undefined);
    if (!zona || !nivel) continue;
    const fin = Date.parse(hasta);
    if (Number.isFinite(fin) && fin < ahora) continue; // caducado

    // El feed repite a veces el mismo aviso (mismo geocódigo, evento e inicio) en
    // dos <entry>: se queda uno solo, o React avisa de claves duplicadas.
    const id = `meteoalarm:${geocodigo.replace(/\s+/g, "")}:${evento}:${desde}`.slice(0, 160);
    if (avisos.some((a) => a.id === id)) continue;
    avisos.push({
      id,
      fuente: "Meteoalarm",
      fenomeno: fenomenoEnEspanol(evento),
      nivel,
      zona,
      desde: desde || new Date().toISOString(),
      hasta: hasta || "",
      url,
    });
  }
  cache().set("meteoalarm", { en: Date.now(), datos: avisos });
  return avisos;
}

/**
 * Avisos CAP de AEMET (requiere AEMET_API_KEY). `area` por defecto "esp".
 * Patrón de dos pasos obligatorio. El segundo paso devuelve un TAR.GZ: si no
 * se puede leer como XML se lanza un error explicando qué pasó (nada simulado).
 */
export async function avisosAemet(area = "esp"): Promise<AvisoMeteo[]> {
  const clave = process.env.AEMET_API_KEY?.trim();
  if (!clave) throw new Error("AEMET_API_KEY no configurada: se usan los avisos de Meteoalarm (sin clave).");

  const clavePaso1 = `aemet:${area}`;
  const c = cache().get(clavePaso1);
  if (c && Date.now() - c.en < CACHE_MS) return c.datos;

  const url1 = `${BASE_AEMET}/api/avisos_cap/ultimoelaborado/area/${encodeURIComponent(area)}`;
  const r1 = await fetch(url1, { headers: { api_key: clave, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  const t1 = await r1.text();
  let paso1: { estado?: number; datos?: string; descripcion?: string };
  try {
    paso1 = JSON.parse(t1);
  } catch {
    throw new Error(`AEMET paso 1 no devolvió JSON (${r1.status}): ${t1.slice(0, 160)}`);
  }
  if (paso1.estado !== 200 || !paso1.datos) throw new Error(`AEMET paso 1: ${paso1.estado ?? r1.status} ${paso1.descripcion ?? ""}`.trim());

  const r2 = await fetch(paso1.datos, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!r2.ok) throw new Error(`AEMET paso 2: ${r2.status} ${r2.statusText}`);
  const buffer = Buffer.from(await r2.arrayBuffer());
  // El paquete es TAR.GZ (empieza por 0x1f 0x8b). Descomprimirlo requiere zlib + tar:
  // aquí solo aceptamos respuesta XML plana; si viene comprimida lo decimos claro.
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    throw new Error(
      "AEMET devolvió un TAR.GZ de avisos CAP; esta versión solo lee XML plano. Los avisos vigentes se toman de Meteoalarm (que reemite los de AEMET).",
    );
  }
  const xml = buffer.toString("latin1"); // AEMET publica en ISO-8859-15
  const avisos: AvisoMeteo[] = [];
  for (const trozo of xml.split("<info>").slice(1)) {
    const bloque = trozo.split("</info>")[0];
    const zona = limpiar(entre(bloque, "<areaDesc>", "</areaDesc>"));
    const evento = limpiar(entre(bloque, "<event>", "</event>"));
    const nivel = nivelDe(bloque.includes("AEMET-Meteoalerta nivel") ? limpiar(entre(bloque.slice(bloque.indexOf("AEMET-Meteoalerta nivel")), "<value>", "</value>")) : limpiar(entre(bloque, "<severity>", "</severity>")));
    if (!zona || !nivel) continue;
    avisos.push({
      id: `aemet:${zona}:${evento}`.slice(0, 160),
      fuente: "AEMET",
      fenomeno: evento || "Aviso",
      nivel,
      zona,
      desde: limpiar(entre(bloque, "<onset>", "</onset>")) || new Date().toISOString(),
      hasta: limpiar(entre(bloque, "<expires>", "</expires>")) || "",
      url: url1,
    });
  }
  cache().set(clavePaso1, { en: Date.now(), datos: avisos });
  return avisos;
}

/** Avisos con la mejor fuente disponible: AEMET si hay clave, Meteoalarm siempre. */
export async function avisosEspana(): Promise<{ avisos: AvisoMeteo[]; fuente: string; detalle?: string }> {
  if (aemetDisponible()) {
    try {
      const avisos = await avisosAemet();
      if (avisos.length) return { avisos, fuente: "AEMET" };
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e);
      const avisos = await avisosMeteoalarmEspana();
      return { avisos, fuente: "Meteoalarm", detalle };
    }
  }
  return { avisos: await avisosMeteoalarmEspana(), fuente: "Meteoalarm" };
}
