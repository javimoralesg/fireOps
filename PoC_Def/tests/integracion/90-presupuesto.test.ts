// =====================================================================
// PRESUPUESTO · qué cuesta una decisión, en llamadas al LLM y en tokens.
// Prueba de CLASE 3 de la migración: no comprueba que el sistema funcione
// —de eso van las demás—, comprueba que la optimización SIRVE.
//
// Sin esta prueba, todo el ahorro que promete la migración de 16 a 5
// agentes es indemostrable: se vería en la factura y en ningún sitio más.
//
// Dos modos, según exista o no tests/linea-base.json:
//   · CAPTURA    (no existe): mide, escribe la línea base y pasa.
//   · COMPARA    (existe):    mide y exige no haber empeorado.
// Fases siguientes: tras F1, bajar TOPES.razonamientoPorDecision según lo
// medido, y así en cada puerta. El fichero de línea base se commitea.
//
// AVISOS DE MÉTODO (importan más que el resultado):
//  1. Los contadores de /api/salud son del PROCESO entero, no de esta prueba.
//     Solo valen si el servidor está ocioso: ejecutar en una instancia propia
//     (ATALAYA_URL), nunca en el :3100 compartido ni en el :3000 de nadie.
//  2. El proceso debe reiniciarse entre fases (fallo L-4: `next dev` mantiene
//     viva la instancia anterior de lib/ia/llm.ts dentro del setInterval).
//  3. La cifra por decisión se atribuye desde la cadena de auditoría, que es
//     exacta; el delta global es contexto y se registra, no se exige.
//
// DUEÑO: constructor L (escrito en la fase F0 de la migración).
// =====================================================================
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Decision } from "@/lib/dominio/tipos";
import { declararFoco, ejecucionNueva, esperarEntornoCargado, esperarHasta, esperarValor, medir, obtener } from "./ayudas";

const RUTA_LINEA_BASE = path.join(process.cwd(), "tests", "linea-base.json");
const RUTA_ULTIMA = path.join(process.cwd(), "tests", "presupuesto-ultimo.json");

/** Navalacruz (Ávila): el mismo foco que usa el resto de la batería. */
const FOCO = { lat: 40.44, lon: -4.99, nombre: "Presupuesto — Navalacruz" };

interface ContadorPapel {
  llamadas: number;
  tokensEntrada: number;
  tokensSalida: number;
}

interface Medida {
  medidoEn: string;
  fase: string;
  proveedor: string;
  modelos: Record<string, string>;
  /** Atribuido a la decisión concreta, desde su cadena de auditoría. */
  porDecision: {
    acciones: number;
    llamadasTrazaOrigen: number;
    razonamientoTrazaOrigen: number;
    actasTotal: number;
    actasDecision: number;
    actasAccion: number;
    actasConNarrativaIA: number;
  };
  /** Del proceso entero durante la ventana de la prueba. Contexto, no contrato. */
  delta: Record<string, ContadorPapel>;
}

async function contadores(): Promise<Record<string, ContadorPapel>> {
  const salud = await obtener<{ ia?: { porPapel?: Record<string, ContadorPapel> } }>("/api/salud");
  return salud.ia?.porPapel ?? {};
}

function restar(despues: Record<string, ContadorPapel>, antes: Record<string, ContadorPapel>): Record<string, ContadorPapel> {
  const r: Record<string, ContadorPapel> = {};
  for (const papel of new Set([...Object.keys(despues), ...Object.keys(antes)])) {
    const d = despues[papel] ?? { llamadas: 0, tokensEntrada: 0, tokensSalida: 0 };
    const a = antes[papel] ?? { llamadas: 0, tokensEntrada: 0, tokensSalida: 0 };
    r[papel] = {
      llamadas: d.llamadas - a.llamadas,
      tokensEntrada: d.tokensEntrada - a.tokensEntrada,
      tokensSalida: d.tokensSalida - a.tokensSalida,
    };
  }
  return r;
}

