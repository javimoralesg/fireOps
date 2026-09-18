// Ayudas de redacción para la consola simplificada: nombres en lenguaje llano
// (nada de marcas de proveedores ni ids) y tiempos relativos.

import type { EntradaTimeline } from "@/lib/tipos-sistema";

/** Cómo se llama cada fuente de datos para una persona que no es técnica. */
export const FUENTE_PLANO: Record<string, string> = {
  Ciudadano: "Aviso ciudadano",
  FalAI: "Análisis de imagen",
  Exa: "Redes y prensa",
  HappyRobot: "Llamada de voz",
  OpenMeteo: "Meteorología",
  OpenMeteoAire: "Calidad del aire",
  MadridTrafico: "Sensores de tráfico",
  REE: "Red eléctrica",
  IGN: "Sismología",
  AEMET: "Avisos meteorológicos",
  Grafo: "Dependencias de la ciudad",
  QuiverAI: "Protocolo",
  Periferico: "Dispositivo en campo",
  CamaraTrafico: "Cámara de tráfico",
  OSM: "Mapa",
  Prensa: "Prensa",
  Normativa: "Normativa",
  Escenario: "Cambio de condiciones",
};

export function fuentePlano(fuente: string): string {
  return FUENTE_PLANO[fuente] ?? fuente;
}

/** "hace 40 s", "hace 3 min", "hace 1 h 12 min" o la hora si es de hace mucho. */
export function haceTiempo(iso: string, ahora: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((ahora - t) / 1000));
  if (s < 5) return "ahora";
  if (s < 60) return `hace ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 6) return `hace ${h} h ${m % 60} min`;
  return new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

export function hora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

/** Quita marcas técnicas de los textos de la cronología: "[Exa]", "(plantilla)", "(Claude)", ids… */
export function textoLlano(entrada: EntradaTimeline): string {
  let t = entrada.texto;
  t = t.replace(/^\[([^\]]+)\]\s*/, (_m, f: string) => `${fuentePlano(f)}: `);
  t = t.replace(/\s*\((Claude|plantilla)\)/g, "");
  t = t.replace(/^Propuesta:\s*/, "Nueva propuesta: ");
  t = t.replace(/\s*\((?:duplicado|sospechoso|pendiente)\)\s*$/, (m) => m.replace("duplicado", "repetido").replace("sospechoso", "posible bulo").replace("pendiente", "sin verificar"));
  t = t.replace(/\b(dec|ev|tl|tv|rg)-[a-z0-9]+-[a-z0-9]+\b/g, "");
  return t.trim();
}

/** Entradas de la cronología que le interesan al mando (fuera ruido de configuración). */
export function esRelevante(entrada: EntradaTimeline): boolean {
  if (entrada.tipo !== "sistema") return true;
  return !/^Configuración:|^Centro de mando inicializado/.test(entrada.texto);
}

/** Texto ≤ n caracteres cortado en una palabra. */
export function recortar(s: string, n: number): string {
  if (s.length <= n) return s;
  const corte = s.lastIndexOf(" ", n);
  return `${s.slice(0, corte > n * 0.6 ? corte : n).trim()}…`;
}

/** ¿Es un par "40.3914, -3.6951" en crudo? (el backend aún no ha geocodificado el lugar) */
export function pareceCoordenadas(s: string | undefined): boolean {
  return !!s && /^\s*-?\d{1,2}(?:[.,]\d+)?\s*,\s*-?\d{1,3}(?:[.,]\d+)?\s*$/.test(s);
}

/** Título del incidente sin la coletilla " — lat, lon" que a veces añade el backend. */
export function tituloLimpio(titulo: string): string {
  return titulo.replace(/\s*[—–-]\s*-?\d{1,2}(?:[.,]\d+)?\s*,\s*-?\d{1,3}(?:[.,]\d+)?\s*$/, "").trim();
}
