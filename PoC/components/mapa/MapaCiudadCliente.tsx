"use client";

// Mapa real (OpenStreetMap) de la consola de mando. SOLO CLIENTE: se carga con
// MapaCiudad (dynamic, ssr:false).
//
// Pinta sobre calles reales el grafo del incidente (vértices con lat/lon, aristas y
// dominó), el penacho de humo (del servidor o estimado del viento), rutas OSRM,
// sensores de tráfico, avisos con posición, periféricos y cámaras municipales, y el
// entorno real de OpenStreetMap: lo que manda el servidor (estado.mapa.pois, fuente de
// verdad) y, como respaldo, una consulta a Overpass desde el cliente (useEntornoOsm).
//
// Deduplicación: un mismo elemento puede llegar como vértice del grafo, como POI del
// servidor y como resultado de Overpass. Manda el grafo, luego el servidor y por
// último Overpass; se consideran iguales si comparten id OSM o si tienen el mismo
// nombre normalizado a menos de 60 m.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import type { AristaGrafo, EventoIngesta, ImpactoDomino, NodoGrafo } from "@/lib/types";
import type { CondicionesEntorno } from "@/lib/tipos-sistema";
import { usePerifericos } from "@/lib/usePerifericos";
import { Tooltip } from "@/components/ui/Tooltip";
import { MapaBaseCliente } from "./MapaBaseCliente";
import { CapasCiudad, ESTILOS_CIUDAD, ETIQUETA_RUTA, type AristaMapa, type EquipamientoMapa, type NodoMapa, type ViaMapa } from "./CapasCiudad";
import {
  bajoPenacho,
  distanciaM,
  horaCorta,
  lineaBajoPenacho,
  normalizarNombre,
  penachoDesdeViento,
  poligonoPenacho,
  rumboTexto,
  type LatLon,
  type Penacho,
} from "./geo";
import { claveVia, NOMBRE_GENERICO, urlOsm, type TipoEquipamiento } from "./overpass";
import {
  ItemLeyenda,
  ListaLeyenda,
  MuestraAbanico,
  MuestraCuadro,
  MuestraInsignia,
  MuestraLinea,
  MuestraPunto,
  PanelCapas,
  type AvisoMapa,
  type Capa,
  type FilaCapa,
} from "./PanelCapas";
import { cantidad, EFECTIVOS, equipamientoDeNodo, ORDEN_EQUIPAMIENTOS, SIMBOLO_EQUIPAMIENTO, simboloNodo, TIPO_POI } from "./simbologia";
import type { DatosMapa, PenachoServidor, RutaMapa } from "./tipos";
import { useEntornoOsm } from "./useEntornoOsm";

export interface MapaCiudadProps {
  centro: { lat: number; lon: number; nombre?: string };
  nodos: NodoGrafo[];
  aristas: AristaGrafo[];
  eventos: EventoIngesta[];
  viento?: CondicionesEntorno["viento"];
  /** Penacho calculado por el servidor; si falta, se estima desde el viento. */
  penacho?: PenachoServidor;
  datos?: DatosMapa;
  rutas?: RutaMapa[];
  dominoResaltado?: ImpactoDomino[];
  onSeleccionarNodo?: (id: string) => void;
  /**
   * Consulta de respaldo a Overpass desde el navegador (entorno OSM y vías principales).
   * Por defecto activa; con `false` el mapa solo usa lo que manda el servidor.
   */
  overpass?: boolean;
}

/** Lo que esté más lejos (p. ej. la sede del 112 en Pozuelo) no entra en el encuadre. */
const RADIO_ENCUADRE_M = 5000;
/** Mismo nombre a menos de esta distancia = mismo elemento. */
const DEDUP_M = 60;
/** Con al menos estos POI propios del servidor, Overpass solo se consulta para las vías. */
const MIN_POIS_SERVIDOR = 5;
const CLAVE_PANEL = "atalaya.mapa.panelCapas";
/** Ancho de mapa (px) a partir del cual el panel de capas empieza desplegado. */
const ANCHO_PANEL_ABIERTO = 900;
/** El encuadre se centra en el núcleo: humo, efectivos, dominó y lo que esté a menos de esto. */
const RADIO_NUCLEO_M = 800;

const CAPAS_INICIALES: Capa[] = ["grafo", "efectivos", "humo", "rutas", "eventos", "perifericos", "trafico", "camaras", "osm", "vias"];

const ETIQUETA_TIPO_NODO: Record<string, string> = {
  Incidencia: "Incidencia",
  Hospital: "Hospital",
  Centro_Comunicaciones: "Comunicaciones",
  Ruta_Evacuacion: "Ruta de evacuación",
  Carretera: "Vía",
  Bomberos: "Bomberos",
  Policia: "Policía",
  Sanitarios: "Sanitarios",
  Residencia: "Residencia",
  Colegio: "Colegio",
  Subestacion: "Subestación",
  Estacion: "Estación",
  Refugio: "Refugio",
  Gasolinera: "Gasolinera",
};

/** Preferencia guardada del panel de capas; null = decide el ancho del mapa. */
function preferenciaPanel(): boolean | null {
  try {
    const v = localStorage.getItem(CLAVE_PANEL);
    if (v === "abierto") return true;
    if (v === "cerrado") return false;
  } catch {
    /* sin almacenamiento: decide el ancho */
  }
  return null;
}

