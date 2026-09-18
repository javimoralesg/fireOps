"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  Camera,
  CarFront,
  Cctv,
  ChevronDown,
  ChevronRight,
  CloudLightning,
  Copy,
  Cpu,
  Globe,
  LoaderCircle,
  MapPin,
  PhoneCall,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Wind,
  Zap,
  Landmark,
} from "lucide-react";
import type { EventoIngesta, FuenteIngesta, ProcesadoPor, Verificacion } from "@/lib/types";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";

type Icono = typeof Globe;

// Color por fuente con tokens de la identidad v2 (docs/identidad.md): siempre
// tinte (texto + fondo al 10 %), nunca relleno saturado, y siempre con icono
// al lado para que el color no sea el único canal.
export const FUENTE_UI: Record<FuenteIngesta, { icon: Icono; color: string; label: string }> = {
  Exa: { icon: Globe, color: "text-brand bg-brand/10", label: "Exa · RRSS" },
  FalAI: { icon: Camera, color: "text-warning bg-warning/10", label: "FalAI · Visión" },
  Ciudadano: { icon: Smartphone, color: "text-success bg-success/10", label: "Reporte ciudadano" },
  HappyRobot: { icon: PhoneCall, color: "text-info bg-info/10", label: "HappyRobot · Voz" },
  MadridTrafico: { icon: CarFront, color: "text-warning bg-warning/10", label: "Madrid · Tráfico" },
  OpenMeteo: { icon: Wind, color: "text-info bg-info/10", label: "Open-Meteo" },
  REE: { icon: Zap, color: "text-warning bg-warning/10", label: "REE · Red eléctrica" },
  IGN: { icon: Activity, color: "text-muted bg-muted/10", label: "IGN · Sísmica" },
  AEMET: { icon: CloudLightning, color: "text-info bg-info/10", label: "AEMET · Avisos" },
  Periferico: { icon: Smartphone, color: "text-brand bg-brand/10", label: "Periférico" },
  CamaraTrafico: { icon: Cctv, color: "text-warning bg-warning/10", label: "Cámara de tráfico" },
  Organismo: { icon: Landmark, color: "text-success bg-success/10", label: "Aviso oficial" },
};

const VERIFICACION_UI: Record<
  Verificacion["estado"],
  { icon: Icono; cls: string; label: string; ayuda: string; spin?: boolean }
> = {
  verificado: {
    icon: ShieldCheck,
    cls: "pildora-exito",
    label: "Verificado",
    ayuda: "El verificador ha contrastado el reporte con otras fuentes: llega al mando.",
  },
  duplicado: {
    icon: Copy,
    cls: "",
    label: "Duplicado",
    ayuda: "Repite un reporte ya recibido: se agrupa bajo el evento original para no contarlo dos veces.",
  },
  sospechoso: {
    icon: ShieldAlert,
    cls: "pildora-peligro",
    label: "Sospechoso",
    ayuda: "Posible bulo: el verificador lo frena y no llega a la cola de decisiones.",
  },
  pendiente: {
    icon: LoaderCircle,
    cls: "pildora-aviso",
    label: "Verificando",
    ayuda: "El verificador todavía está contrastando el reporte con el resto de fuentes.",
    spin: true,
  },
};

const TAREA_LABEL: Record<ProcesadoPor["tarea"], string> = {
  clasificacion: "clasificación",
  extraccion_entidades: "entidades",
  vision: "visión",
  verificacion: "verificación",
  plan: "plan",
};

const NAIVE_ISO = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;
const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Hora tolerante a los formatos de las fuentes:
 * - ISO con zona (Z / ±hh:mm): se muestra en hora de Madrid (misma salida en servidor y navegador).
 * - ISO sin zona ("2026-09-18T20:00", Open-Meteo con timezone=Europe/Madrid) o
 *   "18/09/2026 20:50:04" (Informo): ya es hora local de Madrid, se muestra tal cual.
 * - Cualquier otra cosa que no se pueda interpretar: el texto original.
 */
