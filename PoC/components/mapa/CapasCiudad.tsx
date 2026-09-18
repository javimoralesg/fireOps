"use client";

// Capas de Leaflet del mapa de la consola (se montan DENTRO del MapContainer de
// MapaBaseCliente). Recibe los datos ya preparados y deduplicados por MapaCiudadCliente
// y se ocupa de pintar, etiquetar sin amontonar y encuadrar.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import { CircleMarker, Marker, Polyline, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { EventoIngesta } from "@/lib/types";
import type { CamaraTrafico, Periferico } from "@/lib/tipos-perifericos";
import { CapasPerifericos } from "@/components/perifericos/CapasPerifericos";
import { formatearDistancia, formatearDuracion, rumboTexto, type LatLon } from "./geo";
import { colocarEtiquetas, desplazamientoEtiqueta, textoEtiqueta, type CandidatoEtiqueta, type Caja, type LadoEtiqueta } from "./etiquetas";
import { urlOsm, type EquipamientoOsm, type TipoEquipamiento, type ViaOsm } from "./overpass";
import type { Capa } from "./PanelCapas";
import { cuboZoom, diametroInsignia, htmlInsignia, SIMBOLO_EQUIPAMIENTO, type Simbolo } from "./simbologia";
import type { RutaMapa, SensorMapa } from "./tipos";
import type { ColoresTema } from "./useColoresTema";

// ---------------------------------------------------------------- modelo

export interface NodoMapa {
  id: string;
  nombre: string;
  tipo: string;
  etiquetaTipo: string;
  lat: number;
  lon: number;
  subtipo?: string;
  detalle?: string;
  osmId?: string;
  origen?: string;
  simbolo: Simbolo;
  efectivo: boolean;
  /** Incidencia principal: la representa el foco pulsante, no una insignia. */
  principal: boolean;
  humo: boolean;
  domino: boolean;
  distanciaM: number;
}

export interface AristaMapa {
  clave: string;
  desde: NodoMapa;
  hasta: NodoMapa;
  tipo: string;
  enDomino: boolean;
}

export interface EquipamientoMapa extends Omit<EquipamientoOsm, "distanciaM"> {
  tipo: TipoEquipamiento;
  distanciaM?: number;
  url: string;
  fuente: "servidor" | "overpass";
  humo: boolean;
}

export interface ViaMapa extends ViaOsm {
  humo: boolean;
}

export interface EncuadreMapa {
  limites: L.LatLngBounds;
  /** Identifica el incidente: si cambia, se vuelve a encuadrar aunque el operador haya movido el mapa. */
  claveIncidente: string;
  /** Cambia cuando llega por primera vez un tipo de dato geolocalizado (encuadre automático). */
  claveAuto: string;
  /** Contador del botón "Encuadrar". */
  peticion: number;
  /** Espacio que tapa el panel de capas a la izquierda (px). */
  margenIzquierdo: number;
}

interface Props {
  colores: ColoresTema;
  origen: LatLon;
  nombreIncidente: string;
  viento?: { direccionGrados: number; velocidadKmh: number };
  capas: Set<Capa>;
  nodos: NodoMapa[];
  aristas: AristaMapa[];
  hayDomino: boolean;
  rutas: RutaMapa[];
  sensores: SensorMapa[];
  eventos: EventoIngesta[];
  equipamientos: EquipamientoMapa[];
  vias: ViaMapa[];
  perifericos: Periferico[];
  camaras: CamaraTrafico[];
  encuadre: EncuadreMapa;
  onSeleccionarNodo?: (id: string) => void;
}

// ---------------------------------------------------------------- estilos

