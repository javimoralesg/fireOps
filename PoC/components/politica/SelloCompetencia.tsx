"use client";

import { Tooltip } from "@/components/ui/Tooltip";
import { CATALOGO, type VeredictoCompetencia } from "@/lib/politica-autonomia";
import { ROLES } from "@/lib/roles";
import { MODO_UI } from "./ui";

interface Props {
  /** Decision.competencia (motor) o evaluarCompetencia(...) en cliente. Si no hay, no pinta nada. */
  veredicto: VeredictoCompetencia | null | undefined;
  /** Solo el modo, sin la firma mínima (para filas densas). */
  compacto?: boolean;
  className?: string;
}

/**
 * Sello "quién gestiona esta decisión" según la política de autonomía: modo
 * (IA autónoma / firma humana / reservada a personas), categoría dominante y
 * firma mínima. Pensado para incrustarlo en DetalleDecision, ZonaAccion o la cola.
 */
export function SelloCompetencia({ veredicto: v, compacto = false, className = "" }: Props) {
  if (!v) return null;
  const m = MODO_UI[v.modo];
  const Icono = m.icono;
  const nombres = v.categorias.map((id) => CATALOGO.find((c) => c.id === id)?.nombre ?? id);
  const firma = v.firmaMinima ? ROLES[v.firmaMinima].nombre : null;
  return (
    <Tooltip
      titulo={`Política de autonomía · ${m.etiqueta}`}
      ancho={340}
      contenido={
        <>
          <p>{v.motivo}</p>
          {nombres.length > 0 && (
            <p className="mt-1.5">
              Actuaciones detectadas: <strong>{nombres.join(", ")}</strong>.
            </p>
          )}
          {firma && (
            <p className="mt-1.5">
              Firma mínima: <strong>{firma}</strong>.
            </p>
          )}
          <p className="mt-1.5 text-subtle">
            Riesgo efectivo {v.riesgoEfectivo}
            {v.riesgoEfectivo !== v.riesgoPropuesto ? ` (la IA estimó ${v.riesgoPropuesto})` : ""} · umbral {v.umbral}
          </p>
        </>
      }
    >
      <span className={`${m.pildora} ${className}`}>
        <Icono className="size-3" aria-hidden />
        {m.etiqueta}
        {!compacto && firma && <span className="font-normal opacity-80">· {firma}</span>}
      </span>
    </Tooltip>
  );
}
