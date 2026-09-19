// GET /api/estado/stream · Estado en vivo por SSE. DUEÑO: constructor A.
// `event: estado` con el Snapshot completo (uno inmediato y luego uno por
// cada cambio de versión, como mucho cada 400 ms) y `event: latido` cada 15 s
// para que ningún proxy corte la conexión por inactividad.
import type { NextRequest } from "next/server";
import { obtenerEstado, type Estado } from "@/lib/motor/estado";
import { arrancarOrquestador } from "@/lib/motor/orquestador";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ESPERA_MS = 400;
const LATIDO_MS = 15_000;

export async function GET(peticion: NextRequest): Promise<Response> {
  arrancarOrquestador();
  const codificador = new TextEncoder();

  let cerrado = false;
  let desuscribir: (() => void) | undefined;
  let latido: ReturnType<typeof setInterval> | undefined;
  let pendiente: ReturnType<typeof setTimeout> | undefined;
  let ultimaVersion = -1;
  let suscritoA: Estado | undefined;

  const flujo = new ReadableStream<Uint8Array>({
    start(control) {
      const cerrar = () => {
        if (cerrado) return;
        cerrado = true;
        desuscribir?.();
        if (latido) clearInterval(latido);
        if (pendiente) clearTimeout(pendiente);
        try { control.close(); } catch { /* ya cerrado por el cliente */ }
      };

      const enviar = (evento: string, datos: unknown) => {
        if (cerrado) return;
        try {
          control.enqueue(codificador.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`));
        } catch {
          cerrar();
        }
      };

      const enviarEstado = () => {
        const s = obtenerEstado().snapshot();
        ultimaVersion = s.version;
        enviar("estado", s);
      };

      /** Se re-suscribe si el proceso ha cambiado de Estado (ejecución nueva). */
      const asegurarSuscripcion = () => {
        const actual = obtenerEstado();
        if (suscritoA === actual) return;
        desuscribir?.();
        suscritoA = actual;
        desuscribir = actual.suscribir(() => {
          if (cerrado || pendiente) return;
          pendiente = setTimeout(() => {
            pendiente = undefined;
            if (!cerrado && obtenerEstado().version !== ultimaVersion) enviarEstado();
          }, ESPERA_MS);
        });
      };

      enviarEstado(); // primer estado, sin esperar a ningún cambio
      asegurarSuscripcion();

      latido = setInterval(() => {
        asegurarSuscripcion();
        enviar("latido", { en: new Date().toISOString(), version: obtenerEstado().version });
      }, LATIDO_MS);

      peticion.signal.addEventListener("abort", cerrar);
    },
    cancel() {
      cerrado = true;
      desuscribir?.();
      if (latido) clearInterval(latido);
      if (pendiente) clearTimeout(pendiente);
    },
  });

  return new Response(flujo, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
