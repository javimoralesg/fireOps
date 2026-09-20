"use client";
// Los focos TERMINADOS (controlados o extinguidos) desaparecen del mapa a los
// 5 s de verlos así. Se dejan esos segundos en verde para que el mando vea el
// cierre antes de que se vayan; después solo tapan el terreno. Siguen en la
// pestaña de focos y en el histórico, y las unidades que rematan un controlado
// conservan su enlace al foco: aquí solo se decide qué foco se PINTA.
// DUEÑO: constructor E. Reloj real del navegador, no tiempo de mundo: la
// simulación puede ir acelerada y "5 segundos" es una espera de pantalla.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Incendio } from "@/lib/dominio/tipos";

/** Ms que un foco terminado sigue en el mapa antes de desaparecer. */
export const MS_TERMINADO_VISIBLE = 5_000;

/** Estados que se consideran terminados a efectos de pintar el foco. */
export const ESTADOS_TERMINADOS: ReadonlySet<Incendio["estado"]> = new Set(["controlado", "extinguido"]);

/**
 * Devuelve la lista sin los focos que llevan más de MS_TERMINADO_VISIBLE en un
 * estado terminado. La cuenta empieza la primera vez que el cliente lo ve así;
 * si el foco vuelve a otro estado (rebrote) o sale del snapshot, se olvida.
 */
export function useOcultarTerminados(incendios: Incendio[]): Incendio[] {
  const [ocultos, setOcultos] = useState<ReadonlySet<string>>(() => new Set());
  const temporizadores = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pendientes = temporizadores.current;
    const terminados = new Set<string>();
    for (const i of incendios) if (ESTADOS_TERMINADOS.has(i.estado)) terminados.add(i.id);

    for (const id of terminados) {
      if (pendientes.has(id)) continue;
      pendientes.set(
        id,
        setTimeout(() => setOcultos((previos) => (previos.has(id) ? previos : new Set(previos).add(id))), MS_TERMINADO_VISIBLE),
      );
    }
    // Un foco que deja de estar terminado vuelve a poder pintarse desde cero.
    for (const [id, t] of pendientes) {
      if (terminados.has(id)) continue;
      clearTimeout(t);
      pendientes.delete(id);
      setOcultos((previos) => {
        if (!previos.has(id)) return previos;
        const siguiente = new Set(previos);
        siguiente.delete(id);
        return siguiente;
      });
    }
  }, [incendios]);

  // Al desmontar el mapa no queda ningún temporizador vivo.
  useEffect(() => {
    const pendientes = temporizadores.current;
    return () => {
      for (const t of pendientes.values()) clearTimeout(t);
      pendientes.clear();
    };
  }, []);

  return useMemo(() => (ocultos.size ? incendios.filter((i) => !ocultos.has(i.id)) : incendios), [incendios, ocultos]);
}
