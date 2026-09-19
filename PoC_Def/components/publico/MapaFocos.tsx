"use client";
// =====================================================================
// Mapa sencillo del portal ciudadano: focos activos y su perímetro.
// DUEÑO: constructor D. Leaflet directo (sin react-leaflet) para no depender
// del mapa de la sala de mando (constructor E) ni de SSR.
// =====================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { Trazado } from "@/lib/dominio/tipos";

export interface FocoPublico {
  id: string;
  nombre: string;
  municipio: string;
  provincia: string;
  estado: string;
  nivelGravedad: number;
  areaHa: number;
  centro: { lat: number; lon: number };
  perimetro: Trazado;
  /**
   * AÑADIDO (constructor N, opcional): fuente pública del aviso. Si /api/comunicados
   * las envía, el portal pinta el enlace; si no vienen, no se pinta nada.
   */
  fuenteDeteccion?: string;
  fuenteUrl?: string;
}

const COLOR: Record<string, string> = {
  detectado: "#f59e0b",
  confirmado: "#f97316",
  activo: "#dc2626",
  estabilizado: "#0ea5e9",
  controlado: "#16a34a",
  extinguido: "#64748b",
};

export default function MapaFocos({ focos }: { focos: FocoPublico[] }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<import("leaflet").Map | null>(null);
  const capa = useRef<import("leaflet").LayerGroup | null>(null);
  /** Sube a 1 cuando el mapa ya existe: hasta entonces no hay nada que pintar. */
  const [listo, setListo] = useState(0);

  // Se declara ANTES de los efectos que la usan (regla de React: nada se usa
  // antes de existir) y depende de `focos`, que es lo único que dibuja.
  const pintar = useCallback(
    (L: typeof import("leaflet")) => {
      const m = mapa.current;
      const c = capa.current;
      if (!m || !c) return;
      c.clearLayers();
      const puntos: [number, number][] = [];
      for (const f of focos) {
        const color = COLOR[f.estado] ?? "#dc2626";
        const etiqueta =
          `<strong>${f.nombre}</strong><br/>${f.municipio}${f.provincia ? `, ${f.provincia}` : ""}<br/>` +
          `Estado: ${f.estado} · nivel ${f.nivelGravedad}<br/>Superficie estimada: ${f.areaHa.toFixed(0)} ha`;
        if (f.perimetro?.length >= 3) {
          L.polygon(f.perimetro, { color, weight: 2, fillOpacity: 0.25 }).bindPopup(etiqueta).addTo(c);
        }
        L.circleMarker([f.centro.lat, f.centro.lon], { radius: 8, color, fillColor: color, fillOpacity: 0.9 }).bindPopup(etiqueta).addTo(c);
        puntos.push([f.centro.lat, f.centro.lon]);
      }
      if (puntos.length) m.fitBounds(L.latLngBounds(puntos).pad(0.4), { maxZoom: 11 });
    },
    [focos],
  );

  // Creación del mapa: una sola vez, con Leaflet cargado a demanda.
  useEffect(() => {
    let cancelado = false;
    void (async () => {
      const L = (await import("leaflet")).default;
      if (cancelado || !contenedor.current || mapa.current) return;
      mapa.current = L.map(contenedor.current, { scrollWheelZoom: false }).setView([40.2, -3.7], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(mapa.current);
      capa.current = L.layerGroup().addTo(mapa.current);
      setListo((n) => n + 1);
    })();
    return () => {
      cancelado = true;
      mapa.current?.remove();
      mapa.current = null;
      capa.current = null;
    };
  }, []);

  // Repintado cuando cambian los focos (y en cuanto el mapa está listo).
  useEffect(() => {
    if (!listo) return;
    let cancelado = false;
    void (async () => {
      const L = (await import("leaflet")).default;
      if (!cancelado) pintar(L);
    })();
    return () => {
      cancelado = true;
    };
  }, [listo, pintar]);

  return (
    <div>
      <div ref={contenedor} className="h-80 w-full rounded-xl border border-slate-200 bg-slate-100 sm:h-96" role="img" aria-label="Mapa de incendios activos en España" />
      <ul className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
        {Object.entries(COLOR)
          .filter(([estado]) => focos.some((f) => f.estado === estado))
          .map(([estado, color]) => (
            <li key={estado} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: color }} aria-hidden />
              {estado}
            </li>
          ))}
      </ul>
    </div>
  );
}
