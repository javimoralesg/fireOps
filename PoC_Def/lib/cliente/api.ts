// Llamadas tipadas a la API de la sala de mando (rutas en app/api).
// DUEÑO: constructor E. Sin dependencias externas.
//
// Toda función lanza `ErrorApi` con un mensaje ya legible en español: el
// servidor devuelve {error} y aquí se convierte en algo que se puede enseñar
// tal cual en un toast. Nunca se inventa un resultado: si falla, se ve.

import type {
  Camara,
  Decision,
  Evento,
  Evidencia,
  Fundamento,
  Leccion,
  TrazaCiclo,
  Ejecucion,
  FuenteDeteccion,
  Incendio,
  Informe,
  PoliticaAutonomia,
  Reloj,
  Snapshot,
} from "@/lib/dominio/tipos";

export class ErrorApi extends Error {
  readonly estado: number;
  readonly ruta: string;
  constructor(mensaje: string, estado: number, ruta: string) {
    super(mensaje);
    this.name = "ErrorApi";
    this.estado = estado;
    this.ruta = ruta;
  }
}

/** Mensaje presentable para el usuario a partir de cualquier error. */
export function mensajeDeError(e: unknown): string {
  if (e instanceof ErrorApi) return e.message;
  if (e instanceof Error) {
    if (e.name === "AbortError" || e.name === "TimeoutError") return "La petición ha tardado demasiado y se ha cancelado.";
    if (e.message.includes("Failed to fetch")) return "No hay conexión con el servidor de Atalaya.";
    return e.message;
  }
  return "Error desconocido.";
}

interface Opciones {
  metodo?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  cuerpo?: unknown;
  signal?: AbortSignal;
  /** Milisegundos antes de cancelar (por defecto 20 s; las acciones reales pueden tardar). */
  timeoutMs?: number;
}

async function pedir<T>(ruta: string, { metodo = "GET", cuerpo, signal, timeoutMs = 20_000 }: Opciones = {}): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, {
      method: metodo,
      headers: cuerpo !== undefined ? { "content-type": "application/json" } : undefined,
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new ErrorApi(mensajeDeError(e), 0, ruta);
  }

  const texto = await respuesta.text();
  let datos: unknown = undefined;
  if (texto) {
    try {
      datos = JSON.parse(texto);
    } catch {
      datos = undefined;
    }
  }

  if (!respuesta.ok) {
    const detalle =
      datos && typeof datos === "object" && "error" in datos && typeof (datos as { error: unknown }).error === "string"
        ? (datos as { error: string }).error
        : texto.slice(0, 200) || `Error ${respuesta.status}`;
    throw new ErrorApi(detalle, respuesta.status, ruta);
  }

  // Una ruta que aún no existe (stub de otro constructor) puede devolver 200 sin cuerpo.
  return (datos ?? ({} as T)) as T;
}

// --- Estado y reloj ---------------------------------------------------------

export const obtenerEstado = (signal?: AbortSignal) => pedir<Snapshot>("/api/estado", { signal, timeoutMs: 15_000 });

/**
 * Snapshot solo si cambió (constructor P): manda `If-None-Match` con la versión
 * que ya se tiene y devuelve `undefined` si el servidor contesta 304. El polling
 * de respaldo así no descarga megas ni repinta cuando no hay novedades.
 */
export async function obtenerEstadoSiCambio(version: number, signal?: AbortSignal): Promise<Snapshot | undefined> {
  const ruta = "/api/estado";
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, {
      cache: "no-store",
      headers: version >= 0 ? { "if-none-match": `W/"${version}"` } : undefined,
      signal: signal ?? AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new ErrorApi(mensajeDeError(e), 0, ruta);
  }
  if (respuesta.status === 304) return undefined;
  const texto = await respuesta.text();
  if (!respuesta.ok) throw new ErrorApi(texto.slice(0, 200) || `Error ${respuesta.status}`, respuesta.status, ruta);
  try {
    return JSON.parse(texto) as Snapshot;
  } catch {
    throw new ErrorApi("El servidor devolvió un snapshot ilegible.", respuesta.status, ruta);
  }
}

