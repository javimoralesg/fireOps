"use client";
// Mapa de situación de la sala de mando. SOLO CLIENTE (Leaflet usa `window`):
// se carga desde components/mapa/Mapa.tsx con dynamic(..., { ssr: false }).
// DUEÑO: constructor E. Dependencias: leaflet, react-leaflet, lucide-react.
//
// Capas: focos (perímetro + predicción), unidades (con ruta y movimiento suave),
// bases de las que salen, pueblos por riesgo, hospitales, cámaras vigiladas,
// TODAS las cámaras de España, viento (rejilla calculada aquí a partir de la
// meteo del foco), satélite y avisos meteo.
//
// AMPLIADO (constructor H, 2026-09-19): capa "Cámaras de España", iconos de
// unidad por cuerpo con ruta recorrida y flecha de sentido, capa "Bases",
// focos "detectado" en hueco con confirmar/descartar y control de viento.
//
// RENDIMIENTO (constructor Q, 2026-09-19). Con ~2.000 marcadores y un snapshot
// cada 1,4 s, el mapa se repintaba ENTERO en cada actualización. Cuatro reglas
// que hay que respetar al tocar este archivo:
//  1. UN COMPONENTE MEMOIZADO POR ELEMENTO (`UnidadMarker`, `PuebloMarker`…).
//     El motor conserva la identidad de cada item entre snapshots, así que
//     `React.memo` por referencia basta para no volver a pintar lo que no ha
//     cambiado. Todo lo demás debe ser barato aunque la identidad se pierda.
//  2. ICONOS Y TRAZOS POR CACHÉ (`./iconos`, `./estilos`): react-leaflet compara
//     `icon` y `pathOptions` POR REFERENCIA y llama a `setIcon`/`setStyle`, que
//     reconstruyen el DOM y reinician las animaciones.
//  3. EL MOVIMIENTO DE LAS UNIDADES NO PASA POR REACT (`./animacion`): la prop
//     `position` del marcador no cambia nunca y se mueve con `setLatLng`.
//  4. EL CONTENIDO DE POPUPS Y TOOLTIPS VA EN UN COMPONENTE HIJO, nunca en línea
//     dentro del JSX: react-leaflet solo lo monta cuando se abre, y así no se
//     formatean miles de textos que nadie está mirando.
//  5. TODO <Popup> LLEVA autoPan={false}: los coloca ./colocarPopups.ts (encima,
//     debajo o a un lado del marcador, siempre enteros y sin mover el mapa).
//
// AMPLIADO (constructor E, 2026-09-19): filtro por zona (recuadro o lazo
// dibujado sobre el mapa, ./SeleccionZona.tsx). El snapshot ya llega recortado
// desde la sala (lib/cliente/zona.ts); aquí solo se dibuja, se pinta y se quita.

import "leaflet/dist/leaflet.css";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Crosshair, Flame, MapPin, Maximize2, Megaphone, Navigation, TriangleAlert } from "lucide-react";
import type { Camara, FocoSatelite, Incendio, Poblacion, Punto, Snapshot, Unidad } from "@/lib/dominio/tipos";
import {
  LIMITES_ESPANA,
  LIMITES_NAVEGACION,
  aLatLng,
  circulo,
  destino as puntoDestino,
  flechaViento,
  limitesDe,
  partirRuta,
  rejillaViento,
  type FlechaViento,
} from "./geo";
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
import { iconoDiv, rumboRedondeado } from "./iconos";
import { moverMarcador, olvidarMarcador } from "./animacion";
import { useOcultarTerminados } from "./useOcultarTerminados";
import {
  trazoLineaControl,
  trazoPerimetro,
  trazoPrediccion,
  trazoPuebloBajo,
  trazoPueblo,
  trazoPuntaRuta,
  trazoPuntoFusionado,
  trazoPuntoSatelite,
  trazoPuntoZona,
  trazoRutaRecorrida,
  trazoRutaRestante,
  trazoViento,
} from "./estilos";
import { useColoresTema, type ColoresTema } from "./useColoresTema";
import { PanelCapas, Leyenda, type ClaveCapa, type FilaCapa } from "./PanelCapas";
import { hospitalesParticipantes, leerFiltros, guardarFiltros, TEXTO_FILTRO, unidadParticipa, type CapaFiltrable } from "./filtroParticipantes";
import { PopupCamara } from "./PopupCamara";
import { instalarColocadorPopups } from "./colocarPopups";
import { CapaCamarasEspana } from "./CamarasEspana";
import { useCamarasEspana } from "./useCamarasEspana";
import { FichaUnidad, type AccionesUnidad } from "./FichaUnidad";
import { AvisoDibujoZona, AvisoZonaVacia, BandaZona, CapaZona, ControlesZona, DibujoZona } from "./SeleccionZona";
import { CapaFueraEspana } from "./CapaFueraEspana";
import { limitesZona, type TipoZona, type ZonaSeleccion } from "@/lib/cliente/zona";
import { listaZonasCruda, zonasPeligroDeLista, type ZonaPeligroMapa } from "./extras";
import { superficieDibujadaHa } from "./superficie";
import { distancia, haceCuanto, hectareas, hora, minutos, numero, rumboFrase, viento } from "@/lib/cliente/formato";
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
/** Cuántos pueblos llevan el nombre siempre visible (el resto, al pasar el ratón). */
const MAX_ETIQUETAS_PUEBLOS = 8;
/** Constantes izadas: si fueran literales del JSX cambiarían de referencia cada render. */
const DESPLAZAMIENTO_14: [number, number] = [0, -14];
const DESPLAZAMIENTO_10: [number, number] = [0, -10];
const SIN_POBLACIONES: Poblacion[] = [];

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
  avisos: true,
  fueraEspana: true,
};

/**
 * Petición de encuadre desde fuera del mapa ("Ver en el mapa", foco de la URL…).
 * `sello` distingue peticiones: solo se aplica cuando cambia. Con `unidad`, esa
 * unidad se pinta y se resalta aunque el filtro "solo las desplegadas", la capa
 * apagada o la zona la tuvieran oculta: desde una decisión pendiente la unidad
 * suele seguir en su base y, sin esto, el mapa iba a un parque vacío y parecía
 * que el botón no hacía nada.
 */
export interface PeticionEncuadre {
  lat: number;
  lon: number;
  sello: number;
  /** Zoom exacto al que ir; si no, se conserva el actual con un mínimo. */
  zoom?: number;
  /** Zoom mínimo al conservar el actual (12 si no se indica). */
  zoomMinimo?: number;
  /** Unidad que se quiere ver: se dibuja y se resalta aunque estuviera oculta. */
  unidad?: Unidad;
}

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
  /** Petición externa de encuadre (ver `PeticionEncuadre`). */
  centrarEn?: PeticionEncuadre;
  /** Unidad a la que se le está eligiendo destino: el próximo clic lo fija. */
  unidadOrdenando?: Unidad;
  /** Pide entrar en ese modo desde la ficha de una unidad. */
  onOrdenarUnidad?: (u: Unidad) => void;
  onRetirarUnidad?: (u: Unidad) => void | Promise<void>;
  /** Confirmar o descartar un foco todavía sin confirmar. */
  onCambiarEstadoFoco?: (id: string, estado: "confirmado" | "descartado") => void | Promise<void>;
  /** Tras fijar o quitar el viento de un foco. */
  onRefrescar?: () => void;
  /**
   * Filtro por zona (recuadro o lazo). La sala guarda la zona y ya manda el
   * snapshot recortado a ella; aquí solo se dibuja, se pinta y se quita.
   */
  zona?: ZonaSeleccion | null;
  /** Focos que hay en total sin filtrar y cuántos caen en la zona (mismos números que el panel). */
  focosTotales?: number;
  focosEnZona?: number;
  /** Se ha terminado de dibujar una zona nueva. */
  onZonaDibujada?: (zona: ZonaSeleccion) => void;
  /** "Quitar filtro": borra la zona y vuelve a verse todo. */
  onQuitarZona?: () => void;
  /** Contenido extra que se superpone al mapa (banda de conexión, etc.). */
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Ayudantes de mapa
// ---------------------------------------------------------------------------

/**
 * Envuelve una callback del padre en otra que NO cambia de referencia. Sin esto,
 * una función anónima escrita en `app/page.tsx` invalidaría el `React.memo` de
 * los ~2.000 marcadores en cada render de la sala. Se conserva la distinción
 * entre "hay callback" y "no hay" porque las fichas enseñan u ocultan botones
 * según eso.
 */
