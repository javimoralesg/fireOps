// Catálogo visual del Simulador: etiqueta, icono y color por tipo de emergencia,
// canal, veracidad e impacto. Colores solo con tokens de app/globals.css (estados
// y paleta --nodo-* del grafo, que tienen valor claro y oscuro). Todo mapeo lleva
// fallback: el dataset y el pipeline siguen creciendo.

import type { CSSProperties } from "react";
import {
  Activity,
  AtSign,
  Biohazard,
  BrickWall,
  Camera,
  CarFront,
  Cctv,
  CheckCheck,
  CircleHelp,
  CloudFog,
  Copy,
  Cpu,
  Factory,
  FastForward,
  Flame,
  Inbox,
  LifeBuoy,
  Megaphone,
  MessageSquareText,
  Phone,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Smartphone,
  Snowflake,
  ThermometerSun,
  TrainFront,
  Trees,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Users,
  VolumeX,
  Waves,
  ZapOff,
} from "lucide-react";
import type { GravedadSim, TipoObservacionSim, Veracidad } from "./tipos";

export type Icono = typeof CircleHelp;

/** Variable CSS del color (sin var()). */
export type VarColor =
  | "--danger"
  | "--warning"
  | "--success"
  | "--info"
  | "--brand"
  | "--muted"
  | "--nodo-bomberos"
  | "--nodo-comunicaciones"
  | "--nodo-hospital";

/** Tinte de la identidad: fondo al 10 %, borde al 30 %, texto/icono del color. */
export function tinte(v: VarColor, soloIcono = false): CSSProperties {
  return {
    color: soloIcono ? undefined : `var(${v})`,
    backgroundColor: `color-mix(in srgb, var(${v}) 10%, transparent)`,
    borderColor: `color-mix(in srgb, var(${v}) 30%, transparent)`,
  };
}

/* ------------------------------------------------------ tipo de emergencia */

export interface TipoUI {
  etiqueta: string;
  icon: Icono;
  color: VarColor;
  /** Categoría de observación que debería detectar el pipeline (para el "esperado" del compositor). */
  categoria: string;
  ejemplo: string;
}

