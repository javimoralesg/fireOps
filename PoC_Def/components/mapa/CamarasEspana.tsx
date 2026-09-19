"use client";
// =====================================================================
// Capa "Cámaras de España": las ~2.300 cámaras públicas del catálogo
// (DGT + Ayuntamiento de Madrid), no solo las vigiladas de un foco.
// DUEÑO: constructor H.
// ---------------------------------------------------------------------
// Por qué es imperativa y no react-leaflet: 2.300 componentes React con
// su Marker y su Popup hunden el hilo principal en cada repintado. Aquí
// se dibujan como `L.circleMarker` sobre un renderizador de canvas
// propio, se recortan al encuadre visible, se agrupan por celda de 0,5°
// mientras el zoom es menor que 8 y se construyen en lotes con
// requestAnimationFrame para no bloquear la interfaz.
//
// El popup NO vive aquí: al pulsar una cámara se avisa al mapa, que
// abre la ficha de React (imagen en vivo + "Vigilar esta cámara").
// =====================================================================

import { useEffect, useRef } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import type { Camara } from "@/lib/dominio/tipos";
import { marcadorCuentaHtml } from "./simbologia";
import type { ColoresTema } from "./useColoresTema";

/** A partir de este zoom se pintan cámaras sueltas; por debajo, agrupadas. */
const ZOOM_DETALLE = 8;
/** Lado de la celda de agrupación, en grados. */
const CELDA_GRADOS = 0.5;
/** Tope duro de marcadores en el canvas (rendimiento). */
const MAXIMO_MARCADORES = 2500;
/** Cuántos marcadores se añaden por fotograma. */
const LOTE = 350;

interface Props {
  /** Catálogo completo (sin análisis). */
  camaras: Camara[];
  /** Ids de las cámaras que ya pinta la capa de vigiladas: aquí se omiten. */
  vigiladasIds: Set<string>;
  colores: ColoresTema;
  onSeleccionar: (camara: Camara) => void;
}

const clave = (c: Camara) => `${Math.floor(c.punto.lat / CELDA_GRADOS)}:${Math.floor(c.punto.lon / CELDA_GRADOS)}`;

export function CapaCamarasEspana({ camaras, vigiladasIds, colores, onSeleccionar }: Props) {
  const map = useMap();
  // Todo lo que cambia a menudo va por referencia: así el efecto se monta una
  // sola vez por mapa y los manejadores siempre leen lo último.
  const datos = useRef({ camaras, vigiladasIds, colores, onSeleccionar });
  datos.current = { camaras, vigiladasIds, colores, onSeleccionar };

  useEffect(() => {
    const renderizador = L.canvas({ padding: 0.3 });
    const grupo = L.layerGroup([], { pane: "markerPane" }).addTo(map);
    let cuadro = 0;
    let vivo = true;

    const construir = () => {
      const { camaras: lista, vigiladasIds: vistas, colores: c, onSeleccionar: alPulsar } = datos.current;
      cancelAnimationFrame(cuadro);
      grupo.clearLayers();
      if (!lista.length) return;

      const zoom = map.getZoom();
      const limites = map.getBounds().pad(0.25);
      const visibles = lista.filter((cam) => !vistas.has(cam.id) && limites.contains([cam.punto.lat, cam.punto.lon]));

      // --- Zoom bajo: una pastilla con la cuenta por celda de 0,5° ----------
      if (zoom < ZOOM_DETALLE) {
        const celdas = new Map<string, { suma: [number, number]; cuenta: number; muestra: Camara }>();
        for (const cam of visibles) {
          const k = clave(cam);
          const celda = celdas.get(k);
          if (celda) {
            celda.suma[0] += cam.punto.lat;
            celda.suma[1] += cam.punto.lon;
            celda.cuenta += 1;
          } else {
            celdas.set(k, { suma: [cam.punto.lat, cam.punto.lon], cuenta: 1, muestra: cam });
          }
        }
        for (const { suma, cuenta, muestra } of celdas.values()) {
          const centro: [number, number] = [suma[0] / cuenta, suma[1] / cuenta];
          if (cuenta === 1) {
            grupo.addLayer(puntoCamara(muestra, c, renderizador, alPulsar));
            continue;
          }
          const marca = L.marker(centro, {
            icon: L.divIcon({
              className: "icono-atalaya camara-espana-grupo",
              html: marcadorCuentaHtml({ cuenta, color: c.info, fondo: c.panel, tamano: 22 }),
              iconSize: [34, 22],
              iconAnchor: [17, 11],
            }),
            keyboard: false,
            interactive: true,
          });
          marca.bindTooltip(`${cuenta} cámaras de tráfico · acerca el mapa para verlas`, { direction: "top" });
          marca.on("click", () => map.setView(centro, Math.max(ZOOM_DETALLE, map.getZoom() + 2), { animate: true }));
          grupo.addLayer(marca);
        }
        return;
      }

      // --- Zoom alto: cámaras sueltas, por lotes y con tope ------------------
      const recorte = visibles.slice(0, MAXIMO_MARCADORES);
      let i = 0;
      const siguienteLote = () => {
        if (!vivo) return;
        const fin = Math.min(i + LOTE, recorte.length);
        for (; i < fin; i += 1) grupo.addLayer(puntoCamara(recorte[i], c, renderizador, alPulsar));
        if (i < recorte.length) cuadro = requestAnimationFrame(siguienteLote);
      };
      siguienteLote();
    };

    construir();
    map.on("moveend zoomend", construir);
    return () => {
      vivo = false;
      cancelAnimationFrame(cuadro);
      map.off("moveend zoomend", construir);
      grupo.clearLayers();
      map.removeLayer(grupo);
    };
  }, [map]);

  // El efecto de arriba solo se monta una vez; cuando cambian el catálogo o el
  // tema hay que repintar a mano (un `fire` de moveend lo hace sin duplicar
  // lógica y sin mover el mapa).
  useEffect(() => {
    map.fire("moveend");
  }, [map, camaras, colores, vigiladasIds]);

  return null;
}

/** Un punto de cámara sobre el canvas, con su etiqueta y su clic. */
function puntoCamara(
  camara: Camara,
  colores: ColoresTema,
  renderizador: L.Canvas,
  onSeleccionar: (c: Camara) => void,
): L.CircleMarker {
  const color = camara.fuente === "Madrid" ? colores.brand : colores.info;
  const punto = L.circleMarker([camara.punto.lat, camara.punto.lon], {
    renderer: renderizador,
    radius: 3.5,
    weight: 1,
    color,
    opacity: 0.85,
    fillColor: color,
    fillOpacity: 0.55,
    interactive: true,
    bubblingMouseEvents: false,
  });
  punto.bindTooltip(`${camara.nombre} · cámara ${camara.fuente}`, { direction: "top", offset: [0, -4] });
  punto.on("click", () => onSeleccionar(camara));
  punto.on("mouseover", () => punto.setStyle({ radius: 6, fillOpacity: 0.95 }));
  punto.on("mouseout", () => punto.setStyle({ radius: 3.5, fillOpacity: 0.55 }));
  return punto;
}
