// Lecturas tolerantes de campos OPCIONALES del Snapshot que aún no están en el
// contrato (los añaden B y D): `zonasPeligro` y `rejillaViento`. Si no vienen,
// se devuelve una lista vacía y el mapa sigue funcionando.
// DUEÑO: constructor E. Sin `any`: todo se comprueba sobre `unknown`.

import type { NivelPeligro, Punto, Snapshot } from "@/lib/dominio/tipos";

export interface ZonaPeligroMapa {
  id: string;
  punto: Punto;
  /** Dirección DESDE la que sopla (como en `Meteo`). */
  direccionGrados: number;
  velocidadKmh: number;
  nivel?: NivelPeligro;
  valor?: number;
  etiqueta?: string;
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function numeroDe(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function puntoDe(v: unknown): Punto | undefined {
  if (!esObjeto(v)) return undefined;
  const lat = numeroDe(v.lat);
  const lon = numeroDe(v.lon);
  return lat !== undefined && lon !== undefined ? { lat, lon } : undefined;
}

const NIVELES: NivelPeligro[] = ["bajo", "moderado", "alto", "muy_alto", "extremo"];

/**
 * Extrae `snapshot.zonasPeligro` (o `snapshot.rejillaViento`) si existen.
 * Acepta tanto `{punto:{lat,lon}}` como `{lat, lon}` directos.
 */
export function zonasPeligroDe(snapshot?: Snapshot): ZonaPeligroMapa[] {
  if (!snapshot) return [];
  const bruto = snapshot as unknown as Record<string, unknown>;
  const lista = Array.isArray(bruto.zonasPeligro)
    ? bruto.zonasPeligro
    : Array.isArray(bruto.rejillaViento)
      ? bruto.rejillaViento
      : [];
  const salida: ZonaPeligroMapa[] = [];
  lista.forEach((crudo, i) => {
    if (!esObjeto(crudo)) return;
    const punto = puntoDe(crudo.punto) ?? puntoDe(crudo);
    if (!punto) return;
    // B las manda con la meteo y el peligro anidados; se aceptan también planas.
    const meteo = esObjeto(crudo.meteo) ? crudo.meteo : {};
    const peligro = esObjeto(crudo.peligro) ? crudo.peligro : {};
    const direccion =
      numeroDe(crudo.direccionGrados) ?? numeroDe(meteo.direccionGrados) ?? numeroDe(crudo.direccion) ?? 0;
    const velocidad =
      numeroDe(crudo.velocidadKmh) ?? numeroDe(meteo.vientoKmh) ?? numeroDe(crudo.vientoKmh) ?? numeroDe(crudo.velocidad) ?? 0;
    const nivelCrudo = crudo.nivel ?? peligro.nivel;
    const nivel = typeof nivelCrudo === "string" && (NIVELES as string[]).includes(nivelCrudo) ? (nivelCrudo as NivelPeligro) : undefined;
    const etiqueta = typeof crudo.etiqueta === "string" ? crudo.etiqueta : typeof crudo.nombre === "string" ? crudo.nombre : undefined;
    salida.push({
      id: typeof crudo.id === "string" ? crudo.id : etiqueta ? `zona-${etiqueta}` : `zona-${i}`,
      punto,
      direccionGrados: direccion,
      velocidadKmh: velocidad,
      nivel,
      valor: numeroDe(crudo.valor) ?? numeroDe(peligro.valor),
      etiqueta,
    });
  });
  return salida;
}
