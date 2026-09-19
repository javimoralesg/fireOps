// =====================================================================
// Bluesky (AT Protocol) sin clave. DUEÑO: constructor B.
// Verificado (§4.2): el host que funciona es api.bsky.app
// (public.api.bsky.app devuelve 403 en searchPosts).
//   https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=...&lang=es&limit=25
// CORS `*`. Sin cabeceras de rate limit documentadas; se usa con cadencia baja.
// =====================================================================

export interface PostBluesky {
  id: string; // uri AT
  texto: string;
  autor: string;
  creadoEn?: string;
  url: string;
  fuente: "Bluesky";
}

const BASE = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts";
const TIMEOUT_MS = 15_000;

interface RespuestaBluesky {
  posts?: {
    uri: string;
    author?: { handle?: string; displayName?: string };
    record?: { text?: string; createdAt?: string };
    indexedAt?: string;
  }[];
}

/** URL pública del post a partir de su URI AT (at://did/app.bsky.feed.post/rkey). */
function urlPost(uri: string, handle?: string): string {
  const rkey = uri.split("/").pop() ?? "";
  return handle ? `https://bsky.app/profile/${handle}/post/${rkey}` : `https://bsky.app/`;
}

/** Busca posts recientes en español. Lanza si el servicio falla: nada simulado. */
export async function buscarPosts(
  consulta: string,
  opciones: { lang?: string; limite?: number; orden?: "latest" | "top" } = {},
): Promise<PostBluesky[]> {
  const limite = Math.max(1, Math.min(50, opciones.limite ?? 15));
  const url = `${BASE}?q=${encodeURIComponent(consulta)}&lang=${opciones.lang ?? "es"}&limit=${limite}&sort=${opciones.orden ?? "latest"}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "atalaya-incendios/1.0" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Bluesky ${res.status} ${res.statusText}`);
  const j = (await res.json()) as RespuestaBluesky;
  return (j.posts ?? [])
    .filter((p) => p.record?.text)
    .map((p) => ({
      id: p.uri,
      texto: (p.record?.text ?? "").trim(),
      autor: p.author?.displayName || p.author?.handle || "desconocido",
      creadoEn: p.record?.createdAt ?? p.indexedAt,
      url: urlPost(p.uri, p.author?.handle),
      fuente: "Bluesky" as const,
    }));
}
