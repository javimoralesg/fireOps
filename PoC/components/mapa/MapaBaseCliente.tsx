"use client";

// Mapa base de OpenStreetMap con Leaflet. SOLO CLIENTE: importa leaflet, que usa
// window al cargar. No lo importes directamente desde una página; usa MapaBase
// (components/mapa/MapaBase.tsx), que lo carga con dynamic(..., { ssr: false }).
//
// Encaje en la página:
//  - La raíz es `relative isolate`: los z-index internos de Leaflet (panes 400-700,
//    controles 800-1000) quedan dentro del mapa y no pisan menús ni cabeceras.
//  - Ocupa el 100 % del padre (h-full w-full) y recorta lo que sobresalga.
//  - Un ResizeObserver llama a invalidateSize() cuando cambia el tamaño del
//    contenedor (carga diferida, paneles que se pliegan, cambio de columna…).

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, type ReactNode } from "react";
import { Circle, CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap, ZoomControl } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import { destino, poligonoPenacho, rumboTexto, type LatLon, type Penacho } from "./geo";
import { useColoresTema, type ColoresTema } from "./useColoresTema";

export type Tono = "danger" | "warning" | "success" | "info" | "accent" | "muted";

export interface MarcadorSimple {
  id: string;
  lat: number;
  lon: number;
  etiqueta: string;
  tono?: Tono;
}

export interface MapaBaseProps {
  centro: { lat: number; lon: number };
  zoom?: number;
  /** Zona afectada: círculo de radio en metros alrededor del centro, o polígono. */
  zona?: { tipo: "circulo"; radioM: number } | { tipo: "poligono"; puntos: LatLon[] };
  /** Penacho de humo en abanico desde el centro. */
  penacho?: Penacho;
  /** Texto del tooltip del penacho (por defecto, rumbo y alcance). */
  penachoEtiqueta?: string;
  marcadores?: MarcadorSimple[];
  /**
   * false (portal público, móvil): sin botones de zoom ni zoom con rueda, doble clic,
   * pellizco, recuadro o teclado, ni arrastre (salvo con `arrastrable`).
   */
  interactivo?: boolean;
  /** Con interactivo=false, permite aun así arrastrar el mapa (por defecto no: en móvil se quedaría con el scroll de la página). */
  arrastrable?: boolean;
  /** Encuadra estos límites al montar y cuando cambian de valor. */
  encuadre?: LatLngBoundsExpression;
  /** Clases de la raíz del mapa (tamaño, bordes…). */
  className?: string;
  children?: ReactNode | ((colores: ColoresTema) => ReactNode);
}

// El tema de Leaflet (popups, tooltips, controles, atribución y el filtro de las
// teselas en oscuro) vive en app/globals.css, bloque "Leaflet (mapa de situación)":
// es CSS con tokens y cambia solo con data-theme. Aquí solo quedan los colores que
// Leaflet pinta como atributos SVG (stroke/fill), que no resuelven var(--token).

function claveLimites(l?: LatLngBoundsExpression) {
  if (!l) return "";
  if ("toBBoxString" in l && typeof l.toBBoxString === "function") return l.toBBoxString();
  return JSON.stringify(l);
}

/** Encuadra al montar y cuando cambian los límites (por valor, no por referencia). */
/** Leaflet etiqueta en inglés el botón de cerrar de los popups ("Close popup"): lo traducimos al abrirse. */
function PopupsEnEspanol() {
  const map = useMap();
  useEffect(() => {
    const traducir = (e: { popup: { getElement: () => HTMLElement | undefined } }) => {
      const boton = e.popup.getElement()?.querySelector(".leaflet-popup-close-button");
      boton?.setAttribute("aria-label", "Cerrar");
      boton?.setAttribute("title", "Cerrar");
    };
    map.on("popupopen", traducir);
    return () => {
      map.off("popupopen", traducir);
    };
  }, [map]);
  return null;
}

function Encuadre({ limites }: { limites?: LatLngBoundsExpression }) {
  const map = useMap();
  const clave = claveLimites(limites);
  const ultima = useRef("");
  useEffect(() => {
    if (!limites || clave === ultima.current) return;
    ultima.current = clave;
    map.fitBounds(limites, { padding: [28, 28], maxZoom: 16 });
  }, [map, limites, clave]);
  return null;
}

/** invalidateSize() cada vez que el contenedor cambia de tamaño. */
function AjusteTamano() {
  const map = useMap();
  useEffect(() => {
    const contenedor = map.getContainer();
    let cuadro = 0;
    const observador = new ResizeObserver(() => {
      cancelAnimationFrame(cuadro);
      cuadro = requestAnimationFrame(() => map.invalidateSize({ debounceMoveend: true }));
    });
    observador.observe(contenedor);
    return () => {
      observador.disconnect();
      cancelAnimationFrame(cuadro);
    };
  }, [map]);
  return null;
}

