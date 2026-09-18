// Visión y clasificación de observaciones (poc-07).
// Cadena: FalAI (caption + clases, si hay FAL_KEY) → LLM real vía
// conectores/llm.ts (Claude si hay clave, si no Ollama local) → y si no
// responde nadie, análisis honesto: motor "ninguno"/"palabras-clave".
// Aquí no se simula nada: el modelo que se anota es el que contestó.

import { z } from "zod";
import type { AnalisisVision, CategoriaObservacion } from "../../tipos-perifericos";
import { analizarImagen, falDisponible, modeloFal, type AnalisisImagen } from "../conectores/fal";
import { generarEstructurado, type ImagenLLM, type ProveedorLLM } from "../conectores/llm";

/** Categorías admitidas (el `satisfies` avisa si alguna deja de existir en el tipo). */
const CATEGORIAS = [
  "incendio",
  "humo",
  "inundacion",
  "accidente",
  "derrumbe",
  "aglomeracion",
  "persona_en_peligro",
  "vertido",
  "corte_electrico",
  "explosion",
  "fuga_gas",
  "terremoto",
  "ola_calor",
  "nevada",
  "accidente_ferroviario",
  "amenaza",
  "sin_novedad",
  "otro",
] as const satisfies readonly CategoriaObservacion[];

const GRAVEDADES = ["critica", "alta", "media", "baja", "nula"] as const;

const Esquema = z.object({
  descripcion: z.string().describe("Una sola frase en español describiendo lo que se ve o se cuenta"),
  categoria: z.enum(CATEGORIAS),
  confianza: z.number().min(0).max(1),
  gravedad: z.enum(GRAVEDADES),
  etiquetas: z.array(z.string()).max(8),
  personasVisibles: z.number().min(0).max(500),
});

const MIMES_LLM = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

function mimeParaLlm(mime: string): ImagenLLM["mime"] {
  const m = mime.toLowerCase() === "image/jpg" ? "image/jpeg" : mime.toLowerCase();
  return (MIMES_LLM as readonly string[]).includes(m) ? (m as ImagenLLM["mime"]) : "image/jpeg";
}

const TIMEOUT_VISION_MS = 60_000; // Ollama local va lento en una máquina cargada
const TIMEOUT_TEXTO_MS = 50_000; // Ollama local comparte cola con el router: con 25 s el texto caía a palabras clave

/** Qué motor anotamos según quién contestó de verdad. */
const motorDe = (proveedor: ProveedorLLM): AnalisisVision["motor"] => (proveedor === "anthropic" ? "Claude" : "Ollama");

const INSTRUCCIONES = [
  "Eres el analista de un centro de mando de emergencias en Madrid.",
  "Clasifica lo observado con criterio operativo y responde solo con el formato pedido.",
  "La descripción va en español, en una sola frase, sin adornos.",
  "gravedad: critica (vidas en peligro inmediato), alta (incendio/derrumbe activo), media (incidente contenido), baja (molestia), nula (sin novedad).",
  "Si la imagen no muestra ninguna emergencia usa la categoría sin_novedad con gravedad nula.",
].join(" ");

/** Palabras clave por categoría; el orden manda (la primera que casa gana). */
const REGLAS_TEXTO: { categoria: CategoriaObservacion; patron: RegExp; gravedad: AnalisisVision["gravedad"] }[] = [
  { categoria: "amenaza", patron: /\b(bomba|atentado|amenaza|tiroteo|apu[ñn]al)/i, gravedad: "critica" },
  { categoria: "explosion", patron: /\b(explosi[oó]n|explota|deflagraci[oó]n|estallid)/i, gravedad: "critica" },
  { categoria: "fuga_gas", patron: /\b(fuga de gas|escape de gas|olor a gas)/i, gravedad: "alta" },
  { categoria: "incendio", patron: /\b(incendi|llamas?|fuego|ardiendo|arde|abrasad)/i, gravedad: "alta" },
  { categoria: "derrumbe", patron: /\b(derrumb|colaps|hundimiento|se ha ca[ií]do el)/i, gravedad: "alta" },
  { categoria: "humo", patron: /\b(humo|humared|columna negra)/i, gravedad: "media" },
  { categoria: "inundacion", patron: /\b(inundaci|inundad|anegad|riada|desbordad|agua por|balsa de agua|rotura de tuber|reventad.{0,12}tuber)/i, gravedad: "media" },
  { categoria: "vertido", patron: /\b(vertido|derrame|qu[ií]mic|t[oó]xic)/i, gravedad: "alta" },
  { categoria: "accidente_ferroviario", patron: /\b(tren|ferroviari|descarril|cercan[ií]as)/i, gravedad: "alta" },
  { categoria: "accidente", patron: /\b(accidente|choque|colisi[oó]n|atropell)/i, gravedad: "media" },
  { categoria: "aglomeracion", patron: /\b(aglomeraci|multitud|avalancha|gent[ií]o|estampida)/i, gravedad: "media" },
  { categoria: "corte_electrico", patron: /\b(apag[oó]n|sin luz|corte el[eé]ctric|sin suministro)/i, gravedad: "media" },
  { categoria: "terremoto", patron: /\b(terremoto|sismo|temblor)/i, gravedad: "alta" },
  { categoria: "nevada", patron: /\b(nevada|nieve|hielo en)/i, gravedad: "baja" },
  { categoria: "ola_calor", patron: /\b(ola de calor|golpe de calor)/i, gravedad: "media" },
  { categoria: "persona_en_peligro", patron: /\b(atrapad|sepultad|herid|auxilio|socorro|inconsciente|no puede salir)/i, gravedad: "critica" },
  { categoria: "sin_novedad", patron: /\b(sin novedad|todo normal|nada que rese[ñn]ar|despejad|ya est[aá] apagad|controlad)/i, gravedad: "nula" },
];

