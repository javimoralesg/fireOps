// Filtro "solo en incendios" de las capas Unidades, Bases y parques y
// Hospitales: con cientos de parques y unidades en base cargados de OSM, el
// mapa se llena de ruido; este filtro deja solo lo que interviene de verdad.
// DUEÑO: constructor E. Lógica pura + persistencia en localStorage.

import type { Hospital, Incendio, Unidad } from "@/lib/dominio/tipos";

export type CapaFiltrable = "unidades" | "bases" | "hospitales";

const CLAVE_FILTROS = "atalaya:capas:soloIncendios";

/** Por defecto se filtra todo: el mapa limpio es el punto de partida. */
export const FILTROS_POR_DEFECTO: Record<CapaFiltrable, boolean> = {
  unidades: true,
  bases: true,
  hospitales: true,
};

/** Texto de la casilla bajo cada capa y su explicación larga (title). */
export const TEXTO_FILTRO: Record<CapaFiltrable, { etiqueta: string; titulo: string }> = {
  unidades: {
    etiqueta: "Solo las desplegadas en incendios",
    titulo: "Oculta las unidades que siguen en su base sin orden. Se ven las asignadas, en ruta, interviniendo o de regreso.",
  },
  bases: {
    etiqueta: "Solo las que han enviado medios",
    titulo: "Oculta los parques, cuarteles y bases de los que no ha salido ninguna unidad hacia un incendio.",
  },
  hospitales: {
    etiqueta: "Solo los de los focos activos",
    titulo: "Se ven el hospital de referencia (el más cercano) de cada foco activo y los que tienen una ambulancia desplegada.",
  },
};

/** Se lee en el primer render del cliente (el mapa nunca se renderiza en servidor). */
export function leerFiltros(): Record<CapaFiltrable, boolean> {
  try {
    const guardado = localStorage.getItem(CLAVE_FILTROS);
    return guardado ? { ...FILTROS_POR_DEFECTO, ...(JSON.parse(guardado) as Partial<Record<CapaFiltrable, boolean>>) } : FILTROS_POR_DEFECTO;
  } catch {
    return FILTROS_POR_DEFECTO;
  }
}

/** Guarda y devuelve el mismo objeto, para usarlo dentro de `setEstado(f => …)`. */
export function guardarFiltros(filtros: Record<CapaFiltrable, boolean>): Record<CapaFiltrable, boolean> {
  try {
    localStorage.setItem(CLAVE_FILTROS, JSON.stringify(filtros));
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
  return filtros;
}

/**
 * Una unidad participa si está asignada a un foco o si no está ni en base ni
 * fuera de servicio (asignada, en ruta, interviniendo o de regreso).
 * `incendioId` solo lo fija el coordinador/despachador al asignarla, así que
 * "en el radio de un foco" NO cuenta como participar.
 */
export function unidadParticipa(u: Unidad): boolean {
  return Boolean(u.incendioId) || (u.estado !== "disponible" && u.estado !== "fuera_servicio");
}

/**
 * Hospitales que participan: los que tienen una ambulancia desplegada (la
 * unidad `…:AMB` tiene la base en el hospital) y el hospital de referencia de
 * cada foco activo (el más cercano; si no hay ninguno de tipo "hospital", el
 * centro de salud más cercano). Con la lista de activos vacía solo quedan los
 * que han enviado ambulancia.
 */
export function hospitalesParticipantes(hospitales: Hospital[], unidades: Unidad[], activos: Incendio[]): Hospital[] {
  if (hospitales.length === 0) return hospitales;
  const conAmbulancia = new Set<string>();
  for (const u of unidades) if (u.base?.osmId && unidadParticipa(u)) conAmbulancia.add(u.base.osmId);

  const activosIds = new Set(activos.map((i) => i.id));
  const referencia = new Map<string, Hospital>();
  for (const h of hospitales) {
    if (!h.incendioId || !activosIds.has(h.incendioId)) continue;
    const previo = referencia.get(h.incendioId);
    if (!previo || antesQue(h, previo)) referencia.set(h.incendioId, h);
  }
  const referenciaIds = new Set([...referencia.values()].map((h) => h.id));
  const salida = hospitales.filter((h) => conAmbulancia.has(h.id) || referenciaIds.has(h.id));
  return salida.length === hospitales.length ? hospitales : salida;
}

/** Orden de preferencia como hospital de referencia: tipo "hospital" primero, luego el más cercano. */
function antesQue(a: Hospital, b: Hospital): boolean {
  const pesoA = a.tipo === "hospital" ? 0 : 1;
  const pesoB = b.tipo === "hospital" ? 0 : 1;
  if (pesoA !== pesoB) return pesoA < pesoB;
  return (a.distanciaKm ?? Number.POSITIVE_INFINITY) < (b.distanciaKm ?? Number.POSITIVE_INFINITY);
}
