// Documentos del grafo de conocimiento: listar y subir. DUEÑO: constructor C.
// POST admite multipart (ficheros .txt/.md) o JSON {nombreArchivo, texto, ambito, territorio}.
import type { NextRequest } from "next/server";
import type { AmbitoDocumento } from "@/lib/dominio/tipos";
import { listarDocumentos, resumenConocimiento } from "@/lib/conocimiento/almacen";
import { ingerirDocumentoDetallado } from "@/lib/conocimiento/ingesta";
import { estadisticasEmbeddings } from "@/lib/ia/embeddings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;
const AMBITOS: AmbitoDocumento[] = ["nacional", "comunidad", "provincia", "municipio", "interno"];

function comoAmbito(v: unknown): AmbitoDocumento {
  return AMBITOS.includes(v as AmbitoDocumento) ? (v as AmbitoDocumento) : "nacional";
}

export async function GET() {
  const [documentos, resumen] = await Promise.all([listarDocumentos(), resumenConocimiento()]);
  return Response.json({ documentos, resumen, embeddings: estadisticasEmbeddings() });
}

export async function POST(peticion: NextRequest) {
  const tipoContenido = peticion.headers.get("content-type") ?? "";
  const entradas: { nombreArchivo: string; texto: string; ambito: AmbitoDocumento; territorio?: string; titulo?: string }[] = [];

  try {
    if (tipoContenido.includes("multipart/form-data")) {
      const formulario = await peticion.formData();
      const ambito = comoAmbito(formulario.get("ambito"));
      const territorio = (formulario.get("territorio") as string | null)?.trim() || undefined;
      for (const valor of formulario.getAll("archivos")) {
        if (!(valor instanceof File)) continue;
        if (!/\.(txt|md|markdown)$/i.test(valor.name)) {
          return Response.json({ error: `«${valor.name}» no es .txt ni .md. Solo se aceptan textos planos.` }, { status: 415 });
        }
        if (valor.size > MAX_BYTES) {
          return Response.json({ error: `«${valor.name}» pesa ${(valor.size / 1048576).toFixed(1)} MB; el máximo son 2 MB.` }, { status: 413 });
        }
        entradas.push({ nombreArchivo: valor.name, texto: await valor.text(), ambito, territorio });
      }
      if (!entradas.length) return Response.json({ error: "No llegó ningún archivo en el campo «archivos»." }, { status: 400 });
    } else {
      const cuerpo = (await peticion.json()) as { nombreArchivo?: string; titulo?: string; texto?: string; ambito?: string; territorio?: string };
      if (!cuerpo.texto?.trim()) return Response.json({ error: "Falta «texto»." }, { status: 400 });
      if (Buffer.byteLength(cuerpo.texto, "utf8") > MAX_BYTES) {
        return Response.json({ error: "El texto supera los 2 MB." }, { status: 413 });
      }
      entradas.push({
        nombreArchivo: cuerpo.nombreArchivo?.trim() || `documento-${Date.now()}.md`,
        titulo: cuerpo.titulo?.trim(),
        texto: cuerpo.texto,
        ambito: comoAmbito(cuerpo.ambito),
        territorio: cuerpo.territorio?.trim() || undefined,
      });
    }
  } catch (e) {
    return Response.json({ error: `Petición mal formada: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }

  const documentos = [];
  const errores: { nombreArchivo: string; error: string }[] = [];
  for (const entrada of entradas) {
    try {
      const r = await ingerirDocumentoDetallado(entrada);
      documentos.push({ ...r.documento, tiempos: r.tiempos });
    } catch (e) {
      errores.push({ nombreArchivo: entrada.nombreArchivo, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (!documentos.length) {
    return Response.json({ error: errores[0]?.error ?? "No se pudo ingerir nada.", errores }, { status: 500 });
  }
  return Response.json({ documentos, errores }, { status: 201 });
}