export const TIPO_UI: Record<string, TipoUI> = {
  incendio_industrial: {
    etiqueta: "Incendio industrial",
    icon: Factory,
    color: "--danger",
    categoria: "incendio",
    ejemplo: "Sale mucho humo negro de una nave del polígono, se ven llamas por el tejado.",
  },
  incendio_urbano: {
    etiqueta: "Incendio urbano",
    icon: Flame,
    color: "--danger",
    categoria: "incendio",
    ejemplo: "Fuego en un piso de la tercera planta, hay vecinos asomados a las ventanas pidiendo ayuda.",
  },
  incendio_forestal: {
    etiqueta: "Incendio forestal",
    icon: Trees,
    color: "--nodo-bomberos",
    categoria: "incendio",
    ejemplo: "Columna de humo en el monte junto a la carretera, el viento empuja las llamas hacia las casas.",
  },
  inundacion: {
    etiqueta: "Inundación",
    icon: Waves,
    color: "--info",
    categoria: "inundacion",
    ejemplo: "El paso inferior está completamente anegado, hay un coche atrapado con el agua por las ventanillas.",
  },
  accidente_trafico: {
    etiqueta: "Accidente de tráfico",
    icon: CarFront,
    color: "--warning",
    categoria: "accidente",
    ejemplo: "Colisión múltiple en la M-30 sentido sur, tres coches implicados y un herido atrapado.",
  },
  accidente_ferroviario: {
    etiqueta: "Accidente ferroviario",
    icon: TrainFront,
    color: "--warning",
    categoria: "accidente_ferroviario",
    ejemplo: "Un tren de Cercanías se ha detenido de golpe en el túnel, hay humo y pasajeros saliendo por las vías.",
  },
  fuga_gas: {
    etiqueta: "Fuga de gas",
    icon: CloudFog,
    color: "--nodo-comunicaciones",
    categoria: "fuga_gas",
    ejemplo: "Fuerte olor a gas en todo el portal, los vecinos están bajando a la calle.",
  },
  derrumbe: {
    etiqueta: "Derrumbe",
    icon: BrickWall,
    color: "--nodo-hospital",
    categoria: "derrumbe",
    ejemplo: "Se ha venido abajo parte de la fachada de un edificio en obras, puede haber alguien debajo.",
  },
  apagon: {
    etiqueta: "Apagón",
    icon: ZapOff,
    color: "--warning",
    categoria: "corte_electrico",
    ejemplo: "Sin luz en todo el barrio desde hace media hora, los semáforos están apagados.",
  },
  ola_calor: {
    etiqueta: "Ola de calor",
    icon: ThermometerSun,
    color: "--nodo-bomberos",
    categoria: "ola_calor",
    ejemplo: "Una persona mayor se ha desmayado en la parada del autobús, hace más de 40 grados.",
  },
  nevada: {
    etiqueta: "Nevada",
    icon: Snowflake,
    color: "--info",
    categoria: "nevada",
    ejemplo: "La nieve bloquea la salida del barrio, hay vehículos atrapados y la quitanieves no ha pasado.",
  },
  sismo: {
    etiqueta: "Sismo",
    icon: Activity,
    color: "--nodo-hospital",
    categoria: "terremoto",
    ejemplo: "Ha temblado todo el edificio unos segundos, se han caído cosas de las estanterías y hay grietas.",
  },
  aglomeracion: {
    etiqueta: "Aglomeración",
    icon: Users,
    color: "--nodo-comunicaciones",
    categoria: "aglomeracion",
    ejemplo: "Avalancha de gente en la salida del estadio, empujones y personas en el suelo.",
  },
  vertido_quimico: {
    etiqueta: "Vertido químico",
    icon: Biohazard,
    color: "--nodo-comunicaciones",
    categoria: "vertido",
    ejemplo: "Un camión cisterna ha volcado y pierde un líquido amarillento con olor muy fuerte.",
  },
  persona_peligro: {
    etiqueta: "Persona en peligro",
    icon: LifeBuoy,
    color: "--danger",
    categoria: "persona_en_peligro",
    ejemplo: "Hay una persona en la cornisa del puente, no responde a los que le hablan.",
  },
  amenaza_seguridad: {
    etiqueta: "Amenaza de seguridad",
    icon: ShieldAlert,
    color: "--danger",
    categoria: "amenaza",
    ejemplo: "Han dejado una mochila abandonada junto a la entrada de la estación y nadie la reclama.",
  },
  otro: {
    etiqueta: "Otro",
    icon: CircleHelp,
    color: "--muted",
    categoria: "otro",
    ejemplo: "Algo raro está pasando en la plaza, mucha gente corriendo en la misma dirección.",
  },
};

// Alias: el generador del dataset (lib/dataset/tipos.ts) usa otros nombres para dos tipos.
TIPO_UI.terremoto = TIPO_UI.sismo;
TIPO_UI.persona_en_peligro = TIPO_UI.persona_peligro;

/** Tipos que ofrece el compositor (los del motor, lib/tipos-sistema.ts, más amenaza). */
export const TIPOS_EMERGENCIA = Object.keys(TIPO_UI).filter((t) => t !== "terremoto" && t !== "persona_en_peligro");

export function uiTipo(tipo: string | undefined): TipoUI {
  if (!tipo) return TIPO_UI.otro;
  return TIPO_UI[tipo] ?? { ...TIPO_UI.otro, etiqueta: tipo.replace(/_/g, " ") };
}

/* ------------------------------------------------------------------ canal */

export interface CanalUI {
  etiqueta: string;
  icon: Icono;
}

export const OBSERVACION_UI: Record<TipoObservacionSim, CanalUI & { ayuda: string }> = {
  voz: { etiqueta: "Llamada 112", icon: Phone, ayuda: "Transcripción de una llamada o nota de voz." },
  texto: { etiqueta: "Aviso escrito", icon: MessageSquareText, ayuda: "Mensaje escrito desde la app ciudadana." },
  publicacion: { etiqueta: "Redes sociales", icon: AtSign, ayuda: "Publicación en la red social simulada: pasa por el filtro anti-bulos." },
  imagen: { etiqueta: "Foto", icon: Camera, ayuda: "Foto con posición: pasa por visión artificial." },
  sensor: { etiqueta: "Sensor", icon: Cpu, ayuda: "Lectura de un sensor (gas, nivel de agua, temperatura…)." },
};

