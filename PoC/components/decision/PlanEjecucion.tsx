import { Brain, Check, Cpu, FileCode, LoaderCircle, TriangleAlert, X } from "lucide-react";
import type { ImpactoDomino, PlanPropuesto, ProcesadoPor } from "@/lib/types";
import type { EstadoDecision, ResultadoAccion } from "@/lib/tipos-sistema";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { CANAL_UI, formatearHora, miles, PRIORIDAD_UI, riesgoColor } from "./ui";

/** Efecto dominó: infraestructura aguas abajo afectada (consulta de grafo 1..3 saltos). */
/** Cómo se presenta el proveedor de una acción ejecutada. Sin proveedores ficticios (poc-c8): o hay canal real, o se registra en el cuaderno, o queda pendiente de envío manual. */
function PROVEEDOR_UI(p: string): { texto: string; cls: string; ayuda: string } {
  switch (p) {
    case "Ninguno":
      return { texto: "Sin canal", cls: "pildora pildora-aviso", ayuda: "No hay canal configurado para esta acción: queda pendiente de envío manual." };
    case "Cuaderno":
      return { texto: "Cuaderno de mando", cls: "pildora", ayuda: "Orden interna registrada en el cuaderno de mando." };
    default:
      return { texto: p, cls: "pildora pildora-marca", ayuda: "Canal real de ejecución." };
  }
}

