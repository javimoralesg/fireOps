// Traducción de datos técnicos a lenguaje llano para la ciudadanía.
// Lo usan el adaptador (fallback) y los componentes del portal.

import type { IncidentePublico, SituacionOperativa } from "./tipos";

export type Gravedad = "danger" | "warning" | "success" | "info";

// ---------- Viento ----------

const PUNTOS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
const NOMBRES: Record<string, string> = {
  N: "norte",
  NNE: "nornoreste",
  NE: "noreste",
  ENE: "estenoreste",
  E: "este",
  ESE: "estesureste",
  SE: "sureste",
  SSE: "sursureste",
  S: "sur",
  SSO: "sursuroeste",
  SO: "suroeste",
  OSO: "oestesuroeste",
  O: "oeste",
  ONO: "oestenoroeste",
  NO: "noroeste",
  NNO: "nornoroeste",
};

const norm360 = (g: number) => ((g % 360) + 360) % 360;

/** Abreviatura cardinal (16 rumbos, notación española: O = oeste). */
export function cardinal(grados: number): string {
  return PUNTOS[Math.round(norm360(grados) / 22.5) % 16];
}

/** Nombre completo en minúscula ("noroeste"). Acepta abreviaturas inglesas (W → O). */
export function nombreRumbo(abrev: string): string {
  const es = abrev.toUpperCase().replace(/W/g, "O");
  return NOMBRES[es] ?? abrev;
}

/**
 * Hacia dónde va el humo. direccionGrados es de dónde VIENE el viento (convenio
 * meteorológico), así que el humo va al rumbo opuesto.
 */
export function humoHacia(direccionGrados: number): { grados: number; abrev: string; nombre: string } {
  const grados = norm360(direccionGrados + 180);
  const abrev = cardinal(grados);
  // Para la ciudadanía, 8 rumbos bastan ("noroeste", no "oestenoroeste").
  const ocho = ["norte", "noreste", "este", "sureste", "sur", "suroeste", "oeste", "noroeste"][Math.round(grados / 45) % 8];
  return { grados, abrev, nombre: ocho };
}

// ---------- Ubicación ----------

export function textoUbicacion(u: IncidentePublico["ubicacion"] | undefined): string {
  if (!u) return "";
  return typeof u === "string" ? u : u.nombre;
}

const COORDENADAS = /-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+/;

/** ¿El nombre de la ubicación son solo coordenadas ("40.3914, -3.6951")? No se enseñan a la ciudadanía. */
export function esCoordenada(texto: string): boolean {
  return COORDENADAS.test(texto) && texto.replace(COORDENADAS, "").replace(/[\s,—-]/g, "") === "";
}

/** Título legible: sin coordenadas; si no queda lugar, usa las zonas publicadas. */
export function tituloPublico(titulo: string, zonas: string[] = []): string {
  const limpio = titulo.replace(COORDENADAS, "").replace(/\s*[—-]\s*$/, "").trim();
  if (limpio !== titulo.trim() && zonas.length) return `${limpio} en ${zonas.slice(0, 2).join(" y ")}`;
  return limpio || titulo;
}

/** Barrio o distrito para la frase "Si estás en X" (segundo tramo de "Calle, Distrito, Ciudad"). */
export function zonaCorta(u: IncidentePublico["ubicacion"] | undefined, municipio?: string, zonas: string[] = []): string {
  if (esCoordenada(textoUbicacion(u))) return zonas.length ? zonas.slice(0, 2).join(" o ") : "la zona marcada en el mapa";
  const partes = textoUbicacion(u)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const sinCiudad = partes.filter((p) => !municipio || p.toLowerCase() !== municipio.toLowerCase());
  if (sinCiudad.length >= 2) return sinCiudad[sinCiudad.length - 1];
  return sinCiudad[0] ?? municipio ?? "la zona";
}

/** Calle sin el distrito ni la ciudad: "C/ Méndez Álvaro 56". */
export function lugarCorto(u: IncidentePublico["ubicacion"] | undefined): string {
  if (esCoordenada(textoUbicacion(u))) return "";
  return textoUbicacion(u).split(",")[0]?.trim() ?? "";
}

// ---------- Fase y situación ----------

export const FASE_PUBLICA: Record<string, string> = {
  deteccion: "Incidente detectado",
  respuesta: "Servicios de emergencia actuando",
  escalada: "Emergencia en aumento",
  estabilizacion: "Bajo control, en vigilancia",
  cierre: "Emergencia finalizada",
};

const SITUACION_NOMBRE = [
  "Situación 0 · Servicios ordinarios",
  "Situación 1 · Plan municipal activado",
  "Situación 2 · Apoyo de otras administraciones",
  "Situación 3 · Emergencia de interés nacional",
];