function useEstable<F extends (...args: never[]) => unknown>(fn: F | undefined): F | undefined {
  const ultima = useRef(fn);
  useEffect(() => {
    ultima.current = fn;
  }, [fn]);
  const hay = fn !== undefined;
  return useMemo(() => (hay ? (((...args: never[]) => ultima.current?.(...args)) as F) : undefined), [hay]);
}

/** Marca cuándo el usuario ha movido el mapa a mano. */
function DetectorGestos({ alMover }: { alMover: () => void }) {
  const manejadores = useMemo(() => ({ dragstart: alMover, zoomstart: alMover, mousedown: alMover }), [alMover]);
  useMapEvents(manejadores);
  return null;
}

function CapturaClic({ activo, onClic }: { activo: boolean; onClic?: (p: Punto) => void }) {
  const manejadores = useMemo(
    () => ({
      click: (e: L.LeafletMouseEvent) => {
        if (activo && onClic) onClic({ lat: e.latlng.lat, lon: e.latlng.lng });
      },
    }),
    [activo, onClic],
  );
  useMapEvents(manejadores);
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

/**
 * Coloca cada popup donde quepa entero (./colocarPopups.ts): encima del
 * marcador y, si no entra, debajo o a un lado, esquivando paneles y controles.
 * Va con `autoPan={false}` en todos los <Popup>: el mapa no se mueve.
 */
function ColocadorPopups() {
  const map = useMap();
  useEffect(() => instalarColocadorPopups(map), [map]);
  return null;
}

/**
 * El popup de Leaflet solo mide su contenido y se encaja en el mapa (autoPan)
 * al abrirse. Si el contenido crece después, como al desplegar «Viento
 * (ejercicio)» en la ficha del foco, el popup se sale por arriba del mapa y
 * queda cortado. Este envoltorio vigila la altura del contenido y, cuando
 * cambia, pide al popup que se vuelva a medir y a encajar; si lo que ha
 * crecido es un desplegable, lo sube a la vista.
 *
 * El tope de altura y el scroll los lleva el propio envoltorio, no la opción
 * `maxHeight` de Leaflet: al medirse, Leaflet pone la altura del contenido a
 * «auto» un instante y el navegador devolvería el scroll a cero en cada
 * remedición (react-leaflet remide con cada snapshot). Si el sitio donde lo
 * coloca ./colocarPopups.ts deja menos alto (`--popup-alto-max`), manda ese.
 */
function AjustePopup({
  popup,
  altoMaximo = 460,
  children,
}: {
  popup: React.RefObject<L.Popup | null>;
  altoMaximo?: number;
  children: React.ReactNode;
}) {
  const zona = useRef<HTMLDivElement>(null);
  const contenido = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const z = zona.current;
    const el = contenido.current;
    if (!z || !el) return;
    let alto = el.offsetHeight;
    // Desplegable recién abierto, y hasta cuándo merece la pena subirlo a la
    // vista: su contenido se monta en un render posterior al `toggle`, así que
    // el primer reajuste puede llegar antes de que haya scroll.
    let pendiente: { nodo: HTMLElement; hasta: number } | null = null;
    let cuadro = 0;
    const obs = new ResizeObserver(() => {
      // Solo la altura importa: el ancho lo fija el propio popup al medirse.
      if (el.offsetHeight === alto) return;
      alto = el.offsetHeight;
      cancelAnimationFrame(cuadro);
      cuadro = requestAnimationFrame(() => {
        popup.current?.update();
        if (!pendiente) return;
        if (z.scrollHeight > z.clientHeight) {
          // Ya con scroll: el desplegable recién abierto sube hasta arriba
          // para que se vea entero, no solo su cabecera.
          z.scrollTop += pendiente.nodo.getBoundingClientRect().top - z.getBoundingClientRect().top;
          pendiente = null;
        } else if (performance.now() > pendiente.hasta) {
          pendiente = null;
        }
      });
    });
    obs.observe(el);
    // `toggle` no burbujea, pero la fase de captura sí pasa por el envoltorio.
    const alDesplegar = (e: Event) => {
      const d = e.target as HTMLDetailsElement;
      pendiente = d.open ? { nodo: d, hasta: performance.now() + 1500 } : null;
    };
    el.addEventListener("toggle", alDesplegar, true);
    return () => {
      obs.disconnect();
      el.removeEventListener("toggle", alDesplegar, true);
      cancelAnimationFrame(cuadro);
    };
  }, [popup]);
  // `whitespace-normal` a propósito: Leaflet mide el ancho con `nowrap` en el
  // nodo padre y, si se heredase, el contenido se reordenaría en cada medición.
  return (
    <div ref={zona} className="overflow-y-auto whitespace-normal" style={{ maxHeight: `min(${altoMaximo}px, var(--popup-alto-max, ${altoMaximo}px))` }}>
      <div ref={contenido}>{children}</div>
    </div>
  );
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
  alCentrar,
}: {
  limitesFocos: [[number, number], [number, number]] | null;
  centrarEn?: PeticionEncuadre;
  ultimoGesto: React.RefObject<number>;
  /** Se avisa cuando la petición se ha aplicado de verdad (acuse de recibo). */
  alCentrar?: (peticion: PeticionEncuadre) => void;
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
    const ir = () => {
      map.stop();
      map.setView([centrarEn.lat, centrarEn.lon], centrarEn.zoom ?? Math.max(map.getZoom(), centrarEn.zoomMinimo ?? 12), { animate: true });
      // En pantallas estrechas (mapa arriba, panel debajo) la sala puede haber
      // quedado desplazada con el mapa fuera de la vista (p. ej. tras enfocar
      // un campo de un diálogo): se trae el mapa a la vista para que el
      // encuadre se VEA. En escritorio, con el mapa ya visible, no mueve nada.
      map.getContainer().scrollIntoView({ block: "nearest", inline: "nearest" });
      alCentrar?.(centrarEn);
    };
    // Leaflet IGNORA un setView mientras anima un zoom (rueda, fitBounds…) y
    // stop() no corta esa animación: si el clic llega en ese momento, se espera
    // al final del zoom en vez de perder la petición.
    if ((map as unknown as { _animatingZoom?: boolean })._animatingZoom) {
      map.once("zoomend", ir);
      return () => {
        map.off("zoomend", ir);
      };
    }
    ir();
  }, [map, centrarEn, alCentrar]);

  return null;
}

// ---------------------------------------------------------------------------
// Capa de focos
// ---------------------------------------------------------------------------

const CapaFocos = memo(function CapaFocos({
  incendios,
  poblacionesPorFoco,
  colores,
  seleccionado,
  onSeleccionar,
  conPrediccion,
  onCambiarEstadoFoco,
  onRefrescar,
}: {
  incendios: Incendio[];
  poblacionesPorFoco: Map<string, Poblacion[]>;
  colores: ColoresTema;
  seleccionado?: string;
  onSeleccionar?: (id: string) => void;
  conPrediccion: boolean;
  onCambiarEstadoFoco?: (id: string, estado: "confirmado" | "descartado") => void | Promise<void>;
  onRefrescar?: () => void;
}) {
  return (
    <>
      {incendios.map((inc) => (
        <FocoMarker
          key={inc.id}
          incendio={inc}
          poblaciones={poblacionesPorFoco.get(inc.id) ?? SIN_POBLACIONES}
          colores={colores}
          resaltado={seleccionado === inc.id}
          onSeleccionar={onSeleccionar}
          conPrediccion={conPrediccion}
          onCambiarEstadoFoco={onCambiarEstadoFoco}
          onRefrescar={onRefrescar}
        />
      ))}
    </>
  );
});

