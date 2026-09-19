// =====================================================================
// Google News RSS (sin clave). DUEÑO: constructor B.
// Verificado (§4.1): https://news.google.com/rss/search?q=...&hl=es&gl=ES&ceid=ES:es
// 105 items, 185 KB. Los <link> son redirecciones de Google en base64; el
// medio se saca del <source> o del sufijo del título ("Titular - Medio").
// Parser XML sin dependencias (no hay librería de RSS en el proyecto).
// =====================================================================

export interface NoticiaRss {
  id: string;
  titulo: string;
  url: string;
  medio?: string;
  publicado?: string;
  fuente: "Google News";
}

const TIMEOUT_MS = 15_000;
const UA = "atalaya-incendios/1.0 (HackSpain 2026)";

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
  return `https://news.google.com/rss/search?q=${encodeURIComponent(consulta)}&hl=es&gl=ES&ceid=ES:es`;
}

/** Titulares recientes de Google Noticias para una consulta en español. */
export async function noticiasGoogle(consulta: string, limite = 20): Promise<NoticiaRss[]> {
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
    noticias.push({
      id: `gnews:${guid}`,
      titulo,
      url: enlace,
      medio: medio || undefined,
      publicado: Number.isFinite(t) ? new Date(t).toISOString() : undefined,
      fuente: "Google News",
    });
    if (noticias.length >= limite) break;
  }
  return noticias;
}
