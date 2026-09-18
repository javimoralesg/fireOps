"use client";

// Mapa de la zona afectada para la ciudadanía: punto del incidente, radio a evitar
// y, en incendios, hacia dónde va el humo. Reutiliza MapaBase (poc-26) sin interacción
// para que en móvil no secuestre el scroll.

import { Map as MapIcon } from "lucide-react";
import { MapaBase } from "@/components/mapa/MapaBase";
import { esCoordenada, humoHacia } from "./interpretar";
import type { VistaPublica } from "./tipos";

/** Radio orientativo a evitar por tipo de incidente (m). */
const RADIO_M: Record<string, number> = {
  incendio_industrial: 500,
  inundacion: 800,
  apagon: 1500,
};

export function MapaZona({ vista }: { vista: VistaPublica }) {
  const u = vista.incidente?.ubicacion;
  if (!u || typeof u === "string" || u.lat == null || u.lon == null) return null;

  const nombreLugar = esCoordenada(u.nombre) ? "Lugar del incidente" : u.nombre;
  const tipo = String(vista.incidente?.tipo ?? "");
  const radioM = RADIO_M[tipo] ?? 600;
  const viento = vista.entorno?.viento;
  const esIncendio = tipo.startsWith("incendio");
  const humo = esIncendio && viento ? humoHacia(viento.direccionGrados) : null;
  // Alcance del penacho proporcional al viento: flojo se queda cerca, fuerte llega lejos.
  const longitudM = viento ? Math.min(4000, Math.max(800, Math.round(viento.velocidadKmh * 120))) : 0;

  return (
    <section aria-labelledby="titulo-mapa" className="space-y-3">
      <h2 id="titulo-mapa" className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <MapIcon className="size-5 text-brand" aria-hidden="true" />
        Zona afectada
      </h2>
      <div className="superficie overflow-hidden rounded-2xl border border-panel-border bg-panel">
        <div className="h-64 sm:h-80" role="img" aria-label={`Mapa de la zona afectada alrededor de: ${nombreLugar}`}>
          <MapaBase
            centro={{ lat: u.lat, lon: u.lon }}
            zoom={radioM > 700 ? 14 : 15}
            zona={{ tipo: "circulo", radioM }}
            penacho={humo ? { rumboGrados: humo.grados, longitudM, semianguloGrados: 22 } : undefined}
            penachoEtiqueta={humo ? `El humo va hacia el ${humo.nombre}` : undefined}
            marcadores={[{ id: "incidente", lat: u.lat, lon: u.lon, etiqueta: nombreLugar, tono: "danger" }]}
            interactivo={false}
          />
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-panel-border px-5 py-3 text-[14px] text-muted">
          <li className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-danger" aria-hidden="true" /> Lugar del incidente
          </li>
          <li className="flex items-center gap-2">
            <span className="size-2.5 rounded-full border-2 border-danger/70" aria-hidden="true" /> Evita un radio de{" "}
            {radioM >= 1000 ? `${(radioM / 1000).toLocaleString("es-ES")} km` : `${radioM} m`}
          </li>
          {humo && (
            <li className="flex items-center gap-2">
              <span className="h-2.5 w-4 rounded-sm bg-warning/60" aria-hidden="true" /> El humo va hacia el {humo.nombre}
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
