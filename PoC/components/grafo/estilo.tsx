// Estilo de vértices y aristas del grafo esquemático. Color por tipo (tokens de
// globals.css, con valor claro y oscuro) y además una FORMA por familia, para que
// el color nunca sea el único canal (docs/identidad.md · accesibilidad).

import type { TipoArista, TipoNodo } from "@/lib/types";

export type Forma = "circulo" | "cuadrado" | "rombo" | "triangulo" | "anillo" | "cruz";

export interface EstiloNodo {
  fill: string;
  label: string;
  plural: string;
  forma: Forma;
  /** Radio base en px (antes del ajuste por zoom). */
  radio: number;
}

export const NODO_UI: Record<TipoNodo, EstiloNodo> = {
  Incidencia: { fill: "var(--danger)", label: "Incidencia", plural: "Incidencias", forma: "circulo", radio: 7.5 },
  Hospital: { fill: "var(--nodo-hospital)", label: "Hospital", plural: "Hospitales", forma: "cruz", radio: 6.2 },
  Centro_Comunicaciones: { fill: "var(--nodo-comunicaciones)", label: "Comunicaciones", plural: "Comunicaciones", forma: "rombo", radio: 5.2 },
  Ruta_Evacuacion: { fill: "var(--nodo-ruta)", label: "Ruta de evacuación", plural: "Rutas de evacuación", forma: "rombo", radio: 5.2 },
  Carretera: { fill: "var(--nodo-via)", label: "Vía", plural: "Vías", forma: "circulo", radio: 4 },
  Bomberos: { fill: "var(--nodo-bomberos)", label: "Bomberos", plural: "Bomberos", forma: "cuadrado", radio: 5 },
  Policia: { fill: "var(--nodo-policia)", label: "Policía", plural: "Policía", forma: "cuadrado", radio: 5 },
  Sanitarios: { fill: "var(--nodo-sanitarios)", label: "Sanitarios", plural: "Sanitarios", forma: "cuadrado", radio: 5 },
  // Tipos del grafo real (OpenStreetMap)
  Residencia: { fill: "var(--nodo-hospital)", label: "Residencia", plural: "Residencias", forma: "anillo", radio: 4.8 },
  Colegio: { fill: "var(--nodo-comunicaciones)", label: "Colegio", plural: "Colegios", forma: "circulo", radio: 3.2 },
  Subestacion: { fill: "var(--warning)", label: "Subestación", plural: "Subestaciones", forma: "triangulo", radio: 4.6 },
  Estacion: { fill: "var(--nodo-policia)", label: "Estación", plural: "Estaciones", forma: "circulo", radio: 3.4 },
  Refugio: { fill: "var(--nodo-ruta)", label: "Refugio", plural: "Refugios", forma: "circulo", radio: 4.2 },
  Gasolinera: { fill: "var(--danger)", label: "Gasolinera", plural: "Gasolineras", forma: "triangulo", radio: 3.8 },
};

/** Vértice de un tipo que aún no conocemos: se pinta neutro en vez de romper. */
export const NODO_DESCONOCIDO: EstiloNodo = { fill: "var(--subtle)", label: "Otro", plural: "Otros", forma: "circulo", radio: 4 };

export const estiloNodo = (tipo: string): EstiloNodo => (NODO_UI as Record<string, EstiloNodo>)[tipo] ?? NODO_DESCONOCIDO;

/**
 * Una frase por tipo: qué representa el vértice en la operación. La usan la
 * leyenda y la ficha (docs/identidad.md · "reconocimiento antes que memoria").
 */
export const DESCRIPCION_TIPO: Record<string, string> = {
  Incidencia: "Foco activo del incidente: origen del penacho de humo y del efecto dominó.",
  Hospital: "Centro hospitalario que recibe heridos: no puede quedar aislado ni bajo el humo.",
  Centro_Comunicaciones: "Nodo de comunicaciones; si cae, se pierde coordinación con los efectivos.",
  Ruta_Evacuacion: "Itinerario previsto para sacar población de la zona afectada.",
  Carretera: "Vía de la red rodada: puede quedar cortada y bloquear accesos.",
  Bomberos: "Parque o dotación de bomberos desplegable sobre la incidencia.",
  Policia: "Unidad policial: corte de tráfico, control de accesos y orden público.",
  Sanitarios: "Recurso sanitario desplegable: soporte vital o punto de triaje.",
  Residencia: "Residencia de mayores: población vulnerable y evacuación lenta.",
  Colegio: "Centro educativo: concentración de población en horario lectivo.",
  Subestacion: "Subestación eléctrica: su caída arrastra a todo lo que suministra.",
  Estacion: "Estación de transporte: entrada y salida de personas de la zona.",
  Refugio: "Punto de refugio o acogida para la población evacuada.",
  Gasolinera: "Depósito de combustible: riesgo de propagación si llega el fuego.",
};

