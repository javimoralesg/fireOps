"use client";

// Eventos sueltos del dataset (data/dataset/sueltos.json): buscador, filtros por
// tipo, canal y veracidad, y botón "Inyectar" con el resultado en la propia tarjeta.
// La marca bulo / duplicado / ruido avisa al presentador de qué está lanzando.

import { useMemo, useState } from "react";
import { ArrowUpRight, Inbox, LoaderCircle, MapPin, PenLine, Search, Send, Target } from "lucide-react";
import { api } from "@/lib/api-cliente";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { etiquetaCategoria, uiCanal, uiTipo, VERACIDAD_UI, VERACIDADES } from "./catalogo";
import { AVISO_SIN_PERMISO, ChipTipo, ErrorInline, mensajeError, PildoraImpacto, PildoraVeracidad, sinTildes } from "./ui";
import { cuerpoInyeccion, type EventoSim, type ResultadoSim, type Veracidad } from "./tipos";

const PAGINA = 25;

/** Fuera del componente: el motor rechaza ids repetidos, así que un relanzamiento lleva sufijo. */
const idReenvio = (id: string) => `${id}-r${Date.now().toString(36)}`;

function contar<K extends string>(eventos: EventoSim[], clave: (e: EventoSim) => K): Map<K, number> {
  const m = new Map<K, number>();
  for (const e of eventos) m.set(clave(e), (m.get(clave(e)) ?? 0) + 1);
  return m;
}

interface Props {
  eventos: EventoSim[];
  puedeControlar: boolean;
  /** Ids que el servidor ya ha recibido (para no chocar con "Evento duplicado"). */
  idsUsados: Set<string>;
  onInyectado: (resultado: ResultadoSim, evento: EventoSim) => void;
  onSeleccionarDecision?: (id: string) => void;
  onIrACompositor: () => void;
  onCambio?: () => void;
}

const claseSelect =
  "min-w-0 flex-1 rounded-[8px] border border-panel-border-strong bg-panel px-2 py-1 text-xs text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

