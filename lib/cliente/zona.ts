// Filtro por zona de la sala de mando: un recuadro o un lazo dibujado sobre el
// mapa que deja ver SOLO los focos que caen dentro y todo lo que cuelga de
// ellos (unidades, pueblos, decisiones, registro, informes…).
// DUEÑO: constructor E. Sin dependencias: geometría plana en grados, que a la
// escala de España sobra (no hay antimeridiano ni polos por medio).
//
// La zona se guarda en localStorage y sobrevive a recargas y a cambios de
// snapshot: solo desaparece cuando el mando pulsa "Quitar filtro". El
// snapshot completo sigue llegando por SSE; aquí se recorta una copia y el
// mapa y el panel reciben ya solo lo de la zona. Un array que no pierde ningún
// elemento conserva su referencia (contrato con los memos del mapa).

import type { Punto, Snapshot } from "@/lib/dominio/tipos";

export type TipoZona = "recuadro" | "lazo";

export interface ZonaSeleccion {
  tipo: TipoZona;
  /** Polígono cerrado en orden [lat, lon] (el que espera Leaflet). Mínimo 3 vértices. */
  puntos: [number, number][];
  /** `Date.now()` de cuando se dibujó: cambia con cada zona nueva (sirve de sello). */
  creadaEn: number;
}

export const CLAVE_ZONA = "atalaya:zona";

// ---------------------------------------------------------------------------
// Geometría
// ---------------------------------------------------------------------------

/**
 * Prueba "punto dentro del polígono" (ray casting, vale para lazos cóncavos)
 * con descarte rápido por la caja envolvente, calculada una sola vez.
 */
export function crearPruebaZona(puntos: [number, number][]): (p: Punto) => boolean {
  if (puntos.length < 3) return () => false;
  let sur = Infinity,
    norte = -Infinity,
    oeste = Infinity,
    este = -Infinity;
  for (const [la, lo] of puntos) {
    sur = Math.min(sur, la);
    norte = Math.max(norte, la);
    oeste = Math.min(oeste, lo);
    este = Math.max(este, lo);
  }
  return (p: Punto) => {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return false;
    if (p.lat < sur || p.lat > norte || p.lon < oeste || p.lon > este) return false;
    let dentro = false;
    for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) {
      const [latI, lonI] = puntos[i];
      const [latJ, lonJ] = puntos[j];
      const cruza = latI > p.lat !== latJ > p.lat && p.lon < ((lonJ - lonI) * (p.lat - latI)) / (latJ - latI) + lonI;
      if (cruza) dentro = !dentro;
    }
    return dentro;
  };
}

/** Atajo para una sola comprobación. Para muchas, usar `crearPruebaZona`. */
export function puntoEnZona(p: Punto, puntos: [number, number][]): boolean {
  return crearPruebaZona(puntos)(p);
}

/** Límites [[sur, oeste], [norte, este]] de la zona, para encuadrarla. */
export function limitesZona(zona: ZonaSeleccion): [[number, number], [number, number]] {
  let sur = Infinity,
    norte = -Infinity,
    oeste = Infinity,
    este = -Infinity;
  for (const [la, lo] of zona.puntos) {
    sur = Math.min(sur, la);
    norte = Math.max(norte, la);
    oeste = Math.min(oeste, lo);
    este = Math.max(este, lo);
  }
  return [
    [sur, oeste],
    [norte, este],
  ];
}

// ---------------------------------------------------------------------------
// Filtrado del snapshot
// ---------------------------------------------------------------------------

/** Devuelve el MISMO array si nada se ha quitado (conserva identidades para los memos). */
function filtrar<T>(lista: T[], pasa: (x: T) => boolean): T[] {
  let salida: T[] | null = null;
  for (let i = 0; i < lista.length; i += 1) {
    const x = lista[i];
    if (pasa(x)) {
      if (salida) salida.push(x);
    } else if (!salida) {
      salida = lista.slice(0, i);
    }
  }
  return salida ?? lista;
}

type Elemento<T> = T extends (infer U)[] ? U : never;
/** Claves del snapshot que son listas (las únicas que se recortan). */
type ClaveLista = { [K in keyof Snapshot]-?: NonNullable<Snapshot[K]> extends unknown[] ? K : never }[keyof Snapshot];

