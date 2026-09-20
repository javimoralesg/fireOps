// =====================================================================
// ATALAYA INCENDIOS · Formato de teléfonos (módulo ISOMORFO, sin dependencias)
// ---------------------------------------------------------------------
// Lo usan el portal ciudadano (cliente) y lib/happyrobot/entrante.ts (servidor)
// para enseñar el número del 112 virtual de HappyRobot de forma legible.
// DUEÑO: sesión fireops-82 (2026-09-19).
// =====================================================================

/** Prefijos de país de un dígito (E.164). */
const PAIS_1 = new Set(["1", "7"]);
/** Prefijos de país de dos dígitos; el resto de los que empiezan igual son de tres. */
const PAIS_2 = new Set(["20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44", "45", "46", "47", "48", "49", "51", "52", "53", "54", "55", "56", "57", "58", "60", "61", "62", "63", "64", "65", "66", "81", "82", "84", "86", "90", "91", "92", "93", "94", "95", "98"]);

/**
 * "+15734018744" → "+1 573 401 8744"; "+34600111222" → "+34 600 111 222".
 * Si no parece un E.164, se devuelve tal cual (nunca se inventa un formato).
 */
export function formatearTelefono(e164: string): string {
  const limpio = e164.replace(/[\s().-]/g, "");
  if (!/^\+\d{7,15}$/.test(limpio)) return e164.trim();
  const digitos = limpio.slice(1);
  const pais = PAIS_1.has(digitos[0]) ? digitos[0] : PAIS_2.has(digitos.slice(0, 2)) ? digitos.slice(0, 2) : digitos.slice(0, 3);
  const resto = digitos.slice(pais.length);
  if (pais === "1" && resto.length === 10) return `+1 ${resto.slice(0, 3)} ${resto.slice(3, 6)} ${resto.slice(6)}`;
  const grupos = resto.match(/\d{1,3}/g) ?? [resto];
  return `+${pais} ${grupos.join(" ")}`;
}

/** true si el texto parece un teléfono marcable (E.164 o con separadores). */
export function pareceTelefono(texto: string | undefined): boolean {
  return typeof texto === "string" && /^\+?\d[\d\s().-]{5,}\d$/.test(texto.trim());
}
