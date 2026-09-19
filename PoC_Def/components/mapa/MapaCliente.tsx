"use client";
// Mapa de situación de la sala de mando. SOLO CLIENTE (Leaflet usa `window`):
// se carga desde components/mapa/Mapa.tsx con dynamic(..., { ssr: false }).
// DUEÑO: constructor E. Dependencias: leaflet, react-leaflet, lucide-react.
//
// Capas: focos (perímetro + predicción), unidades (con ruta y movimiento suave),
// bases de las que salen, pueblos por riesgo, hospitales, cámaras vigiladas,
// TODAS las cámaras de España, viento (rejilla calculada aquí a partir de la
// meteo del foco) y satélite.
//
// AMPLIADO (constructor H, 2026-09-19): capa "Cámaras de España", iconos de
// unidad por cuerpo con ruta recorrida y flecha de sentido, capa "Bases",
// focos "detectado" en hueco con confirmar/descartar y control de viento.

import "leaflet/dist/leaflet.css";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
  ZoomControl,
} from "react-leaflet";
import { Flame, MapPin, Maximize2, Megaphone, Navigation, TriangleAlert } from "lucide-react";
import type { Camara, Incendio, Poblacion, Punto, Snapshot, Unidad } from "@/lib/dominio/tipos";
import { LIMITES_ESPANA, aLatLng, circulo, destino as puntoDestino, flechaViento, interpolar, limitesDe, partirRuta, rejillaViento } from "./geo";
import {
  CONTORNOS,
  ICONO_UNIDAD,
  LEYENDA_UNIDAD,
  TEXTO_TIPO_UNIDAD,
  colorIncendio,
  colorRiesgo,
  colorUnidad,
  marcadorCuentaHtml,
  marcadorHtml,
  radioRiesgoM,
} from "./simbologia";
import { useColoresTema, type ColoresTema } from "./useColoresTema";
import { PanelCapas, Leyenda, type ClaveCapa, type FilaCapa } from "./PanelCapas";
import { PopupCamara } from "./PopupCamara";
import { CapaCamarasEspana } from "./CamarasEspana";
import { useCamarasEspana } from "./useCamarasEspana";
import { FichaUnidad, type AccionesUnidad } from "./FichaUnidad";
import { zonasPeligroDe } from "./extras";
import { distancia, haceCuanto, hectareas, minutos, numero, rumboFrase, viento } from "@/lib/cliente/formato";
import { urlOsm, urlOsmPunto } from "@/lib/cliente/enlaces";
import { conModificadores, escribiendo } from "@/lib/cliente/teclado";
import { EnlaceExterno } from "@/components/ui/Enlace";
import { Boton } from "@/components/ui/Boton";
import { Desplegable } from "@/components/ui/Desplegable";
import { ControlViento } from "@/components/sala/ControlViento";
import {
  AvisoSinConfirmar,
  BarraContencion,
  EnlaceFuenteFoco,
  EnlaceMeteo,
  InsigniaVientoForzado,
  MediosExternos,
  NotaDelMando,
  SegunLaFuente,
  fraseConfianza,
  poblacionesEnPeligro,
  sinConfirmar,
} from "@/components/sala/DetalleFoco";
import {
  Insignia,
  TEXTO_ESTADO_INCENDIO,
  TEXTO_ESTADO_UNIDAD,
  TEXTO_PELIGRO,
  TEXTO_RIESGO,
  tonoEstadoIncendio,
  tonoRiesgo,
} from "@/components/ui/Insignia";

const CLAVE_CAPAS = "atalaya:capas";
/** Si el usuario ha movido el mapa hace menos de esto, no se le roba el control. */
const RESPETO_USUARIO_MS = 20_000;
/** Duración de la animación de una unidad entre dos snapshots. */
const ANIMACION_MS = 1400;
/** Cuántos pueblos llevan el nombre siempre visible (el resto, al pasar el ratón). */
const MAX_ETIQUETAS_PUEBLOS = 8;

const CAPAS_POR_DEFECTO: Record<ClaveCapa, boolean> = {
  focos: true,
  prediccion: true,
  unidades: true,
  bases: true,
  pueblos: true,
  hospitales: false,
  camaras: true,
  camarasEspana: true,
  viento: true,
  satelite: false,
};

