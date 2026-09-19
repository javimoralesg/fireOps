// Simbología del mapa: qué color y qué icono corresponde a cada cosa, y el HTML
// de los divIcon de Leaflet. DUEÑO: constructor E.
//
// Los trazos SVG que pinta Leaflet (stroke/fill) NO resuelven var(--token), así
// que los colores llegan desde useColoresTema(); aquí solo viven las formas y
// las correspondencias tipo → símbolo.
//
// Los contornos de los iconos son los de lucide (ISC), extraídos de
// node_modules/lucide-react para poder inyectarlos como HTML en un divIcon.

import type { EstadoIncendio, RiesgoPoblacion, TipoUnidad } from "@/lib/dominio/tipos";
import type { ColoresTema } from "./useColoresTema";

/** Interior de un <svg viewBox="0 0 24 24"> de lucide. */
export const CONTORNOS: Record<string, string> = {
  camion: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  avion: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  arboles: '<path d="M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z"/><path d="M7 16v6"/><path d="M13 19v3"/><path d="M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5"/>',
  escudo: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  escudoVisto: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  sirena: '<path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/><path d="M21 12h1"/><path d="M18.5 4.5 18 5"/><path d="M2 12h1"/><path d="M12 2v1"/><path d="m4.929 4.929.707.707"/><path d="M12 12v6"/>',
  ambulancia: '<path d="M10 10H6"/><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.684-.948l-1.923-.641a1 1 0 0 1-.578-.502l-1.539-3.076A1 1 0 0 0 16.382 8H14"/><path d="M8 8v4"/><path d="M9 18h6"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  casco: '<path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"/><path d="M14 6a6 6 0 0 1 6 6v3"/><path d="M4 15v-3a6 6 0 0 1 6-6"/><rect x="2" y="15" width="20" height="4" rx="1"/>',
  tractor: '<path d="m10 11 11 .9a1 1 0 0 1 .8 1.1l-.665 4.158a1 1 0 0 1-.988.842H20"/><path d="M16 18h-5"/><path d="M18 5a1 1 0 0 0-1 1v5.573"/><path d="M3 4h8.129a1 1 0 0 1 .99.863L13 11.246"/><path d="M4 11V4"/><path d="M7 15h.01"/><path d="M8 10.1V4"/><circle cx="18" cy="18" r="2"/><circle cx="7" cy="15" r="5"/>',
  llama: '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>',
  camara: '<path d="M16.75 12h3.632a1 1 0 0 1 .894 1.447l-2.034 4.069a1 1 0 0 1-1.708.134l-2.124-2.97"/><path d="M17.106 9.053a1 1 0 0 1 .447 1.341l-3.106 6.211a1 1 0 0 1-1.342.447L3.61 12.3a2.92 2.92 0 0 1-1.3-3.91L3.69 5.6a2.92 2.92 0 0 1 3.92-1.3z"/><path d="M2 19h3.76a2 2 0 0 0 1.8-1.1L9 15"/><path d="M2 21v-4"/><path d="M7 9h.01"/>',
  hospital: '<path d="M12 7v4"/><path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M14 9h-4"/><path d="M18 11h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2"/><path d="M18 21V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16"/>',
  gente: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  movil: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  satelite: '<path d="m13.5 6.5-3.148-3.148a1.205 1.205 0 0 0-1.704 0L6.352 5.648a1.205 1.205 0 0 0 0 1.704L9.5 10.5"/><path d="M16.5 7.5 19 5"/><path d="m17.5 10.5 3.148 3.148a1.205 1.205 0 0 1 0 1.704l-2.296 2.296a1.205 1.205 0 0 1-1.704 0L13.5 14.5"/><path d="M9 21a6 6 0 0 0-6-6"/><path d="M9.352 10.648a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l4.296-4.296a1.205 1.205 0 0 0 0-1.704l-2.296-2.296a1.205 1.205 0 0 0-1.704 0z"/>',
  // Base/parque de bomberos (lucide "warehouse").
  parque:
    '<path d="M18 21V10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v11"/><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 1.132-1.803l7.95-3.974a2 2 0 0 1 1.837 0l7.948 3.974A2 2 0 0 1 22 8z"/><path d="M6 13h12"/><path d="M6 17h12"/>',
  interrogacion: '<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/>',
};

