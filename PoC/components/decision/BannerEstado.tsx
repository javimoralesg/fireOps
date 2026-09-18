import { Ban, Bot, CircleCheck, CircleX, LoaderCircle, ScrollText, TimerOff } from "lucide-react";
import type { Decision, ReglaDoctrina } from "@/lib/tipos-sistema";
import { etiquetaRol } from "@/lib/permisos";
import { Ayuda } from "@/components/ui/Tooltip";
import { formatearHora, msHasta } from "./ui";

interface Props {
  decision: Decision;
  doctrina: ReglaDoctrina[];
  ahora: number;
  umbralAutonomia?: number;
}

/** Banner superior del detalle: resume en una línea qué ha pasado con la decisión y quién la firmó. */
export function BannerEstado({ decision: d, doctrina, ahora, umbralAutonomia }: Props) {
  const firma = d.decididaPor
    ? `${etiquetaRol(d.decididaPor.rol)} · ${d.decididaPor.via === "voz" ? "orden por voz" : "panel"} · ${formatearHora(d.decididaPor.timestamp)}`
    : null;
  const resultados = d.resultadoEjecucion ?? [];
  const ok = resultados.filter((r) => r.ok).length;
  const fallidas = resultados.length - ok;

  switch (d.estado) {
    case "pendiente":
      if (msHasta(d.plazo, ahora) > 0) return null;
      return (
        <Banner
          tono="warning"
          icono={<TimerOff className="size-4" />}
          titulo="Plazo vencido"
          ayuda="Se puede seguir firmando o denegando, pero los datos que sostienen la propuesta son de antes del plazo."
        >
          La ventana para decidir ha pasado. La propuesta puede haber perdido sentido: revisa la evidencia antes de firmar.
        </Banner>
      );

    case "ejecutando":
      return (
        <Banner
          tono="accent"
          icono={<LoaderCircle className="size-4 animate-spin" />}
          titulo="Ejecutando acciones…"
          ayuda="Las acciones del plan salen por sus canales reales (voz, SMS, ticket). Cada confirmación aparece bajo su acción en el plan."
        >
          Lanzando llamadas, SMS y alertas de voz. {firma && <>Aprobada por {firma}.</>}
        </Banner>
      );

    case "ejecutada":
      return (
        <Banner
          tono="success"
          icono={<CircleCheck className="size-4" />}
          titulo="Aprobada y ejecutada"
          ayuda="Decisión firmada por una persona y lanzada. Las acciones confirmadas son las que el canal devolvió como entregadas."
        >
          {firma ? <>Firmada por {firma}.</> : "Ejecutada."}
          {resultados.length > 0 && (
            <span className="mt-1 block">
              <span className="font-mono text-success">{ok}</span> acciones confirmadas
              {fallidas > 0 && (
                <>
                  {" "}· <span className="font-mono text-danger">{fallidas}</span> con incidencia
                </>
              )}
            </span>
          )}
        </Banner>
      );

    case "auto":
      return (
        <Banner
          tono="success"
          icono={<Bot className="size-4" />}
          titulo="Ejecutada automáticamente"
          ayuda="Por debajo del umbral de autonomía la IA ejecuta sin esperar firma, y queda registrada igual en el acta y en la auditoría. El umbral lo fija el mando."
        >
          Riesgo <span className="font-mono text-foreground">{d.riesgo}</span> ≤ umbral de autonomía
          {umbralAutonomia !== undefined && (
            <>
              {" "}
              <span className="font-mono text-foreground">{umbralAutonomia}</span>
            </>
          )}
          : la IA la ejecutó sin firma humana
          {d.decididaPor ? <> a las {formatearHora(d.decididaPor.timestamp)}</> : null}.
          {resultados.length > 0 && (
            <span className="mt-1 block">
              <span className="font-mono text-success">{ok}</span> de {resultados.length} acciones confirmadas
            </span>
          )}
        </Banner>
      );

    case "denegada": {
      const regla = doctrina.find((r) => r.origen.decisionId === d.id);
      return (
        <Banner
          tono="danger"
          icono={<CircleX className="size-4" />}
          titulo="Denegada"
          ayuda="El motivo que se escribió al denegar realimenta a la IA: si el ámbito fue permanente, se guarda como regla de doctrina para las próximas decisiones."
        >
          {firma ? <>Por {firma}.</> : null}
          {d.feedback && (
            <span className="mt-1.5 block border-l-2 border-danger/40 pl-2 italic text-foreground">
              &ldquo;{d.feedback}&rdquo;
            </span>
          )}
          {regla && (
            <span className="mt-1.5 flex items-start gap-1.5 text-muted">
              <ScrollText className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
              <span>
                {regla.ambito === "global" ? "Convertida en regla de doctrina" : "Restricción para este incidente"}:{" "}
                <span className="text-foreground">{regla.reglaNormalizada}</span>
              </span>
            </span>
          )}
        </Banner>
      );
    }

    case "invalidada":
      return (
        <Banner
          tono="warning"
          icono={<Ban className="size-4" />}
          titulo="Propuesta invalidada"
          ayuda="Llegó un dato nuevo que contradice la base de la propuesta, así que la IA la retiró y está recalculando otra en su lugar."
        >
          {d.motivoInvalidacion ?? "El escenario cambió y esta propuesta ya no es válida."}
        </Banner>
      );

    default:
      return null;
  }
}

// Tintes suaves (docs/identidad.md): fondo al 8 %, borde al 30 %, texto del color.
const TONO = {
  success: "border-success/30 bg-success/8 text-success",
  danger: "border-danger/30 bg-danger/8 text-danger",
  warning: "border-warning/30 bg-warning/8 text-warning",
  accent: "border-brand/30 bg-brand/8 text-brand",
} as const;

function Banner({
  tono,
  icono,
  titulo,
  ayuda,
  children,
}: {
  tono: keyof typeof TONO;
  icono: React.ReactNode;
  titulo: string;
  /** Explicación del (i): qué significa este estado y qué se puede hacer todavía. */
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-[10px] border px-3 py-2.5 ${TONO[tono]}`} role="status">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold">
        <span aria-hidden className="flex shrink-0 items-center">
          {icono}
        </span>
        {titulo}
        {ayuda && <Ayuda texto={ayuda} titulo={titulo} />}
      </p>
      <div className="mt-1 text-xs leading-relaxed text-muted">{children}</div>
    </div>
  );
}