const PATRON_CRITICO = /\b(atrapad|sepultad|herid|auxilio|socorro|inconsciente|v[ií]ctima|muerto)/i;

/** Clasificador local sin IA: palabras clave. Es honesto (motor "ninguno"). */
export function clasificarPorPalabras(texto: string): { categoria: CategoriaObservacion; gravedad: AnalisisVision["gravedad"]; confianza: number; etiquetas: string[] } {
  const t = texto ?? "";
  const casadas = REGLAS_TEXTO.filter((r) => r.patron.test(t));
  const principal = casadas.find((r) => r.categoria !== "persona_en_peligro" && r.categoria !== "sin_novedad") ?? casadas[0];
  if (!principal) return { categoria: "otro", gravedad: "media", confianza: 0.4, etiquetas: [] };
  const critico = PATRON_CRITICO.test(t) && principal.categoria !== "sin_novedad";
  const etiquetas = [...new Set(casadas.map((r) => r.categoria))].slice(0, 6);
  return {
    categoria: principal.categoria,
    gravedad: critico ? "critica" : principal.gravedad,
    confianza: principal.categoria === "sin_novedad" ? 0.7 : critico ? 0.75 : 0.6,
    etiquetas,
  };
}

/** Deriva categoría y gravedad de lo que vio fal cuando no hay Claude. */
function desdeFal(a: AnalisisImagen): { categoria: CategoriaObservacion; gravedad: AnalisisVision["gravedad"]; confianza: number } {
  const clases = a.clases.map((c) => c.etiqueta.toLowerCase()).join(" ");
  const confianza = a.clases.length ? Math.max(...a.clases.map((c) => c.confianza)) : 0.6;
  if (a.fuegoDetectado) return { categoria: "incendio", gravedad: a.personasVisibles ? "critica" : "alta", confianza: Math.max(0.7, confianza) };
  if (a.humoDetectado) return { categoria: "humo", gravedad: "media", confianza: Math.max(0.6, confianza) };
  if (/water|flood|agua/.test(clases)) return { categoria: "inundacion", gravedad: "media", confianza };
  if (/crowd|people|gente/.test(clases) && a.personasVisibles) return { categoria: "aglomeracion", gravedad: "baja", confianza };
  const porTexto = clasificarPorPalabras(a.descripcion);
  if (porTexto.categoria !== "otro") return { categoria: porTexto.categoria, gravedad: porTexto.gravedad, confianza: Math.max(0.5, confianza) };
  return { categoria: "otro", gravedad: "baja", confianza: Math.min(0.6, confianza) };
}

const SIN_MOTOR: AnalisisVision = {
  motor: "ninguno",
  modelo: "sin-analisis",
  latenciaMs: 0,
  descripcion: "Imagen recibida; sin motor de visión disponible",
  categoria: "otro",
  confianza: 0.4,
  gravedad: "media",
  etiquetas: [],
};

async function llamarFal(imagen: { base64: string; mime: string; url?: string }): Promise<AnalisisImagen | undefined> {
  const dataUri = `data:${imagen.mime};base64,${imagen.base64}`;
  try {
    return await analizarImagen(dataUri);
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    console.warn("[vision/fal]", mensaje);
    // fal puede rechazar data-URIs grandes con 4xx: se reintenta con la URL pública.
    if (/fal 4\d\d/.test(mensaje) && imagen.url?.startsWith("https://")) {
      try {
        return await analizarImagen(imagen.url);
      } catch (err2) {
        console.warn("[vision/fal:url]", err2 instanceof Error ? err2.message : err2);
      }
    }
    return undefined;
  }
}

