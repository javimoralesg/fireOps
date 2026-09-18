"use client";

// Sala de periféricos: la pantalla que se proyecta durante la demo mientras el
// jurado usa sus móviles. A la izquierda cómo unirse y quién está conectado, en
// el centro el mapa real con todo lo que entra y las cámaras municipales, a la
// derecha lo que se ha observado y lo que se ha publicado.
//
// El estado del sistema viene de useEstado() (el mismo de la consola, con
// fixture si no hay backend); los periféricos, cámaras y publicaciones de
// usePerifericos(). CapasPerifericos se carga con dynamic ssr:false porque
// importa Leaflet, que necesita window.

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { LatLngBoundsExpression } from "leaflet";
import { ArrowLeft, MessagesSquare, Radar } from "lucide-react";
import { Logo } from "@/components/marca/Logo";
import { SelectorTema } from "@/components/marca/SelectorTema";
import { MapaBase } from "@/components/mapa/MapaBase";
import { penachoDesdeViento } from "@/components/mapa/geo";
import { CamarasTrafico } from "@/components/perifericos/CamarasTrafico";
import { FeedObservaciones, esObservacion } from "@/components/perifericos/FeedObservaciones";
import { MuroPublicaciones } from "@/components/perifericos/MuroPublicaciones";
import { PanelPerifericos } from "@/components/perifericos/PanelPerifericos";
import { QrUnirse } from "@/components/perifericos/QrUnirse";
import { Aviso } from "@/components/perifericos/ui-sala";
import { usePerifericos } from "@/lib/usePerifericos";
import { useEstado } from "@/lib/useEstado";

// Solo cliente: arrastra leaflet/react-leaflet, que usan window al importarse.
const CapasPerifericos = dynamic(
  () => import("@/components/perifericos/CapasPerifericos").then((m) => m.CapasPerifericos),
  { ssr: false, loading: () => null },
);

type Pestana = "observaciones" | "publicaciones";

const ZOOM = 15;

