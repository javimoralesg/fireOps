"use client";

// Situación: dónde está el problema y hacia dónde va. Mapa (OpenStreetMap) por
// defecto y grafo local como alternativa, más los 4 datos de entorno que importan,
// escritos en una frase cada uno.

import { useState } from "react";
import { CarFront, CloudFog, Map as IconoMapa, Network, Wind, Zap } from "lucide-react";
import type { ImpactoDomino } from "@/lib/types";
import type { EstadoSistema } from "@/lib/tipos-sistema";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { MapaCiudad } from "@/components/mapa/MapaCiudad";
import type { DatosMapa, PenachoServidor, RutaMapa } from "@/components/mapa/tipos";
import { GrafoCiudad } from "@/components/GrafoCiudad";
import { hora } from "./texto";

type Vista = "mapa" | "grafo";
const CLAVE_VISTA = "atalaya.vistaSituacion";

function leerVista(): Vista {
  try {
    return localStorage.getItem(CLAVE_VISTA) === "grafo" ? "grafo" : "mapa";
  } catch {
    return "mapa";
  }
}

// Campos geográficos que publica el backend (pactados con poc-55); opcionales.
type ConGeo = { mapa?: DatosMapa; entorno: { penacho?: PenachoServidor } };

interface Props {
  estado: EstadoSistema;
  domino?: ImpactoDomino[];
  rutas?: RutaMapa[];
}

const gradosARumbo = (g: number) => {
  const r = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return r[Math.round((((g % 360) + 360) % 360) / 45) % 8];
};

function nivelAire(pm25: number) {
  if (pm25 <= 12) return { texto: "buena", cls: "text-success" };
  if (pm25 <= 35) return { texto: "moderada", cls: "text-warning" };
  return { texto: "mala", cls: "text-danger" };
}

function nivelTrafico(carga: number) {
  if (carga < 50) return { texto: "fluido", cls: "text-success" };
  if (carga < 80) return { texto: "denso", cls: "text-warning" };
  return { texto: "saturado", cls: "text-danger" };
}

const VISTAS = [
  {
    id: "mapa" as const,
    etiqueta: "Mapa",
    icono: IconoMapa,
    ayuda: "Mapa real de OpenStreetMap con la incidencia, los recursos y la cuña de humo calculada con el viento actual.",
  },
  {
    id: "grafo" as const,
    etiqueta: "Grafo",
    icono: Network,
    ayuda: "Esquema de dependencias de la ciudad: qué infraestructura depende de cuál y por dónde se propagaría el efecto dominó.",
  },
];

