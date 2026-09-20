// =====================================================================
// ATALAYA INCENDIOS · Saneamiento "solo España"
// ---------------------------------------------------------------------
// Propósito: lo que ya estaba en el estado con coordenadas de fuera del
// territorio español (focos que NASA FIRMS creó en Argelia, Portugal o
// Francia antes de la restricción, sus pueblos, medios y hospitales de
// Overpass, detecciones de satélite, cámaras y avisos) tiene que desaparecer
// del mapa y de las listas. Las entradas nuevas ya las corta `enEspana`
// (lib/dominio/espana.ts); esto limpia lo heredado, también lo que vuelve de
// Supabase al hidratar.
//
// Reglas:
//  · un foco abierto fuera → "descartado" por `cerrarIncendio` (los medios
//    vuelven a su base por carretera y queda rastro en el registro);
//  · unidades con base fuera, pueblos, hospitales, cámaras y detecciones de
//    satélite fuera → se eliminan del estado (no cuelgan de nada útil);
//  · avisos con ubicación fuera → impacto "ruido" con el motivo, para que el
//    verificador no los vuelva a mirar.
// Lo llama el orquestador al arrancar (tras hidratar) y en cada tick; entre
// pasadas deja un minuto y nunca se solapa consigo mismo.
// DUEÑO: sesión 2026-09-19 (restricción a España).
// =====================================================================
import type { Estado } from "./estado";
import { describirFueraEspana, enEspana } from "../dominio/espana";

export const QUIEN_SANEAMIENTO = "ámbito España (saneamiento automático)";
const ENTRE_PASADAS_MS = 60_000;

export interface ResumenSaneamiento {
  focos: number;
  unidades: number;
  poblaciones: number;
  hospitales: number;
  camaras: number;
  satelite: number;
  observaciones: number;
}

export interface OpcionesSaneamiento {
  /** Ignora el minuto de espera entre pasadas (arranque, pruebas). */
  forzar?: boolean;
  /** Cómo cerrar un foco; por defecto `cerrarIncendio` del orquestador (inyectable en pruebas). */
  cerrar?: (id: string, quien: string) => Promise<unknown>;
}

type Global = typeof globalThis & { __atalayaSaneamiento?: { enCurso: boolean; ultima: number } };
const g = globalThis as Global;
const est = () => (g.__atalayaSaneamiento ??= { enCurso: false, ultima: 0 });

const total = (r: ResumenSaneamiento): number => Object.values(r).reduce((s, n) => s + n, 0);

/** Frase corta del resumen ("2 focos, 5 unidades, 3 pueblos"). */
export function describirSaneamiento(r: ResumenSaneamiento): string {
  const partes = [
    [r.focos, "foco", "focos"],
    [r.unidades, "unidad", "unidades"],
    [r.poblaciones, "pueblo", "pueblos"],
    [r.hospitales, "hospital", "hospitales"],
    [r.camaras, "cámara", "cámaras"],
    [r.satelite, "detección de satélite", "detecciones de satélite"],
    [r.observaciones, "aviso", "avisos"],
  ] as const;
  return partes
    .filter(([n]) => n > 0)
    .map(([n, uno, varios]) => `${n} ${n === 1 ? uno : varios}`)
    .join(", ");
}

/**
 * Descarta o elimina todo lo que esté fuera de España. Devuelve el resumen, o
 * `undefined` si no tocaba (otra pasada en curso o hace menos de un minuto).
 */
export async function sanearFueraEspana(estado: Estado, opciones: OpcionesSaneamiento = {}): Promise<ResumenSaneamiento | undefined> {
  const e = est();
  if (e.enCurso) return undefined;
  if (!opciones.forzar && Date.now() - e.ultima < ENTRE_PASADAS_MS) return undefined;
  e.enCurso = true;
  e.ultima = Date.now();
  const r: ResumenSaneamiento = { focos: 0, unidades: 0, poblaciones: 0, hospitales: 0, camaras: 0, satelite: 0, observaciones: 0 };
  try {
    // 1. Focos abiertos fuera → descartados (medios a base, rastro en el registro).
    const fuera = estado.incendiosActivos().filter((i) => !enEspana(i.centro));
    if (fuera.length) {
      const cerrar =
        opciones.cerrar ??
        (async (id: string, quien: string) => {
          const { cerrarIncendio } = await import("./orquestador");
          return cerrarIncendio(id, "descartado", quien);
        });
      for (const i of fuera) {
        try {
          await cerrar(i.id, QUIEN_SANEAMIENTO);
        } catch (err) {
          // Si el cierre ordenado falla (p. ej. OSRM caído), se descarta a secas.
          estado.actualizar(estado.incendios, i.id, { estado: "descartado", actualizadoEn: estado.reloj.ahoraMundo });
          estado.registrarEvento("sistema", `Cierre ordenado fallido, descartado a secas: ${err instanceof Error ? err.message : String(err)}`, { incendioId: i.id, nivel: "aviso" });
        }
        estado.registrarEvento("incendio_actualizado", `${i.nombre} descartado: ${describirFueraEspana(i.centro)}`, { incendioId: i.id, nivel: "aviso" });
        r.focos += 1;
      }
    }

    // 2. Lo que tiene posición propia fuera → se elimina.
    for (const u of [...estado.unidades.values()]) {
      if (enEspana(u.base.punto)) continue;
      if (estado.eliminar(estado.unidades, u.id)) r.unidades += 1;
    }
    for (const p of [...estado.poblaciones.values()]) {
      if (enEspana(p.centro)) continue;
      if (estado.eliminar(estado.poblaciones, p.id)) r.poblaciones += 1;
    }
    for (const h of [...estado.hospitales.values()]) {
      if (enEspana(h.punto)) continue;
      if (estado.eliminar(estado.hospitales, h.id)) r.hospitales += 1;
    }
    for (const c of [...estado.camaras.values()]) {
      if (enEspana(c.punto)) continue;
      if (estado.eliminar(estado.camaras, c.id)) r.camaras += 1;
    }
    for (const f of [...estado.focosSatelite.values()]) {
      if (enEspana(f.punto)) continue;
      if (estado.eliminar(estado.focosSatelite, f.id)) r.satelite += 1;
    }

    // 3. Avisos con ubicación fuera → ruido (el verificador no los vuelve a mirar).
    for (const o of [...estado.observaciones.values()]) {
      if (!o.punto || enEspana(o.punto) || o.impacto === "ruido") continue;
      estado.actualizar(estado.observaciones, o.id, { impacto: "ruido", verificacion: `${describirFueraEspana(o.punto)} Saneamiento automático.` });
      r.observaciones += 1;
    }

    if (total(r) > 0) {
      estado.registrarEvento("sistema", `Saneamiento "solo España": fuera del territorio quedan descartados ${describirSaneamiento(r)}.`, {
        nivel: "aviso",
        datos: { ...r },
      });
    }
    return r;
  } finally {
    e.enCurso = false;
  }
}
