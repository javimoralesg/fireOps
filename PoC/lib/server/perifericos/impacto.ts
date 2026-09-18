// Impacto de una observación sobre el grafo y la cola de decisiones (poc-07).
// Traduce "qué se ha visto y dónde" en una de las acciones de AccionImpacto y,
// cuando toca, en el vértice/aristas nuevos y la petición de decisión al mando.
// Memoria por periférico (última categoría/gravedad y ventana anti-saturación)
// en globalThis para sobrevivir al HMR de Next.

import type { AristaGrafo, EventoIngesta, NodoGrafo } from "../../types";
import type { AnalisisVision, CategoriaObservacion, Impacto, Periferico, TipoObservacion } from "../../tipos-perifericos";
import type { EstadoSistema } from "../../tipos-sistema";
import { distanciaM, formatearDistancia } from "../../../components/mapa/geo";
import { similitud } from "./verificacion";

const RADIO_FOCO_EXISTENTE_M = 250; // más lejos de esto, la observación es un foco nuevo
const RADIO_ARISTAS_M = 300; // vías y subestaciones que bloquea el foco nuevo
const VENTANA_SATURACION_MS = 10_000;
const VENTANA_SATURACION_SIMULACRO_MS = 2_000;
const SALTO_CONFIANZA_VIGILANCIA = 0.25;
const VENTANA_DESMENTIDO_MS = 10 * 60_000;
const SOSPECHOSAS_PARA_DESMENTIDO = 3;

const TIPOS_CRITICOS: NodoGrafo["tipo"][] = ["Hospital", "Residencia", "Colegio", "Estacion", "Subestacion", "Refugio", "Centro_Comunicaciones", "Gasolinera"];
const TIPOS_BLOQUEABLES: NodoGrafo["tipo"][] = ["Carretera", "Subestacion"];

const ORDEN_GRAVEDAD: Record<AnalisisVision["gravedad"], number> = { nula: 0, baja: 1, media: 2, alta: 3, critica: 4 };

const ETIQUETA_CATEGORIA: Partial<Record<CategoriaObservacion, string>> = {
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
  terremoto: "Seísmo",
  ola_calor: "Ola de calor",
  nevada: "Nevada",
  accidente_ferroviario: "Accidente ferroviario",
  amenaza: "Amenaza",
  sin_novedad: "Sin novedad",
  otro: "Observación",
};

export const nombreCategoria = (c: CategoriaObservacion): string => ETIQUETA_CATEGORIA[c] ?? "Observación";

export interface PrevioPeriferico {
  categoria: CategoriaObservacion;
  gravedad: AnalisisVision["gravedad"];
  confianza: number;
  timestamp: number;
}

type Global = typeof globalThis & { __perifericosPrevio?: Map<string, PrevioPeriferico>; __perifericosUltima?: Map<string, number> };
const g = globalThis as Global;
const previos = (): Map<string, PrevioPeriferico> => (g.__perifericosPrevio ??= new Map());
const ultimas = (): Map<string, number> => (g.__perifericosUltima ??= new Map());

export const previoDe = (perifericoId: string): PrevioPeriferico | undefined => previos().get(perifericoId);

export interface EntradaImpacto {
  evento: EventoIngesta;
  analisis?: AnalisisVision;
  estado: EstadoSistema;
  periferico: Periferico;
  tipo: TipoObservacion;
  previo?: PrevioPeriferico;
  simulacro?: boolean;
  conImagen?: boolean; // una foto siempre aporta prueba: nunca se descarta como ruido
}

interface Cercano {
  id: string;
  nombre: string;
  tipo: string;
  distanciaM: number;
}