export const TIPOS_OBSERVACION = Object.keys(OBSERVACION_UI) as TipoObservacionSim[];

/** Canales del generador (lib/dataset/tipos.ts · Canal) con su nombre legible. */
const CANAL_ETIQUETA: Record<string, string> = {
  llamada_112: "Llamada 112",
  app_ciudadana: "App ciudadana",
  app: "App ciudadana",
  red_social: "Red social",
  camara_trafico: "Cámara de tráfico",
  sensor: "Sensor",
  aviso_oficial: "Aviso oficial",
  efectivo: "Efectivo",
  voz: "Llamada 112",
  texto: "Aviso escrito",
  publicacion: "Redes sociales",
  imagen: "Foto",
};

/** El canal del dataset es texto libre ("112", "redes", "camara_trafico"…): se reconoce por patrón. */
export function uiCanal(canal: string | undefined, tipo?: TipoObservacionSim): CanalUI {
  const c = (canal ?? "").toLowerCase();
  const legible = canal ? (CANAL_ETIQUETA[c] ?? canal.replace(/_/g, " ")) : undefined;
  if (/aviso_oficial|oficial|aemet|boletin/.test(c)) return { etiqueta: legible ?? "Aviso oficial", icon: Megaphone };
  if (/camara_trafico|cctv|trafico/.test(c)) return { etiqueta: legible ?? "Cámara de tráfico", icon: Cctv };
  if (/112|llamada|telef|voz/.test(c)) return { etiqueta: legible ?? "Llamada 112", icon: Phone };
  if (/red|social|tuit|twitter|public/.test(c)) return { etiqueta: legible ?? "Redes sociales", icon: AtSign };
  if (/sensor|iot|estaci/.test(c)) return { etiqueta: legible ?? "Sensor", icon: Cpu };
  if (/app|movil|móvil|ciudadan/.test(c)) return { etiqueta: legible ?? "App ciudadana", icon: Smartphone };
  if (/efectivo|bomber|policia|samur|pma/.test(c)) return { etiqueta: legible ?? "Efectivo", icon: Siren };
  if (/camara|cámara|foto|imagen/.test(c)) return { etiqueta: legible ?? "Foto", icon: Camera };
  if (tipo && OBSERVACION_UI[tipo]) return { etiqueta: legible ?? OBSERVACION_UI[tipo].etiqueta, icon: OBSERVACION_UI[tipo].icon };
  return { etiqueta: legible ?? "Canal", icon: Radio };
}

/* -------------------------------------------------------------- veracidad */

export const VERACIDAD_UI: Record<Veracidad, { etiqueta: string; icon: Icono; clase: string; ayuda: string }> = {
  real: {
    etiqueta: "Real",
    icon: ShieldCheck,
    clase: "pildora-exito",
    ayuda: "Evento veraz del dataset: debería llegar al mando y, si es nuevo, generar una decisión.",
  },
  duplicado: {
    etiqueta: "Duplicado",
    icon: Copy,
    clase: "",
    ayuda: "Repite algo que ya se ha reportado: el sistema debería agruparlo sin crear otra decisión.",
  },
  bulo: {
    etiqueta: "Bulo",
    icon: ShieldAlert,
    clase: "pildora-peligro",
    ayuda: "Información falsa a propósito: el sistema debería marcarla como sospechosa y sugerir un desmentido al Gabinete.",
  },
  ruido: {
    etiqueta: "Ruido",
    icon: VolumeX,
    clase: "pildora-aviso",
    ayuda: "Sin valor operativo (quejas, bromas, sin novedad): el sistema debería descartarlo sin molestar al mando.",
  },
};

export const VERACIDADES = Object.keys(VERACIDAD_UI) as Veracidad[];

/* ---------------------------------------------------------------- impacto */

export interface ImpactoUI {
  etiqueta: string;
  icon: Icono;
  clase: string;
  ayuda: string;
}

