import type { EstadoSistema } from "@/lib/tipos-sistema";
import { esAprobada } from "./ui";

/** "IA · propuestas N · aprobadas X% · denegadas Y · autónomas Z · reglas aprendidas W". */
export function ResumenIA({ estado }: { estado: EstadoSistema | null }) {
  const ds = estado?.decisiones ?? [];
  const aprobadas = ds.filter(esAprobada).length;
  const denegadas = ds.filter((d) => d.estado === "denegada").length;
  const autonomas = ds.filter((d) => d.estado === "auto").length;
  const pendientes = ds.filter((d) => d.estado === "pendiente").length;
  const firmadas = aprobadas + denegadas;
  const pct = firmadas ? Math.round((aprobadas / firmadas) * 100) : null;
  const reglas = estado?.doctrina.length ?? 0;
  const latencias = ds.flatMap((d) => d.procesadoPor ?? []).map((p) => p.latenciaMs);
  const latMedia = latencias.length ? Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length) : null;

  const kpis: { k: string; v: string; sub?: string; color?: string }[] = [
    { k: "Propuestas", v: String(ds.length), sub: pendientes ? `${pendientes} pendientes` : "ninguna pendiente" },
    { k: "Aprobadas", v: pct === null ? "—" : `${pct}%`, sub: `${aprobadas} de ${firmadas} firmadas`, color: "text-success" },
    { k: "Denegadas", v: String(denegadas), sub: "con feedback humano", color: denegadas ? "text-danger" : undefined },
    { k: "Autónomas", v: String(autonomas), sub: `umbral ${estado?.umbralAutonomia ?? "—"}/100`, color: "text-accent" },
    { k: "Reglas aprendidas", v: String(reglas), sub: `${estado?.doctrina.filter((r) => r.activa).length ?? 0} activas` },
    { k: "Latencia media", v: latMedia === null ? "—" : `${latMedia} ms`, sub: estado?.iaDisponible ? "modelo disponible" : "sin modelo · plantillas" },
  ];

  return (
    <div className="superficie grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-panel-border bg-panel-border sm:grid-cols-3 lg:grid-cols-[auto_repeat(6,minmax(0,1fr))]">
      <div className="col-span-2 flex items-center gap-2 bg-panel px-4 py-2.5 sm:col-span-3 lg:col-span-1">
        <span className="rounded-md bg-accent/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-accent">IA</span>
        <span className="etiqueta">Actividad del agente</span>
      </div>
      {kpis.map((x) => (
        <div key={x.k} className="min-w-0 bg-panel px-4 py-2.5">
          <p className="truncate text-[10.5px] text-muted">{x.k}</p>
          <p className={`font-mono text-[18px] font-semibold leading-tight ${x.color ?? "text-foreground"}`}>{x.v}</p>
          {x.sub && <p className="truncate text-[10.5px] text-subtle">{x.sub}</p>}
        </div>
      ))}
    </div>
  );
}
