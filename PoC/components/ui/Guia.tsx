"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  BookMarked,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Network,
  Radio,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "./Tooltip";

// Guía de la plataforma: cuatro pasos que explican cómo se lee la consola y
// qué puede hacer cada persona. Contenido estático; se abre desde el Header.

interface Paso {
  id: string;
  icono: LucideIcon;
  titulo: string;
  lema: string;
  puntos: ReactNode[];
  accion: string;
}

const PASOS: Paso[] = [
  {
    id: "entrada",
    icono: Radio,
    titulo: "Entra todo, pasa lo verificado",
    lema: "Columna izquierda · Entorno y feed de ingesta",
    puntos: [
      <>
        <strong>Datos reales</strong> de tráfico (Informo Madrid), viento y aire (Open-Meteo) y demanda eléctrica (REE), con
        su fuente y su hora.
      </>,
      <>
        <strong>Avisos ciudadanos</strong> por voz (HappyRobot), redes (Exa) y fotos analizadas por visión (fal.ai).
      </>,
      <>
        El <strong>verificador</strong> agrupa duplicados y frena posibles bulos antes de que lleguen al mando; cada evento
        lleva su confianza.
      </>,
    ],
    accion: "Pasa el ratón por cualquier cifra para ver qué es, de dónde sale y qué umbral la pone en aviso.",
  },
  {
    id: "grafo",
    icono: Network,
    titulo: "La ciudad como grafo",
    lema: "Centro · Grafo de dependencias y cronología",
    puntos: [
      <>
        Hospitales, rutas, vías y efectivos son <strong>nodos</strong>; las relaciones (bloquea, suministra, desplegado en)
        son <strong>aristas</strong> en ArangoDB.
      </>,
      <>
        El <strong>efecto dominó</strong> (consulta AQL de 1 a 3 saltos) muestra qué infraestructuras caen si no se actúa.
      </>,
      <>
        El <strong>penacho de humo</strong> se dibuja con el viento real: los nodos bajo el humo se marcan solos.
      </>,
    ],
    accion: "Pulsa una decisión en la cola para resaltar sus rutas de dominó; pasa el ratón por un nodo para ver sus conexiones.",
  },
  {
    id: "decision",
    icono: BookMarked,
    titulo: "La IA propone, tú decides",
    lema: "Derecha · Decisión",
    puntos: [
      <>
        Cada propuesta cita <strong>en qué se basa</strong> (evidencia con fuente y confianza), el protocolo aplicable y un
        plan de acciones con responsable y ETA.
      </>,
      <>
        <strong>Aprobar</strong> ejecuta acciones reales: llamadas, SMS, alertas de voz multilingües. <strong>Escalar</strong>{" "}
        si el riesgo supera tu límite.
      </>,
      <>
        <strong>Denegar con un motivo</strong> convierte tu criterio en una regla de doctrina que la IA respeta en todas las
        propuestas siguientes.
      </>,
    ],
    accion: "El riesgo (0–100) se compara con el umbral de autonomía: por debajo, la IA ejecuta sola; por encima, espera tu firma.",
  },
  {
    id: "supervision",
    icono: ShieldCheck,
    titulo: "Supervisión humana y trazabilidad",
    lema: "Cabecera y pestañas · Autonomía, doctrina, informes",
    puntos: [
      <>
        El <strong>umbral de autonomía</strong> lo fija la Dirección del Plan; cada rol firma hasta un riesgo máximo.
      </>,
      <>
        La pestaña <strong>Doctrina</strong> lista lo que la IA ha aprendido de vosotros; se puede desactivar o borrar.
      </>,
      <>
        <strong>Actas, SITREP y post-mortem</strong> se generan solos, con hora del servidor, listos para firmar e imprimir. En
        Supervisión de la IA puedes preguntarle por qué propuso algo.
      </>,
    ],
    accion: "Todo lo que ve el mando queda registrado: quién decidió, con qué datos y qué se ejecutó.",
  },
];

const suscribirNada = () => () => {};

