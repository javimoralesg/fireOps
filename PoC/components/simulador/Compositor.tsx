"use client";

// Compositor manual: el presentador escribe un evento (tipo, canal, texto, lugar,
// gravedad, imagen) y lo inyecta por el mismo pipeline que los periféricos reales.
// Marca como "esperado" la categoría que corresponde al tipo elegido, para que en
// Resultados se vea si el pipeline acierta.

import { useMemo, useState } from "react";
import { ArrowUpRight, Crosshair, ImageIcon, LoaderCircle, MapPin, Send, Sparkles, X } from "lucide-react";
import { api } from "@/lib/api-cliente";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { etiquetaCategoria, GRAVEDAD_UI, OBSERVACION_UI, tinte, TIPOS_EMERGENCIA, TIPOS_OBSERVACION, uiTipo } from "./catalogo";
import { AVISO_SIN_PERMISO, ErrorInline, IconoTipo, mensajeError, PildoraImpacto } from "./ui";
import type { GravedadSim, LugarSim, ResultadoSim, TipoObservacionSim } from "./tipos";

/** Fuera del componente (pureza del render): id único para cada evento manual. */
const idManual = () => `manual-${Date.now().toString(36)}`;

type ModoLugar = "centro" | "conocido" | "coordenadas";

const SENSOR_POR_TIPO: Record<string, { magnitud: string; valor: number; unidad: string }> = {
  fuga_gas: { magnitud: "metano", valor: 12, unidad: "% LIE" },
  inundacion: { magnitud: "nivel_agua", valor: 85, unidad: "cm" },
  incendio_industrial: { magnitud: "temperatura", valor: 68, unidad: "°C" },
  incendio_urbano: { magnitud: "temperatura", valor: 64, unidad: "°C" },
  incendio_forestal: { magnitud: "temperatura", valor: 55, unidad: "°C" },
  sismo: { magnitud: "aceleracion", valor: 0.12, unidad: "g" },
  ola_calor: { magnitud: "temperatura", valor: 43, unidad: "°C" },
  vertido_quimico: { magnitud: "pH", valor: 2.4, unidad: "pH" },
};
const SENSOR_GENERICO = { magnitud: "temperatura", valor: 40, unidad: "°C" };

const claseCampo =
  "w-full rounded-[8px] border border-panel-border-strong bg-panel px-2.5 py-1.5 text-[13px] text-foreground outline-none transition placeholder:text-subtle focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60";

