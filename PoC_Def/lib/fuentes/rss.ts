// =====================================================================
// Google News RSS (sin clave). DUEÑO: constructor B.
// Verificado (§4.1): https://news.google.com/rss/search?q=...&hl=es&gl=ES&ceid=ES:es
// 105 items, 185 KB. Los <link> son redirecciones de Google en base64; el
// medio se saca del <source> o del sufijo del título ("Titular - Medio").
// Parser XML sin dependencias (no hay librería de RSS en el proyecto).
// Solo titulares de los últimos 15 días (lib/fuentes/recencia.ts): se pide
// con el operador `when:15d` y además se filtra por <pubDate> al parsear.
// =====================================================================
import { MAX_DIAS_PRENSA, esReciente } from "./recencia";

export interface NoticiaRss {
  id: string;
  titulo: string;
  url: string;
  medio?: string;
  publicado?: string;
  fuente: "Google News";
}

const TIMEOUT_MS = 8_000;
const UA = "atalaya-incendios/1.0 (HackSpain 2026)";

// Caché por consulta con deduplicación de vuelos (constructor T, 2026-09-19).
// No había ninguna: la salud de fuentes, el agente de prensa y cada refresco de
// /api/fuentes/prensa pedían los mismos 185 KB a Google a la vez. Los titulares
// no cambian en 5 minutos. Los FALLOS no se cachean: Google News responde en
// medio segundo, así que un error aquí es informativo y no cuesta nada repetirlo.
const CACHE_MS = 5 * 60_000;
type Global = typeof globalThis & {
  __atalayaRss?: Map<string, { en: number; datos: NoticiaRss[] }>;
  __atalayaRssVuelos?: Map<string, Promise<NoticiaRss[]>>;
};
const g = globalThis as Global;
const cache = () => (g.__atalayaRss ??= new Map());
const vuelos = () => (g.__atalayaRssVuelos ??= new Map());

function entre(texto: string, abre: string, cierra: string): string | undefined {
  const i = texto.indexOf(abre);
  if (i < 0) return undefined;
  const j = texto.indexOf(cierra, i + abre.length);
  return j < 0 ? undefined : texto.slice(i + abre.length, j);
}

/** Quita CDATA y desescapa las entidades XML más frecuentes. */
function limpiar(v: string | undefined): string {
  if (!v) return "";
  return v
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function urlGoogleNews(consulta: string): string {
  // `when:Nd` es un operador de búsqueda de Google Noticias. Sin él, la
  // consulta "incendio forestal" devolvía 105 titulares desde el 12 de julio;
  // con when:15d, 100 titulares desde el 11 de septiembre (comprobado el
  // 2026-09-19). El filtro por <pubDate> de abajo cubre el caso de que
  // Google ignore el operador.
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${consulta} when:${MAX_DIAS_PRENSA}d`)}&hl=es&gl=ES&ceid=ES:es`;
}

/** Titulares recientes de Google Noticias para una consulta en español. */
export async function noticiasGoogle(consulta: string, limite = 20): Promise<NoticiaRss[]> {
  const clave = consulta.trim().toLowerCase();
  const c = cache().get(clave);
  if (c && Date.now() - c.en < CACHE_MS) return c.datos.slice(0, limite);
  const enVuelo = vuelos().get(clave);
  if (enVuelo) return (await enVuelo).slice(0, limite);
  // Se pide SIEMPRE el máximo y se recorta al devolver: así una petición de 5
  // titulares y otra de 20 comparten la misma llamada a Google.
  const promesa = descargarNoticias(consulta)
    .then((todas) => {
      cache().set(clave, { en: Date.now(), datos: todas });
      return todas;
    })
    .finally(() => vuelos().delete(clave));
  vuelos().set(clave, promesa);
  return (await promesa).slice(0, limite);
}

async function descargarNoticias(consulta: string): Promise<NoticiaRss[]> {
  const limite = 100;
  const url = urlGoogleNews(consulta);
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml,application/xml,text/xml" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google News RSS ${res.status} ${res.statusText}`);
  const xml = await res.text();

  const noticias: NoticiaRss[] = [];
  for (const trozo of xml.split("<item>").slice(1)) {
    const bloque = trozo.split("</item>")[0];
    const titulo = limpiar(entre(bloque, "<title>", "</title>"));
    const enlace = limpiar(entre(bloque, "<link>", "</link>"));
    if (!titulo || !enlace) continue;
    const guid = limpiar(entre(bloque, "<guid isPermaLink=\"false\">", "</guid>")) || enlace;
    const pub = limpiar(entre(bloque, "<pubDate>", "</pubDate>"));
    const bloqueFuente = entre(bloque, "<source ", "</source>");
    const medio = bloqueFuente ? limpiar(bloqueFuente.split(">").slice(1).join(">")) : titulo.split(" - ").slice(-1)[0];
    const t = pub ? Date.parse(pub) : NaN;
    const publicado = Number.isFinite(t) ? new Date(t).toISOString() : undefined;
    if (!esReciente(publicado)) continue;
    noticias.push({
      id: `gnews:${guid}`,
      titulo,
      url: enlace,
      medio: medio || undefined,
      publicado,
      fuente: "Google News",
    });
    if (noticias.length >= limite) break;
  }
  return noticias;
}