/** Bbox de los vértices con coordenadas (con margen) para proyectar lat/lon a x,y 0..100. */
function bbox(estado: EstadoSistema): { latMin: number; latMax: number; lonMin: number; lonMax: number } {
  const lats: number[] = [];
  const lons: number[] = [];
  for (const n of estado.nodos) {
    if (typeof n.lat === "number" && typeof n.lon === "number") {
      lats.push(n.lat);
      lons.push(n.lon);
    }
  }
  const centro = estado.incidente.ubicacion;
  lats.push(centro.lat);
  lons.push(centro.lon);
  let latMin = Math.min(...lats);
  let latMax = Math.max(...lats);
  let lonMin = Math.min(...lons);
  let lonMax = Math.max(...lons);
  // Con pocos vértices geolocalizados el bbox degenera: se abre a ~1,3 km alrededor.
  if (latMax - latMin < 0.004) {
    const c = (latMax + latMin) / 2;
    latMin = c - 0.012;
    latMax = c + 0.012;
  }
  if (lonMax - lonMin < 0.005) {
    const c = (lonMax + lonMin) / 2;
    lonMin = c - 0.016;
    lonMax = c + 0.016;
  }
  return { latMin, latMax, lonMin, lonMax };
}

/** Proyección al lienzo 0..100 que usa GrafoCiudad (y = norte arriba). */
export function proyectar(estado: EstadoSistema, lat: number, lon: number): { x: number; y: number } {
  const b = bbox(estado);
  const clamp = (v: number) => Math.round(Math.min(95, Math.max(5, v)) * 10) / 10;
  return {
    x: clamp(((lon - b.lonMin) / (b.lonMax - b.lonMin)) * 100),
    y: clamp(((b.latMax - lat) / (b.latMax - b.latMin)) * 100),
  };
}

function conCoordenadas(estado: EstadoSistema): (NodoGrafo & { lat: number; lon: number })[] {
  return estado.nodos.filter((n): n is NodoGrafo & { lat: number; lon: number } => typeof n.lat === "number" && typeof n.lon === "number");
}

function ordenarPorDistancia(nodos: (NodoGrafo & { lat: number; lon: number })[], lat: number, lon: number): Cercano[] {
  return nodos
    .map((n) => ({ id: n.id, nombre: n.nombre, tipo: n.tipo as string, distanciaM: Math.round(distanciaM([lat, lon], [n.lat, n.lon])) }))
    .sort((a, b) => a.distanciaM - b.distanciaM);
}

/** Vértice más cercano con coordenadas; si el grafo aún no es real, el propio incidente. */
export function lugarMasCercano(estado: EstadoSistema, lat: number, lon: number): Cercano {
  const cercanos = ordenarPorDistancia(conCoordenadas(estado), lat, lon);
  if (cercanos.length) return cercanos[0];
  const u = estado.incidente.ubicacion;
  return { id: estado.incidente.nodoId ?? estado.incidente.id, nombre: u.nombre, tipo: "Incidencia", distanciaM: Math.round(distanciaM([lat, lon], [u.lat, u.lon])) };
}

/** Distancia a la incidencia más cercana (vértices Incidencia + ubicación del incidente activo). */
function distanciaAIncidencias(estado: EstadoSistema, lat: number, lon: number): { distanciaM: number; nodoId?: string } {
  const incidencias = ordenarPorDistancia(
    conCoordenadas(estado).filter((n) => n.tipo === "Incidencia"),
    lat,
    lon,
  );
  const u = estado.incidente.ubicacion;
  const alIncidente = { distanciaM: Math.round(distanciaM([lat, lon], [u.lat, u.lon])), nodoId: estado.incidente.nodoId };
  if (!incidencias.length) return alIncidente;
  const mejor = incidencias[0];
  return mejor.distanciaM <= alIncidente.distanciaM ? { distanciaM: mejor.distanciaM, nodoId: mejor.id } : alIncidente;
}

function equipamientosCriticos(estado: EstadoSistema, lat: number, lon: number): Cercano[] {
  return ordenarPorDistancia(
    conCoordenadas(estado).filter((n) => TIPOS_CRITICOS.includes(n.tipo)),
    lat,
    lon,
  ).slice(0, 3);
}

const hayPendiente = (estado: EstadoSistema, foco: string): boolean => estado.decisiones.some((d) => d.estado === "pendiente" && d.foco === foco);

