// =====================================================================
// Ventana de recencia de prensa y redes. DUEÑO: constructor B.
// Las publicaciones de las que se nutre el agente de prensa tienen como
// mucho 15 días (decisión 2026-09-19). Sin esta ventana Google News devolvía
// titulares de hace más de dos meses y el modelo podía tomarlos por
// incendios activos. La aplican las tres fuentes (rss.ts, bluesky.ts, exa.ts)
// y, por si acaso, el propio agente antes de analizar nada.
// =====================================================================

export const MAX_DIAS_PRENSA = 15;
export const MAX_HORAS_PRENSA = MAX_DIAS_PRENSA * 24;
export const MAX_MS_PRENSA = MAX_DIAS_PRENSA * 86_400_000;

/**
 * true si la fecha ISO cae dentro de la ventana. Sin fecha, o con una fecha
 * ilegible, no se puede juzgar y se deja pasar: el modelo decide.
 */
export function esReciente(fechaIso: string | undefined, ahora = Date.now()): boolean {
  if (!fechaIso) return true;
  const t = Date.parse(fechaIso);
  if (!Number.isFinite(t)) return true;
  return ahora - t <= MAX_MS_PRENSA;
}

/** Instante ISO en que empieza la ventana (para parámetros `since` de las APIs). */
export function desdeVentana(ahora = Date.now()): string {
  return new Date(ahora - MAX_MS_PRENSA).toISOString();
}
