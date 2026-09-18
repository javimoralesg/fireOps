// Búsqueda real sobre el suceso. Con EXA_API_KEY: Exa (búsqueda semántica,
// POST https://api.exa.ai/search, cabecera x-api-key). Sin clave: titulares
// reales de prensa por RSS de Google Noticias (conectores/busqueda-local.ts),
// con su fecha de publicación. Dos usos en la ingesta: contexto reciente del
// suceso y detección de contenido reciclado (la misma noticia/foto circulando
// desde hace meses). Si la red falla, se lanza: nunca se inventan resultados.

import type { Evidencia } from "../../tipos-sistema";
import { buscarPrensa, URL_PRENSA } from "./busqueda-local";

const URL_EXA = "https://api.exa.ai/search";
/** Publicaciones más antiguas que esto se consideran material reciclado. */
const DIAS_RECICLADO = 30;

export type ProveedorBusqueda = "Exa" | "Prensa";

export interface ResultadoExa {
  titulo: string;
  url: string;
  publicado?: string; // ISO, si la fuente lo expone
  extracto: string;
}

export interface ContextoReciente {
  resultados: ResultadoExa[];
  url: string; // endpoint consultado (para la trazabilidad de la evidencia)
  proveedor: ProveedorBusqueda;
}

export interface Coincidencia {
  titulo: string;
  url: string;
  publicado?: string;
}

export interface Reciclado {
  sospechoso: boolean;
  motivo?: string;
  coincidencias: Coincidencia[];
  proveedor: ProveedorBusqueda;
}

export function exaDisponible(): boolean {
  return Boolean(process.env.EXA_API_KEY);
}

export const proveedorBusqueda = (): ProveedorBusqueda => (exaDisponible() ? "Exa" : "Prensa");
/** Nombre para `procesadoPor.modelo`. */
export const modeloBusqueda = () => (exaDisponible() ? "exa-search" : "prensa-rss");

interface FilaExa {
  title?: string | null;
  url?: string;
  publishedDate?: string | null;
  text?: string | null;
  summary?: string | null;
}

/** Llamada cruda al endpoint de búsqueda de Exa; lanza si no hay clave o la API falla. */
async function buscarExa(cuerpo: Record<string, unknown>): Promise<ResultadoExa[]> {
  const clave = process.env.EXA_API_KEY;
  if (!clave) throw new Error("exa sin clave");
  const res = await fetch(URL_EXA, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": clave },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`exa ${res.status}`);
  const j = (await res.json()) as { results?: FilaExa[] };
  return (j.results ?? [])
    .filter((r) => Boolean(r.url))
    .map((r) => ({
      titulo: (r.title ?? "").trim() || r.url!,
      url: r.url!,
      publicado: r.publishedDate ? new Date(r.publishedDate).toISOString() : undefined,
      extracto: ((r.text ?? r.summary ?? "").trim()).slice(0, 400),
    }));
}

/** Consulta corta para el RSS (Google Noticias no admite textos largos). */
function consultaPrensa(texto: string): string {
  const palabras = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !/^(para|como|desde|hasta|entre|sobre|donde|cuando|porque|esta|este|estos|estas|pero|tambien|hacia|segun|tras)$/i.test(w));
  return palabras.slice(0, 8).join(" ");
}

/** Qué se está publicando sobre el suceso en las últimas `horas`. */
export async function buscarContextoReciente(texto: string, ubicacion?: string, horas = 6): Promise<ContextoReciente> {
  const consulta = ubicacion ? `${texto} ${ubicacion}` : texto;
  if (exaDisponible()) {
    const desde = new Date(Date.now() - horas * 3_600_000).toISOString();
    const resultados = await buscarExa({ query: consulta, numResults: 5, type: "auto", startPublishedDate: desde, contents: { text: { maxCharacters: 400 } } });
    return { resultados, url: URL_EXA, proveedor: "Exa" };
  }
  const noticias = await buscarPrensa(consultaPrensa(consulta), { horas, max: 5 });
  return { resultados: noticias.map((n) => ({ titulo: n.titulo, url: n.url, publicado: n.publicado, extracto: n.extracto })), url: URL_PRENSA, proveedor: "Prensa" };
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .match(/[a-z0-9]{4,}/g) ?? [],
  );
}

function parecido(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

function diasDesde(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

function fechaCorta(iso?: string): string {
  if (!iso) return "sin fecha";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "sin fecha" : d.toLocaleDateString("es-ES");
}

/**
 * Busca el mismo suceso SIN filtro de fecha: si las mejores coincidencias son
 * anteriores a 30 días, el aviso reutiliza material antiguo → "sospechoso".
 */
export async function detectarReciclado(titulo: string, detalle: string): Promise<Reciclado> {
  const consulta = `${titulo} ${detalle}`.slice(0, 300);
  const proveedor = proveedorBusqueda();
  const crudos =
    proveedor === "Exa"
      ? await buscarExa({ query: consulta, numResults: 6, type: "auto", contents: { text: { maxCharacters: 400 } } })
      : (await buscarPrensa(consultaPrensa(consulta), { max: 8 })).map((n) => ({ titulo: n.titulo, url: n.url, publicado: n.publicado, extracto: n.extracto }));

  const relevantes = crudos
    .filter((r) => r.publicado && parecido(consulta, `${r.titulo} ${r.extracto}`) >= 0.35)
    .slice(0, 3);
  const coincidencias: Coincidencia[] = relevantes.map((r) => ({ titulo: r.titulo, url: r.url, publicado: r.publicado }));
  if (!coincidencias.length) return { sospechoso: false, coincidencias: [], proveedor };

  const antiguas = relevantes.filter((r) => diasDesde(r.publicado!) > DIAS_RECICLADO);
  if (antiguas.length !== relevantes.length) return { sospechoso: false, coincidencias, proveedor };

  const mejor = antiguas[0];
  return {
    sospechoso: true,
    motivo: `${proveedor === "Exa" ? "Exa" : "Prensa"}: contenido coincide con ${mejor.titulo} (${fechaCorta(mejor.publicado)})`,
    coincidencias,
    proveedor,
  };
}

/** Evidencia opcional para la tarjeta de decisión; null si la búsqueda no aportó nada. */
export function evidenciaExa(x: ContextoReciente | Reciclado): Evidencia | null {
  // "Prensa" = titulares reales por RSS de Google Noticias (FuenteDato, tipos-sistema.ts).
  const fuente = (x.proveedor === "Exa" ? "Exa" : "Prensa");
  if ("resultados" in x) {
    if (!x.resultados.length) return null;
    const primero = x.resultados[0];
    return {
      id: "ev-exa",
      fuente,
      descripcion: `${x.resultados.length} publicaciones recientes sobre el suceso; la más relevante: ${primero.titulo}`,
      valor: x.resultados.length,
      unidad: "menciones",
      timestamp: primero.publicado ?? new Date().toISOString(),
      url: primero.url,
      confianza: 0.7,
    };
  }
  if (!x.coincidencias.length) return null;
  const c = x.coincidencias[0];
  return {
    id: "ev-exa-reciclado",
    fuente,
    descripcion: x.sospechoso
      ? `Material reciclado: coincide con ${c.titulo} (${fechaCorta(c.publicado)})`
      : `Suceso corroborado por ${x.coincidencias.length} fuentes públicas`,
    valor: x.coincidencias.length,
    unidad: "coincidencias",
    timestamp: c.publicado ?? new Date().toISOString(),
    url: c.url,
    confianza: x.sospechoso ? 0.8 : 0.6,
  };
}