/** Publicaciones sospechosas sobre lo mismo en los últimos 10 minutos (incluida la actual). */
function sospechosasRecientes(estado: EstadoSistema, evento: EventoIngesta): number {
  const t = Date.now();
  const propias = estado.eventos.filter(
    (e) =>
      e.verificacion?.estado === "sospechoso" &&
      t - new Date(e.timestamp).getTime() < VENTANA_DESMENTIDO_MS &&
      (similitud(`${e.titulo} ${e.detalle}`, `${evento.titulo} ${evento.detalle}`) >= 0.4 || (e.categoria && e.categoria === evento.categoria)),
  ).length;
  return propias + (evento.verificacion?.estado === "sospechoso" ? 1 : 0);
}

function describirFoco(
  entrada: EntradaImpacto,
  datos: { categoria: CategoriaObservacion; gravedad: AnalisisVision["gravedad"]; lugar?: Cercano; criticos: Cercano[]; distanciaIncidenteM?: number },
): string {
  const { evento, periferico, analisis } = entrada;
  const partes = [
    `${periferico.nombre} (${periferico.tipo.replace(/_/g, " ")}) envía una observación de tipo ${entrada.tipo}.`,
    datos.lugar ? `Lugar: a ${formatearDistancia(datos.lugar.distanciaM)} de ${datos.lugar.nombre}${evento.geo ? ` (${evento.geo.lat.toFixed(4)}, ${evento.geo.lon.toFixed(4)})` : ""}.` : "",
    `Categoría ${datos.categoria} · gravedad ${datos.gravedad} · confianza ${evento.confianza.toFixed(2)}${analisis ? ` (${analisis.motor}/${analisis.modelo})` : ""}.`,
    analisis?.descripcion ? `Lo observado: ${analisis.descripcion}` : "",
    evento.etiquetas?.length ? `Etiquetas: ${evento.etiquetas.join(", ")}.` : "",
    typeof datos.distanciaIncidenteM === "number" ? `Distancia a la incidencia más próxima: ${formatearDistancia(datos.distanciaIncidenteM)}.` : "",
    datos.criticos.length ? `Equipamientos críticos cercanos: ${datos.criticos.map((c) => `${c.nombre} (${c.tipo}, ${formatearDistancia(c.distanciaM)})`).join("; ")}.` : "",
  ];
  return partes.filter(Boolean).join(" ");
}

/**
 * Decide qué hacer con la observación. No toca el estado: devuelve el Impacto
 * y el pipeline se lo pasa a ingestarObservacion().
 */