interface Localizable {
  nombre: string;
  lat: number;
  lon: number;
  osmId?: string;
}

/** Índice para deduplicar por id OSM o por nombre normalizado + distancia. */
function crearIndice(elementos: Localizable[]) {
  const ids = new Set<string>();
  const porNombre = new Map<string, LatLon[]>();
  for (const e of elementos) {
    if (e.osmId) ids.add(e.osmId);
    const k = normalizarNombre(e.nombre);
    if (!k) continue;
    porNombre.set(k, [...(porNombre.get(k) ?? []), [e.lat, e.lon]]);
  }
  return (e: Localizable) =>
    (!!e.osmId && ids.has(e.osmId)) || (porNombre.get(normalizarNombre(e.nombre)) ?? []).some((p) => distanciaM(p, [e.lat, e.lon]) < DEDUP_M);
}

const esCoordenada = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** "Plaza de Legazpi, Arganzuela · a 344 m de…" → "Plaza de Legazpi"; unas coordenadas sueltas no son un nombre. */
function nombreCorto(nombre?: string) {
  const n = (nombre ?? "").trim();
  if (!n || /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(n)) return "Foco del incidente";
  return n.split(/,| · /)[0].trim() || "Foco del incidente";
}

export function MapaCiudadCliente({
  centro,
  nodos,
  aristas,
  eventos,
  viento,
  penacho: penachoServidor,
  datos,
  rutas,
  dominoResaltado,
  onSeleccionarNodo,
  overpass = true,
}: MapaCiudadProps) {
  const [capas, setCapas] = useState<Set<Capa>>(() => new Set(CAPAS_INICIALES));
  const [panelPreferido, setPanelPreferido] = useState<boolean | null>(preferenciaPanel);
  const [peticionEncuadre, setPeticionEncuadre] = useState(0);
  const [ancho, setAncho] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);

  // Ancho real del mapa (no de la ventana): decide el comportamiento "móvil" del panel.
  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const observador = new ResizeObserver(([entrada]) => setAncho(Math.round(entrada.contentRect.width)));
    observador.observe(el);
    return () => observador.disconnect();
  }, []);
  const compacto = ancho > 0 && ancho < 560;
  // Sin preferencia guardada, el panel empieza abierto solo si el mapa es ancho: no tapa la vista.
  const panelAbierto = panelPreferido ?? ancho >= ANCHO_PANEL_ABIERTO;

  const origen = useMemo<LatLon>(() => [centro.lat, centro.lon], [centro.lat, centro.lon]);
  const nombreIncidente = nombreCorto(centro.nombre);

  // ------------------------------------------------------------ penacho

  const penacho: Penacho | undefined = useMemo(() => {
    if (penachoServidor) {
      return {
        rumboGrados: penachoServidor.rumboGrados ?? (viento ? (viento.direccionGrados + 180) % 360 : 0),
        longitudM: penachoServidor.longitudM,
        semianguloGrados: penachoServidor.semianguloGrados,
      };
    }
    return viento ? penachoDesdeViento(viento) : undefined;
  }, [penachoServidor, viento]);
  const afectadosServidor = useMemo(() => (penachoServidor?.afectados ? new Set(penachoServidor.afectados) : null), [penachoServidor]);

  // ------------------------------------------------------------ grafo

  const nodosMapa = useMemo<NodoMapa[]>(() => {
    const conGeo = nodos.filter((n): n is NodoGrafo & { lat: number; lon: number } => esCoordenada(n.lat) && esCoordenada(n.lon));
    // La incidencia principal es la que está en el foco; las demás (periféricos) se pintan.
    let principal: string | null = null;
    let mejor = 150;
    for (const n of conGeo) {
      if (n.tipo !== "Incidencia") continue;
      const d = distanciaM(origen, [n.lat, n.lon]);
      if (d <= mejor) {
        mejor = d;
        principal = n.id;
      }
    }
    const idPorNombre = new Map(nodos.map((n) => [n.nombre, n.id]));
    const domino = new Set<string>();
    for (const imp of dominoResaltado ?? []) {
      for (const nombre of [...imp.ruta, imp.infraestructura]) {
        const id = idPorNombre.get(nombre);
        if (id) domino.add(id);
      }
    }
    return conGeo.map((n) => ({
      id: n.id,
      nombre: n.nombre,
      tipo: n.tipo,
      etiquetaTipo: ETIQUETA_TIPO_NODO[n.tipo] ?? n.tipo,
      lat: n.lat,
      lon: n.lon,
      subtipo: n.subtipo,
      detalle: n.detalle,
      osmId: n.osmId,
      origen: n.origen,
      simbolo: simboloNodo(n.tipo, n.subtipo),
      efectivo: EFECTIVOS.has(n.tipo),
      principal: n.id === principal,
      humo: afectadosServidor ? afectadosServidor.has(n.id) : !!penacho && bajoPenacho(origen, penacho, [n.lat, n.lon]),
      domino: domino.has(n.id),
      distanciaM: Math.round(distanciaM(origen, [n.lat, n.lon])),
    }));
  }, [nodos, origen, penacho, afectadosServidor, dominoResaltado]);

  const aristasMapa = useMemo<AristaMapa[]>(() => {
    const porId = new Map(nodosMapa.map((n) => [n.id, n]));
    const pares = new Set<string>();
    const idPorNombre = new Map(nodos.map((n) => [n.nombre, n.id]));
    for (const imp of dominoResaltado ?? []) {
      const ids = imp.ruta.map((nombre) => idPorNombre.get(nombre)).filter((id): id is string => !!id);
      for (let i = 0; i < ids.length - 1; i++) {
        pares.add(`${ids[i]}->${ids[i + 1]}`);
        pares.add(`${ids[i + 1]}->${ids[i]}`);
      }
    }
    return aristas.flatMap((a) => {
      const desde = porId.get(a.from);
      const hasta = porId.get(a.to);
      if (!desde || !hasta) return [];
      return [{ clave: `${a.from}-${a.to}-${a.tipo}`, desde, hasta, tipo: a.tipo, enDomino: pares.has(`${a.from}->${a.to}`) }];
    });
  }, [aristas, nodosMapa, nodos, dominoResaltado]);

  // ------------------------------------------------------------ entorno OSM

  const esDelGrafo = useMemo(() => crearIndice(nodosMapa), [nodosMapa]);

  const poisServidor = useMemo<EquipamientoMapa[]>(
    () =>
      (datos?.pois ?? []).flatMap((p) => {
        const tipo = TIPO_POI[p.tipo];
        if (!tipo || !esCoordenada(p.lat) || !esCoordenada(p.lon)) return [];
        const nombre = p.nombre || NOMBRE_GENERICO[tipo];
        if (esDelGrafo({ nombre, lat: p.lat, lon: p.lon, osmId: p.id })) return [];
        return [
          {
            id: p.id,
            tipo,
            nombre,
            lat: p.lat,
            lon: p.lon,
            distanciaM: Math.round(p.distanciaM ?? distanciaM(origen, [p.lat, p.lon])),
            url: p.url ?? urlOsm(p.id),
            fuente: "servidor" as const,
            humo: !!afectadosServidor?.has(p.id) || (!!penacho && bajoPenacho(origen, penacho, [p.lat, p.lon])),
          },
        ];
      }),
    [datos?.pois, esDelGrafo, origen, penacho, afectadosServidor],
  );

  // Overpass solo completa: si el servidor ya trae su entorno, se piden solo las vías.
  const modoOsm = poisServidor.length >= MIN_POIS_SERVIDOR ? "vias" : "completo";
  const osm = useEntornoOsm(centro, { modo: modoOsm, activo: overpass });
  const datosOsm = osm.fase === "listo" ? osm.datos : null;

  const equipCliente = useMemo<EquipamientoMapa[]>(() => {
    if (!datosOsm) return [];
    const tiposServidor = new Set(poisServidor.map((p) => p.tipo));
    const esDelServidor = crearIndice(poisServidor.map((p) => ({ ...p, osmId: p.id })));
    return datosOsm.equipamientos.flatMap((e) => {
      if (modoOsm === "vias" && tiposServidor.has(e.tipo)) return [];
      const l = { nombre: e.nombre, lat: e.lat, lon: e.lon, osmId: e.id };
      if (esDelGrafo(l) || esDelServidor(l)) return [];
      return [{ ...e, url: urlOsm(e.id), fuente: "overpass" as const, humo: !!penacho && bajoPenacho(origen, penacho, [e.lat, e.lon]) }];
    });
  }, [datosOsm, poisServidor, modoOsm, esDelGrafo, penacho, origen]);

  const equipamientos = useMemo(() => [...poisServidor, ...equipCliente], [poisServidor, equipCliente]);

  const viasMapa = useMemo<ViaMapa[]>(() => {
    if (!datosOsm) return [];
    return datosOsm.vias.map((v) => ({ ...v, humo: !!penacho && v.tramos.some((t) => lineaBajoPenacho(origen, penacho, t)) }));
  }, [datosOsm, penacho, origen]);

  // ------------------------------------------------------------ periféricos y cámaras

  const sala = usePerifericos();
  const perifericos = useMemo(
    () => (sala.estadoPerifericos.ausente || sala.estadoPerifericos.error ? [] : sala.perifericos.filter((p) => p.posicion)),
    [sala.estadoPerifericos.ausente, sala.estadoPerifericos.error, sala.perifericos],
  );
  const camaras = sala.estadoCamaras.ausente || sala.estadoCamaras.error ? [] : sala.camaras;

  // ------------------------------------------------------------ resto de datos

  const eventosGeo = useMemo(() => eventos.filter((e) => e.geo && esCoordenada(e.geo.lat) && esCoordenada(e.geo.lon)), [eventos]);
  const sensores = useMemo(() => (datos?.sensores ?? []).filter((s) => esCoordenada(s.lat) && esCoordenada(s.lon)), [datos?.sensores]);
  const listaRutas = useMemo(() => (rutas ?? []).filter((r) => r.coords?.length > 1), [rutas]);

  const nodosGrafo = nodosMapa.filter((n) => !n.principal && !n.efectivo);
  const efectivos = nodosMapa.filter((n) => n.efectivo);
  const nombresVias = new Set(viasMapa.map(claveVia));

  // ------------------------------------------------------------ bajo el humo

  // Nombres para lo crítico (hospitales, efectivos, rutas…), recuento por tipo para el resto.
  const resumenHumo = useMemo(() => {
    const hospitales = new Map<string, string>();
    const nombrados = new Map<string, string>();
    const grupos = new Map<TipoEquipamiento, Set<string>>();
    const vias = new Map<string, string>();
    const agrupar = (tipo: TipoEquipamiento, nombre: string) => grupos.set(tipo, (grupos.get(tipo) ?? new Set()).add(normalizarNombre(nombre)));
    for (const n of nodosMapa) {
      if (!n.humo || n.tipo === "Incidencia") continue;
      const familia = equipamientoDeNodo(n.tipo, n.subtipo);
      if (n.tipo === "Carretera") vias.set(normalizarNombre(n.nombre), n.nombre);
      else if (familia === "hospital") hospitales.set(normalizarNombre(n.nombre), n.nombre);
      else if (familia) agrupar(familia, n.nombre);
      else nombrados.set(normalizarNombre(n.nombre), n.nombre);
    }
    for (const e of equipamientos) {
      if (!e.humo) continue;
      if (e.tipo === "hospital") hospitales.set(normalizarNombre(e.nombre), e.nombre);
      else agrupar(e.tipo, e.nombre);
    }
    const idsGrafo = new Set(nodosMapa.map((n) => n.osmId).filter(Boolean));
    for (const v of viasMapa) if (v.humo && !idsGrafo.has(v.id)) vias.set(claveVia(v), v.ref ?? v.nombre);

    const partes: string[] = [];
    if (hospitales.size > 2) partes.push(cantidad(hospitales.size, SIMBOLO_EQUIPAMIENTO.hospital));
    else partes.push(...hospitales.values());
    partes.push(...nombrados.values());
    for (const tipo of ORDEN_EQUIPAMIENTOS) {
      const n = grupos.get(tipo)?.size;
      if (n) partes.push(cantidad(n, SIMBOLO_EQUIPAMIENTO[tipo]));
    }
    if (vias.size) partes.push(vias.size <= 2 ? [...vias.values()].join(" y ") : `${vias.size} vías`);
    return partes;
  }, [nodosMapa, equipamientos, viasMapa]);

  const totalHumo =
    nodosMapa.filter((n) => n.humo && n.tipo !== "Incidencia").length +
    equipamientos.filter((e) => e.humo).length +
    new Set(viasMapa.filter((v) => v.humo).map(claveVia)).size;

  // ------------------------------------------------------------ encuadre

  // Encuadre del núcleo del incidente: foco, humo, rutas, dominó, lo afectado y el
  // grafo cercano (efectivos incluidos). Nada a más de 5 km (la sede del 112 en Pozuelo alejaría el zoom).
  const limites = useMemo(() => {
    const puntos: LatLon[] = [origen];
    const anadir = (p: LatLon, radio = RADIO_ENCUADRE_M) => {
      if (distanciaM(origen, p) <= radio) puntos.push(p);
    };
    if (penacho) poligonoPenacho(origen, penacho, 8).forEach((p) => anadir(p));
    for (const n of nodosMapa) anadir([n.lat, n.lon], n.domino || n.humo ? RADIO_ENCUADRE_M : RADIO_NUCLEO_M);
    listaRutas.forEach((r) => r.coords.filter((_, i) => i % 5 === 0 || i === r.coords.length - 1).forEach((p) => anadir(p)));
    eventosGeo.forEach((e) => anadir([e.geo!.lat, e.geo!.lon], RADIO_NUCLEO_M));
    equipamientos.forEach((e) => e.humo && anadir([e.lat, e.lon]));
    return L.latLngBounds(puntos);
  }, [origen, penacho, nodosMapa, listaRutas, eventosGeo, equipamientos]);

  const claveAuto = nodosMapa.length ? "grafo" : sensores.length || eventosGeo.length || listaRutas.length ? "datos" : "inicial";

  // ------------------------------------------------------------ acciones

  const alternarPanel = () => {
    const abrir = !panelAbierto;
    setPanelPreferido(abrir);
    if (compacto) return; // en móvil no se recuerda: el panel se abre, se elige y se cierra
    try {
      localStorage.setItem(CLAVE_PANEL, abrir ? "abierto" : "cerrado");
    } catch {
      /* sin almacenamiento: la preferencia dura la sesión */
    }
  };

  const alternarCapa = (c: Capa) => {
    setCapas((prev) => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });
    if (compacto) setPanelPreferido(false); // en móvil, el panel se cierra al elegir
  };

  // ------------------------------------------------------------ filas y leyendas

  const horaOsm = datosOsm ? horaCorta(datosOsm.consultadoEn) : null;
  const fuenteOsm = datosOsm
    ? `Fuente: OpenStreetMap (Overpass) · consultado ${horaOsm}${osm.fase === "listo" && osm.desdeCache ? " (caché)" : ""}`
    : null;
  const cargandoOsm = osm.fase === "cargando";
  const errorOsm = osm.fase === "error" ? osm : null;

  const ayudaOsm = (queMuestra: string) =>
    errorOsm
      ? `${errorOsm.mensaje}. ${errorOsm.detalle}${errorOsm.proximoIntento ? ` · reintento automático a las ${horaCorta(errorOsm.proximoIntento)}` : ""}`
      : cargandoOsm
        ? "Consultando OpenStreetMap (Overpass)…"
        : osm.fase === "inactivo"
          ? "Consulta a Overpass desactivada: el entorno llega del servidor (estado.mapa.pois)."
          : queMuestra;

  const nEquip = equipamientos.length;
  const filas: FilaCapa[] = [
    {
      id: "grafo",
      etiqueta: "Grafo del incidente",
      cuenta: nodosGrafo.length,
      activa: capas.has("grafo"),
      disponible: nodosGrafo.length > 0,
      ayuda: nodosGrafo.length
        ? `${nodosGrafo.length} vértices y ${aristasMapa.length} aristas del grafo de dependencias sobre su posición real.`
        : "Aún no hay vértices del grafo con coordenadas. Llegarán con el grafo real de la ciudad (ArangoDB + OpenStreetMap).",
      nota: nodosGrafo.length ? `${aristasMapa.length} aristas · ArangoDB + OSM` : "sin coordenadas aún",
    },
    {
      id: "efectivos",
      etiqueta: "Efectivos",
      cuenta: efectivos.length,
      activa: capas.has("efectivos"),
      disponible: efectivos.length > 0,
      ayuda: efectivos.length
        ? "Bomberos, policía y SAMUR desplegados (vértices Efectivos del grafo)."
        : "Aún no hay efectivos con posición. Llegarán con el despliegue del grafo (aristas DESPLEGADO_EN) o desde sus móviles.",
    },
    {
      id: "humo",
      etiqueta: "Humo",
      cuenta: penacho ? totalHumo : 0,
      activa: capas.has("humo"),
      disponible: !!penacho,
      ayuda: penacho
        ? `Penacho ${penachoServidor ? "calculado por el servidor" : "estimado desde el viento"}: ${Math.round(penacho.longitudM)} m hacia el ${rumboTexto(penacho.rumboGrados)}. ${totalHumo} elementos debajo.`
        : "Sin datos de viento: el penacho se calcula con el viento real (Open-Meteo) o lo envía el servidor.",
      nota: penacho
        ? `${penachoServidor ? "servidor" : "estimado"} · ${Math.round(penacho.longitudM)} m al ${rumboTexto(penacho.rumboGrados)}`
        : undefined,
    },
    {
      id: "rutas",
      etiqueta: "Rutas",
      cuenta: listaRutas.length,
      activa: capas.has("rutas"),
      disponible: listaRutas.length > 0,
      ayuda: listaRutas.length
        ? "Rutas reales sobre calles (OSRM) de la decisión seleccionada."
        : "Selecciona una decisión con rutas calculadas (OSRM) para verlas sobre las calles.",
      nota: listaRutas.length ? undefined : "sin decisión con rutas",
    },
    {
      id: "eventos",
      etiqueta: "Avisos",
      cuenta: eventosGeo.length,
      activa: capas.has("eventos"),
      disponible: eventosGeo.length > 0,
      ayuda: eventosGeo.length
        ? "Avisos entrantes con posición, coloreados según su verificación."
        : "Ningún aviso trae posición todavía. Los periféricos y los reportes con GPS aparecerán aquí.",
    },
    {
      id: "perifericos",
      etiqueta: "Periféricos",
      cuenta: perifericos.length,
      activa: capas.has("perifericos"),
      disponible: perifericos.length > 0,
      ayuda: perifericos.length
        ? "Móviles emparejados con su posición y, si tienen brújula, un cono hacia donde miran."
        : sala.estadoPerifericos.ausente || sala.estadoPerifericos.error
          ? "El servicio de periféricos no responde ahora mismo."
          : "Ningún móvil emparejado comparte su posición. Se emparejan con el QR de la sala de periféricos.",
    },
    {
      id: "trafico",
      etiqueta: "Tráfico",
      cuenta: sensores.length,
      activa: capas.has("trafico"),
      disponible: sensores.length > 0,
      ayuda: sensores.length
        ? "Sensores municipales de tráfico con su carga en tiempo real."
        : "Sin sensores geolocalizados: llegarán del conector de tráfico del Ayuntamiento (Informo Madrid).",
      nota: sensores.length && datos?.actualizadoEn ? `Informo Madrid · ${horaCorta(datos.actualizadoEn)}` : undefined,
    },
    {
      id: "camaras",
      etiqueta: "Cámaras de tráfico",
      cuenta: camaras.length,
      activa: capas.has("camaras"),
      disponible: camaras.length > 0,
      ayuda: camaras.length
        ? "Cámaras municipales más cercanas; la imagen en vivo está en el popup."
        : "Sin cámaras municipales cercanas (informo.madrid.es) o el servicio no responde.",
    },
    {
      id: "osm",
      etiqueta: "Entorno real (OSM)",
      cuenta: nEquip === 0 && cargandoOsm ? null : nEquip,
      activa: capas.has("osm"),
      disponible: nEquip > 0,
      ayuda:
        nEquip > 0
          ? `Hospitales, centros de salud, colegios, residencias, bomberos, policía, estaciones, subestaciones y gasolineras en 2 km${poisServidor.length ? " (servidor + OpenStreetMap)" : " (OpenStreetMap)"}.`
          : ayudaOsm("OpenStreetMap no devuelve equipamientos en 2 km."),
      nota: datosOsm ? `Overpass · ${horaOsm}` : poisServidor.length ? "servidor" : errorOsm ? "Overpass sin respuesta" : undefined,
    },
    {
      id: "vias",
      etiqueta: "Vías principales",
      cuenta: nombresVias.size === 0 && cargandoOsm ? null : nombresVias.size,
      activa: capas.has("vias"),
      disponible: viasMapa.length > 0,
      ayuda: viasMapa.length
        ? "Autopistas, vías rápidas y principales a menos de 600 m; en rojo, las que atraviesa el humo."
        : ayudaOsm("No hay vías principales a menos de 600 m."),
      nota: datosOsm ? `Overpass · ${horaOsm}` : errorOsm ? "Overpass sin respuesta" : undefined,
    },
  ];

  const tiposGrafo = [...new Map(nodosGrafo.map((n) => [n.simbolo.etiqueta, n.simbolo])).values()];
  const tiposEfectivos = [...new Map(efectivos.map((n) => [n.simbolo.etiqueta, n.simbolo])).values()];
  const cuentaEquip = new Map<TipoEquipamiento, number>();
  for (const e of equipamientos) cuentaEquip.set(e.tipo, (cuentaEquip.get(e.tipo) ?? 0) + 1);
  const hayDomino = aristasMapa.some((a) => a.enDomino);
  const tiposRuta = [...new Set(listaRutas.map((r) => r.tipo))];
  const verif = new Set(eventosGeo.map((e) => e.verificacion?.estado ?? "verificado"));

  const leyendas: Partial<Record<Capa, ReactNode>> = {
    grafo: (
      <ListaLeyenda pie="Aro de contorno marcado = vértice del grafo. Clic para ver su ficha.">
        {tiposGrafo.map((s) => (
          <ItemLeyenda
            key={s.etiqueta}
            muestra={<MuestraInsignia simbolo={s} grande grafo />}
            titulo={s.etiqueta}
            ayuda={`${cantidad(nodosGrafo.filter((n) => n.simbolo.etiqueta === s.etiqueta).length, s)} del grafo del incidente sobre su posición real (ArangoDB + OpenStreetMap). Clic en la insignia para abrir su ficha.`}
          >
            {s.etiqueta}
          </ItemLeyenda>
        ))}
        <ItemLeyenda
          muestra={<MuestraLinea color="var(--danger)" discontinua="3 2.5" />}
          titulo="Bloquea"
          ayuda="Arista BLOQUEA_A: el origen deja inutilizable al destino (una vía cortada, un acceso bloqueado)."
        >
          bloquea
        </ItemLeyenda>
        <ItemLeyenda
          muestra={<MuestraLinea color="var(--subtle)" />}
          titulo="Suministra a"
          ayuda="Arista SUMINISTRA_A: dependencia de servicio (energía, agua, comunicaciones) entre dos infraestructuras."
        >
          suministra a
        </ItemLeyenda>
        <ItemLeyenda
          muestra={<MuestraLinea color="var(--brand)" discontinua="1 2.5" />}
          titulo="Desplegado en"
          ayuda="Arista DESPLEGADO_EN: efectivos (bomberos, policía, SAMUR) asignados a ese punto."
        >
          desplegado en
        </ItemLeyenda>
        {hayDomino && (
          <ItemLeyenda
            muestra={<MuestraLinea color="var(--warning)" grosor={3.5} />}
            titulo="Efecto dominó"
            ayuda="Cadena por la que se propagaría el impacto de la decisión seleccionada, desde la incidencia hasta la infraestructura afectada."
          >
            efecto dominó
          </ItemLeyenda>
        )}
      </ListaLeyenda>
    ),
    efectivos: (
      <ListaLeyenda pie="Posición de los vértices Efectivos del grafo (aristas DESPLEGADO_EN).">
        {tiposEfectivos.map((s) => (
          <ItemLeyenda
            key={s.etiqueta}
            muestra={<MuestraInsignia simbolo={s} grande grafo />}
            titulo={s.etiqueta}
            ayuda={`${cantidad(efectivos.filter((n) => n.simbolo.etiqueta === s.etiqueta).length, s)} desplegadas ahora mismo, en su posición real.`}
          >
            {s.etiqueta}
          </ItemLeyenda>
        ))}
      </ListaLeyenda>
    ),
    humo: (
      <ListaLeyenda pie={penachoServidor ? "Cono calculado por el servidor (misma fórmula que el grafo y las decisiones)." : "Cono estimado a partir del viento."}>
        <ItemLeyenda
          muestra={<MuestraAbanico />}
          titulo="Penacho de humo"
          ayuda={
            penacho
              ? `Cono de ${Math.round(penacho.longitudM)} m hacia el ${rumboTexto(penacho.rumboGrados)}${viento ? `, con viento del ${rumboTexto(viento.direccionGrados)} a ${Math.round(viento.velocidadKmh)} km/h` : ""}. El eje marca la dirección más densa.`
              : "Cono de dispersión del humo desde el foco."
          }
        >
          penacho de humo
        </ItemLeyenda>
        <ItemLeyenda
          muestra={<MuestraInsignia simbolo={SIMBOLO_EQUIPAMIENTO.colegio} humo />}
          titulo="Bajo el humo"
          ayuda={`Aro rojo discontinuo: el elemento cae dentro del cono. ${totalHumo} ${totalHumo === 1 ? "elemento afectado" : "elementos afectados"} ahora mismo.`}
        >
          bajo el humo
        </ItemLeyenda>
        <ItemLeyenda
          muestra={<MuestraLinea color="var(--danger)" discontinua="4 2.5" grosor={2.5} />}
          titulo="Vía afectada"
          ayuda="Vía principal que el penacho atraviesa: candidata a corte o a desvío del tráfico."
        >
          vía afectada
        </ItemLeyenda>
      </ListaLeyenda>
    ),
    rutas: (
      <ListaLeyenda pie="Rutas sobre calles reales (OSRM).">
        {tiposRuta.map((t) => (
          <ItemLeyenda
            key={t}
            muestra={
              <MuestraLinea
                color={t === "evacuacion" ? "var(--success)" : t === "ambulancia" ? "var(--info)" : t === "desvio" ? "var(--warning)" : "var(--brand)"}
                grosor={3.5}
              />
            }
            titulo={ETIQUETA_RUTA[t] ?? t}
            ayuda={`${listaRutas.filter((r) => r.tipo === t).length} ruta(s) de este tipo en la decisión seleccionada, trazadas sobre calles reales (OSRM). Pasa el ratón por la línea para ver distancia y tiempo.`}
          >
            {ETIQUETA_RUTA[t] ?? t}
          </ItemLeyenda>
        ))}
      </ListaLeyenda>
    ),
    eventos: (
      <ListaLeyenda pie="Color y texto van siempre juntos: el estado se lee también en el popup.">
        {verif.has("verificado") && (
          <ItemLeyenda muestra={<MuestraPunto color="var(--success)" />} titulo="Verificado" ayuda="El aviso está contrastado con otra fuente (sensor, efectivo en el terreno o cámara).">
            verificado
          </ItemLeyenda>
        )}
        {verif.has("pendiente") && (
          <ItemLeyenda muestra={<MuestraPunto color="var(--warning)" />} titulo="Sin verificar" ayuda="Aviso recibido pero aún sin contrastar: úsalo como indicio, no como hecho.">
            sin verificar
          </ItemLeyenda>
        )}
        {verif.has("sospechoso") && (
          <ItemLeyenda muestra={<MuestraPunto color="var(--danger)" hueco />} titulo="Posible bulo" ayuda="La verificación ha encontrado señales de desinformación o de contenido reutilizado. El motivo está en el popup.">
            posible bulo
          </ItemLeyenda>
        )}
        {verif.has("duplicado") && (
          <ItemLeyenda muestra={<MuestraPunto color="var(--muted)" />} titulo="Duplicado" ayuda="Mismo suceso que otro aviso ya recibido: se agrupa para no contarlo dos veces.">
            duplicado
          </ItemLeyenda>
        )}
      </ListaLeyenda>
    ),
    perifericos: (
      <ListaLeyenda pie="El cono indica hacia dónde mira la cámara del móvil.">
        <ItemLeyenda muestra={<MuestraPunto color="var(--brand)" />} titulo="Móvil ciudadano" ayuda="Teléfono emparejado con el QR de la sala de periféricos que comparte su posición.">
          móvil ciudadano
        </ItemLeyenda>
        <ItemLeyenda muestra={<MuestraPunto color="var(--info)" />} titulo="Efectivo o PMA" ayuda="Móvil de un efectivo o del puesto de mando avanzado: posición y, si hay brújula, hacia dónde mira.">
          efectivo / PMA
        </ItemLeyenda>
        <ItemLeyenda muestra={<MuestraPunto color="var(--warning)" />} titulo="Cámara fija" ayuda="Punto de observación fijo emparejado con la sala.">
          cámara fija
        </ItemLeyenda>
      </ListaLeyenda>
    ),
    trafico: (
      <ListaLeyenda pie="Carga de la vía medida por el sensor municipal (Informo Madrid).">
        <ItemLeyenda muestra={<MuestraPunto color="var(--success)" />} titulo="Tráfico fluido" ayuda="Carga por debajo del 50 %: la vía admite desvíos sin penalizar la evacuación.">
          &lt; 50 %
        </ItemLeyenda>
        <ItemLeyenda muestra={<MuestraPunto color="var(--warning)" />} titulo="Tráfico denso" ayuda="Carga entre el 50 % y el 80 %: la vía empieza a saturarse.">
          50–80 %
        </ItemLeyenda>
        <ItemLeyenda muestra={<MuestraPunto color="var(--danger)" />} titulo="Tráfico saturado" ayuda="Carga del 80 % o más: evita esta vía para ambulancias y evacuación.">
          ≥ 80 %
        </ItemLeyenda>
      </ListaLeyenda>
    ),
    camaras: (
      <ListaLeyenda>
        <ItemLeyenda
          muestra={<MuestraCuadro color="var(--warning)" />}
          titulo="Cámara municipal"
          ayuda="Cámara de tráfico del Ayuntamiento (informo.madrid.es). Clic en el cuadro para ver la última imagen en el popup."
        >
          cámara municipal (imagen en el popup)
        </ItemLeyenda>
      </ListaLeyenda>
    ),
    osm: (
      <ListaLeyenda
        pie={
          <>
            {poisServidor.length > 0 && (
              <span className="block">
                Servidor (OpenStreetMap){datos?.actualizadoEn ? ` · actualizado ${horaCorta(datos.actualizadoEn)}` : ""}
              </span>
            )}
            {fuenteOsm && <span className="block">{fuenteOsm}</span>}
          </>
        }
      >
        {ORDEN_EQUIPAMIENTOS.filter((t) => cuentaEquip.get(t)).map((t) => (
          <ItemLeyenda
            key={t}
            muestra={<MuestraInsignia simbolo={SIMBOLO_EQUIPAMIENTO[t]} grande={t === "hospital"} />}
            titulo={SIMBOLO_EQUIPAMIENTO[t].etiqueta}
            ayuda={`${cantidad(cuentaEquip.get(t) ?? 0, SIMBOLO_EQUIPAMIENTO[t])} a menos de 2 km del foco${horaOsm ? ` · última carga ${horaOsm}` : ""}. Clic en la insignia para su ficha y el enlace a OpenStreetMap.`}
          >
            {SIMBOLO_EQUIPAMIENTO[t].etiqueta} <span className="font-mono text-[10px] text-subtle">{cuentaEquip.get(t)}</span>
          </ItemLeyenda>
        ))}
      </ListaLeyenda>
    ),
    vias: (
      <ListaLeyenda pie={fuenteOsm}>
        <ItemLeyenda
          muestra={<MuestraLinea color="color-mix(in srgb, var(--foreground) 45%, transparent)" grosor={3} />}
          titulo="Vía principal"
          ayuda="Autopistas, autovías, vías rápidas y principales de OpenStreetMap a menos de 600 m del foco."
        >
          vía principal
        </ItemLeyenda>
        <ItemLeyenda
          muestra={<MuestraLinea color="var(--danger)" discontinua="4 2.5" grosor={3} />}
          titulo="Vía bajo el humo"
          ayuda="Algún tramo de la vía cae dentro del penacho: candidata a corte, a desvío o a aviso a los conductores."
        >
          atraviesa el humo
        </ItemLeyenda>
      </ListaLeyenda>
    ),
  };

  const aviso: AvisoMapa | null = errorOsm
    ? {
        texto: modoOsm === "vias" ? "Vías de OSM no disponibles ahora: Overpass sin respuesta" : errorOsm.mensaje,
        detalle: ayudaOsm(""),
        onReintentar: osm.reintentar,
      }
    : null;

  return (
    <div
      ref={raiz}
      role="region"
      aria-label="Mapa de situación: incidente, infraestructuras y humo"
      className="relative isolate h-full min-h-0 w-full overflow-hidden"
      data-capas={[...capas].join(" ")}
      data-encuadre={limites.toBBoxString()}
    >
      <style href="atalaya-mapa-ciudad" precedence="default">
        {ESTILOS_CIUDAD}
      </style>
      <MapaBaseCliente
        centro={centro}
        zoom={15}
        penacho={capas.has("humo") ? penacho : undefined}
        penachoEtiqueta={
          penacho
            ? `Penacho de humo · hacia el ${rumboTexto(penacho.rumboGrados)} · ${Math.round(penacho.longitudM)} m · ${penachoServidor ? "calculado por el servidor" : "estimado desde el viento"}`
            : undefined
        }
      >
        {(c) => (
          <CapasCiudad
            colores={c}
            origen={origen}
            nombreIncidente={nombreIncidente}
            viento={viento}
            capas={capas}
            nodos={nodosMapa}
            aristas={aristasMapa}
            hayDomino={hayDomino}
            rutas={listaRutas}
            sensores={sensores}
            eventos={eventosGeo}
            equipamientos={equipamientos}
            vias={viasMapa}
            perifericos={perifericos}
            camaras={camaras}
            encuadre={{
              limites,
              claveIncidente: `${centro.lat.toFixed(4)},${centro.lon.toFixed(4)}`,
              claveAuto,
              peticion: peticionEncuadre,
              margenIzquierdo: panelAbierto && !compacto ? 272 : 0,
            }}
            onSeleccionarNodo={onSeleccionarNodo}
          />
        )}
      </MapaBaseCliente>

      <PanelCapas
        filas={filas}
        leyendas={leyendas}
        abierto={panelAbierto}
        onAlternarPanel={alternarPanel}
        onAlternarCapa={alternarCapa}
        onEncuadrar={() => setPeticionEncuadre((n) => n + 1)}
        aviso={aviso}
      />

      {capas.has("humo") && resumenHumo.length > 0 && !(compacto && panelAbierto) && (
        <div className="pointer-events-none absolute bottom-2 left-2 z-[1000] max-w-[min(70%,34rem)]" data-resumen-humo>
          <Tooltip
            titulo="Bajo el penacho de humo"
            contenido={
              <>
                {resumenHumo.join(" · ")}
                <span className="mt-1 block font-mono text-[11px] text-subtle">
                  {totalHumo} {totalHumo === 1 ? "elemento" : "elementos"} bajo el cono ·{" "}
                  {penachoServidor ? "penacho calculado por el servidor" : "penacho estimado desde el viento"}
                </span>
              </>
            }
            lado="arriba"
            ancho={340}
            className="pointer-events-auto max-w-full"
          >
            <span
              tabIndex={0}
              className="block cursor-help rounded-lg border border-danger/40 bg-panel/95 px-2.5 py-1.5 text-[11px] leading-4 shadow-sm outline-none backdrop-blur focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <span className="line-clamp-2">
                <span className="font-semibold text-danger">Bajo el humo:</span>{" "}
                <span className="text-foreground">{resumenHumo.slice(0, 6).join(" · ")}</span>
                {resumenHumo.length > 6 && <span className="text-muted"> y {resumenHumo.length - 6} más</span>}
              </span>
            </span>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

