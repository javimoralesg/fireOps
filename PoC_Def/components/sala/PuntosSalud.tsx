"use client";
// Puntos de salud de los servicios externos: verde/rojo CON nombre, y el detalle
// al pasar el ratón o con el tabulador. DUEÑO: constructor E.

import { memo } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import { haceCuanto } from "@/lib/cliente/formato";

export type Servicios = Record<string, { ok: boolean; detalle?: string; en: string }>;

/** `memo` (constructor R): solo se repinta cuando cambia el objeto `servicios`. */
function PuntosSaludBase({ servicios }: { servicios?: Servicios }) {
  const entradas = Object.entries(servicios ?? {});
  if (entradas.length === 0) {
    return <span className="text-[11px] text-subtle">Salud de servicios: sin datos todavía</span>;
  }
  const caidos = entradas.filter(([, v]) => !v.ok);

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] font-medium text-muted">
        Servicios{" "}
        <span className={caidos.length ? "text-danger" : "text-success"}>
          {entradas.length - caidos.length}/{entradas.length}
        </span>
      </span>
      <ul className="flex flex-wrap items-center gap-1">
        {entradas.map(([nombre, v]) => (
          <li key={nombre}>
            <Tooltip
              lado="abajo"
              titulo={`${nombre}: ${v.ok ? "operativo" : "sin servicio"}`}
              contenido={
                <>
                  {v.detalle || (v.ok ? "Responde con normalidad." : "No responde. Revisa la clave o la conexión.")}
                  <br />
                  Comprobado {haceCuanto(v.en)}.{" "}
                  {!v.ok ? (
                    <a href="/docs/CLAVES.md" className="text-brand underline underline-offset-2">
                      Cómo obtener la clave
                    </a>
                  ) : null}
                </>
              }
            >
              <button
                type="button"
                className={[
                  "inline-flex min-h-8 items-center gap-1 rounded-full border px-1.5 text-[10.5px] font-medium",
                  v.ok ? "border-success/40 bg-success/10 text-success" : "border-danger/50 bg-danger/12 text-danger",
                ].join(" ")}
              >
                <span aria-hidden className={`size-1.5 rounded-full ${v.ok ? "bg-success" : "bg-danger latido"}`} />
                {nombre}
                <span className="solo-lectores">{v.ok ? "operativo" : "sin servicio"}</span>
              </button>
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const PuntosSalud = memo(PuntosSaludBase);