export function evaluarImpacto(entrada: EntradaImpacto): Impacto {
  const { evento, analisis, estado, periferico, tipo } = entrada;
  const categoria = (analisis?.categoria ?? (evento.categoria as CategoriaObservacion | undefined) ?? "otro") as CategoriaObservacion;
  const gravedad = analisis?.gravedad ?? "media";
  const confianza = evento.confianza;
  const previo = entrada.previo ?? previos().get(periferico.id);
  const ahora = Date.now();
  const desdeUltima = ahora - (ultimas().get(periferico.id) ?? 0);

  const recordar = <T extends Impacto>(impacto: T): T => {
    previos().set(periferico.id, { categoria, gravedad, confianza, timestamp: ahora });
    ultimas().set(periferico.id, ahora);
    return impacto;
  };

  // 1) Modo vigilancia: solo interesa el cambio de escena.
  if (tipo === "fotograma" && previo && previo.categoria === categoria && Math.abs(confianza - previo.confianza) <= SALTO_CONFIANZA_VIGILANCIA) {
    return recordar({ accion: "ruido", motivo: `Vigilancia: la escena sigue siendo "${categoria}" (confianza ${previo.confianza.toFixed(2)} → ${confianza.toFixed(2)}); no se emite evento`, decisionPedida: false });
  }

  // 2) Mejora comprobada: sin novedad donde antes había algo grave.
  if (categoria === "sin_novedad" && previo && ORDEN_GRAVEDAD[previo.gravedad] >= 3) {
    return recordar({ accion: "mitiga", motivo: `El periférico ya no observa ${previo.categoria}: la situación en su punto de vista ha mejorado`, decisionPedida: false });
  }

  // 3) Ruido: nada reseñable y con poca confianza. Con foto se registra igual
  //    (la imagen es prueba aunque no haya motor de visión que la clasifique).
  if ((categoria === "sin_novedad" || categoria === "otro") && confianza < 0.55) {
    return recordar(
      entrada.conImagen
        ? { accion: "registrado", motivo: `Imagen registrada en el feed sin clasificar (${categoria}, confianza ${confianza.toFixed(2)}${analisis?.motor === "ninguno" ? ", sin motor de visión" : ""})`, decisionPedida: false }
        : { accion: "ruido", motivo: `Sin contenido operativo (${categoria}, confianza ${confianza.toFixed(2)})`, decisionPedida: false },
    );
  }

  // 4) Anti-saturación: ráfagas del mismo periférico.
  const ventana = entrada.simulacro ? VENTANA_SATURACION_SIMULACRO_MS : VENTANA_SATURACION_MS;
  const saturado = desdeUltima < ventana;

  // 5) Publicaciones: nunca decisión directa; solo desmentido si se repite el bulo.
  if (tipo === "publicacion") {
    const sospechosas = sospechosasRecientes(estado, evento);
    if (sospechosas >= SOSPECHOSAS_PARA_DESMENTIDO && !hayPendiente(estado, "desmentido")) {
      return recordar({
        accion: "desmentido_sugerido",
        motivo: `${sospechosas} publicaciones sospechosas sobre lo mismo en los últimos 10 min`,
        decisionPedida: true,
        foco: "desmentido",
      });
    }
    return recordar({
      accion: "registrado",
      motivo: evento.verificacion?.estado === "sospechoso" ? `Publicación marcada sospechosa: ${evento.verificacion.motivo ?? "sin fuente"}` : evento.verificacion?.estado === "duplicado" ? "Publicación agrupada con otra igual" : "Publicación registrada en el muro; sin decisión directa",
      decisionPedida: false,
    });
  }

  // 6) Observaciones no fiables: entran al feed, nunca a la cola de decisiones.
  if (evento.verificacion?.estado === "sospechoso" || evento.verificacion?.estado === "duplicado") {
    return recordar({ accion: "registrado", motivo: `Observación ${evento.verificacion.estado}: ${evento.verificacion.motivo ?? "sin motivo"}`, decisionPedida: false });
  }

  if (saturado) {
    return recordar({ accion: "registrado", motivo: `Segunda observación del mismo periférico en menos de ${Math.round(ventana / 1000)} s: se registra sin pedir decisión`, decisionPedida: false });
  }

  const geo = evento.geo;
  const lugar = geo ? lugarMasCercano(estado, geo.lat, geo.lon) : undefined;
  const criticos = geo ? equipamientosCriticos(estado, geo.lat, geo.lon) : [];
  const alIncidente = geo ? distanciaAIncidencias(estado, geo.lat, geo.lon) : { distanciaM: 0, nodoId: estado.incidente.nodoId };
  const foco = `obs_${categoria}`;
  const grave = ORDEN_GRAVEDAD[gravedad] >= 3;
  const base = { distanciaIncidenteM: alIncidente.distanciaM, infraestructurasCercanas: criticos };

  // 7) Foco nuevo: algo grave lejos de todo lo que ya se conoce.
  if (geo && grave && alIncidente.distanciaM > RADIO_FOCO_EXISTENTE_M) {
    if (hayPendiente(estado, foco)) {
      return recordar({ ...base, accion: "confirma", motivo: `Ya hay una decisión pendiente para ${foco}: la observación la refuerza`, decisionPedida: false });
    }
    const { x, y } = proyectar(estado, geo.lat, geo.lon);
    const nodoNuevo: NodoGrafo = {
      id: `Incidencias/per-${evento.id.replace(/^ev-/, "")}`,
      nombre: `${nombreCategoria(categoria)} · ${periferico.nombre}`,
      tipo: "Incidencia",
      x,
      y,
      lat: geo.lat,
      lon: geo.lon,
      subtipo: categoria,
      origen: "periferico",
      detalle: `${analisis?.descripcion ?? evento.titulo} — ${lugar ? `a ${formatearDistancia(lugar.distanciaM)} de ${lugar.nombre}` : "sin referencia"}`,
    };
    const aristasNuevas: AristaGrafo[] = ordenarPorDistancia(
      conCoordenadas(estado).filter((n) => TIPOS_BLOQUEABLES.includes(n.tipo)),
      geo.lat,
      geo.lon,
    )
      .filter((n) => n.distanciaM <= RADIO_ARISTAS_M)
      .slice(0, 6)
      .map((n) => ({ from: nodoNuevo.id, to: n.id, tipo: "BLOQUEA_A" as const }));
    return recordar({
      ...base,
      accion: "nuevo_foco",
      motivo: `${nombreCategoria(categoria)} (gravedad ${gravedad}) a ${formatearDistancia(alIncidente.distanciaM)} de la incidencia más próxima: se abre un foco nuevo en el grafo`,
      decisionPedida: true,
      foco,
      nodoNuevo,
      aristasNuevas,
    });
  }

  // 8) Cerca de un foco conocido (o sin GPS: se atribuye al incidente activo).
  const empeora = previo ? ORDEN_GRAVEDAD[gravedad] > ORDEN_GRAVEDAD[previo.gravedad] : false;
  if ((empeora || categoria === "persona_en_peligro") && grave) {
    if (hayPendiente(estado, foco) && !empeora) {
      return recordar({ ...base, accion: "confirma", motivo: `Ya hay una decisión pendiente para ${foco}`, decisionPedida: false });
    }
    return recordar({
      ...base,
      accion: "agrava",
      motivo: categoria === "persona_en_peligro" ? "Hay personas en peligro en el punto observado: se replantea la respuesta" : `La situación empeora (${previo?.gravedad} → ${gravedad}) según el mismo periférico`,
      decisionPedida: true,
      foco,
    });
  }
  if (categoria === "sin_novedad") {
    return recordar({ ...base, accion: "mitiga", motivo: "El periférico no observa novedad en el punto vigilado", decisionPedida: false });
  }
  if (grave && !hayPendiente(estado, foco) && geo && alIncidente.distanciaM <= RADIO_FOCO_EXISTENTE_M) {
    return recordar({ ...base, accion: "confirma", motivo: `Confirma la incidencia conocida a ${formatearDistancia(alIncidente.distanciaM)}: misma zona, categoría ${categoria}`, decisionPedida: false });
  }
  return recordar({
    ...base,
    accion: geo && alIncidente.distanciaM <= RADIO_FOCO_EXISTENTE_M ? "confirma" : "registrado",
    motivo: `Observación ${categoria} (gravedad ${gravedad})${geo ? ` a ${formatearDistancia(alIncidente.distanciaM)} de la incidencia más próxima` : " sin posición"}: se registra en el feed`,
    decisionPedida: false,
  });
}

