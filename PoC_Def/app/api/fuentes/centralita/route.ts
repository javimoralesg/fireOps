// POST /api/fuentes/centralita · DIAGNÓSTICO de la centralita. DUEÑO: B.
// Permite probar `procesarEntrada` sin depender de los webhooks de HappyRobot
// o Telegram (que expone el constructor D en /api/ingesta y /api/webhooks).
// Cuerpo: {canal?: "llamada"|"sms"|"email"|"telegram"|"web", texto, remitente?, lat?, lon?}
// GET  /api/fuentes/centralita?lugar=...  ó  ?lat&lon → contexto para el agente de voz.
import { contextoParaVoz, procesarEntrada, type CanalEntrada } from "@/lib/agentes/percepcion/centralita";

export const dynamic = "force-dynamic";

/** Número de un parámetro; NaN si no viene (ojo: Number(null) es 0). */
function num(url: URL, nombre: string, porDefecto = NaN): number {
  const v = url.searchParams.get(nombre);
  return v === null || v.trim() === "" ? porDefecto : Number(v);
}


const CANALES: CanalEntrada[] = ["llamada", "sms", "email", "telegram", "web"];

export async function POST(peticion: Request) {
  let cuerpo: { canal?: string; texto?: string; remitente?: string; lat?: number; lon?: number; referenciaExterna?: string };
  try {
    cuerpo = (await peticion.json()) as typeof cuerpo;
  } catch {
    return Response.json({ error: "Cuerpo JSON no válido" }, { status: 400 });
  }
  if (!cuerpo.texto?.trim()) return Response.json({ error: "Falta el campo `texto`" }, { status: 400 });
  const canal = (CANALES.includes(cuerpo.canal as CanalEntrada) ? cuerpo.canal : "web") as CanalEntrada;
  try {
    const observacion = await procesarEntrada({
      canal,
      texto: cuerpo.texto,
      remitente: cuerpo.remitente,
      referenciaExterna: cuerpo.referenciaExterna,
      punto: typeof cuerpo.lat === "number" && typeof cuerpo.lon === "number" ? { lat: cuerpo.lat, lon: cuerpo.lon } : undefined,
    });
    return Response.json({ observacion });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function GET(peticion: Request) {
  const url = new URL(peticion.url);
  const lat = num(url, "lat");
  const lon = num(url, "lon");
  const lugar = url.searchParams.get("lugar");
  const referencia = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : (lugar ?? "");
  if (!referencia) return Response.json({ error: "Indica ?lat&lon o ?lugar" }, { status: 400 });
  try {
    return Response.json(await contextoParaVoz(referencia));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
