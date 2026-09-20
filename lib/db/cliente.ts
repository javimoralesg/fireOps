// Cliente Supabase de servidor (contrato). DUEÑO: constructor A. Devuelve null si no hay configuración.
//
// TIEMPO MÁXIMO (2026-09-19): supabase-js llama a `fetch` sin límite, así que con
// la base colgada (statement_timeout de 8 s en PostgREST, caché de esquema caída,
// 521 de Cloudflare) cualquier ruta que la esperase se quedaba minutos parada y el
// navegador se rendía a los 20 s con «La petición ha tardado demasiado». Cada
// petición a Supabase se corta a SUPABASE_TIMEOUT_MS (15 s por defecto) con un
// error legible; quien la esperaba decide qué hacer (la persistencia periódica
// reintenta con retroceso, las rutas de la API contestan con lo que hay en memoria).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const TIEMPO_MAXIMO_POR_DEFECTO_MS = 15_000;

let cliente: SupabaseClient | null | undefined;

/** Milisegundos antes de cortar una petición a Supabase (`SUPABASE_TIMEOUT_MS`). */
export function tiempoMaximoSupabaseMs(): number {
  const n = Number(process.env.SUPABASE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : TIEMPO_MAXIMO_POR_DEFECTO_MS;
}

/** `fetch` con tiempo máximo; respeta la señal de cancelación que ya traiga la petición. */
async function fetchConTiempoMaximo(entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const ms = tiempoMaximoSupabaseMs();
  const limite = AbortSignal.timeout(ms);
  const signal = init?.signal ? AbortSignal.any([init.signal, limite]) : limite;
  try {
    return await fetch(entrada, { ...init, signal });
  } catch (e) {
    if (limite.aborted) throw new Error(`Supabase no respondió en ${Math.round(ms / 1000)} s`);
    throw e;
  }
}

export function obtenerClienteSupabase(): SupabaseClient | null {
  if (cliente !== undefined) return cliente;
  const url = process.env.SUPABASE_URL?.trim();
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  // `db.retry: false`: desde supabase-js 2.116 las lecturas (GET) se reintentan
  // solas 3 veces con esperas de 1, 2 y 4 s ante errores de red, 503 o 520, y
  // con la base colgada eso son CUATRO tiempos máximos seguidos (67 s) por una
  // sola consulta. Los reintentos ya los hace la persistencia con retroceso.
  cliente =
    url && clave
      ? createClient(url, clave, { auth: { persistSession: false }, db: { retry: false }, global: { fetch: fetchConTiempoMaximo } })
      : null;
  return cliente;
}