export interface SituacionLegible {
  nivel: number | null;
  etiqueta: string; // "Situación 1 · Plan municipal activado" o, si no hay dato, la fase
  gravedad: Gravedad;
  estado: string; // "Emergencia en curso"
}

function gravedadDeFase(fase: string, activo: boolean): Gravedad {
  if (!activo || fase === "cierre") return "success";
  if (fase === "escalada") return "danger";
  return "warning";
}

export function situacionLegible(inc: IncidentePublico, s?: SituacionOperativa | null): SituacionLegible {
  const faseTxt = FASE_PUBLICA[inc.fase] ?? "En curso";
  const porFase = gravedadDeFase(inc.fase, inc.activo);

  let nivel: number | null = null;
  let etiqueta: string | undefined;
  if (typeof s === "number") nivel = s;
  else if (s && typeof s === "object") {
    nivel = typeof s.nivel === "number" ? s.nivel : null;
    etiqueta = s.etiqueta ?? s.nombre;
  }

  let gravedad = porFase;
  if (nivel !== null && inc.activo && inc.fase !== "cierre") {
    gravedad = nivel >= 2 ? "danger" : porFase === "danger" ? "danger" : "warning";
  }

  const estado =
    gravedad === "success" ? "Emergencia finalizada" : gravedad === "danger" ? "Emergencia grave en curso" : "Emergencia en curso";

  return {
    nivel,
    etiqueta: etiqueta ?? (nivel !== null ? SITUACION_NOMBRE[nivel] ?? `Situación ${nivel}` : faseTxt),
    gravedad,
    estado,
  };
}

// ---------- Calidad del aire (umbrales OMS 2021, 24 h) ----------

export const OMS = { pm25: 15, pm10: 45, co: 4000 } as const;

const fmt1 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });
const fmt0 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
export const num1 = (n: number) => fmt1.format(n);
export const num0 = (n: number) => fmt0.format(n);

export interface LecturaAire {
  clave: "pm25" | "pm10" | "co";
  nombre: string;
  valor: string;
  unidad: string;
  ratio: number; // valor / límite OMS
  gravedad: Gravedad;
  frase: string;
}

function lectura(clave: LecturaAire["clave"], nombre: string, v: number): LecturaAire {
  const limite = OMS[clave];
  const ratio = v / limite;
  const gravedad: Gravedad = ratio >= 3 ? "danger" : ratio > 1 ? "warning" : "success";
  const valor = clave === "co" ? num0(v) : num1(v);
  let frase: string;
  if (ratio >= 3) frase = `${num1(ratio)}× el límite OMS: evita salir`;
  else if (ratio > 1) frase = `${num1(ratio)}× el límite OMS: limita el ejercicio al aire libre`;
  else frase = `Por debajo del límite OMS (${num0(limite)}): sin riesgo por ahora`;
  return { clave, nombre, valor, unidad: "µg/m³", ratio, gravedad, frase };
}

export function lecturasAire(aire: { pm25: number; pm10: number; co: number }): LecturaAire[] {
  return [lectura("pm25", "Partículas finas PM2.5", aire.pm25), lectura("pm10", "Partículas PM10", aire.pm10), lectura("co", "Monóxido de carbono", aire.co)];
}

/** Resumen de una línea para la tarjeta de aire. */
export function resumenAire(aire: { pm25: number; pm10: number; co: number }): { gravedad: Gravedad; titulo: string; consejo: string } {
  const peor = lecturasAire(aire).sort((a, b) => b.ratio - a.ratio)[0];
  if (peor.gravedad === "danger")
    return { gravedad: "danger", titulo: "Aire muy contaminado", consejo: "Quédate en interior con ventanas cerradas. Si tienes que salir, usa mascarilla FFP2." };
  if (peor.gravedad === "warning")
    return { gravedad: "warning", titulo: "Aire con contaminación", consejo: "Evita el ejercicio al aire libre. Extrema la precaución si tienes asma o problemas respiratorios." };
  return { gravedad: "success", titulo: "Aire en niveles normales", consejo: "Por ahora el humo no está afectando a la calidad del aire medida en la zona." };
}

// ---------- Tiempo relativo ----------

export function haceTiempo(iso: string, ahora: number): string {
  const s = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

export function horaCorta(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

/** Quita prefijos técnicos de los textos públicos ("Visión: …", "Exa: …"). */
export function limpiarTexto(t: string): string {
  const s = t.replace(/^(visi[oó]n|exa|falai|fal\.ai)\s*:\s*/i, "").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
