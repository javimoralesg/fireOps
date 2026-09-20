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

/** Referencia estable para "no hay zonas": así vale como dependencia de `useMemo`. */
const VACIA: unknown[] = [];

/**
 * Lista CRUDA de zonas del snapshot, tal cual la manda el motor. Se expone
 * aparte para poder memoizar sin depender del snapshot entero: si el motor
 * conserva la identidad del array, esta referencia no cambia y el mapa no
 * recalcula las zonas ni repinta la capa de viento.
 */
export function listaZonasCruda(snapshot?: Snapshot): unknown[] {
  if (!snapshot) return VACIA;
  const bruto = snapshot as unknown as Record<string, unknown>;
  if (Array.isArray(bruto.zonasPeligro)) return bruto.zonasPeligro;
  if (Array.isArray(bruto.rejillaViento)) return bruto.rejillaViento;
  return VACIA;
}

/**
 * Extrae `snapshot.zonasPeligro` (o `snapshot.rejillaViento`) si existen.
 * Acepta tanto `{punto:{lat,lon}}` como `{lat, lon}` directos.
 */
export function zonasPeligroDe(snapshot?: Snapshot): ZonaPeligroMapa[] {
  return zonasPeligroDeLista(listaZonasCruda(snapshot));
}

/** Igual que `zonasPeligroDe`, pero a partir de la lista ya extraída. */
export function zonasPeligroDeLista(lista: unknown[]): ZonaPeligroMapa[] {
  if (lista.length === 0) return [];
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