export interface MapaProps {
  snapshot?: Snapshot;
  /** Foco resaltado (desde la pestaña "Focos"). */
  incendioSeleccionado?: string;
  onSeleccionarIncendio?: (id: string) => void;
  /** Modo "declarar foco": el cursor pasa a cruz y el clic devuelve coordenadas. */
  modoDeclarar?: boolean;
  onClicMapa?: (punto: Punto) => void;
  onAvisarPoblacion?: (poblacion: Poblacion) => void | Promise<void>;
  onVigilarCamara?: (id: string, vigilar: boolean) => void | Promise<void>;
  /** Petición externa de encuadre: cambia el `sello` para que se aplique. */
  centrarEn?: { lat: number; lon: number; sello: number; zoom?: number };
  /** Unidad a la que se le está eligiendo destino: el próximo clic lo fija. */
  unidadOrdenando?: Unidad;
  /** Pide entrar en ese modo desde la ficha de una unidad. */
  onOrdenarUnidad?: (u: Unidad) => void;
  onRetirarUnidad?: (u: Unidad) => void | Promise<void>;
  /** Confirmar o descartar un foco todavía sin confirmar. */
  onCambiarEstadoFoco?: (id: string, estado: "confirmado" | "descartado") => void | Promise<void>;
  /** Tras fijar o quitar el viento de un foco. */
  onRefrescar?: () => void;
  /** Contenido extra que se superpone al mapa (banda de conexión, etc.). */
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Ayudantes de mapa
// ---------------------------------------------------------------------------

/** Marca cuándo el usuario ha movido el mapa a mano. */
function DetectorGestos({ alMover }: { alMover: () => void }) {
  useMapEvents({
    dragstart: alMover,
    zoomstart: alMover,
    mousedown: alMover,
  });
  return null;
}

function CapturaClic({ activo, onClic }: { activo: boolean; onClic?: (p: Punto) => void }) {
  useMapEvents({
    click: (e) => {
      if (activo && onClic) onClic({ lat: e.latlng.lat, lon: e.latlng.lng });
    },
  });
  return null;
}

/** invalidateSize() cuando el contenedor cambia de tamaño (panel que se pliega). */
function AjusteTamano() {
  const map = useMap();
  useEffect(() => {
    const contenedor = map.getContainer();
    let cuadro = 0;
    const obs = new ResizeObserver(() => {
      cancelAnimationFrame(cuadro);
      cuadro = requestAnimationFrame(() => map.invalidateSize({ debounceMoveend: true }));
    });
    obs.observe(contenedor);
    return () => {
      obs.disconnect();
      cancelAnimationFrame(cuadro);
    };
  }, [map]);
  return null;
}

/** Cursor de cruz mientras se declara un foco. */
function CursorDeclarar({ activo }: { activo: boolean }) {
  const map = useMap();
  useEffect(() => {
    const c = map.getContainer();
    c.classList.toggle("mapa-declarando", activo);
    return () => c.classList.remove("mapa-declarando");
  }, [map, activo]);
  return null;
}

/**
 * Encuadre AUTOMÁTICO: España al inicio y a los focos activos en cuanto aparece
 * el primero; más lo que pida el panel derecho ("Centrar en el mapa"). El
 * encuadre automático nunca mueve el mapa si el usuario lo ha tocado en los
 * últimos 20 s; el botón "Ver todo" NO pasa por aquí (es imperativo, en
 * `encuadrarTodo`) justamente para que siempre obedezca.
 */
function Encuadre({
  limitesFocos,
  centrarEn,
  ultimoGesto,
}: {
  limitesFocos: [[number, number], [number, number]] | null;
  centrarEn?: { lat: number; lon: number; sello: number; zoom?: number };
  ultimoGesto: React.RefObject<number>;
}) {
  const map = useMap();
  const yaEncuadrado = useRef(false);
  const selloCentrar = useRef(-1);

  // Primer foco: encuadre automático (una sola vez, y solo si el usuario no manda).
  useEffect(() => {
    if (!limitesFocos || yaEncuadrado.current) return;
    if (Date.now() - ultimoGesto.current < RESPETO_USUARIO_MS) return;
    yaEncuadrado.current = true;
    map.fitBounds(limitesFocos, { padding: [60, 60], maxZoom: 12 });
  }, [map, limitesFocos, ultimoGesto]);

  // "Centrar en el mapa" desde una tarjeta: manda siempre, aunque el usuario
  // acabe de arrastrar el mapa (lo ha pedido él mismo desde la ficha).
  useEffect(() => {
    if (!centrarEn || centrarEn.sello === selloCentrar.current) return;
    selloCentrar.current = centrarEn.sello;
    map.stop();
    map.setView([centrarEn.lat, centrarEn.lon], centrarEn.zoom ?? Math.max(map.getZoom(), 12), { animate: true });
  }, [map, centrarEn]);

  return null;
}

/**
 * Posiciones interpoladas de las unidades para que no "salten" entre snapshots.
 * Solo anima cuando alguna unidad se ha movido de verdad, y a ~20 fotogramas por
 * segundo: repintar el mapa entero a 60 fps con decenas de capas no compensa.
 */
function usePosicionesAnimadas(unidades: Unidad[]): Record<string, [number, number]> {
  const [posiciones, setPosiciones] = useState<Record<string, [number, number]>>({});
  const origen = useRef<Record<string, [number, number]>>({});
  const destinoRef = useRef<Record<string, [number, number]>>({});
  const actuales = useRef<Record<string, [number, number]>>({});

  useEffect(() => {
    const nuevoDestino: Record<string, [number, number]> = {};
    for (const u of unidades) nuevoDestino[u.id] = [u.posicion.lat, u.posicion.lon];

    const anterior = destinoRef.current;
    const mismosIds =
      Object.keys(anterior).length === Object.keys(nuevoDestino).length &&
      Object.keys(nuevoDestino).every((id) => anterior[id] !== undefined);
    const seMueve = Object.keys(nuevoDestino).some(
      (id) => !anterior[id] || Math.abs(anterior[id][0] - nuevoDestino[id][0]) > 1e-7 || Math.abs(anterior[id][1] - nuevoDestino[id][1]) > 1e-7,
    );
    destinoRef.current = nuevoDestino;

    if (!seMueve && mismosIds) return; // nada se ha movido: no repintamos

    const nuevoOrigen: Record<string, [number, number]> = {};
    for (const id of Object.keys(nuevoDestino)) nuevoOrigen[id] = actuales.current[id] ?? anterior[id] ?? nuevoDestino[id];
    origen.current = nuevoOrigen;

    const inicio = performance.now();
    let temporizador: ReturnType<typeof setInterval> | null = null;

    const paso = () => {
      const k = Math.min(1, (performance.now() - inicio) / ANIMACION_MS);
      const salida: Record<string, [number, number]> = {};
      for (const id of Object.keys(destinoRef.current)) {
        salida[id] = interpolar(origen.current[id] ?? destinoRef.current[id], destinoRef.current[id], k);
      }
      actuales.current = salida;
      setPosiciones(salida);
      if (k >= 1 && temporizador) {
        clearInterval(temporizador);
        temporizador = null;
      }
    };

    paso();
    temporizador = setInterval(paso, 50);
    return () => {
      if (temporizador) clearInterval(temporizador);
    };
  }, [unidades]);

  return posiciones;
}

// ---------------------------------------------------------------------------
// Capas
// ---------------------------------------------------------------------------

function CapaFocos({
  incendios,
  poblaciones,
  colores,
  seleccionado,
  onSeleccionar,
  conPrediccion,
  onCambiarEstadoFoco,
  onRefrescar,
}: {
  incendios: Incendio[];
  poblaciones: Poblacion[];
  colores: ColoresTema;
  seleccionado?: string;
  onSeleccionar?: (id: string) => void;
  conPrediccion: boolean;
  onCambiarEstadoFoco?: (id: string, estado: "confirmado" | "descartado") => void | Promise<void>;
  onRefrescar?: () => void;
}) {
  return (
    <>
      {incendios.map((inc) => {
        const color = colores[colorIncendio(inc.estado)];
        const porConfirmar = sinConfirmar(inc);
        const perimetro = inc.perimetro?.length >= 3 ? inc.perimetro : circulo(inc.centro, Math.max(220, Math.sqrt((inc.areaHa || 1) * 10_000 / Math.PI)));
        const resaltado = seleccionado === inc.id;
        const icono = L.divIcon({
          className: "icono-atalaya",
          html: marcadorHtml({
            contorno: porConfirmar ? CONTORNOS.interrogacion : CONTORNOS.llama,
            color: porConfirmar ? colores.warning : color,
            fondo: colores.panel,
            etiqueta: porConfirmar ? `${inc.nombre} · Sin confirmar` : inc.nombre,
            anillo: resaltado,
            pulso: resaltado,
            hueco: porConfirmar,
            tamano: 34,
          }),
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });
        return (
          <Fragment key={inc.id}>
            {conPrediccion && inc.prediccion ? (
              <>
                {inc.prediccion.en6h?.length >= 3 ? (
                  <Polygon positions={inc.prediccion.en6h} pathOptions={{ color, weight: 1, opacity: 0.4, dashArray: "3 7", fillColor: color, fillOpacity: 0.05, interactive: false }} />
                ) : null}
                {inc.prediccion.en3h?.length >= 3 ? (
                  <Polygon positions={inc.prediccion.en3h} pathOptions={{ color, weight: 1.2, opacity: 0.55, dashArray: "4 6", fillColor: color, fillOpacity: 0.08, interactive: false }} />
                ) : null}
                {inc.prediccion.en1h?.length >= 3 ? (
                  <Polygon positions={inc.prediccion.en1h} pathOptions={{ color, weight: 1.5, opacity: 0.75, dashArray: "6 5", fillColor: color, fillOpacity: 0.12, interactive: false }}>
                    <Tooltip sticky>Perímetro previsto a +1 h · {inc.prediccion.explicacion}</Tooltip>
                  </Polygon>
                ) : null}
              </>
            ) : null}

            <Polygon
              positions={perimetro}
              pathOptions={{
                color: porConfirmar ? colores.warning : color,
                weight: resaltado ? 3.5 : 2.4,
                opacity: 0.95,
                dashArray: porConfirmar ? "7 6" : undefined,
                fillColor: porConfirmar ? colores.warning : color,
                fillOpacity: porConfirmar ? 0.06 : colores.oscuro ? 0.3 : 0.24,
              }}
              eventHandlers={{ click: () => onSeleccionar?.(inc.id) }}
            >
              <Tooltip sticky>
                {inc.nombre} · {porConfirmar ? "Sin confirmar" : TEXTO_ESTADO_INCENDIO[inc.estado]} · {hectareas(inc.areaHa)}
                {inc.contencion ? ` · ${numero((inc.contencion.fraccion ?? 0) * 100)} % de perímetro controlado` : ""}
              </Tooltip>
            </Polygon>

            {/* Línea de control ya construida: tramo del perímetro proporcional a
                `contencion.fraccion`, en negro discontinuo sobre el perímetro. */}
            {inc.contencion && inc.contencion.fraccion > 0 ? <LineaControl perimetro={perimetro} fraccion={inc.contencion.fraccion} colores={colores} /> : null}

            <Marker position={aLatLng(inc.centro)} icon={icono} eventHandlers={{ click: () => onSeleccionar?.(inc.id) }}>
              <Popup minWidth={280} maxHeight={460}>
                <FichaFocoMapa
                  incendio={inc}
                  poblaciones={poblaciones.filter((p) => p.incendioId === inc.id)}
                  onCambiarEstado={onCambiarEstadoFoco}
                  onRefrescar={onRefrescar}
                />
              </Popup>
            </Marker>
          </Fragment>
        );
      })}
    </>
  );
}

/** Tramo de perímetro ya controlado (línea construida), en negro discontinuo. */
function LineaControl({ perimetro, fraccion, colores }: { perimetro: [number, number][]; fraccion: number; colores: ColoresTema }) {
  const tramo = useMemo(() => {
    if (perimetro.length < 3) return null;
    const anillo: [number, number][] = [...perimetro, perimetro[0]];
    const { recorrido } = partirRuta(anillo, Math.max(0, Math.min(1, fraccion)));
    return recorrido.length >= 2 ? recorrido : null;
  }, [perimetro, fraccion]);
  if (!tramo) return null;
  return (
    <Polyline
      positions={tramo}
      pathOptions={{ color: colores.oscuro ? colores.texto : "#111827", weight: 4, opacity: 0.9, dashArray: "9 5", interactive: false }}
    >
      <Tooltip sticky>Línea de control construida · {numero(fraccion * 100)} % del perímetro</Tooltip>
    </Polyline>
  );
}

/** Ficha del foco dentro del popup del mapa (y puerta al visor de incidencia). */
function FichaFocoMapa({
  incendio: inc,
  poblaciones,
  onCambiarEstado,
  onRefrescar,
}: {
  incendio: Incendio;
  poblaciones: Poblacion[];
  onCambiarEstado?: (id: string, estado: "confirmado" | "descartado") => void | Promise<void>;
  onRefrescar?: () => void;
}) {
  const [ocupado, setOcupado] = useState<"confirmado" | "descartado" | null>(null);
  const porConfirmar = sinConfirmar(inc);
  const enPeligro = poblacionesEnPeligro(poblaciones);

  async function cambiar(estado: "confirmado" | "descartado") {
    if (!onCambiarEstado) return;
    setOcupado(estado);
    try {
      await onCambiarEstado(inc.id, estado);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="w-[17.5rem] max-w-full">
      <p className="text-[13px] font-semibold leading-tight text-foreground">{inc.nombre}</p>
      <p className="mt-0.5 text-[11px] text-muted">
        {inc.municipio || "Municipio por determinar"}
        {inc.provincia ? ` · ${inc.provincia}` : ""}
      </p>

      <div className="mt-1.5 flex flex-wrap gap-1">
        <Insignia pequena tono={porConfirmar ? "aviso" : tonoEstadoIncendio(inc.estado)} punto>
          {porConfirmar ? "Sin confirmar" : TEXTO_ESTADO_INCENDIO[inc.estado]}
        </Insignia>
        <Insignia pequena tono="neutro">Nivel {inc.nivelGravedad}</Insignia>
        <Insignia pequena tono="neutro">{hectareas(inc.areaHa)}</Insignia>
        {inc.peligro ? (
          <Insignia pequena tono={inc.peligro.nivel === "extremo" || inc.peligro.nivel === "muy_alto" ? "peligro" : "aviso"}>
            {TEXTO_PELIGRO[inc.peligro.nivel]}
          </Insignia>
        ) : null}
        <InsigniaVientoForzado incendio={inc} />
      </div>
      <p className="mt-1 text-[11px] leading-snug text-subtle">{fraseConfianza(inc)}</p>

      <AvisoSinConfirmar incendio={inc} />
      <SegunLaFuente incendio={inc} />
      {/* Foco con URL pero sin resumen de fuente: el enlace no se pierde. */}
      {inc.fuenteUrl && !inc.resumenFuente ? (
        <p className="mt-1.5">
          <EnlaceFuenteFoco incendio={inc} />
        </p>
      ) : null}
      <NotaDelMando incendio={inc} />

      {inc.frente ? (
        <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
          Frente {rumboFrase(inc.frente.rumboGrados, inc.frente.rumboTexto)} a {numero(inc.frente.velocidadMmin, 1)} m/min.
        </p>
      ) : null}
      {inc.meteo ? (
        <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
          Viento {viento(inc.meteo.direccionGrados, inc.meteo.vientoKmh, inc.meteo.rachasKmh, inc.meteo.direccionTexto)} ·{" "}
          {numero(inc.meteo.temperaturaC, 0)} °C · {numero(inc.meteo.humedadPct, 0)} % HR <EnlaceMeteo incendio={inc} />
        </p>
      ) : null}
      {poblaciones.length > 0 ? (
        <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
          {enPeligro.length} pueblo(s) en peligro <span className="text-subtle">de {poblaciones.length} en el radio</span>
        </p>
      ) : null}
      <MediosExternos incendio={inc} />
      <BarraContencion incendio={inc} />

      <div className="mt-2 flex flex-wrap gap-1.5">
        <a
          href={`/incidencias/${encodeURIComponent(inc.id)}`}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-brand bg-brand/10 px-2.5 text-[12.5px] font-semibold text-brand hover:bg-brand/20"
        >
          <Flame className="size-3.5" aria-hidden /> Abrir incidencia
        </a>
        {porConfirmar && onCambiarEstado ? (
          <>
            <Boton tamano="sm" variante="primario" cargando={ocupado === "confirmado"} onClick={() => cambiar("confirmado")}>
              Confirmar foco
            </Boton>
            <Boton tamano="sm" variante="peligro" cargando={ocupado === "descartado"} onClick={() => cambiar("descartado")}>
              Descartar
            </Boton>
          </>
        ) : null}
      </div>

      <Desplegable className="mt-2" titulo="Viento (ejercicio)">
        <ControlViento
          focoId={inc.id}
          compacto
          inicial={
            inc.meteoForzada ?? (inc.meteo ? { direccionGrados: inc.meteo.direccionGrados, vientoKmh: inc.meteo.vientoKmh } : undefined)
          }
          forzado={inc.meteoForzada}
          onCambio={onRefrescar}
        />
      </Desplegable>
    </div>
  );
}

/**
 * Unidades: un icono por cuerpo (camión rojo bomberos, verde forestales, azul
 * Guardia Civil/Policía, blanco y rojo ambulancia, naranja Protección Civil,
 * amarillo maquinaria), la ruta REAL de OSRM con el tramo ya recorrido más
 * grueso, flecha de sentido, anillo en intervención e icono atenuado en base.
 */
function CapaUnidades({
  unidades,
  incendios,
  colores,
  posiciones,
  acciones,
}: {
  unidades: Unidad[];
  incendios: Incendio[];
  colores: ColoresTema;
  posiciones: Record<string, [number, number]>;
  acciones: AccionesUnidad;
}) {
  return (
    <>
      {unidades.map((u) => {
        const color = colorUnidad(u.tipo, colores);
        const enRuta = u.estado === "en_ruta" || u.estado === "regreso";
        const enBase = u.estado === "disponible" || u.estado === "fuera_servicio";
        const partes = enRuta && u.ruta?.coords?.length ? partirRuta(u.ruta.coords, u.ruta.progreso ?? 0) : null;
        const icono = L.divIcon({
          className: "icono-atalaya",
          html: marcadorHtml({
            contorno: CONTORNOS[ICONO_UNIDAD[u.tipo]] ?? CONTORNOS.camion,
            color,
            fondo: colores.panel,
            etiqueta: enRuta || u.estado === "en_intervencion" ? u.nombre.split("·").pop()?.trim() : undefined,
            anillo: enRuta || u.estado === "en_intervencion",
            pulso: enRuta,
            atenuado: enBase,
            flechaGrados: partes?.rumboGrados ?? undefined,
            tamano: enBase ? 20 : 28,
          }),
          iconSize: enBase ? [20, 20] : [28, 28],
          iconAnchor: enBase ? [10, 10] : [14, 14],
        });
        const posicion = posiciones[u.id] ?? [u.posicion.lat, u.posicion.lon];
        const incendio = incendios.find((i) => i.id === u.incendioId);
        return (
          <Fragment key={u.id}>
            {partes ? (
              <>
                {/* Lo que queda por recorrer: fino y discontinuo. */}
                {partes.restante.length >= 2 ? (
                  <Polyline
                    positions={partes.restante}
                    pathOptions={{ color, weight: 2.5, opacity: 0.5, dashArray: "6 7", interactive: false }}
                  />
                ) : null}
                {/* Lo ya recorrido: grueso y sólido, se ve avanzar. */}
                {partes.recorrido.length >= 2 ? (
                  <Polyline positions={partes.recorrido} pathOptions={{ color, weight: 5, opacity: 0.85, lineCap: "round", interactive: false }} />
                ) : null}
                {/* Punta de flecha sobre la carretera, con el rumbo real. */}
                {partes.corte && partes.rumboGrados !== null ? (
                  <Polyline
                    positions={puntaFlecha(partes.corte, partes.rumboGrados)}
                    pathOptions={{ color, weight: 3, opacity: 0.95, interactive: false }}
                  />
                ) : null}
              </>
            ) : null}
            <Marker position={posicion} icon={icono} zIndexOffset={enBase ? 0 : 400}>
              <Tooltip direction="top" offset={[0, -14]}>
                <span className="font-semibold">{u.nombre}</span>
                <br />
                {TEXTO_TIPO_UNIDAD[u.tipo]} · {TEXTO_ESTADO_UNIDAD[u.estado]}
                {u.ruta && enRuta ? (
                  <>
                    <br />
                    Llega a las {new Date(u.ruta.llegadaPrevista).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} ·{" "}
                    {numero((u.ruta.progreso ?? 0) * 100, 0)} % del trayecto
                  </>
                ) : null}
              </Tooltip>
              <Popup minWidth={280}>
                <FichaUnidad unidad={u} incendio={incendio} {...acciones} />
              </Popup>
            </Marker>
          </Fragment>
        );
      })}
    </>
  );
}

/** Dos segmentos cortos que forman una punta de flecha sobre la ruta. */
function puntaFlecha(punto: [number, number], rumboGrados: number, largoM = 260): [number, number][] {
  const p = { lat: punto[0], lon: punto[1] };
  const izq = puntoDestino(p, (rumboGrados + 145) % 360, largoM);
  const der = puntoDestino(p, (rumboGrados + 215) % 360, largoM);
  return [izq, punto, der];
}

/**
 * Bases: de dónde salen las unidades (parques de bomberos, cuarteles, bases de
 * BRIF…), agrupadas por nombre de base, con cuántas hay dentro y cuántas fuera.
 */
function CapaBases({ unidades, colores }: { unidades: Unidad[]; colores: ColoresTema }) {
  const bases = useMemo(() => agruparBases(unidades), [unidades]);
  return (
    <>
      {bases.map((b) => {
        const icono = L.divIcon({
          className: "icono-atalaya",
          html: marcadorCuentaHtml({
            cuenta: b.unidades.length,
            color: colores.muted,
            fondo: colores.panel,
            contorno: CONTORNOS.parque,
            tamano: 22,
          }),
          iconSize: [48, 22],
          iconAnchor: [24, 11],
        });
        return (
          <Marker key={b.clave} position={b.punto} icon={icono} zIndexOffset={-200}>
            <Tooltip direction="top" offset={[0, -10]}>
              <span className="font-semibold">{b.nombre}</span>
              <br />
              {b.unidades.length} unidad(es) · {b.enBase} en base, {b.fuera} desplegada(s)
            </Tooltip>
            <Popup minWidth={240}>
              <div className="w-[15rem] max-w-full">
                <p className="text-[13px] font-semibold leading-tight text-foreground">
                  <EnlaceExterno
                    href={urlOsm(b.clave) ?? urlOsmPunto(b.punto[0], b.punto[1], 17)}
                    className="text-[13px] font-semibold"
                    titulo={`Ver ${b.nombre} en OpenStreetMap`}
                  >
                    {b.nombre}
                  </EnlaceExterno>
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {b.enBase} en base · {b.fuera} desplegada(s)
                </p>
                <ul className="mt-1.5 space-y-1">
                  {b.unidades.map((u) => (
                    <li key={u.id} className="flex flex-wrap items-center gap-1.5 text-[11.5px] leading-snug">
                      <Insignia pequena tono={u.estado === "disponible" ? "neutro" : "info"} punto>
                        {TEXTO_ESTADO_UNIDAD[u.estado]}
                      </Insignia>
                      <span className="font-medium text-foreground">{u.nombre}</span>
                      <span className="text-muted">
                        {TEXTO_TIPO_UNIDAD[u.tipo]} · {numero(u.dotacion.personas)} personas
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

interface Base {
  clave: string;
  nombre: string;
  punto: [number, number];
  unidades: Unidad[];
  enBase: number;
  fuera: number;
}

function agruparBases(unidades: Unidad[]): Base[] {
  const mapa = new Map<string, Base>();
  for (const u of unidades) {
    if (!u.base?.punto || !Number.isFinite(u.base.punto.lat)) continue;
    const clave = u.base.osmId ?? `${u.base.nombre}@${u.base.punto.lat.toFixed(4)},${u.base.punto.lon.toFixed(4)}`;
    const base = mapa.get(clave);
    if (base) base.unidades.push(u);
    else mapa.set(clave, { clave, nombre: u.base.nombre, punto: [u.base.punto.lat, u.base.punto.lon], unidades: [u], enBase: 0, fuera: 0 });
  }
  for (const b of mapa.values()) {
    b.enBase = b.unidades.filter((u) => u.estado === "disponible" || u.estado === "fuera_servicio").length;
    b.fuera = b.unidades.length - b.enBase;
  }
  return [...mapa.values()];
}

function CapaPueblos({
  poblaciones,
  colores,
  onAvisar,
}: {
  poblaciones: Poblacion[];
  colores: ColoresTema;
  onAvisar?: (p: Poblacion) => void | Promise<void>;
}) {
  // Con cientos de pueblos en el radio, poner el nombre fijo en todos convierte
  // el mapa en una sopa de etiquetas. Solo llevan nombre visible los que de
  // verdad urgen: los más cercanos con riesgo inminente. El resto lo enseña al
  // pasar por encima.
  const conEtiqueta = useMemo(() => {
    const inminentes = poblaciones
      .filter((p) => p.riesgo === "inminente")
      .sort((a, b) => (a.etaFrenteMin ?? a.distanciaKm * 60) - (b.etaFrenteMin ?? b.distanciaKm * 60))
      .slice(0, MAX_ETIQUETAS_PUEBLOS);
    return new Set(inminentes.map((p) => p.id));
  }, [poblaciones]);

  return (
    <>
      {poblaciones.map((p) => {
        const color = colores[colorRiesgo(p.riesgo)];
        const avisado = p.estadoAviso !== "sin_avisar";
        const contenido = (
          <>
            <Tooltip direction="top" permanent={conEtiqueta.has(p.id)} opacity={0.95}>
              <span className="font-semibold">{p.nombre}</span> · {TEXTO_RIESGO[p.riesgo]}
              {avisado ? " · avisado" : ""}
            </Tooltip>
            <Popup>
              <FichaPoblacion poblacion={p} onAvisar={onAvisar} />
            </Popup>
          </>
        );
        // Los de riesgo bajo son contexto: un punto pequeño en canvas, mucho más
        // barato que un círculo geográfico por cada uno.
        if (p.riesgo === "bajo") {
          return (
            <CircleMarker
              key={p.id}
              center={aLatLng(p.centro)}
              radius={3}
              pathOptions={{ color, weight: 1, opacity: 0.7, fillColor: color, fillOpacity: 0.45 }}
            >
              {contenido}
            </CircleMarker>
          );
        }
        return (
          <Circle
            key={p.id}
            center={aLatLng(p.centro)}
            radius={radioRiesgoM(p.riesgo)}
            pathOptions={{
              color,
              weight: 2,
              opacity: 0.9,
              fillColor: color,
              fillOpacity: avisado ? 0.1 : 0.22,
              dashArray: avisado ? "5 5" : undefined,
            }}
          >
            {contenido}
          </Circle>
        );
      })}
    </>
  );
}

const TEXTO_AVISO: Record<Poblacion["estadoAviso"], string> = {
  sin_avisar: "Sin avisar",
  avisando: "Avisando ahora",
  avisado: "Avisado",
  confinado: "Confinado",
  evacuando: "Evacuando",
  evacuado: "Evacuado",
  sin_respuesta: "Sin respuesta",
};

function FichaPoblacion({ poblacion: p, onAvisar }: { poblacion: Poblacion; onAvisar?: (p: Poblacion) => void | Promise<void> }) {
  const [ocupado, setOcupado] = useState(false);
  return (
    <div className="w-[15rem] max-w-full">
      <p className="text-[13px] font-semibold leading-tight text-foreground">
        {/* El id viene de OpenStreetMap: se puede abrir la ficha real del pueblo. */}
        <EnlaceExterno href={urlOsm(p.id) ?? urlOsmPunto(p.centro.lat, p.centro.lon, 13)} className="text-[13px] font-semibold" titulo={`Ver ${p.nombre} en OpenStreetMap`}>
          {p.nombre}
        </EnlaceExterno>
      </p>
      <p className="mt-0.5 text-[11px] text-muted">
        {p.habitantes ? `${numero(p.habitantes)} hab. · ` : ""}
        a {distancia(p.distanciaKm)} del foco
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Insignia pequena tono={tonoRiesgo(p.riesgo)} punto>
          {TEXTO_RIESGO[p.riesgo]}
        </Insignia>
        <Insignia pequena tono={p.estadoAviso === "sin_avisar" ? "aviso" : "exito"}>{TEXTO_AVISO[p.estadoAviso]}</Insignia>
        {p.etaFrenteMin !== undefined ? <Insignia pequena tono="neutro">Frente en {minutos(p.etaFrenteMin)}</Insignia> : null}
      </div>
      {p.vulnerables?.length ? (
        <p className="mt-1.5 text-[11px] leading-snug text-muted">
          Vulnerables: {p.vulnerables.slice(0, 3).map((v) => v.nombre).join(", ")}
          {p.vulnerables.length > 3 ? ` y ${p.vulnerables.length - 3} más` : ""}.
        </p>
      ) : null}
      {p.ultimoContacto ? (
        <p className="mt-1 text-[11px] leading-snug text-subtle">
          Último contacto por {p.ultimoContacto.canal} {haceCuanto(p.ultimoContacto.en)}: {p.ultimoContacto.resultado}
        </p>
      ) : null}
      {onAvisar ? (
        <Boton
          tamano="sm"
          variante="primario"
          ancho
          className="mt-2"
          cargando={ocupado}
          icono={<Megaphone />}
          onClick={async () => {
            setOcupado(true);
            try {
              await onAvisar(p);
            } finally {
              setOcupado(false);
            }
          }}
        >
          Avisar ahora
        </Boton>
      ) : null}
    </div>
  );
}

function CapaCamaras({ camaras, colores, onVigilar }: { camaras: Camara[]; colores: ColoresTema; onVigilar?: (id: string, v: boolean) => void | Promise<void> }) {
  return (
    <>
      {camaras.map((c) => {
        const esMovil = c.fuente === "Movil";
        const positiva = c.ultimoAnalisis?.humo || c.ultimoAnalisis?.fuego;
        const color = positiva ? colores.danger : esMovil ? colores.brand : c.vigilada ? colores.info : colores.muted;
        const icono = L.divIcon({
          className: "icono-atalaya",
          html: marcadorHtml({
            contorno: esMovil ? CONTORNOS.movil : CONTORNOS.camara,
            color,
            fondo: colores.panel,
            etiqueta: esMovil ? c.nombre : undefined,
            anillo: c.vigilada || esMovil,
            pulso: Boolean(positiva) || esMovil,
            tamano: 24,
          }),
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        return (
          <Marker key={c.id} position={aLatLng(c.punto)} icon={icono}>
            <Popup minWidth={260}>
              <PopupCamara camara={c} onVigilar={onVigilar ?? (() => {})} />
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

function CapaViento({ incendios, zonas, colores }: { incendios: Incendio[]; zonas: ReturnType<typeof zonasPeligroDe>; colores: ColoresTema }) {
  const flechas = useMemo(() => {
    const salida: { clave: string; f: ReturnType<typeof flechaViento>; color: string }[] = [];
    for (const inc of incendios) {
      if (!inc.meteo) continue;
      const rejilla = rejillaViento(inc.centro, inc.meteo.direccionGrados, inc.meteo.vientoKmh, { lado: 5, separacionM: 5000 });
      rejilla.forEach((f, i) => salida.push({ clave: `${inc.id}-${i}`, f, color: colorVelocidad(f.velocidadKmh, colores) }));
    }
    for (const z of zonas) {
      salida.push({
        clave: `zona-${z.id}`,
        f: flechaViento(z.punto, z.direccionGrados, z.velocidadKmh, 3000),
        color: colorVelocidad(z.velocidadKmh, colores),
      });
    }
    return salida;
  }, [incendios, zonas, colores]);

  return (
    <>
      {flechas.map(({ clave, f, color }) => (
        <Fragment key={clave}>
          <Polyline
            positions={[f.desde, f.hasta]}
            pathOptions={{ color, weight: Math.max(1.2, Math.min(3.2, f.velocidadKmh / 14)), opacity: 0.6, interactive: false }}
          />
          <Polyline positions={f.punta} pathOptions={{ color, weight: Math.max(1.2, Math.min(3.2, f.velocidadKmh / 14)), opacity: 0.6, interactive: false }} />
        </Fragment>
      ))}
      {zonas.map((z) => (
        <CircleMarker
          key={`p-${z.id}`}
          center={aLatLng(z.punto)}
          radius={4}
          pathOptions={{
            color: colorPeligroZona(z.nivel, colores),
            fillColor: colorPeligroZona(z.nivel, colores),
            fillOpacity: 0.85,
            weight: 1,
          }}
        >
          <Tooltip>
            {z.etiqueta ?? "Zona de peligro"} · viento {viento(z.direccionGrados, z.velocidadKmh)}
            {z.nivel ? ` · ${TEXTO_PELIGRO[z.nivel]}` : ""}
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

function colorVelocidad(kmh: number, c: ColoresTema): string {
  if (kmh >= 40) return c.danger;
  if (kmh >= 25) return c.riesgoAlto;
  if (kmh >= 12) return c.riesgoMedio;
  return c.info;
}

function colorPeligroZona(nivel: string | undefined, c: ColoresTema): string {
  if (nivel === "extremo") return c.danger;
  if (nivel === "muy_alto") return c.riesgoInminente;
  if (nivel === "alto") return c.riesgoAlto;
  if (nivel === "moderado") return c.riesgoMedio;
  return c.riesgoBajo;
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function MapaCliente({
  snapshot,
  incendioSeleccionado,
  onSeleccionarIncendio,
  modoDeclarar = false,
  onClicMapa,
  onAvisarPoblacion,
  onVigilarCamara,
  centrarEn,
  unidadOrdenando,
  onOrdenarUnidad,
  onRetirarUnidad,
  onCambiarEstadoFoco,
  onRefrescar,
  children,
}: MapaProps) {
  const colores = useColoresTema();
  const ultimoGesto = useRef(0);
  /**
   * Instancia real de Leaflet. Tenerla aquí es lo que hace que "Ver todo"
   * funcione SIEMPRE: el encuadre se pide a mano en el clic, no a través de un
   * efecto con dependencias que puede no volver a dispararse.
   */
  const [mapa, setMapa] = useState<L.Map | null>(null);
  /** Qué acaba de encuadrar el botón (se lee en voz alta y se ve 2,5 s). */
  const [avisoEncuadre, setAvisoEncuadre] = useState("");
  // Este componente solo se monta en el cliente (Mapa.tsx lo carga con
  // ssr:false), así que se puede leer localStorage ya en el primer render: no
  // hay desajuste de hidratación ni parpadeo de capas.
  const [capas, setCapas] = useState<Record<ClaveCapa, boolean>>(() => {
    try {
      const guardado = localStorage.getItem(CLAVE_CAPAS);
      return guardado ? { ...CAPAS_POR_DEFECTO, ...(JSON.parse(guardado) as Partial<Record<ClaveCapa, boolean>>) } : CAPAS_POR_DEFECTO;
    } catch {
      return CAPAS_POR_DEFECTO; // sin almacenamiento: capas por defecto
    }
  });
  /** Cámara del catálogo abierta ahora mismo (su ficha se pinta con React). */
  const [camaraElegida, setCamaraElegida] = useState<Camara | null>(null);

  const alternar = useCallback((id: ClaveCapa) => {
    setCapas((c) => {
      const siguiente = { ...c, [id]: !c[id] };
      try {
        localStorage.setItem(CLAVE_CAPAS, JSON.stringify(siguiente));
      } catch {
        /* no se puede guardar: vale para esta sesión */
      }
      return siguiente;
    });
  }, []);

  // Con la capa "Satélite" apagada tampoco se pintan los focos que solo ha visto
  // NASA FIRMS y nadie ha confirmado: si no, apagarla dejaría decenas de puntos
  // térmicos sin verificar (industria, quemas agrícolas…) como si fueran incendios.
  const visibles = useMemo(
    () =>
      (snapshot?.incendios ?? []).filter(
        (i) => capas.satelite || !(i.origen === "satelite" && (i.estado === "detectado" || i.estado === "fusionado")),
      ),
    [snapshot?.incendios, capas.satelite],
  );
  // Los descartados no se pintan; los fusionados dejan solo un punto gris con
  // "unido a <nombre>" para que se entienda a dónde ha ido ese foco.
  const incendios = useMemo(
    () => visibles.filter((i) => i.estado !== "descartado" && i.estado !== "fusionado"),
    [visibles],
  );
  const fusionados = useMemo(() => visibles.filter((i) => i.estado === "fusionado"), [visibles]);
  const activos = useMemo(
    () => incendios.filter((i) => !["extinguido", "controlado"].includes(i.estado)),
    [incendios],
  );
  const unidades = useMemo(() => snapshot?.unidades ?? [], [snapshot?.unidades]);
  const poblaciones = snapshot?.poblaciones ?? [];
  const hospitales = snapshot?.hospitales ?? [];
  const camaras = useMemo(() => snapshot?.camaras ?? [], [snapshot?.camaras]);
  const satelite = snapshot?.focosSatelite ?? [];
  const zonas = useMemo(() => zonasPeligroDe(snapshot), [snapshot]);

  const posiciones = usePosicionesAnimadas(unidades);

  // Catálogo completo de cámaras de España (solo si la capa está encendida).
  const catalogo = useCamarasEspana(capas.camarasEspana);
  const vigiladasIds = useMemo(() => new Set(camaras.map((c) => c.id)), [camaras]);
  const elegirCamara = useCallback((c: Camara) => setCamaraElegida(c), []);
  /** La del snapshot manda (lleva vigilada, veredicto e historial). */
  const camaraAbierta = useMemo(
    () => (camaraElegida ? (camaras.find((c) => c.id === camaraElegida.id) ?? camaraElegida) : null),
    [camaraElegida, camaras],
  );

  const accionesUnidad: AccionesUnidad = useMemo(
    () => ({ onOrdenarDestino: onOrdenarUnidad, onRetirar: onRetirarUnidad }),
    [onOrdenarUnidad, onRetirarUnidad],
  );

  const limitesFocos = useMemo(() => {
    const puntos: [number, number][] = [];
    for (const i of (activos.length ? activos : incendios)) {
      puntos.push([i.centro.lat, i.centro.lon]);
      for (const p of i.perimetro ?? []) puntos.push(p);
    }
    for (const u of unidades) if (u.estado === "en_ruta" || u.estado === "en_intervencion") puntos.push([u.posicion.lat, u.posicion.lon]);
    return limitesDe(puntos, 0.12);
  }, [activos, incendios, unidades]);

  /**
   * "Ver todo" (botón del mapa y tecla V). Obedece SIEMPRE, también justo
   * después de arrastrar o de hacer zoom a mano:
   *  · hay focos  → encuadra los focos activos y los medios en movimiento;
   *  · no hay     → España entera;
   *  · ya estaba encuadrado en los focos → sale a España entera, para que
   *    pulsarlo nunca se quede en nada (que es lo que parecía "no funciona").
   * Se anuncia en voz alta lo que ha encuadrado.
   */
  const encuadrarTodo = useCallback(() => {
    if (!mapa) return;
    const relleno: [number, number] = [60, 60];
    const conFocos = limitesFocos !== null;
    const objetivo = L.latLngBounds(limitesFocos ?? LIMITES_ESPANA);
    let destino = objetivo;
    let texto = conFocos
      ? `Encuadre a ${activos.length || incendios.length} foco(s) y sus medios`
      : "Encuadre a España entera";
    if (conFocos) {
      // ¿El mapa ya está justo en ese encuadre? Entonces el usuario quiere ver
      // el conjunto: se sale a España.
      const zoomObjetivo = Math.min(12, mapa.getBoundsZoom(objetivo, false, L.point(relleno[0], relleno[1])));
      const yaEstaba = Math.abs(mapa.getZoom() - zoomObjetivo) < 0.2 && mapa.getCenter().distanceTo(objetivo.getCenter()) < 250;
      if (yaEstaba) {
        destino = L.latLngBounds(LIMITES_ESPANA);
        texto = "Encuadre a España entera";
      }
    }
    mapa.stop();
    mapa.invalidateSize({ debounceMoveend: true });
    mapa.fitBounds(destino, { padding: relleno, maxZoom: 12, animate: true });
    // El encuadre lo pide el usuario: no cuenta como "gesto" que bloquee nada.
    ultimoGesto.current = 0;
    setAvisoEncuadre(`${texto} · ${new Date().toLocaleTimeString("es-ES")}`);
  }, [activos.length, incendios.length, limitesFocos, mapa]);

  // El aviso del encuadre se borra solo: es un acuse de recibo, no un estado.
  useEffect(() => {
    if (!avisoEncuadre) return;
    const id = setTimeout(() => setAvisoEncuadre(""), 2500);
    return () => clearTimeout(id);
  }, [avisoEncuadre]);

  // Atajo "V": el mismo encuadre sin soltar el teclado.
  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "v" || conModificadores(e) || escribiendo()) return;
      e.preventDefault();
      encuadrarTodo();
    }
    document.addEventListener("keydown", alTeclado);
    return () => document.removeEventListener("keydown", alTeclado);
  }, [encuadrarTodo]);

  const bases = useMemo(() => agruparBases(unidades).length, [unidades]);

  const filas: FilaCapa[] = [
    { id: "focos", etiqueta: "Focos y perímetros", cuenta: incendios.length, color: colores.danger, ayuda: "Aún no hay ningún foco declarado" },
    { id: "prediccion", etiqueta: "Predicción +1/+3/+6 h", cuenta: incendios.filter((i) => i.prediccion).length, color: colores.fuego2, ayuda: "La calcula el analista de propagación" },
    { id: "unidades", etiqueta: "Unidades", cuenta: unidades.length, color: colores.danger, ayuda: "Aparecen al enriquecer un foco con los parques reales" },
    { id: "bases", etiqueta: "Bases y parques", cuenta: bases, color: colores.muted, ayuda: "De dónde sale cada unidad (parques, cuarteles, bases BRIF)" },
    { id: "pueblos", etiqueta: "Pueblos por riesgo", cuenta: poblaciones.length, color: colores.riesgoAlto, ayuda: "Salen de OpenStreetMap alrededor del foco" },
    { id: "hospitales", etiqueta: "Hospitales", cuenta: hospitales.length, color: colores.info, ayuda: "Centros sanitarios cercanos (OSM)" },
    { id: "camaras", etiqueta: "Cámaras vigiladas", cuenta: camaras.length, color: colores.info, ayuda: "Cámaras DGT y móviles unidos a la sala" },
    {
      id: "camarasEspana",
      etiqueta: "Cámaras de España",
      cuenta: catalogo.camaras.length,
      color: colores.info,
      ayuda: catalogo.error
        ? `No se ha podido cargar el catálogo: ${catalogo.error}`
        : catalogo.cargando
          ? "Cargando el catálogo de la DGT y de Madrid…"
          : "Todas las cámaras públicas (DGT + Madrid)",
    },
    { id: "viento", etiqueta: "Viento", cuenta: incendios.filter((i) => i.meteo).length + zonas.length, color: colores.riesgoMedio, ayuda: "Rejilla calculada con la meteo de cada foco" },
    { id: "satelite", etiqueta: "Satélite (FRP)", cuenta: satelite.length, color: colores.fuego, ayuda: "Detecciones VIIRS/MODIS de NASA FIRMS. Apagada, oculta también los focos que solo ha visto el satélite y nadie ha confirmado" },
  ];

  const leyenda = [
    capas.focos ? { color: colores.danger, forma: "area" as const, texto: "Perímetro de incendio activo" } : null,
    capas.focos ? { color: colores.warning, forma: "discontinua" as const, texto: "Foco sin confirmar (hueco)" } : null,
    capas.focos ? { color: colores.oscuro ? colores.texto : "#111827", forma: "discontinua" as const, texto: "Línea de control construida" } : null,
    capas.prediccion ? { color: colores.fuego2, forma: "discontinua" as const, texto: "Predicción del frente (+1/+3/+6 h)" } : null,
    capas.pueblos ? { color: colores.riesgoInminente, forma: "punto" as const, texto: "Pueblo en riesgo inminente" } : null,
    capas.pueblos ? { color: colores.riesgoBajo, forma: "punto" as const, texto: "Pueblo con riesgo bajo" } : null,
    ...(capas.unidades
      ? LEYENDA_UNIDAD.map((l) => ({ color: colorUnidad(l.tipo, colores), forma: "punto" as const, texto: l.texto }))
      : []),
    capas.unidades ? { color: colores.muted, forma: "linea" as const, texto: "Ruta: grueso = ya recorrido, fino = lo que queda" } : null,
    capas.bases ? { color: colores.muted, forma: "punto" as const, texto: "Base o parque (número = unidades)" } : null,
    capas.camarasEspana ? { color: colores.info, forma: "punto" as const, texto: "Cámara de tráfico (DGT/Madrid)" } : null,
    capas.viento ? { color: colores.riesgoMedio, forma: "linea" as const, texto: "Viento (longitud y color = intensidad)" } : null,
    capas.satelite ? { color: colores.fuego, forma: "punto" as const, texto: "Detección de satélite (FRP)" } : null,
  ].filter((e): e is { color: string; forma: "linea" | "punto" | "area" | "discontinua"; texto: string } => e !== null);

  return (
    <div className="relative isolate size-full overflow-hidden">
      <MapContainer
        ref={setMapa}
        center={[40.2, -3.7]}
        zoom={6}
        bounds={LIMITES_ESPANA}
        zoomControl={false}
        className="size-full"
        preferCanvas
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />
        <ZoomControl position="bottomright" />
        <AjusteTamano />
        <DetectorGestos alMover={() => (ultimoGesto.current = Date.now())} />
        <CapturaClic activo={modoDeclarar || Boolean(unidadOrdenando)} onClic={onClicMapa} />
        <CursorDeclarar activo={modoDeclarar || Boolean(unidadOrdenando)} />
        <Encuadre limitesFocos={limitesFocos} centrarEn={centrarEn} ultimoGesto={ultimoGesto} />

        {/* Las ~2.300 cámaras del catálogo van las primeras: quedan DEBAJO de
            todo lo operativo y nunca tapan un foco ni una unidad. */}
        {capas.camarasEspana && catalogo.camaras.length > 0 ? (
          <CapaCamarasEspana camaras={catalogo.camaras} vigiladasIds={vigiladasIds} colores={colores} onSeleccionar={elegirCamara} />
        ) : null}
        {camaraAbierta ? (
          <Marker
            position={aLatLng(camaraAbierta.punto)}
            icon={L.divIcon({
              className: "icono-atalaya",
              html: marcadorHtml({ contorno: CONTORNOS.camara, color: colores.brand, fondo: colores.panel, anillo: true, tamano: 26 }),
              iconSize: [26, 26],
              iconAnchor: [13, 13],
            })}
            ref={(m) => {
              m?.openPopup();
            }}
            eventHandlers={{ popupclose: () => setCamaraElegida(null) }}
          >
            <Popup minWidth={260}>
              <PopupCamara camara={camaraAbierta} onVigilar={onVigilarCamara ?? (() => {})} />
            </Popup>
          </Marker>
        ) : null}

        {capas.viento ? <CapaViento incendios={incendios} zonas={zonas} colores={colores} /> : null}
        {capas.bases ? <CapaBases unidades={unidades} colores={colores} /> : null}
        {capas.focos ? (
          <CapaFocos
            incendios={incendios}
            poblaciones={poblaciones}
            colores={colores}
            seleccionado={incendioSeleccionado}
            onSeleccionar={onSeleccionarIncendio}
            conPrediccion={capas.prediccion}
            onCambiarEstadoFoco={onCambiarEstadoFoco}
            onRefrescar={onRefrescar}
          />
        ) : null}
        {/* Focos absorbidos por otro: un punto gris discreto, nada más. */}
        {capas.focos
          ? fusionados.map((f) => (
              <CircleMarker
                key={f.id}
                center={aLatLng(f.centro)}
                radius={4}
                pathOptions={{ color: colores.muted, fillColor: colores.muted, fillOpacity: 0.5, weight: 1 }}
              >
                <Tooltip>
                  {f.nombre} · unido a {incendios.find((i) => i.id === f.fusionadoEn)?.nombre ?? "otro foco"}
                </Tooltip>
              </CircleMarker>
            ))
          : null}
        {capas.pueblos ? <CapaPueblos poblaciones={poblaciones} colores={colores} onAvisar={onAvisarPoblacion} /> : null}
        {capas.unidades ? (
          <CapaUnidades unidades={unidades} incendios={incendios} colores={colores} posiciones={posiciones} acciones={accionesUnidad} />
        ) : null}
        {capas.camaras ? <CapaCamaras camaras={camaras} colores={colores} onVigilar={onVigilarCamara} /> : null}
        {capas.hospitales
          ? hospitales.map((h) => (
              <Marker
                key={h.id}
                position={aLatLng(h.punto)}
                icon={L.divIcon({
                  className: "icono-atalaya",
                  html: marcadorHtml({ contorno: CONTORNOS.hospital, color: colores.info, fondo: colores.panel, tamano: 22 }),
                  iconSize: [22, 22],
                  iconAnchor: [11, 11],
                })}
              >
                <Tooltip direction="top" offset={[0, -10]}>
                  {h.nombre} · {h.tipo === "hospital" ? "Hospital" : "Centro de salud"}
                  {h.distanciaKm !== undefined ? ` · a ${distancia(h.distanciaKm)}` : ""}
                </Tooltip>
              </Marker>
            ))
          : null}
        {capas.satelite
          ? satelite.map((f) => (
              <CircleMarker
                key={f.id}
                center={aLatLng(f.punto)}
                radius={Math.max(3, Math.min(9, Math.sqrt(f.frp || 1)))}
                pathOptions={{ color: colores.fuego, fillColor: colores.fuego, fillOpacity: 0.75, weight: 1 }}
              >
                <Tooltip>
                  {f.fuente} · FRP {numero(f.frp, 1)} MW · confianza {f.confianza} · {haceCuanto(f.fechaHora)}
                </Tooltip>
              </CircleMarker>
            ))
          : null}
      </MapContainer>

      <PanelCapas filas={filas} activas={capas} onAlternar={alternar} onEncuadrar={encuadrarTodo} />
      <Leyenda entradas={leyenda} />

      {/* Acuse de recibo de "Ver todo": el mando ve que el botón ha hecho algo
          aunque el mapa ya estuviera casi encuadrado. */}
      <div aria-live="polite" className="pointer-events-none absolute inset-x-0 top-12 z-[940] flex justify-center px-4">
        {avisoEncuadre ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/50 bg-panel/97 px-3 py-1 text-[12px] font-medium text-brand shadow-[var(--sombra-flotante)] backdrop-blur">
            <Maximize2 className="size-3.5 shrink-0" aria-hidden /> {avisoEncuadre.split(" · ")[0]}
          </span>
        ) : null}
      </div>

      {/* Estado vacío: sin focos, el mapa explica qué hacer. */}
      {snapshot && incendios.length === 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 z-[880] flex justify-center px-4">
          <div className="pointer-events-auto max-w-md rounded-xl border border-panel-border bg-panel/97 px-4 py-3 text-center shadow-[var(--sombra-flotante)] backdrop-blur">
            <p className="flex items-center justify-center gap-2 text-sm font-semibold text-foreground">
              <Flame className="size-4 text-fuego" aria-hidden /> Todavía no hay ningún foco
            </p>
            <p className="mt-1 text-[13px] leading-snug text-muted">
              Declara uno con la tecla <kbd className="rounded border border-panel-border-strong bg-panel-2 px-1">F</kbd> o con el botón
              «Declarar foco» y haz clic en el mapa: los agentes empezarán a trabajar solos.
            </p>
          </div>
        </div>
      ) : null}

      {/* Aviso del modo declarar. */}
      {modoDeclarar ? (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-[950] flex justify-center px-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-fuego bg-panel px-3 py-1.5 text-[13px] font-semibold text-fuego shadow-[var(--sombra-flotante)]">
            <MapPin className="size-4" aria-hidden /> Haz clic en el mapa para declarar el foco · Esc para salir
          </span>
        </div>
      ) : null}

      {/* Aviso del modo "elegir destino" de una unidad. */}
      {unidadOrdenando ? (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-[950] flex justify-center px-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand bg-panel px-3 py-1.5 text-[13px] font-semibold text-brand shadow-[var(--sombra-flotante)]">
            <Navigation className="size-4" aria-hidden /> Haz clic en el destino de {unidadOrdenando.nombre} · Esc para salir
          </span>
        </div>
      ) : null}

      {/* Estado del catálogo de cámaras: si falla, se dice. */}
      {capas.camarasEspana && (catalogo.cargando || catalogo.error) ? (
        <div className="pointer-events-none absolute bottom-7 right-2 z-[880] max-w-[17rem]">
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border bg-panel/95 px-2 py-1 text-[11px] font-medium shadow-sm backdrop-blur ${
              catalogo.error ? "border-danger/45 text-danger" : "border-panel-border text-muted"
            }`}
          >
            {catalogo.error ? (
              <>
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden /> Cámaras de España: {catalogo.error}
              </>
            ) : (
              "Cargando las cámaras de España…"
            )}
          </span>
        </div>
      ) : null}

      {children}
    </div>
  );
}