export const ICONO_UNIDAD: Record<TipoUnidad, keyof typeof CONTORNOS> = {
  bomberos: "camion",
  brif: "casco",
  agentes_forestales: "arboles",
  medios_aereos: "avion",
  guardia_civil: "escudo",
  policia: "escudoVisto",
  ambulancia: "ambulancia",
  proteccion_civil: "sirena",
  maquinaria: "tractor",
};

export const TEXTO_TIPO_UNIDAD: Record<TipoUnidad, string> = {
  bomberos: "Bomberos",
  brif: "BRIF",
  agentes_forestales: "Agentes forestales",
  medios_aereos: "Medios aéreos",
  guardia_civil: "Guardia Civil",
  policia: "Policía",
  ambulancia: "Ambulancia",
  proteccion_civil: "Protección Civil",
  maquinaria: "Maquinaria",
};

/** Claves de color de `ColoresTema` que se usan como color plano de un símbolo. */
export type ClaveColor =
  | "danger"
  | "warning"
  | "success"
  | "info"
  | "brand"
  | "fuego"
  | "fuego2"
  | "naranja"
  | "amarillo"
  | "muted";

/**
 * Color de cada tipo de unidad, como lo pidió el mando: bomberos rojo, BRIF y
 * agentes forestales verde, Guardia Civil y Policía azul, ambulancia rojo sobre
 * blanco, Protección Civil naranja, maquinaria amarillo. Los medios aéreos
 * quedan en el petróleo de marca para no confundirse con los cuerpos azules.
 */
export const COLOR_UNIDAD: Record<TipoUnidad, ClaveColor> = {
  bomberos: "danger",
  brif: "success",
  agentes_forestales: "success",
  medios_aereos: "brand",
  guardia_civil: "info",
  policia: "info",
  ambulancia: "danger",
  proteccion_civil: "naranja",
  maquinaria: "amarillo",
};

/** Color resuelto (hex del tema) de una clave de color. */
export const colorDeClave = (clave: ClaveColor, c: ColoresTema): string => c[clave];

/** Color del icono de una unidad según su tipo. */
export const colorUnidad = (tipo: TipoUnidad, c: ColoresTema): string => colorDeClave(COLOR_UNIDAD[tipo] ?? "muted", c);

/**
 * Frase de una unidad para la leyenda y los lectores de pantalla: el color
 * nunca va solo, siempre acompañado del nombre del cuerpo.
 */
export const LEYENDA_UNIDAD: { tipo: TipoUnidad; texto: string }[] = [
  { tipo: "bomberos", texto: "Bomberos (camión rojo)" },
  { tipo: "brif", texto: "BRIF y agentes forestales (verde)" },
  { tipo: "guardia_civil", texto: "Guardia Civil y Policía (azul)" },
  { tipo: "ambulancia", texto: "Ambulancia (rojo sobre blanco)" },
  { tipo: "proteccion_civil", texto: "Protección Civil (naranja)" },
  { tipo: "maquinaria", texto: "Maquinaria (amarillo)" },
  { tipo: "medios_aereos", texto: "Medios aéreos" },
];

/**
 * Color del perímetro según el estado del incendio (además de la etiqueta).
 * Estabilizado en ámbar y controlado/extinguido en verde: así se lee de un
 * vistazo cómo va la contención sin tener que abrir la ficha.
 */
export function colorIncendio(estado: EstadoIncendio): "danger" | "fuego" | "warning" | "info" | "success" | "muted" {
  if (estado === "activo") return "danger";
  if (estado === "confirmado") return "fuego";
  if (estado === "detectado") return "warning";
  if (estado === "estabilizado") return "warning";
  if (estado === "controlado" || estado === "extinguido") return "success";
  return "muted";
}

export function colorRiesgo(r: RiesgoPoblacion): "riesgoBajo" | "riesgoMedio" | "riesgoAlto" | "riesgoInminente" {
  if (r === "inminente") return "riesgoInminente";
  if (r === "alto") return "riesgoAlto";
  if (r === "medio") return "riesgoMedio";
  return "riesgoBajo";
}

/** Radio en metros del círculo de una población según su riesgo. */
export function radioRiesgoM(r: RiesgoPoblacion): number {
  return { inminente: 1600, alto: 1300, medio: 1000, bajo: 800 }[r];
}