/** Botón de ayuda que abre la guía de la plataforma. */
export function BotonGuia({ className = "" }: { className?: string }) {
  const [abierta, setAbierta] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Tooltip titulo="¿Cómo funciona Atalaya?" contenido="Guía de cuatro pasos: entrada de datos, grafo, decisión y supervisión." lado="abajo">
        <button
          ref={boton}
          type="button"
          onClick={() => setAbierta(true)}
          aria-label="Cómo funciona Atalaya"
          aria-haspopup="dialog"
          className={`boton boton-fantasma size-8 rounded-full p-0 ${className}`}
        >
          <CircleHelp className="size-4" aria-hidden />
        </button>
      </Tooltip>
      {abierta && (
        <Guia
          onCerrar={() => {
            setAbierta(false);
            boton.current?.focus();
          }}
        />
      )}
    </>
  );
}

function Guia({ onCerrar }: { onCerrar: () => void }) {
  const enCliente = useSyncExternalStore(suscribirNada, () => true, () => false);
  const [indice, setIndice] = useState(0);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const paso = PASOS[indice];
  const Icono = paso.icono;

  useEffect(() => {
    cerrarRef.current?.focus();
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
      else if (e.key === "ArrowRight") setIndice((i) => Math.min(PASOS.length - 1, i + 1));
      else if (e.key === "ArrowLeft") setIndice((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [onCerrar]);

  if (!enCliente) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="guia-titulo"
    >
      <div className="flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-panel-border bg-panel shadow-[var(--sombra-flotante)]">
        <div className="flex items-center justify-between gap-3 border-b border-panel-border px-5 py-3">
          <div className="min-w-0">
            <p className="etiqueta">Guía de la plataforma</p>
            <h2 id="guia-titulo" className="text-[15px] font-semibold text-foreground">
              Cómo se lee Atalaya en cuatro pasos
            </h2>
          </div>
          <button
            ref={cerrarRef}
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar guía (Esc)"
            className="boton boton-fantasma size-8 rounded-full p-0"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr]">
          <ol className="flex gap-1 overflow-x-auto border-b border-panel-border p-2 sm:flex-col sm:border-b-0 sm:border-r" aria-label="Pasos">
            {PASOS.map((p, i) => {
              const activo = i === indice;
              const IconoPaso = p.icono;
              return (
                <li key={p.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setIndice(i)}
                    aria-current={activo ? "step" : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-[13px] transition ${
                      activo ? "bg-brand/10 font-semibold text-brand" : "text-muted hover:bg-panel-2 hover:text-foreground"
                    }`}
                  >
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold ${
                        activo ? "bg-brand text-panel" : "bg-panel-2 text-muted"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <IconoPaso className="size-4 shrink-0" aria-hidden />
                    <span className="hidden truncate sm:inline">{p.titulo}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          <section className="flex min-h-[300px] flex-col p-5" aria-live="polite">
            <p className="etiqueta">{paso.lema}</p>
            <h3 className="mt-1 flex items-center gap-2 text-[17px] font-semibold text-foreground">
              <Icono className="size-5 text-brand" aria-hidden /> {paso.titulo}
            </h3>
            <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-muted">
              {paso.puntos.map((punto, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-brand/60" aria-hidden />
                  <span>{punto}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 rounded-[10px] border border-brand/25 bg-brand/6 px-3 py-2 text-[12px] leading-relaxed text-foreground">
              {paso.accion}
            </p>
            <div className="mt-auto flex items-center justify-between gap-2 pt-5">
              <span className="font-mono text-[11px] text-subtle">
                {indice + 1} / {PASOS.length}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIndice((i) => Math.max(0, i - 1))}
                  disabled={indice === 0}
                  className="boton boton-secundario boton-sm"
                >
                  <ChevronLeft className="size-3.5" aria-hidden /> Anterior
                </button>
                {indice < PASOS.length - 1 ? (
                  <button type="button" onClick={() => setIndice((i) => i + 1)} className="boton boton-primario boton-sm">
                    Siguiente <ChevronRight className="size-3.5" aria-hidden />
                  </button>
                ) : (
                  <button type="button" onClick={onCerrar} className="boton boton-primario boton-sm">
                    Empezar
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
