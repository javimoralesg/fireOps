"use client";

// Capas de react-leaflet de la sala de periféricos. SOLO CLIENTE: se monta DENTRO
// de un <MapaBase> (components/mapa/MapaBase.tsx, que ya carga Leaflet con
// dynamic ssr:false) o dentro de MapaCiudadCliente (poc-26). Nunca se importa
// desde un módulo que se evalúe en el servidor: importa leaflet, que usa window.
//
// Sin estado global: todo entra por props tipadas y los colores salen de los
// tokens del tema (useColoresTema), para que claro y oscuro se vean igual de bien.

import { Fragment, useMemo } from "react";
import L from "leaflet";
import { CircleMarker, Marker, Polygon, Polyline, Popup, Tooltip } from "react-leaflet";
import type { AristaGrafo, EventoIngesta, NodoGrafo, TipoArista } from "@/lib/types";
import type { CamaraTrafico, Periferico, TipoPeriferico } from "@/lib/tipos-perifericos";
import { destino, formatearDistancia, rumboTexto, type LatLon } from "@/components/mapa/geo";
import { useColoresTema, type ColoresTema } from "@/components/mapa/useColoresTema";
import { uiCategoria, uiPeriferico, useReloj } from "./ui-sala";

export type CapaPeriferico = "nodos" | "aristas" | "perifericos" | "camaras" | "observaciones";

export interface CapasPerifericosProps {
  /** Vértices del grafo. Solo se pintan los que traen lat/lon. */
  nodos?: NodoGrafo[];
  /** Aristas: solo se pintan las que unen dos vértices con lat/lon. */
  aristas?: AristaGrafo[];
  perifericos?: Periferico[];
  camaras?: CamaraTrafico[];
  /** Eventos con geo (los filtra quien llama: aquí se pinta lo que llegue). */
  observaciones?: EventoIngesta[];
  /** Colores ya resueltos por el mapa. Si no se pasan, se leen del tema. */
  colores?: ColoresTema;
  /** Capas visibles. Por defecto todas. */
  capas?: Partial<Record<CapaPeriferico, boolean>>;
  /** Periférico resaltado (sincronía con el panel lateral). */
  seleccionId?: string | null;
  onSeleccionarPeriferico?: (id: string) => void;
  /** Antigüedad máxima de una observación para pintarla, en minutos. */
  minutosObservaciones?: number;
}

/** Cono de visión de una cámara con rumbo: 40° de apertura, 120 m de alcance. */
const CONO_GRADOS = 40;
const CONO_M = 120;
const PASOS_CONO = 10;

/** Cada cuánto se recalcula la antigüedad de las observaciones. */
const REFRESCO_EDAD_MS = 30_000;

type Token = keyof ColoresTema;

const TONO_NODO: Record<string, Token> = {
  Incidencia: "danger",
  Hospital: "warning",
  Residencia: "warning",
  Colegio: "warning",
  Gasolinera: "danger",
  Bomberos: "info",
  Policia: "info",
  Sanitarios: "info",
  Centro_Comunicaciones: "accent",
  Subestacion: "accent",
  Estacion: "accent",
  Ruta_Evacuacion: "success",
  Refugio: "success",
  Carretera: "muted",
};

