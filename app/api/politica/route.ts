// GET/PUT /api/politica · Política de autonomía (quién decide qué). DUEÑO: constructor D.
// Al guardar se REEVALÚA la competencia de las decisiones que siguen vivas, pero NUNCA
// se ejecuta nada retroactivamente: subir la autonomía no dispara lo que estaba pendiente.
import { z } from "zod";
import type { Decision, ModoCompetencia, PoliticaAutonomia, TipoAccion } from "@/lib/dominio/tipos";
import { evaluarCompetencia } from "@/lib/dominio/politica";
import { REGLAS_POR_DEFECTO } from "@/lib/dominio/politica-defecto";
import { obtenerEstado } from "@/lib/motor/estado";
import { emitir } from "@/lib/motor/orquestador";
import { cuerpoValidado, error, json } from "@/lib/motor/respuestas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIPOS = REGLAS_POR_DEFECTO.map((r) => r.tipoAccion) as [TipoAccion, ...TipoAccion[]];

const Esquema = z.object({
  reglas: z
    .array(
      z.object({
        tipoAccion: z.enum(TIPOS),
        modo: z.enum(["autonoma", "supervisada", "humano"]),
        riesgoMinimo: z.number().int().min(0).max(100),
        descripcion: z.string().trim().min(1).max(300),
      }),
    )
    .min(1),
  umbralHumano: z.number().int().min(0).max(100),
  umbralSupervisada: z.number().int().min(0).max(100),
  puntuacionMinimaSupervisor: z.number().int().min(0).max(100),
  nivelGravedadHumano: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  minutosCaducidad: z.number().int().min(1).max(240),
  actualizadaPor: z.string().trim().min(1).max(80),
});

/** Decisiones a las que todavía tiene sentido recalcularles la competencia. */
const VIVAS: Decision["estado"][] = ["propuesta", "pendiente_humano", "escalada"];

export async function GET(): Promise<Response> {
  const estado = obtenerEstado();
  return json({ politica: estado.politica, catalogo: REGLAS_POR_DEFECTO });
}

export async function PUT(peticion: Request): Promise<Response> {
  const { datos, respuesta } = await cuerpoValidado(peticion, Esquema);
  if (respuesta) return respuesta;
  if (datos.umbralSupervisada > datos.umbralHumano) {
    return error("El umbral de supervisión no puede ser mayor que el de decisión humana", 422);
  }

  const estado = obtenerEstado();
  const anterior = estado.politica;
  const nueva: PoliticaAutonomia = {
    reglas: datos.reglas.map((r) => ({ ...r })),
    umbralHumano: datos.umbralHumano,
    umbralSupervisada: datos.umbralSupervisada,
    puntuacionMinimaSupervisor: datos.puntuacionMinimaSupervisor,
    nivelGravedadHumano: datos.nivelGravedadHumano,
    minutosCaducidad: datos.minutosCaducidad,
    actualizadaEn: new Date().toISOString(),
    actualizadaPor: datos.actualizadaPor,
  };
  estado.politica = nueva;
  estado.tocar();

  // Reevaluación SIN efectos: solo cambia quién tiene que decidir, nunca ejecuta.
  const recalculadas: { id: string; de: ModoCompetencia; a: ModoCompetencia }[] = [];
  for (const d of [...estado.decisiones.values()]) {
    if (!VIVAS.includes(d.estado)) continue;
    const incendio = d.incendioId ? estado.incendios.get(d.incendioId) : undefined;
    const { competencia, riesgo } = evaluarCompetencia(d, nueva, incendio);
    if (competencia === d.competencia && riesgo === d.riesgo) continue;
    const nuevoEstado: Decision["estado"] = competencia === "autonoma" ? d.estado : d.estado === "propuesta" ? "propuesta" : "pendiente_humano";
    estado.actualizar(estado.decisiones, d.id, { competencia, riesgo, estado: nuevoEstado });
    recalculadas.push({ id: d.id, de: d.competencia, a: competencia });
  }

  const cambios: string[] = [];
  for (const r of nueva.reglas) {
    const previa = anterior.reglas.find((x) => x.tipoAccion === r.tipoAccion);
    if (previa && previa.modo !== r.modo) cambios.push(`${r.tipoAccion}: ${previa.modo} → ${r.modo}`);
  }
  if (anterior.umbralHumano !== nueva.umbralHumano) cambios.push(`umbral humano ${anterior.umbralHumano} → ${nueva.umbralHumano}`);
  if (anterior.umbralSupervisada !== nueva.umbralSupervisada) cambios.push(`umbral supervisión ${anterior.umbralSupervisada} → ${nueva.umbralSupervisada}`);
  if (anterior.nivelGravedadHumano !== nueva.nivelGravedadHumano) cambios.push(`nivel humano ${anterior.nivelGravedadHumano} → ${nueva.nivelGravedadHumano}`);
  if (anterior.minutosCaducidad !== nueva.minutosCaducidad) cambios.push(`caducidad ${anterior.minutosCaducidad} → ${nueva.minutosCaducidad} min`);

  emitir("humano", `${datos.actualizadaPor} cambia la política de autonomía${cambios.length ? `: ${cambios.join("; ")}` : ""}. ${recalculadas.length} decisión(es) recalculadas.`, {
    nivel: "aviso",
    datos: { cambios, recalculadas },
  });

  return json({ politica: nueva, cambios, recalculadas });
}
