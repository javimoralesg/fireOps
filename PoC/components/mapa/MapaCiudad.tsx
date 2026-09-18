"use client";

// Mapa real de la consola, cargado solo en el cliente (Leaflet necesita window).

import dynamic from "next/dynamic";

export type { MapaCiudadProps } from "./MapaCiudadCliente";

export const MapaCiudad = dynamic(() => import("./MapaCiudadCliente").then((m) => m.MapaCiudadCliente), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center text-xs text-muted">Cargando mapa de OpenStreetMap…</div>,
});
