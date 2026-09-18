// Pipeline de ingesta de observaciones (poc-07): almacén → visión/clasificación
// → evento → verificación → impacto → motor. Es el único camino por el que
// entran al sistema los inputs reales (móvil, cámara de tráfico, publicación,
// sensor, simulador de escenarios). No lanza por fallos de servicios externos:
// degrada y lo cuenta en el resultado que ve el periférico.

import type { EventoIngesta, ProcesadoPor } from "../../types";
import type { AnalisisVision, CategoriaObservacion, ObservacionEntrante, Periferico, PosicionGeo, ResultadoIngesta, TipoObservacion } from "../../tipos-perifericos";
import type { EstadoSistema } from "../../tipos-sistema";
import { nuevoId } from "../estado";
import { ingestarObservacion, obtenerEstado } from "../motor";
import { formatearDistancia } from "../../../components/mapa/geo";
import { geocodificarInverso } from "../geo/nominatim";
import { descargarImagen, guardarImagen, type ImagenGuardada } from "./almacen";
import { descripcionDeFoco, evaluarImpacto, lugarMasCercano, nombreCategoria } from "./impacto";
import { anotarObservacion, latido, listarPerifericos, obtenerPeriferico, registrarPeriferico } from "./registro";
import { verificarObservacion } from "./verificacion";
import { analizarTexto, analizarVision } from "./vision";

const NOMBRE_SIMULADOR = "Simulador de escenarios";
const UMBRAL_SENSOR = 8; // magnitud a partir de la cual un sensor se considera disparado

/** Error con código HTTP para que las rutas respondan 400/404 sin inventarse nada. */
export class ErrorIngesta extends Error {
  readonly estadoHttp: number;
  constructor(mensaje: string, estadoHttp = 400) {
    super(mensaje);
    this.name = "ErrorIngesta";
    this.estadoHttp = estadoHttp;
  }
}

/** Observación + campos extra del reproductor de escenarios (poc-55). Los desconocidos se ignoran. */
export interface ObservacionPipeline extends Partial<ObservacionEntrante> {
  datasetId?: string;
  eventoDatasetId?: string;
  canal?: string;
}

const TIPOS: TipoObservacion[] = ["imagen", "fotograma", "texto", "voz", "publicacion", "posicion", "sensor"];

/** Periférico no persistido para webhooks/sensores anónimos ("externo"). */
function perifericoExterno(id: string, nombre: string): Periferico {
  const ahora = new Date().toISOString();
  return { id, nombre, tipo: "webhook", registradoEn: ahora, ultimoLatido: ahora, enLinea: true, capacidades: [], modo: "manual", intervaloVigilanciaSeg: 15, observaciones: 0, confianza: 0.6 };
}

/** El simulador de escenarios se registra solo la primera vez y se reutiliza. */
async function perifericoSimulador(): Promise<Periferico> {
  const existente = (await listarPerifericos()).find((p) => p.nombre === NOMBRE_SIMULADOR);
  if (existente) return existente;
  return registrarPeriferico({ nombre: NOMBRE_SIMULADOR, tipo: "webhook" });
}

/** Resuelve el periférico de la observación (404 si se cita uno que no existe). */
export async function resolverPeriferico(perifericoId: string | undefined, tipo: TipoObservacion, simulacro: boolean): Promise<Periferico> {
  const id = (perifericoId ?? "").trim();
  if (simulacro || id === "simulador") return perifericoSimulador();
  if (!id || id === "externo") {
    if (tipo === "posicion") throw new ErrorIngesta("Una observación de posición necesita un periférico registrado", 400);
    return perifericoExterno("externo", "Canal externo (webhook/sensor)");
  }
  const p = await obtenerPeriferico(id);
  if (!p) throw new ErrorIngesta(`Periférico ${id} no encontrado`, 404);
  return p;
}

function posicionDe(obs: ObservacionPipeline): PosicionGeo | undefined {
  const p = obs.posicion;
  if (!p || typeof p.lat !== "number" || typeof p.lon !== "number") return undefined;
  return { lat: p.lat, lon: p.lon, precisionM: p.precisionM, rumboGrados: p.rumboGrados, timestamp: p.timestamp || new Date().toISOString() };
}

