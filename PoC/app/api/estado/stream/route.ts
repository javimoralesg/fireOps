import { obtenerEstado } from "@/lib/server/motor";
import { suscribir } from "@/lib/server/estado";

export const dynamic = "force-dynamic";

/**
 * GET /api/estado/stream — Server-Sent Events.
 *   event: estado  → EstadoSistema completo (al conectar y en cada cambio, con coalescing de 150 ms)
 *   event: ping    → cada 15 s (keep-alive)
 * La UI usa EventSource y cae al polling de /api/estado si el stream falla.
 */
export async function GET(req: Request) {
  const enc = new TextEncoder();
  let cancelar: (() => void) | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  let pendiente: ReturnType<typeof setTimeout> | undefined;
  let cerrado = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const enviar = (evento: string, datos: unknown) => {
        if (cerrado) return;
        try {
          ctrl.enqueue(enc.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`));
        } catch {
          cerrado = true;
        }
      };
      const emitirEstado = async () => {
        try {
          enviar("estado", await obtenerEstado());
        } catch (err) {
          enviar("error", { error: err instanceof Error ? err.message : String(err) });
        }
      };
      await emitirEstado();
      cancelar = suscribir(() => {
        if (pendiente) clearTimeout(pendiente);
        pendiente = setTimeout(emitirEstado, 150); // agrupa ráfagas de cambios
      });
      ping = setInterval(() => enviar("ping", { t: Date.now() }), 15000);
      req.signal.addEventListener("abort", () => {
        cerrado = true;
        cancelar?.();
        if (ping) clearInterval(ping);
        if (pendiente) clearTimeout(pendiente);
        try {
          ctrl.close();
        } catch {
          /* ya cerrado */
        }
      });
    },
    cancel() {
      cerrado = true;
      cancelar?.();
      if (ping) clearInterval(ping);
      if (pendiente) clearTimeout(pendiente);
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