/** Descripción del foco para la tarjeta de decisión (la usa el pipeline). */
export function descripcionDeFoco(entrada: EntradaImpacto, impacto: Impacto): string {
  const categoria = (entrada.analisis?.categoria ?? (entrada.evento.categoria as CategoriaObservacion | undefined) ?? "otro") as CategoriaObservacion;
  const gravedad = entrada.analisis?.gravedad ?? "media";
  const geo = entrada.evento.geo;
  const lugar = geo ? lugarMasCercano(entrada.estado, geo.lat, geo.lon) : undefined;
  const cabecera =
    impacto.accion === "nuevo_foco"
      ? `Foco nuevo detectado por un periférico: ${nombreCategoria(categoria)}.`
      : impacto.accion === "agrava"
        ? `La situación empeora según un periférico: ${nombreCategoria(categoria)}.`
        : impacto.accion === "desmentido_sugerido"
          ? "Bulo circulando en las publicaciones ciudadanas: el Gabinete debe valorar un desmentido."
          : `Observación de un periférico: ${nombreCategoria(categoria)}.`;
  return `${cabecera} ${describirFoco(entrada, { categoria, gravedad, lugar, criticos: impacto.infraestructurasCercanas ?? [], distanciaIncidenteM: impacto.distanciaIncidenteM })}`;
}
