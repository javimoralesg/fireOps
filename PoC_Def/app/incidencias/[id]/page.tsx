"use client";
// =====================================================================
// ATALAYA INCENDIOS · Visor de una incidencia
// ---------------------------------------------------------------------
// DUEÑO: constructor G. Petición de Javi (2026-09-19):
//   "un visor de canvas de cada incidencia: los flujos de agentes que están
//    interviniendo, y a su derecha un informe en vivo de comunicaciones como
//    un hilo de noticias / timeline del evento, y que quede todo registrado
//    para poder auditarlo".
//
// Izquierda: lienzo del flujo de agentes (canvas propio, en vivo).
// Derecha: hilo cronológico de todo lo que pasa, con filtros y buscador.
// Arriba: ficha del foco y los tres botones que importan — ver en el mapa,
// informe en vivo y expediente descargable.
// Datos en vivo por SSE (useEstado); el expediente y el informe, por API.
// =====================================================================

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Crosshair, Download, FileText, Flame, Merge, ShieldCheck } from "lucide-react";
import type { Informe } from "@/lib/dominio/tipos";
import { useEstado } from "@/lib/cliente/useEstado";
import { generarInformeIncidencia, mensajeDeError, urlExpedienteIncidencia, urlInformeMarkdown } from "@/lib/cliente/api";
import { distancia, fechaHora, haceCuanto, hectareas, hora, minutos, numero, rumboFrase, viento } from "@/lib/cliente/formato";
import { Boton } from "@/components/ui/Boton";
import { Dialogo } from "@/components/ui/Dialogo";
import {
  Insignia,
  TEXTO_ESTADO_INCENDIO,
  TEXTO_PELIGRO,
  TEXTO_RIESGO,
  tonoEstadoIncendio,
  tonoPeligro,
  tonoRiesgo,
} from "@/components/ui/Insignia";
import { useToast } from "@/components/ui/Toast";
import { Vacio } from "@/components/ui/Vacio";
import { Marca } from "@/components/marca/Logo";
import { SelectorTema } from "@/components/marca/SelectorTema";
import { CabeceraInforme, Markdown } from "@/components/sala/DialogoInforme";
import { LienzoFlujoAgentes } from "@/components/incidencia/LienzoFlujoAgentes";
import { idsDeFoco } from "@/components/incidencia/hilo";
import { HiloIncidencia } from "@/components/incidencia/HiloIncidencia";

