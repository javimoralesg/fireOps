// Búsqueda real de prensa sin clave: RSS de Google Noticias (edición España).
// Sustituye a Exa cuando no hay EXA_API_KEY. Devuelve titulares reales con su
// fecha de publicación (sirve para contexto reciente y para detectar material
// reciclado). Si la red falla, lanza: nunca devuelve resultados inventados.

const BASE = "https://news.google.com/rss/search";
export const URL_PRENSA = BASE;

export interface NoticiaPrensa {
  titulo: string;
  url: string;
  publicado?: string; // ISO
  extracto: string;
  medio?: string;
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodificar(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, e: string) => ENTIDADES[e.toLowerCase()] ?? m);
}
const sinEtiquetas = (s: string) => decodificar(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function campo(item: string, nombre: string): string | undefined {
  const m = item.match(new RegExp(`<${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</${nombre}>`, "i"));
  return m ? decodificar(m[1]).trim() : undefined;
}

export function parsearRss(xml: string): NoticiaPrensa[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  const out: NoticiaPrensa[] = [];
  for (const it of items) {
    const titulo = campo(it, "title");
    const url = campo(it, "link");
    if (!titulo || !url) continue;
    const fecha = campo(it, "pubDate");
    const d = fecha ? new Date(fecha) : null;
    out.push({
      titulo,
      url,
      publicado: d && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined,
      extracto: sinEtiquetas(campo(it, "description") ?? "").slice(0, 400),
      medio: campo(it, "source"),
    });
  }
  return out;
}

/**
 * Titulares reales sobre `consulta`. `horas` acota a las últimas N horas
 * (operador `when:` de Google Noticias, más filtro local por fecha).
 */
export async function buscarPrensa(consulta: string, opts: { horas?: number; max?: number } = {}): Promise<NoticiaPrensa[]> {
  const q = opts.horas ? `${consulta} when:${Math.max(1, Math.round(opts.horas))}h` : consulta;
  const url = `${BASE}?q=${encodeURIComponent(q)}&hl=es&gl=ES&ceid=ES:es`;
  const r = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; Atalaya-PoC/1.0)" },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`prensa rss ${r.status}`);
  let noticias = parsearRss(await r.text());
  if (opts.horas) {
    const desde = Date.now() - opts.horas * 3_600_000;
    noticias = noticias.filter((n) => !n.publicado || new Date(n.publicado).getTime() >= desde);
  }
  return noticias.slice(0, opts.max ?? 6);
}
