// Demanda eléctrica nacional en tiempo real (Red Eléctrica, sin clave).

import type { Evidencia } from "../../tipos-sistema";

export async function demandaActual(): Promise<{ valorMW: number; timestamp: string; url: string }> {
  const hoy = new Date();
  const d = hoy.toISOString().slice(0, 10);
  const url = `https://apidatos.ree.es/es/datos/demanda/demanda-tiempo-real?start_date=${d}T00:00&end_date=${d}T23:59&time_trunc=hour`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) throw new Error(`ree ${res.status}`);
  const j = await res.json();
  const real = (j.included as { type: string; attributes: { values: { value: number; datetime: string }[] } }[]).find((s) => s.type === "Real") ?? j.included?.[0];
  const vals = real?.attributes?.values ?? [];
  const ultimo = vals[vals.length - 1];
  if (!ultimo) throw new Error("ree sin datos");
  return { valorMW: Math.round(ultimo.value), timestamp: new Date(ultimo.datetime).toISOString(), url };
}

export function evidenciaDemanda(d: { valorMW: number; timestamp: string; url: string }): Evidencia {
  return {
    id: "ev-ree",
    fuente: "REE",
    descripcion: `Demanda eléctrica nacional ${d.valorMW.toLocaleString("es-ES")} MW`,
    valor: d.valorMW,
    unidad: "MW",
    timestamp: d.timestamp,
    url: d.url,
    confianza: 0.95,
  };
}
