// Enrutador de IA por complejidad: un modelo ligero clasifica cada evento y
// extrae entidades en baja latencia; el modelo grande solo genera planes
// (proponente.ts). Todo real: Claude (Haiku) si hay clave, si no Ollama en local.
// Visión (fal.ai → Claude → Ollama), verificación de reciclado (Exa → prensa RSS)
// y detección local de duplicados. Sin proveedor no se registra ningún
// procesado: nunca hay latencias inventadas ni etiquetas "(simulado)".

import { z } from "zod";
import type { EventoIngesta, ProcesadoPor } from "../types";
import { generarEstructurado, llmDisponible, llmOcupado } from "./conectores/llm";
import { detectarReciclado, modeloBusqueda } from "./conectores/exa";
import { analizarImagen, modeloVision, resumenClases, visionDisponible } from "./conectores/fal";

/** Nombre del modelo ligero de Claude (lo usa también perifericos/vision.ts). */
export const MODELO_LIGERO = process.env.CLAUDE_MODEL_LIGERO || "claude-haiku-4-5";

const Esquema = z.object({
  categoria: z.enum(["incendio", "humo", "trafico", "sanitario", "poblacion_vulnerable", "rumor", "meteo", "otro"]),
  entidades: z.array(z.string()),
  urgencia: z.enum(["critica", "alta", "media", "baja"]),
  fiable: z.boolean(),
  motivo: z.string(),
});

function similitud(a: string, b: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]{4,}/g) ?? []);
  const A = tok(a), B = tok(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

// "Organismo" = avisos oficiales de operadores (Metro, Adif, Canal, distribuidoras), fuente que añade poc-26 en lib/types.ts.
const FUENTES_OFICIALES = new Set<string>(["Exa", "FalAI", "OpenMeteo", "REE", "IGN", "AEMET", "MadridTrafico", "HappyRobot", "CamaraTrafico", "Organismo"]);

/** Verificación local real de duplicados (mismo lugar y contenido parecido). Devuelve true si fijó la verificación. */
function verificarLocal(x: EventoIngesta, previos: EventoIngesta[]): boolean {
  if (x.verificacion) return false;
  const dup = previos.find((p) => p.id !== x.id && p.ubicacion && p.ubicacion === x.ubicacion && similitud(`${p.titulo} ${p.detalle}`, `${x.titulo} ${x.detalle}`) >= 0.6);
  x.verificacion = dup
    ? { estado: "duplicado", motivo: `Mismo lugar y contenido que ${dup.id}`, duplicaDe: dup.id }
    : { estado: FUENTES_OFICIALES.has(x.fuente) ? "verificado" : x.confianza >= 0.7 ? "verificado" : "pendiente" };
  return true;
}

export async function procesarEvento(x: EventoIngesta, previos: EventoIngesta[]): Promise<void> {
  const verificacionPrevia = x.verificacion; // la que trae el evento antes de la comprobación local
  const proc: ProcesadoPor[] = x.procesadoPor ?? [];

  const t0 = Date.now();
  if (verificarLocal(x, previos)) proc.push({ modelo: "verificador-local", latenciaMs: Date.now() - t0, tarea: "verificacion" });

  // Visión real si el aviso trae una foto pública y hay algún proveedor (fal.ai, Claude u Ollama).
  // Las rutas locales (periféricos) ya vienen analizadas por el pipeline de poc-07.
  if (x.imagenUrl && /^https?:\/\//i.test(x.imagenUrl) && visionDisponible()) {
    try {
      const a = await analizarImagen(x.imagenUrl);
      proc.push({ modelo: a.modelo, latenciaMs: a.latenciaMs, tarea: "vision" });
      const resumen = resumenClases(a.clases);
      if (resumen && !x.detalle.includes("Visión:")) x.detalle = `${x.detalle} Visión: ${resumen}.`;
    } catch (err) {
      console.warn(`[router/vision ${modeloVision()}]`, err instanceof Error ? err.message : err);
    }
  }

  // Verificación real: ¿este aviso reutiliza material publicado hace meses? (Exa o prensa por RSS)
  const yaDescartado = verificacionPrevia?.estado === "sospechoso" || verificacionPrevia?.estado === "duplicado";
  if ((x.fuente === "Ciudadano" || x.fuente === "Exa" || x.fuente === "Periferico") && !yaDescartado) {
    const t1 = Date.now();
    try {
      const r = await detectarReciclado(x.titulo, x.detalle);
      proc.push({ modelo: modeloBusqueda(), latenciaMs: Date.now() - t1, tarea: "verificacion" });
      if (r.sospechoso) x.verificacion = { estado: "sospechoso", motivo: r.motivo };
    } catch (err) {
      console.warn(`[router/${modeloBusqueda()}]`, err instanceof Error ? err.message : err);
    }
  }

  // Clasificación y extracción de entidades con el modelo ligero (real; si no hay LLM, no se registra nada).
  // Corre dentro del bloqueo del motor: tope de 10 s y, si el LLM local ya está ocupado, se omite sin esperar.
  if (llmDisponible() && !llmOcupado()) {
    try {
      const r = await generarEstructurado(Esquema, {
        nivel: "ligero",
        maxTokens: 300,
        timeoutMs: 10_000,
        user: `Clasifica este aviso de emergencia y extrae entidades (lugares, infraestructuras, recursos, cifras). Fuente: ${x.fuente}. Título: ${x.titulo}. Detalle: ${x.detalle}. Ubicación: ${x.ubicacion ?? "?"}. Confianza de la fuente: ${x.confianza}.`,
      });
      proc.push({ modelo: r.modelo, latenciaMs: r.latenciaMs, tarea: "clasificacion" });
      proc.push({ modelo: r.modelo, latenciaMs: 0, tarea: "extraccion_entidades" });
      const o = r.datos;
      const entidades = o.entidades.slice(0, 5);
      x.detalle = `${x.detalle} [${o.categoria}${entidades.length ? " · " + entidades.join(", ") : ""}]`;
      if (!o.fiable && x.verificacion?.estado === "verificado") x.verificacion = { estado: "sospechoso", motivo: o.motivo };
    } catch (err) {
      console.warn("[router/llm]", err instanceof Error ? err.message : err);
    }
  }
  x.procesadoPor = proc;
}
