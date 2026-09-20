// GET/POST /api/comunicados · Portal ciudadano. DUEÑO: constructor D.
// GET público: solo los publicados (salvo ?todos=1, que usa la sala de mando).
// POST: comunicado escrito a mano por el portavoz humano; queda pendiente de publicar
// salvo que se pida publicar=true (entonces se ejecuta como decisión humana).
import { z } from "zod";
import type { Comunicado } from "@/lib/dominio/tipos";
import { obtenerEstado } from "@/lib/motor/estado";
import { nuevoId } from "@/lib/motor/ids";
import { cuerpoValidado, error, json, mensajeDeError } from "@/lib/motor/respuestas";
import { decisionManual } from "@/lib/agentes/ejecucion/orden-manual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Esquema = z.object({
  titulo: z.string().trim().min(3).max(200),
  cuerpo: z.string().trim().min(10).max(8000),
  incendioId: z.string().trim().optional(),
  canales: z.array(z.enum(["portal", "sms", "email", "rrss", "telegram"])).optional(),
  quien: z.string().trim().min(1).max(80),
  publicar: z.boolean().optional(),
});

export async function GET(peticion: Request): Promise<Response> {
  const url = new URL(peticion.url);
  const todos = url.searchParams.get("todos") === "1";
  const incendioId = url.searchParams.get("incendioId")?.trim();

  const estado = obtenerEstado();
  let comunicados = [...estado.comunicados.values()];
  if (!todos) comunicados = comunicados.filter((c) => c.estado === "publicado");
  if (incendioId) comunicados = comunicados.filter((c) => c.incendioId === incendioId);
  comunicados.sort((a, b) => (b.publicadoEn ?? b.id).localeCompare(a.publicadoEn ?? a.id));

  return json({
    comunicados,
    // Contexto mínimo para el portal: focos activos con su estado y su municipio.
    focos: estado.incendiosActivos().map((i) => ({
      id: i.id,
      nombre: i.nombre,
      municipio: i.municipio,
      provincia: i.provincia,
      estado: i.estado,
      nivelGravedad: i.nivelGravedad,
      areaHa: i.areaHa,
      centro: i.centro,
      perimetro: i.perimetro,
      actualizadoEn: i.actualizadoEn,
    })),
  });
}

export async function POST(peticion: Request): Promise<Response> {
  const { datos, respuesta } = await cuerpoValidado(peticion, Esquema);
  if (respuesta) return respuesta;

  const estado = obtenerEstado();
  if (datos.incendioId && !estado.incendios.get(datos.incendioId)) return error(`No hay ningún incendio con id ${datos.incendioId}`, 404);

  const comunicado: Comunicado = {
    id: nuevoId("com"),
    ejecucionId: estado.ejecucion.id,
    incendioId: datos.incendioId,
    titulo: datos.titulo,
    cuerpo: datos.cuerpo,
    canales: (datos.canales ?? ["portal"]) as Comunicado["canales"],
    estado: datos.publicar ? "pendiente_aprobacion" : "borrador",
  };
  estado.guardar(estado.comunicados, comunicado);

  if (!datos.publicar) return json({ comunicado }, 201);

  try {
    const decision = await decisionManual({
      quien: datos.quien,
      incendioId: datos.incendioId,
      titulo: `Publicar comunicado: ${datos.titulo}`,
      razonamiento: `${datos.quien} redacta y publica el comunicado directamente desde la sala.`,
      acciones: [{ tipo: "publicar_comunicado", descripcion: `Publicar "${datos.titulo}"`, parametros: { comunicadoId: comunicado.id } }],
    });
    return json({ comunicado: estado.comunicados.get(comunicado.id), decision }, 201);
  } catch (e) {
    return error(`El comunicado se guardó pero no se pudo publicar: ${mensajeDeError(e)}`, 500, { comunicado });
  }
}
