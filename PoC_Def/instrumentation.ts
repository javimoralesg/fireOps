// =====================================================================
// ATALAYA INCENDIOS · Arranque del proceso (Next 16, instrumentation)
// ---------------------------------------------------------------------
// `register()` se ejecuta UNA vez por instancia del servidor y antes de
// atender la primera petición. Aquí se enciende el orquestador: el bucle
// de agentes, el reloj de mundo y la persistencia. Estable desde Next 15,
// sin nada que activar en next.config.ts.
// El archivo va en la RAÍZ del proyecto (no hay carpeta src/).
// DUEÑO: constructor A.
// =====================================================================

export async function register(): Promise<void> {
  // El bucle solo tiene sentido en el runtime Node (nunca en edge).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Import dinámico: así el módulo del motor no entra en el bundle de edge.
  if (process.env.ORQUESTADOR_DESACTIVADO === "1") {
    console.log("[instrumentation] ORQUESTADOR_DESACTIVADO=1: este proceso solo sirve la interfaz y la API");
    return;
  }
  const { arrancarOrquestador } = await import("./lib/motor/orquestador");
  arrancarOrquestador();
}

/** Errores del servidor al registro de diagnóstico (sin romper la petición). */
export async function onRequestError(error: unknown, peticion: { path: string; method: string }): Promise<void> {
  console.error(`[atalaya] error en ${peticion.method} ${peticion.path}:`, error);
}