const FocoMarker = memo(function FocoMarker({
  incendio: inc,
  poblaciones,
  colores,
  resaltado,
  onSeleccionar,
  conPrediccion,
  onCambiarEstadoFoco,
  onRefrescar,
}: {
  incendio: Incendio;
  poblaciones: Poblacion[];
  colores: ColoresTema;
  resaltado: boolean;
  onSeleccionar?: (id: string) => void;
  conPrediccion: boolean;
  onCambiarEstadoFoco?: (id: string, estado: "confirmado" | "descartado") => void | Promise<void>;
  onRefrescar?: () => void;
}) {
  const color = colores[colorIncendio(inc.estado)];
  const porConfirmar = sinConfirmar(inc);
  const colorTrazo = porConfirmar ? colores.warning : color;

  // Coordenadas sueltas: dependencias primitivas a propósito, para que esto no
  // se recalcule aunque el cliente pierda la identidad de los objetos.
  const { lat, lon } = inc.centro;
  const perimetro = useMemo(
    () =>
      inc.perimetro?.length >= 3
        ? inc.perimetro
        : // Sin perímetro: un círculo que MIDE la superficie del foco (radio mínimo
          // 60 m, el de un foco recién declarado), para que lo dibujado sea lo dicho.
          circulo({ lat, lon }, Math.max(60, Math.sqrt(((inc.areaHa || 1) * 10_000) / Math.PI))),
    [inc.perimetro, lat, lon, inc.areaHa],
  );
  const centro = useMemo<[number, number]>(() => [lat, lon], [lat, lon]);

  const icono = iconoDiv({
    html: marcadorHtml({
      contorno: porConfirmar ? CONTORNOS.interrogacion : CONTORNOS.llama,
      color: colorTrazo,
      fondo: colores.panel,
      etiqueta: porConfirmar ? `${inc.nombre} · Sin confirmar` : inc.nombre,
      anillo: resaltado,
      pulso: resaltado,
      hueco: porConfirmar,
      tamano: 34,
    }),
    tamano: [34, 34],
  });

  const alPulsar = useMemo(() => ({ click: () => onSeleccionar?.(inc.id) }), [onSeleccionar, inc.id]);
  const refPopup = useRef<L.Popup>(null);

  return (
    <>
      {conPrediccion && inc.prediccion ? (
        <>
          {inc.prediccion.en6h?.length >= 3 ? (
            <Polygon positions={inc.prediccion.en6h} pathOptions={trazoPrediccion(color, 6)} />
          ) : null}
          {inc.prediccion.en3h?.length >= 3 ? (
            <Polygon positions={inc.prediccion.en3h} pathOptions={trazoPrediccion(color, 3)} />
          ) : null}
          {inc.prediccion.en1h?.length >= 3 ? (
            <Polygon positions={inc.prediccion.en1h} pathOptions={trazoPrediccion(color, 1)}>
              <Tooltip sticky>
                <TooltipPrediccion explicacion={inc.prediccion.explicacion} />
              </Tooltip>
            </Polygon>
          ) : null}
        </>
      ) : null}

      <Polygon
        positions={perimetro}
        pathOptions={trazoPerimetro(colorTrazo, resaltado, porConfirmar, colores.oscuro)}
        eventHandlers={alPulsar}
      >
        <Tooltip sticky>
          <TooltipFoco incendio={inc} porConfirmar={porConfirmar} perimetro={perimetro} />
        </Tooltip>
      </Polygon>

      {/* Línea de control ya construida: tramo del perímetro proporcional a
          `contencion.fraccion`, en negro discontinuo sobre el perímetro. */}
      {inc.contencion && inc.contencion.fraccion > 0 ? (
        <LineaControl perimetro={perimetro} fraccion={inc.contencion.fraccion} colores={colores} />
      ) : null}

      <Marker position={centro} icon={icono} eventHandlers={alPulsar}>
        <Popup ref={refPopup} minWidth={280} autoPan={false}>
          <AjustePopup popup={refPopup}>
            <FichaFocoMapa
              incendio={inc}
              poblaciones={poblaciones}
              onCambiarEstado={onCambiarEstadoFoco}
              onRefrescar={onRefrescar}
            />
          </AjustePopup>
        </Popup>
      </Marker>
    </>
  );
});

function TooltipPrediccion({ explicacion }: { explicacion: string }) {
  return <>Perímetro previsto a +1 h · {explicacion}</>;
}

/** Las hectáreas se MIDEN sobre el polígono que se dibuja (components/mapa/superficie.ts). */
function TooltipFoco({ incendio: inc, porConfirmar, perimetro }: { incendio: Incendio; porConfirmar: boolean; perimetro: [number, number][] }) {
  // Se mide una vez por perímetro: la referencia viene del snapshot (o del
  // useMemo del padre) y se conserva entre ticks mientras no cambie.
  const superficieHa = useMemo(() => superficieDibujadaHa(perimetro, inc.areaHa), [perimetro, inc.areaHa]);
  return (
    <>
      {inc.nombre} · {porConfirmar ? "Sin confirmar" : TEXTO_ESTADO_INCENDIO[inc.estado]} · {hectareas(superficieHa)}
      {inc.contencion ? ` · ${numero((inc.contencion.fraccion ?? 0) * 100)} % de perímetro controlado` : ""}
    </>
  );
}

/** Tramo de perímetro ya controlado (línea construida), en negro discontinuo. */
const LineaControl = memo(function LineaControl({
  perimetro,
  fraccion,
  colores,
}: {
  perimetro: [number, number][];
  fraccion: number;
  colores: ColoresTema;
}) {
  const tramo = useMemo(() => {
    if (perimetro.length < 3) return null;
    const anillo: [number, number][] = [...perimetro, perimetro[0]];
    const { recorrido } = partirRuta(anillo, Math.max(0, Math.min(1, fraccion)));
    return recorrido.length >= 2 ? recorrido : null;
  }, [perimetro, fraccion]);
  if (!tramo) return null;
  return (
    <Polyline positions={tramo} pathOptions={trazoLineaControl(colores.oscuro ? colores.texto : "#111827")}>
      <Tooltip sticky>
        <TooltipLineaControl fraccion={fraccion} />
      </Tooltip>
    </Polyline>
  );
});

