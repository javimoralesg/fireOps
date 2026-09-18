"use client";

import { useState, type ReactNode } from "react";
import { ArrowUp, CarFront, Gauge, Wind, Zap, Factory } from "lucide-react";
import type { CondicionesEntorno, EstadoSistema, FuenteDato } from "@/lib/tipos-sistema";
import { formatearHora } from "./FeedIngesta";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";

type Icono = typeof Wind;

const MODO_UI: Record<EstadoSistema["modoDatos"], { label: string; cls: string; punto: string; title: string }> = {
  real: {
    label: "Datos reales",
    cls: "pildora-exito",
    punto: "bg-success",
    title: "Todas las cifras de este panel vienen de APIs públicas en vivo (Open-Meteo, Informo Madrid, REE).",
  },
  mixto: {
    label: "Mixto",
    cls: "pildora-aviso",
    punto: "bg-warning",
    title: "Combina APIs públicas en vivo con datos forzados por el guion de la demo.",
  },
  sin_datos: {
    label: "Sin datos",
    cls: "",
    punto: "bg-muted",
    title: "Sin conexión con las fuentes de datos abiertas en este momento.",
  },
};

const FUENTE_LABEL: Partial<Record<FuenteDato, string>> = {
  OpenMeteo: "Open-Meteo",
  OpenMeteoAire: "Open-Meteo Aire",
  MadridTrafico: "Informo Madrid",
  REE: "REE",
  AEMET: "AEMET",
  Escenario: "Escenario (guion)",
};

const PUNTOS_CARDINALES = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];

const norm360 = (g: number) => ((g % 360) + 360) % 360;
const cardinal = (g: number) => PUNTOS_CARDINALES[Math.round(norm360(g) / 22.5) % 16];

const fmtNumero = new Intl.NumberFormat("es-ES", { useGrouping: true, maximumFractionDigits: 0 });
const fmtDecimal = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });

/**
 * Ángulo acumulado para que la transición CSS gire siempre por el camino corto
 * (de 350° a 10° gira 20°, no 340°).
 */
function useRotacionContinua(objetivo: number) {
  const [rot, setRot] = useState({ objetivo, acumulado: objetivo });
  if (rot.objetivo !== objetivo) {
    const delta = ((((objetivo - rot.acumulado) % 360) + 540) % 360) - 180;
    setRot({ objetivo, acumulado: rot.acumulado + delta });
  }
  return rot.acumulado;
}

// Umbrales OMS 2021 (24 h) y un nivel "rojo" orientativo.
function colorPm25(v: number) {
  if (v > 75) return "text-danger";
  if (v > 15) return "text-warning";
  return "text-success";
}
function colorPm10(v: number) {
  if (v > 150) return "text-danger";
  if (v > 45) return "text-warning";
  return "text-success";
}
function colorCo(v: number) {
  // µg/m³ (Open-Meteo). OMS: 4 mg/m³ (24 h), 10 mg/m³ (8 h).
  if (v > 10_000) return "text-danger";
  if (v > 4_000) return "text-warning";
  return "text-success";
}
function colorCarga(v: number) {
  if (v >= 80) return { texto: "text-danger", barra: "bg-danger" };
  if (v >= 60) return { texto: "text-warning", barra: "bg-warning" };
  return { texto: "text-success", barra: "bg-success" };
}
function colorViento(kmh: number) {
  if (kmh >= 50) return "text-danger";
  if (kmh > 25) return "text-warning";
  return "text-foreground";
}

export function PanelEntorno({
  entorno,
  modoDatos,
}: {
  entorno: CondicionesEntorno;
  modoDatos: EstadoSistema["modoDatos"];
}) {
  const modo = MODO_UI[modoDatos] ?? MODO_UI.sin_datos;
  return (
    <section className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-panel-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <Gauge className="size-4 text-brand" /> Entorno
          <Ayuda
            titulo="Entorno"
            texto="Condiciones reales alrededor del incidente: viento, calidad del aire, tráfico y red eléctrica. Cada tarjeta indica su fuente y la hora del dato."
          />
        </h2>
        <Tooltip titulo={`Modo de datos: ${modo.label.toLowerCase()}`} contenido={modo.title} lado="izquierda">
          <span className={`pildora ${modo.cls}`}>
            <span className="relative flex size-1.5">
              {modoDatos === "real" && <span className={`absolute inset-0 animate-ping rounded-full ${modo.punto} opacity-60`} />}
              <span className={`relative size-1.5 rounded-full ${modo.punto}`} />
            </span>
            {modo.label}
          </span>
        </Tooltip>
      </div>

      <div className="grid grid-cols-2 gap-2 p-3">
        <TarjetaViento viento={entorno.viento} />
        <TarjetaAire aire={entorno.aire} />
        <TarjetaTrafico trafico={entorno.trafico} />
        <TarjetaElectrica demanda={entorno.demandaElectricaMW} />
      </div>
    </section>
  );
}

