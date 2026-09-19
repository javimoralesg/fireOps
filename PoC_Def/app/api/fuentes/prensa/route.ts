// GET /api/fuentes/prensa?q=... · DUEÑO: constructor B.
// Google News RSS + Bluesky (sin clave) y Exa si hay EXA_API_KEY. Cada fuente
// informa por separado de su resultado o de su error: nada se inventa.
import { buscarPosts } from "@/lib/fuentes/bluesky";
import { buscarNoticias, exaDisponible } from "@/lib/fuentes/exa";
import { noticiasGoogle } from "@/lib/fuentes/rss";

export const dynamic = "force-dynamic";

/** Número de un parámetro; NaN si no viene (ojo: Number(null) es 0). */
function num(url: URL, nombre: string, porDefecto = NaN): number {
  const v = url.searchParams.get(nombre);
  return v === null || v.trim() === "" ? porDefecto : Number(v);
}


export async function GET(peticion: Request) {
  const url = new URL(peticion.url);
  const q = (url.searchParams.get("q") ?? "incendio forestal").trim();
  const max = Math.max(1, Math.min(30, num(url, "max", 10)));

  const [rss, posts, exa] = await Promise.allSettled([
    noticiasGoogle(q, max),
    buscarPosts(q, { limite: max }),
    exaDisponible() ? buscarNoticias(q, { horas: 48, max }) : Promise.reject(new Error("EXA_API_KEY no configurada")),
  ]);

  const desplegar = <T,>(r: PromiseSettledResult<T[]>) =>
    r.status === "fulfilled" ? { ok: true, items: r.value } : { ok: false, error: r.reason instanceof Error ? r.reason.message : String(r.reason), items: [] as T[] };

  return Response.json({
    consulta: q,
    googleNews: desplegar(rss),
    bluesky: desplegar(posts),
    exa: desplegar(exa),
  });
}