/**
 * Recorta el snapshot a la zona. Reglas, en una frase cada una:
 *  · un foco está dentro si su centro o algún vértice de su perímetro lo está;
 *  · lo que cuelga de un foco (pueblos, decisiones, eventos, informes, partes,
 *    comunicados, clústeres) se queda si su foco se queda; lo que no cuelga de
 *    ningún foco (una decisión general, un evento del sistema) se queda siempre;
 *  · lo que tiene posición propia y ningún foco (unidades en base, cámaras,
 *    hospitales, detecciones de satélite, zonas de peligro) se queda si está dentro;
 *  · agentes, lecciones, avisos meteo, política, reloj y ejecución no se tocan.
 * Sin zona (o con menos de 3 vértices) devuelve el snapshot tal cual; si nada
 * cae fuera, también devuelve el mismo objeto.
 */
export function filtrarSnapshotPorZona(snapshot: Snapshot | undefined, zona: ZonaSeleccion | null | undefined): Snapshot | undefined {
  if (!snapshot || !zona || zona.puntos.length < 3) return snapshot;
  const dentro = crearPruebaZona(zona.puntos);
  const dentroDe = (p?: Punto): boolean => p !== undefined && dentro(p);

  const incendios = filtrar(snapshot.incendios ?? [], (i) => dentro(i.centro) || (i.perimetro ?? []).some(([la, lo]) => dentro({ lat: la, lon: lo })));
  const ids = new Set(incendios.map((i) => i.id));
  const deFoco = (id?: string): boolean => id === undefined || ids.has(id);

  const cambios: Partial<Snapshot> = {};
  let hayCambios = false;
  function aplicar<K extends ClaveLista>(clave: K, pasa: (x: Elemento<NonNullable<Snapshot[K]>>) => boolean): void {
    const lista = snapshot![clave] as Elemento<NonNullable<Snapshot[K]>>[] | undefined;
    if (!lista) return;
    const filtrada = filtrar(lista, pasa);
    if (filtrada !== lista) {
      (cambios as Record<string, unknown>)[clave] = filtrada;
      hayCambios = true;
    }
  }

  if (incendios !== snapshot.incendios) {
    cambios.incendios = incendios;
    hayCambios = true;
  }
  aplicar("clusters", (c) => c.incendios.some((id) => ids.has(id)));
  aplicar("unidades", (u) => (u.incendioId ? ids.has(u.incendioId) : dentroDe(u.posicion) || dentroDe(u.base?.punto)));
  aplicar("poblaciones", (p) => ids.has(p.incendioId));
  aplicar("hospitales", (h) => (h.incendioId ? ids.has(h.incendioId) : dentroDe(h.punto)));
  aplicar("camaras", (c) => (c.incendioId ? ids.has(c.incendioId) : dentroDe(c.punto)));
  aplicar("focosSatelite", (f) => dentroDe(f.punto));
  aplicar("observaciones", (o) => (o.incendioId ? ids.has(o.incendioId) : o.punto ? dentro(o.punto) : true));
  aplicar("decisiones", (d) => deFoco(d.incendioId));
  aplicar("comunicados", (c) => deFoco(c.incendioId));
  aplicar("eventos", (e) => deFoco(e.incendioId));
  aplicar("informes", (i) => deFoco(i.incendioId));
  aplicar("tickets", (t) => deFoco(t.incendioId));
  aplicar("zonasPeligro", (z) => dentroDe(z.punto));

  return hayCambios ? { ...snapshot, ...cambios } : snapshot;
}

// ---------------------------------------------------------------------------
// Persistencia (localStorage): la zona sobrevive a recargas
// ---------------------------------------------------------------------------

function esPar(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]);
}

/** Valida un objeto cualquiera (JSON de localStorage) antes de darlo por zona. */
export function zonaValida(v: unknown): ZonaSeleccion | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const tipo = o.tipo === "recuadro" || o.tipo === "lazo" ? o.tipo : null;
  if (!tipo || !Array.isArray(o.puntos) || o.puntos.length < 3 || !o.puntos.every(esPar)) return null;
  const creadaEn = typeof o.creadaEn === "number" && Number.isFinite(o.creadaEn) ? o.creadaEn : Date.now();
  return { tipo, puntos: o.puntos.map(([la, lo]) => [la, lo] as [number, number]), creadaEn };
}

export function leerZonaGuardada(): ZonaSeleccion | null {
  if (typeof window === "undefined") return null;
  try {
    const crudo = window.localStorage.getItem(CLAVE_ZONA);
    return crudo ? zonaValida(JSON.parse(crudo)) : null;
  } catch {
    return null; // sin almacenamiento o JSON roto: se empieza sin zona
  }
}

/** `null` borra la zona guardada. */
export function guardarZona(zona: ZonaSeleccion | null): void {
  if (typeof window === "undefined") return;
  try {
    if (zona) window.localStorage.setItem(CLAVE_ZONA, JSON.stringify(zona));
    else window.localStorage.removeItem(CLAVE_ZONA);
  } catch {
    /* no se puede guardar: la zona vale para esta sesión */
  }
}
