import { Tooltip } from "@/components/ui/Tooltip";
import { formatearDuracion, msHasta, riesgoColor } from "./ui";

/** Cuenta atrás hasta el plazo: ámbar < 3 min, rojo parpadeante < 60 s, "VENCIDA" si ya pasó. */
/**
 * Cuenta atrás al plazo: ámbar por debajo de 3 min y rojo parpadeante por debajo de 1 min.
 * `sinTooltip` para usarla dentro de un chip o botón que ya tiene su propio tooltip.
 */
export function Countdown({
  plazo,
  ahora,
  className = "",
  sinTooltip = false,
}: {
  plazo: string;
  ahora: number;
  className?: string;
  sinTooltip?: boolean;
}) {
  const restante = msHasta(plazo, ahora);
  if (!Number.isFinite(restante)) return <span className={`font-mono text-muted ${className}`}>—</span>;
  if (restante <= 0) {
    if (sinTooltip) return <span className={`font-mono font-bold tracking-wide text-danger ${className}`}>VENCIDA</span>;
    return (
      <Tooltip
        titulo="Plazo vencido"
        contenido="La ventana en la que esta decisión todavía cambia algo ha pasado. Revisa la evidencia antes de firmar."
      >
        <span className={`font-mono font-bold tracking-wide text-danger ${className}`}>VENCIDA</span>
      </Tooltip>
    );
  }
  const color =
    restante < 60_000
      ? "animate-pulse font-bold text-danger"
      : restante < 180_000
        ? "font-semibold text-warning"
        : "text-foreground";
  if (sinTooltip) return <span className={`font-mono tabular-nums ${color} ${className}`}>{formatearDuracion(restante)}</span>;
  return (
    <Tooltip
      titulo="Tiempo restante para decidir"
      contenido="Cuenta atrás hasta el plazo que fijó la propuesta. Pasa a ámbar por debajo de 3 min y a rojo por debajo de 1 min."
    >
      <span className={`font-mono tabular-nums ${color} ${className}`}>{formatearDuracion(restante)}</span>
    </Tooltip>
  );
}

/**
 * Barra de riesgo 0..100 con una marca vertical en el umbral de autonomía:
 * a la izquierda de la marca la IA podría ejecutar sola; a la derecha necesita firma humana.
 */
export function BarraRiesgo({
  riesgo,
  umbral,
  className = "w-16",
  alto = "h-1.5",
}: {
  riesgo: number;
  umbral?: number;
  className?: string;
  alto?: string;
}) {
  const r = Math.max(0, Math.min(100, riesgo));
  const bajoUmbral = umbral !== undefined && r <= umbral;
  return (
    <Tooltip
      className={`shrink-0 ${className}`}
      titulo={`Riesgo ${riesgo} de 100`}
      contenido={
        umbral !== undefined ? (
          <>
            La marca vertical es el <strong>umbral de autonomía ({umbral})</strong>:{" "}
            {bajoUmbral
              ? "esta decisión queda por debajo, así que la IA podría ejecutarla sola."
              : "esta decisión lo supera, así que requiere firma humana."}
          </>
        ) : (
          "Daño potencial estimado por la IA: a más riesgo, firma de un rol más alto."
        )
      }
    >
      <span className={`relative block w-full ${alto}`}>
        <span className="absolute inset-0 overflow-hidden rounded-sm bg-panel-border">
          <span className={`block h-full ${bajoUmbral ? "bg-success" : riesgoColor(r)}`} style={{ width: `${r}%` }} />
        </span>
        {umbral !== undefined && (
          <span
            className="absolute -top-0.5 -bottom-0.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70"
            style={{ left: `${Math.max(0, Math.min(100, umbral))}%` }}
          />
        )}
      </span>
    </Tooltip>
  );
}