function fuenteDe(periferico: Periferico, tipo: TipoObservacion): EventoIngesta["fuente"] {
  if (periferico.tipo === "camara_trafico") return "CamaraTrafico";
  if (tipo === "publicacion" || periferico.tipo === "movil_ciudadano") return "Ciudadano";
  return "Periferico";
}

const dosDecimales = (n: number) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Calle real (Nominatim, 3 s como mucho) y, si falla, solo el vértice más cercano. */
async function calleDe(lat: number, lon: number): Promise<string | undefined> {
  try {
    const texto = await Promise.race([
      geocodificarInverso(lat, lon),
      new Promise<undefined>((r) => setTimeout(() => r(undefined), 3_000)),
    ]);
    return texto?.trim() || undefined;
  } catch (err) {
    console.warn("[pipeline/nominatim]", err instanceof Error ? err.message : err);
    return undefined;
  }
}

/** "C/ Méndez Álvaro 56, Arganzuela · a 120 m de Residencia Emera (40.3937, -3.6788)" */
async function textoUbicacion(estado: EstadoSistema, geo?: { lat: number; lon: number }): Promise<string | undefined> {
  if (!geo) return undefined;
  const lugar = lugarMasCercano(estado, geo.lat, geo.lon);
  const calle = await calleDe(geo.lat, geo.lon);
  const relativo = `a ${formatearDistancia(lugar.distanciaM)} de ${lugar.nombre} (${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)})`;
  return calle ? `${calle} · ${relativo}` : relativo;
}

/** Análisis de un sensor (acelerómetro del móvil, detector de humo…). */
function analisisDeSensor(sensor: { magnitud: string; valor: number; unidad: string }): AnalisisVision {
  const disparado = sensor.valor >= UMBRAL_SENSOR;
  return {
    motor: "ninguno",
    modelo: "umbral-sensor",
    latenciaMs: 0,
    descripcion: `Sensor ${sensor.magnitud}: ${sensor.valor} ${sensor.unidad}${disparado ? " (por encima del umbral)" : ""}`,
    categoria: disparado ? "derrumbe" : "otro",
    confianza: 0.5,
    gravedad: disparado ? "alta" : "baja",
    etiquetas: [sensor.magnitud],
  };
}

/** Motores que son un modelo de verdad (o una lectura física): su categoría manda sobre la esperada del dataset. */
const MOTORES_REALES: AnalisisVision["motor"][] = ["Claude", "Ollama", "FalAI"];

/** Categoría esperada del dataset (reproductor de escenarios de poc-55/poc-26): solo se usa si ningún modelo real ha podido clasificar. */
function analisisDeDataset(obs: ObservacionPipeline): AnalisisVision {
  const categoria = (obs.categoriaForzada ?? "otro") as CategoriaObservacion;
  return {
    motor: "dataset",
    modelo: "dataset (clasificación esperada)",
    latenciaMs: 0,
    descripcion: obs.texto?.slice(0, 180) || `${nombreCategoria(categoria)} (dataset${obs.tipoEmergencia ? `: ${obs.tipoEmergencia}` : ""})`,
    categoria,
    confianza: 0.8,
    gravedad: obs.gravedadForzada ?? "alta",
    etiquetas: [obs.tipoEmergencia, "dataset"].filter((x): x is string => Boolean(x)),
  };
}

async function analizarObservacion(obs: ObservacionPipeline, tipo: TipoObservacion, imagen: ImagenGuardada | undefined, base64?: string): Promise<AnalisisVision> {
  if (tipo === "sensor" && obs.sensor) return analisisDeSensor(obs.sensor);
  // Siempre se intenta el análisis real; la categoría esperada del dataset solo entra cuando
  // ningún modelo ha podido clasificar (sin proveedor, timeout o cola ocupada), para no
  // fabricar decisiones a partir del clasificador de palabras clave.
  const analisis = imagen && base64 ? await analizarVision({ base64, mime: imagen.mime, url: imagen.urlAbsoluta }, obs.texto) : await analizarTexto(obs.texto ?? "", obs.tipoEmergencia);
  const hayEsperada = Boolean(obs.categoriaForzada || obs.gravedadForzada);
  if (hayEsperada && !MOTORES_REALES.includes(analisis.motor)) {
    const dataset = analisisDeDataset(obs);
    return { ...dataset, descripcion: analisis.descripcion && analisis.motor !== "ninguno" ? `${dataset.descripcion} · ${analisis.descripcion}` : dataset.descripcion };
  }
  return analisis;
}

