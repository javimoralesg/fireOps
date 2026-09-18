// Verificación de observaciones (poc-07): duplicados por geo+tiempo+similitud,
// contenido reciclado con Exa y ponderación por la reputación del periférico.
// Devuelve `undefined` cuando no hay nada que objetar: así el router del motor
// (router.ts) aplica su propia verificación en vez de quedar bloqueado.

import type { EventoIngesta, Verificacion } from "../../types";
import type { Periferico } from "../../tipos-perifericos";
import type { EstadoSistema } from "../../tipos-sistema";
import { distanciaM } from "../../../components/mapa/geo";
import { detectarReciclado, exaDisponible } from "../conectores/exa";

const RADIO_DUPLICADO_M = 150;
const VENTANA_DUPLICADO_MS = 10 * 60_000;
const SIMILITUD_DUPLICADO = 0.5;

/** Bulos típicos que, sin fuente que los corrobore, se marcan sospechosos. */
const PATRON_ALARMISTA = /(explosi[oó]n qu[ií]mica|evacuan todo|evac[uú]an todo|bomba|atentado|fuga radiactiva|colapso total)/i;

export interface ResultadoVerificacion {
  verificacion?: Verificacion;
  confianza: number; // confianza del evento ya ponderada por la reputación del periférico
  veredicto: "fiable" | "dudosa" | "falsa";
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .match(/[a-z0-9]{4,}/g) ?? [],
  );
}

/** Similitud de Jaccard asimétrica (igual criterio que router.ts y exa.ts). */
export function similitud(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

/** Reputación del periférico: entre el 60 % y el 100 % de la confianza observada. */
export function ponderarPorReputacion(confianza: number, periferico: Periferico): number {
  const r = Math.min(1, Math.max(0, periferico.confianza ?? 0.7));
  return Math.round(Math.min(1, Math.max(0, confianza)) * (0.6 + 0.4 * r) * 100) / 100;
}

function duplicado(evento: EventoIngesta, estado: EstadoSistema): EventoIngesta | undefined {
  if (!evento.geo) return undefined;
  const t = new Date(evento.timestamp).getTime();
  return estado.eventos.find((p) => {
    if (p.id === evento.id || !p.geo) return false;
    if (Math.abs(t - new Date(p.timestamp).getTime()) > VENTANA_DUPLICADO_MS) return false;
    if (distanciaM([evento.geo!.lat, evento.geo!.lon], [p.geo!.lat, p.geo!.lon]) > RADIO_DUPLICADO_M) return false;
    const mismaCategoria = Boolean(evento.categoria && p.categoria && evento.categoria === p.categoria);
    return mismaCategoria || similitud(`${p.titulo} ${p.detalle}`, `${evento.titulo} ${evento.detalle}`) >= SIMILITUD_DUPLICADO;
  });
}

/**
 * Verifica una observación ya convertida en evento.
 * @param textual true para texto/voz/publicación (activa la comprobación de contenido reciclado).
 */
export async function verificarObservacion(
  evento: EventoIngesta,
  estado: EstadoSistema,
  periferico: Periferico,
  opciones: { textual?: boolean } = {},
): Promise<ResultadoVerificacion> {
  const confianza = ponderarPorReputacion(evento.confianza, periferico);

  const dup = duplicado(evento, estado);
  if (dup) {
    return {
      verificacion: { estado: "duplicado", motivo: `Mismo lugar (< ${RADIO_DUPLICADO_M} m) y contenido que ${dup.id} hace ${Math.round((Date.now() - new Date(dup.timestamp).getTime()) / 1000)} s`, duplicaDe: dup.id },
      confianza,
      veredicto: "dudosa",
    };
  }

  const texto = `${evento.titulo} ${evento.detalle}`;
  if (opciones.textual) {
    if (exaDisponible()) {
      try {
        const r = await detectarReciclado(evento.titulo, evento.detalle);
        if (r.sospechoso) return { verificacion: { estado: "sospechoso", motivo: r.motivo ?? "Exa: contenido ya publicado antes del incidente" }, confianza, veredicto: "falsa" };
      } catch (err) {
        console.warn("[verificacion/exa]", err instanceof Error ? err.message : err);
      }
    } else if (PATRON_ALARMISTA.test(texto) && (periferico.confianza ?? 0.7) < 0.5) {
      return { verificacion: { estado: "sospechoso", motivo: "Mensaje alarmista de un periférico con reputación baja y sin fuente que lo corrobore" }, confianza, veredicto: "falsa" };
    }
  }

  return { confianza, veredicto: "fiable" };
}
