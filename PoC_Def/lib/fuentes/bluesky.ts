// =====================================================================
// Bluesky (AT Protocol) sin clave. DUEÑO: constructor B.
// Verificado (§4.2): el host que funciona es api.bsky.app
// (public.api.bsky.app devuelve 403 en searchPosts).
//   https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=...&lang=es&limit=25
// CORS `*`. Sin cabeceras de rate limit documentadas; se usa con cadencia baja.
// Solo publicaciones de los últimos 15 días (lib/fuentes/recencia.ts): se
// pide con `since` y además se filtra por createdAt al parsear, porque
// `since` compara contra sortAt y un post puede llevar un createdAt antiguo.
// =====================================================================
import { desdeVentana, esReciente } from "./recencia";

export interface PostBluesky {
  id: string; // uri AT
  texto: string;
  autor: string;
  creadoEn?: string;
  url: string;
  fuente: "Bluesky";
}

const BASE = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts";
const TIMEOUT_MS = 8_000;

// Caché corta con deduplicación de vuelos (constructor T, 2026-09-19): la
// salud de fuentes y el agente de redes pedían la misma búsqueda a la vez.
// Los fallos NO se cachean: el error debe seguir viéndose en cada comprobación.
const CACHE_MS = 2 * 60_000;
type Global = typeof globalThis & {
  __atalayaBluesky?: Map<string, { en: number; datos: PostBluesky[] }>;
  __atalayaBlueskyVuelos?: Map<string, Promise<PostBluesky[]>>;
};
const g = globalThis as Global;
const cache = () => (g.__atalayaBluesky ??= new Map());
const vuelos = () => (g.__atalayaBlueskyVuelos ??= new Map());

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
  const lang = opciones.lang ?? "es";
  const orden = opciones.orden ?? "latest";
  const clave = `${consulta.trim().toLowerCase()}|${lang}|${orden}`;
  const c = cache().get(clave);
  if (c && Date.now() - c.en < CACHE_MS) return c.datos.slice(0, limite);
  const enVuelo = vuelos().get(clave);
  if (enVuelo) return (await enVuelo).slice(0, limite);
  const promesa = descargarPosts(consulta, lang, orden)
    .then((todos) => {
      cache().set(clave, { en: Date.now(), datos: todos });
      return todos;
    })
    .finally(() => vuelos().delete(clave));
  vuelos().set(clave, promesa);
  return (await promesa).slice(0, limite);
}

/** Se pide siempre el máximo (50) y se recorta al devolver: una sola llamada sirve a todos. */
async function descargarPosts(consulta: string, lang: string, orden: "latest" | "top"): Promise<PostBluesky[]> {
  const url = `${BASE}?q=${encodeURIComponent(consulta)}&lang=${lang}&limit=50&sort=${orden}&since=${encodeURIComponent(desdeVentana())}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "atalaya-incendios/1.0" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Bluesky ${res.status} ${res.statusText}`);
  const j = (await res.json()) as RespuestaBluesky;
  return (j.posts ?? [])
    .filter((p) => p.record?.text)
    .filter((p) => esReciente(p.record?.createdAt ?? p.indexedAt))
    .map((p) => ({
      id: p.uri,
      texto: (p.record?.text ?? "").trim(),
      autor: p.author?.displayName || p.author?.handle || "desconocido",
      creadoEn: p.record?.createdAt ?? p.indexedAt,
      url: urlPost(p.uri, p.author?.handle),
      fuente: "Bluesky" as const,
    }));
}
