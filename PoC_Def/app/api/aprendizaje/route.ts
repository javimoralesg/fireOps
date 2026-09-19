// Ejecuciones, métricas, lecciones y uso de los modelos. DUEÑO: constructor C.
// RENDIMIENTO (constructor S, 2026-09-19): la respuesta NUNCA lleva los vectores
// `embedding` (512 números por lección: los quita `listarLecciones`) y se sirve
// con ETag, así el sondeo cada 20 s de /aprendizaje se resuelve con un 304 sin
// cuerpo mientras no cambie nada. Con `?desde=<ISO>` solo vuelven las lecciones
// creadas después de esa fecha (`leccionesDesde: true` en la respuesta).
import { createHash } from "node:crypto";
import { listarEjecuciones, listarLecciones } from "@/lib/aprendizaje/memoria";
import { estadisticasLLM } from "@/lib/ia/llm";
import { estadisticasEmbeddings } from "@/lib/ia/embeddings";
import { obtenerEstado } from "@/lib/motor/estado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request) {
  const estado = obtenerEstado();
  const [ejecuciones, lecciones] = await Promise.all([listarEjecuciones(), listarLecciones()]);

  // La ejecución en curso puede no estar aún en el histórico persistido.
  const enCurso = estado.ejecucion;
  const todas = ejecuciones.some((e) => e.id === enCurso.id) ? ejecuciones : [enCurso, ...ejecuciones];

  const desde = new URL(peticion.url).searchParams.get("desde")?.trim();
  const filtradas = desde ? lecciones.filter((l) => l.creadaEn > desde) : lecciones;

  const cuerpo = JSON.stringify({
    ejecucionActual: enCurso.id,
    ejecuciones: todas.sort((a, b) => b.inicio.localeCompare(a.inicio)),
    lecciones: filtradas,
    leccionesDesde: !!desde,
    leccionesTotales: lecciones.length,
    estadisticasLLM: estadisticasLLM(),
    estadisticasEmbeddings: estadisticasEmbeddings(),
  });

  const etag = `W/"${createHash("sha1").update(cuerpo).digest("base64url")}"`;
  if (peticion.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-cache" } });
  }
  return new Response(cuerpo, {
    headers: { "Content-Type": "application/json; charset=utf-8", ETag: etag, "Cache-Control": "no-cache" },
  });
}
