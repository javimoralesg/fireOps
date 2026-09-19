// =====================================================================
// ATALAYA INCENDIOS · Agente "propagacion" (análisis)
// ---------------------------------------------------------------------
// Propósito: hacer avanzar el fuego de verdad Y APAGARLO DE VERDAD. Cada
// 30 s (unos minutos de mundo) el agente:
//   1. FUSIONA los focos cuyos perímetros se han juntado (< 300 m borde a
//      borde) — lib/simulacion/fusion.ts.
//   2. Calcula la CONTENCIÓN de cada foco: metros de línea de control que
//      construyen las unidades en intervención, efecto de las descargas
//      aéreas y de la lluvia real — lib/simulacion/contencion.ts.
//   3. Expande el perímetro con el modelo elíptico FRENADO por esa
//      contención, recalcula frente y predicción a +1/+3/+6 h y pone al
//      día el riesgo y el tiempo de llegada de cada población.
//   4. Marca los HITOS (activo → estabilizado → controlado → extinguido) y
//      propone al mando las decisiones de cierre cuando toca.
//
// Es DETERMINISTA: ni una llamada al LLM. DUEÑOS: constructor D (modelo de
// propagación) y constructor K (extinción, contención y fusión).
// Dependencias: lib/simulacion/{propagacion,contencion,fusion},
// lib/fuentes/openMeteo (lluvia acumulada real).
// =====================================================================
import type { Decision, Evidencia, Incendio, RiesgoPoblacion } from "../../dominio/tipos";
import type { Agente, ContextoAgente, ResultadoCiclo } from "../../motor/contratos";
import { evaluarPoblaciones, predecir, propagar } from "../../simulacion/propagacion";
import {
  calcularContencion,
  factorExtincion,
  hayMediosAereos,
  MINUTOS_CONTROLADO_A_EXTINGUIDO,
  MINUTOS_ESTABILIZADO_A_CONTROLADO,
  tocaDeclararControlado,
  tocaDeclararExtinguido,
} from "../../simulacion/contencion";
import { aplicarFusion, siguienteFusion } from "../../simulacion/fusion";
import { precipitacionAcumulada, previsionHoraria } from "../../fuentes/openMeteo";
import { decisionBase, hayEquivalenteViva } from "../planificacion/comun";

const ORDEN_RIESGO: Record<RiesgoPoblacion, number> = { bajo: 0, medio: 1, alto: 2, inminente: 3 };

/** Máximo de fusiones encadenadas por ciclo (A-B-C se resuelve en dos pasos). */
const MAX_FUSIONES_POR_CICLO = 5;

/** Agentes a los que hay que despertar cuando el escenario cambia de golpe. */
const A_DESPERTAR = ["coordinador", "proteccion_poblacion", "patrones", "portavoz"];

async function despertarA(motivo: string): Promise<void> {
  try {
    const { despertar } = await import("../../motor/orquestador");
    for (const id of A_DESPERTAR) despertar(id, motivo);
  } catch {
    // El orquestador puede no estar arrancado (scripts de verificación): no es un error.
  }
}

/** Lluvia acumulada real en las 24 h previas (mm). Si Open-Meteo falla, `undefined`. */
async function lluviaDe(incendio: Incendio, ahoraMundo: string): Promise<number | undefined> {
  try {
    const prevision = await previsionHoraria(incendio.centro);
    return precipitacionAcumulada(prevision, ahoraMundo, 24);
  } catch {
    return undefined;
  }
}

