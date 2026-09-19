// GET/POST /api/ejecucion · Ciclo de vida de una ejecución. DUEÑO: constructor A.
// { accion: "nueva" | "cerrar" | "fuentes", nombre?, fuentesDesactivadas?, quien? }
//   · "nueva": ejecución limpia; hereda las fuentes apagadas salvo que se manden.
//   · "fuentes": apaga/enciende fuentes de detección de la ejecución activa
//     (lista completa de apagadas; [] = operación real). Ver lib/motor/escenario.ts.
import { z } from "zod";
import { obtenerEstado } from "@/lib/motor/estado";
import { cambiarFuentesDesactivadas } from "@/lib/motor/escenario";
import { arrancarOrquestador, cerrarEjecucion, consolidarMetricas, nuevaEjecucion, redactarPostmortem } from "@/lib/motor/orquestador";
import { cuerpoValidado, error, json, mensajeDeError } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Esquema = z.object({
  accion: z.enum(["nueva", "cerrar", "fuentes"]),
  nombre: z.string().trim().max(120).optional(),
  /** Fuentes de detección apagadas (catálogo en lib/dominio/fuentes-deteccion.ts). */
  fuentesDesactivadas: z.array(z.enum(["satelite", "prensa_redes", "camaras_fijas", "avisos_ciudadanos"])).max(4).optional(),
  quien: z.string().trim().max(80).optional(),
});

export async function GET(): Promise<Response> {
  const estado = obtenerEstado();
  let anteriores: unknown[] = [];
  try {
    const { listarEjecuciones } = await import("@/lib/db/repositorio");
    anteriores = await listarEjecuciones(20);
  } catch {
    anteriores = []; // sin base de datos solo existe la ejecución en memoria
  }
  return json({ ejecucion: estado.ejecucion, anteriores });
}

export async function POST(peticion: Request): Promise<Response> {
  const { datos, respuesta } = await cuerpoValidado(peticion, Esquema);
  if (respuesta) return respuesta;
  arrancarOrquestador();

  try {
    if (datos.accion === "fuentes") {
      if (!datos.fuentesDesactivadas) return error("Falta `fuentesDesactivadas` (lista de fuentes apagadas; vacía = operación real)", 400);
      const r = await cambiarFuentesDesactivadas(obtenerEstado(), datos.fuentesDesactivadas, datos.quien ?? "sala de mando");
      return json({ ejecucion: r.ejecucion, cambiado: r.cambiado });
    }
    if (datos.accion === "cerrar") {
      const estado = obtenerEstado();
      if (estado.ejecucion.estado === "cerrada") {
        if (estado.ejecucion.postmortemInformeId) return error("La ejecución ya está cerrada y tiene su post-mortem en Informes", 409);
        // Cerrada pero sin post-mortem (el redactor falló en el cierre): se genera ahora.
        await redactarPostmortem();
        try {
          const { guardarEjecucion } = await import("@/lib/db/repositorio");
          await guardarEjecucion(obtenerEstado().ejecucion);
        } catch {
          // sin base de datos el post-mortem queda en memoria
        }
        return json({ ejecucion: obtenerEstado().ejecucion });
      }
      await cerrarEjecucion();
      return json({ ejecucion: obtenerEstado().ejecucion });
    }
    const nuevo = await nuevaEjecucion(datos.nombre, datos.fuentesDesactivadas);
    consolidarMetricas(nuevo);
    return json({ ejecucion: nuevo.ejecucion, agentes: nuevo.agentes.size }, 201);
  } catch (e) {
    const verbo = datos.accion === "nueva" ? "crear" : datos.accion === "fuentes" ? "cambiar las fuentes de" : "cerrar";
    return error(`No se pudo ${verbo} la ejecución: ${mensajeDeError(e)}`, 500);
  }
}
