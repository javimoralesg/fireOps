// POST /api/happyrobot/situar · Herramienta «situar_lugar» del agente de voz del 112
// virtual: interpreta con IA lo que dicta la persona (corrige la transcripción, separa
// vía, número, lugar conocido, barrio y municipio), lo sitúa con Nominatim y devuelve con
// qué precisión, para que el AGENTE lo confirme en la llamada antes de registrar el aviso.
// Guarda el punto por run: registrar_aviso usa ese y no las coordenadas que repita el agente.
// Responde SIEMPRE 200 con todas las claves (también a la prueba de nodo de la plataforma):
// es lo que hace que HappyRobot deje ver al agente cada campo. Exige el secreto.
// DUEÑO: sesión fireops-82 (2026-09-19). Lógica en lib/happyrobot/entrante.ts y ubicacion-ia.ts.
import { verificarWebhook } from "@/lib/happyrobot/cliente";
import { situarLugar, situarSinDatos } from "@/lib/happyrobot/entrante";
import { error, json, mensajeDeError } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limpio = (v: unknown): string | undefined => (typeof v === "string" && v.trim() && !/^\{\{\$var:/.test(v.trim()) ? v.trim() : undefined);

export async function POST(peticion: Request): Promise<Response> {
  if (!verificarWebhook(peticion.headers)) return error("Cabecera x-webhook-secret ausente o incorrecta", 401);
  let bruto: unknown;
  try {
    bruto = await peticion.json();
  } catch {
    return error("El cuerpo debe ser JSON", 400);
  }
  const c = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const anidado = (c.data ?? c.payload ?? c.arguments) as Record<string, unknown> | undefined;
  const cuerpo = anidado && typeof anidado === "object" && !Array.isArray(anidado) ? { ...anidado, ...c } : c;
  const lugar = limpio(cuerpo.lugar) ?? limpio(cuerpo.direccion) ?? limpio(cuerpo.referencia);
  const municipio = limpio(cuerpo.municipio) ?? limpio(cuerpo.pueblo);
  const runId = limpio(cuerpo.run_id) ?? limpio(cuerpo.runId);
  if (!lugar && !municipio) return json(situarSinDatos());
  try {
    return json(await situarLugar({ lugar, municipio }, { runId }));
  } catch (e) {
    return error(`No se pudo situar el lugar: ${mensajeDeError(e)}`, 500);
  }
}
