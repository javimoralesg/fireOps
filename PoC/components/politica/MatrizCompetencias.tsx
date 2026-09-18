"use client";

import { ListOrdered, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Ayuda } from "@/components/ui/Tooltip";
import { estaAjustada, type AjusteCategoria, type CategoriaAccion, type CategoriaId, type PoliticaAutonomia } from "@/lib/politica-autonomia";
import { FilaCategoria } from "./FilaCategoria";
import { MODO_UI } from "./ui";

interface Props {
  catalogo: CategoriaAccion[];
  politica: PoliticaAutonomia;
  umbral: number;
  editable: boolean;
  guardando: boolean;
  error: string | null;
  onAjustar: (id: CategoriaId, ajuste: AjusteCategoria) => Promise<void>;
  onRestablecer: () => Promise<void>;
}

/**
 * Ranking de actuaciones por riesgo mínimo con la línea del umbral de autonomía:
 * por encima de la línea (menos riesgo) la IA puede actuar sola si la actuación es
 * autónoma; por debajo, siempre firma una persona. Editable con `fijar_umbral`.
 */
export function MatrizCompetencias({ catalogo, politica, umbral, editable, guardando, error, onAjustar, onRestablecer }: Props) {
  const [confirmarReset, setConfirmarReset] = useState(false);
  const ajustadas = catalogo.filter((c) => estaAjustada(politica, c.id)).length;
  const indiceLinea = catalogo.findIndex((c) => c.riesgoMinimo > umbral);
  const conteo = { autonoma: 0, supervisada: 0, humano: 0 };
  for (const c of catalogo) conteo[c.modo] += 1;

  return (
    <section className="superficie rounded-2xl border border-panel-border bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-panel-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <ListOrdered className="size-4 text-brand" aria-hidden /> Matriz de competencias de la IA
          <Ayuda
            titulo="Cómo se lee"
            texto="Cada actuación tiene un riesgo mínimo (su posición en el ranking) y un modo. La IA no puede autoasignar a una decisión un riesgo menor que el de la actuación más grave que contiene. Lo que no está en el catálogo nunca se ejecuta solo."
          />
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
          {(Object.keys(MODO_UI) as (keyof typeof MODO_UI)[]).map((m) => {
            const M = MODO_UI[m];
            const Icono = M.icono;
            return (
              <span key={m} className={`flex items-center gap-1 ${M.color}`}>
                <Icono className="size-3" aria-hidden /> {conteo[m]} {M.etiqueta.toLowerCase()}
              </span>
            );
          })}
          {editable && ajustadas > 0 && (
            <>
              <span className="text-subtle">·</span>
              {confirmarReset ? (
                <span className="flex items-center gap-1">
                  ¿Volver al catálogo por defecto ({ajustadas} ajustadas)?
                  <button
                    type="button"
                    className="boton boton-peligro boton-sm"
                    disabled={guardando}
                    onClick={() => {
                      setConfirmarReset(false);
                      void onRestablecer().catch(() => {});
                    }}
                  >
                    Sí, restablecer
                  </button>
                  <button type="button" className="boton boton-fantasma boton-sm" onClick={() => setConfirmarReset(false)}>
                    Cancelar
                  </button>
                </span>
              ) : (
                <button type="button" className="boton boton-fantasma boton-sm" disabled={guardando} onClick={() => setConfirmarReset(true)}>
                  <RotateCcw className="size-3.5" aria-hidden /> Restablecer todo
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-[12px] text-danger" role="alert">
          {error}
        </p>
      )}

      {/* Cabeceras de columna (solo en pantallas anchas; en móvil cada fila etiqueta sus campos) */}
      <div className="hidden grid-cols-[2rem_minmax(0,1fr)_150px_236px_180px_200px] gap-x-4 border-b border-panel-border px-4 py-2 lg:grid">
        <span className="etiqueta">#</span>
        <span className="etiqueta">Actuación</span>
        <span className="etiqueta flex items-center gap-1">
          Riesgo mínimo <Ayuda texto="Suelo de riesgo 0–100. La marca vertical es el umbral de autonomía." />
        </span>
        <span className="etiqueta flex items-center gap-1">
          Modo <Ayuda texto="Autónoma: la IA ejecuta si no supera el umbral. Firma humana: la IA propone y firma una persona. Reservada: la IA nunca ejecuta." />
        </span>
        <span className="etiqueta flex items-center gap-1">
          Firma mínima <Ayuda texto="Rol mínimo que puede firmar, además del que ya exija el riesgo (cada rol firma hasta un riesgo máximo)." />
        </span>
        <span className="etiqueta">Quién la gestiona</span>
      </div>

      <ol className="list-none">
        {catalogo.map((c, i) => (
          <FilaConLinea
            key={c.id}
            antes={i === indiceLinea ? (indiceLinea === 0 ? "arriba" : "entre") : null}
            despues={indiceLinea === -1 && i === catalogo.length - 1 ? "abajo" : null}
            umbral={umbral}
          >
            <FilaCategoria
              categoria={c}
              posicion={i + 1}
              umbral={umbral}
              ajustada={estaAjustada(politica, c.id)}
              editable={editable}
              ocupado={guardando}
              onAjustar={(a) => onAjustar(c.id, a)}
            />
          </FilaConLinea>
        ))}
      </ol>
    </section>
  );
}

type PosicionLinea = "arriba" | "entre" | "abajo";

function FilaConLinea({ antes, despues, umbral, children }: { antes: PosicionLinea | null; despues: PosicionLinea | null; umbral: number; children: ReactNode }) {
  return (
    <>
      {antes && <LineaUmbral umbral={umbral} posicion={antes} />}
      {children}
      {despues && <LineaUmbral umbral={umbral} posicion={despues} />}
    </>
  );
}

/** Separador visual del umbral entre filas: encima, la IA puede actuar sola (si la actuación es autónoma). */
function LineaUmbral({ umbral, posicion }: { umbral: number; posicion: PosicionLinea }) {
  const texto =
    posicion === "arriba"
      ? `Umbral ${umbral}: ninguna actuación queda por debajo; todo pasa por una persona`
      : posicion === "abajo"
        ? `Umbral ${umbral}: todo el catálogo queda por debajo; deciden solo los modos`
        : `Umbral de autonomía ${umbral} · encima: la IA puede actuar sola (si es autónoma) · debajo: siempre firma una persona`;
  return (
    <li className="flex items-center gap-2 px-4 py-1.5 text-[11px] text-brand" aria-label={texto}>
      <span className="h-px flex-1 bg-brand/60" aria-hidden />
      <span className="shrink-0 rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 font-medium">{texto}</span>
      <span className="h-px flex-1 bg-brand/60" aria-hidden />
    </li>
  );
}