/**
 * HTML de un divIcon: círculo de color con el icono dentro y, si se pide, un
 * anillo exterior (unidad en ruta, cámara vigilada) y una etiqueta de texto.
 *
 * `hueco` deja el círculo sin relleno y con el borde discontinuo (foco todavía
 * sin confirmar); `atenuado` baja la opacidad (unidad parada en su base);
 * `flechaGrados` añade una punta de flecha en el borde con el rumbo real.
 */
export function marcadorHtml({
  contorno,
  color,
  fondo,
  etiqueta,
  anillo = false,
  tamano = 30,
  pulso = false,
  hueco = false,
  atenuado = false,
  flechaGrados,
}: {
  contorno: string;
  /** Color del icono y del borde. */
  color: string;
  /** Color de relleno del círculo. */
  fondo: string;
  etiqueta?: string;
  anillo?: boolean;
  tamano?: number;
  pulso?: boolean;
  hueco?: boolean;
  atenuado?: boolean;
  /** Rumbo HACIA el que se mueve, en grados (0 = norte). */
  flechaGrados?: number;
}): string {
  const anilloHtml = anillo
    ? `<span style="position:absolute;inset:-5px;border-radius:999px;border:2px solid ${color};opacity:.55;${pulso ? "animation:atalaya-latido 1.6s ease-in-out infinite;" : ""}"></span>`
    : "";
  const etiquetaHtml = etiqueta
    ? `<span style="position:absolute;left:50%;top:calc(100% + 3px);transform:translateX(-50%);white-space:nowrap;font-size:11px;font-weight:600;line-height:1.2;padding:1px 5px;border-radius:6px;background:${fondo};color:${color};border:1px solid ${color}55;box-shadow:0 1px 3px rgb(0 0 0 / .18)">${escapar(etiqueta)}</span>`
    : "";
  // Punta de flecha: un triángulo pegado al borde del círculo, girado al rumbo.
  const flechaHtml =
    typeof flechaGrados === "number" && Number.isFinite(flechaGrados)
      ? `<span style="position:absolute;left:50%;top:50%;width:0;height:0;transform:translate(-50%,-50%) rotate(${Math.round(flechaGrados)}deg)">
      <span style="position:absolute;left:-5px;top:-${Math.round(tamano / 2) + 9}px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:8px solid ${color}"></span>
    </span>`
      : "";
  return `<span style="position:relative;display:block;width:${tamano}px;height:${tamano}px;${atenuado ? "opacity:.55;" : ""}">
    ${anilloHtml}
    ${flechaHtml}
    <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border-radius:999px;background:${hueco ? "transparent" : fondo};border:2px ${hueco ? "dashed" : "solid"} ${color};box-shadow:${hueco ? "none" : "0 1px 4px rgb(0 0 0 / .25)"}">
      <svg width="${Math.round(tamano * 0.56)}" height="${Math.round(tamano * 0.56)}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${contorno}</svg>
    </span>
    ${etiquetaHtml}
  </span>`;
}

/**
 * HTML de un divIcon con un número dentro: agrupación de cámaras a zoom bajo y
 * bases con varias unidades. El tamaño crece (poco) con la cuenta.
 */
export function marcadorCuentaHtml({
  cuenta,
  color,
  fondo,
  etiqueta,
  contorno,
  tamano = 26,
}: {
  cuenta: number;
  color: string;
  fondo: string;
  etiqueta?: string;
  /** Icono opcional a la izquierda del número. */
  contorno?: string;
  tamano?: number;
}): string {
  const texto = cuenta > 999 ? "999+" : String(cuenta);
  const ancho = contorno ? tamano + 16 + texto.length * 6 : tamano + texto.length * 5;
  const icono = contorno
    ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex:none">${contorno}</svg>`
    : "";
  const etiquetaHtml = etiqueta
    ? `<span style="position:absolute;left:50%;top:calc(100% + 3px);transform:translateX(-50%);white-space:nowrap;font-size:10.5px;font-weight:600;line-height:1.2;padding:1px 5px;border-radius:6px;background:${fondo};color:${color};border:1px solid ${color}55">${escapar(etiqueta)}</span>`
    : "";
  return `<span style="position:relative;display:flex;align-items:center;justify-content:center;gap:3px;width:${ancho}px;height:${tamano}px;border-radius:999px;background:${fondo};border:1.5px solid ${color};box-shadow:0 1px 4px rgb(0 0 0 / .22);font-size:11.5px;font-weight:700;color:${color};font-variant-numeric:tabular-nums">
    ${icono}${texto}${etiquetaHtml}
  </span>`;
}

function escapar(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