export const obtenerSalud = () => pedir<Record<string, { ok: boolean; detalle?: string; en: string }>>("/api/salud");

/** Pausa/reanuda, cambia el factor o avanza minutos de mundo. */
export const ajustarReloj = (cambio: { factor?: number; pausado?: boolean; avanzarMin?: number }) =>
  pedir<{ reloj: Reloj }>("/api/reloj", { metodo: "POST", cuerpo: cambio });

export const ejecucion = (accion: "nueva" | "cerrar", extra: { nombre?: string; fuentesDesactivadas?: FuenteDeteccion[] } = {}) =>
  pedir<{ ejecucion: Ejecucion }>("/api/ejecucion", { metodo: "POST", cuerpo: { accion, ...extra }, timeoutMs: 60_000 });

/**
 * Apaga/enciende fuentes de detección de la ejecución activa (escenario del
 * mando). Se manda la lista COMPLETA de apagadas; [] = operación real.
 */
export const cambiarFuentesDeteccion = (fuentesDesactivadas: FuenteDeteccion[]) =>
  // Apagar una fuente puede cerrar focos huérfanos (rutas de regreso de sus
  // unidades por carretera): el mismo margen que crear o cerrar una ejecución.
  pedir<{ ejecucion: Ejecucion; cambiado: boolean }>("/api/ejecucion", { metodo: "POST", cuerpo: { accion: "fuentes", fuentesDesactivadas }, timeoutMs: 60_000 });

// --- Focos ------------------------------------------------------------------

export const declararFoco = (foco: { lat: number; lon: number; nombre?: string; notas?: string }) =>
  pedir<{ incendio: Incendio }>("/api/focos", { metodo: "POST", cuerpo: foco, timeoutMs: 60_000 });

export const actualizarFoco = (id: string, cambio: { estado?: Incendio["estado"]; notas?: string }) =>
  pedir<{ incendio: Incendio }>(`/api/focos/${encodeURIComponent(id)}`, { metodo: "PATCH", cuerpo: cambio });

/** Atajo de uso frecuente: cerrar un foco marcándolo como extinguido. */
export const cerrarFoco = (id: string, estado: "controlado" | "extinguido" | "descartado" = "extinguido") =>
  actualizarFoco(id, { estado });

// --- Decisiones -------------------------------------------------------------

export const aprobarDecision = (id: string, quien: string, comentario?: string) =>
  pedir<{ decision: Decision }>(`/api/decisiones/${encodeURIComponent(id)}/aprobar`, {
    metodo: "POST",
    cuerpo: { quien, comentario },
    timeoutMs: 60_000,
  });

export const denegarDecision = (id: string, quien: string, comentario: string) =>
  pedir<{ decision: Decision }>(`/api/decisiones/${encodeURIComponent(id)}/denegar`, {
    metodo: "POST",
    cuerpo: { quien, comentario },
    timeoutMs: 60_000,
  });

export const decisionManual = (cuerpo: {
  titulo: string;
  resumen: string;
  incendioId?: string;
  acciones: { tipo: string; descripcion: string; objetivo?: Record<string, unknown>; parametros?: Record<string, unknown> }[];
  quien: string;
}) => pedir<{ decision: Decision }>("/api/decisiones/manual", { metodo: "POST", cuerpo, timeoutMs: 60_000 });

// --- Agentes ----------------------------------------------------------------

export type AccionAgente = "pausar" | "reanudar" | "asumir" | "liberar" | "ciclo";

export const accionAgente = (id: string, accion: AccionAgente) =>
  pedir<{ ok: boolean }>(`/api/agentes/${encodeURIComponent(id)}`, { metodo: "POST", cuerpo: { accion }, timeoutMs: 45_000 });

// --- Unidades y poblaciones -------------------------------------------------