/** Decisión de cierre (controlado / extinguido) para que la firme el mando. */
function decisionCierre(ctx: ContextoAgente, incendio: Incendio, destino: "controlado" | "extinguido"): Decision | undefined {
  if (hayEquivalenteViva(ctx, "propagacion", incendio.id, "declarar_controlado", destino)) return undefined;
  const c = incendio.contencion;
  const esControlado = destino === "controlado";

  const evidencias: Evidencia[] = [
    {
      id: `ev-contencion-${incendio.id}-${Date.parse(ctx.ahoraMundo)}`,
      fuente: "Atalaya · modelo de contención",
      resumen: c
        ? `${(c.perimetroControladoM / 1000).toFixed(2)} km de línea sobre ${(c.perimetroTotalM / 1000).toFixed(2)} km de perímetro ` +
          `(${Math.round(c.fraccion * 100)} %), ${c.unidadesTrabajando} unidad(es) a ${c.ritmoMmin.toFixed(1)} m/min` +
          (c.mediosAereos ? ", con medios aéreos" : "") +
          (c.estabilizadoEn ? `. Estabilizado desde las ${c.estabilizadoEn.slice(11, 16)} de mundo` : "") +
          (c.controladoEn ? `. Controlado desde las ${c.controladoEn.slice(11, 16)} de mundo` : "")
        : "Sin datos de contención",
      en: ctx.ahoraMundo,
      confianza: 0.9,
    },
  ];
  if (incendio.meteo) {
    evidencias.push({
      id: `ev-meteo-cierre-${incendio.id}-${Date.parse(ctx.ahoraMundo)}`,
      fuente: incendio.meteo.fuente,
      resumen: `Viento ${incendio.meteo.vientoKmh.toFixed(0)} km/h del ${incendio.meteo.direccionTexto} (rachas ${incendio.meteo.rachasKmh.toFixed(0)}), HR ${incendio.meteo.humedadPct.toFixed(0)} %, ${incendio.meteo.temperaturaC.toFixed(0)} °C.`,
      url: incendio.meteo.url,
      en: ctx.ahoraMundo,
      confianza: 0.9,
    });
  }

  return decisionBase(ctx, {
    agenteId: "propagacion",
    incendioId: incendio.id,
    titulo: esControlado ? `Declarar CONTROLADO el ${incendio.nombre}` : `Declarar EXTINGUIDO el ${incendio.nombre}`,
    resumen: esControlado
      ? `El perímetro lleva ${MINUTOS_ESTABILIZADO_A_CONTROLADO} min de mundo cerrado y sin rebrotes: procede declararlo controlado y pasar a liquidación.`
      : `Llevan ${MINUTOS_CONTROLADO_A_EXTINGUIDO} min de mundo de liquidación sobre un incendio controlado: procede declararlo extinguido y retirar los medios a sus bases.`,
    razonamiento: esControlado
      ? `El ${incendio.nombre} está estabilizado desde las ${c?.estabilizadoEn?.slice(11, 16) ?? "?"} de mundo: ` +
        `${c?.unidadesTrabajando ?? 0} unidad(es) tienen cogido el 100 % de ${( (c?.perimetroTotalM ?? 0) / 1000).toFixed(2)} km de perímetro y el fuego no ha ganado terreno desde entonces. ` +
        `Con ${MINUTOS_ESTABILIZADO_A_CONTROLADO} min sin reproducciones y viento de ${incendio.meteo?.vientoKmh.toFixed(0) ?? "?"} km/h, la línea aguanta. ` +
        `CONTROLADO no es extinguido: los medios siguen en el terreno rematando y enfriando la franja interior. ` +
        `Esta sala PROPONE; quien lo declara es el director de extinción en el terreno.`
      : `El ${incendio.nombre} está controlado desde las ${c?.controladoEn?.slice(11, 16) ?? "?"} de mundo. ` +
        `Tras ${MINUTOS_CONTROLADO_A_EXTINGUIDO} min de mundo de liquidación y remate sin puntos calientes ni humos, ` +
        `procede darlo por extinguido: ${(incendio.areaHa ?? 0).toFixed(0)} ha recorridas. ` +
        `Al ejecutarse, las unidades REGRESAN A SUS BASES POR CARRETERA y quedan disponibles para otros focos. ` +
        `Esta sala PROPONE; la declaración de extinguido la firma el director de extinción.`,
    prioridad: esControlado ? 3 : 4,
    riesgo: esControlado ? 50 : 45,
    acciones: [
      {
        tipo: "declarar_controlado",
        descripcion: esControlado ? `Declarar controlado el ${incendio.nombre}` : `Declarar extinguido el ${incendio.nombre} y retirar los medios a sus bases`,
        parametros: { estado: destino, incendioId: incendio.id, clave: destino },
      },
    ],
    evidencias,
  });
}

