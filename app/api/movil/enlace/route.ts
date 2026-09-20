// GET /api/movil/enlace · URL que debe llevar el QR de "Unir un móvil" y si responde.
// La sala guarda la última URL pública (data/url-publica.txt, la escribe scripts/tunel.sh);
// si el túnel se cerró sin limpiar, esa URL está muerta y un QR hacia ella no lleva a
// ninguna parte. Aquí se comprueba de verdad, pidiendo /api/salud a la propia URL pública.
// DUEÑO: sesión fireops-2a (móvil por QR). Dependencias: lib/motor/entorno, lib/motor/respuestas.
import { origenUrlPublica, urlPublica } from "@/lib/motor/entorno";
import { json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type EnlaceMovil = {
  /** URL pública sin barra final, o null si no hay ninguna configurada. */
  url: string | null;
  origen: "tunel" | "variable_entorno" | "sin_configurar";
  /** true si la URL pública responde ahora mismo; false si el túnel está caído. */
  viva: boolean;
  /** Por qué no está viva, redactado para enseñarlo en la sala. */
  motivo?: string;
};

const TIEMPO_MAX_MS = 6000;

export async function GET(): Promise<Response> {
  const url = urlPublica() ?? null;
  const origen = origenUrlPublica();
  if (!url) {
    return json({ url, origen, viva: false, motivo: "No hay URL pública: arranca scripts/tunel.sh." } satisfies EnlaceMovil);
  }
  if (!/^https:\/\//.test(url)) {
    return json({ url, origen, viva: false, motivo: "La URL pública no es HTTPS." } satisfies EnlaceMovil);
  }
  try {
    const r = await fetch(`${url}/api/salud`, { cache: "no-store", signal: AbortSignal.timeout(TIEMPO_MAX_MS) });
    if (r.ok) return json({ url, origen, viva: true } satisfies EnlaceMovil);
    return json({ url, origen, viva: false, motivo: `La URL pública responde ${r.status}: el túnel no llega a esta app.` } satisfies EnlaceMovil);
  } catch (e) {
    const codigo = (e as { cause?: { code?: string } }).cause?.code;
    const motivo =
      codigo === "ENOTFOUND"
        ? "el túnel guardado ya no existe (su dominio no resuelve): cloudflared se cerró."
        : e instanceof Error && e.name === "TimeoutError"
          ? "la URL pública no contesta (tiempo agotado)."
          : `la URL pública no contesta: ${e instanceof Error ? e.message : String(e)}`;
    return json({ url, origen, viva: false, motivo } satisfies EnlaceMovil);
  }
}
