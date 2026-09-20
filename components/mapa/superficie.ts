// =====================================================================
// ATALAYA INCENDIOS · Superficie de un foco MEDIDA sobre lo que dibuja el mapa
// ---------------------------------------------------------------------
// La cifra de hectáreas del tooltip y de la ficha sale del trazado que el
// mando tiene delante, con la misma fórmula que usa el servidor
// (lib/simulacion/geometria.areaHa: cordón de zapato sobre metros locales).
// Así nunca puede haber una cifra guardada que no se corresponda con lo que
// se ve. Sin perímetro dibujable, se cae a la cifra del servidor.
// AÑADIDO (sesión superficie-real, 2026-09-19).
// =====================================================================
import type { Trazado } from "@/lib/dominio/tipos";
import { areaHa } from "@/lib/simulacion/geometria";

/** Hectáreas del polígono `perimetro`; `respaldoHa` si no hay polígono medible. */
export function superficieDibujadaHa(perimetro: Trazado | undefined, respaldoHa: number): number {
  if (!perimetro || perimetro.length < 3) return respaldoHa;
  const medida = areaHa(perimetro);
  return Number.isFinite(medida) && medida > 0 ? medida : respaldoHa;
}
