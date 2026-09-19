"use client";
// Pestaña "Focos": una tarjeta por incendio con todo lo operativo y acciones
// (abrir incidencia, confirmar/descartar, centrar, cambiar estado, nota, viento).
// DUEÑO: constructor E; ampliada por el constructor H (2026-09-19).
//
// Secciones: "Sin confirmar" (señales de prensa/redes/satélite que todavía no
// mueven medios), "Activos" y, plegados, los "Absorbidos" por otro foco y los
// cerrados. Nunca se mezcla lo que dice una fuente con lo que escribe el mando.

import { useMemo, useState } from "react";
import { Check, Crosshair, Flame, NotebookPen, Radio, ShieldCheck, Wind, X } from "lucide-react";
import type { EstadoIncendio, Incendio, Snapshot } from "@/lib/dominio/tipos";
import { actualizarFoco, mensajeDeError } from "@/lib/cliente/api";
import { distancia, haceCuanto, hectareas, hora, minutos, numero, rumboFrase, viento } from "@/lib/cliente/formato";
import { urlOsm } from "@/lib/cliente/enlaces";
import { EnlaceExterno, EnlaceInterno } from "@/components/ui/Enlace";
import { Boton } from "@/components/ui/Boton";
import { Desplegable } from "@/components/ui/Desplegable";
import { Dialogo } from "@/components/ui/Dialogo";
import {
  Insignia,
  TEXTO_ESTADO_INCENDIO,
  TEXTO_ESTADO_UNIDAD,
  TEXTO_PELIGRO,
  TEXTO_RIESGO,
  tonoEstadoIncendio,
  tonoEstadoUnidad,
  tonoPeligro,
  tonoRiesgo,
} from "@/components/ui/Insignia";
import { useToast } from "@/components/ui/Toast";
import { Vacio } from "@/components/ui/Vacio";
import { ControlViento } from "./ControlViento";
import {
  AvisoSinConfirmar,
  BarraContencion,
  EnlaceMeteo,
  InsigniaVientoForzado,
  MediosExternos,
  NotaDelMando,
  SegunLaFuente,
  fraseConfianza,
  poblacionesEnPeligro,
  sinConfirmar,
} from "./DetalleFoco";

const CIERRES: { estado: EstadoIncendio; etiqueta: string; pregunta: string }[] = [
  { estado: "controlado", etiqueta: "Marcar controlado", pregunta: "¿Confirmas que el incendio está controlado?" },
  { estado: "extinguido", etiqueta: "Marcar extinguido", pregunta: "¿Confirmas que el incendio está extinguido?" },
  { estado: "descartado", etiqueta: "Descartar (falsa alarma)", pregunta: "¿Confirmas que era una falsa alarma?" },
];

/** Estados que ya no son operativos: no cuentan como focos activos en ningún filtro. */
const CERRADOS: EstadoIncendio[] = ["extinguido", "descartado", "fusionado"];