/** Insignias (divIcon) y etiquetas: CSS con tokens, así cambian solas con el tema. */
export const ESTILOS_CIUDAD = `
.atalaya-mapa .atalaya-marcador { background: transparent; border: 0; }
.atalaya-insignia {
  position: absolute; left: 0; top: 0; transform: translate(-50%, -50%);
  box-sizing: border-box; display: flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 9999px;
  background: var(--c); color: var(--panel); border: 1.5px solid var(--panel);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
  font: 800 9.5px/1 var(--font-manrope), system-ui, sans-serif; letter-spacing: -0.03em;
  cursor: pointer; user-select: none; transition: transform 120ms ease;
}
.atalaya-insignia:hover { transform: translate(-50%, -50%) scale(1.18); }
.atalaya-insignia[data-grande] { width: 22px; height: 22px; font-size: 11px; border-width: 2px; }
.atalaya-insignia[data-tenue] { width: 16px; height: 16px; font-size: 8.5px; opacity: 0.85; }
.atalaya-insignia[data-grafo] { border-color: var(--foreground); }
.atalaya-insignia[data-humo] { outline: 2px dashed var(--danger); outline-offset: 2px; opacity: 1; }
.atalaya-insignia[data-domino] { box-shadow: 0 0 0 4px color-mix(in srgb, var(--warning) 55%, transparent), 0 1px 3px rgb(0 0 0 / 0.3); }
.atalaya-insignia[data-estatica] { position: relative; transform: none; cursor: default; display: inline-flex; flex-shrink: 0; width: 15px; height: 15px; font-size: 8.5px; border-width: 1px; box-shadow: none; opacity: 1; }
.atalaya-insignia[data-estatica][data-grande] { width: 17px; height: 17px; font-size: 9px; border-width: 1.5px; }
.atalaya-insignia[data-estatica][data-humo] { outline-offset: 1px; outline-width: 1.5px; }
[data-zoom="medio"] .atalaya-insignia { width: 14px; height: 14px; font-size: 8px; border-width: 1px; }
[data-zoom="medio"] .atalaya-insignia[data-tenue] { width: 12px; height: 12px; font-size: 7px; }
[data-zoom="medio"] .atalaya-insignia[data-grande] { width: 18px; height: 18px; font-size: 9.5px; border-width: 1.5px; }
[data-zoom="lejos"] .atalaya-insignia { width: 9px; height: 9px; font-size: 0; border-width: 1px; }
[data-zoom="lejos"] .atalaya-insignia[data-tenue] { width: 7px; height: 7px; }
[data-zoom="lejos"] .atalaya-insignia[data-grande] { width: 14px; height: 14px; font-size: 8px; border-width: 1.5px; }
.atalaya-mapa .leaflet-tooltip.atalaya-etiqueta {
  background: color-mix(in srgb, var(--panel) 90%, transparent); color: var(--foreground);
  border: 1px solid var(--panel-border); border-radius: 5px; box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
  font-size: 11px; font-weight: 650; line-height: 1.3; padding: 1px 6px; white-space: nowrap;
}
.atalaya-mapa .leaflet-tooltip.atalaya-etiqueta:before { display: none; }
.atalaya-mapa .leaflet-tooltip.atalaya-etiqueta-humo { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, transparent); }
.atalaya-mapa .leaflet-tooltip.atalaya-etiqueta-foco { color: var(--danger); font-weight: 750; }
/* Halo del color del panel: los puntos de aviso se recortan igual sobre la tesela clara y sobre la oscura */
.atalaya-mapa .atalaya-aviso { filter: drop-shadow(0 0 1.5px var(--panel)); }
.atalaya-popup-titulo { display: block; font-size: 13px; font-weight: 600; line-height: 1.3; letter-spacing: -0.01em; color: var(--foreground); }
.atalaya-popup-fila { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 4px; }
.atalaya-popup-dato { display: block; margin-top: 3px; color: var(--muted); }
.atalaya-popup-meta { display: block; margin-top: 3px; font-family: var(--font-jetbrains), ui-monospace, monospace; font-size: 11px; color: var(--subtle); }
.atalaya-popup-acciones { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
.atalaya-popup-fuente { display: block; margin-top: 5px; font-family: var(--font-jetbrains), ui-monospace, monospace; font-size: 10.5px; color: var(--subtle); }
`;

