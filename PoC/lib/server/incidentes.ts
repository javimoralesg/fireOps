// Asignación de eventos a incidentes (motor dirigido por eventos): un evento se
// une a un incidente existente si es del mismo tipo de emergencia, está a menos
// de 1,5 km (por coordenadas o por vértice del grafo) y ha ocurrido hace menos
// de 2 h; si no, abre un incidente nuevo. `estado.incidente` sigue siendo el
// más grave/activo para compatibilidad con la UI.

import type { EventoIngesta, NodoGrafo } from "../types";
import type { EstadoSistema, Incidente, TipoEmergencia } from "../tipos-sistema";
import { nuevoId, registrar } from "./estado";

const RADIO_M = 1500;
const VENTANA_MS = 2 * 60 * 60 * 1000;
const PESO_SEV: Record<NonNullable<Incidente["severidad"]>, number> = { critica: 4, alta: 3, media: 2, baja: 1 };

export function distanciaM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Coordenadas de un evento: geo del periférico o, si no, las del vértice del grafo al que se refiere. */
export function coordsEvento(x: EventoIngesta, nodos: NodoGrafo[], nodoId?: string): { lat: number; lon: number } | undefined {
  if (x.geo) return { lat: x.geo.lat, lon: x.geo.lon };
  const n = nodoId ? nodos.find((k) => k.id === nodoId) : undefined;
  return n && typeof n.lat === "number" && typeof n.lon === "number" ? { lat: n.lat, lon: n.lon } : undefined;
}

const TITULO: Record<TipoEmergencia, string> = {
  incendio_industrial: "Incendio industrial",
  incendio_urbano: "Incendio urbano",
  incendio_forestal: "Incendio forestal",
  inundacion: "Inundación",
  accidente_trafico: "Accidente de tráfico",
  accidente_ferroviario: "Accidente ferroviario",
  fuga_gas: "Fuga de gas",
  derrumbe: "Derrumbe",
  apagon: "Apagón",
  ola_calor: "Ola de calor",
  nevada: "Nevada",
  sismo: "Sismo",
  aglomeracion: "Aglomeración",
  vertido_quimico: "Vertido químico",
  persona_peligro: "Persona en peligro",
  otro: "Incidencia",
};

export function tituloIncidente(tipo: TipoEmergencia, lugar?: string) {
  const limpio = lugar?.split(" · ")[0].replace(/\s*\(?-?\d{1,2}[.,]\d+\s*,\s*-?\d{1,3}[.,]\d+\)?/g, "").trim();
  return `${TITULO[tipo]} — ${limpio || "ubicación por confirmar"}`;
}

/**
 * Devuelve el incidente al que pertenece el evento (existente o nuevo) y lo actualiza.
 * `coords` puede venir del evento (geo) o del vértice; `nodoId` es el vértice del grafo asociado.
 */
export function asignarIncidente(
  e: EstadoSistema,
  x: EventoIngesta,
  tipo: TipoEmergencia,
  opts: { coords?: { lat: number; lon: number }; nodoId?: string; severidad?: Incidente["severidad"]; simulacro?: boolean } = {},
): { incidente: Incidente; nuevo: boolean } {
  e.incidentes = e.incidentes?.length ? e.incidentes : [e.incidente];
  const ahora = Date.now();
  const candidatos = e.incidentes.filter((i) => i.activo && i.tipo === tipo && ahora - new Date(i.ultimoEventoEn ?? i.iniciadoEn).getTime() < VENTANA_MS);
  let elegido: Incidente | undefined;
  if (opts.coords) {
    elegido = candidatos
      .map((i) => ({ i, d: distanciaM(opts.coords!, i.ubicacion) }))
      .filter((c) => c.d <= RADIO_M)
      .sort((a, b) => a.d - b.d)[0]?.i;
  } else if (opts.nodoId) {
    elegido = candidatos.find((i) => i.nodoId === opts.nodoId) ?? candidatos.find((i) => i.eventosIds?.some((id) => e.eventos.find((y) => y.id === id)?.ubicacion === x.ubicacion));
  } else {
    elegido = candidatos.find((i) => x.ubicacion && i.ubicacion.nombre.toLowerCase().includes(x.ubicacion.toLowerCase().split(",")[0])) ?? (candidatos.length === 1 ? candidatos[0] : undefined);
  }
  const nuevo = !elegido;
  if (!elegido) {
    const lugar = x.ubicacion ?? (opts.coords ? `${opts.coords.lat.toFixed(4)}, ${opts.coords.lon.toFixed(4)}` : undefined);
    elegido = {
      id: `Incidencias/${nuevoId("inc")}`,
      titulo: tituloIncidente(tipo, lugar),
      tipo,
      descripcion: `${x.titulo}: ${x.detalle}`.slice(0, 300),
      ubicacion: { nombre: lugar ?? "ubicación por confirmar", lat: opts.coords?.lat ?? e.incidente.ubicacion.lat, lon: opts.coords?.lon ?? e.incidente.ubicacion.lon },
      nodoId: opts.nodoId,
      iniciadoEn: x.timestamp,
      tick: 0,
      fase: "deteccion",
      activo: true,
      severidad: opts.severidad ?? "media",
      ultimoEventoEn: x.timestamp,
      eventosIds: [x.id],
      focosPropuestos: [],
      simulacro: opts.simulacro,
    };
    e.incidentes.unshift(elegido);
    registrar(e, "sistema", `Nuevo incidente: ${elegido.titulo}`, elegido.id);
  } else {
    elegido.ultimoEventoEn = x.timestamp;
    elegido.eventosIds = [...(elegido.eventosIds ?? []), x.id];
    if (opts.severidad && PESO_SEV[opts.severidad] > PESO_SEV[elegido.severidad ?? "baja"]) elegido.severidad = opts.severidad;
    if (!elegido.nodoId && opts.nodoId) elegido.nodoId = opts.nodoId;
    if (elegido.fase === "deteccion" && (elegido.eventosIds?.length ?? 0) >= 2) elegido.fase = "respuesta";
  }
  // El incidente "activo" de la UI: el más grave; a igualdad, el más reciente.
  e.incidente = [...e.incidentes].filter((i) => i.activo).sort((a, b) => PESO_SEV[b.severidad ?? "media"] - PESO_SEV[a.severidad ?? "media"] || (b.ultimoEventoEn ?? b.iniciadoEn).localeCompare(a.ultimoEventoEn ?? a.iniciadoEn))[0] ?? e.incidente;
  return { incidente: elegido, nuevo };
}