export default function PaginaSalaPerifericos() {
  const { estado, conexion } = useEstado();
  const sala = usePerifericos();
  const [pestana, setPestana] = useState<Pestana>("observaciones");
  const [seleccionId, setSeleccionId] = useState<string | null>(null);

  const nodos = useMemo(() => estado?.nodos ?? [], [estado]);
  const nodosConGeo = useMemo(() => nodos.filter((n) => typeof n.lat === "number" && typeof n.lon === "number"), [nodos]);
  const observaciones = useMemo(() => (estado?.eventos ?? []).filter(esObservacion), [estado]);

  const centro = useMemo(
    () => estado?.incidente.ubicacion ?? { nombre: "Incidente", lat: 40.3935, lon: -3.679 },
    [estado],
  );

  const penacho = useMemo(() => {
    const servidor = estado?.entorno.penacho;
    if (servidor) return { rumboGrados: servidor.rumboGrados, longitudM: servidor.longitudM, semianguloGrados: servidor.semianguloGrados };
    return estado ? penachoDesdeViento(estado.entorno.viento) : undefined;
  }, [estado]);

  /** Encuadre: todo lo que tiene coordenadas (vértices, periféricos, cámaras) más el incidente. */
  const encuadre = useMemo<LatLngBoundsExpression | undefined>(() => {
    const puntos: [number, number][] = [[centro.lat, centro.lon]];
    for (const n of nodosConGeo) puntos.push([n.lat as number, n.lon as number]);
    for (const p of sala.perifericos) if (p.posicion) puntos.push([p.posicion.lat, p.posicion.lon]);
    for (const c of sala.camaras) puntos.push([c.lat, c.lon]);
    if (puntos.length < 2) return undefined;
    const lats = puntos.map((p) => p[0]);
    const lons = puntos.map((p) => p[1]);
    return [
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)],
    ];
  }, [centro.lat, centro.lon, nodosConGeo, sala.perifericos, sala.camaras]);

  const sinCoordenadas = Boolean(estado) && nodos.length > 0 && nodosConGeo.length === 0;

  /** Si el grafo todavía no tiene coordenadas, al menos se ve dónde es el incidente. */
  const marcadores = useMemo(
    () =>
      nodosConGeo.some((n) => n.tipo === "Incidencia")
        ? undefined
        : [{ id: "incidente", lat: centro.lat, lon: centro.lon, etiqueta: centro.nombre ?? "Incidente", tono: "danger" as const }],
    [nodosConGeo, centro],
  );

  const PESTANAS: { id: Pestana; etiqueta: string; icon: typeof Radar; badge: number }[] = [
    { id: "observaciones", etiqueta: "Observaciones", icon: Radar, badge: observaciones.length },
    { id: "publicaciones", etiqueta: "Publicaciones", icon: MessagesSquare, badge: sala.publicaciones.length },
  ];

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-panel-border bg-panel px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <Logo descriptor={false} vivo />
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-bold text-foreground">Sala de periféricos · inputs reales</h1>
            <p className="truncate text-[11px] text-muted">
              Móviles, cámaras municipales y publicaciones entrando en directo sobre el mapa real
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="pildora pildora-exito font-mono">{sala.enLinea} en línea</span>
          <span className="pildora font-mono">{sala.perifericos.length} periféricos</span>
          <span className="pildora font-mono">{sala.camaras.length} cámaras</span>
          <span className="pildora font-mono">{observaciones.length} observaciones</span>
          <span className={`pildora ${conexion === "en_vivo" ? "pildora-exito" : conexion === "fixture" ? "pildora-aviso" : ""}`}>
            {conexion === "en_vivo" ? "En vivo" : conexion === "fixture" ? "Sin backend" : "Conectando"}
          </span>
          <SelectorTema />
          <Link href="/" className="boton boton-secundario boton-sm">
            <ArrowLeft className="size-3.5" aria-hidden />
            Consola
          </Link>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(300px,0.95fr)_minmax(0,1.8fr)_minmax(340px,1.05fr)] lg:overflow-hidden">
        {/* Izquierda: cómo unirse y quién está */}
        <aside className="flex min-h-0 flex-col gap-3 lg:overflow-hidden">
          <QrUnirse
            className="shrink-0"
            urlUnion={sala.urlUnion}
            urlSegura={sala.urlSegura}
            origenUrl={sala.origenUrl}
            cargando={sala.estadoPerifericos.cargando}
            ausente={sala.estadoPerifericos.ausente}
            error={sala.estadoPerifericos.error}
          />
          <PanelPerifericos
            className="min-h-[220px] flex-1"
            perifericos={sala.perifericos}
            incidente={centro}
            cargando={sala.estadoPerifericos.cargando}
            ausente={sala.estadoPerifericos.ausente}
            error={sala.estadoPerifericos.error}
            onEliminar={sala.eliminarPeriferico}
            onCambiarModo={sala.cambiarModo}
            seleccionId={seleccionId}
            onSeleccionar={(id) => setSeleccionId((actual) => (actual === id ? null : id))}
          />
        </aside>

        {/* Centro: mapa real (≥ 60 % del alto) y cámaras municipales debajo */}
        <section className="flex min-h-0 flex-col gap-3 lg:overflow-hidden">
          <div className="superficie relative min-h-[360px] flex-[3] overflow-hidden rounded-xl border border-panel-border bg-panel">
            {estado ? (
              <MapaBase centro={centro} zoom={ZOOM} penacho={penacho} encuadre={encuadre} marcadores={marcadores}>
                {() => (
                  <CapasPerifericos
                    nodos={nodos}
                    aristas={estado.aristas}
                    perifericos={sala.perifericos}
                    camaras={sala.camaras}
                    observaciones={observaciones}
                    seleccionId={seleccionId}
                    onSeleccionarPeriferico={(id) => setSeleccionId((actual) => (actual === id ? null : id))}
                  />
                )}
              </MapaBase>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-muted">Conectando con el orquestador…</p>
            )}
            {sinCoordenadas && (
              <div className="pointer-events-none absolute inset-x-2 top-2 z-[500]">
                <Aviso>Grafo sin coordenadas: aplica el grafo real (POST /api/grafo/real) para ver los vértices en el mapa.</Aviso>
              </div>
            )}
          </div>

          <CamarasTrafico
            className="min-h-[200px] flex-[2]"
            camaras={sala.camaras}
            cargando={sala.estadoCamaras.cargando}
            ausente={sala.estadoCamaras.ausente}
            error={sala.estadoCamaras.error}
            onAnalizar={sala.analizarCamara}
          />
        </section>

        {/* Derecha: observaciones y muro */}
        <section className="flex min-h-0 flex-col gap-2 lg:overflow-hidden">
          <div role="tablist" aria-label="Entradas de los periféricos" className="flex shrink-0 gap-1.5">
            {PESTANAS.map((p) => {
              const Icono = p.icon;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={pestana === p.id}
                  onClick={() => setPestana(p.id)}
                  className="chip px-2.5 py-1"
                >
                  <Icono className="size-3.5" aria-hidden />
                  {p.etiqueta}
                  <span className="font-mono">{p.badge}</span>
                </button>
              );
            })}
          </div>

          {pestana === "observaciones" ? (
            <FeedObservaciones
              className="min-h-0 flex-1"
              eventos={estado?.eventos ?? []}
              decisiones={estado?.decisiones ?? []}
              perifericos={sala.perifericos}
              incidente={centro}
              cargando={!estado}
            />
          ) : (
            <MuroPublicaciones
              className="min-h-0 flex-1"
              publicaciones={sala.publicaciones}
              cargando={sala.estadoPublicaciones.cargando}
              ausente={sala.estadoPublicaciones.ausente}
              error={sala.estadoPublicaciones.error}
            />
          )}
        </section>
      </main>
    </div>
  );
}
