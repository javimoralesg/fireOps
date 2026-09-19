// GET /api/estado/stream · Estado en vivo por SSE. DUEÑO: constructor A.
// `event: estado` con el Snapshot completo (uno inmediato al conectar y luego,
// como mucho, uno cada 2 s por conexión: al cerrarse la ventana siempre sale la
// ÚLTIMA versión, nunca una intermedia) y `event: latido` cada 15 s para que
// ningún proxy corte la conexión por inactividad.
//
// Rendimiento (constructor P): el Snapshot se serializa UNA vez por versión en
// `estado.snapshotTexto()`; todas las pestañas comparten esa misma cadena, así
// que abrir diez conexiones no multiplica el `JSON.stringify` de megas.
import type { NextRequest } from "next/server";
import { obtenerEstado, type Estado } from "@/lib/motor/estado";
import { arrancarOrquestador } from "@/lib/motor/orquestador";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mínimo entre dos `event: estado` a un mismo cliente. */
const ESPERA_MS = 2000;
const LATIDO_MS = 15_000;

export async function GET(peticion: NextRequest): Promise<Response> {
  arrancarOrquestador();
  const codificador = new TextEncoder();

  let cerrado = false;
  let desuscribir: (() => void) | undefined;
  let latido: ReturnType<typeof setInterval> | undefined;
  let pendiente: ReturnType<typeof setTimeout> | undefined;
  let ultimaVersion = -1;
  let ultimoEnvio = 0;
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

      const enviarTexto = (evento: string, datos: string) => {
        if (cerrado) return;
        try {
          control.enqueue(codificador.encode(`event: ${evento}\ndata: ${datos}\n\n`));
        } catch {
          cerrar();
        }
      };

      const enviarEstado = () => {
        const estado = obtenerEstado();
        ultimaVersion = estado.version;
        ultimoEnvio = Date.now();
        enviarTexto("estado", estado.snapshotTexto());
      };

      /** Envía ya si ha pasado la ventana; si no, programa el envío de la última versión. */
      const programarEnvio = () => {
        if (cerrado || obtenerEstado().version === ultimaVersion) return;
        const resto = ESPERA_MS - (Date.now() - ultimoEnvio);
        if (resto <= 0) {
          if (pendiente) { clearTimeout(pendiente); pendiente = undefined; }
          enviarEstado();
          return;
        }
        if (pendiente) return; // ya hay una ventana abierta: saldrá la versión final
        pendiente = setTimeout(() => {
          pendiente = undefined;
          if (!cerrado && obtenerEstado().version !== ultimaVersion) enviarEstado();
        }, resto);
      };

      /** Se re-suscribe si el proceso ha cambiado de Estado (ejecución nueva). */
      const asegurarSuscripcion = () => {
        const actual = obtenerEstado();
        if (suscritoA === actual) return;
        desuscribir?.();
        suscritoA = actual;
        // El argumento del suscriptor no se lee a propósito: así el Snapshot no
        // se materializa hasta que toca enviarlo de verdad.
        desuscribir = actual.suscribir(() => programarEnvio());
      };

      enviarEstado(); // primer estado inmediato, sin esperar a ningún cambio
      asegurarSuscripcion();

      latido = setInterval(() => {
        asegurarSuscripcion();
        enviarTexto("latido", JSON.stringify({ en: new Date().toISOString(), version: obtenerEstado().version }));
        programarEnvio(); // red de seguridad por si se perdió algún aviso
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