/**
 * Orden manual a una unidad: el destino puede ser un punto del mapa o el id de
 * una población. `incendioId` y `quien` son obligatorios en el servidor
 * (POST /api/unidades/[id]/ordenar, constructor D).
 */
export const ordenarUnidad = (
  id: string,
  orden: { destino: { lat: number; lon: number } | string; incendioId: string; sector?: string; quien: string },
) => pedir<{ decision: Decision }>(`/api/unidades/${encodeURIComponent(id)}/ordenar`, { metodo: "POST", cuerpo: orden, timeoutMs: 60_000 });

/** Retirada manual de una unidad a su base. */
export const retirarUnidad = (id: string, opciones: { quien: string; motivo?: string }) =>
  pedir<{ decision: Decision }>(`/api/unidades/${encodeURIComponent(id)}/retirar`, { metodo: "POST", cuerpo: opciones, timeoutMs: 60_000 });

export const avisarPoblacion = (id: string, opciones?: { canal?: string; mensaje?: string; quien?: string }) =>
  pedir<{ ok: boolean }>(`/api/poblaciones/${encodeURIComponent(id)}/avisar`, {
    metodo: "POST",
    cuerpo: opciones ?? {},
    timeoutMs: 60_000,
  });

// --- Cámaras ----------------------------------------------------------------

export const listarCamaras = () => pedir<{ camaras: Camara[] }>("/api/camaras");

/**
 * Catálogo COMPLETO de cámaras de España (DGT + Madrid, ~2.300) sin análisis:
 * es lo que pinta la capa "Cámaras de España" del mapa. Tarda si la caché del
 * servidor está fría, por eso el tiempo de espera es más largo.
 */
export const listarTodasLasCamaras = () =>
  pedir<{ total: number; vigiladas: number; camaras: Camara[] }>("/api/camaras?todas=1", { timeoutMs: 45_000 });

export const vigilarCamara = (id: string, vigilar: boolean) =>
  pedir<{ camara: Camara }>(`/api/camaras/${encodeURIComponent(id)}/vigilar`, { metodo: "POST", cuerpo: { vigilada: vigilar } });

/** URL de la imagen de una cámara, con sello temporal para saltarse la caché. */
export const urlImagenCamara = (id: string, sello: number = Date.now()) =>
  `/api/camaras/${encodeURIComponent(id)}/imagen?t=${sello}`;

// --- Viento del ejercicio ---------------------------------------------------

/**
 * Fija a mano el viento de un foco (escenario del mando). `direccionGrados` es
 * DESDE dónde sopla (convenio meteorológico), igual que `Meteo.direccionGrados`.
 * El núcleo lo marca como forzado (`incendio.meteoForzada`) y despierta al
 * meteorólogo, la propagación, el coordinador y el portavoz.
 */
export const fijarViento = (
  id: string,
  viento: { direccionGrados: number; vientoKmh: number; rachasKmh?: number; quien: string },
) => pedir<{ incendio: Incendio }>(`/api/focos/${encodeURIComponent(id)}/viento`, { metodo: "POST", cuerpo: viento, timeoutMs: 45_000 });

/** Devuelve un foco a la previsión real de Open-Meteo. */
export const quitarViento = (id: string, quien: string) =>
  pedir<{ incendio: Incendio }>(`/api/focos/${encodeURIComponent(id)}/viento?quien=${encodeURIComponent(quien)}`, {
    metodo: "DELETE",
    timeoutMs: 45_000,
  });

/** El mismo viento para TODOS los focos activos. */
export const fijarVientoGlobal = (viento: { direccionGrados: number; vientoKmh: number; rachasKmh?: number; quien: string }) =>
  pedir<{ afectados: number; incendios: Incendio[] }>("/api/viento", { metodo: "POST", cuerpo: viento, timeoutMs: 60_000 });

/** Quita el viento forzado de todos los focos activos. */
export const quitarVientoGlobal = (quien: string) =>
  pedir<{ afectados: number; incendios: Incendio[] }>(`/api/viento?quien=${encodeURIComponent(quien)}`, {
    metodo: "DELETE",
    timeoutMs: 60_000,
  });

