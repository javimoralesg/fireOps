// POST /api/incidencias/[id]/informe · Informe EN VIVO de una sola incidencia.
// Acta determinista siempre (situación, cronología de comunicaciones con su
// resultado real, decisiones y estados, unidades, poblaciones y actas) más
// narrativa de IA si el proveedor responde a tiempo. Se guarda en el estado
// (y por tanto viaja por SSE) y se devuelve el Markdown completo.
// DUEÑO: constructor G. Petición de Javi (2026-09-19).
import type { Evento, TipoEvento } from "@/lib/dominio/tipos";
import type { ContextoAgente } from "@/lib/motor/contratos";
import { obtenerEstado, type Estado } from "@/lib/motor/estado";
import { error, json, mensajeDeError } from "@/lib/motor/respuestas";
import { informeSituacionIncendio } from "@/lib/agentes/informes/redactor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Contexto mínimo para el redactor, sin depender del orquestador. */
function contextoDe(estado: Estado, agenteId: string): ContextoAgente {
  return {
    estado,
    snapshot: estado.snapshot(),
    ahoraMundo: estado.reloj.ahoraMundo,
    minutosMundoDesdeUltimoCiclo: 0,
    registrar: (tipo: TipoEvento, mensaje: string, extra?: Partial<Pick<Evento, "incendioId" | "nivel" | "datos">>) => {
      estado.registrarEvento(tipo, mensaje, { ...extra, agenteId });
    },
    informarTarea: () => {},
    lecciones: [],
    // 60 s de margen: la narrativa ya se corta sola a los 20 s dentro del redactor.
    abortSignal: AbortSignal.timeout(60_000),
  };
}

export async function POST(_peticion: Request, contexto: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await contexto.params;
  const estado = obtenerEstado();
  const incendio = estado.incendios.get(id);
  if (!incendio) return error(`No hay ninguna incidencia con id ${id}`, 404);

  try {
    const informe = await informeSituacionIncendio(incendio, contextoDe(estado, "redactor"));
    // Guardarlo en el estado lo hace visible en /informes, en la auditoría y por SSE.
    estado.guardar(estado.informes, informe);
    estado.registrarEvento("sistema", `Informe en vivo de «${incendio.nombre}» generado a petición del mando.`, {
      agenteId: "redactor",
      incendioId: incendio.id,
      nivel: "info",
      datos: { informeId: informe.id, huella: informe.huella, conNarrativaIA: informe.conNarrativaIA },
    });
    return json({
      informe: { ...informe, contenido: undefined },
      informeId: informe.id,
      titulo: informe.titulo,
      conNarrativaIA: informe.conNarrativaIA,
      modelo: informe.modelo,
      huella: informe.huella,
      markdown: informe.contenido,
    });
  } catch (e) {
    return error(`No se ha podido generar el informe en vivo: ${mensajeDeError(e)}`, 500);
  }
}