export const IMPACTO_UI: Record<string, ImpactoUI> = {
  ruido: {
    etiqueta: "Ruido",
    icon: VolumeX,
    clase: "",
    ayuda: "No aporta nada (sin novedad o confianza muy baja). Se guarda, pero no llega al mando.",
  },
  registrado: {
    etiqueta: "Registrado",
    icon: Inbox,
    clase: "pildora-info",
    ayuda: "Evento guardado en el feed de ingesta. No crea decisión: queda como contexto para las siguientes.",
  },
  confirma: {
    etiqueta: "Confirma",
    icon: CheckCheck,
    clase: "pildora-exito",
    ayuda: "Confirma un foco que ya existía: sube la confianza sin duplicar decisiones.",
  },
  nuevo_foco: {
    etiqueta: "Nuevo foco",
    icon: Siren,
    clase: "pildora-peligro",
    ayuda: "Incidencia nueva: se añade un vértice al grafo y la IA propone una decisión al mando.",
  },
  agrava: {
    etiqueta: "Agrava",
    icon: TrendingUp,
    clase: "pildora-peligro",
    ayuda: "El foco existente empeora: nueva decisión o invalidación de las propuestas pendientes que ya no sirven.",
  },
  mitiga: {
    etiqueta: "Mitiga",
    icon: TrendingDown,
    clase: "pildora-exito",
    ayuda: "La situación mejora (controlado, sin humo): se registra e informa al SITREP.",
  },
  desmentido_sugerido: {
    etiqueta: "Desmentido sugerido",
    icon: ShieldAlert,
    clase: "pildora-aviso",
    ayuda: "Publicación sospechosa de ser un bulo: se propone un desmentido al Gabinete de Información.",
  },
  tick: {
    etiqueta: "Paso del guion",
    icon: FastForward,
    clase: "pildora-marca",
    ayuda: "El guion guiado avanza un paso: el motor aplica el siguiente tick del simulacro (eventos, viento, propuestas).",
  },
  error: {
    etiqueta: "Error",
    icon: TriangleAlert,
    clase: "pildora-peligro",
    ayuda: "El evento no se pudo procesar. El motivo aparece debajo.",
  },
};

export function uiImpacto(impacto: string | undefined, conError?: boolean): ImpactoUI {
  if (conError) return IMPACTO_UI.error;
  if (!impacto) return IMPACTO_UI.registrado;
  return (
    IMPACTO_UI[impacto] ?? {
      etiqueta: impacto.replace(/_/g, " "),
      icon: CircleHelp,
      clase: "",
      ayuda: "Impacto que este panel todavía no conoce; lo devuelve el pipeline tal cual.",
    }
  );
}

/* --------------------------------------------------------------- gravedad */

export const GRAVEDAD_UI: Record<GravedadSim, { etiqueta: string; color: VarColor }> = {
  critica: { etiqueta: "Crítica", color: "--danger" },
  alta: { etiqueta: "Alta", color: "--warning" },
  media: { etiqueta: "Media", color: "--info" },
  baja: { etiqueta: "Baja", color: "--success" },
  nula: { etiqueta: "Nula", color: "--muted" },
};

/* -------------------------------------------------------------- categoría */

const CATEGORIA_ETIQUETA: Record<string, string> = {
  incendio: "Incendio",
  humo: "Humo",
  inundacion: "Inundación",
  accidente: "Accidente",
  derrumbe: "Derrumbe",
  aglomeracion: "Aglomeración",
  persona_en_peligro: "Persona en peligro",
  vertido: "Vertido",
  corte_electrico: "Corte eléctrico",
  explosion: "Explosión",
  fuga_gas: "Fuga de gas",
  terremoto: "Terremoto",
  ola_calor: "Ola de calor",
  nevada: "Nevada",
  accidente_ferroviario: "Accidente ferroviario",
  amenaza: "Amenaza",
  sin_novedad: "Sin novedad",
  otro: "Otro",
};

export const etiquetaCategoria = (c: string) => CATEGORIA_ETIQUETA[c] ?? c.replace(/_/g, " ");

/** ¿La categoría detectada cuenta como acierto? Familias equivalentes (humo ≈ incendio, tren ≈ accidente). */
export function aciertaCategoria(esperada: string, detectada: string): boolean {
  if (esperada === detectada) return true;
  const familia: Record<string, string> = {
    humo: "incendio",
    explosion: "incendio",
    accidente_ferroviario: "accidente",
  };
  return (familia[esperada] ?? esperada) === (familia[detectada] ?? detectada);
}