const iconoIncidente = L.divIcon({
  className: "",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  // Aro del color del panel (blanco en claro, oscuro en oscuro): contraste sobre cualquier tesela.
  html: `<span class="relative flex size-[22px] items-center justify-center" data-foco><span class="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60"></span><span class="relative inline-flex size-4 rounded-full border-2 border-panel bg-danger shadow"></span></span>`,
});

// ---------------------------------------------------------------- utilidades

function colorArista(tipo: string, enDomino: boolean, c: ColoresTema) {
  if (enDomino) return c.warning;
  if (tipo === "BLOQUEA_A") return c.danger;
  if (tipo === "DESPLEGADO_EN") return c.accent;
  return c.subtle;
}

const ETIQUETA_ARISTA: Record<string, string> = {
  BLOQUEA_A: "bloquea",
  SUMINISTRA_A: "suministra a",
  DESPLEGADO_EN: "desplegado en",
};

export function colorCarga(carga: number, c: ColoresTema) {
  if (carga >= 80) return c.danger;
  if (carga >= 50) return c.warning;
  return c.success;
}

export function colorRuta(tipo: string, c: ColoresTema) {
  if (tipo === "evacuacion") return c.success;
  if (tipo === "ambulancia") return c.info;
  if (tipo === "desvio") return c.warning;
  return c.accent;
}

export const ETIQUETA_RUTA: Record<string, string> = {
  desvio: "Desvío",
  evacuacion: "Evacuación",
  ambulancia: "Ambulancias",
  acceso: "Acceso",
};

export function colorVerificacion(ev: EventoIngesta, c: ColoresTema) {
  switch (ev.verificacion?.estado) {
    case "sospechoso":
      return c.danger;
    case "duplicado":
      return c.muted;
    case "pendiente":
      return c.warning;
    default:
      return c.success;
  }
}

const ETIQUETA_VERIFICACION: Record<string, string> = {
  verificado: "Verificado",
  pendiente: "Sin verificar",
  sospechoso: "Posible bulo",
  duplicado: "Duplicado",
};

/** Píldora del estado de verificación en el popup: el color nunca va solo, siempre con su texto. */
const PILDORA_VERIFICACION: Record<string, string> = {
  verificado: "pildora pildora-exito",
  pendiente: "pildora pildora-aviso",
  sospechoso: "pildora pildora-peligro",
  duplicado: "pildora",
};

const ETIQUETA_CLASE_VIA: Record<string, string> = { motorway: "autopista / autovía", trunk: "vía rápida", primary: "vía principal" };

// ---------------------------------------------------------------- piezas

/**
 * Zoom actual y un contador de vista (cambia al mover o redimensionar), para recolocar
 * etiquetas. Además marca el contenedor con data-zoom para el tamaño de las insignias.
 */
function useVistaMapa() {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  const [vista, setVista] = useState(0);
  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
    moveend: () => setVista((v) => v + 1),
    resize: () => setVista((v) => v + 1),
  });
  useEffect(() => {
    map.getContainer().setAttribute("data-zoom", cuboZoom(zoom));
  }, [map, zoom]);
  return { zoom, vista };
}

function Etiqueta({ lado, radio, texto, clase }: { lado: LadoEtiqueta; radio: number; texto: string; clase?: string }) {
  return (
    <Tooltip
      permanent
      direction={lado}
      offset={desplazamientoEtiqueta(lado, radio)}
      className={`atalaya-etiqueta ${clase ?? ""}`}
      opacity={1}
    >
      {textoEtiqueta(texto)}
    </Tooltip>
  );
}

interface PropsInsignia {
  lat: number;
  lon: number;
  simbolo: Simbolo;
  grande?: boolean;
  tenue?: boolean;
  grafo?: boolean;
  humo?: boolean;
  domino?: boolean;
  capa: string;
  osmId?: string;
  zIndexOffset?: number;
  onClick?: () => void;
  children?: ReactNode;
}