export function Situacion({ estado, domino, rutas }: Props) {
  const [vista, setVistaEstado] = useState<Vista>(() => (typeof window === "undefined" ? "mapa" : leerVista()));
  const setVista = (v: Vista) => {
    setVistaEstado(v);
    try {
      localStorage.setItem(CLAVE_VISTA, v);
    } catch {
      /* sin almacenamiento */
    }
  };

  const { entorno } = estado;
  const v = entorno.viento;
  const humoHacia = gradosARumbo(v.direccionGrados + 180);
  const aire = entorno.aire ? nivelAire(entorno.aire.pm25) : null;
  const trafico = entorno.trafico ? nivelTrafico(entorno.trafico.cargaMedia) : null;
  const geo = estado as EstadoSistema & ConGeo;
  const afectados = domino?.length ?? 0;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Situación">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-panel-border px-4 py-2.5">
        <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-foreground">
          <IconoMapa className="size-4 shrink-0 text-brand" aria-hidden /> Situación
          <Ayuda
            titulo="Qué se ve aquí"
            texto="Mapa real de OpenStreetMap o grafo de dependencias de la ciudad, a elegir. El humo se dibuja con el viento real del momento, y abajo están los cuatro datos de entorno que condicionan la decisión."
          />
          {afectados > 0 && (
            <Tooltip
              titulo="Efecto dominó"
              contenido="Infraestructuras que quedarían afectadas si el incidente sigue: la IA las calcula recorriendo el grafo de dependencias. Aparecen resaltadas en el mapa y en el grafo."
            >
              <span className="pildora pildora-aviso ml-1 hidden sm:inline-flex">
                <span className="font-mono">{afectados}</span> {afectados === 1 ? "infraestructura en riesgo" : "infraestructuras en riesgo"}
              </span>
            </Tooltip>
          )}
        </h2>
        {/* Conmutador segmentado: una sola opción activa, con fondo hundido */}
        <div className="flex shrink-0 rounded-lg bg-panel-2 p-0.5 text-xs" role="group" aria-label="Vista de situación">
          {VISTAS.map(({ id, etiqueta, icono: Icono, ayuda }) => (
            <Tooltip key={id} titulo={`Vista de ${etiqueta.toLowerCase()}`} contenido={ayuda} lado="abajo">
              <button
                type="button"
                aria-pressed={vista === id}
                onClick={() => setVista(id)}
                className={`flex min-h-8 items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition ${
                  vista === id ? "bg-panel text-brand shadow-sm" : "text-muted hover:text-foreground"
                }`}
              >
                <Icono className="size-3.5" aria-hidden /> {etiqueta}
              </button>
            </Tooltip>
          ))}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {vista === "mapa" ? (
          <div className="absolute inset-0">
            <MapaCiudad
              centro={estado.incidente.ubicacion}
              nodos={estado.nodos}
              aristas={estado.aristas}
              eventos={estado.eventos}
              viento={estado.entorno.viento}
              penacho={geo.entorno.penacho}
              datos={geo.mapa}
              rutas={rutas}
              dominoResaltado={domino}
            />
          </div>
        ) : (
          <div className="absolute inset-0">
            <GrafoCiudad
              compacto
              nodos={estado.nodos}
              aristas={estado.aristas}
              nodosEnRiesgo={new Set(domino?.map((d) => d.infraestructura) ?? [])}
              viento={v}
              dominoResaltado={domino}
              penacho={estado.entorno.penacho}
              foco={estado.incidente.ubicacion}
              origenGrafo={estado.origenGrafo}
            />
          </div>
        )}
      </div>

      {/* Entorno: cuatro frases, no cuatro tarjetas. Cifra en mono, calificativo en color. */}
      <footer className="grid shrink-0 grid-cols-1 gap-x-5 gap-y-1.5 border-t border-panel-border px-4 py-2.5 text-xs sm:grid-cols-2">
        <Tooltip
          titulo="Viento"
          contenido={`${v.velocidadKmh} km/h del ${v.direccionTexto} (${v.direccionGrados}°). El humo se desplaza hacia el ${humoHacia}. Dato de ${v.fuente === "Escenario" ? "la simulación" : "Open-Meteo"} a las ${hora(v.timestamp)}.`}
          lado="arriba"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Wind className="size-3.5 shrink-0 text-info" aria-hidden />
            <span className="truncate text-muted">
              Viento <span className="font-mono font-semibold text-foreground">{v.velocidadKmh} km/h</span> · humo hacia el{" "}
              <span className="font-semibold text-foreground">{humoHacia}</span>
            </span>
          </span>
        </Tooltip>
        <Tooltip
          titulo="Calidad del aire"
          contenido={
            entorno.aire
              ? `PM2.5 ${entorno.aire.pm25} µg/m³ · PM10 ${entorno.aire.pm10} µg/m³ · CO ${entorno.aire.co}. Buena hasta 12, moderada hasta 35, mala por encima. Open-Meteo, ${hora(entorno.aire.timestamp)}.`
              : "Sin dato de calidad del aire todavía: en cuanto responda Open-Meteo aparecerá aquí."
          }
          lado="arriba"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <CloudFog className="size-3.5 shrink-0 text-info" aria-hidden />
            <span className="truncate text-muted">
              Aire{" "}
              {aire ? (
                <>
                  <span className={`font-semibold ${aire.cls}`}>{aire.texto}</span>{" "}
                  <span className="text-subtle">
                    (PM2.5 <span className="font-mono">{entorno.aire!.pm25}</span>)
                  </span>
                </>
              ) : (
                <span className="text-subtle">sin dato</span>
              )}
            </span>
          </span>
        </Tooltip>
        <Tooltip
          titulo="Tráfico alrededor"
          contenido={
            entorno.trafico
              ? `Carga media del ${entorno.trafico.cargaMedia} % en ${entorno.trafico.sensoresCercanos} sensores municipales a menos de 1,5 km.${entorno.trafico.sensorPeor ? ` Peor punto: ${entorno.trafico.sensorPeor.descripcion} (${entorno.trafico.sensorPeor.carga} %).` : ""} Fluido por debajo del 50 %, denso hasta el 80 %, saturado por encima.`
              : "Sin dato de tráfico todavía: se toma de los sensores del Ayuntamiento."
          }
          lado="arriba"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <CarFront className="size-3.5 shrink-0 text-warning" aria-hidden />
            <span className="truncate text-muted">
              Tráfico{" "}
              {trafico ? (
                <>
                  <span className={`font-semibold ${trafico.cls}`}>{trafico.texto}</span>{" "}
                  <span className="text-subtle">
                    (<span className="font-mono">{entorno.trafico!.cargaMedia} %</span>)
                  </span>
                </>
              ) : (
                <span className="text-subtle">sin dato</span>
              )}
            </span>
          </span>
        </Tooltip>
        <Tooltip
          titulo="Red eléctrica"
          contenido={
            entorno.demandaElectricaMW
              ? `Demanda peninsular ${entorno.demandaElectricaMW.valor.toLocaleString("es-ES")} MW (Red Eléctrica de España, ${hora(entorno.demandaElectricaMW.timestamp)}). Se vigila porque importa si la subestación de la zona queda afectada.`
              : "Sin dato de demanda eléctrica todavía: lo publica Red Eléctrica de España."
          }
          lado="arriba"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Zap className="size-3.5 shrink-0 text-warning" aria-hidden />
            <span className="truncate text-muted">
              Red eléctrica{" "}
              {entorno.demandaElectricaMW ? (
                <>
                  <span className="font-semibold text-success">normal</span>{" "}
                  <span className="text-subtle">
                    (<span className="font-mono">{entorno.demandaElectricaMW.valor.toLocaleString("es-ES")} MW</span>)
                  </span>
                </>
              ) : (
                <span className="text-subtle">sin dato</span>
              )}
            </span>
          </span>
        </Tooltip>
      </footer>
    </section>
  );
}
