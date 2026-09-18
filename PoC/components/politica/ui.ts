// Constantes visuales y ayudas de presentación de la política de autonomía.
// La lógica (catálogo, clasificación, veredicto) vive en lib/politica-autonomia.ts.

import { Bot, Lock, PenLine, type LucideIcon } from "lucide-react";
import { evaluarCompetencia, firmaRequerida, type CategoriaAccion, type ModoCompetencia, type PoliticaAutonomia, type VeredictoCompetencia } from "@/lib/politica-autonomia";
import { puede, ROLES, ROLES_LISTA, type DefinicionRol, type RolId } from "@/lib/roles";
import type { Decision } from "@/lib/tipos-sistema";

export const MODO_UI: Record<
  ModoCompetencia,
  { etiqueta: string; titulo: string; descripcion: string; icono: LucideIcon; pildora: string; color: string; tinte: string }
> = {
  autonoma: {
    etiqueta: "IA autónoma",
    titulo: "La IA decide y ejecuta sola",
    descripcion: "Si además el riesgo no supera el umbral de autonomía. Queda registrada igual en la timeline, el acta y la auditoría.",
    icono: Bot,
    pildora: "pildora pildora-exito",
    color: "text-success",
    tinte: "border-success/30 bg-success/10",
  },
  supervisada: {
    etiqueta: "Firma humana",
    titulo: "La IA propone; firma una persona",
    descripcion: "La IA prepara el plan completo y solo se ejecuta cuando lo firma un rol con autoridad suficiente para ese riesgo.",
    icono: PenLine,
    pildora: "pildora pildora-marca",
    color: "text-brand",
    tinte: "border-brand/30 bg-brand/10",
  },
  humano: {
    etiqueta: "Reservada a personas",
    titulo: "La IA nunca ejecuta",
    descripcion: "La IA reúne evidencia, opciones y riesgos, pero la decisión y la orden son humanas, sea cual sea el riesgo estimado.",
    icono: Lock,
    pildora: "pildora pildora-aviso",
    color: "text-warning",
    tinte: "border-warning/30 bg-warning/10",
  },
};

/** Roles que pueden firmar decisiones, de menos a más autoridad. */
export const ROLES_FIRMA: DefinicionRol[] = ROLES_LISTA.filter((r) => puede(r.id, "decidir")).sort((a, b) => a.riesgoMaxDecision - b.riesgoMaxDecision);

/**
 * Veredicto de una decisión: el que guardó el motor al crearla (Decision.competencia,
 * cuando poc-55 lo integre) o, si no existe, el calculado en cliente con la política vigente.
 */
export function veredictoDe(d: Decision, politica: PoliticaAutonomia, umbral: number): { veredicto: VeredictoCompetencia; origen: "motor" | "cliente" } {
  const guardado = (d as Decision & { competencia?: VeredictoCompetencia }).competencia;
  if (guardado && typeof guardado === "object" && guardado.modo in MODO_UI) return { veredicto: guardado, origen: "motor" };
  return { veredicto: evaluarCompetencia(d, politica, umbral), origen: "cliente" };
}

/** Quién gestiona una categoría con el umbral actual (columna "Quién la gestiona" de la matriz). */
export function gestionDeCategoria(c: CategoriaAccion, umbral: number): { modo: ModoCompetencia; firma: RolId | null; texto: string; nota?: string } {
  const firma = firmaRequerida(c.riesgoMinimo, c.firmaMinima);
  if (c.modo === "humano") return { modo: "humano", firma, texto: `Persona · ${ROLES[firma].nombre}` };
  if (c.modo === "supervisada") return { modo: "supervisada", firma, texto: `IA propone · firma ${ROLES[firma].nombre}` };
  if (c.riesgoMinimo <= umbral) return { modo: "autonoma", firma: null, texto: "IA sola", nota: `riesgo ${c.riesgoMinimo} ≤ umbral ${umbral}` };
  return { modo: "supervisada", firma, texto: `IA propone · firma ${ROLES[firma].nombre}`, nota: `supera el umbral ${umbral}` };
}

export function formatearMomento(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function nombreRol(rol: string): string {
  return rol in ROLES ? ROLES[rol as RolId].nombre : rol;
}