export const analistaPropagacion: Agente = {
  id: "propagacion",
  nombre: "Analista de propagación",
  categoria: "analisis",
  descripcion:
    "Avanza el perímetro con el modelo elíptico (viento, humedad, pendiente y combustible), descuenta la línea de control que construyen los medios, fusiona los focos que se juntan y declara los hitos de extinción.",
  modelo: "determinista",
  cadenciaSeg: 30,
  despiertaCon: ["viento_gira", "incendio_actualizado", "unidad_llega"],

  async ciclo(ctx: ContextoAgente): Promise<ResultadoCiclo> {
    const { estado } = ctx;
    const minutos = Math.max(0, ctx.minutosMundoDesdeUltimoCiclo || 0);
    const decisiones: Decision[] = [];
    const resumenes: string[] = [];
    const sinMeteo: string[] = [];
    let subidas = 0;

    // -----------------------------------------------------------------
    // 0. FUSIÓN DE FOCOS: dos columnas que se juntan son un solo incendio
    // -----------------------------------------------------------------
    const fusiones: string[] = [];
    for (let vuelta = 0; vuelta < MAX_FUSIONES_POR_CICLO; vuelta++) {
      const plan = siguienteFusion(estado.incendiosActivos());
      if (!plan) break;
      ctx.informarTarea(`Fusionando ${plan.absorbido.nombre} con ${plan.superviviente.nombre}`, plan.superviviente.id);
      const r = aplicarFusion(estado, plan, ctx.ahoraMundo);
      ctx.registrar("incendio_actualizado", r.mensaje, {
        incendioId: r.superviviente.id,
        nivel: "critico",
        datos: {
          fusion: true,
          supervivienteId: r.superviviente.id,
          absorbidoId: r.absorbido.id,
          distanciaBordeM: plan.distanciaBordeM,
          areaHa: r.superviviente.areaHa,
          unidades: r.unidadesTraspasadas,
          poblaciones: r.poblacionesTraspasadas,
          decisionesCaducadas: r.decisionesCaducadas,
          clusters: r.clustersMarcados,
        },
      });
      fusiones.push(`${r.absorbido.nombre} → ${r.superviviente.nombre}`);
      await despertarA(`fusión de focos: ${r.superviviente.nombre}`);
    }

    // -----------------------------------------------------------------
    // 1. Focos a procesar: los operativos + los controlados (liquidación)
    // -----------------------------------------------------------------
    const operativos = estado.incendiosOperativos();
    const enLiquidacion = estado.incendiosActivos().filter((i) => i.estado === "controlado");
    const aProcesar = [...operativos, ...enLiquidacion];

    if (!aProcesar.length) {
      ctx.informarTarea(fusiones.length ? `${fusiones.length} fusión(es) aplicadas` : "Sin focos activos");
      return { resumen: fusiones.length ? `Focos fusionados: ${fusiones.join(", ")}` : "Sin focos activos que propagar" };
    }

    for (const incendio of aProcesar) {
      if (ctx.abortSignal.aborted) break;
      if (!incendio.meteo) {
        sinMeteo.push(incendio.nombre);
        continue;
      }

      // --- 1a. Primer medio en el terreno: el foco pasa a "activo" -----
      const unidades = [...estado.unidades.values()];
      const trabajando = unidades.filter((u) => u.incendioId === incendio.id && u.estado === "en_intervencion");
      let actual = incendio;
      if (actual.estado === "confirmado" && trabajando.length > 0) {
        actual = estado.actualizar(estado.incendios, actual.id, { estado: "activo", actualizadoEn: ctx.ahoraMundo }) ?? actual;
        ctx.registrar("incendio_actualizado", `${actual.nombre} pasa a ACTIVO: ${trabajando[0].nombre} ya trabaja en el terreno.`, {
          incendioId: actual.id,
          nivel: "aviso",
          datos: { estado: "activo", unidadId: trabajando[0].id },
        });
      }

      ctx.informarTarea(`Propagando ${actual.nombre} (${minutos.toFixed(0)} min de mundo)`, actual.id);

      const lluvia24Mm = await lluviaDe(actual, ctx.ahoraMundo);
      const mediosAereos = hayMediosAereos(actual.id, unidades, [...estado.decisiones.values()]);

      // --- 1b. El fuego avanza FRENADO por la contención del ciclo previo
      const factorPrevio = factorExtincion(actual, { ahoraMundo: ctx.ahoraMundo, mediosAereos, lluvia24Mm });
      const areaAntes = actual.areaHa;
      const avance = propagar(actual, minutos, factorPrevio.factor);
      actual =
        estado.actualizar(estado.incendios, actual.id, {
          perimetro: avance.perimetro,
          areaHa: avance.areaHa,
          frente: avance.frente,
          actualizadoEn: ctx.ahoraMundo,
        }) ?? actual;

      // --- 1c. La línea de control avanza sobre el perímetro nuevo -----
      const r = calcularContencion(actual, unidades, minutos, { ahoraMundo: ctx.ahoraMundo, mediosAereos, lluvia24Mm });
      actual = estado.actualizar(estado.incendios, actual.id, { contencion: r.contencion }) ?? actual;

      // --- 1d. Hitos: rebrote y estabilización -------------------------
      if (r.rebroteAhora) {
        actual = estado.actualizar(estado.incendios, actual.id, { estado: "activo", actualizadoEn: ctx.ahoraMundo }) ?? actual;
        ctx.registrar(
          "incendio_actualizado",
          `REBROTE en ${actual.nombre}: ${r.motivoRebrote}. Se pierde el ${Math.round((1 - r.contencion.fraccion) * 100)} % del perímetro cogido y el foco vuelve a estar ACTIVO.`,
          { incendioId: actual.id, nivel: "critico", datos: { rebrote: true, fraccion: r.contencion.fraccion, motivo: r.motivoRebrote, rebrotes: r.contencion.rebrotes } },
        );
        await despertarA(`rebrote en ${actual.nombre}`);
      }
      if (r.estabilizaAhora) {
        actual = estado.actualizar(estado.incendios, actual.id, { estado: "estabilizado", actualizadoEn: ctx.ahoraMundo }) ?? actual;
        ctx.registrar(
          "incendio_actualizado",
          `Estabilizado: perímetro 100 % controlado por ${r.contencion.unidadesTrabajando} unidades (${(r.contencion.perimetroTotalM / 1000).toFixed(2)} km, ${actual.areaHa.toFixed(0)} ha).`,
          {
            incendioId: actual.id,
            nivel: "critico",
            datos: { estado: "estabilizado", unidades: r.contencion.unidadesTrabajando, perimetroM: r.contencion.perimetroTotalM, areaHa: actual.areaHa },
          },
        );
        await despertarA(`${actual.nombre} estabilizado`);
      }

      // --- 1e. Predicción y amenaza sobre las poblaciones --------------
      const factorAhora = factorExtincion(actual, { ahoraMundo: ctx.ahoraMundo, mediosAereos, lluvia24Mm });
      const poblaciones = estado.poblacionesDe(actual.id);
      const prediccion = predecir(actual, poblaciones, factorAhora.factor);
      const amenazas = evaluarPoblaciones(actual, poblaciones, factorAhora.factor);
      estado.actualizar(estado.incendios, actual.id, { prediccion });

      const evidencia: Evidencia = {
        id: `ev-meteo-${actual.id}-${Date.parse(ctx.ahoraMundo)}`,
        fuente: actual.meteo?.fuente ?? "Open-Meteo",
        resumen:
          `Viento ${actual.meteo?.vientoKmh.toFixed(0)} km/h del ${actual.meteo?.direccionTexto} ` +
          `(rachas ${actual.meteo?.rachasKmh.toFixed(0)}), HR ${actual.meteo?.humedadPct.toFixed(0)} %, ` +
          `${actual.meteo?.temperaturaC.toFixed(0)} °C. Frente al ${avance.frente?.rumboTexto} a ${avance.frente?.velocidadMmin.toFixed(1)} m/min. ` +
          `Extinción: ${factorAhora.explicacion}.`,
        url: actual.meteo?.url,
        en: ctx.ahoraMundo,
        confianza: 0.9,
      };

      for (const amenaza of amenazas) {
        const previa = poblaciones.find((p) => p.id === amenaza.poblacionId);
        if (!previa) continue;
        const subeAAlto = ORDEN_RIESGO[amenaza.riesgo] >= ORDEN_RIESGO.alto && ORDEN_RIESGO[amenaza.riesgo] > ORDEN_RIESGO[previa.riesgo];
        estado.actualizar(estado.poblaciones, previa.id, { riesgo: amenaza.riesgo, etaFrenteMin: amenaza.etaMin });
        if (subeAAlto) {
          subidas += 1;
          ctx.registrar(
            "peligro_sube",
            `${previa.nombre} quedará alcanzada en ~${amenaza.etaMin} min si el viento sigue del ${actual.meteo?.direccionTexto} (riesgo ${amenaza.riesgo}, ${previa.habitantes ?? "?"} habitantes).`,
            { incendioId: actual.id, nivel: "critico", datos: { poblacionId: previa.id, riesgo: amenaza.riesgo, etaMin: amenaza.etaMin, evidencia } },
          );
        }
      }

      // --- 1f. Decisiones de cierre (siempre las firma una persona) ----
      if (tocaDeclararControlado(actual, ctx.ahoraMundo)) {
        const d = decisionCierre(ctx, actual, "controlado");
        if (d) decisiones.push(d);
      } else if (tocaDeclararExtinguido(actual, ctx.ahoraMundo)) {
        const d = decisionCierre(ctx, actual, "extinguido");
        if (d) decisiones.push(d);
      }

      const crecimiento = +(avance.areaHa - areaAntes).toFixed(1);
      resumenes.push(
        `${actual.nombre}: ${avance.areaHa.toFixed(0)} ha (${crecimiento >= 0 ? "+" : ""}${crecimiento}), ` +
          `frente al ${avance.frente?.rumboTexto} a ${avance.frente?.velocidadMmin.toFixed(1)} m/min, ` +
          `${Math.round(r.contencion.fraccion * 100)} % de perímetro controlado` +
          (r.contencion.ritmoMmin > 0 ? ` (${r.contencion.unidadesTrabajando} ud. a ${r.contencion.ritmoMmin.toFixed(1)} m/min)` : " (sin medios en el terreno)") +
          (prediccion.poblacionesEnPeligro.length ? `, ${prediccion.poblacionesEnPeligro.length} población(es) en trayectoria` : ""),
      );
    }

    if (sinMeteo.length) {
      ctx.informarTarea(`Sin meteorología todavía en: ${sinMeteo.join(", ")} — no se propaga (el meteorólogo aún no ha llegado)`);
    }

    const resumen = [
      fusiones.length ? `Fusiones: ${fusiones.join(", ")}` : "",
      resumenes.join(" · "),
      sinMeteo.length ? `Sin meteo: ${sinMeteo.join(", ")}` : "",
      subidas ? `${subidas} población(es) suben de riesgo` : "",
      decisiones.length ? `${decisiones.length} decisión(es) de cierre propuestas` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    return { resumen: resumen || "Sin cambios en la propagación", decisiones };
  },
};
