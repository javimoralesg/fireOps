// =====================================================================
// Exa · búsqueda semántica de noticias. DUEÑO: constructor B.
// POST https://api.exa.ai/search con cabecera x-api-key.
// Requiere EXA_API_KEY: sin ella se lanza un error claro y el agente de
// prensa se queda con Google News RSS + Bluesky (que no necesitan clave).
// =====================================================================

const URL_EXA = "https://api.exa.ai/search";
const TIMEOUT_MS = 20_000;

export interface NoticiaExa {
  id: string;
  titulo: string;
  url: string;
  publicado?: string;
  extracto: string;
  fuente: "Exa";
}

export const exaDisponible = (): boolean => Boolean(process.env.EXA_API_KEY?.trim());

interface FilaExa {
  id?: string;
  title?: string | null;
  url?: string;
  publishedDate?: string | null;
  text?: string | null;
  summary?: string | null;
}

/** Busca noticias recientes sobre una consulta (category "news", España). */
export async function buscarNoticias(
  consulta: string,
  opciones: { horas?: number; max?: number } = {},
): Promise<NoticiaExa[]> {
  const clave = process.env.EXA_API_KEY?.trim();
  if (!clave) {
    throw new Error("EXA_API_KEY no configurada: la búsqueda semántica de Exa está desactivada (se usa Google News RSS).");
  }
  const cuerpo = {
    query: consulta,
    type: "auto",
    category: "news",
    numResults: Math.max(1, Math.min(25, opciones.max ?? 10)),
    userLocation: "ES",
    maxAgeHours: Math.max(1, Math.min(720, opciones.horas ?? 24)),
    contents: { text: { maxCharacters: 600 } },
  };
  const res = await fetch(URL_EXA, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": clave },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Exa ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 160)}`);
  const j = (await res.json()) as { results?: FilaExa[] };
  return (j.results ?? [])
    .filter((r) => Boolean(r.url))
    .map((r) => ({
      id: `exa:${r.id ?? r.url}`,
      titulo: (r.title ?? "").trim() || (r.url as string),
      url: r.url as string,
      publicado: r.publishedDate ? new Date(r.publishedDate).toISOString() : undefined,
      extracto: ((r.text ?? r.summary ?? "").trim()).slice(0, 600),
      fuente: "Exa" as const,
    }));
}
