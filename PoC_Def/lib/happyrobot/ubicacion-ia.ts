// =====================================================================
// ATALAYA INCENDIOS · Interpretación con IA del lugar dictado por teléfono
// ---------------------------------------------------------------------
// Propósito: lo que llega del agente de voz es lo que entendió el reconocimiento
// de voz, con sus errores ("Arabaca" por Aravaca, "Autorcomunicación" por
// Telecomunicación, "treinta" en letras) y sin estructura. Antes de preguntar a
// Nominatim, el modelo rápido lo interpreta: corrige lo que suena mal, separa
// vía, número, carretera y kilómetro, lugar conocido, barrio y municipio, y
// propone consultas en el formato que Nominatim entiende, de la más precisa a
// la más vaga. `situarLugar` (lib/happyrobot/entrante.ts) prueba primero estas y
// después las de las reglas deterministas, así que si la IA no está o tarda,
// todo sigue funcionando igual que antes.
// Reglas: nunca inventar un número de portal ni un kilómetro que la persona no
// dijo; si deduce el municipio (no lo dijo la persona) lo marca, y el agente lo
// confirma de viva voz. Módulo PURO salvo `interpretarLugarConIA`.
// DUEÑO: sesión fireops-82 (2026-09-19). Dependencias: lib/ia/llm (papel "rapido").
// =====================================================================
import { z } from "zod";

/** Tope para la interpretación: la persona está esperando al teléfono. */
export const TIEMPO_MAX_IA_MS = Number(process.env.HAPPYROBOT_UBICACION_IA_MS ?? 5000);

const PRECISIONES = ["direccion", "lugar", "barrio", "municipio"] as const;

export const esquemaInterpretacion = z.object({
  lugarCorregido: z.string().describe("El lugar tal y como lo quiso decir la persona, con los errores de transcripción corregidos y los números en cifras"),
  via: z.string().describe("Tipo y nombre de la vía ('Avenida Complutense', 'Calle Mayor', 'N-403'); vacío si no hay vía"),
  numero: z.string().describe("Número de portal que DIJO la persona, en cifras; vacío si no lo dijo"),
  kilometro: z.string().describe("Punto kilométrico que DIJO la persona, en cifras; vacío si no lo dijo"),
  lugarConocido: z.string().describe("Edificio, paraje, urbanización o sitio conocido, con su nombre oficial; vacío si no hay"),
  barrio: z.string().describe("Barrio, distrito o pedanía; vacío si no hay"),
  municipio: z.string().describe("Municipio (el término municipal, no el barrio); vacío si no se puede saber"),
  provincia: z.string().describe("Provincia; vacío si no se puede saber"),
  municipioDeducido: z.boolean().describe("true si el municipio NO lo dijo la persona y lo has deducido por la vía o el lugar"),
  correcciones: z.string().describe("Qué has corregido de la transcripción, en una frase; vacío si nada"),
  consultas: z
    .array(z.object({ consulta: z.string(), precision: z.enum(PRECISIONES) }))
    .describe("De 1 a 4 consultas para Nominatim (OpenStreetMap), de la más precisa a la más vaga, sin 'España'"),
});

export type InterpretacionLugar = z.infer<typeof esquemaInterpretacion>;

export const SISTEMA_UBICACION = `Eres un operador del 112 en España. Te llega el lugar de un incendio tal y como lo transcribió el reconocimiento de voz de una llamada: puede tener errores fonéticos, números en letras y coletillas.
Tu trabajo es interpretarlo para buscarlo en OpenStreetMap (Nominatim):
- Corrige errores de transcripción evidentes por el sonido y el contexto (p. ej. "Arabaca" → "Aravaca", "Autorcomunicación" → "Telecomunicación", "Majadaonda" → "Majadahonda"). No cambies nombres que ya son correctos.
- Números en cifras ("treinta" → 30). NUNCA inventes un número de portal ni un kilómetro que la persona no dijo.
- Separa vía, número, carretera y kilómetro, lugar conocido (edificio, paraje, urbanización), barrio y municipio. Un barrio o distrito (Aravaca, Moncloa, Ciudad Universitaria, Vallecas) NO es el municipio: el municipio es Madrid.
- Si la persona no dijo el municipio pero la vía o el lugar lo identifican sin duda, dedúcelo y marca municipioDeducido=true. Si hay duda, déjalo vacío.
- Consultas para Nominatim: primero "vía número, municipio"; después el lugar conocido con su nombre oficial y municipio; después "vía, municipio"; al final "barrio, municipio" o el municipio. Formato corto, sin la palabra España, sin coletillas.
Responde en español.`;

/** Mensaje de usuario para el modelo, con lo que dictó la persona. */
export function mensajeUbicacion(lugar: string | undefined, municipio: string | undefined): string {
  return [`Lugar dictado: """${(lugar ?? "").trim() || "(no lo dijo)"}"""`, `Municipio dictado: """${(municipio ?? "").trim() || "(no lo dijo)"}"""`].join("\n");
}

