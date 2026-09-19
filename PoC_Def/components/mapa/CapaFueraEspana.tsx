"use client";
// =====================================================================
// Máscara "fuera de España": el mundo entero en rojo salvo el territorio
// español, recortado con los anillos REALES del contorno administrativo
// (lib/dominio/espana.ts: península, Baleares, Canarias, Ceuta, Melilla,
// Llívia y plazas de soberanía). Es la cara visible de la restricción: nada
// de fuera entra en el sistema, y el mapa lo enseña como zona excluida.
// Un solo polígono (exterior = mundo, agujeros = España) con relleno
// `evenodd`, más el contorno a trazos. No es interactivo: no roba clics.
// DUEÑO: sesión 2026-09-19 (restricción a España).
// =====================================================================
import { useMemo } from "react";
import type { PathOptions } from "leaflet";
import { Polygon } from "react-leaflet";
import { ANILLOS_ESPANA } from "@/lib/dominio/espana";
import type { ColoresTema } from "./useColoresTema";

/** Anillo exterior: el mundo proyectable (Mercator no llega a ±90°). */
const MUNDO: [number, number][] = [
  [-85, -180],
  [-85, 180],
  [85, 180],
  [85, -180],
];

/** Exterior + 17 agujeros: con `evenodd` el relleno queda solo fuera de España. Referencia fija para react-leaflet. */
const ANILLOS_MASCARA: [number, number][][] = [MUNDO, ...ANILLOS_ESPANA];

export function CapaFueraEspana({ colores }: { colores: ColoresTema }) {
  const mascara = useMemo<PathOptions>(
    () => ({ stroke: false, fillColor: colores.danger, fillOpacity: colores.oscuro ? 0.32 : 0.22, fillRule: "evenodd", interactive: false }),
    [colores.danger, colores.oscuro],
  );
  const borde = useMemo<PathOptions>(
    () => ({ color: colores.danger, weight: 1.5, opacity: 0.9, dashArray: "6 4", fill: false, interactive: false }),
    [colores.danger],
  );
  return (
    <>
      <Polygon positions={ANILLOS_MASCARA} pathOptions={mascara} />
      {ANILLOS_ESPANA.map((anillo, i) => (
        <Polygon key={i} positions={anillo} pathOptions={borde} />
      ))}
    </>
  );
}