export function formatearHora(ts: string | undefined | null, segundos = true): string {
  if (!ts) return "—";
  const s = ts.trim();
  const naive = NAIVE_ISO.exec(s);
  if (naive) return `${naive[1]}:${naive[2]}${segundos ? `:${naive[3] ?? "00"}` : ""}`;
  const dmy = DMY.exec(s);
  if (dmy) return `${dmy[4].padStart(2, "0")}:${dmy[5]}${segundos ? `:${dmy[6] ?? "00"}` : ""}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    ...(segundos ? { second: "2-digit" as const } : {}),
    timeZone: "Europe/Madrid",
  });
}

const hora = (ts: string) => formatearHora(ts);

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Milisegundos para ordenar; tolera "dd/mm/yyyy hh:mm:ss". Lo no interpretable va al final. */
function ms(ts: string) {
  const t = Date.parse(ts);
  if (!Number.isNaN(t)) return t;
  const m = DMY.exec(ts.trim());
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] ?? 0)).getTime();
  return 0;
}

const FUENTE_DESCONOCIDA = { icon: Radio, color: "text-muted bg-panel-2" };

function fuenteUI(fuente: string) {
  return FUENTE_UI[fuente as FuenteIngesta] ?? { ...FUENTE_DESCONOCIDA, label: fuente };
}

/** Sigue la cadena duplicaDe hasta el evento original presente en la lista (o null si no está). */
function raizDuplicado(ev: EventoIngesta, porId: Map<string, EventoIngesta>): string | null {
  const vistos = new Set<string>([ev.id]);
  let actual = ev;
  while (actual.verificacion?.estado === "duplicado" && actual.verificacion.duplicaDe) {
    const siguiente = porId.get(actual.verificacion.duplicaDe);
    if (!siguiente || vistos.has(siguiente.id)) return null;
    vistos.add(siguiente.id);
    actual = siguiente;
  }
  return actual.id === ev.id ? null : actual.id;
}

export function FeedIngesta({ eventos }: { eventos: EventoIngesta[] }) {
  const { visibles, duplicados, verificados, filtrados, nDuplicados, nSospechosos } = useMemo(() => {
    const ordenados = [...eventos].sort((a, b) => ms(b.timestamp) - ms(a.timestamp));
    const porId = new Map(eventos.map((e) => [e.id, e]));
    const duplicados = new Map<string, EventoIngesta[]>();
    const visibles: EventoIngesta[] = [];
    for (const ev of ordenados) {
      const raiz = ev.verificacion?.estado === "duplicado" ? raizDuplicado(ev, porId) : null;
      if (raiz) {
        const grupo = duplicados.get(raiz) ?? [];
        grupo.push(ev);
        duplicados.set(raiz, grupo);
      } else {
        visibles.push(ev);
      }
    }
    const nDuplicados = eventos.filter((e) => e.verificacion?.estado === "duplicado").length;
    const nSospechosos = eventos.filter((e) => e.verificacion?.estado === "sospechoso").length;
    return {
      visibles,
      duplicados,
      verificados: eventos.filter((e) => e.verificacion?.estado === "verificado").length,
      filtrados: nDuplicados + nSospechosos,
      nDuplicados,
      nSospechosos,
    };
  }, [eventos]);

  return (
    <section className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-panel-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <Radio className="size-4 text-brand" /> Feed de ingesta
          <Ayuda
            titulo="Feed de ingesta"
            texto="Todo lo que entra: sensores, llamadas, redes y visión. El verificador agrupa duplicados y frena posibles bulos antes de que lleguen al mando."
          />
        </h2>
        <span className="flex flex-wrap gap-x-1 font-mono text-[11px] text-muted">
          <span className="whitespace-nowrap">{plural(eventos.length, "evento", "eventos")} ·</span>
          <Tooltip
            titulo="Verificados"
            contenido="Reportes contrastados con otras fuentes: son los que llegan a la cola de decisiones."
          >
            <span className="whitespace-nowrap">
              <span className="text-success">{verificados}</span> {verificados === 1 ? "verificado" : "verificados"} ·
            </span>
          </Tooltip>
          <Tooltip
            titulo="Filtrados por el verificador"
            contenido={`${plural(nDuplicados, "duplicado unificado", "duplicados unificados")} · ${plural(nSospechosos, "posible desinformación", "posibles desinformaciones")}. No llegan al mando.`}
          >
            <span className="whitespace-nowrap">
              <span className={filtrados > 0 ? "text-danger" : undefined}>{filtrados}</span>{" "}
              {filtrados === 1 ? "filtrado" : "filtrados"}
            </span>
          </Tooltip>
        </span>
      </div>

      {visibles.length === 0 ? (
        <p className="flex flex-1 items-center justify-center p-6 text-xs text-muted">Sin eventos todavía.</p>
      ) : (
        <ul className="scroll-thin flex-1 space-y-2 overflow-y-auto p-3">
          {visibles.map((ev) => (
            <TarjetaEvento key={ev.id} ev={ev} duplicados={duplicados.get(ev.id) ?? []} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TarjetaEvento({ ev, duplicados }: { ev: EventoIngesta; duplicados: EventoIngesta[] }) {
  const [plegado, setPlegado] = useState(false);
  const [verDuplicados, setVerDuplicados] = useState(false);
  const sospechoso = ev.verificacion?.estado === "sospechoso";
  const ui = fuenteUI(ev.fuente);
  const Icon = ui.icon;

  if (sospechoso && plegado) {
    return (
      <li className="rounded-[10px] border border-danger/30 bg-danger/5">
        <Tooltip
          titulo="Evento frenado por el verificador"
          contenido={ev.verificacion?.motivo ?? "Posible desinformación: no llega a la cola de decisiones."}
          className="w-full"
        >
          <button
            type="button"
            onClick={() => setPlegado(false)}
            aria-expanded={false}
            className="flex w-full items-center gap-2 px-3 py-2 text-left"
          >
            <ChevronRight className="size-3.5 shrink-0 text-danger" />
            <ShieldAlert className="size-3.5 shrink-0 text-danger" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
              <span className="font-medium text-danger">Posible desinformación</span> · {ev.titulo}
            </span>
            <span className="font-mono text-[11px] text-muted">{hora(ev.timestamp)}</span>
          </button>
        </Tooltip>
      </li>
    );
  }

  return (
    <li
      className={`@container rounded-[10px] border p-3 ${
        sospechoso ? "border-danger/30 bg-danger/5" : "border-panel-border bg-panel-2"
      }`}
    >
      {sospechoso && (
        <Tooltip
          titulo="Plegar evento filtrado"
          contenido="Lo deja como una línea para que no reste atención a los eventos verificados."
          className="w-full"
        >
          <button
            type="button"
            onClick={() => setPlegado(true)}
            aria-expanded
            className="-mt-0.5 mb-2 flex w-full items-center gap-1.5 text-left text-[11px] font-semibold text-danger"
          >
            <ChevronDown className="size-3.5 shrink-0" />
            Posible desinformación · no llega al mando
          </button>
        </Tooltip>
      )}

      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Tooltip titulo="Fuente del reporte" contenido={`${ui.label} · dato recibido a las ${hora(ev.timestamp)}`} className="min-w-0">
          <span
            className={`flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-[11px] font-medium ${ui.color} ${
              sospechoso ? "opacity-60" : ""
            }`}
          >
            <Icon className="size-3 shrink-0" /> <span className="truncate">{ui.label}</span>
          </span>
        </Tooltip>
        <span className="flex shrink-0 items-center gap-1.5">
          {ev.verificacion && <BadgeVerificacion verificacion={ev.verificacion} />}
          <Tooltip titulo="Hora del reporte" contenido="Hora local de Madrid en la que la fuente registró el dato.">
            <span className="font-mono text-[11px] text-muted">{hora(ev.timestamp)}</span>
          </Tooltip>
        </span>
      </div>

      {sospechoso && ev.verificacion?.motivo && (
        <p className="mb-2 flex items-start gap-1.5 rounded-[10px] border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] leading-snug text-danger">
          <ShieldAlert className="mt-px size-3 shrink-0" aria-hidden />
          <span className="min-w-0">{ev.verificacion.motivo}</span>
        </p>
      )}

      <div className={sospechoso ? "opacity-55" : undefined}>
        <div className="flex gap-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-snug">{ev.titulo}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{ev.detalle}</p>
          </div>
          {ev.imagenUrl && <Miniatura url={ev.imagenUrl} alt={ev.titulo} apagada={sospechoso} />}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted">
          <span className="flex min-w-0 items-center gap-1">
            {ev.ubicacion && (
              <>
                <MapPin className="size-3 shrink-0" />
                <span className="truncate">{ev.ubicacion}</span>
              </>
            )}
          </span>
          <Tooltip
            titulo="Confianza"
            contenido={`Confianza del evento según el verificador: ${Math.round(ev.confianza * 100)} %.`}
            lado="izquierda"
          >
            <span className="flex shrink-0 items-center gap-1.5 font-mono">
              <span className="h-1 w-14 overflow-hidden rounded-full bg-panel-border">
                <span
                  className={`block h-full ${sospechoso ? "bg-danger" : "bg-brand"}`}
                  style={{ width: `${Math.round(Math.min(1, Math.max(0, ev.confianza)) * 100)}%` }}
                />
              </span>
              {Math.round(ev.confianza * 100)}%
            </span>
          </Tooltip>
        </div>

        {ev.procesadoPor && ev.procesadoPor.length > 0 && (
          <div className="mt-2 flex items-start gap-1">
            <Cpu className="mt-0.5 size-3 shrink-0 text-subtle" aria-label="Enrutador de IA" />
            <div className="flex min-w-0 flex-wrap gap-1">
              {ev.procesadoPor.map((p, i) => (
                <ChipModelo key={`${p.modelo}-${p.tarea}-${i}`} p={p} />
              ))}
            </div>
          </div>
        )}
      </div>

      {duplicados.length > 0 && (
        <div className="mt-2">
          <Tooltip
            titulo="Reportes duplicados"
            contenido="Reportes distintos del mismo suceso: el verificador los agrupa bajo el original para que el mando cuente un solo evento."
            className="w-full"
          >
            <button
              type="button"
              onClick={() => setVerDuplicados((v) => !v)}
              aria-expanded={verDuplicados}
              className="chip w-full border-dashed px-2 py-1 text-left"
            >
              {verDuplicados ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              <Copy className="size-3" />
              <span className="flex-1 font-normal">
                +<span className="font-mono">{duplicados.length}</span>{" "}
                {duplicados.length === 1 ? "reporte duplicado" : "reportes duplicados"}
                <span className="hidden text-subtle @[270px]:inline"> · unificado</span>
              </span>
              <span className="font-mono">{hora(duplicados[0].timestamp)}</span>
            </button>
          </Tooltip>
          {verDuplicados && (
            <ul className="mt-1.5 space-y-1.5 border-l border-panel-border pl-2.5">
              {duplicados.map((d) => (
                <FilaDuplicado key={d.id} ev={d} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function BadgeVerificacion({ verificacion }: { verificacion: Verificacion }) {
  const v = VERIFICACION_UI[verificacion.estado];
  const Icon = v.icon;
  return (
    <Tooltip titulo={v.label} contenido={verificacion.motivo ?? v.ayuda} lado="izquierda">
      <span className={`pildora ${v.cls}`}>
        <Icon className={`size-3 shrink-0 ${v.spin ? "animate-spin" : ""}`} />
        <span className="hidden @[270px]:inline">{v.label}</span>
      </span>
    </Tooltip>
  );
}

export function ChipModelo({ p }: { p: ProcesadoPor }) {
  const nombre = p.modelo
    .replace(/^claude-/, "")
    .replace(/^[\w.-]+\//, "");
  const tarea = TAREA_LABEL[p.tarea] ?? p.tarea;
  const nivel = /haiku/i.test(p.modelo)
    ? { punto: "bg-success", texto: "modelo rápido" }
    : /sonnet|opus/i.test(p.modelo)
      ? { punto: "bg-brand", texto: "modelo de razonamiento" }
      : /ollama|gemma|llama|qwen|mistral/i.test(p.modelo)
        ? { punto: "bg-info", texto: "modelo local" }
        : { punto: "bg-muted", texto: "herramienta" };
  return (
    <Tooltip
      titulo="Enrutador de IA"
      contenido={
        <>
          Haiku (modelo rápido) para clasificar y extraer, Claude (razonamiento) para planificar. Aquí:{" "}
          <strong>{p.modelo}</strong> ({nivel.texto}) en <strong>{p.latenciaMs} ms</strong> para {tarea}
.
        </>
      }
      className="max-w-full"
    >
      <span className="inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-lg border border-panel-border bg-panel px-1.5 py-px font-mono text-[10px] text-muted">
        <span className={`size-1.5 shrink-0 rounded-full ${nivel.punto}`} />
        <span className="truncate">
          {nombre}
          {" · "}
          {p.latenciaMs} ms · {tarea}
        </span>
      </span>
    </Tooltip>
  );
}

function Miniatura({ url, alt, apagada }: { url: string; alt: string; apagada: boolean }) {
  const [error, setError] = useState(false);
  if (error) return null;
  return (
    <Tooltip titulo="Imagen del reporte" contenido="Se abre el original en otra pestaña." lado="izquierda" className="shrink-0">
      <a href={url} target="_blank" rel="noreferrer" className="shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura remota (R2), sin optimizar */}
        <img
          src={url}
          alt={alt}
          loading="lazy"
          onError={() => setError(true)}
          className={`h-14 w-20 rounded-lg border border-panel-border object-cover ${apagada ? "grayscale" : ""}`}
        />
      </a>
    </Tooltip>
  );
}

function FilaDuplicado({ ev }: { ev: EventoIngesta }) {
  const ui = fuenteUI(ev.fuente);
  const Icon = ui.icon;
  return (
    <li className="text-[11px]">
      <div className="flex items-center justify-between gap-2 text-muted">
        <span className="flex min-w-0 items-center gap-1">
          <Icon className="size-3 shrink-0" />
          <span className="truncate">
            {ui.label}
            {ev.ubicacion ? ` · ${ev.ubicacion}` : ""}
          </span>
        </span>
        <span className="shrink-0 font-mono">{hora(ev.timestamp)}</span>
      </div>
      <p className="mt-0.5 leading-snug text-foreground">{ev.detalle}</p>
      {ev.verificacion?.motivo && <p className="mt-0.5 italic leading-snug text-muted">{ev.verificacion.motivo}</p>}
    </li>
  );
}