function MarcadorInsignia({
  lat,
  lon,
  simbolo,
  grande,
  tenue,
  grafo,
  humo,
  domino,
  capa,
  osmId,
  zIndexOffset,
  onClick,
  children,
}: PropsInsignia) {
  const icono = useMemo(
    () =>
      L.divIcon({
        className: "atalaya-marcador",
        iconSize: [0, 0],
        iconAnchor: [0, 0],
        html: htmlInsignia(simbolo, { grande, tenue, grafo, humo, domino, datos: { capa, "osm-id": osmId } }),
      }),
    [simbolo, grande, tenue, grafo, humo, domino, capa, osmId],
  );
  const posicion = useMemo<LatLon>(() => [lat, lon], [lat, lon]);
  const eventos = useMemo(() => (onClick ? { click: onClick } : undefined), [onClick]);
  return (
    <Marker position={posicion} icon={icono} zIndexOffset={zIndexOffset} eventHandlers={eventos}>
      {children}
    </Marker>
  );
}

/** Única acción del popup: abrir el elemento en OpenStreetMap (botón secundario pequeño). */
function EnlaceOsm({ id }: { id?: string }) {
  if (!id || !/^(node|way|relation)\/\d+$/.test(id)) return null;
  return (
    <span className="atalaya-popup-acciones">
      <a href={urlOsm(id)} target="_blank" rel="noreferrer" className="boton boton-secundario boton-sm">
        Ver en OpenStreetMap ↗
      </a>
    </span>
  );
}

/** Encuadre automático (una vez por tipo de dato) y a petición del botón "Encuadrar". */
function ControlEncuadre({ limites, claveIncidente, claveAuto, peticion, margenIzquierdo }: EncuadreMapa) {
  const map = useMap();
  const hechos = useRef(new Set<string>());
  const tocado = useRef(false);
  const ultimaPeticion = useRef(peticion);
  const incidente = useRef(claveIncidente);

  useEffect(() => {
    const contenedor = map.getContainer();
    const marcar = () => {
      tocado.current = true;
    };
    contenedor.addEventListener("wheel", marcar, { passive: true });
    contenedor.addEventListener("pointerdown", marcar);
    contenedor.addEventListener("keydown", marcar);
    return () => {
      contenedor.removeEventListener("wheel", marcar);
      contenedor.removeEventListener("pointerdown", marcar);
      contenedor.removeEventListener("keydown", marcar);
    };
  }, [map]);

  useEffect(() => {
    const ajustar = () => {
      if (!limites.isValid()) return;
      const tam = map.getSize();
      if (tam.x < 40 || tam.y < 40) {
        map.once("resize", ajustar);
        return;
      }
      map.fitBounds(limites, {
        // Arriba, la fila de botones; a la derecha, el zoom. Márgenes justos: el mapa es pequeño.
        paddingTopLeft: [Math.min(margenIzquierdo, tam.x * 0.45) + 20, 44],
        paddingBottomRight: [44, 20],
        maxZoom: 16,
      });
    };
    if (peticion !== ultimaPeticion.current) {
      ultimaPeticion.current = peticion;
      ajustar();
      return;
    }
    if (claveIncidente !== incidente.current) {
      // Otro incidente: se empieza de cero.
      incidente.current = claveIncidente;
      hechos.current.clear();
      tocado.current = false;
    }
    if (hechos.current.has(claveAuto)) return;
    const primera = hechos.current.size === 0;
    hechos.current.add(claveAuto);
    // Tras el primer encuadre, los automáticos no pisan lo que el operador haya movido.
    if (primera || !tocado.current) ajustar();
  }, [map, limites, claveIncidente, claveAuto, peticion, margenIzquierdo]);

  return null;
}

// ---------------------------------------------------------------- capas

