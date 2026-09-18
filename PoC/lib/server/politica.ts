// Política de autonomía en el servidor: persistencia en data/politica.json
// (singleton en memoria que sobrevive al HMR vía globalThis, como estado.ts),
// evaluación de decisiones con el umbral del estado y anotación en la timeline.
// Dueño: poc-c5. La lógica pura vive en lib/politica-autonomia.ts.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROLES, type RolId } from "../roles";
import type { Decision } from "../tipos-sistema";
import {
  MODO_ETIQUETA,
  POLITICA_VACIA,
  aplicarAjuste,
  evaluarCompetencia,
  firmaRequerida,
  normalizarPolitica,
  restablecerPolitica,
  type AjusteCategoria,
  type CategoriaId,
  type PoliticaAutonomia,
  type VeredictoCompetencia,
} from "../politica-autonomia";
import { conBloqueo, estadoActual, guardar, registrar } from "./estado";
import { obtenerEstado } from "./motor";

const RUTA = path.join(process.cwd(), "data", "politica.json");

type Global = typeof globalThis & { __crisisPolitica?: PoliticaAutonomia; __crisisPoliticaCargada?: boolean };
const g = globalThis as Global;

/** Política vigente (lee data/politica.json una vez; después, memoria). */
export async function politicaActual(): Promise<PoliticaAutonomia> {
  if (g.__crisisPolitica) return g.__crisisPolitica;
  if (!g.__crisisPoliticaCargada) {
    g.__crisisPoliticaCargada = true;
    try {
      g.__crisisPolitica = normalizarPolitica(JSON.parse(await readFile(RUTA, "utf8")));
      return g.__crisisPolitica;
    } catch {
      /* sin archivo: catálogo por defecto */
    }
  }
  g.__crisisPolitica = { ...POLITICA_VACIA, ajustes: {}, historial: [] };
  return g.__crisisPolitica;
}

/** Versión síncrona para código que no puede esperar (devuelve el catálogo por defecto si aún no se cargó). */
export function politicaSync(): PoliticaAutonomia {
  return g.__crisisPolitica ?? POLITICA_VACIA;
}

async function persistir(p: PoliticaAutonomia) {
  g.__crisisPolitica = p;
  await mkdir(path.dirname(RUTA), { recursive: true });
  await writeFile(RUTA, JSON.stringify(p, null, 2), "utf8");
}

/**
 * Tras un cambio de política: lo anota en la timeline (auditoría y SITREP) y
 * reevalúa las decisiones PENDIENTES con la política nueva (veredicto, riesgo
 * efectivo y firma mínima). Nunca ejecuta nada retroactivamente: si una
 * propuesta anterior al cambio pasa a ser autónoma, sigue esperando firma.
 * Solo usa las funciones exportadas de estado.ts; no toca la lógica del motor.
 */
async function aplicarAlEstado(p: PoliticaAutonomia, texto: string) {
  try {
    await obtenerEstado(); // asegura que el estado esté cargado
    await conBloqueo(async () => {
      const e = estadoActual();
      registrar(e, "sistema", `Política de autonomía · ${texto}`);
      for (const d of e.decisiones) {
        if (d.estado !== "pendiente") continue;
        const anterior = d.competencia;
        // Se parte del riesgo que estimó la IA, no del efectivo ya elevado: así bajar un suelo también baja la decisión.
        const v = evaluarCompetencia({ ...d, riesgo: anterior?.riesgoPropuesto ?? d.riesgo }, p, e.umbralAutonomia);
        if (v.modo === "autonoma") {
          v.modo = "supervisada";
          v.firmaMinima = firmaRequerida(v.riesgoEfectivo);
          v.motivo += " Propuesta anterior al cambio de política: sigue esperando firma (la autonomía no se concede con efecto retroactivo).";
        }
        const igual =
          anterior && anterior.modo === v.modo && anterior.firmaMinima === v.firmaMinima && anterior.riesgoEfectivo === v.riesgoEfectivo && anterior.categoriaDominante === v.categoriaDominante;
        if (igual) continue;
        d.competencia = v;
        d.riesgo = v.riesgoEfectivo;
        registrar(
          e,
          "sistema",
          `Política de autonomía · reevaluada "${d.tarjeta.titulo}": ${MODO_ETIQUETA[v.modo].corta.toLowerCase()}${v.firmaMinima ? `, firma ${ROLES[v.firmaMinima].nombre}` : ""}, riesgo ${v.riesgoEfectivo}`,
          d.id,
        );
      }
      await guardar();
    });
  } catch (err) {
    console.warn("[politica] no se pudo aplicar al estado:", err instanceof Error ? err.message : err);
  }
}

export async function ajustarCategoria(id: CategoriaId, ajuste: AjusteCategoria, rol: RolId): Promise<PoliticaAutonomia> {
  const nueva = aplicarAjuste(await politicaActual(), id, ajuste, rol);
  await persistir(nueva);
  const cambio = nueva.historial[0];
  await aplicarAlEstado(nueva, `${cambio?.texto ?? "ajuste"} (${rol})`);
  return nueva;
}

export async function restablecer(rol: RolId): Promise<PoliticaAutonomia> {
  const nueva = restablecerPolitica(await politicaActual(), rol);
  await persistir(nueva);
  await aplicarAlEstado(nueva, `restablecida al catálogo por defecto (${rol})`);
  return nueva;
}

/** Veredicto para una decisión con la política vigente y el umbral del estado. */
export async function evaluarDecision(d: Decision, umbral?: number): Promise<VeredictoCompetencia> {
  const u = typeof umbral === "number" ? umbral : (await obtenerEstado()).umbralAutonomia;
  return evaluarCompetencia(d, await politicaActual(), u);
}