// --- Política e informes ----------------------------------------------------

export const obtenerPolitica = () => pedir<PoliticaAutonomia>("/api/politica");

export const guardarPolitica = (politica: PoliticaAutonomia) =>
  pedir<PoliticaAutonomia>("/api/politica", { metodo: "PUT", cuerpo: politica });

export const listarInformes = () => pedir<{ informes: Informe[] }>("/api/informes");

// --- Auditoría --------------------------------------------------------------

/**
 * Cadena completa de una decisión: qué la originó, quién la cambió de estado,
 * qué se ejecutó de verdad y qué actas quedaron. Los campos son opcionales a
 * propósito: si el núcleo aún no rellena alguno, la pantalla lo omite.
 */
export interface CadenaAuditoria {
  decision: Decision;
  traza?: TrazaCiclo;
  acciones?: { accion: Decision["acciones"][number]; informe?: Informe }[];
  informes?: Informe[];
  eventos?: Evento[];
  evidencias?: Evidencia[];
  fundamentos?: Fundamento[];
  lecciones?: Leccion[];
}

/**
 * Forma EXACTA en la que el núcleo sirve la cadena (lib/motor/auditoria.ts
 * `cadenaDe`): las acciones llegan planas con su informe dentro, la traza se
 * llama `trazaOrigen` y las lecciones vienen envueltas en `leccionesAplicadas`.
 * Se traduce aquí, en el cliente, para que la pantalla reciba siempre lo mismo.
 */
interface CadenaDelNucleo {
  decision?: Decision;
  traza?: TrazaCiclo | null;
  trazaOrigen?: TrazaCiclo | null;
  acciones?: unknown[];
  informes?: Informe[];
  eventos?: Evento[];
  evidencias?: Evidencia[];
  fundamentos?: Fundamento[];
  lecciones?: Leccion[];
  leccionesAplicadas?: { leccionId?: string; leccion?: Leccion | null }[];
}

/** Traduce la respuesta del núcleo a `CadenaAuditoria`, venga como venga. */
export function normalizarCadenaAuditoria(bruto: CadenaDelNucleo, decision: Decision): CadenaAuditoria {
  type Par = { accion: Decision["acciones"][number]; informe?: Informe };
  const acciones: Par[] = (bruto.acciones ?? []).map((a) => {
    const objeto = a as Record<string, unknown>;
    // Puede venir ya emparejada ({accion, informe}) o plana (Accion + informe).
    if (objeto && typeof objeto === "object" && "accion" in objeto) {
      return { accion: objeto.accion as Par["accion"], informe: (objeto.informe as Informe | null) ?? undefined };
    }
    const { informe, ...accion } = objeto as { informe?: Informe | null };
    return { accion: accion as unknown as Par["accion"], informe: informe ?? undefined };
  });
  const lecciones =
    bruto.lecciones ??
    (bruto.leccionesAplicadas ?? []).map((l) => l.leccion).filter((l): l is Leccion => Boolean(l));
  return {
    decision: bruto.decision ?? decision,
    traza: bruto.traza ?? bruto.trazaOrigen ?? undefined,
    acciones: acciones.filter((par) => Boolean(par.accion?.id)),
    informes: bruto.informes,
    eventos: bruto.eventos,
    evidencias: bruto.evidencias,
    fundamentos: bruto.fundamentos,
    lecciones,
  };
}

export const obtenerAuditoria = async (decisionId: string, decision?: Decision): Promise<CadenaAuditoria> => {
  const bruto = await pedir<CadenaDelNucleo>(`/api/auditoria?decisionId=${encodeURIComponent(decisionId)}`, { timeoutMs: 30_000 });
  return normalizarCadenaAuditoria(bruto, (decision ?? bruto.decision) as Decision);
};

/** URL de descarga del acta en Markdown (se abre en una pestaña nueva). */
export const urlExportarAuditoria = (decisionId: string) =>
  `/api/auditoria/exportar?decisionId=${encodeURIComponent(decisionId)}`;