type Precision = (typeof PRECISIONES)[number];

const sinTildes = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const VIA_O_CARRETERA = /\b(avenida|avda|calle|carretera|paseo|camino|plaza|glorieta|ronda|traves[ií]a|autov[ií]a|autopista|bulevar|cuesta|km|[a-z]{1,2}-\d{1,4})\b/i;

/**
 * Precisión de una consulta, calculada con REGLAS sobre la propia consulta y la
 * interpretación (no se fía de la etiqueta del modelo: medido el 19-09, qwen3.6 llamó
 * "municipio" a "Avenida Complutense 30, Madrid" y el agente habría pedido otra referencia).
 *   · vía o carretera con número o kilómetro → "direccion"
 *   · solo municipio / provincia → "municipio"; solo barrio (+ municipio) → "barrio"
 *   · cualquier otra cosa con nombre propio (edificio, paraje, vía sin número) → "lugar"
 */
export function precisionDeConsulta(consulta: string, i: Pick<InterpretacionLugar, "municipio" | "provincia" | "barrio">): Precision {
  const partes = consulta.split(",").map(sinTildes).filter(Boolean);
  const municipio = sinTildes(i.municipio ?? "");
  const provincia = sinTildes(i.provincia ?? "");
  const barrio = sinTildes(i.barrio ?? "");
  const esMunicipio = (p: string) => Boolean(p) && (p === municipio || p === provincia || p === "espana" || p === "comunidad de madrid");
  const resto = partes.filter((p) => !esMunicipio(p));
  if (!resto.length) return "municipio";
  if (barrio && resto.every((p) => p === barrio)) return "barrio";
  const conNumero = resto.some((p) => VIA_O_CARRETERA.test(p) && /(^|\s)\d{1,4}\b/.test(p));
  return conNumero ? "direccion" : "lugar";
}

/** Limpia las consultas del modelo: sin "España", sin vacías, sin repetidas, como mucho 4, con la precisión calculada por reglas. */
export function consultasDeInterpretacion(i: InterpretacionLugar): { consulta: string; precision: Precision }[] {
  const vistas = new Set<string>();
  const salida: { consulta: string; precision: Precision }[] = [];
  for (const c of i.consultas ?? []) {
    let consulta = c.consulta.replace(/,?\s*España\s*$/i, "").replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim();
    // "Avenida Complutense 30 Madrid" → "Avenida Complutense 30, Madrid": la coma es la pausa al leerla
    // en voz alta (medido el 19-09: el modelo a veces la omite).
    const mun = (i.municipio ?? "").trim();
    if (mun && !consulta.includes(",") && consulta.toLowerCase().endsWith(` ${mun.toLowerCase()}`)) consulta = `${consulta.slice(0, -mun.length).trim()}, ${consulta.slice(-mun.length)}`;
    const clave = consulta.toLowerCase();
    if (!consulta || vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push({ consulta, precision: precisionDeConsulta(consulta, i) });
    if (salida.length === 4) break;
  }
  return salida;
}

/**
 * Pide al modelo rápido la interpretación del lugar dictado. Devuelve undefined
 * (y las reglas deterministas siguen solas) si no hay proveedor, si no hay nada
 * que interpretar o si no contesta a tiempo: nunca retrasa la llamada más de
 * `tiempoMaxMs`.
 */
export async function interpretarLugarConIA(
  lugar: string | undefined,
  municipio: string | undefined,
  tiempoMaxMs = TIEMPO_MAX_IA_MS,
): Promise<{ interpretacion: InterpretacionLugar; latenciaMs: number } | undefined> {
  if (!(lugar ?? "").trim() && !(municipio ?? "").trim()) return undefined;
  if (tiempoMaxMs <= 0) return undefined;
  const { completarJson, proveedorDisponible } = await import("../ia/llm");
  if (!proveedorDisponible()) return undefined;
  const t0 = Date.now();
  try {
    const r = await completarJson({
      system: SISTEMA_UBICACION,
      user: mensajeUbicacion(lugar, municipio),
      esquema: esquemaInterpretacion,
      nombreEsquema: "interpretacion_lugar",
      papel: "rapido",
      prioridad: "alta",
      // Hay una persona al teléfono: se atiende aunque el mundo de la sala esté en pausa.
      permitirEnPausa: true,
      // Sin razonamiento: qwen3.6 tardaba 16-23 s pensando; sin pensar, 0,2-2 s (medido el 19-09).
      sinRazonar: true,
      maxTokens: 1500,
      temperatura: 0,
      signal: AbortSignal.timeout(tiempoMaxMs),
    });
    return { interpretacion: r.datos, latenciaMs: Date.now() - t0 };
  } catch (e) {
    console.warn(`[112 entrante] interpretación del lugar con IA sin respuesta en ${Date.now() - t0} ms:`, e instanceof Error ? e.message : e);
    return undefined;
  }
}
