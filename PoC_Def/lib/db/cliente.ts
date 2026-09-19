// Cliente Supabase de servidor (contrato). DUEÑO: constructor A. Devuelve null si no hay configuración.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cliente: SupabaseClient | null | undefined;

export function obtenerClienteSupabase(): SupabaseClient | null {
  if (cliente !== undefined) return cliente;
  const url = process.env.SUPABASE_URL?.trim();
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  cliente = url && clave ? createClient(url, clave, { auth: { persistSession: false } }) : null;
  return cliente;
}