export function PestanaFocos({
  snapshot,
  onCentrar,
  onTrasCambio,
  seleccionado,
}: {
  snapshot?: Snapshot;
  onCentrar?: (id: string) => void;
  onTrasCambio?: () => void;
  seleccionado?: string;
}) {
  const incendios = useMemo(() => snapshot?.incendios ?? [], [snapshot?.incendios]);
  const { porConfirmar, activos, absorbidos, cerrados } = useMemo(() => {
    const porConfirmar = incendios.filter((i) => i.estado === "detectado");
    const absorbidos = incendios.filter((i) => i.estado === "fusionado");
    const cerrados = incendios.filter((i) => i.estado === "extinguido" || i.estado === "descartado");
    const activos = incendios.filter((i) => i.estado !== "detectado" && !CERRADOS.includes(i.estado));
    return { porConfirmar, activos, absorbidos, cerrados };
  }, [incendios]);

  if (incendios.length === 0) {
    return (
      <Vacio
        icono={<Flame />}
        titulo="Ningún foco declarado"
        guia="Pulsa F o el botón «Declarar foco» y haz clic en el mapa. El núcleo buscará el municipio, los parques de bomberos, los pueblos y la meteo reales de esa zona."
      />
    );
  }

  const ficha = (inc: Incendio) => (
    <FichaFoco
      key={inc.id}
      incendio={inc}
      snapshot={snapshot}
      onCentrar={onCentrar}
      onTrasCambio={onTrasCambio}
      resaltado={seleccionado === inc.id}
    />
  );

  return (
    <div className="space-y-3">
      {porConfirmar.length > 0 ? (
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-warning">Sin confirmar ({porConfirmar.length})</h3>
          <p className="mb-1.5 text-[11.5px] leading-snug text-muted">
            Señales de una sola fuente. No se despliegan medios hasta que otra fuente o el mando las confirme.
          </p>
          <div className="space-y-2.5">{porConfirmar.map(ficha)}</div>
        </section>
      ) : null}

      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">Activos ({activos.length})</h3>
        {activos.length === 0 ? (
          <p className="rounded-xl border border-panel-border bg-panel p-2.5 text-[12.5px] leading-snug text-muted">
            Ningún foco activo ahora mismo.
          </p>
        ) : (
          <div className="space-y-2.5">{activos.map(ficha)}</div>
        )}
      </section>

      {absorbidos.length > 0 ? (
        <Desplegable titulo="Absorbidos" cuenta={absorbidos.length}>
          <ul className="space-y-1">
            {absorbidos.map((i) => {
              const superviviente = incendios.find((x) => x.id === i.fusionadoEn);
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-1.5">
                  <Insignia pequena tono="neutro" punto>
                    Fusionado
                  </Insignia>
                  <span className="font-medium text-foreground">{i.nombre}</span>
                  <span>unido a {superviviente?.nombre ?? i.fusionadoEn ?? "otro foco"}</span>
                </li>
              );
            })}
          </ul>
        </Desplegable>
      ) : null}

      {cerrados.length > 0 ? (
        <Desplegable titulo="Cerrados" cuenta={cerrados.length}>
          <div className="space-y-2.5">{cerrados.map(ficha)}</div>
        </Desplegable>
      ) : null}
    </div>
  );
}