/** Si cambia el incidente (otro centro), el mapa lo sigue. El primer centro lo fija MapContainer. */
function SeguirCentro({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const anterior = useRef<string | null>(null);
  useEffect(() => {
    const clave = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (anterior.current !== null && anterior.current !== clave) map.setView([lat, lon], map.getZoom(), { animate: true });
    anterior.current = clave;
  }, [map, lat, lon]);
  return null;
}

function CapaPenacho({ origen, penacho, etiqueta, colores, oscuro }: { origen: LatLon; penacho: Penacho; etiqueta?: string; colores: ColoresTema; oscuro: boolean }) {
  const exterior = poligonoPenacho(origen, penacho);
  const nucleo = poligonoPenacho(origen, { ...penacho, semianguloGrados: penacho.semianguloGrados * 0.45, longitudM: penacho.longitudM * 0.72 });
  const eje: LatLon[] = [origen, destino(origen, penacho.rumboGrados, penacho.longitudM)];
  const texto =
    etiqueta ??
    `Penacho de humo · hacia el ${rumboTexto(penacho.rumboGrados)} (${Math.round(penacho.rumboGrados)}°) · ${Math.round(penacho.longitudM)} m`;
  return (
    <>
      <Polygon
        positions={exterior}
        pathOptions={{
          className: "atalaya-penacho",
          color: colores.humoNucleo,
          weight: 1.3,
          opacity: 0.85,
          fillColor: colores.humo,
          fillOpacity: oscuro ? 0.34 : 0.28,
          dashArray: "5 4",
        }}
      >
        <Tooltip sticky>{texto}</Tooltip>
      </Polygon>
      <Polygon positions={nucleo} pathOptions={{ stroke: false, fillColor: colores.humoNucleo, fillOpacity: 0.2, interactive: false }} />
      <Polyline positions={eje} pathOptions={{ color: colores.humoNucleo, weight: 1.5, opacity: 0.7, dashArray: "2 6", interactive: false }} />
    </>
  );
}

export function MapaBaseCliente({
  centro,
  zoom = 15,
  zona,
  penacho,
  penachoEtiqueta,
  marcadores,
  interactivo = true,
  arrastrable,
  encuadre,
  className = "",
  children,
}: MapaBaseProps) {
  const { colores, oscuro } = useColoresTema();
  const origen: LatLon = [centro.lat, centro.lon];

  return (
    <div className={`atalaya-mapa relative isolate h-full min-h-0 w-full overflow-hidden ${className}`}>
      <MapContainer
        center={origen}
        zoom={zoom}
        scrollWheelZoom={interactivo}
        doubleClickZoom={interactivo}
        touchZoom={interactivo}
        boxZoom={interactivo}
        keyboard={interactivo}
        dragging={interactivo || !!arrastrable}
        className="absolute inset-0 h-full w-full"
        style={{ background: colores.background }}
        attributionControl
        zoomControl={false}
      >
        {/* Abajo a la derecha: arriba a la izquierda van los controles propios de cada mapa. */}
        {interactivo && <ZoomControl position="bottomright" zoomInTitle="Acercar" zoomOutTitle="Alejar" />}
        <TileLayer
          // Política de uso de teselas OSM: atribución obligatoria y tráfico bajo (demo).
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />
        <AjusteTamano />
        <SeguirCentro lat={centro.lat} lon={centro.lon} />
        <Encuadre limites={encuadre} />
        <PopupsEnEspanol />

        {zona?.tipo === "circulo" && (
          <Circle
            center={origen}
            radius={zona.radioM}
            pathOptions={{ color: colores.danger, weight: 1.5, fillColor: colores.danger, fillOpacity: 0.08, dashArray: "6 6" }}
          />
        )}
        {zona?.tipo === "poligono" && (
          <Polygon
            positions={zona.puntos}
            pathOptions={{ color: colores.danger, weight: 1.5, fillColor: colores.danger, fillOpacity: 0.08 }}
          />
        )}

        {penacho && <CapaPenacho origen={origen} penacho={penacho} etiqueta={penachoEtiqueta} colores={colores} oscuro={oscuro} />}

        {marcadores?.map((m) => (
          <CircleMarker
            key={m.id}
            center={[m.lat, m.lon]}
            radius={7}
            pathOptions={{ color: colores.panel, weight: 2, fillColor: colores[m.tono ?? "accent"], fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {m.etiqueta}
            </Tooltip>
          </CircleMarker>
        ))}

        {typeof children === "function" ? children(colores) : children}
      </MapContainer>
    </div>
  );
}