export function Sueltos({ eventos, puedeControlar, idsUsados, onInyectado, onSeleccionarDecision, onIrACompositor, onCambio }: Props) {
  const [busqueda, setBusqueda] = useState("");
  const [tipo, setTipo] = useState("");
  const [canal, setCanal] = useState("");
  const [veracidad, setVeracidad] = useState<Veracidad | null>(null);
  const [limite, setLimite] = useState(PAGINA);

  const tipos = useMemo(() => [...contar(eventos, (e) => e.tipoEmergencia).entries()].sort((a, b) => b[1] - a[1]), [eventos]);
  const canales = useMemo(() => [...contar(eventos, (e) => e.canal).entries()].sort((a, b) => b[1] - a[1]), [eventos]);
  const veracidades = useMemo(() => contar(eventos, (e) => e.veracidad), [eventos]);

  const filtrados = useMemo(() => {
    const q = sinTildes(busqueda.trim());
    return eventos.filter(
      (e) =>
        (!tipo || e.tipoEmergencia === tipo) &&
        (!canal || e.canal === canal) &&
        (!veracidad || e.veracidad === veracidad) &&
        (!q || sinTildes(`${e.titulo} ${e.texto ?? ""} ${e.lugar?.nombre ?? ""} ${e.id ?? ""}`).includes(q)),
    );
  }, [eventos, busqueda, tipo, canal, veracidad]);

  if (eventos.length === 0) {
    return (
      <div className="rounded-[10px] border border-dashed border-panel-border-strong bg-panel-2 px-4 py-5 text-center">
        <Inbox className="mx-auto size-5 text-subtle" aria-hidden />
        <p className="mt-1.5 text-[13px] font-semibold text-foreground">El dataset aún no tiene eventos sueltos</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          El servidor los lee de <span className="font-mono">data/dataset/sueltos.json</span>. Mientras tanto, compón uno a mano.
        </p>
        <button type="button" className="boton boton-secundario boton-sm mt-3" onClick={onIrACompositor}>
          <PenLine className="size-3.5" aria-hidden /> Componer un evento
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <label className="relative block">
        <span className="sr-only">Buscar evento</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          type="search"
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value);
            setLimite(PAGINA);
          }}
          placeholder="Buscar por texto, lugar o id…"
          className="w-full rounded-[10px] border border-panel-border-strong bg-panel py-1.5 pl-8 pr-3 text-[13px] text-foreground outline-none transition placeholder:text-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </label>

      <div className="flex gap-1.5">
        <select aria-label="Filtrar por tipo de emergencia" className={claseSelect} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Todos los tipos ({eventos.length})</option>
          {tipos.map(([t, n]) => (
            <option key={t} value={t}>
              {uiTipo(t).etiqueta} ({n})
            </option>
          ))}
        </select>
        <select aria-label="Filtrar por canal" className={claseSelect} value={canal} onChange={(e) => setCanal(e.target.value)}>
          <option value="">Todos los canales</option>
          {canales.map(([c, n]) => (
            <option key={c} value={c}>
              {uiCanal(c).etiqueta} ({n})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por veracidad">
        <button type="button" className="chip" aria-pressed={veracidad === null} onClick={() => setVeracidad(null)}>
          Todos <span className="font-mono">{eventos.length}</span>
        </button>
        {VERACIDADES.map((v) => {
          const ui = VERACIDAD_UI[v];
          const Icono = ui.icon;
          const n = veracidades.get(v) ?? 0;
          return (
            <Tooltip key={v} titulo={ui.etiqueta} contenido={ui.ayuda}>
              <button
                type="button"
                className="chip"
                aria-pressed={veracidad === v}
                disabled={n === 0}
                onClick={() => setVeracidad(veracidad === v ? null : v)}
              >
                <Icono className="size-3" aria-hidden />
                {ui.etiqueta} <span className="font-mono">{n}</span>
              </button>
            </Tooltip>
          );
        })}
      </div>

      <p className="flex items-center gap-1 text-[11px] text-subtle">
        <span className="font-mono text-muted">{filtrados.length}</span> de <span className="font-mono">{eventos.length}</span> eventos
        <Ayuda
          titulo="De dónde salen"
          texto="Eventos sueltos de data/dataset/sueltos.json. Cada uno trae su verdad de campo y lo que se espera que detecte el pipeline; «Inyectar» lo manda al motor de uno en uno."
        />
      </p>

      <ul className="space-y-2">
        {filtrados.slice(0, limite).map((e) => (
          <TarjetaEvento
            key={e.clave}
            evento={e}
            puedeControlar={puedeControlar}
            idsUsados={idsUsados}
            onInyectado={onInyectado}
            onSeleccionarDecision={onSeleccionarDecision}
            onCambio={onCambio}
          />
        ))}
      </ul>
      {filtrados.length > limite && (
        <button type="button" className="boton boton-fantasma boton-sm w-full" onClick={() => setLimite((l) => l + PAGINA)}>
          Ver {Math.min(PAGINA, filtrados.length - limite)} más
        </button>
      )}
    </div>
  );
}

function TarjetaEvento({
  evento: e,
  puedeControlar,
  idsUsados,
  onInyectado,
  onSeleccionarDecision,
  onCambio,
}: {
  evento: EventoSim;
  puedeControlar: boolean;
  idsUsados: Set<string>;
  onInyectado: Props["onInyectado"];
  onSeleccionarDecision?: (id: string) => void;
  onCambio?: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoSim | null>(null);
  const canal = uiCanal(e.canal, e.tipoObservacion);
  const IconoCanal = canal.icon;

  const inyectar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const repetido = Boolean(e.id && (idsUsados.has(e.id) || resultado));
      const cuerpo = cuerpoInyeccion(e, repetido && e.id ? idReenvio(e.id) : undefined);
      if (!cuerpo.observacion.datasetId) cuerpo.observacion.datasetId = "sueltos";
      const r = await api.inyectarEvento(cuerpo);
      setResultado(r);
      onInyectado(r, e);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
      onCambio?.();
    }
  };

  const noReal = e.veracidad !== "real";

  return (
    <li
      className="rounded-[10px] border bg-panel px-3 py-2.5"
      style={{
        borderColor: noReal
          ? `color-mix(in srgb, var(${e.veracidad === "bulo" ? "--danger" : e.veracidad === "ruido" ? "--warning" : "--panel-border-strong"}) 45%, transparent)`
          : "var(--panel-border)",
        borderStyle: e.veracidad === "duplicado" ? "dashed" : "solid",
      }}
    >
      <div className="flex gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <PildoraVeracidad veracidad={e.veracidad} motivo={e.motivoVeracidad} ocultarReal />
            <ChipTipo tipo={e.tipoEmergencia} />
            <Tooltip titulo="Canal" contenido={`Por dónde entra el evento: ${canal.etiqueta}. Tipo de observación: ${e.tipoObservacion}.`}>
              <span className="flex items-center gap-1 text-[11px] text-muted" tabIndex={0}>
                <IconoCanal className="size-3" aria-hidden />
                {canal.etiqueta}
              </span>
            </Tooltip>
          </div>
          <p className="mt-1 text-[13px] font-semibold leading-snug text-foreground">{e.titulo}</p>
          {e.texto && e.texto !== e.titulo && <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">«{e.texto}»</p>}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-subtle">
            {e.lugar ? (
              <Tooltip titulo="Lugar" contenido={`${e.lugar.lat.toFixed(5)}, ${e.lugar.lon.toFixed(5)}`}>
                <span className="flex min-w-0 items-center gap-1" tabIndex={0}>
                  <MapPin className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{e.lugar.nombre ?? `${e.lugar.lat.toFixed(4)}, ${e.lugar.lon.toFixed(4)}`}</span>
                </span>
              </Tooltip>
            ) : (
              <span className="flex items-center gap-1">
                <MapPin className="size-3" aria-hidden /> sin posición
              </span>
            )}
            {e.esperadoCategoria && (
              <Tooltip
                titulo="Resultado esperado"
                contenido={
                  <>
                    Lo que el dataset espera que detecte el pipeline; en Resultados se marca en verde si acierta y en rojo si no.
                    {e.gravedad && (
                      <>
                        <br />
                        <b>Gravedad esperada:</b> {e.gravedad}
                      </>
                    )}
                    {e.decisionEsperada && (
                      <>
                        <br />
                        <b>Decisión esperada:</b> {e.decisionEsperada}
                      </>
                    )}
                  </>
                }
                ancho={320}
              >
                <span className="flex items-center gap-1" tabIndex={0}>
                  <Target className="size-3" aria-hidden /> espera {etiquetaCategoria(e.esperadoCategoria)}
                </span>
              </Tooltip>
            )}
            {e.id && <span className="font-mono">{e.id}</span>}
          </p>
        </div>
        {e.imagen && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={e.imagen}
            alt={e.imagenDescripcion ?? "Imagen adjunta al evento"}
            loading="lazy"
            className="size-14 shrink-0 rounded-[8px] border border-panel-border object-cover"
          />
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {resultado && (
            <>
              <PildoraImpacto impacto={resultado.impacto} error={resultado.error} />
              {resultado.categoria && (
                <Tooltip titulo="Categoría detectada" contenido="Lo que el pipeline (visión o texto) ha entendido que es esta observación.">
                  <span className="pildora" tabIndex={0}>
                    {etiquetaCategoria(resultado.categoria)}
                  </span>
                </Tooltip>
              )}
              {resultado.decisionId &&
                (onSeleccionarDecision ? (
                  <Tooltip
                    titulo="Ver la decisión"
                    contenido="Este evento ha hecho que la IA proponga una decisión. Abre su ficha en la cola de decisiones de la consola."
                  >
                    <button
                      type="button"
                      className="boton boton-fantasma boton-sm gap-0.5 px-1.5 text-[11px] text-brand"
                      onClick={() => onSeleccionarDecision(resultado.decisionId!)}
                    >
                      Ver decisión <ArrowUpRight className="size-3" aria-hidden />
                    </button>
                  </Tooltip>
                ) : (
                  <Tooltip titulo="Decisión creada" contenido="La IA ha propuesto una decisión a partir de este evento. Búscala por este id en la cola de decisiones.">
                    <span className="font-mono text-[11px] text-subtle" tabIndex={0}>
                      {resultado.decisionId}
                    </span>
                  </Tooltip>
                ))}
            </>
          )}
        </div>
        <Tooltip
          titulo={puedeControlar ? (resultado ? "Relanzar" : "Inyectar") : undefined}
          contenido={
            puedeControlar
              ? `Entra por el mismo pipeline que un periférico real (marcado como simulacro).${
                  noReal ? ` Ojo: es ${VERACIDAD_UI[e.veracidad].etiqueta.toLowerCase()}.` : ""
                }${resultado ? " Se relanza con un id nuevo." : ""}`
              : AVISO_SIN_PERMISO
          }
        >
          <button
            type="button"
            className="boton boton-secundario boton-sm"
            disabled={!puedeControlar || enviando}
            onClick={() => void inyectar()}
          >
            {enviando ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
            {enviando ? "Inyectando…" : resultado ? "Relanzar" : "Inyectar"}
          </button>
        </Tooltip>
      </div>
      {resultado?.error && <ErrorInline mensaje={resultado.error} className="mt-1.5" />}
      <ErrorInline mensaje={error} className="mt-1.5" />
    </li>
  );
}