function FichaFoco({
  incendio: inc,
  snapshot,
  onCentrar,
  onTrasCambio,
  resaltado,
}: {
  incendio: Incendio;
  snapshot?: Snapshot;
  onCentrar?: (id: string) => void;
  onTrasCambio?: () => void;
  resaltado: boolean;
}) {
  const toast = useToast();
  const [confirmar, setConfirmar] = useState<(typeof CIERRES)[number] | null>(null);
  const [dialogoNota, setDialogoNota] = useState(false);
  const [nota, setNota] = useState(inc.notas ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [dialogoViento, setDialogoViento] = useState(false);

  const porConfirmar = sinConfirmar(inc);
  const unidades = (snapshot?.unidades ?? []).filter((u) => u.incendioId === inc.id);
  const todasLasPoblaciones = (snapshot?.poblaciones ?? []).filter((p) => p.incendioId === inc.id);
  const poblaciones = useMemo(
    () => poblacionesEnPeligro(todasLasPoblaciones).sort((a, b) => (a.etaFrenteMin ?? 1e9) - (b.etaFrenteMin ?? 1e9)),
    [todasLasPoblaciones],
  );
  const cluster = snapshot?.clusters.find((c) => c.id === inc.clusterId);
  /**
   * Avisos que sostienen este foco (llamadas, prensa, redes, cámara, satélite).
   * `inc.observaciones` son ids: aquí se resuelven contra el snapshot para poder
   * abrir la fuente original de cada uno.
   */
  const observaciones = useMemo(() => {
    const ids = new Set(inc.observaciones ?? []);
    return (snapshot?.observaciones ?? [])
      .filter((o) => ids.has(o.id) || o.incendioId === inc.id)
      .sort((a, b) => b.recibidaEn.localeCompare(a.recibidaEn))
      .slice(0, 12);
  }, [inc.id, inc.observaciones, snapshot?.observaciones]);
  const informes = (snapshot?.informes ?? []).filter((i) => i.incendioId === inc.id);
  /** Último comunicado publicado de este foco, para enlazar con el portal. */
  const comunicado = (snapshot?.comunicados ?? [])
    .filter((c) => c.incendioId === inc.id && c.estado === "publicado")
    .sort((a, b) => (b.publicadoEn ?? "").localeCompare(a.publicadoEn ?? ""))[0];

  async function cambiarEstado(estado: EstadoIncendio) {
    setOcupado(true);
    try {
      await actualizarFoco(inc.id, { estado });
      toast.exito(`${inc.nombre}: ${TEXTO_ESTADO_INCENDIO[estado].toLowerCase()}`);
      setConfirmar(null);
      onTrasCambio?.();
    } catch (e) {
      toast.error("No se ha podido cambiar el estado", mensajeDeError(e));
    } finally {
      setOcupado(false);
    }
  }

  async function guardarNota() {
    setOcupado(true);
    try {
      await actualizarFoco(inc.id, { notas: nota });
      toast.exito("Nota guardada");
      setDialogoNota(false);
      onTrasCambio?.();
    } catch (e) {
      toast.error("No se ha podido guardar la nota", mensajeDeError(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <article
      className={[
        "rounded-xl border bg-panel p-3",
        resaltado ? "border-brand shadow-[var(--sombra-panel)]" : porConfirmar ? "border-warning/50" : "border-panel-border",
      ].join(" ")}
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold leading-tight text-foreground">{inc.nombre}</h3>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-[11.5px] text-muted">
            <span>
              {inc.municipio || "Municipio por determinar"}
              {inc.provincia ? ` · ${inc.provincia}` : ""} · detectado {haceCuanto(inc.detectadoEn)} por
            </span>
            {/* Si la fuente trae URL, su nombre abre la noticia/imagen original. */}
            <EnlaceExterno href={inc.fuenteUrl} className="text-[11.5px]" claseTexto="" titulo="Abrir la fuente que detectó este foco">
              {inc.fuenteDeteccion ?? inc.origen}
            </EnlaceExterno>
          </p>
        </div>
      </header>

      <div className="mt-1.5 flex flex-wrap gap-1">
        <Insignia pequena tono={porConfirmar ? "aviso" : tonoEstadoIncendio(inc.estado)} punto>
          {porConfirmar ? "Sin confirmar" : TEXTO_ESTADO_INCENDIO[inc.estado]}
        </Insignia>
        <Insignia pequena tono={inc.nivelGravedad >= 2 ? "peligro" : "neutro"}>Nivel {inc.nivelGravedad}</Insignia>
        <Insignia pequena tono="neutro">{hectareas(inc.areaHa)}</Insignia>
        {inc.peligro ? (
          <Insignia pequena tono={tonoPeligro(inc.peligro.nivel)} title={inc.peligro.motivo}>
            {TEXTO_PELIGRO[inc.peligro.nivel]} ({numero(inc.peligro.valor)})
          </Insignia>
        ) : null}
        {inc.focosAbsorbidos?.length ? (
          <Insignia pequena tono="info" title={inc.focosAbsorbidos.join(", ")}>
            Fusión de {inc.focosAbsorbidos.length + 1} focos
          </Insignia>
        ) : null}
        <InsigniaVientoForzado incendio={inc} />
      </div>
      <p className="mt-1 text-[11.5px] leading-snug text-subtle">{fraseConfianza(inc)}</p>

      <AvisoSinConfirmar incendio={inc} />
      <SegunLaFuente incendio={inc} />
      <NotaDelMando incendio={inc} />

      {inc.frente ? (
        <p className="mt-1.5 text-[12.5px] leading-snug text-muted">
          Frente {rumboFrase(inc.frente.rumboGrados, inc.frente.rumboTexto)} a {numero(inc.frente.velocidadMmin, 1)} m/min.
        </p>
      ) : null}
      {inc.meteo ? (
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted">
          Viento {viento(inc.meteo.direccionGrados, inc.meteo.vientoKmh, inc.meteo.rachasKmh, inc.meteo.direccionTexto)} ·{" "}
          {numero(inc.meteo.temperaturaC, 0)} °C · {numero(inc.meteo.humedadPct, 0)} % HR
          {inc.combustible ? ` · combustible ${inc.combustible.dominante}` : ""}{" "}
          <EnlaceMeteo incendio={inc} />
        </p>
      ) : null}
      {inc.peligro?.motivo ? <p className="mt-0.5 text-[11.5px] leading-snug text-subtle">{inc.peligro.motivo}</p> : null}

      <BarraContencion incendio={inc} />

      {comunicado ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-panel-border bg-panel-2 px-2 py-1 text-[11.5px] leading-snug text-muted">
          <Radio className="size-3.5 shrink-0 text-brand" aria-hidden />
          <span className="font-medium text-foreground">{comunicado.titulo}</span>
          <span className="text-subtle">publicado {hora(comunicado.publicadoEn)}</span>
          <EnlaceInterno href="/publico" titulo="Ver el comunicado publicado en el portal ciudadano">
            Ver en el portal
          </EnlaceInterno>
        </p>
      ) : null}

      <div className="mt-2 space-y-1.5">
        <Desplegable
          titulo="Pueblos en peligro"
          cuenta={poblaciones.length}
          abiertoPorDefecto={poblaciones.some((p) => p.riesgo === "inminente")}
        >
          {todasLasPoblaciones.length === 0 ? (
            <p>Todavía no se han cargado los núcleos de población del entorno.</p>
          ) : poblaciones.length === 0 ? (
            <p>
              Ninguno en peligro ahora mismo <span className="text-subtle">(de {todasLasPoblaciones.length} en el radio)</span>.
            </p>
          ) : (
            <>
              <p className="mb-1 text-subtle">
                {poblaciones.length} con riesgo medio o superior, de {todasLasPoblaciones.length} en el radio.
              </p>
              <ul className="space-y-1">
                {poblaciones.slice(0, 12).map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-1.5">
                    <Insignia pequena tono={tonoRiesgo(p.riesgo)} punto>
                      {TEXTO_RIESGO[p.riesgo]}
                    </Insignia>
                    <EnlaceExterno href={urlOsm(p.id)} className="text-[12px] font-medium" titulo={`Ver ${p.nombre} en OpenStreetMap`}>
                      {p.nombre}
                    </EnlaceExterno>
                    <span>
                      a {distancia(p.distanciaKm)}
                      {p.etaFrenteMin !== undefined ? ` · frente en ${minutos(p.etaFrenteMin)}` : ""} · {p.estadoAviso.replace(/_/g, " ")}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Desplegable>

        <Desplegable titulo="Unidades asignadas" cuenta={unidades.length} abiertoPorDefecto={unidades.length > 0}>
          {unidades.length === 0 ? (
            <p>
              Sin medios asignados por Atalaya todavía.
              {porConfirmar ? " El foco está sin confirmar: no se despliega nada hasta confirmarlo." : ""}
            </p>
          ) : (
            <ul className="space-y-1">
              {unidades.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-1.5">
                  <Insignia pequena tono={tonoEstadoUnidad(u.estado)} punto>
                    {TEXTO_ESTADO_UNIDAD[u.estado]}
                  </Insignia>
                  <EnlaceExterno
                    href={urlOsm(u.base.osmId ?? u.id)}
                    className="text-[12px] font-medium"
                    titulo={`Ver ${u.base.nombre} en OpenStreetMap`}
                  >
                    {u.nombre}
                  </EnlaceExterno>
                  <span>
                    {u.dotacion.personas} personas · {u.dotacion.vehiculos} vehículos
                    {u.ruta && u.estado === "en_ruta"
                      ? ` · ${numero((u.ruta.progreso ?? 0) * 100, 0)} % del trayecto · llega ${hora(u.ruta.llegadaPrevista)}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <MediosExternos incendio={inc} />
        </Desplegable>

        {observaciones.length > 0 ? (
          <Desplegable titulo="Avisos y fuentes" cuenta={observaciones.length}>
            <ul className="space-y-1.5">
              {observaciones.map((o) => (
                <li key={o.id}>
                  <span className="font-medium capitalize text-foreground">{o.canal.replace(/_/g, " ")}</span>
                  {o.remitente ? <span className="text-subtle"> · {o.remitente}</span> : null}
                  <span className="text-subtle"> · {haceCuanto(o.recibidaEn)}</span>
                  <br />
                  {o.extraccion?.resumen || o.texto}
                  {/* Solo se pinta el enlace si la observación trae URL real. */}
                  {o.urlFuente ? (
                    <>
                      {" "}
                      <EnlaceExterno href={o.urlFuente} className="text-[12px]" siNoHayUrl="nada" titulo="Abrir la fuente original de este aviso">
                        Ver la fuente
                      </EnlaceExterno>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </Desplegable>
        ) : null}

        {cluster ? (
          <Desplegable titulo={`Clúster: ${cluster.tipo.replace(/_/g, " ")}`}>
            <p>{cluster.analisis}</p>
            <p className="mt-1 font-medium text-foreground">{cluster.recomendacion}</p>
          </Desplegable>
        ) : null}

        {informes.length > 0 ? (
          <Desplegable titulo="Informes" cuenta={informes.length}>
            <ul className="space-y-0.5">
              {informes.map((i) => (
                <li key={i.id} className="flex flex-wrap items-baseline gap-1">
                  <EnlaceInterno href={`/informes#${i.id}`} titulo="Abrir el acta completa en Informes">
                    {i.titulo}
                  </EnlaceInterno>
                  <span className="text-subtle">· {haceCuanto(i.generadoEn)}</span>
                </li>
              ))}
            </ul>
          </Desplegable>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {/* AÑADIDO (constructor G): entrada al visor de la incidencia (flujo de agentes + hilo + auditoría). */}
        <a href={`/incidencias/${encodeURIComponent(inc.id)}`}><Boton tamano="sm" variante="primario" icono={<Flame />}>Abrir incidencia</Boton></a>
        {porConfirmar ? (
          <>
            <Boton tamano="sm" variante="primario" icono={<Check />} cargando={ocupado} onClick={() => cambiarEstado("confirmado")}>
              Confirmar foco
            </Boton>
            <Boton tamano="sm" variante="peligro" icono={<X />} cargando={ocupado} onClick={() => cambiarEstado("descartado")}>
              Descartar
            </Boton>
          </>
        ) : null}
        <Boton tamano="sm" icono={<Crosshair />} onClick={() => onCentrar?.(inc.id)}>
          Centrar en el mapa
        </Boton>
        <Boton tamano="sm" variante={inc.meteoForzada ? "primario" : "secundario"} icono={<Wind />} onClick={() => setDialogoViento(true)}>
          Viento (ejercicio)
        </Boton>
        <Boton tamano="sm" icono={<NotebookPen />} onClick={() => setDialogoNota(true)}>
          Añadir nota
        </Boton>
        {CIERRES.filter((c) => c.estado !== inc.estado).map((c) => (
          <Boton key={c.estado} tamano="sm" variante="fantasma" icono={<ShieldCheck />} onClick={() => setConfirmar(c)}>
            {c.etiqueta}
          </Boton>
        ))}
      </div>

      <Dialogo
        abierto={dialogoViento}
        onCerrar={() => setDialogoViento(false)}
        titulo={`Viento del ejercicio · ${inc.nombre}`}
        descripcion="Decide desde dónde sopla y con qué fuerza. El sistema lo marca como forzado y replanifica con él."
        ancho="sm"
        pie={
          <Boton variante="fantasma" onClick={() => setDialogoViento(false)}>
            Cerrar
          </Boton>
        }
      >
        <ControlViento
          focoId={inc.id}
          inicial={inc.meteoForzada ?? (inc.meteo ? { direccionGrados: inc.meteo.direccionGrados, vientoKmh: inc.meteo.vientoKmh } : undefined)}
          forzado={inc.meteoForzada}
          onCambio={onTrasCambio}
        />
      </Dialogo>

      <Dialogo
        abierto={confirmar !== null}
        onCerrar={() => setConfirmar(null)}
        titulo={confirmar?.etiqueta ?? ""}
        descripcion={confirmar?.pregunta}
        ancho="sm"
        pie={
          <>
            <Boton variante="fantasma" onClick={() => setConfirmar(null)}>
              Cancelar
            </Boton>
            <Boton variante="primario" cargando={ocupado} onClick={() => confirmar && cambiarEstado(confirmar.estado)}>
              Confirmar
            </Boton>
          </>
        }
      >
        <p className="text-[13px] leading-snug text-muted">
          {inc.nombre} · {hectareas(inc.areaHa)} · {unidades.length} unidades asignadas. El cambio queda registrado como decisión humana y
          los agentes lo tendrán en cuenta.
        </p>
      </Dialogo>

      <Dialogo
        abierto={dialogoNota}
        onCerrar={() => setDialogoNota(false)}
        titulo="Nota del mando"
        descripcion="Lo que escribas aquí es tuyo: no se mezcla con lo que dice la fuente. Queda visible para todos y se guarda con el foco."
        ancho="sm"
        pie={
          <>
            <Boton variante="fantasma" onClick={() => setDialogoNota(false)}>
              Cancelar
            </Boton>
            <Boton variante="primario" cargando={ocupado} onClick={guardarNota}>
              Guardar nota
            </Boton>
          </>
        }
      >
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={4}
          placeholder="Ej.: acceso cortado por la CL-501, coordinar con el 112 de Castilla y León"
          className="w-full rounded-lg border border-panel-border-strong bg-panel-2 p-2 text-sm text-foreground placeholder:text-subtle"
        />
      </Dialogo>
    </article>
  );
}