/** Todo junto, por comodidad al importar. */
export const api = {
  obtenerEstado,
  obtenerEstadoSiCambio,
  obtenerSalud,
  ajustarReloj,
  ejecucion,
  cambiarFuentesDeteccion,
  declararFoco,
  actualizarFoco,
  cerrarFoco,
  aprobarDecision,
  denegarDecision,
  decisionManual,
  accionAgente,
  ordenarUnidad,
  retirarUnidad,
  avisarPoblacion,
  listarCamaras,
  listarTodasLasCamaras,
  vigilarCamara,
  urlImagenCamara,
  fijarViento,
  quitarViento,
  fijarVientoGlobal,
  quitarVientoGlobal,
  obtenerPolitica,
  guardarPolitica,
  listarInformes,
  obtenerAuditoria,
  urlExportarAuditoria,
};

// --- Incidencias (visor por foco) · AÑADIDO por el constructor G ------------
// Petición de Javi (2026-09-19): un visor por incidencia con el flujo de
// agentes, el hilo en vivo de comunicaciones, el informe en vivo y el
// expediente exportable. Rutas en app/api/incidencias/**.

/** Una entrada del hilo de una incidencia (el tipo completo vive en components/incidencia/hilo.ts). */
export interface EntradaHiloApi {
  id: string;
  en: string;
  enMundo: string;
  categoria: "comunicaciones" | "decisiones" | "unidades" | "percepcion" | "actas";
  titulo: string;
  detalle?: string;
  actor?: string;
  exito?: boolean;
  decisionId?: string;
  accionId?: string;
  informeId?: string;
}

export interface RespuestaHiloIncidencia {
  incendio: { id: string; nombre: string; municipio: string; provincia: string; estado: string; areaHa: number };
  ejecucion: { id: string; nombre: string };
  horaMundo: string;
  generadoEn: string;
  total: number;
  totales: Record<string, number>;
  entradas: EntradaHiloApi[];
}

/** Hilo ya fusionado y ordenado (lo más reciente primero) de una incidencia. */
export const obtenerHiloIncidencia = (incendioId: string, opciones?: { categoria?: string; buscar?: string; limite?: number }) => {
  const p = new URLSearchParams();
  if (opciones?.categoria) p.set("categoria", opciones.categoria);
  if (opciones?.buscar) p.set("buscar", opciones.buscar);
  if (opciones?.limite) p.set("limite", String(opciones.limite));
  const consulta = p.toString();
  return pedir<RespuestaHiloIncidencia>(`/api/incidencias/${encodeURIComponent(incendioId)}/hilo${consulta ? `?${consulta}` : ""}`, {
    timeoutMs: 30_000,
  });
};

export interface RespuestaInformeVivo {
  informeId: string;
  titulo: string;
  conNarrativaIA: boolean;
  modelo: string;
  huella?: string;
  markdown: string;
}

/**
 * Informe EN VIVO de una sola incidencia: acta determinista siempre (situación,
 * cronología de comunicaciones con su resultado real, decisiones, unidades,
 * poblaciones y actas) y narrativa de IA si el proveedor responde a tiempo.
 * Puede tardar: la narrativa tiene 20 s de margen dentro del servidor.
 */
export const generarInformeIncidencia = (incendioId: string) =>
  pedir<RespuestaInformeVivo>(`/api/incidencias/${encodeURIComponent(incendioId)}/informe`, {
    metodo: "POST",
    cuerpo: {},
    timeoutMs: 90_000,
  });

/** URL de descarga del expediente completo de la incidencia en Markdown. */
export const urlExpedienteIncidencia = (incendioId: string) => `/api/incidencias/${encodeURIComponent(incendioId)}/expediente`;

/** URL de descarga de un acta concreta en Markdown. */
export const urlInformeMarkdown = (informeId: string) => `/api/informes/${encodeURIComponent(informeId)}?formato=md`;