export const descripcionTipo = (tipo: string): string =>
  DESCRIPCION_TIPO[tipo] ?? "Vértice del grafo de la ciudad importado de OpenStreetMap.";

/** Orden de la leyenda: de lo más crítico a lo contextual. */
export const ORDEN_TIPOS: string[] = [
  "Incidencia",
  "Hospital",
  "Residencia",
  "Bomberos",
  "Policia",
  "Sanitarios",
  "Centro_Comunicaciones",
  "Ruta_Evacuacion",
  "Refugio",
  "Subestacion",
  "Carretera",
  "Estacion",
  "Colegio",
  "Gasolinera",
];

export const EFECTIVOS = new Set<string>(["Bomberos", "Policia", "Sanitarios"]);

/** Tipos de contexto: fuera del dominó y del humo se dibujan pequeños y atenuados. */
export const TIPOS_FONDO = new Set<string>(["Colegio", "Gasolinera", "Estacion"]);

export interface EstiloArista {
  stroke: string;
  ancho: number;
  opacidad: number;
  anim: boolean;
  texto: string;
}

export const ARISTA_UI: Record<TipoArista, EstiloArista> = {
  BLOQUEA_A: {
    stroke: "var(--danger)",
    ancho: 1.6,
    opacidad: 0.9,
    anim: true,
    texto: "El origen corta o inutiliza el destino: la incidencia bloquea una vía o un acceso.",
  },
  DESPLEGADO_EN: {
    stroke: "var(--accent)",
    ancho: 1.4,
    opacidad: 0.85,
    anim: true,
    texto: "Un efectivo (bomberos, policía o sanitarios) está desplegado sobre ese punto.",
  },
  // Relación de contexto: se dibuja fina para no tapar lo operativo, pero con
  // opacidad suficiente para leerse sobre el panel blanco del tema claro.
  SUMINISTRA_A: {
    stroke: "var(--subtle)",
    ancho: 0.9,
    opacidad: 0.45,
    anim: false,
    texto: "El origen da acceso, energía o servicio al destino: si cae, el destino se resiente.",
  },
};

export const ARISTA_DESCONOCIDA: EstiloArista = {
  stroke: "var(--subtle)",
  ancho: 0.9,
  opacidad: 0.45,
  anim: false,
  texto: "Relación entre dos vértices del grafo.",
};

export const estiloArista = (tipo: string): EstiloArista => (ARISTA_UI as Record<string, EstiloArista>)[tipo] ?? ARISTA_DESCONOCIDA;

export const ORDEN_ARISTAS: string[] = ["BLOQUEA_A", "DESPLEGADO_EN", "SUMINISTRA_A"];

/** Símbolo del vértice centrado en el origen, en píxeles. */
export function Simbolo({ forma, r, color }: { forma: Forma; r: number; color: string }) {
  const borde = { stroke: "var(--panel)", strokeWidth: 1.2 };
  switch (forma) {
    case "cuadrado":
      return <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={r * 0.3} fill={color} {...borde} />;
    case "rombo": {
      const k = r * 1.3;
      return <path d={`M0 ${-k}L${k} 0L0 ${k}L${-k} 0Z`} fill={color} strokeLinejoin="round" {...borde} />;
    }
    case "triangulo": {
      const k = r * 1.35;
      return <path d={`M0 ${-k}L${k * 0.95} ${k * 0.7}L${-k * 0.95} ${k * 0.7}Z`} fill={color} strokeLinejoin="round" {...borde} />;
    }
    case "anillo":
      return <circle r={Math.max(1.2, r - 0.9)} fill="var(--panel)" stroke={color} strokeWidth={Math.max(1.6, r * 0.42)} />;
    case "cruz": {
      const a = r * 0.52;
      return (
        <>
          <circle r={r} fill={color} {...borde} />
          <path d={`M0 ${-a}V${a}M${-a} 0H${a}`} stroke="var(--panel)" strokeWidth={Math.max(1.3, r * 0.3)} strokeLinecap="round" />
        </>
      );
    }
    default:
      return <circle r={r} fill={color} {...borde} />;
  }
}

/** Muestra de 12 px para leyendas, tooltips y el panel de detalle. */
export function MuestraTipo({ tipo, tam = 12 }: { tipo: string; tam?: number }) {
  const ui = estiloNodo(tipo);
  const h = tam / 2;
  return (
    <svg width={tam} height={tam} viewBox={`${-h} ${-h} ${tam} ${tam}`} aria-hidden className="shrink-0 overflow-visible">
      <Simbolo forma={ui.forma} r={h * 0.72} color={ui.fill} />
    </svg>
  );
}
