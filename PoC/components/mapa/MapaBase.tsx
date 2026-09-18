"use client";

// Punto de entrada seguro para SSR del mapa base de OpenStreetMap (ver MapaBaseCliente).
// Uso: <div className="h-80"><MapaBase centro={{ lat, lon }} penacho={…} /></div>

import dynamic from "next/dynamic";

export type { MapaBaseProps, MarcadorSimple, Tono } from "./MapaBaseCliente";

export const MapaBase = dynamic(() => import("./MapaBaseCliente").then((m) => m.MapaBaseCliente), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center text-xs text-muted">Cargando mapa…</div>,
});