describe("presupuesto de una decisión", () => {
  it("mide el coste de un ataque inicial y lo compara con la línea base", async () => {
    const t0 = Date.now();
    await ejecucionNueva("presupuesto");
    const antes = await contadores();

    const incendio = await declararFoco(FOCO.lat, FOCO.lon, FOCO.nombre);
    // 240 s y no los 90 s por defecto: medido el 2026-09-19 en una instancia
    // recién arrancada, el satélite estaba enriqueciendo a la vez sus propios
    // focos y Overpass se saturó. El entorno tardó más de 90 s y la prueba
    // moría en la preparación, no en una aserción. Aquí no se mide latencia:
    // se mide coste, así que el presupuesto de espera es generoso a propósito.
    await esperarEntornoCargado(incendio.id, 240_000);

    // Una decisión que haya llegado hasta el final: es la que arrastra todo el
    // coste (plan + legal + supervisor + actas + lecciones).
    const { valor: decision, ms } = await esperarHasta(
      "una decisión ejecutada del foco",
      (s) => s.decisiones.find((d) => d.incendioId === incendio.id && (d.estado === "ejecutada" || d.estado === "fallida")),
      240_000,
    );
    medir("presupuesto · decisión ejecutada", ms, `${decision.titulo} · ${decision.acciones.length} acción(es)`);

    // Las actas se escriben en segundo plano y en el carril de prioridad BAJA:
    // hay que esperarlas o se mediría de menos justo lo que más cuesta. Se
    // espera a que haya un acta por acción ejecutada, con tope de 120 s.
    const actasEsperadas = decision.acciones.filter((a) => a.estado === "ejecutada" || a.estado === "fallida").length;
    const { valor: ultimaCadena, ms: msActas } = await esperarValor(
      `${actasEsperadas} acta(s) de acción en la cadena de auditoría`,
      async () => {
        const c = await cadenaDe(decision.id);
        return c.informes.filter((i) => i.tipo === "accion").length >= actasEsperadas ? c : undefined;
      },
      120_000,
      5000,
    ).catch(async () => ({ valor: await cadenaDe(decision.id), ms: 120_000 }));
    medir("presupuesto · actas escritas", msActas, `${ultimaCadena.informes.length} acta(s) en total`);

    const despues = await contadores();
    const delta = restar(despues, antes);

    const actas = ultimaCadena.informes;
    const medida: Medida = {
      medidoEn: new Date().toISOString(),
      fase: process.env.ATALAYA_FASE ?? "F0",
      proveedor: (await obtener<{ ia?: { proveedor?: string } }>("/api/salud")).ia?.proveedor ?? "desconocido",
      modelos: (await obtener<{ ia?: { modelos?: Record<string, string> } }>("/api/salud")).ia?.modelos ?? {},
      porDecision: {
        acciones: decision.acciones.length,
        llamadasTrazaOrigen: ultimaCadena.trazaOrigen?.llamadasIA.length ?? 0,
        razonamientoTrazaOrigen: (ultimaCadena.trazaOrigen?.llamadasIA ?? []).filter((l) => l.papel === "razonamiento").length,
        actasTotal: actas.length,
        actasDecision: actas.filter((i) => i.tipo === "decision").length,
        actasAccion: actas.filter((i) => i.tipo === "accion").length,
        actasConNarrativaIA: actas.filter((i) => i.conNarrativaIA).length,
      },
      delta,
    };

    writeFileSync(RUTA_ULTIMA, `${JSON.stringify(medida, null, 2)}\n`);
    medir(
      "presupuesto · medido",
      Date.now() - t0,
      `${medida.porDecision.acciones} acción(es) · ${medida.porDecision.actasTotal} acta(s), ${medida.porDecision.actasConNarrativaIA} con IA · ` +
        `razonamiento ${delta.razonamiento?.llamadas ?? 0} llamada(s), ${delta.razonamiento?.tokensSalida ?? 0} tokens de salida`,
    );

    // La medida tiene que ser interpretable, pase lo que pase.
    expect(medida.porDecision.actasTotal).toBeGreaterThanOrEqual(1);
    expect(Object.keys(medida.delta).length).toBeGreaterThan(0);

    if (!existsSync(RUTA_LINEA_BASE)) {
      writeFileSync(RUTA_LINEA_BASE, `${JSON.stringify(medida, null, 2)}\n`);
      console.log(`▶ LÍNEA BASE CAPTURADA en ${RUTA_LINEA_BASE}. Commitéala: es contra lo que se mide cada fase.`);
      return;
    }

    // --- modo COMPARA ---------------------------------------------------
    const base = JSON.parse(readFileSync(RUTA_LINEA_BASE, "utf8")) as Medida;
    console.log(
      `▶ Línea base (${base.fase}, ${base.medidoEn}): ${base.porDecision.actasConNarrativaIA} acta(s) con IA, ` +
        `${base.delta.razonamiento?.llamadas ?? 0} llamada(s) de razonamiento · ahora: ` +
        `${medida.porDecision.actasConNarrativaIA} y ${delta.razonamiento?.llamadas ?? 0}`,
    );

    // Nunca se puede EMPEORAR respecto a la línea base. Los topes se aprietan
    // en la puerta de cada fase, a mano y con el diff a la vista.
    expect(medida.porDecision.actasConNarrativaIA).toBeLessThanOrEqual(base.porDecision.actasConNarrativaIA);
    expect(delta.razonamiento?.llamadas ?? 0).toBeLessThanOrEqual((base.delta.razonamiento?.llamadas ?? 0) + 2);
  }, 600_000);
});

interface CadenaAuditoria {
  decision: Decision;
  trazaOrigen: { llamadasIA: { papel: string; tokensSalida?: number }[] } | null;
  origenTraza: string;
  informes: { tipo: string; huella?: string; conNarrativaIA?: boolean; modelo?: string }[];
}

function cadenaDe(decisionId: string): Promise<CadenaAuditoria> {
  return obtener<CadenaAuditoria>(`/api/auditoria?decisionId=${encodeURIComponent(decisionId)}`);
}