export function EfectoDomino({ domino }: { domino: ImpactoDomino[] }) {
  if (domino.length === 0) return null;
  return (
    <div>
      <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        <TriangleAlert className="size-4 text-brand" aria-hidden /> Efecto dominó
        <Ayuda
          titulo="Infraestructura aguas abajo"
          texto="Lo que se cae detrás de lo que ya está afectado, según el grafo de dependencias de la ciudad (hasta 3 saltos). El número es el riesgo que hereda cada nodo."
        />
      </h4>
      <ul className="space-y-1.5">
        {domino.map((d, i) => (
          <li key={`${d.infraestructura}-${i}`} className="rounded-[10px] border border-panel-border bg-panel-2 px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-medium text-foreground">{d.infraestructura}</span>
              <Tooltip
                titulo={`Riesgo heredado ${d.riesgo}/100`}
                contenido="Riesgo que llega a esta infraestructura por la cadena de dependencias; ≥ 50 pasa a ámbar y ≥ 75 a rojo."
              >
                <span className="flex shrink-0 items-center gap-2 font-mono text-xs text-foreground">
                  <span className="h-1.5 w-16 overflow-hidden rounded bg-panel-border">
                    <span className={`block h-full ${riesgoColor(d.riesgo)}`} style={{ width: `${d.riesgo}%` }} />
                  </span>
                  {d.riesgo}
                </span>
              </Tooltip>
            </div>
            <Tooltip
              className="mt-1 w-full"
              titulo="Cadena de dependencias"
              contenido={d.ruta.join(" → ")}
              lado="abajo"
            >
              <span className="block truncate text-left text-[11px] text-subtle">{d.ruta.join(" → ")}</span>
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface PropsPlan {
  plan: PlanPropuesto;
  estado: EstadoDecision;
  resultados?: ResultadoAccion[];
  /** Enrutador de IA: qué modelo generó el plan (tarea "plan") y cuánto tardó. */
  procesadoPor?: ProcesadoPor[];
}

/** Plan propuesto por la IA y, si ya se ejecutó, el resultado real de cada acción. */
export function PlanEjecucion({ plan, estado, resultados = [], procesadoPor }: PropsPlan) {
  const idsAcciones = new Set(plan.acciones.map((a) => a.id));
  const huerfanos = resultados.filter((r) => !idsAcciones.has(r.accionId));
  const ok = resultados.filter((r) => r.ok).length;
  const ejecutada = estado === "ejecutada" || estado === "auto";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <Brain className="size-4 text-brand" aria-hidden /> {ejecutada ? "Plan ejecutado" : "Plan propuesto"}
          <Ayuda
            titulo="Qué se va a hacer"
            texto="Acciones concretas que la IA propone, con recurso, prioridad y tiempo estimado. Al aprobar salen por sus canales reales y cada una deja su confirmación aquí."
          />
        </h4>
        <span className="flex items-center gap-2 text-[11px] text-muted">
          {resultados.length > 0 && (
            <Tooltip
              titulo="Acciones confirmadas / lanzadas"
              contenido="Cuántas de las acciones lanzadas devolvió su canal como entregadas. Si falta alguna, el detalle del fallo está bajo la acción."
            >
              <span className={`pildora ${ok === resultados.length ? "pildora-exito" : "pildora-aviso"} font-mono`}>
                {ok}/{resultados.length} OK
              </span>
            </Tooltip>
          )}
          <Tooltip contenido="Versión del plan: sube cada vez que una denegación obliga a la IA a recalcularlo.">
            <span className="font-mono text-subtle">v{plan.version}</span>
          </Tooltip>
        </span>
      </div>

      {plan.razonamiento && (
        <div className="mb-2 rounded-[10px] border border-brand/25 bg-brand/6 px-3 py-2">
          <p className="text-xs leading-relaxed text-foreground">{plan.razonamiento}</p>
          <ChipModelo procesadoPor={procesadoPor} />
        </div>
      )}
      {!plan.razonamiento && <ChipModelo procesadoPor={procesadoPor} />}

      {plan.restricciones.length > 0 && (
        <ul className="mb-2 space-y-1">
          {plan.restricciones.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-warning">
              <X className="mt-0.5 size-3 shrink-0" aria-hidden /> Restricción: {r}
            </li>
          ))}
        </ul>
      )}

      <ol className="space-y-1.5">
        {plan.acciones.map((a, i) => {
          const propios = resultados.filter((r) => r.accionId === a.id);
          return (
            <li key={a.id} className="flex gap-2.5 rounded-[10px] border border-panel-border bg-panel-2 px-3 py-2">
              <span className="font-mono text-xs text-subtle">{String(i + 1).padStart(2, "0")}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <Tooltip className="min-w-0" contenido={a.recurso} titulo="Recurso al que se ordena">
                    <span className="truncate text-sm font-medium text-foreground">{a.recurso}</span>
                  </Tooltip>
                  <span className="flex shrink-0 items-center gap-2 text-[11px]">
                    <Tooltip
                      titulo={`Prioridad ${a.prioridad}`}
                      contenido="Orden en que se lanzan las acciones del plan: las de prioridad alta salen primero y no esperan confirmación de las demás."
                    >
                      <span className={`font-semibold uppercase ${PRIORIDAD_UI[a.prioridad] ?? "text-muted"}`}>
                        {a.prioridad}
                      </span>
                    </Tooltip>
                    <Tooltip contenido="Tiempo estimado hasta que la acción surta efecto sobre el terreno, no hasta que se envíe.">
                      <span className="font-mono text-subtle">ETA {a.eta}</span>
                    </Tooltip>
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{a.accion}</p>

                {propios.map((r, j) => (
                  <FilaResultado key={`${r.ref}-${j}`} r={r} />
                ))}
                {propios.length === 0 && estado === "ejecutando" && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-brand">
                    <LoaderCircle className="size-3 animate-spin" aria-hidden /> Ejecutando…
                  </p>
                )}
                {propios.length === 0 && ejecutada && resultados.length > 0 && (
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] italic text-subtle">
                    Sin confirmación registrada
                    <Ayuda texto="La acción se lanzó pero su canal no devolvió acuse. No implica que no se haya hecho: confírmalo por radio." />
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {huerfanos.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 flex items-center gap-1 text-[11px] text-muted">
            Otras acciones ejecutadas
            <Ayuda texto="Confirmaciones que no corresponden a ninguna acción del plan actual: normalmente vienen de una versión anterior del plan, antes de recalcularlo." />
          </p>
          {huerfanos.map((r, j) => (
            <FilaResultado key={`${r.ref}-${j}`} r={r} conId />
          ))}
        </div>
      )}
    </div>
  );
}

/** Explicación del enrutador de IA, compartida por las dos variantes del chip. */
const ENRUTADOR = (
  <>
    Cada tarea va al modelo que le toca: <strong>Haiku</strong> para lo rápido y repetitivo, <strong>Claude</strong> con
    razonamiento para los planes que exigen criterio, y una <strong>plantilla determinista</strong> si no hay IA
    disponible, para que el centro de mando nunca se quede sin propuesta.
  </>
);

function ChipModelo({ procesadoPor }: { procesadoPor?: ProcesadoPor[] }) {
  const p = procesadoPor?.find((x) => x.tarea === "plan") ?? procesadoPor?.[procesadoPor.length - 1];
  if (!p) return null;
  if (p.modelo === "plantilla-determinista") {
    return (
      <p className="mt-1.5">
        <Tooltip titulo="Sin IA" contenido={ENRUTADOR}>
          <span className="pildora">
            <FileCode className="size-3" aria-hidden /> Plan por plantilla (sin IA)
          </span>
        </Tooltip>
      </p>
    );
  }
  return (
    <p className="mt-1.5">
      <Tooltip titulo="Enrutador de modelos" contenido={ENRUTADOR}>
        <span className="pildora pildora-marca">
          <Cpu className="size-3" aria-hidden />
          Plan generado por <span className="font-mono">{p.modelo}</span> ·{" "}
          <span className="font-mono">{miles(p.latenciaMs)} ms</span>
        </span>
      </Tooltip>
    </p>
  );
}

function FilaResultado({ r, conId = false }: { r: ResultadoAccion; conId?: boolean }) {
  const canal = CANAL_UI[r.canal] ?? CANAL_UI.interno;
  const IconoCanal = canal.icono;
  return (
    <div
      className={`mt-1.5 rounded-lg border px-2 py-1.5 text-[11px] ${
        r.ok ? "border-success/30 bg-success/8" : "border-danger/30 bg-danger/8"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {r.ok ? (
          <Check className="size-3.5 shrink-0 text-success" aria-label="Acción confirmada" />
        ) : (
          <X className="size-3.5 shrink-0 text-danger" aria-label="Acción fallida" />
        )}
        <span className="flex items-center gap-1 text-foreground">
          <IconoCanal className="size-3" aria-hidden /> {canal.etiqueta}
        </span>
        <Tooltip titulo={PROVEEDOR_UI(r.proveedor).texto} contenido={PROVEEDOR_UI(r.proveedor).ayuda}>
          <span className={PROVEEDOR_UI(r.proveedor).cls}>{PROVEEDOR_UI(r.proveedor).texto}</span>
        </Tooltip>
        <Tooltip className="min-w-0" titulo="Referencia del envío" contenido={r.ref}>
          <span className="min-w-0 truncate font-mono text-subtle">
            {conId ? `${r.accionId} · ` : ""}
            {r.ref}
          </span>
        </Tooltip>
        <span className="ml-auto font-mono text-[11px] text-subtle">{formatearHora(r.timestamp)}</span>
      </div>
      {r.detalle && <p className={`mt-0.5 leading-snug ${r.ok ? "text-muted" : "text-danger"}`}>{r.detalle}</p>}
    </div>
  );
}
