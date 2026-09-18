import { ScrollText } from "lucide-react";
import type { ReglaDoctrina } from "@/lib/tipos-sistema";
import { etiquetaRol } from "@/lib/permisos";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";

/** Reglas de doctrina (feedback humano previo) que la IA respetó al proponer esta decisión. */
export function DoctrinaAplicada({ reglasAplicadas, doctrina }: { reglasAplicadas: string[]; doctrina: ReglaDoctrina[] }) {
  if (reglasAplicadas.length === 0) return null;
  const porId = new Map(doctrina.map((r) => [r.id, r]));

  return (
    <div>
      <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        <ScrollText className="size-4 text-brand" aria-hidden /> Doctrina aplicada
        <Ayuda
          titulo="Lo que ya has enseñado a la IA"
          texto="Reglas nacidas de denegaciones anteriores. La IA las respetó al construir esta propuesta, así que no tienes que volver a corregir lo mismo."
        />
      </h4>
      <ul className="flex flex-col gap-1.5">
        {reglasAplicadas.map((id) => {
          const r = porId.get(id);
          if (!r) {
            return (
              <li
                key={id}
                className="rounded-[10px] border border-panel-border bg-panel-2 px-2.5 py-1.5 text-[11px] text-muted"
              >
                Regla <span className="font-mono">{id}</span> (ya no está en la doctrina)
              </li>
            );
          }
          return (
            <li key={id} className="rounded-[10px] border border-brand/25 bg-brand/6 px-2.5 py-2">
              <Tooltip
                className="w-full"
                titulo="De dónde sale esta regla"
                contenido={`"${r.texto}" — ${etiquetaRol(r.origen.rol)}`}
              >
                <span className="block text-left text-xs leading-snug text-foreground">{r.reglaNormalizada}</span>
              </Tooltip>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                <Tooltip
                  contenido={
                    r.ambito === "global"
                      ? "Regla permanente: se aplica a este incidente y a todos los que vengan."
                      : "Restricción acotada: solo vale mientras dure este incidente."
                  }
                >
                  <span className={r.ambito === "global" ? "pildora pildora-marca" : "pildora"}>
                    {r.ambito === "global" ? "permanente" : "este incidente"}
                  </span>
                </Tooltip>
                <span>
                  aplicada <span className="font-mono text-foreground">{r.vecesAplicada}</span>{" "}
                  {r.vecesAplicada === 1 ? "vez" : "veces"}
                </span>
                <span>· de {etiquetaRol(r.origen.rol)}</span>
                {!r.activa && <span className="text-warning">· desactivada</span>}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