function MiniTarjeta({
  icon: Icon,
  titulo,
  tituloCorto,
  ayuda,
  fuente,
  timestamp,
  children,
}: {
  icon: Icono;
  titulo: string;
  tituloCorto?: string;
  /** Qué mide la tarjeta, de dónde sale y a partir de qué valor avisa. */
  ayuda: ReactNode;
  fuente: string;
  timestamp?: string;
  children: ReactNode;
}) {
  return (
    <div className="@container flex min-w-0 flex-col rounded-[10px] border border-panel-border bg-panel-2 p-2.5">
      <p className="flex items-center gap-1 text-[11px] font-semibold text-foreground">
        <Icon className="size-3.5 shrink-0 text-brand" />
        {tituloCorto ? (
          <>
            <span className="truncate @[125px]:hidden">{tituloCorto}</span>
            <span className="hidden truncate @[125px]:inline">{titulo}</span>
          </>
        ) : (
          <span className="truncate">{titulo}</span>
        )}
        <Ayuda titulo={titulo} texto={ayuda} />
      </p>
      <div className="mt-1.5 min-w-0 flex-1">{children}</div>
      <Tooltip
        titulo="Origen del dato"
        contenido={`Dato de ${fuente}${timestamp ? ` tomado a las ${formatearHora(timestamp)}` : " (sin hora disponible)"}.`}
        lado="abajo"
        className="mt-2 max-w-full"
      >
        <span className="flex min-w-0 gap-1 text-[10px] text-muted">
          <span className="truncate">{fuente}</span>
          {timestamp && <span className="shrink-0 font-mono">· {formatearHora(timestamp, false)}</span>}
        </span>
      </Tooltip>
    </div>
  );
}

/**
 * Escala de tres tramos (normal · aviso · rojo) con una marca en el valor
 * actual: para ver de un vistazo cómo de cerca está la cifra del umbral.
 * Solo decorativa; el umbral en palabras está en el (i) de la tarjeta.
 */
function EscalaUmbral({ valor, max, aviso, rojo }: { valor: number; max: number; aviso: number; rojo: number }) {
  const pct = (v: number) => Math.min(100, Math.max(0, (v / max) * 100));
  return (
    <div className="relative mt-1.5 h-1 w-full overflow-hidden rounded-full bg-panel-border" aria-hidden>
      <span className="absolute inset-y-0 left-0 bg-success/45" style={{ width: `${pct(aviso)}%` }} />
      <span
        className="absolute inset-y-0 bg-warning/50"
        style={{ left: `${pct(aviso)}%`, width: `${Math.max(0, pct(rojo) - pct(aviso))}%` }}
      />
      <span className="absolute inset-y-0 right-0 bg-danger/50" style={{ left: `${pct(rojo)}%` }} />
      <span
        className="absolute inset-y-0 w-[2px] -translate-x-1/2 rounded-full bg-foreground"
        style={{ left: `${pct(valor)}%` }}
      />
    </div>
  );
}

function SinDatos() {
  return (
    <div className="flex h-full min-h-10 items-center">
      <p className="font-mono text-lg leading-none text-subtle">—</p>
      <p className="ml-2 text-[11px] italic text-muted">sin datos</p>
    </div>
  );
}

