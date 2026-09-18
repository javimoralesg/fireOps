"use client";

import { Scale, TriangleAlert, Undo2 } from "lucide-react";
import { BarraRiesgo } from "@/components/decision/Indicadores";
import { Ayuda, Tooltip } from "@/components/ui/Tooltip";
import { CATALOGO, type AjusteCategoria, type CategoriaAccion, type ModoCompetencia } from "@/lib/politica-autonomia";
import { escalarA, ROLES } from "@/lib/roles";
import { gestionDeCategoria, MODO_UI, ROLES_FIRMA } from "./ui";

interface Props {
  categoria: CategoriaAccion;
  posicion: number;
  umbral: number;
  ajustada: boolean;
  editable: boolean;
  ocupado: boolean;
  onAjustar: (ajuste: AjusteCategoria) => Promise<void>;
}

const MODOS: ModoCompetencia[] = ["autonoma", "supervisada", "humano"];

/** Una fila del ranking: qué es, riesgo mínimo, modo, firma mínima y quién acaba gestionándola. */
export function FilaCategoria({ categoria: c, posicion, umbral, ajustada, editable, ocupado, onAjustar }: Props) {
  const base = CATALOGO.find((x) => x.id === c.id)!;
  const gestion = gestionDeCategoria(c, umbral);
  const G = MODO_UI[gestion.modo];
  const IconoGestion = G.icono;

  // El número de riesgo es un input no controlado que se remonta (key) cuando cambia
  // el valor del servidor, y se envía al confirmar (Enter / blur).
  const confirmarRiesgo = (el: HTMLInputElement) => {
    const n = Math.round(Number(el.value));
    if (!Number.isFinite(n) || n === c.riesgoMinimo) {
      el.value = String(c.riesgoMinimo);
      return;
    }
    void onAjustar({ riesgoMinimo: Math.max(0, Math.min(100, n)) }).catch(() => {
      el.value = String(c.riesgoMinimo);
    });
  };

  const restablecer = () => void onAjustar({ modo: base.modo, riesgoMinimo: base.riesgoMinimo, firmaMinima: base.firmaMinima ?? null }).catch(() => {});

  const bloqueado = !editable || ocupado;

  return (
    <li
      className={`grid grid-cols-1 gap-x-4 gap-y-2 border-b border-panel-border px-4 py-3 last:border-b-0 lg:grid-cols-[2rem_minmax(0,1fr)_150px_236px_180px_200px] lg:items-center ${ajustada ? "bg-brand/5" : ""}`}
      aria-label={`${c.nombre}, riesgo mínimo ${c.riesgoMinimo}, ${MODO_UI[c.modo].etiqueta}`}
    >
      {/* Posición en el ranking */}
      <span className="hidden font-mono text-[12px] text-subtle lg:block">{String(posicion).padStart(2, "0")}</span>

      {/* Qué es */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[11px] text-subtle lg:hidden">{String(posicion).padStart(2, "0")}</span>
          <Tooltip titulo={c.nombre} contenido={<>Ejemplos: {c.ejemplos.join(" · ")}.</>} lado="abajo">
            <span className="text-[13px] font-semibold text-foreground">{c.nombre}</span>
          </Tooltip>
          {!c.reversible && (
            <Tooltip titulo="Irreversible" contenido="No se puede deshacer en minutos sin consecuencias: por eso pesa más en el ranking.">
              <span className="pildora pildora-aviso">
                <TriangleAlert className="size-3" aria-hidden /> Irreversible
              </span>
            </Tooltip>
          )}
          {c.afectaDerechos && (
            <Tooltip titulo="Afecta a derechos" contenido="Restringe la movilidad, la propiedad o la libertad de la población: la ley reserva estas medidas a la autoridad.">
              <span className="pildora pildora-peligro">
                <Scale className="size-3" aria-hidden /> Derechos
              </span>
            </Tooltip>
          )}
          {ajustada && (
            <Tooltip titulo="Ajustada" contenido={`Difiere del catálogo por defecto (${MODO_UI[base.modo].etiqueta.toLowerCase()}, riesgo ${base.riesgoMinimo}${base.firmaMinima ? `, firma ${ROLES[base.firmaMinima].nombre}` : ""}).`}>
              <span className="pildora pildora-marca">Ajustada</span>
            </Tooltip>
          )}
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-muted">
          {c.descripcion} <Ayuda titulo="Base" texto={c.base} className="align-middle" />
        </p>
      </div>

      {/* Riesgo mínimo */}
      <div className="flex items-center gap-2">
        <span className="etiqueta w-16 lg:hidden">Riesgo</span>
        <BarraRiesgo riesgo={c.riesgoMinimo} umbral={umbral} className="w-16 lg:flex-1" />
        {editable ? (
          <input
            key={c.riesgoMinimo}
            type="number"
            min={0}
            max={100}
            step={5}
            defaultValue={c.riesgoMinimo}
            disabled={bloqueado}
            onBlur={(e) => confirmarRiesgo(e.currentTarget)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") e.currentTarget.value = String(c.riesgoMinimo);
            }}
            className="w-14 rounded-md border border-panel-border bg-panel-2 px-1.5 py-1 text-right font-mono text-[12px] text-foreground focus-visible:border-brand focus-visible:outline-none disabled:opacity-60"
            aria-label={`Riesgo mínimo de ${c.nombre}`}
          />
        ) : (
          <span className="w-8 text-right font-mono text-[12px] text-foreground">{c.riesgoMinimo}</span>
        )}
      </div>

      {/* Modo */}
      <div className="flex items-center gap-1" role="group" aria-label={`Modo de ${c.nombre}`}>
        <span className="etiqueta w-16 lg:hidden">Modo</span>
        {MODOS.map((m) => {
          const M = MODO_UI[m];
          const Icono = M.icono;
          const activo = c.modo === m;
          return (
            <Tooltip key={m} titulo={M.etiqueta} contenido={M.titulo + ". " + M.descripcion} lado="abajo">
              <button
                type="button"
                className="chip"
                aria-pressed={activo}
                disabled={bloqueado || activo}
                onClick={() => void onAjustar({ modo: m }).catch(() => {})}
              >
                <Icono className={`size-3 ${activo ? M.color : ""}`} aria-hidden />
                <span className="hidden xl:inline">{M.etiqueta}</span>
                <span className="xl:hidden">{m === "autonoma" ? "IA" : m === "supervisada" ? "Firma" : "Persona"}</span>
              </button>
            </Tooltip>
          );
        })}
      </div>

      {/* Firma mínima */}
      <div className="flex items-center gap-2">
        <span className="etiqueta w-16 lg:hidden">Firma</span>
        <select
          value={c.firmaMinima ?? ""}
          disabled={bloqueado}
          onChange={(e) => void onAjustar({ firmaMinima: (e.target.value || null) as AjusteCategoria["firmaMinima"] }).catch(() => {})}
          className="w-full rounded-md border border-panel-border bg-panel-2 px-2 py-1 text-[12px] text-foreground focus-visible:border-brand focus-visible:outline-none disabled:opacity-60"
          aria-label={`Firma mínima de ${c.nombre}`}
        >
          <option value="">Según riesgo ({ROLES[escalarA(c.riesgoMinimo)].nombre})</option>
          {ROLES_FIRMA.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nombre} (≤ {r.riesgoMaxDecision})
            </option>
          ))}
        </select>
      </div>

      {/* Resultado */}
      <div className="flex items-center justify-between gap-2">
        <Tooltip
          titulo="Quién la gestiona"
          contenido={
            <>
              {G.titulo}. {gestion.nota ? `Ahora mismo: ${gestion.nota}.` : ""} {gestion.firma ? `Firma mínima: ${ROLES[gestion.firma].nombre}.` : ""}
            </>
          }
          lado="izquierda"
        >
          <span className={`flex min-w-0 items-center gap-1.5 text-[12px] ${G.color}`}>
            <IconoGestion className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{gestion.texto}</span>
          </span>
        </Tooltip>
        {ajustada && editable && (
          <Tooltip titulo="Restablecer" contenido="Vuelve al valor por defecto del catálogo para esta actuación.">
            <button type="button" className="boton boton-fantasma boton-sm" disabled={ocupado} onClick={restablecer} aria-label={`Restablecer ${c.nombre}`}>
              <Undo2 className="size-3.5" aria-hidden />
            </button>
          </Tooltip>
        )}
      </div>
    </li>
  );
}
