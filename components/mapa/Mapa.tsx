"use client";
// Punto de entrada seguro para SSR del mapa de la sala (Leaflet usa `window`).
// DUEÑO: constructor E. Uso: <div className="h-full"><Mapa snapshot={…} /></div>

import dynamic from "next/dynamic";

export type { MapaProps, PeticionEncuadre } from "./MapaCliente";

export const Mapa = dynamic(() => import("./MapaCliente").then((m) => m.MapaCliente), {
  ssr: false,
  loading: () => (
    <div className="flex size-full items-center justify-center bg-panel-2 text-sm text-muted">Cargando el mapa de situación…</div>
  ),
});