/**
 * Analiza la foto de una observación. Devuelve siempre un AnalisisVision, con
 * `motor`/`modelo`/`latenciaMs` reales para que la consola no disfrace nada.
 */
export async function analizarVision(imagen: { base64: string; mime: string; url?: string }, contexto?: string): Promise<AnalisisVision> {
  const t0 = Date.now();
  const fal = falDisponible() ? await llamarFal(imagen) : undefined;
  const etiquetasFal = fal?.clases.map((c) => c.etiqueta) ?? [];

  try {
    const r = await generarEstructurado(Esquema, {
      system: INSTRUCCIONES,
      nivel: "vision",
      imagenes: [{ base64: imagen.base64, mime: mimeParaLlm(imagen.mime) }],
      user: [
        "Clasifica esta imagen enviada por un ciudadano o una cámara durante una emergencia.",
        fal ? `Descripción automática (FalAI): ${fal.descripcion}. Clases: ${etiquetasFal.join(", ") || "ninguna"}.` : "",
        contexto ? `Lo que cuenta quien la envía: ${contexto}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      maxTokens: 500,
      timeoutMs: TIMEOUT_VISION_MS,
    });
    const o = r.datos;
    return {
      motor: motorDe(r.proveedor),
      modelo: r.modelo,
      latenciaMs: Date.now() - t0,
      descripcion: o.descripcion,
      categoria: o.categoria,
      confianza: Math.min(1, Math.max(0, o.confianza)),
      gravedad: o.gravedad,
      etiquetas: [...new Set([...o.etiquetas, ...etiquetasFal])].slice(0, 8),
      personasVisibles: o.personasVisibles,
    };
  } catch (err) {
    console.warn("[vision/llm]", err instanceof Error ? err.message : err);
  }

  if (fal) {
    const d = desdeFal(fal);
    return {
      motor: "FalAI",
      modelo: modeloFal(),
      latenciaMs: Date.now() - t0,
      descripcion: fal.descripcion || "Imagen analizada por FalAI",
      categoria: d.categoria,
      confianza: d.confianza,
      gravedad: d.gravedad,
      etiquetas: etiquetasFal.slice(0, 8),
      personasVisibles: fal.personasVisibles ? 1 : 0,
    };
  }

  return { ...SIN_MOTOR, latenciaMs: Date.now() - t0 };
}

/** Clasificación de texto (aviso escrito, transcripción de voz o publicación). */
export async function analizarTexto(texto: string, contexto?: string): Promise<AnalisisVision> {
  const t0 = Date.now();
  const limpio = (texto ?? "").trim();
  if (!limpio) {
    return { motor: "ninguno", modelo: "sin-analisis", latenciaMs: 0, descripcion: "Observación sin texto", categoria: "otro", confianza: 0.3, gravedad: "baja", etiquetas: [] };
  }

  try {
    const r = await generarEstructurado(Esquema, {
      system: INSTRUCCIONES,
      nivel: "ligero",
      user: `Clasifica este aviso recibido durante una emergencia.${contexto ? ` Contexto: ${contexto}.` : ""}\nAviso: ${limpio.slice(0, 1500)}`,
      maxTokens: 500,
      timeoutMs: TIMEOUT_TEXTO_MS,
    });
    const o = r.datos;
    return {
      motor: motorDe(r.proveedor),
      modelo: r.modelo,
      latenciaMs: Date.now() - t0,
      descripcion: o.descripcion,
      categoria: o.categoria,
      confianza: Math.min(1, Math.max(0, o.confianza)),
      gravedad: o.gravedad,
      etiquetas: o.etiquetas.slice(0, 8),
      personasVisibles: o.personasVisibles,
    };
  } catch (err) {
    console.warn("[vision/texto]", err instanceof Error ? err.message : err);
  }

  // Sin ningún modelo de lenguaje: palabras clave, y se dice claramente.
  const k = clasificarPorPalabras(limpio);
  return {
    motor: "palabras-clave",
    modelo: "palabras-clave",
    latenciaMs: Date.now() - t0,
    descripcion: `${limpio.slice(0, 160)} (sin modelo de lenguaje disponible)`,
    confianza: k.confianza,
    categoria: k.categoria,
    gravedad: k.gravedad,
    etiquetas: k.etiquetas,
  };
}
