// =====================================================================
// ATALAYA INCENDIOS · Respuestas JSON uniformes para la API
// ---------------------------------------------------------------------
// Propósito: que todas las rutas del núcleo contesten igual y con errores
// legibles ({ error: "..." }), y validar el cuerpo con zod en un solo sitio.
// DUEÑO: constructor A. Dependencias: zod.
// =====================================================================

import type { ZodType } from "zod";

export function json(datos: unknown, estado = 200): Response {
  return Response.json(datos as Record<string, unknown>, {
    status: estado,
    headers: { "Cache-Control": "no-store" },
  });
}

export function error(mensaje: string, estado = 400, extra?: Record<string, unknown>): Response {
  return json({ error: mensaje, ...extra }, estado);
}

export function mensajeDeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Lee y valida el cuerpo JSON. Devuelve `{ datos }` o `{ respuesta }` con el 400 ya formado. */
export async function cuerpoValidado<T>(peticion: Request, esquema: ZodType<T>): Promise<{ datos: T; respuesta?: undefined } | { datos?: undefined; respuesta: Response }> {
  let bruto: unknown;
  try {
    bruto = await peticion.json();
  } catch {
    return { respuesta: error("El cuerpo debe ser JSON válido", 400) };
  }
  const resultado = esquema.safeParse(bruto);
  if (!resultado.success) {
    const detalle = resultado.error.issues.map((i) => `${i.path.join(".") || "cuerpo"}: ${i.message}`).join("; ");
    return { respuesta: error(`Datos no válidos — ${detalle}`, 422) };
  }
  return { datos: resultado.data };
}