function TarjetaViento({ viento }: { viento: CondicionesEntorno["viento"] }) {
  const desde = norm360(viento.direccionGrados);
  const hacia = norm360(desde + 180);
  const rotacion = useRotacionContinua(hacia);
  const textoDesde = viento.direccionTexto || cardinal(desde);
  const explicacion = `Viento del ${textoDesde} (${Math.round(desde)}°). La flecha indica hacia dónde va el humo: ${cardinal(hacia)} (${Math.round(hacia)}°).`;

  return (
    <MiniTarjeta
      icon={Wind}
      titulo="Viento"
      ayuda={
        <>
          Velocidad y dirección del viento en el incidente. La <strong>dirección es de dónde viene</strong>; la flecha señala hacia
          dónde va el humo. Aviso por encima de <strong>25 km/h</strong>, rojo desde <strong>50 km/h</strong>.
        </>
      }
      fuente={FUENTE_LABEL[viento.fuente] ?? viento.fuente}
      timestamp={viento.timestamp}
    >
      <Tooltip titulo="Viento y penacho de humo" contenido={explicacion} className="w-full">
        <span className="flex w-full items-center gap-2">
          <span className="relative grid size-10 shrink-0 place-items-center rounded-full border border-panel-border bg-panel">
            <span className="absolute top-px text-[7px] font-bold leading-none text-muted">N</span>
            <ArrowUp
              className="size-5 text-brand transition-transform duration-1000 ease-out"
              style={{ transform: `rotate(${rotacion}deg)` }}
              aria-label={explicacion}
            />
          </span>
          <span className="min-w-0">
            <span className="block font-mono text-lg leading-none">
              <span className={colorViento(viento.velocidadKmh)}>{fmtNumero.format(viento.velocidadKmh)}</span>
              <span className="text-[10px] text-muted"> km/h</span>
            </span>
            <span className="mt-1 block truncate text-[11px] text-muted">
              del <span className="text-foreground">{textoDesde}</span>
              <span className="hidden font-mono @[125px]:inline"> {Math.round(desde)}°</span>
            </span>
          </span>
        </span>
      </Tooltip>
      <EscalaUmbral valor={viento.velocidadKmh} max={70} aviso={25} rojo={50} />
      <p className="mt-1.5 truncate text-[10px] text-muted">
        humo hacia el <span className="font-semibold text-brand">{cardinal(hacia)}</span>
      </p>
    </MiniTarjeta>
  );
}

function TarjetaAire({ aire }: { aire: CondicionesEntorno["aire"] }) {
  return (
    <MiniTarjeta
      icon={Factory}
      titulo="Calidad del aire"
      tituloCorto="Aire"
      ayuda={
        <>
          Partículas y monóxido de carbono en el aire del incidente. Umbrales de la <strong>OMS a 24 h</strong>: PM2.5{" "}
          <strong>15 µg/m³</strong>, PM10 <strong>45 µg/m³</strong>, CO <strong>4.000 µg/m³</strong>. Por encima, ámbar; muy por
          encima (PM2.5 75, PM10 150, CO 10.000), rojo.
        </>
      }
      fuente={FUENTE_LABEL.OpenMeteoAire!}
      timestamp={aire?.timestamp}
    >
      {aire ? (
        <>
          <Tooltip
            titulo="PM2.5"
            contenido={`Partículas finas: ${fmtDecimal.format(aire.pm25)} µg/m³. Umbral OMS 24 h: 15 µg/m³; rojo por encima de 75.`}
          >
            <span className="font-mono text-lg leading-none">
              <span className={colorPm25(aire.pm25)}>{fmtDecimal.format(aire.pm25)}</span>
              <span className="text-[10px] text-muted"> µg/m³</span>
            </span>
          </Tooltip>
          <p className="mt-1 truncate text-[10px] text-muted">
            PM2.5
            {aire.pm25 > 15 && <span className={colorPm25(aire.pm25)}> · ×{fmtDecimal.format(aire.pm25 / 15)} OMS</span>}
          </p>
          <EscalaUmbral valor={aire.pm25} max={90} aviso={15} rojo={75} />
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 font-mono text-[10px] leading-4">
            <dt className="text-muted">PM10</dt>
            <dd className="min-w-0">
              <Tooltip
                titulo="PM10"
                contenido={`Partículas gruesas: ${fmtDecimal.format(aire.pm10)} µg/m³. Umbral OMS 24 h: 45 µg/m³; rojo por encima de 150.`}
              >
                <span className={`truncate ${colorPm10(aire.pm10)}`}>{fmtDecimal.format(aire.pm10)}</span>
              </Tooltip>
            </dd>
            <dt className="text-muted">CO</dt>
            <dd className="min-w-0">
              <Tooltip
                titulo="Monóxido de carbono"
                contenido={`${fmtNumero.format(aire.co)} µg/m³. Umbral OMS 24 h: 4.000 µg/m³; rojo por encima de 10.000.`}
              >
                <span className={`truncate ${colorCo(aire.co)}`}>{fmtNumero.format(aire.co)}</span>
              </Tooltip>
            </dd>
          </dl>
        </>
      ) : (
        <SinDatos />
      )}
    </MiniTarjeta>
  );
}