export default function VisorIncidencia({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { snapshot, conectado, cargando } = useEstado();
  const toast = useToast();

  const [generando, setGenerando] = useState(false);
  const [informe, setInforme] = useState<{ ficha: Informe | null; markdown: string; id: string } | null>(null);

  const incendio = snapshot?.incendios.find((i) => i.id === id);
  // Si este foco absorbió a otros al juntarse, su rastro forma parte de esta incidencia.
  const idsFoco = idsDeFoco(snapshot, id);
  const deEsteFoco = (otro?: string) => Boolean(otro && idsFoco.has(otro));
  const unidades = (snapshot?.unidades ?? []).filter((u) => deEsteFoco(u.incendioId));
  const poblaciones = (snapshot?.poblaciones ?? []).filter((p) => deEsteFoco(p.incendioId)).sort((a, b) => (a.etaFrenteMin ?? 1e9) - (b.etaFrenteMin ?? 1e9));
  const pendientes = (snapshot?.decisiones ?? []).filter((d) => deEsteFoco(d.incendioId) && (d.estado === "pendiente_humano" || d.estado === "escalada"));
  const superviviente = incendio?.fusionadoEn ? snapshot?.incendios.find((i) => i.id === incendio.fusionadoEn) : undefined;
  const absorbidos = (incendio?.focosAbsorbidos ?? [])
    .map((otro) => snapshot?.incendios.find((i) => i.id === otro))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));

  async function generarInforme() {
    setGenerando(true);
    try {
      const r = await generarInformeIncidencia(id);
      setInforme({ ficha: (snapshot?.informes ?? []).find((i) => i.id === r.informeId) ?? null, markdown: r.markdown, id: r.informeId });
      toast.exito("Informe en vivo generado", r.conNarrativaIA ? `Con narrativa de ${r.modelo}` : "Acta determinista (sin IA disponible)");
    } catch (e) {
      toast.error("No se ha podido generar el informe en vivo", mensajeDeError(e));
    } finally {
      setGenerando(false);
    }
  }

  if (!incendio) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-3 p-3">
        <Cabecera />
        <Vacio
          icono={<Flame />}
          titulo={cargando ? "Cargando la incidencia…" : `No se encuentra la incidencia «${id}»`}
          guia={
            cargando
              ? "Conectando con el estado en vivo."
              : "Puede que pertenezca a otra ejecución o que se haya descartado. Mira la lista de incidencias o la auditoría."
          }
          accion={
            <Link href="/incidencias">
              <Boton icono={<Flame />}>Ver todas las incidencias</Boton>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1700px] flex-col gap-3 p-3">
      <Cabecera />

      {superviviente ? (
        <p className="flex flex-wrap items-center gap-1.5 rounded-xl border border-fuego/45 bg-fuego/12 px-3 py-2 text-[13px] text-foreground">
          <Merge className="size-4 shrink-0 text-fuego" aria-hidden />
          Este foco se unió a{" "}
          <Link href={`/incidencias/${encodeURIComponent(superviviente.id)}`} className="font-semibold text-brand underline underline-offset-2">
            {superviviente.nombre}
          </Link>
          . Lo que ocurre ahora se registra allí; aquí queda su rastro para auditarlo.
        </p>
      ) : null}
      {absorbidos.length ? (
        <p className="flex flex-wrap items-center gap-1.5 rounded-xl border border-panel-border bg-panel-2 px-3 py-2 text-[12.5px] text-muted">
          <Merge className="size-4 shrink-0 text-fuego" aria-hidden />
          <span className="font-medium text-foreground">Esta incidencia ha absorbido {absorbidos.length} foco(s):</span>
          {absorbidos.map((a) => (
            <Link key={a.id} href={`/incidencias/${encodeURIComponent(a.id)}`} className="text-brand underline underline-offset-2">
              {a.nombre}
            </Link>
          ))}
          <span>Su hilo, sus decisiones y sus actas están incluidos aquí, marcados con su procedencia.</span>
        </p>
      ) : null}

      <header className="rounded-xl border border-panel-border bg-panel p-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-tight text-foreground">{incendio.nombre}</h1>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {incendio.municipio || "Municipio por determinar"}
              {incendio.provincia ? ` · ${incendio.provincia}` : ""}
              {incendio.comunidad ? ` · ${incendio.comunidad}` : ""} · detectado {haceCuanto(incendio.detectadoEn)} por {incendio.origen} ·{" "}
              <span className="tabular">
                hora de mundo {hora(snapshot?.reloj.ahoraMundo)} (×{numero(snapshot?.reloj.factor ?? 0)})
              </span>
              {conectado ? "" : " · pantalla posiblemente desfasada (sin stream)"}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Link href={`/?foco=${encodeURIComponent(incendio.id)}`}>
              <Boton tamano="sm" icono={<Crosshair />}>
                Ver en el mapa
              </Boton>
            </Link>
            <Boton tamano="sm" variante="primario" icono={<FileText />} cargando={generando} onClick={generarInforme}>
              Informe en vivo
            </Boton>
            <a href={urlExpedienteIncidencia(incendio.id)} download>
              <Boton tamano="sm" icono={<Download />}>
                Exportar expediente
              </Boton>
            </a>
            <Link href={`/auditoria?incendio=${encodeURIComponent(incendio.id)}`}>
              <Boton tamano="sm" variante="fantasma" icono={<ShieldCheck />}>
                Auditoría
              </Boton>
            </Link>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          <Insignia pequena tono={tonoEstadoIncendio(incendio.estado)} punto>
            {TEXTO_ESTADO_INCENDIO[incendio.estado]}
          </Insignia>
          <Insignia pequena tono={incendio.nivelGravedad >= 2 ? "peligro" : "neutro"}>Nivel {incendio.nivelGravedad}</Insignia>
          <Insignia pequena tono="neutro">{hectareas(incendio.areaHa)}</Insignia>
          {incendio.frente ? (
            <Insignia pequena tono="fuego">
              Frente {rumboFrase(incendio.frente.rumboGrados, incendio.frente.rumboTexto)} · {numero(incendio.frente.velocidadMmin, 1)} m/min
            </Insignia>
          ) : (
            <Insignia pequena tono="neutro">Frente sin calcular</Insignia>
          )}
          {incendio.peligro ? (
            <Insignia pequena tono={tonoPeligro(incendio.peligro.nivel)} title={incendio.peligro.motivo}>
              Peligro {TEXTO_PELIGRO[incendio.peligro.nivel]} ({numero(incendio.peligro.valor)})
            </Insignia>
          ) : null}
          {incendio.meteo ? (
            <Insignia pequena tono="info" title={`${incendio.meteo.fuente} · ${incendio.meteo.horaMundo}`}>
              {viento(incendio.meteo.direccionGrados, incendio.meteo.vientoKmh, incendio.meteo.rachasKmh, incendio.meteo.direccionTexto)} ·{" "}
              {numero(incendio.meteo.temperaturaC, 0)} °C · {numero(incendio.meteo.humedadPct, 0)} % HR
            </Insignia>
          ) : (
            <Insignia pequena tono="neutro">Sin meteo cargada</Insignia>
          )}
          <Insignia pequena tono="neutro">{unidades.length} unidades</Insignia>
          <Insignia pequena tono={poblaciones.some((p) => p.riesgo === "inminente") ? "peligro" : "neutro"}>
            {poblaciones.length} poblaciones
          </Insignia>
          {pendientes.length ? (
            <Insignia pequena tono="aviso" punto>
              {pendientes.length} esperando al mando
            </Insignia>
          ) : null}
        </div>

        {poblaciones.length ? (
          <p className="mt-1.5 text-[12px] leading-snug text-muted">
            <span className="font-medium text-foreground">Pueblos por orden de llegada del frente:</span>{" "}
            {poblaciones.slice(0, 5).map((p, i) => (
              <span key={p.id}>
                {i > 0 ? " · " : ""}
                <Insignia pequena tono={tonoRiesgo(p.riesgo)}>
                  {TEXTO_RIESGO[p.riesgo]}
                </Insignia>{" "}
                {p.nombre} a {distancia(p.distanciaKm)}
                {p.etaFrenteMin !== undefined ? ` (frente en ${minutos(p.etaFrenteMin)})` : ""} · {p.estadoAviso.replace(/_/g, " ")}
              </span>
            ))}
          </p>
        ) : null}
        {incendio.notas ? (
          <p className="mt-1.5 rounded-lg border border-panel-border bg-panel-2 px-2 py-1 text-[12px] leading-snug text-muted">
            <span className="font-medium text-foreground">Nota del mando:</span> {incendio.notas}
          </p>
        ) : null}
      </header>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section className="min-w-0">
          <h2 className="mb-1.5 text-[13px] font-semibold text-foreground">Flujo de agentes</h2>
          <LienzoFlujoAgentes incendioId={incendio.id} snapshot={snapshot} />
        </section>

        <section className="min-w-0">
          <h2 className="mb-1.5 text-[13px] font-semibold text-foreground">Hilo de la incidencia</h2>
          <HiloIncidencia incendioId={incendio.id} snapshot={snapshot} />
        </section>
      </div>

      <Dialogo
        abierto={informe !== null}
        onCerrar={() => setInforme(null)}
        titulo={informe?.ficha?.titulo ?? `Informe en vivo · ${incendio.nombre}`}
        ancho="lg"
        pie={
          <>
            {informe ? (
              <a href={urlInformeMarkdown(informe.id)} download>
                <Boton variante="primario" icono={<Download />}>
                  Descargar .md
                </Boton>
              </a>
            ) : null}
            <Boton variante="secundario" onClick={() => setInforme(null)}>
              Cerrar
            </Boton>
          </>
        }
      >
        {informe ? (
          <>
            {informe.ficha ? (
              <div className="mb-3 border-b border-panel-border pb-2">
                <CabeceraInforme informe={informe.ficha} />
              </div>
            ) : (
              <p className="mb-2 text-[11.5px] text-subtle">Acta {informe.id} · generada {fechaHora(new Date().toISOString())}</p>
            )}
            <Markdown texto={informe.markdown} />
          </>
        ) : null}
      </Dialogo>
    </div>
  );
}

function Cabecera() {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-panel-border pb-2">
      <Link href="/" className="rounded-lg">
        <Marca organismo="Visor de incidencia · flujo, hilo y auditoría" />
      </Link>
      <Link href="/incidencias" className="ml-auto">
        <Boton tamano="sm" variante="fantasma" icono={<Flame />}>
          Todas las incidencias
        </Boton>
      </Link>
      <Link href="/">
        <Boton tamano="sm" icono={<ArrowLeft />}>
          Volver a la sala
        </Boton>
      </Link>
      <SelectorTema compacto />
    </header>
  );
}