const ETIQUETA_NODO: Record<string, string> = {
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

const ARISTA_UI: Record<TipoArista, { token: Token; dash?: string; peso: number; etiqueta: string }> = {
  BLOQUEA_A: { token: "danger", dash: "5 5", peso: 2.2, etiqueta: "bloquea" },
  SUMINISTRA_A: { token: "muted", peso: 1.4, etiqueta: "suministra a" },
  DESPLEGADO_EN: { token: "accent", dash: "2 4", peso: 1.8, etiqueta: "desplegado en" },
};

const TONO_PERIFERICO: Record<TipoPeriferico, Token> = {
  movil_ciudadano: "accent",
  camara_fija: "warning",
  efectivo: "info",
  pma: "info",
  camara_trafico: "warning",
  sensor: "muted",
  webhook: "muted",
};

const radioNodo = (tipo: string) => (tipo === "Incidencia" ? 8 : tipo === "Carretera" ? 4 : 6);

const tieneGeo = (n: NodoGrafo): n is NodoGrafo & { lat: number; lon: number } =>
  typeof n.lat === "number" && typeof n.lon === "number";

function conoDeRumbo(origen: LatLon, rumboGrados: number): LatLon[] {
  const puntos: LatLon[] = [origen];
  const medio = CONO_GRADOS / 2;
  for (let i = 0; i <= PASOS_CONO; i++) {
    puntos.push(destino(origen, rumboGrados - medio + (CONO_GRADOS * i) / PASOS_CONO, CONO_M));
  }
  return puntos;
}

export function CapasPerifericos({
  nodos = [],
  aristas = [],
  perifericos = [],
  camaras = [],
  observaciones = [],
  colores,
  capas,
  seleccionId = null,
  onSeleccionarPeriferico,
  minutosObservaciones = 30,
}: CapasPerifericosProps) {
  const { colores: coloresTema } = useColoresTema();
  const c = colores ?? coloresTema;
  const ver = (capa: CapaPeriferico) => capas?.[capa] !== false;

  const conGeo = useMemo(() => nodos.filter(tieneGeo), [nodos]);
  const porId = useMemo(() => new Map(conGeo.map((n) => [n.id, n])), [conGeo]);

  const iconoCamara = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: '<span style="display:block;width:11px;height:11px;border-radius:2px;background:var(--warning);border:1.5px solid var(--panel);box-shadow:0 1px 3px rgb(0 0 0 / .35)"></span>',
        iconSize: [11, 11],
        iconAnchor: [5.5, 5.5],
      }),
    [],
  );

  // Reloj a saltos de 30 s: las observaciones se apagan solas sin repintar el mapa cada tick.
  const ahora = useReloj(REFRESCO_EDAD_MS);
  const recientes = useMemo(
    () =>
      observaciones.filter((ev) => {
        if (!ev.geo) return false;
        const t = Date.parse(ev.timestamp);
        return Number.isNaN(t) || ahora - t <= minutosObservaciones * 60_000;
      }),
    [observaciones, ahora, minutosObservaciones],
  );

  return (
    <>
      {/* Aristas debajo de todo lo demás */}
      {ver("aristas") &&
        aristas.map((a, i) => {
          const desde = porId.get(a.from);
          const hasta = porId.get(a.to);
          if (!desde || !hasta) return null;
          const ui = ARISTA_UI[a.tipo] ?? ARISTA_UI.SUMINISTRA_A;
          return (
            <Polyline
              key={`${a.from}-${a.to}-${a.tipo}-${i}`}
              positions={[
                [desde.lat, desde.lon],
                [hasta.lat, hasta.lon],
              ]}
              pathOptions={{ color: c[ui.token], weight: ui.peso, opacity: 0.75, dashArray: ui.dash }}
            >
              <Tooltip sticky>
                {desde.nombre} <strong>{ui.etiqueta}</strong> {hasta.nombre}
              </Tooltip>
            </Polyline>
          );
        })}

      {/* Vértices del grafo real */}
      {ver("nodos") &&
        conGeo.map((n) => {
          const token = TONO_NODO[n.tipo] ?? "muted";
          const esIncidencia = n.tipo === "Incidencia";
          return (
            <Fragment key={n.id}>
              {esIncidencia && (
                // Anillo pulsante: la animación .pulse-ring de app/globals.css se aplica
                // al <path> que dibuja Leaflet mediante pathOptions.className.
                <CircleMarker
                  center={[n.lat, n.lon]}
                  radius={radioNodo(n.tipo)}
                  pathOptions={{
                    className: "pulse-ring",
                    color: c.danger,
                    weight: 2,
                    fill: false,
                    interactive: false,
                  }}
                />
              )}
              <CircleMarker
                center={[n.lat, n.lon]}
                radius={radioNodo(n.tipo)}
                pathOptions={{ color: c.panel, weight: 1.5, fillColor: c[token], fillOpacity: 0.95 }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  <strong>{n.nombre}</strong>
                  <br />
                  {ETIQUETA_NODO[n.tipo] ?? n.tipo}
                  {n.subtipo ? ` · ${n.subtipo}` : ""}
                  {n.detalle ? (
                    <>
                      <br />
                      {n.detalle}
                    </>
                  ) : null}
                </Tooltip>
              </CircleMarker>
            </Fragment>
          );
        })}

      {/* Cámaras municipales: cuadradito, la imagen en el popup */}
      {ver("camaras") &&
        camaras.map((cam) => (
          <Marker key={`cam-${cam.id}`} position={[cam.lat, cam.lon]} icon={iconoCamara}>
            <Tooltip direction="top" offset={[0, -6]}>
              <strong>{cam.nombre}</strong>
              <br />
              Cámara de tráfico · {formatearDistancia(cam.distanciaM)}
            </Tooltip>
            <Popup>
              <div style={{ width: 220 }}>
                <strong>{cam.nombre}</strong>
                {/* eslint-disable-next-line @next/next/no-img-element -- JPEG en vivo del Ayuntamiento dentro de un popup de Leaflet */}
                <img
                  src={cam.imagenUrl}
                  alt={`Cámara de tráfico ${cam.nombre}`}
                  style={{ display: "block", width: "100%", marginTop: 6, borderRadius: 6 }}
                />
                <span style={{ display: "block", marginTop: 4, fontSize: 11 }}>
                  {formatearDistancia(cam.distanciaM)} del incidente · informo.madrid.es
                </span>
              </div>
            </Popup>
          </Marker>
        ))}

      {/* Periféricos emparejados, con cono de rumbo si la brújula da datos */}
      {ver("perifericos") &&
        perifericos.map((p) => {
          if (!p.posicion) return null;
          const token = TONO_PERIFERICO[p.tipo] ?? "accent";
          const centro: LatLon = [p.posicion.lat, p.posicion.lon];
          const rumbo = p.posicion.rumboGrados;
          const activo = seleccionId === p.id;
          return (
            <Fragment key={`per-${p.id}`}>
              {typeof rumbo === "number" && (
                <Polygon
                  positions={conoDeRumbo(centro, rumbo)}
                  pathOptions={{ color: c[token], weight: 1, opacity: 0.5, fillColor: c[token], fillOpacity: 0.16, interactive: false }}
                />
              )}
              <CircleMarker
                center={centro}
                radius={activo ? 9 : 7}
                pathOptions={{
                  color: activo ? c.foreground : c.panel,
                  weight: activo ? 3 : 2,
                  fillColor: c[token],
                  fillOpacity: p.enLinea ? 1 : 0.35,
                }}
                eventHandlers={onSeleccionarPeriferico ? { click: () => onSeleccionarPeriferico(p.id) } : undefined}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  <strong>{p.nombre}</strong>
                  <br />
                  {uiPeriferico(p.tipo).etiqueta} · {p.enLinea ? "en línea" : "fuera de línea"}
                  {typeof rumbo === "number" ? ` · mira al ${rumboTexto(rumbo)}` : ""}
                  {p.ultimaObservacion ? (
                    <>
                      <br />
                      {p.ultimaObservacion.resumen}
                    </>
                  ) : null}
                </Tooltip>
              </CircleMarker>
            </Fragment>
          );
        })}

      {/* Observaciones recientes con posición: se apagan con la edad */}
      {ver("observaciones") &&
        recientes.map((ev) => {
          if (!ev.geo) return null;
          const ui = uiCategoria(ev.categoria);
          const t = Date.parse(ev.timestamp);
          const edad = Number.isNaN(t) ? 0 : Math.min(1, Math.max(0, (ahora - t) / (minutosObservaciones * 60_000)));
          const opacidad = 0.85 - 0.6 * edad;
          return (
            <CircleMarker
              key={`obs-${ev.id}`}
              center={[ev.geo.lat, ev.geo.lon]}
              radius={5}
              pathOptions={{ color: c[ui.tono], weight: 1.5, fillColor: c[ui.tono], fillOpacity: opacidad, opacity: opacidad + 0.15 }}
            >
              <Tooltip direction="top" offset={[0, -4]}>
                <strong>{ev.titulo}</strong>
                <br />
                {ui.etiqueta} · {Math.round(ev.confianza * 100)} %
              </Tooltip>
            </CircleMarker>
          );
        })}
    </>
  );
}
