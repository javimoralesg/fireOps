// GET /api/decisiones · Lista de decisiones con filtros. DUEÑO: constructor D.
//
// TAMAÑO (constructor T, 2026-09-19): esta ruta llegó a devolver 742 KB en una
// sola respuesta (200 decisiones con `fundamentos` —citas legales completas— e
// `historial`). El límite por defecto pasa a 50 y se añade la proyección
// `?campos=resumen`, que se queda con los 3 fundamentos más parecidos, recorta
// sus citas a 200 caracteres y deja fuera historial, evidencias y evaluación
// (medido: 13.801 B → 6.112 B, un 56 % menos). El detalle ÍNTEGRO está en
// /api/decisiones/[id] —ruta creada en la misma pasada, porque no existía— y en
// /api/auditoria/exportar. Cada decisión recortada lo dice en `recortado`.
import type { Decision } from "@/lib/dominio/tipos";
import { obtenerEstado } from "@/lib/motor/estado";
import { json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITE_POR_DEFECTO = 50;
const LIMITE_MAXIMO = 500;
/** Longitud de las citas legales en la vista de resumen. */
const CITA_MAX = 200;
/**
 * Fundamentos que viajan en el resumen. MEDIDO (constructor T): `fundamentos`
 * es el 62 % del peso de una decisión (7,6 KB de 12,2 KB), y recortar solo la
 * cita apenas quitaba el 15 %. En un listado basta con las citas MÁS PARECIDAS;
 * las demás se cuentan en `recortado.fundamentosTotales` y están enteras en
 * /api/decisiones/[id], así que no se oculta que existen.
 */
const FUNDAMENTOS_MAX = 3;

/** Decisión sin las partes pesadas: para listados y para la sala de mando. */
function resumir(d: Decision) {
  const resto: Partial<Decision> = { ...d };
  delete resto.historial;
  delete resto.evidencias;
  delete resto.evaluacion;
  delete resto.decisionesPrevias;
  return {
    ...resto,
    fundamentos: [...(d.fundamentos ?? [])]
      .sort((a, b) => b.similitud - a.similitud)
      .slice(0, FUNDAMENTOS_MAX)
      .map((f) => ({
        ...f,
        cita: f.cita.length > CITA_MAX ? `${f.cita.slice(0, CITA_MAX)}…` : f.cita,
      })),
    // Se dice lo que se ha recortado para que nadie lo tome por ausencia de datos.
    recortado: {
      campos: "resumen",
      citasA: CITA_MAX,
      fundamentosTotales: d.fundamentos?.length ?? 0,
      fundamentosDevueltos: Math.min(FUNDAMENTOS_MAX, d.fundamentos?.length ?? 0),
      sinHistorial: (d.historial?.length ?? 0) > 0,
      sinEvidencias: (d.evidencias?.length ?? 0) > 0,
      sinEvaluacion: !!d.evaluacion,
      detalle: `/api/decisiones/${d.id}`,
    },
  };
}

export async function GET(peticion: Request): Promise<Response> {
  const url = new URL(peticion.url);
  const incendioId = url.searchParams.get("incendioId")?.trim();
  const estadoFiltro = url.searchParams.get("estado")?.trim();
  const agenteId = url.searchParams.get("agenteId")?.trim();
  const campos = url.searchParams.get("campos")?.trim();
  const limite = Math.min(LIMITE_MAXIMO, Math.max(1, Number(url.searchParams.get("limite") ?? LIMITE_POR_DEFECTO)));

  const estado = obtenerEstado();
  let decisiones = [...estado.decisiones.values()];
  if (incendioId) decisiones = decisiones.filter((d) => d.incendioId === incendioId);
  if (estadoFiltro) decisiones = decisiones.filter((d) => d.estado === estadoFiltro);
  if (agenteId) decisiones = decisiones.filter((d) => d.agenteId === agenteId);
  decisiones.sort((a, b) => b.creadaEn.localeCompare(a.creadaEn));

  const pagina = decisiones.slice(0, limite);
  return json({
    total: decisiones.length,
    devueltas: pagina.length,
    limite,
    campos: campos === "resumen" ? "resumen" : "completo",
    pendientesHumano: estado.decisionesPendientesHumano().length,
    decisiones: campos === "resumen" ? pagina.map(resumir) : pagina,
  });
}