/** "40.3953, -3.6838" · "40.3953 -3.6838" · "40,3953; -3,6838" → {lat, lon} o null. */
export function parsearCoordenadas(txt: string): { lat: number; lon: number } | null {
  const numeros = txt.match(/-?\d+(?:[.,]\d+)?/g);
  if (!numeros || numeros.length !== 2) return null;
  const [lat, lon] = numeros.map((p) => Number(p.replace(",", ".")));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

interface Props {
  centro: LugarSim;
  lugares: LugarSim[];
  imagenes: string[];
  puedeControlar: boolean;
  onInyectado: (resultado: ResultadoSim, info: { titulo: string; esperadoCategoria: string }) => void;
  onSeleccionarDecision?: (id: string) => void;
  onVerResultados: () => void;
  onCambio?: () => void;
}

export function Compositor({ centro, lugares, imagenes, puedeControlar, onInyectado, onSeleccionarDecision, onVerResultados, onCambio }: Props) {
  const [tipo, setTipo] = useState("incendio_industrial");
  const [tipoObs, setTipoObs] = useState<TipoObservacionSim>("texto");
  const [texto, setTexto] = useState("");
  const [autor, setAutor] = useState("");
  const [sensor, setSensor] = useState<{ magnitud: string; valor: string; unidad: string } | null>(null);
  const [modoLugar, setModoLugar] = useState<ModoLugar>("centro");
  const [lugarConocido, setLugarConocido] = useState(0);
  const [coordenadas, setCoordenadas] = useState("");
  const [gravedad, setGravedad] = useState<GravedadSim | "">("");
  const [imagen, setImagen] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoSim | null>(null);

  const ui = uiTipo(tipo);
  const sensorBase = SENSOR_POR_TIPO[tipo] ?? SENSOR_GENERICO;
  const sensorActual = sensor ?? { magnitud: sensorBase.magnitud, valor: String(sensorBase.valor), unidad: sensorBase.unidad };

  const coordsParseadas = useMemo(() => (coordenadas.trim() ? parsearCoordenadas(coordenadas) : null), [coordenadas]);
  const lugar: LugarSim | null =
    modoLugar === "centro"
      ? centro
      : modoLugar === "conocido"
        ? (lugares[lugarConocido] ?? null)
        : coordsParseadas
          ? { ...coordsParseadas, nombre: undefined }
          : null;

  const faltaTexto = tipoObs !== "sensor" && !texto.trim() && !(tipoObs === "imagen" && imagen.trim());
  const errorCoordenadas = modoLugar === "coordenadas" && coordenadas.trim() && !coordsParseadas;
  const listo = puedeControlar && !enviando && !faltaTexto && lugar !== null;

  const motivoBloqueo = !puedeControlar
    ? AVISO_SIN_PERMISO
    : faltaTexto
      ? "Escribe qué se observa (o elige una imagen si es una foto)."
      : lugar === null
        ? "Indica un lugar válido."
        : undefined;

  const inyectar = async () => {
    if (!lugar) return;
    setEnviando(true);
    setError(null);
    setResultado(null);
    const categoria = ui.categoria;
    const t = texto.trim();
    const titulo = t ? (t.length > 90 ? `${t.slice(0, 88)}…` : t) : `${ui.etiqueta} (${OBSERVACION_UI[tipoObs].etiqueta.toLowerCase()})`;
    const observacion: Record<string, unknown> = {
      perifericoId: "simulador",
      tipo: tipoObs,
      simulacro: true,
      datasetId: "manual",
      tipoEmergencia: tipo,
      posicion: { lat: lugar.lat, lon: lugar.lon, precisionM: 25 },
      ...(lugar.nombre ? { ubicacion: lugar.nombre } : {}),
      ...(t ? { texto: t } : {}),
      ...(tipoObs === "publicacion" && autor.trim() ? { autor: autor.trim().replace(/^@?/, "@") } : {}),
      ...(tipoObs === "sensor"
        ? { sensor: { magnitud: sensorActual.magnitud, valor: Number(sensorActual.valor.replace(",", ".")) || 0, unidad: sensorActual.unidad } }
        : {}),
      ...(imagen.trim() ? { imagenUrl: imagen.trim() } : {}),
      ...(gravedad ? { gravedadForzada: gravedad } : {}),
    };
    try {
      const r = await api.inyectarEvento({
        id: idManual(),
        titulo,
        canal: tipoObs,
        tipoEmergencia: tipo,
        ...(lugar ? { lugar } : {}),
        esperado: { categoria, ...(gravedad ? { gravedad } : {}) },
        observacion,
      });
      setResultado(r);
      onInyectado(r, { titulo, esperadoCategoria: categoria });
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setEnviando(false);
      onCambio?.();
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (listo) void inyectar();
      }}
    >
      <fieldset disabled={!puedeControlar || enviando} className="min-w-0 space-y-3">
        <legend className="sr-only">Evento compuesto a mano</legend>

        {/* Tipo de emergencia */}
        <div>
          <label htmlFor="sim-tipo" className="mb-1 flex items-center gap-1 text-xs font-medium text-foreground">
            Tipo de emergencia
            <Ayuda texto={`El pipeline debería clasificarlo como «${etiquetaCategoria(ui.categoria)}». Se guarda como resultado esperado.`} />
          </label>
          <div className="flex items-center gap-2">
            <IconoTipo tipo={tipo} className="size-8" />
            <select
              id="sim-tipo"
              className={claseCampo}
              value={tipo}
              onChange={(e) => {
                setTipo(e.target.value);
                setSensor(null);
              }}
            >
              {TIPOS_EMERGENCIA.map((t) => (
                <option key={t} value={t}>
                  {uiTipo(t).etiqueta}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Canal */}
        <div>
          <p className="mb-1 text-xs font-medium text-foreground">Canal</p>
          <div className="grid grid-cols-5 gap-1 rounded-lg bg-panel-2 p-0.5" role="radiogroup" aria-label="Canal o tipo de observación">
            {TIPOS_OBSERVACION.map((t) => {
              const o = OBSERVACION_UI[t];
              const Icono = o.icon;
              const activo = tipoObs === t;
              return (
                <Tooltip key={t} titulo={o.etiqueta} contenido={o.ayuda} className="w-full">
                  <label
                    className={`flex min-h-8 w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-center text-[10.5px] font-semibold leading-tight transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/30 ${
                      activo ? "bg-panel text-brand shadow-sm" : "text-muted hover:text-foreground"
                    }`}
                  >
                    <input type="radio" name="sim-canal" value={t} checked={activo} onChange={() => setTipoObs(t)} className="sr-only" />
                    <Icono className="size-3.5" aria-hidden />
                    {o.etiqueta.replace("Llamada 112", "112").replace("Redes sociales", "Redes").replace("Aviso escrito", "Aviso")}
                  </label>
                </Tooltip>
              );
            })}
          </div>
        </div>

        {/* Texto */}
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label htmlFor="sim-texto" className="text-xs font-medium text-foreground">
              {tipoObs === "voz" ? "Transcripción" : tipoObs === "publicacion" ? "Texto de la publicación" : tipoObs === "sensor" ? "Nota (opcional)" : "Qué se observa"}
            </label>
            <Tooltip
              titulo="Rellenar con un ejemplo"
              contenido={`Escribe en el campo un aviso de ejemplo del tipo elegido (${ui.etiqueta.toLowerCase()}). Puedes editarlo antes de inyectarlo.`}
            >
              <button type="button" className="boton boton-fantasma boton-sm gap-1 px-1.5 text-[11px] text-brand" onClick={() => setTexto(ui.ejemplo)}>
                <Sparkles className="size-3" aria-hidden /> Ejemplo
              </button>
            </Tooltip>
          </div>
          <textarea
            id="sim-texto"
            rows={3}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && listo) {
                e.preventDefault();
                void inyectar();
              }
            }}
            placeholder={ui.ejemplo}
            className={`${claseCampo} resize-none`}
          />
        </div>

        {tipoObs === "publicacion" && (
          <div>
            <label htmlFor="sim-autor" className="mb-1 flex items-center gap-1 text-xs font-medium text-foreground">
              Autor <span className="font-normal text-subtle">(opcional)</span>
              <Ayuda texto="Quién firma la publicación simulada. Se envía con la observación y aparece en el feed de ingesta junto al texto." />
            </label>
            <input id="sim-autor" value={autor} onChange={(e) => setAutor(e.target.value)} placeholder="@vecina_arganzuela" className={claseCampo} />
          </div>
        )}

        {tipoObs === "sensor" && (
          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-medium text-foreground">
              Lectura del sensor
              <Ayuda texto="Valor que manda el sensor simulado. Se rellena solo con un valor típico del tipo de emergencia elegido; el pipeline lo usa para estimar la gravedad." />
            </p>
            <div className="grid grid-cols-[1fr_5rem_4.5rem] gap-1.5">
              <label className="text-[11px] text-muted">
                Magnitud
                <input
                  value={sensorActual.magnitud}
                  onChange={(e) => setSensor({ ...sensorActual, magnitud: e.target.value })}
                  className={`${claseCampo} mt-0.5`}
                />
              </label>
              <label className="text-[11px] text-muted">
                Valor
                <input
                  inputMode="decimal"
                  value={sensorActual.valor}
                  onChange={(e) => setSensor({ ...sensorActual, valor: e.target.value })}
                  className={`${claseCampo} mt-0.5 font-mono`}
                />
              </label>
              <label className="text-[11px] text-muted">
                Unidad
                <input
                  value={sensorActual.unidad}
                  onChange={(e) => setSensor({ ...sensorActual, unidad: e.target.value })}
                  className={`${claseCampo} mt-0.5`}
                />
              </label>
            </div>
          </div>
        )}

        {/* Lugar */}
        <div>
          <p className="mb-1 flex items-center gap-1 text-xs font-medium text-foreground">
            Lugar
            <Ayuda texto="Donde se sitúa la observación en el mapa y en el grafo. Por defecto, el centro del incidente activo." />
          </p>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-panel-2 p-0.5" role="radiogroup" aria-label="Origen del lugar">
            {(
              [
                ["centro", "Centro", `Punto del incidente activo${centro.nombre ? `: ${centro.nombre}` : ""}. Es el que usa la consola para centrar el mapa.`],
                [
                  "conocido",
                  `Conocido${lugares.length ? ` (${lugares.length})` : ""}`,
                  lugares.length
                    ? "Lugares que ya aparecen en los eventos sueltos del dataset, con sus coordenadas."
                    : "No hay lugares en el dataset: usa el centro o unas coordenadas.",
                ],
                ["coordenadas", "Lat, lon", "Pega unas coordenadas de Google Maps o de OpenStreetMap (grados decimales)."],
              ] as const
            ).map(([valor, etiqueta, ayuda]) => (
              <Tooltip key={valor} titulo="Lugar del evento" contenido={ayuda} className="w-full">
                <label
                  className={`flex min-h-8 w-full cursor-pointer items-center justify-center rounded-md px-2 py-1 text-center text-[11px] font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/30 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40 ${
                    modoLugar === valor ? "bg-panel text-brand shadow-sm" : "text-muted hover:text-foreground"
                  }`}
                >
                  <input
                    type="radio"
                    name="sim-lugar"
                    value={valor}
                    checked={modoLugar === valor}
                    disabled={valor === "conocido" && lugares.length === 0}
                    onChange={() => setModoLugar(valor)}
                    className="sr-only"
                  />
                  {etiqueta}
                </label>
              </Tooltip>
            ))}
          </div>
          {modoLugar === "conocido" && lugares.length > 0 && (
            <select
              aria-label="Lugar conocido del dataset"
              className={`${claseCampo} mt-1.5`}
              value={lugarConocido}
              onChange={(e) => setLugarConocido(Number(e.target.value))}
            >
              {lugares.map((l, i) => (
                <option key={`${l.lat},${l.lon},${i}`} value={i}>
                  {l.etiqueta ?? l.nombre ?? `${l.lat.toFixed(4)}, ${l.lon.toFixed(4)}`}
                </option>
              ))}
            </select>
          )}
          {modoLugar === "coordenadas" && (
            <div className="relative mt-1.5">
              <Crosshair className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
              <input
                aria-label="Coordenadas (lat, lon)"
                aria-invalid={Boolean(errorCoordenadas)}
                value={coordenadas}
                onChange={(e) => setCoordenadas(e.target.value)}
                placeholder="40.3953, -3.6838 (pégalo de Google Maps u OSM)"
                className={`${claseCampo} pl-8 font-mono`}
              />
            </div>
          )}
          {errorCoordenadas && <ErrorInline mensaje="No reconozco esas coordenadas. Formato: 40.3953, -3.6838" className="mt-1" />}
          {lugar && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-subtle">
              <MapPin className="size-3 shrink-0" aria-hidden />
              <span className="truncate">
                {lugar.nombre ? `${lugar.nombre} · ` : lugar.etiqueta ? `Junto a: ${lugar.etiqueta} · ` : ""}
                <span className="font-mono">
                  {lugar.lat.toFixed(5)}, {lugar.lon.toFixed(5)}
                </span>
              </span>
            </p>
          )}
        </div>

        {/* Gravedad */}
        <div>
          <p className="mb-1 flex items-center gap-1 text-xs font-medium text-foreground">
            Gravedad
            <Ayuda texto="Opcional. En automático la estima el pipeline (visión o texto); si la fijas, se envía como gravedad forzada del simulacro." />
          </p>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Gravedad">
            <button type="button" className="chip" aria-pressed={gravedad === ""} onClick={() => setGravedad("")}>
              Automática
            </button>
            {(["critica", "alta", "media", "baja"] as GravedadSim[]).map((g) => (
              <button
                key={g}
                type="button"
                className="chip"
                aria-pressed={gravedad === g}
                onClick={() => setGravedad(g)}
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: `var(${GRAVEDAD_UI[g].color})` }} aria-hidden />
                {GRAVEDAD_UI[g].etiqueta}
              </button>
            ))}
          </div>
        </div>

        {/* Imagen */}
        <div>
          <label htmlFor="sim-imagen" className="mb-1 flex items-center gap-1 text-xs font-medium text-foreground">
            Imagen <span className="font-normal text-subtle">(opcional)</span>
            <Ayuda texto="URL pública https o una ruta del dataset (/dataset/img/…). Si hay visión configurada, el pipeline la analiza." />
          </label>
          <div className="flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <ImageIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
              <input
                id="sim-imagen"
                value={imagen}
                onChange={(e) => setImagen(e.target.value)}
                placeholder="https://… o /dataset/img/…"
                className={`${claseCampo} pl-8`}
              />
            </div>
            {imagen && (
              <Tooltip titulo="Quitar la imagen" contenido="El evento se enviará solo con el texto; el pipeline no pasará por visión artificial.">
                <button type="button" className="boton boton-fantasma boton-sm px-2" aria-label="Quitar imagen" onClick={() => setImagen("")}>
                  <X className="size-3.5" aria-hidden />
                </button>
              </Tooltip>
            )}
          </div>
          {imagenes.length > 0 && (
            <div className="scroll-thin mt-1.5 flex gap-1.5 overflow-x-auto pb-1" role="listbox" aria-label="Imágenes del dataset">
              {imagenes.slice(0, 24).map((src) => (
                <button
                  key={src}
                  type="button"
                  role="option"
                  aria-selected={imagen === src}
                  onClick={() => setImagen(imagen === src ? "" : src)}
                  className={`shrink-0 overflow-hidden rounded-[8px] border-2 transition ${imagen === src ? "border-brand" : "border-transparent hover:border-panel-border-strong"}`}
                  aria-label={`Usar la imagen ${src}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading="lazy" className="size-12 object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      </fieldset>

      {/* Acción */}
      <div className="rounded-[10px] border border-panel-border bg-panel-2 px-3 py-2.5">
        <p className="text-[11px] leading-relaxed text-muted">
          Se enviará como{" "}
          <span className="pildora align-middle text-foreground" style={tinte(ui.color, true)}>
            {ui.etiqueta}
          </span>{" "}
          por <b className="font-semibold text-foreground">{OBSERVACION_UI[tipoObs].etiqueta}</b>, marcado como simulacro. Se espera que el
          pipeline lo clasifique como <b className="font-semibold text-foreground">{etiquetaCategoria(ui.categoria)}</b>.
        </p>
        <Tooltip contenido={motivoBloqueo ?? "Entra por el pipeline de periféricos (o por el motor si el pipeline no responde). Atajo: ⌘/Ctrl + Enter."} className="mt-2 w-full">
          <button type="submit" className="boton boton-primario w-full" disabled={!listo}>
            {enviando ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            {enviando ? "Inyectando… (la IA puede tardar)" : "Inyectar ahora"}
          </button>
        </Tooltip>
        <ErrorInline mensaje={error} className="mt-2" />
        {resultado && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-panel-border pt-2 text-[11px]" aria-live="polite">
            <span className="text-muted">Resultado:</span>
            <PildoraImpacto impacto={resultado.impacto} error={resultado.error} />
            {resultado.categoria && (
              <Tooltip titulo="Categoría detectada" contenido="Lo que el pipeline ha entendido que es la observación. En Resultados se compara con la esperada.">
                <span className="pildora" tabIndex={0}>
                  {etiquetaCategoria(resultado.categoria)}
                </span>
              </Tooltip>
            )}
            {resultado.decisionId && onSeleccionarDecision && (
              <Tooltip titulo="Ver la decisión" contenido="Abre en la consola la decisión que la IA ha propuesto a partir de este evento.">
                <button
                  type="button"
                  className="boton boton-fantasma boton-sm gap-0.5 px-1.5 text-[11px] text-brand"
                  onClick={() => onSeleccionarDecision(resultado.decisionId!)}
                >
                  Ver decisión <ArrowUpRight className="size-3" aria-hidden />
                </button>
              </Tooltip>
            )}
            <Tooltip titulo="Ver en resultados" contenido="Cambia a la pestaña Resultados, con el histórico de todo lo inyectado en esta sesión." className="ml-auto">
              <button type="button" className="boton boton-fantasma boton-sm px-1.5 text-[11px]" onClick={onVerResultados}>
                Ver en resultados
              </button>
            </Tooltip>
            {resultado.error && <ErrorInline mensaje={resultado.error} className="w-full" />}
          </div>
        )}
      </div>
    </form>
  );
}