/**
 * Procesa una observación entrante de principio a fin.
 * @throws ErrorIngesta con estadoHttp 400/404 (el resto de fallos se degradan).
 */
export async function procesarObservacion(obs: ObservacionPipeline, opciones: { simulacro?: boolean } = {}): Promise<ResultadoIngesta> {
  const tipo = obs.tipo as TipoObservacion | undefined;
  if (!tipo || !TIPOS.includes(tipo)) throw new ErrorIngesta(`tipo de observación no válido (${TIPOS.join(" | ")})`, 400);
  const simulacro = opciones.simulacro === true || obs.simulacro === true || obs.perifericoId === "simulador";
  const periferico = await resolverPeriferico(obs.perifericoId, tipo, simulacro);
  const posicion = posicionDe(obs);
  const timestamp = obs.timestamp || new Date().toISOString();
  const observacionId = nuevoId("obs");

  // Latido implícito: cualquier observación con posición mueve al periférico.
  if (periferico.id !== "externo") {
    try {
      await latido(periferico.id, posicion ? { posicion } : {});
    } catch (err) {
      console.warn("[pipeline/latido]", err instanceof Error ? err.message : err);
    }
  }

  const estado = await obtenerEstado();
  const geo = posicion ?? periferico.posicion;
  const geoEvento = geo ? { lat: geo.lat, lon: geo.lon, precisionM: geo.precisionM, rumboGrados: geo.rumboGrados } : undefined;

  // Tipo "posicion": solo latido, no genera evento ni entra en el motor.
  if (tipo === "posicion") {
    const evento: EventoIngesta = {
      id: observacionId,
      fuente: fuenteDe(periferico, tipo),
      timestamp,
      titulo: `${periferico.nombre}: posición actualizada`,
      detalle: geo ? `Posición ${geo.lat.toFixed(5)}, ${geo.lon.toFixed(5)}${geo.precisionM ? ` (±${Math.round(geo.precisionM)} m)` : ""}` : "Latido sin posición",
      confianza: 1,
      ubicacion: await textoUbicacion(estado, geoEvento),
      geo: geoEvento,
      perifericoId: periferico.id,
    };
    return { evento, impacto: { accion: "registrado", motivo: "Latido de posición: el periférico se mueve en el mapa, sin evento en el feed", decisionPedida: false } };
  }

  // 1) Imagen: base64 del móvil o URL pública (cámara de tráfico, dataset).
  let imagen: ImagenGuardada | undefined;
  let base64: string | undefined = obs.imagenBase64?.trim() || undefined;
  let mime = obs.imagenMime || "image/jpeg";
  if (!base64 && obs.imagenUrl) {
    try {
      const d = await descargarImagen(obs.imagenUrl);
      base64 = d.base64;
      mime = d.mime;
    } catch (err) {
      console.warn("[pipeline/imagenUrl]", err instanceof Error ? err.message : err);
    }
  }
  if (base64) {
    try {
      imagen = await guardarImagen(base64, mime);
    } catch (err) {
      throw new ErrorIngesta(err instanceof Error ? err.message : "No se pudo guardar la imagen", 400);
    }
  }

  // 2) Visión / clasificación.
  const analisis = await analizarObservacion(obs, tipo, imagen, base64);
  const procesadoPor: ProcesadoPor[] = [{ modelo: analisis.modelo, latenciaMs: analisis.latenciaMs, tarea: imagen && analisis.motor !== "dataset" ? "vision" : "clasificacion" }];

  // 3) Evento.
  const etiquetas = [...new Set([...analisis.etiquetas, analisis.categoria, ...(simulacro ? ["simulacro"] : []), ...(obs.datasetId ? [`dataset:${obs.datasetId}`] : []), ...(obs.eventoDatasetId ? [`dataset:${obs.eventoDatasetId}`] : []), ...(obs.canal ? [`canal:${obs.canal}`] : [])])].slice(0, 12);
  const resumen = (analisis.descripcion || nombreCategoria(analisis.categoria)).replace(/\s+/g, " ").slice(0, 80);
  const urlImagen = imagen ? (imagen.urlAbsoluta.startsWith("https://") ? imagen.urlAbsoluta : imagen.url) : undefined;
  const evento: EventoIngesta = {
    id: nuevoId("ev"),
    fuente: fuenteDe(periferico, tipo),
    timestamp,
    titulo: "", // se compone tras la verificación, con la confianza ya ponderada
    detalle: [
      analisis.descripcion,
      obs.texto && obs.texto.trim() !== analisis.descripcion.trim() ? `Aporta el ciudadano: "${obs.texto.slice(0, 400)}"` : "",
      obs.sensor ? `Sensor ${obs.sensor.magnitud}: ${obs.sensor.valor} ${obs.sensor.unidad}.` : "",
      obs.tipoEmergencia ? `Tipo de emergencia (dataset): ${obs.tipoEmergencia}.` : "",
      etiquetas.length ? `Etiquetas: ${etiquetas.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    confianza: analisis.confianza,
    ubicacion: await textoUbicacion(estado, geoEvento),
    imagenUrl: urlImagen,
    procesadoPor,
    geo: geoEvento,
    perifericoId: periferico.id,
    etiquetas,
    categoria: analisis.categoria,
  };

  // 4) Verificación (duplicados, contenido reciclado, reputación).
  const textual = tipo === "texto" || tipo === "voz" || tipo === "publicacion";
  const v = await verificarObservacion(evento, estado, periferico, { textual });
  evento.confianza = v.confianza;
  if (v.verificacion) evento.verificacion = v.verificacion;
  evento.titulo = `${simulacro ? "[Simulacro] " : ""}${periferico.nombre}: ${resumen} (${dosDecimales(evento.confianza)})`;

  // 5) Impacto sobre el grafo y la cola de decisiones.
  const entrada = { evento, analisis, estado, periferico, tipo, simulacro, conImagen: Boolean(imagen) };
  const impacto = evaluarImpacto(entrada);

  // 6) Motor: el evento entra al estado salvo que sea ruido.
  if (impacto.accion !== "ruido") {
    try {
      const r = await ingestarObservacion(evento, {
        pedirDecision: impacto.decisionPedida,
        foco: impacto.foco,
        descripcionFoco: impacto.decisionPedida ? descripcionDeFoco(entrada, impacto) : undefined,
        origenDomino: impacto.nodoNuevo?.id,
        nodoNuevo: impacto.nodoNuevo,
        aristasNuevas: impacto.aristasNuevas,
        invalidarFocos: impacto.accion === "agrava" && impacto.foco ? [impacto.foco] : undefined,
        motivoInvalidacion: impacto.accion === "agrava" ? `La situación ha cambiado: ${impacto.motivo}` : undefined,
      });
      if (r.decisionId) impacto.decisionId = r.decisionId;
    } catch (err) {
      console.error("[pipeline/motor]", err instanceof Error ? err.message : err);
      impacto.accion = "registrado";
      impacto.decisionPedida = false;
      impacto.motivo = `${impacto.motivo}. El motor rechazó la ingesta: ${err instanceof Error ? err.message : "error"}`;
    }
  }

  // 7) Reputación y último resultado visible en el móvil.
  if (periferico.id !== "externo") {
    await anotarObservacion(periferico.id, {
      observacionId,
      resumen: `${nombreCategoria(analisis.categoria)} · ${impacto.accion}: ${impacto.motivo}`,
      categoria: analisis.categoria,
      eventoId: impacto.accion === "ruido" ? undefined : evento.id,
      veredicto: simulacro ? undefined : v.veredicto,
    });
  }

  return { evento, analisis, impacto, imagenUrl: urlImagen };
}