/** Informo a veces da un código de punto de medida ("PM11102") en lugar de una descripción. */
const esCodigoSensor = (s: string) => /^[A-Z]{1,4}[-_]?\d+$/i.test(s.trim());

function TarjetaTrafico({ trafico }: { trafico: CondicionesEntorno["trafico"] }) {
  const c = trafico ? colorCarga(trafico.cargaMedia) : null;
  const peor = trafico?.sensorPeor ?? null;
  const cPeor = peor ? colorCarga(peor.carga) : null;
  return (
    <MiniTarjeta
      icon={CarFront}
      titulo="Tráfico"
      ayuda={
        <>
          Carga media de los sensores de <strong>Informo (Ayuntamiento de Madrid)</strong> en 1,5 km alrededor del incidente: cuánto
          ocupa el tráfico la vía. Aviso desde <strong>60 %</strong>, rojo desde <strong>80 %</strong>. <strong>Peor</strong> es el
          sensor más cargado de ese radio, el que marca por dónde no conviene sacar a los equipos.
        </>
      }
      fuente={FUENTE_LABEL.MadridTrafico!}
      timestamp={trafico?.timestamp}
    >
      {trafico && c ? (
        <>
          <Tooltip
            titulo="Carga media"
            contenido={`${fmtNumero.format(trafico.cargaMedia)} % de carga en ${trafico.sensoresCercanos} sensores de Informo a 1,5 km. Aviso desde 60 %, rojo desde 80 %.`}
          >
            <span className="font-mono text-lg leading-none">
              <span className={c.texto}>{fmtNumero.format(trafico.cargaMedia)}</span>
              <span className="text-[10px] text-muted"> %</span>
            </span>
          </Tooltip>
          <div className="relative mt-1 h-1 overflow-hidden rounded-full bg-panel-border">
            <div className={`h-full ${c.barra}`} style={{ width: `${Math.min(100, Math.max(0, trafico.cargaMedia))}%` }} />
            {/* Marcas de umbral: 60 % (aviso) y 80 % (rojo) */}
            <span className="absolute inset-y-0 left-[60%] w-px bg-foreground/30" aria-hidden />
            <span className="absolute inset-y-0 left-[80%] w-px bg-foreground/30" aria-hidden />
          </div>
          <p className="mt-1 truncate text-[10px] text-muted">
            carga media · <span className="font-mono">{trafico.sensoresCercanos}</span> sensores
          </p>
          {peor && cPeor ? (
            <Tooltip
              titulo="Sensor más cargado"
              contenido={`#${peor.id} · ${peor.descripcion} · ${peor.carga} % de carga.`}
              className="mt-1 w-full"
            >
              <span className="block w-full text-[10px] leading-4">
                <span className="flex items-baseline justify-between gap-1">
                  <span className="text-muted">peor</span>
                  <span className={`font-mono font-semibold ${cPeor.texto}`}>{fmtNumero.format(peor.carga)} %</span>
                </span>
                {esCodigoSensor(peor.descripcion) ? (
                  <span className="block truncate text-muted">
                    sensor <span className="font-mono text-foreground">{peor.descripcion}</span>
                  </span>
                ) : (
                  <span className="block truncate text-foreground">
                    <span className="font-mono text-muted">#{peor.id}</span> {peor.descripcion}
                  </span>
                )}
              </span>
            </Tooltip>
          ) : (
            <p className="mt-1 text-[10px] italic text-muted">sin sensor crítico</p>
          )}
        </>
      ) : (
        <SinDatos />
      )}
    </MiniTarjeta>
  );
}

function TarjetaElectrica({ demanda }: { demanda: CondicionesEntorno["demandaElectricaMW"] }) {
  return (
    <MiniTarjeta
      icon={Zap}
      titulo="Red eléctrica"
      ayuda={
        <>
          Demanda eléctrica peninsular en tiempo real, según <strong>Red Eléctrica de España</strong>. No tiene umbral propio: sirve
          de contexto para valorar si un apagón por daños en una subestación cae en un momento de red exigida (la punta invernal
          ronda los 40.000 MW).
        </>
      }
      fuente={FUENTE_LABEL.REE!}
      timestamp={demanda?.timestamp}
    >
      {demanda ? (
        <>
          <p className="font-mono text-lg leading-none">
            {fmtNumero.format(demanda.valor)}
            <span className="text-[10px] text-muted"> MW</span>
          </p>
          <p className="mt-1 truncate text-[10px] text-muted">demanda peninsular</p>
        </>
      ) : (
        <SinDatos />
      )}
    </MiniTarjeta>
  );
}