function TooltipLineaControl({ fraccion }: { fraccion: number }) {
  return <>Línea de control construida · {numero(fraccion * 100)} % del perímetro</>;
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
  // Hectáreas MEDIDAS sobre el perímetro del snapshot (components/mapa/superficie.ts).
  const superficieHa = useMemo(() => superficieDibujadaHa(inc.perimetro, inc.areaHa), [inc.perimetro, inc.areaHa]);
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
        <Insignia pequena tono="neutro">{hectareas(superficieHa)}</Insignia>
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

// ---------------------------------------------------------------------------
// Capa de unidades
// ---------------------------------------------------------------------------

/**
 * Unidades: un icono por cuerpo (camión rojo bomberos, verde forestales, azul
 * Guardia Civil/Policía, blanco y rojo ambulancia, naranja Protección Civil,
 * amarillo maquinaria), la ruta REAL de OSRM con el tramo ya recorrido más
 * grueso, flecha de sentido, anillo en intervención e icono atenuado en base.
 */
const CapaUnidades = memo(function CapaUnidades({
  unidades,
  resaltadaId,
  porIncendio,
  colores,
  acciones,
}: {
  unidades: Unidad[];
  /** Unidad pedida con "Ver en el mapa": se pinta a tamaño completo y latiendo. */
  resaltadaId?: string;
  porIncendio: Map<string, Incendio>;
  colores: ColoresTema;
  acciones: AccionesUnidad;
}) {
  return (
    <>
      {unidades.map((u) => (
        <UnidadMarker
          key={u.id}
          unidad={u}
          incendio={u.incendioId ? porIncendio.get(u.incendioId) : undefined}
          colores={colores}
          acciones={acciones}
          resaltada={u.id === resaltadaId}
        />
      ))}
    </>
  );
});

const UnidadMarker = memo(function UnidadMarker({
  unidad: u,
  incendio,
  colores,
  acciones,
  resaltada = false,
}: {
  unidad: Unidad;
  incendio?: Incendio;
  colores: ColoresTema;
  acciones: AccionesUnidad;
  resaltada?: boolean;
}) {
  const refMarcador = useRef<L.Marker | null>(null);
  /**
   * La posición que ve react-leaflet NO cambia nunca: si cambiara, llamaría a
   * `setLatLng` con el destino y el icono daría un salto antes de que empezara
   * la animación. El movimiento lo lleva `./animacion` por su cuenta.
   */
  const [posicionInicial] = useState<[number, number]>(() => [u.posicion.lat, u.posicion.lon]);

  // La ruta va aparte para que la animación siga la carretera entre el progreso
  // anterior y el nuevo. Si cambia la ruta sin moverse la posición, `moverMarcador`
  // no hace nada (mismo destino).
  const coordsRuta = u.ruta?.coords;
  const progresoRuta = u.ruta?.progreso;
  useEffect(() => {
    const marcador = refMarcador.current;
    if (!marcador) return;
    const ruta = coordsRuta && coordsRuta.length >= 2 && progresoRuta !== undefined ? { coords: coordsRuta, progreso: progresoRuta } : undefined;
    moverMarcador(marcador, [u.posicion.lat, u.posicion.lon], ruta);
  }, [u.posicion.lat, u.posicion.lon, coordsRuta, progresoRuta]);

  // El marcador se captura AL MONTAR: al desmontar, React ya ha puesto la
  // referencia a null y la animación se quedaría colgada con un nodo muerto.
  useEffect(() => {
    const marcador = refMarcador.current;
    return () => {
      if (marcador) olvidarMarcador(marcador);
    };
  }, []);

  const color = colorUnidad(u.tipo, colores);
  const enRuta = u.estado === "en_ruta" || u.estado === "regreso";
  const enBase = u.estado === "disponible" || u.estado === "fuera_servicio";

  const partes = useMemo(
    () => (enRuta && u.ruta?.coords?.length ? partirRuta(u.ruta.coords, u.ruta.progreso ?? 0) : null),
    [enRuta, u.ruta],
  );
  const punta = useMemo(
    () => (partes?.corte && partes.rumboGrados !== null ? puntaFlecha(partes.corte, partes.rumboGrados) : null),
    [partes],
  );

  // Resaltada ("Ver en el mapa" desde una decisión): a tamaño completo, con
  // etiqueta y un anillo latiendo en el color de la marca (distinto del anillo
  // en el color del cuerpo que llevan las que van en ruta), aunque siga en base.
  const destacada = resaltada || enRuta || u.estado === "en_intervencion";
  const tamano = enBase && !resaltada ? 20 : 28;
  const icono = iconoDiv({
    html: marcadorHtml({
      contorno: CONTORNOS[ICONO_UNIDAD[u.tipo]] ?? CONTORNOS.camion,
      color,
      fondo: colores.panel,
      etiqueta: destacada ? u.nombre.split("·").pop()?.trim() : undefined,
      anillo: destacada,
      pulso: resaltada || enRuta,
      colorAnillo: resaltada ? colores.brand : undefined,
      atenuado: enBase && !resaltada,
      flechaGrados: rumboRedondeado(partes?.rumboGrados),
      tamano,
    }),
    tamano: [tamano, tamano],
  });

  return (
    <>
      {partes ? (
        <>
          {/* Lo que queda por recorrer: fino y discontinuo. */}
          {partes.restante.length >= 2 ? (
            <Polyline positions={partes.restante} pathOptions={trazoRutaRestante(color)} />
          ) : null}
          {/* Lo ya recorrido: grueso y sólido, se ve avanzar. */}
          {partes.recorrido.length >= 2 ? (
            <Polyline positions={partes.recorrido} pathOptions={trazoRutaRecorrida(color)} />
          ) : null}
          {/* Punta de flecha sobre la carretera, con el rumbo real. */}
          {punta ? <Polyline positions={punta} pathOptions={trazoPuntaRuta(color)} /> : null}
        </>
      ) : null}
      <Marker ref={refMarcador} position={posicionInicial} icon={icono} zIndexOffset={resaltada ? 600 : enBase ? 0 : 400}>
        <Tooltip direction="top" offset={DESPLAZAMIENTO_14}>
          <TooltipUnidad unidad={u} />
        </Tooltip>
        <Popup minWidth={280} autoPan={false}>
          <FichaUnidad unidad={u} incendio={incendio} {...acciones} />
        </Popup>
      </Marker>
    </>
  );
});

function TooltipUnidad({ unidad: u }: { unidad: Unidad }) {
  const enRuta = u.estado === "en_ruta" || u.estado === "regreso";
  return (
    <>
      <span className="font-semibold">{u.nombre}</span>
      <br />
      {TEXTO_TIPO_UNIDAD[u.tipo]} · {TEXTO_ESTADO_UNIDAD[u.estado]}
      {u.ruta && enRuta ? (
        <>
          <br />
          Llega a las {hora(u.ruta.llegadaPrevista)} · {numero((u.ruta.progreso ?? 0) * 100, 0)} % del trayecto
        </>
      ) : null}
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

// ---------------------------------------------------------------------------
// Capa de bases
// ---------------------------------------------------------------------------

/**
 * Bases: de dónde salen las unidades (parques de bomberos, cuarteles, bases de
 * BRIF…), agrupadas por nombre de base, con cuántas hay dentro y cuántas fuera.
 */
const CapaBases = memo(function CapaBases({ bases, colores }: { bases: Base[]; colores: ColoresTema }) {
  return (
    <>
      {bases.map((b) => (
        <BaseMarker key={b.clave} base={b} colores={colores} />
      ))}
    </>
  );
});

const BaseMarker = memo(function BaseMarker({ base: b, colores }: { base: Base; colores: ColoresTema }) {
  const icono = iconoDiv({
    html: marcadorCuentaHtml({
      cuenta: b.unidades.length,
      color: colores.muted,
      fondo: colores.panel,
      contorno: CONTORNOS.parque,
      tamano: 22,
    }),
    tamano: [48, 22],
  });
  return (
    <Marker position={b.punto} icon={icono} zIndexOffset={-200}>
      <Tooltip direction="top" offset={DESPLAZAMIENTO_10}>
        <TooltipBase base={b} />
      </Tooltip>
      <Popup minWidth={240} autoPan={false}>
        <FichaBase base={b} />
      </Popup>
    </Marker>
  );
});

function TooltipBase({ base: b }: { base: Base }) {
  return (
    <>
      <span className="font-semibold">{b.nombre}</span>
      <br />
      {b.unidades.length} unidad(es) · {b.enBase} en base, {b.fuera} desplegada(s)
    </>
  );
}

function FichaBase({ base: b }: { base: Base }) {
  return (
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

// ---------------------------------------------------------------------------
// Capa de pueblos
// ---------------------------------------------------------------------------

const CapaPueblos = memo(function CapaPueblos({
  poblaciones,
  colores,
  incendioDe,
  onAvisar,
}: {
  poblaciones: Poblacion[];
  colores: ColoresTema;
  incendioDe?: (id: string) => Incendio | undefined;
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
      {poblaciones.map((p) => (
        <PuebloMarker key={p.id} poblacion={p} colores={colores} etiquetado={conEtiqueta.has(p.id)} incendioDe={incendioDe} onAvisar={onAvisar} />
      ))}
    </>
  );
});

const PuebloMarker = memo(function PuebloMarker({
  poblacion: p,
  colores,
  etiquetado,
  incendioDe,
  onAvisar,
}: {
  poblacion: Poblacion;
  colores: ColoresTema;
  etiquetado: boolean;
  incendioDe?: (id: string) => Incendio | undefined;
  onAvisar?: (p: Poblacion) => void | Promise<void>;
}) {
  const color = colores[colorRiesgo(p.riesgo)];
  const avisado = p.estadoAviso !== "sin_avisar";
  const centro = useMemo<[number, number]>(() => [p.centro.lat, p.centro.lon], [p.centro.lat, p.centro.lon]);
  const contenido = (
    <>
      <Tooltip direction="top" permanent={etiquetado} opacity={0.95}>
        <TooltipPueblo poblacion={p} avisado={avisado} />
      </Tooltip>
      <Popup autoPan={false}>
        <FichaPoblacion poblacion={p} incendioDe={incendioDe} onAvisar={onAvisar} />
      </Popup>
    </>
  );
  // Los de riesgo bajo son contexto: un punto pequeño en canvas, mucho más
  // barato que un círculo geográfico por cada uno.
  if (p.riesgo === "bajo") {
    return (
      <CircleMarker center={centro} radius={3} pathOptions={trazoPuebloBajo(color)}>
        {contenido}
      </CircleMarker>
    );
  }
  return (
    <Circle center={centro} radius={radioRiesgoM(p.riesgo)} pathOptions={trazoPueblo(color, avisado)}>
      {contenido}
    </Circle>
  );
});

function TooltipPueblo({ poblacion: p, avisado }: { poblacion: Poblacion; avisado: boolean }) {
  return (
    <>
      <span className="font-semibold">{p.nombre}</span> · {TEXTO_RIESGO[p.riesgo]}
      {avisado ? " · avisado" : ""}
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

function FichaPoblacion({
  poblacion: p,
  incendioDe,
  onAvisar,
}: {
  poblacion: Poblacion;
  incendioDe?: (id: string) => Incendio | undefined;
  onAvisar?: (p: Poblacion) => void | Promise<void>;
}) {
  const [ocupado, setOcupado] = useState(false);
  // El riesgo se FUNDAMENTA aquí (sesión riesgo-fundado): de qué foco viene, qué
  // dice el analista y con qué meteo. Una etiqueta suelta no vale para avisar a nadie.
  const foco = incendioDe?.(p.incendioId);
  const meteo = foco?.meteo;
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
        a {distancia(p.distanciaKm)} {foco ? <>de <span className="font-medium text-foreground">{foco.nombre}</span></> : "del foco"}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Insignia pequena tono={tonoRiesgo(p.riesgo)} punto>
          {TEXTO_RIESGO[p.riesgo]}
        </Insignia>
        <Insignia pequena tono={p.estadoAviso === "sin_avisar" ? "aviso" : "exito"}>{TEXTO_AVISO[p.estadoAviso]}</Insignia>
        {p.etaFrenteMin !== undefined ? <Insignia pequena tono="neutro">Frente en {minutos(p.etaFrenteMin)}</Insignia> : null}
        {foco ? (
          <Insignia pequena tono={tonoEstadoIncendio(foco.estado)} title={sinConfirmar(foco) ? "Una sola fuente: nadie ha confirmado este foco todavía" : undefined}>
            Foco {TEXTO_ESTADO_INCENDIO[foco.estado].toLowerCase()}
          </Insignia>
        ) : null}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted">
        <span className="font-medium text-foreground">Por qué:</span>{" "}
        {p.motivoRiesgo ?? "riesgo provisional por distancia; el analista de propagación todavía no ha calculado la llegada del frente."}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-subtle">
        {meteo ? (
          <>
            Meteo en el foco: viento {viento(meteo.direccionGrados, meteo.vientoKmh, meteo.rachasKmh, meteo.direccionTexto)} · {numero(meteo.temperaturaC)} °C · HR{" "}
            {numero(meteo.humedadPct)} %{foco ? <> · <EnlaceMeteo incendio={foco} /></> : null}
          </>
        ) : (
          "Sin meteo del foco todavía: el riesgo es solo por distancia."
        )}
      </p>
      {foco && sinConfirmar(foco) ? (
        <p className="mt-1 text-[11px] leading-snug text-muted">
          Foco sin confirmar (una sola fuente): no se avisa a nadie hasta que otra fuente o el mando lo confirme.
        </p>
      ) : null}
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

// ---------------------------------------------------------------------------
// Cámaras vigiladas, hospitales, satélite y focos fusionados
// ---------------------------------------------------------------------------

const CapaCamaras = memo(function CapaCamaras({
  camaras,
  colores,
  onVigilar,
}: {
  camaras: Camara[];
  colores: ColoresTema;
  onVigilar?: (id: string, v: boolean) => void | Promise<void>;
}) {
  return (
    <>
      {camaras.map((c) => (
        <CamaraMarker key={c.id} camara={c} colores={colores} onVigilar={onVigilar} />
      ))}
    </>
  );
});

const CamaraMarker = memo(function CamaraMarker({
  camara: c,
  colores,
  onVigilar,
}: {
  camara: Camara;
  colores: ColoresTema;
  onVigilar?: (id: string, v: boolean) => void | Promise<void>;
}) {
  const esMovil = c.fuente === "Movil";
  const positiva = c.ultimoAnalisis?.humo || c.ultimoAnalisis?.fuego;
  const color = positiva ? colores.danger : esMovil ? colores.brand : c.vigilada ? colores.info : colores.muted;
  const centro = useMemo<[number, number]>(() => [c.punto.lat, c.punto.lon], [c.punto.lat, c.punto.lon]);
  const icono = iconoDiv({
    html: marcadorHtml({
      contorno: esMovil ? CONTORNOS.movil : CONTORNOS.camara,
      color,
      fondo: colores.panel,
      etiqueta: esMovil ? c.nombre : undefined,
      anillo: c.vigilada || esMovil,
      pulso: Boolean(positiva) || esMovil,
      tamano: 24,
    }),
    tamano: [24, 24],
  });
  return (
    <Marker position={centro} icon={icono}>
      <Popup minWidth={260} autoPan={false}>
        <PopupCamara camara={c} onVigilar={onVigilar ?? noOp} />
      </Popup>
    </Marker>
  );
});

function noOp() {
  /* sin acción: la cámara se puede ver pero no vigilar desde aquí */
}

const FocoFusionado = memo(function FocoFusionado({
  foco,
  nombreDestino,
  colores,
}: {
  foco: Incendio;
  nombreDestino: string;
  colores: ColoresTema;
}) {
  const centro = useMemo<[number, number]>(() => [foco.centro.lat, foco.centro.lon], [foco.centro.lat, foco.centro.lon]);
  return (
    <CircleMarker center={centro} radius={4} pathOptions={trazoPuntoFusionado(colores.muted)}>
      <Tooltip>
        <TooltipFusionado nombre={foco.nombre} destino={nombreDestino} />
      </Tooltip>
    </CircleMarker>
  );
});

function TooltipFusionado({ nombre, destino }: { nombre: string; destino: string }) {
  return (
    <>
      {nombre} · unido a {destino}
    </>
  );
}

const HospitalMarker = memo(function HospitalMarker({
  hospital: h,
  colores,
}: {
  hospital: NonNullable<Snapshot["hospitales"]>[number];
  colores: ColoresTema;
}) {
  const centro = useMemo<[number, number]>(() => [h.punto.lat, h.punto.lon], [h.punto.lat, h.punto.lon]);
  const icono = iconoDiv({
    html: marcadorHtml({ contorno: CONTORNOS.hospital, color: colores.info, fondo: colores.panel, tamano: 22 }),
    tamano: [22, 22],
  });
  return (
    <Marker position={centro} icon={icono}>
      <Tooltip direction="top" offset={DESPLAZAMIENTO_10}>
        <TooltipHospital hospital={h} />
      </Tooltip>
    </Marker>
  );
});

function TooltipHospital({ hospital: h }: { hospital: NonNullable<Snapshot["hospitales"]>[number] }) {
  return (
    <>
      {h.nombre} · {h.tipo === "hospital" ? "Hospital" : "Centro de salud"}
      {h.distanciaKm !== undefined ? ` · a ${distancia(h.distanciaKm)}` : ""}
    </>
  );
}

const PuntoSatelite = memo(function PuntoSatelite({ foco: f, colores }: { foco: FocoSatelite; colores: ColoresTema }) {
  const centro = useMemo<[number, number]>(() => [f.punto.lat, f.punto.lon], [f.punto.lat, f.punto.lon]);
  return (
    <CircleMarker center={centro} radius={Math.max(3, Math.min(9, Math.sqrt(f.frp || 1)))} pathOptions={trazoPuntoSatelite(colores.fuego)}>
      <Tooltip>
        <TooltipSatelite foco={f} />
      </Tooltip>
    </CircleMarker>
  );
});

function TooltipSatelite({ foco: f }: { foco: FocoSatelite }) {
  return (
    <>
      {f.fuente} · FRP {numero(f.frp, 1)} MW · confianza {f.confianza} · {haceCuanto(f.fechaHora)}
    </>
  );
}

// ---------------------------------------------------------------------------
// Capa de viento
// ---------------------------------------------------------------------------

const CapaViento = memo(function CapaViento({
  incendios,
  zonas,
  colores,
}: {
  incendios: Incendio[];
  zonas: ZonaPeligroMapa[];
  colores: ColoresTema;
}) {
  return (
    <>
      {incendios.map((inc) => (inc.meteo ? <VientoFoco key={inc.id} incendio={inc} colores={colores} /> : null))}
      {zonas.map((z) => (
        <VientoZona key={z.id} zona={z} colores={colores} />
      ))}
    </>
  );
});

const VientoFoco = memo(function VientoFoco({ incendio: inc, colores }: { incendio: Incendio; colores: ColoresTema }) {
  const { lat, lon } = inc.centro;
  const direccion = inc.meteo?.direccionGrados;
  const velocidad = inc.meteo?.vientoKmh;
  // Dependencias primitivas: 25 flechas por foco no se recalculan (ni se
  // reenvían a Leaflet) porque el snapshot traiga objetos nuevos.
  const flechas = useMemo(
    () =>
      direccion === undefined || velocidad === undefined
        ? []
        : rejillaViento({ lat, lon }, direccion, velocidad, { lado: 5, separacionM: 5000 }),
    [lat, lon, direccion, velocidad],
  );
  return (
    <>
      {flechas.map((f, i) => (
        <Flecha key={i} flecha={f} color={colorVelocidad(f.velocidadKmh, colores)} />
      ))}
    </>
  );
});

const VientoZona = memo(function VientoZona({ zona: z, colores }: { zona: ZonaPeligroMapa; colores: ColoresTema }) {
  const { lat, lon } = z.punto;
  const flecha = useMemo(
    () => flechaViento({ lat, lon }, z.direccionGrados, z.velocidadKmh, 3000),
    [lat, lon, z.direccionGrados, z.velocidadKmh],
  );
  const centro = useMemo<[number, number]>(() => [lat, lon], [lat, lon]);
  return (
    <>
      <Flecha flecha={flecha} color={colorVelocidad(z.velocidadKmh, colores)} />
      <CircleMarker center={centro} radius={4} pathOptions={trazoPuntoZona(colorPeligroZona(z.nivel, colores))}>
        <Tooltip>
          <TooltipZona zona={z} />
        </Tooltip>
      </CircleMarker>
    </>
  );
});

const Flecha = memo(function Flecha({ flecha: f, color }: { flecha: FlechaViento; color: string }) {
  const cuerpo = useMemo<[number, number][]>(() => [f.desde, f.hasta], [f.desde, f.hasta]);
  const opciones = trazoViento(color, Math.max(1.2, Math.min(3.2, f.velocidadKmh / 14)));
  return (
    <>
      <Polyline positions={cuerpo} pathOptions={opciones} />
      <Polyline positions={f.punta} pathOptions={opciones} />
    </>
  );
});

function TooltipZona({ zona: z }: { zona: ZonaPeligroMapa }) {
  return (
    <>
      {z.etiqueta ?? "Zona de peligro"} · viento {viento(z.direccionGrados, z.velocidadKmh)}
      {z.nivel ? ` · ${TEXTO_PELIGRO[z.nivel]}` : ""}
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

function MapaClienteBase({
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
  zona = null,
  focosTotales,
  focosEnZona,
  onZonaDibujada,
  onQuitarZona,
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
  /** Qué acaba de encuadrar el botón "Ver todo" o "Ver en el mapa" (se lee en voz alta y se ve unos segundos). */
  const [avisoEncuadre, setAvisoEncuadre] = useState<{ texto: string; icono: "encuadre" | "centrado"; sello: number } | null>(null);
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
  // Filtro "solo en incendios" de unidades, bases y hospitales (ver ./filtroParticipantes).
  const [soloIncendios, setSoloIncendios] = useState<Record<CapaFiltrable, boolean>>(leerFiltros);
  const alternarSoloIncendios = useCallback((id: CapaFiltrable) => {
    setSoloIncendios((f) => guardarFiltros({ ...f, [id]: !f[id] }));
  }, []);
  /** Cámara del catálogo abierta ahora mismo (su ficha se pinta con React). */
  const [camaraElegida, setCamaraElegida] = useState<Camara | null>(null);

  // Las callbacks del padre se estabilizan aquí: `app/page.tsx` las escribe en
  // línea, y sin esto cada render de la sala invalidaría el memo de TODOS los
  // marcadores del mapa.
  const alSeleccionarIncendio = useEstable(onSeleccionarIncendio);
  const alClicMapa = useEstable(onClicMapa);
  const alAvisarPoblacion = useEstable(onAvisarPoblacion);
  const alVigilarCamara = useEstable(onVigilarCamara);
  const alOrdenarUnidad = useEstable(onOrdenarUnidad);
  const alRetirarUnidad = useEstable(onRetirarUnidad);
  const alCambiarEstadoFoco = useEstable(onCambiarEstadoFoco);
  const alRefrescar = useEstable(onRefrescar);
  const alZonaDibujada = useEstable(onZonaDibujada);
  const alQuitarZona = useEstable(onQuitarZona);

  // --- Filtro por zona (recuadro o lazo; ver ./SeleccionZona) ---------------
  /** Modo de dibujo de la zona (null = no se está dibujando). */
  const [modoZona, setModoZona] = useState<TipoZona | null>(null);
  const terminarZona = useCallback(
    (z: ZonaSeleccion) => {
      setModoZona(null);
      alZonaDibujada?.(z);
    },
    [alZonaDibujada],
  );
  const cancelarZona = useCallback(() => setModoZona(null), []);
  const quitarZona = useCallback(() => {
    setModoZona(null);
    alQuitarZona?.();
  }, [alQuitarZona]);
  // Zona nueva (recién dibujada o recuperada al cargar): se encuadra una vez.
  // `creadaEn` hace de sello, así que un snapshot nuevo no vuelve a moverlo.
  const selloZona = useRef(0);
  useEffect(() => {
    if (!mapa || !zona || zona.creadaEn === selloZona.current) return;
    selloZona.current = zona.creadaEn;
    mapa.stop();
    mapa.fitBounds(limitesZona(zona), { padding: [48, 48], maxZoom: 13, animate: true });
  }, [mapa, zona]);

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
  // EXCEPCIÓN: el foco seleccionado en el panel se pinta SIEMPRE. Si no,
  // "Centrar en el mapa" sobre un foco de satélite llevaba a un punto vacío y
  // parecía que el botón no hacía nada.
  const visibles = useMemo(
    () =>
      (snapshot?.incendios ?? []).filter(
        (i) =>
          i.id === incendioSeleccionado ||
          capas.satelite ||
          !(i.origen === "satelite" && (i.estado === "detectado" || i.estado === "fusionado")),
      ),
    [snapshot?.incendios, capas.satelite, incendioSeleccionado],
  );
  // Los descartados no se pintan; los fusionados dejan solo un punto gris con
  // "unido a <nombre>" para que se entienda a dónde ha ido ese foco.
  const enCurso = useMemo(
    () => visibles.filter((i) => i.estado !== "descartado" && i.estado !== "fusionado"),
    [visibles],
  );
  // Controlados y extinguidos se van del mapa a los 5 s de verlos así (./useOcultarTerminados).
  const incendios = useOcultarTerminados(enCurso);
  /** Con la capa "Focos" apagada solo se dibuja el seleccionado (por el mismo motivo). */
  const incendiosDibujados = useMemo(
    () => (capas.focos ? incendios : incendios.filter((i) => i.id === incendioSeleccionado)),
    [capas.focos, incendios, incendioSeleccionado],
  );
  const fusionados = useMemo(() => visibles.filter((i) => i.estado === "fusionado"), [visibles]);
  const activos = useMemo(
    () => enCurso.filter((i) => !["extinguido", "controlado"].includes(i.estado)),
    [enCurso],
  );
  // Sobre la lista SIN ocultar: las unidades que rematan un controlado ya
  // invisible siguen enlazadas a su foco (ruta, nombre en la ficha).
  const porIncendio = useMemo(() => new Map(enCurso.map((i) => [i.id, i])), [enCurso]);
  const unidades = useMemo(() => snapshot?.unidades ?? [], [snapshot?.unidades]);
  const poblaciones = useMemo(() => snapshot?.poblaciones ?? [], [snapshot?.poblaciones]);
  // Solo los pueblos de los focos que se están DIBUJANDO (sesión riesgo-fundado,
  // 2026-09-19): los de un foco descartado, extinguido o de satélite sin
  // confirmar con esa capa apagada no tienen frente que los amenace, y dejaban
  // "Riesgo inminente" flotando sin ningún foco a la vista. La clave es un texto
  // para que el filtro no se recalcule cada vez que un foco cambia de perímetro.
  const clavesDibujados = incendios.map((i) => i.id).join("|");
  const poblacionesVisibles = useMemo(() => {
    const dibujados = new Set(clavesDibujados ? clavesDibujados.split("|") : []);
    return poblaciones.filter((p) => dibujados.has(p.incendioId));
  }, [clavesDibujados, poblaciones]);
  // Getter ESTABLE para la ficha del pueblo (solo se lee al abrir su popup):
  // así los cientos de marcadores memorizados no se repintan cuando cambia un foco.
  const porIncendioRef = useRef(porIncendio);
  useEffect(() => {
    porIncendioRef.current = porIncendio;
  }, [porIncendio]);
  const incendioDe = useCallback((id: string) => porIncendioRef.current.get(id), []);
  const hospitales = useMemo(() => snapshot?.hospitales ?? [], [snapshot?.hospitales]);
  const camaras = useMemo(() => snapshot?.camaras ?? [], [snapshot?.camaras]);
  const satelite = useMemo(() => snapshot?.focosSatelite ?? [], [snapshot?.focosSatelite]);
  const avisos = useMemo(() => snapshot?.avisosMeteo ?? [], [snapshot?.avisosMeteo]);
  // Depende de la LISTA cruda, no del snapshot entero: así no se recalculan las
  // zonas (ni se repinta la capa de viento) cada vez que se mueve una unidad.
  const crudoZonas = listaZonasCruda(snapshot);
  const zonas = useMemo(() => zonasPeligroDeLista(crudoZonas), [crudoZonas]);
  const bases = useMemo(() => agruparBases(unidades), [unidades]);
  // Filtro "solo en incendios": lo que se pinta de cada capa con su casilla marcada.
  // Dependen de la porción (unidades, bases, hospitales) y del booleano, no del snapshot entero.
  // EXCEPCIÓN: la unidad que el mando ha pedido ver ("Ver en el mapa" en una
  // decisión) se pinta SIEMPRE, aunque siga en su base con el filtro puesto o
  // el snapshot recortado a una zona ya no la traiga (vale la copia que viaja
  // en la petición). Si no, el mapa se movía a un parque vacío y parecía que el
  // botón no hacía nada.
  const unidadResaltada = centrarEn?.unidad;
  const unidadesVisibles = useMemo(() => {
    const visibles = soloIncendios.unidades ? unidades.filter(unidadParticipa) : unidades;
    if (!unidadResaltada || visibles.some((u) => u.id === unidadResaltada.id)) return visibles;
    return [...visibles, unidades.find((u) => u.id === unidadResaltada.id) ?? unidadResaltada];
  }, [soloIncendios.unidades, unidades, unidadResaltada]);
  /** Con la capa "Unidades" apagada solo se dibuja la pedida (misma excepción que el foco seleccionado). */
  const unidadesDibujadas = useMemo(
    () => (capas.unidades ? unidadesVisibles : unidadesVisibles.filter((u) => u.id === unidadResaltada?.id)),
    [capas.unidades, unidadesVisibles, unidadResaltada?.id],
  );
  const basesVisibles = useMemo(
    () => (soloIncendios.bases ? bases.filter((b) => b.unidades.some(unidadParticipa)) : bases),
    [soloIncendios.bases, bases],
  );
  const hospitalesVisibles = useMemo(
    () => (soloIncendios.hospitales ? hospitalesParticipantes(hospitales, unidades, activos) : hospitales),
    [soloIncendios.hospitales, hospitales, unidades, activos],
  );
  const poblacionesPorFoco = useMemo(() => {
    const mapa = new Map<string, Poblacion[]>();
    for (const p of poblaciones) {
      if (!p.incendioId) continue;
      const lista = mapa.get(p.incendioId);
      if (lista) lista.push(p);
      else mapa.set(p.incendioId, [p]);
    }
    return mapa;
  }, [poblaciones]);

  // Catálogo completo de cámaras de España (solo si la capa está encendida).
  const catalogo = useCamarasEspana(capas.camarasEspana);
  const clavesVigiladas = camaras.map((c) => c.id).join("|");
  const vigiladasIds = useMemo(() => new Set(clavesVigiladas ? clavesVigiladas.split("|") : []), [clavesVigiladas]);
  const elegirCamara = useCallback((c: Camara) => setCamaraElegida(c), []);
  /** La del snapshot manda (lleva vigilada, veredicto e historial). */
  const camaraAbierta = useMemo(
    () => (camaraElegida ? (camaras.find((c) => c.id === camaraElegida.id) ?? camaraElegida) : null),
    [camaraElegida, camaras],
  );

  const accionesUnidad: AccionesUnidad = useMemo(
    () => ({ onOrdenarDestino: alOrdenarUnidad, onRetirar: alRetirarUnidad }),
    [alOrdenarUnidad, alRetirarUnidad],
  );

  const limitesFocos = useMemo(() => {
    const puntos: [number, number][] = [];
    for (const i of activos.length ? activos : incendios) {
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
    setAvisoEncuadre({ texto, icono: "encuadre", sello: Date.now() });
  }, [activos.length, incendios.length, limitesFocos, mapa]);

  /**
   * Acuse de recibo de "Ver en el mapa" sobre una unidad: dice QUÉ se ha
   * centrado y en qué estado está. Importa sobre todo cuando la unidad sigue en
   * su base: el parque puede estar a un par de pantallas del foco que se estaba
   * mirando y, sin el aviso, el movimiento del mapa pasaba desapercibido.
   */
  const anunciarCentrado = useCallback((p: PeticionEncuadre) => {
    const u = p.unidad;
    if (!u) return;
    const enBase = u.estado === "disponible" || u.estado === "fuera_servicio";
    const estado = enBase ? "en su base, sin desplegar" : TEXTO_ESTADO_UNIDAD[u.estado].toLowerCase();
    setAvisoEncuadre({ texto: `Centrado en ${u.nombre} (${estado})`, icono: "centrado", sello: Date.now() });
  }, []);

  // El aviso del encuadre se borra solo: es un acuse de recibo, no un estado.
  useEffect(() => {
    if (!avisoEncuadre) return;
    const id = setTimeout(() => setAvisoEncuadre(null), avisoEncuadre.icono === "centrado" ? 4000 : 2500);
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

  const anotarGesto = useCallback(() => {
    ultimoGesto.current = Date.now();
  }, []);

  const conPrediccion = capas.prediccion;
  const filas: FilaCapa[] = useMemo(
    () => [
      { id: "focos", etiqueta: "Focos y perímetros", cuenta: incendios.length, color: colores.danger, ayuda: "Aún no hay ningún foco declarado" },
      { id: "prediccion", etiqueta: "Predicción +1/+3/+6 h", cuenta: incendios.filter((i) => i.prediccion).length, color: colores.fuego2, ayuda: "La calcula el analista de propagación" },
      {
        id: "unidades",
        etiqueta: "Unidades",
        cuenta: unidades.length,
        color: colores.danger,
        ayuda: "Aparecen al enriquecer un foco con los parques reales",
        filtro: { ...TEXTO_FILTRO.unidades, activo: soloIncendios.unidades, cuenta: unidadesVisibles.length, onCambiar: () => alternarSoloIncendios("unidades") },
      },
      {
        id: "bases",
        etiqueta: "Bases y parques",
        cuenta: bases.length,
        color: colores.muted,
        ayuda: "De dónde sale cada unidad (parques, cuarteles, bases BRIF)",
        filtro: { ...TEXTO_FILTRO.bases, activo: soloIncendios.bases, cuenta: basesVisibles.length, onCambiar: () => alternarSoloIncendios("bases") },
      },
      { id: "pueblos", etiqueta: "Pueblos por riesgo", cuenta: poblacionesVisibles.length, color: colores.riesgoAlto, ayuda: "Salen de OpenStreetMap alrededor de cada foco dibujado" },
      {
        id: "hospitales",
        etiqueta: "Hospitales",
        cuenta: hospitales.length,
        color: colores.info,
        ayuda: "Centros sanitarios cercanos (OSM)",
        filtro: { ...TEXTO_FILTRO.hospitales, activo: soloIncendios.hospitales, cuenta: hospitalesVisibles.length, onCambiar: () => alternarSoloIncendios("hospitales") },
      },
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
      { id: "satelite", etiqueta: "Satélite (FRP)", cuenta: satelite.length, color: colores.fuego, ayuda: "Detecciones VIIRS/MODIS de NASA FIRMS. Apagada, oculta también los focos que solo ha visto el satélite y nadie ha confirmado (salvo el que tengas seleccionado)" },
      { id: "avisos", etiqueta: "Avisos meteo", cuenta: avisos.length, color: colores.warning, ayuda: "AEMET / Meteoalarm" },
      { id: "fueraEspana", etiqueta: "Fuera de España", cuenta: 0, color: colores.danger, ayuda: "El resto del mundo en rojo: el sistema solo trabaja el territorio español" },
    ],
    [alternarSoloIncendios, avisos.length, bases.length, basesVisibles.length, camaras.length, catalogo.camaras.length, catalogo.cargando, catalogo.error, colores, hospitales.length, hospitalesVisibles.length, incendios, poblacionesVisibles.length, satelite.length, soloIncendios, unidades.length, unidadesVisibles.length, zonas.length],
  );

  const leyenda = useMemo(
    () =>
      [
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
        capas.fueraEspana ? { color: colores.danger, forma: "area" as const, texto: "Fuera de España: zona excluida" } : null,
      ].filter((e): e is { color: string; forma: "linea" | "punto" | "area" | "discontinua"; texto: string } => e !== null),
    [capas, colores],
  );

  const iconoCamaraAbierta = useMemo(
    () =>
      iconoDiv({
        html: marcadorHtml({ contorno: CONTORNOS.camara, color: colores.brand, fondo: colores.panel, anillo: true, tamano: 26 }),
        tamano: [26, 26],
      }),
    [colores.brand, colores.panel],
  );
  const cerrarCamara = useMemo(() => ({ popupclose: () => setCamaraElegida(null) }), []);

  return (
    <div className="relative isolate size-full overflow-hidden">
      <MapContainer
        ref={setMapa}
        center={[40.2, -3.7]}
        zoom={6}
        bounds={LIMITES_ESPANA}
        maxBounds={LIMITES_NAVEGACION}
        maxBoundsViscosity={0.8}
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
        <ColocadorPopups />
        <DetectorGestos alMover={anotarGesto} />
        <CapturaClic activo={(modoDeclarar || Boolean(unidadOrdenando)) && !modoZona} onClic={alClicMapa} />
        <CursorDeclarar activo={modoDeclarar || Boolean(unidadOrdenando)} />
        <Encuadre limitesFocos={limitesFocos} centrarEn={centrarEn} ultimoGesto={ultimoGesto} alCentrar={anunciarCentrado} />

        {/* Lo primero de todo: el resto del mundo en rojo (zona excluida), con
            el contorno real de España como agujero. Todo lo demás va encima. */}
        {capas.fueraEspana ? <CapaFueraEspana colores={colores} /> : null}

        {/* Las ~2.300 cámaras del catálogo van las primeras: quedan DEBAJO de
            todo lo operativo y nunca tapan un foco ni una unidad. */}
        {capas.camarasEspana && catalogo.camaras.length > 0 ? (
          <CapaCamarasEspana camaras={catalogo.camaras} vigiladasIds={vigiladasIds} colores={colores} onSeleccionar={elegirCamara} />
        ) : null}
        {camaraAbierta ? (
          <Marker
            position={aLatLng(camaraAbierta.punto)}
            icon={iconoCamaraAbierta}
            ref={(m) => {
              m?.openPopup();
            }}
            eventHandlers={cerrarCamara}
          >
            <Popup minWidth={260} autoPan={false}>
              <PopupCamara camara={camaraAbierta} onVigilar={alVigilarCamara ?? noOp} />
            </Popup>
          </Marker>
        ) : null}

        {/* Filtro por zona: atenúa lo de fuera; lo operativo de dentro va encima. */}
        {zona ? <CapaZona zona={zona} colores={colores} /> : null}

        {capas.viento ? <CapaViento incendios={incendios} zonas={zonas} colores={colores} /> : null}
        {capas.bases ? <CapaBases bases={basesVisibles} colores={colores} /> : null}
        {capas.focos || incendiosDibujados.length > 0 ? (
          <CapaFocos
            incendios={incendiosDibujados}
            poblacionesPorFoco={poblacionesPorFoco}
            colores={colores}
            seleccionado={incendioSeleccionado}
            onSeleccionar={alSeleccionarIncendio}
            conPrediccion={conPrediccion}
            onCambiarEstadoFoco={alCambiarEstadoFoco}
            onRefrescar={alRefrescar}
          />
        ) : null}
        {/* Focos absorbidos por otro: un punto gris discreto, nada más. */}
        {capas.focos
          ? fusionados.map((f) => (
              <FocoFusionado
                key={f.id}
                foco={f}
                nombreDestino={(f.fusionadoEn ? porIncendio.get(f.fusionadoEn)?.nombre : undefined) ?? "otro foco"}
                colores={colores}
              />
            ))
          : null}
        {capas.pueblos ? <CapaPueblos poblaciones={poblacionesVisibles} colores={colores} incendioDe={incendioDe} onAvisar={alAvisarPoblacion} /> : null}
        <CapaUnidades
          unidades={unidadesDibujadas}
          resaltadaId={unidadResaltada?.id}
          porIncendio={porIncendio}
          colores={colores}
          acciones={accionesUnidad}
        />
        {capas.camaras ? <CapaCamaras camaras={camaras} colores={colores} onVigilar={alVigilarCamara} /> : null}
        {capas.hospitales ? hospitalesVisibles.map((h) => <HospitalMarker key={h.id} hospital={h} colores={colores} />) : null}
        {capas.satelite ? satelite.map((f) => <PuntoSatelite key={f.id} foco={f} colores={colores} />) : null}
        {/* Filtro por zona: el trazo en curso, por encima de todo. */}
        <DibujoZona modo={modoZona} colores={colores} onTerminar={terminarZona} onCancelar={cancelarZona} />
      </MapContainer>

      <PanelCapas
        filas={filas}
        activas={capas}
        onAlternar={alternar}
        onEncuadrar={encuadrarTodo}
        extra={<ControlesZona modo={modoZona} onElegirModo={setModoZona} />}
      />
      <Leyenda entradas={leyenda} />

      {/* Acuse de recibo de "Ver todo" y de "Ver en el mapa": el mando ve que el
          botón ha hecho algo aunque el mapa ya estuviera casi encuadrado. */}
      <div aria-live="polite" className="pointer-events-none absolute inset-x-0 top-12 z-[940] flex justify-center px-4">
        {avisoEncuadre ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/50 bg-panel px-3 py-1 text-[12px] font-medium text-brand shadow-[var(--sombra-flotante)]">
            {avisoEncuadre.icono === "centrado" ? <Crosshair className="size-3.5 shrink-0" aria-hidden /> : <Maximize2 className="size-3.5 shrink-0" aria-hidden />}{" "}
            {avisoEncuadre.texto}
          </span>
        ) : null}
      </div>

      {/* Avisos meteo: no tienen geometría, se listan como pastillas arriba a la izquierda. */}
      {capas.avisos && avisos.length > 0 ? (
        <div className={`pointer-events-none absolute left-2 ${zona ? "top-24" : "top-12"} z-[880] flex max-w-[15.5rem] flex-col gap-1`}>
          {avisos.slice(0, 3).map((a) => (
            <span
              key={a.id}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-warning/45 bg-panel px-2 py-1 text-[11px] font-medium text-warning shadow-sm"
            >
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                Aviso {a.nivel} · {a.fenomeno} · {a.zona}
              </span>
            </span>
          ))}
        </div>
      ) : null}

      {/* Estado vacío: sin focos EN CURSO (los terminados ocultos no cuentan como "ninguno"), el mapa explica qué hacer. */}
      {snapshot && enCurso.length === 0 && !zona ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 z-[880] flex justify-center px-4">
          <div className="pointer-events-auto max-w-md rounded-xl border border-panel-border bg-panel px-4 py-3 text-center shadow-[var(--sombra-flotante)]">
            <p className="flex items-center justify-center gap-2 text-sm font-semibold text-foreground">
              <Flame className="size-4 text-fuego" aria-hidden /> Todavía no hay ningún foco
            </p>
            <p className="mt-1 text-[13px] leading-snug text-muted">
              Declara uno con la tecla <kbd className="rounded border border-panel-border-strong bg-panel-2 px-1">F</kbd> y un clic en el mapa
              (Esc cancela; el botón «Declarar foco» está en el modo desarrollo): los agentes empezarán a trabajar solos.
            </p>
          </div>
        </div>
      ) : null}
      {/* Filtro por zona: sin focos dentro se dice que es el filtro, no que no haya. */}
      {snapshot && zona && enCurso.length === 0 ? <AvisoZonaVacia zona={zona} total={focosTotales ?? 0} onQuitar={quitarZona} /> : null}

      {/* Filtro por zona: aviso del modo de dibujo (manda sobre el de declarar). */}
      {modoZona ? <AvisoDibujoZona modo={modoZona} /> : null}
      {/* Filtro por zona: banda con "Quitar filtro" mientras haya zona y ningún modo la tape. */}
      {zona && !modoZona && !modoDeclarar && !unidadOrdenando ? (
        <BandaZona zona={zona} dentro={focosEnZona ?? enCurso.length} total={focosTotales ?? enCurso.length} onQuitar={quitarZona} />
      ) : null}

      {/* Aviso del modo declarar. */}
      {modoDeclarar && !modoZona ? (
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
            className={`inline-flex items-center gap-1.5 rounded-lg border bg-panel px-2 py-1 text-[11px] font-medium shadow-sm ${
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

/**
 * La raíz va memoizada: con el mismo snapshot y las mismas props, la sala puede
 * repintarse (reloj, pestañas, diálogos) sin arrastrar al mapa consigo.
 */
export const MapaCliente = memo(MapaClienteBase);
