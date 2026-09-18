// Registro y listado de periféricos (poc-07, subagente B).
// Públicas a propósito: el jurado empareja su móvil desde /periferico sin rol ni
// sesión. La reputación y el ritmo de ingesta se controlan en el pipeline.

import { body, fallo, ok } from "@/lib/server/http";
import { listarPerifericos, registrarPeriferico, urlPublica } from "@/lib/server/perifericos/registro";
import type { Capacidad, EstadoPerifericos, PosicionGeo, TipoPeriferico } from "@/lib/tipos-perifericos";

export const dynamic = "force-dynamic";

const TIPOS: readonly TipoPeriferico[] = ["movil_ciudadano", "camara_fija", "efectivo", "pma", "camara_trafico", "sensor", "webhook"];
const CAPACIDADES: readonly Capacidad[] = ["camara", "gps", "microfono", "brujula", "acelerometro", "publicar"];

/** EstadoPerifericos + los dos campos extra que el QR de la consola necesita. */
type RespuestaEstado = EstadoPerifericos & { urlSegura: boolean; origenUrl: "tunel" | "env" | "lan" };

interface CuerpoAlta {
  nombre?: unknown;
  tipo?: unknown;
  capacidades?: unknown;
  posicion?: unknown;
  nodoId?: unknown;
}

function esTipo(x: unknown): x is TipoPeriferico {
  return typeof x === "string" && TIPOS.includes(x as TipoPeriferico);
}

function normalizarCapacidades(x: unknown): Capacidad[] | undefined {
  if (!Array.isArray(x)) return undefined;
  return x.filter((c): c is Capacidad => typeof c === "string" && CAPACIDADES.includes(c as Capacidad));
}

/** Acepta {lat, lon, precisionM?, rumboGrados?, timestamp?} y rellena la hora si falta. */
function normalizarPosicion(x: unknown): PosicionGeo | undefined {
  if (!x || typeof x !== "object") return undefined;
  const p = x as Record<string, unknown>;
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  const precisionM = Number(p.precisionM);
  const rumboGrados = Number(p.rumboGrados);
  return {
    lat,
    lon,
    precisionM: Number.isFinite(precisionM) ? precisionM : undefined,
    rumboGrados: Number.isFinite(rumboGrados) ? ((rumboGrados % 360) + 360) % 360 : undefined,
    timestamp: typeof p.timestamp === "string" && p.timestamp ? p.timestamp : new Date().toISOString(),
  };
}

/** GET /api/perifericos → EstadoPerifericos (+ urlSegura, origenUrl). Lo consume la consola y el QR. */
export async function GET() {
  try {
    const [perifericos, publica] = await Promise.all([listarPerifericos(), urlPublica()]);
    const respuesta: RespuestaEstado = {
      perifericos,
      urlUnion: `${publica.url}/periferico`,
      actualizadoEn: new Date().toISOString(),
      urlSegura: publica.segura,
      origenUrl: publica.origen,
    };
    return ok(respuesta);
  } catch (err) {
    return fallo(err, 500);
  }
}

/** POST /api/perifericos {nombre, tipo, capacidades?, posicion?, nodoId?} → 201 Periferico. */
export async function POST(req: Request) {
  try {
    const b = await body<CuerpoAlta>(req);
    const nombre = typeof b.nombre === "string" ? b.nombre.trim() : "";
    if (!nombre) return fallo("Falta el nombre del periférico", 400);
    if (!esTipo(b.tipo)) return fallo(`Tipo de periférico no válido (esperado uno de: ${TIPOS.join(", ")})`, 400);
    const periferico = await registrarPeriferico({
      nombre,
      tipo: b.tipo,
      capacidades: normalizarCapacidades(b.capacidades),
      posicion: normalizarPosicion(b.posicion),
      nodoId: typeof b.nodoId === "string" && b.nodoId ? b.nodoId : undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return ok(periferico, 201);
  } catch (err) {
    return fallo(err);
  }
}