export function CapasCiudad({
  colores: c,
  origen,
  nombreIncidente,
  viento,
  capas,
  nodos,
  aristas,
  hayDomino,
  rutas,
  sensores,
  eventos,
  equipamientos,
  vias,
  perifericos,
  camaras,
  encuadre,
  onSeleccionarNodo,
}: Props) {
  const map = useMap();
  const { zoom, vista } = useVistaMapa();
  const on = (capa: Capa) => capas.has(capa);

  const nodosVisibles = nodos.filter((n) => !n.principal && (n.efectivo ? capas.has("efectivos") : capas.has("grafo")));
  const equipVisibles = capas.has("osm") ? equipamientos : [];

  // Etiquetas permanentes: solo lo importante, sin solaparse, recolocadas al cambiar el zoom.
  const candidatos = useMemo(() => {
    const lista: CandidatoEtiqueta[] = [
      { id: "foco", lat: origen[0], lon: origen[1], texto: nombreIncidente, prioridad: 100, radio: 11, forzar: true },
    ];
    for (const n of nodosVisibles) {
      const prioridad = n.domino
        ? 95
        : n.humo
          ? 90
          : n.tipo === "Incidencia"
            ? 88
            : n.tipo === "Hospital"
              ? 80
              : n.efectivo
                ? 70
                : 0;
      if (prioridad) lista.push({ id: n.id, lat: n.lat, lon: n.lon, texto: n.nombre, prioridad, radio: diametroInsignia(zoom, true) / 2 });
    }
    for (const e of equipVisibles) {
      const sensible = e.tipo === "hospital" || e.tipo === "residencia" || e.tipo === "colegio";
      const prioridad = e.humo ? (sensible ? 72 : 60) : e.tipo === "hospital" ? 75 : 0;
      const grande = e.tipo === "hospital";
      if (prioridad) lista.push({ id: e.id, lat: e.lat, lon: e.lon, texto: e.nombre, prioridad, radio: diametroInsignia(zoom, grande, !grande && !e.humo) / 2 });
    }
    return lista;
    // nodosVisibles/equipVisibles se derivan de estas dependencias
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodos, equipamientos, capas, origen, nombreIncidente, zoom]);

  // Menos etiquetas cuanto más lejos, y nunca debajo de los controles superpuestos.
  const margenPanel = encuadre.margenIzquierdo;
  const etiquetas = useMemo(() => {
    const { x: w, y: h } = map.getSize();
    const reservadas: Caja[] = [
      { x0: 0, y0: 0, x1: Math.max(margenPanel, Math.min(w * 0.75, 340)), y1: margenPanel ? h : 46 }, // botones / panel de capas
      { x0: 0, y0: h - 58, x1: Math.min(w * 0.72, 560), y1: h }, // resumen "Bajo el humo"
      { x0: w - 58, y0: h - 96, x1: w, y1: h }, // zoom y atribución
    ];
    return colocarEtiquetas(map, candidatos, zoom <= 13 ? 6 : zoom === 14 ? 10 : 14, reservadas);
    // `vista` fuerza el recálculo al mover el mapa (las posiciones son de pantalla).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, zoom, vista, candidatos, margenPanel]);

  const porIdVisible = new Set(nodosVisibles.map((n) => n.id));
  const radioGrande = diametroInsignia(zoom, true) / 2;

  return (
    <>
      <ControlEncuadre {...encuadre} />

      {/* Vías principales reales (OSM): finas; en rojo discontinuo las que cruza el humo */}
      {on("vias") &&
        vias.map((v) =>
          v.tramos.map((tramo, i) => (
            <Polyline
              key={`${v.id}-${i}`}
              positions={tramo}
              pathOptions={{
                className: v.humo ? "atalaya-via atalaya-via-humo" : "atalaya-via",
                color: v.humo ? c.danger : c.foreground,
                weight: v.humo ? 4.5 : 3,
                opacity: v.humo ? 0.9 : 0.42,
                dashArray: v.humo ? "8 5" : undefined,
                lineCap: "round",
              }}
            >
              <Tooltip sticky>
                <strong>{v.ref && v.ref !== v.nombre ? `${v.ref} · ${v.nombre}` : v.nombre}</strong> · {ETIQUETA_CLASE_VIA[v.clase]}
                {v.humo && <> · atraviesa el humo</>}
              </Tooltip>
              <Popup>
                <span className="atalaya-popup-titulo">{v.nombre}</span>
                <span className="atalaya-popup-fila">
                  <span className="pildora">{ETIQUETA_CLASE_VIA[v.clase]}</span>
                  {v.humo && <span className="pildora pildora-peligro">Atraviesa el humo</span>}
                </span>
                {v.humo && <span className="atalaya-popup-dato">Posible corte: el penacho cruza la vía.</span>}
                {v.ref && <span className="atalaya-popup-meta">{v.ref}</span>}
                <EnlaceOsm id={v.id} />
                <span className="atalaya-popup-fuente">Fuente: OpenStreetMap (Overpass)</span>
              </Popup>
            </Polyline>
          )),
        )}

      {/* Aristas del grafo entre vértices geolocalizados */}
      {on("grafo") &&
        aristas.map((a) => {
          const visibleDesde = a.desde.principal || porIdVisible.has(a.desde.id);
          const visibleHasta = a.hasta.principal || porIdVisible.has(a.hasta.id);
          if (!visibleDesde || !visibleHasta) return null;
          return (
            <Polyline
              key={a.clave}
              positions={[
                [a.desde.lat, a.desde.lon],
                [a.hasta.lat, a.hasta.lon],
              ]}
              pathOptions={{
                className: "atalaya-arista",
                color: colorArista(a.tipo, a.enDomino, c),
                weight: a.enDomino ? 4 : a.tipo === "BLOQUEA_A" ? 2 : 1.5,
                opacity: hayDomino && !a.enDomino ? 0.3 : 0.85,
                dashArray: a.tipo === "BLOQUEA_A" ? "6 5" : a.tipo === "DESPLEGADO_EN" ? "2 5" : undefined,
              }}
            >
              <Tooltip sticky>
                {a.desde.nombre} → {a.hasta.nombre} · {ETIQUETA_ARISTA[a.tipo] ?? a.tipo.toLowerCase()}
                {a.enDomino && " · efecto dominó"}
              </Tooltip>
            </Polyline>
          );
        })}

      {/* Rutas reales (OSRM) de la decisión seleccionada */}
      {on("rutas") &&
        rutas.map((r) => (
          <Polyline
            key={r.id}
            positions={r.coords}
            pathOptions={{ className: "atalaya-ruta", color: colorRuta(r.tipo, c), weight: 5, opacity: 0.85, lineCap: "round", lineJoin: "round" }}
          >
            <Tooltip sticky>
              <strong>{ETIQUETA_RUTA[r.tipo] ?? r.tipo}:</strong> {r.nombre}
              {r.distanciaM != null && <> · {formatearDistancia(r.distanciaM)}</>}
              {r.duracionS != null && <> · {formatearDuracion(r.duracionS)}</>}
              {r.fuente && <> · {r.fuente}</>}
            </Tooltip>
          </Polyline>
        ))}

      {/* Sensores de tráfico municipales */}
      {on("trafico") &&
        sensores.map((s) => (
          <CircleMarker
            key={s.id}
            center={[s.lat, s.lon]}
            radius={5}
            pathOptions={{ className: "atalaya-sensor", color: c.panel, weight: 1.5, fillColor: colorCarga(s.carga, c), fillOpacity: 0.95 }}
          >
            <Tooltip direction="top" offset={[0, -5]}>
              <strong>{s.descripcion}</strong>
              <br />
              Carga {Math.round(s.carga)} %{s.intensidad != null && <> · {s.intensidad} veh/h</>}
            </Tooltip>
          </CircleMarker>
        ))}

      {/* Avisos entrantes geolocalizados */}
      {on("eventos") &&
        eventos.map((e) => (
          <CircleMarker
            key={e.id}
            center={[e.geo!.lat, e.geo!.lon]}
            radius={6}
            pathOptions={{
              className: "atalaya-aviso",
              color: colorVerificacion(e, c),
              weight: 2,
              fillColor: colorVerificacion(e, c),
              fillOpacity: e.verificacion?.estado === "sospechoso" ? 0.12 : 0.5,
            }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <strong>{e.titulo}</strong>
              {e.verificacion?.estado === "sospechoso" && " · posible bulo"}
              {e.verificacion?.estado === "pendiente" && " · sin verificar"}
            </Tooltip>
            <Popup>
              <span className="atalaya-popup-titulo">{e.titulo}</span>
              <span className="atalaya-popup-fila">
                <span className={PILDORA_VERIFICACION[e.verificacion?.estado ?? "verificado"] ?? "pildora"}>
                  {ETIQUETA_VERIFICACION[e.verificacion?.estado ?? "verificado"] ?? e.verificacion?.estado}
                </span>
                <span className="pildora">Aviso</span>
              </span>
              {e.detalle && <span className="atalaya-popup-dato">{e.detalle}</span>}
              {e.verificacion?.motivo && <span className="atalaya-popup-dato">{e.verificacion.motivo}</span>}
              <span className="atalaya-popup-meta">confianza {Math.round(e.confianza * 100)} %</span>
              {e.imagenUrl && (
                // La URL puede ser relativa (/api/ingesta/imagen/<id>) o absoluta (R2): ambas valen en <img>.
                // eslint-disable-next-line @next/next/no-img-element -- imagen de un aviso dentro de un popup de Leaflet
                <img src={e.imagenUrl} alt={`Imagen del aviso: ${e.titulo}`} style={{ display: "block", width: 220, maxWidth: "100%", marginTop: 6, borderRadius: 6 }} />
              )}
            </Popup>
          </CircleMarker>
        ))}

      {/* Periféricos (móviles con cono de rumbo) y cámaras municipales: CapasPerifericos */}
      {(on("perifericos") || on("camaras")) && (
        <CapasPerifericos
          perifericos={perifericos}
          camaras={camaras}
          colores={c}
          capas={{ nodos: false, aristas: false, observaciones: false, perifericos: on("perifericos"), camaras: on("camaras") }}
        />
      )}

      {/* Entorno real de OpenStreetMap: equipamientos por tipo */}
      {equipVisibles.map((e) => {
        const simbolo = SIMBOLO_EQUIPAMIENTO[e.tipo];
        const grande = e.tipo === "hospital";
        const tenue = !grande && !e.humo;
        const radio = diametroInsignia(zoom, grande, tenue) / 2;
        const lado = etiquetas.get(e.id);
        return (
          <MarcadorInsignia
            key={`eq-${e.id}`}
            lat={e.lat}
            lon={e.lon}
            simbolo={simbolo}
            grande={grande}
            tenue={tenue}
            humo={e.humo}
            capa="osm"
            osmId={e.id}
            zIndexOffset={e.humo ? 400 : 0}
          >
            {lado ? (
              <Etiqueta key={`${lado}-${zoom}`} lado={lado} radio={radio} texto={e.nombre} clase={e.humo ? "atalaya-etiqueta-humo" : undefined} />
            ) : (
              <Tooltip key="hover" direction="top" offset={[0, -radio - 2]}>
                <strong>{e.nombre}</strong> · {e.detalle ?? simbolo.etiqueta}
                {e.humo && " · bajo el humo"}
              </Tooltip>
            )}
            <Popup>
              <span className="atalaya-popup-titulo">{e.nombre}</span>
              <span className="atalaya-popup-fila">
                <span className="pildora">{simbolo.etiqueta}</span>
                {e.humo && <span className="pildora pildora-peligro">Bajo el humo</span>}
              </span>
              {e.detalle && e.detalle !== simbolo.etiqueta && <span className="atalaya-popup-dato">{e.detalle}</span>}
              {e.direccion && <span className="atalaya-popup-dato">{e.direccion}</span>}
              {e.operador && e.operador !== e.detalle && <span className="atalaya-popup-dato">Gestiona: {e.operador}</span>}
              {e.distanciaM != null && <span className="atalaya-popup-meta">a {formatearDistancia(e.distanciaM)} del foco</span>}
              <EnlaceOsm id={e.id} />
              <span className="atalaya-popup-fuente">
                Fuente: {e.fuente === "servidor" ? "servidor (OpenStreetMap)" : "OpenStreetMap (Overpass)"}
              </span>
            </Popup>
          </MarcadorInsignia>
        );
      })}

      {/* Vértices del grafo: infraestructuras y efectivos */}
      {nodosVisibles.map((n) => {
        const lado = etiquetas.get(n.id);
        return (
          <MarcadorInsignia
            key={`n-${n.id}`}
            lat={n.lat}
            lon={n.lon}
            simbolo={n.simbolo}
            grande
            grafo
            humo={n.humo}
            domino={n.domino}
            capa={n.efectivo ? "efectivos" : "grafo"}
            osmId={n.osmId}
            zIndexOffset={n.domino ? 800 : n.humo ? 700 : 600}
            onClick={onSeleccionarNodo ? () => onSeleccionarNodo(n.id) : undefined}
          >
            {lado ? (
              <Etiqueta key={`${lado}-${zoom}`} lado={lado} radio={radioGrande} texto={n.nombre} clase={n.humo ? "atalaya-etiqueta-humo" : undefined} />
            ) : (
              <Tooltip key="hover" direction="top" offset={[0, -radioGrande - 2]}>
                <strong>{n.nombre}</strong> · {n.etiquetaTipo}
                {n.humo && " · bajo el humo"}
              </Tooltip>
            )}
            <Popup>
              <span className="atalaya-popup-titulo">{n.nombre}</span>
              <span className="atalaya-popup-fila">
                <span className="pildora">{n.etiquetaTipo}</span>
                {n.humo && <span className="pildora pildora-peligro">Bajo el humo</span>}
                {n.domino && <span className="pildora pildora-aviso">Efecto dominó</span>}
              </span>
              {n.detalle && <span className="atalaya-popup-dato">{n.detalle}</span>}
              <span className="atalaya-popup-meta">vértice del grafo · a {formatearDistancia(n.distanciaM)} del foco</span>
              <EnlaceOsm id={n.osmId} />
              <span className="atalaya-popup-fuente">
                Fuente: grafo del incidente{n.origen === "OSM" ? " (ArangoDB + OpenStreetMap)" : n.origen === "periferico" ? " (periférico)" : ""}
              </span>
            </Popup>
          </MarcadorInsignia>
        );
      })}

      {/* Foco del incidente */}
      <Marker position={origen} icon={iconoIncidente} zIndexOffset={1000}>
        {etiquetas.get("foco") ? (
          <Etiqueta key={etiquetas.get("foco")} lado={etiquetas.get("foco")!} radio={11} texto={nombreIncidente} clase="atalaya-etiqueta-foco" />
        ) : (
          <Tooltip key="hover" direction="top" offset={[0, -12]}>
            <strong>{nombreIncidente}</strong>
          </Tooltip>
        )}
        <Popup>
          <span className="atalaya-popup-titulo">{nombreIncidente}</span>
          <span className="atalaya-popup-fila">
            <span className="pildora pildora-peligro">Foco del incidente</span>
          </span>
          {viento && (
            <>
              <span className="atalaya-popup-dato">
                El humo va hacia el {rumboTexto(viento.direccionGrados + 180)}.
              </span>
              <span className="atalaya-popup-meta">
                viento del {rumboTexto(viento.direccionGrados)} · {Math.round(viento.velocidadKmh)} km/h
              </span>
            </>
          )}
        </Popup>
      </Marker>
    </>
  );
}
