// =====================================================================
// ATALAYA INCENDIOS · Agente "portavoz" (comunicación)
// ---------------------------------------------------------------------
// Propósito: hablarle a la ciudadanía. Redacta comunicados oficiales en
// castellano y los traduce al inglés y a la lengua cooficial que
// corresponda, los deja en "pendiente_aprobacion" y propone publicarlos
// (la política decide si hace falta un humano). DUEÑO: constructor D.
// Dependencias: lib/ia/llm (razonamiento).
// =====================================================================
import { z } from "zod";
import type { Comunicado, Decision, Incendio } from "../../dominio/tipos";
import type { Agente, ContextoAgente, ResultadoCiclo } from "../../motor/contratos";
import { completarJson, modeloPara, proveedorDisponible } from "../../ia/llm";
import { nuevoId } from "../../motor/ids";
import { bloqueDecisionesPrevias, bloqueLecciones, caducarPendientes, decisionBase, fichaIncendio, hayEquivalenteViva } from "../planificacion/comun";

/** Un comunicado por incendio cada 30 minutos de mundo, salvo cambio grave. */
const MINUTOS_ENTRE_COMUNICADOS = 30;

// DOS llamadas en vez de una (constructor M, 2026-09-19). Antes el comunicado
// y sus traducciones salían del mismo `completarJson` con 2.200 tokens: el
// modelo de razonamiento escribía 250 palabras en castellano y otras tantas por
// idioma, y el comunicado no existía hasta que terminaba TODO. Ahora:
//   · ESQUEMA (razonamiento, 1.400 tokens) → el comunicado en castellano, que
//     es lo que fija el plazo del primer boletín.
//   · ESQUEMA_TRADUCCIONES (papel "rapido", en segundo plano) → las versiones
//     en inglés y en la lengua cooficial, que se añaden al comunicado ya
//     guardado. Traducir no necesita el modelo caro.
const ESQUEMA = z.object({
  titulo: z.string(),
  cuerpo: z.string(),
  urgente: z.boolean(),
  resumenParaElMando: z.string(),
});

const ESQUEMA_TRADUCCIONES = z.object({
  traducciones: z.array(z.object({ idioma: z.enum(["en", "ca", "gl", "eu"]), titulo: z.string(), cuerpo: z.string() })),
});

/** Lengua cooficial que toca según la comunidad autónoma. */
function lenguasDe(comunidad: string | undefined): ("en" | "ca" | "gl" | "eu")[] {
  const c = (comunidad ?? "").toLowerCase();
  if (c.includes("catal") || c.includes("valenc") || c.includes("balear")) return ["en", "ca"];
  if (c.includes("galic") || c.includes("galiz")) return ["en", "gl"];
  if (c.includes("vasc") || c.includes("euskadi") || c.includes("navarr")) return ["en", "eu"];
  return ["en"];
}

export const portavoz: Agente = {
  id: "portavoz",
  nombre: "Portavoz",
  categoria: "comunicacion",
  descripcion: "Redacta los comunicados oficiales a la ciudadanía, con traducciones, y propone publicarlos en el portal.",
  modelo: modeloPara("razonamiento"),
  cadenciaSeg: 300,
  tiempoMaximoSeg: 180, // un comunicado con traducciones ronda los 30-40 s por foco
  // "decision_escalada" es nuevo: si el supervisor tumba un comunicado, el
  // portavoz se despierta para reescribirlo en vez de esperar 300 s de cadencia.
  despiertaCon: ["poblacion_avisada", "incendio_actualizado", "decision_ejecutada", "decision_escalada"],

  async ciclo(ctx: ContextoAgente): Promise<ResultadoCiclo> {
    const { estado } = ctx;
    const activos = estado.incendiosOperativos();
    if (!activos.length) {
      ctx.informarTarea("Sin focos activos que comunicar");
      return { resumen: "Sin focos activos" };
    }
    if (!proveedorDisponible()) {
      ctx.informarTarea("Sin proveedor de IA configurado: no se pueden redactar comunicados");
      return { resumen: "El portavoz necesita el LLM y no hay proveedor configurado" };
    }

    const decisiones: Decision[] = [];
    const hechos: string[] = [];

    // (0) Segunda oportunidad: comunicados que el supervisor ha escalado. El
    // portavoz los REESCRIBE UNA VEZ atendiendo al motivo antes de dejárselos
    // al humano; si la reescritura también se escala, ahí se queda.
    for (const incendio of activos) {
      if (ctx.abortSignal.aborted) break;
      const escalada = comunicadoEscaladoSinReescribir(incendio, ctx);
      if (!escalada) continue;
      ctx.informarTarea(`Reescribiendo el comunicado de ${incendio.nombre} tras el supervisor`, incendio.id);
      const rehecho = await redactar(
        incendio,
        {
          texto: `Reescritura obligatoria. El supervisor de calidad devolvió el comunicado anterior («${escalada.titulo}») con esta objeción: "${escalada.motivo}". Corrígela.`,
          urgente: escalada.urgente,
          reescribe: escalada,
        },
        ctx,
      );
      if (!rehecho) continue;
      // La versión vieja caduca: al mando solo le llega la corregida.
      caducarPendientes(ctx, "portavoz", incendio.id, `Reescrito tras la objeción del supervisor: ${escalada.motivo}`, [rehecho.decision.id]);
      decisiones.push(rehecho.decision);
      hechos.push(`${incendio.nombre}: reescrito «${rehecho.comunicado.titulo}»`);
    }

    for (const incendio of activos) {
      if (ctx.abortSignal.aborted) break;
      const motivo = motivoParaComunicar(incendio, ctx);
      if (!motivo) continue;
      if (hayEquivalenteViva(ctx, "portavoz", incendio.id, "publicar_comunicado")) continue;

      ctx.informarTarea(`Redactando comunicado de ${incendio.nombre}`, incendio.id);
      const resultado = await redactar(incendio, motivo, ctx);
      if (!resultado) continue;
      decisiones.push(resultado.decision);
      hechos.push(`${incendio.nombre}: "${resultado.comunicado.titulo}"`);
    }

    return { resumen: hechos.length ? `Comunicados propuestos · ${hechos.join(" · ")}` : "Sin novedades que comunicar a la ciudadanía", decisiones };
  },
};

interface Motivo {
  texto: string;
  urgente: boolean;
  /** Borrador que dejó el ejecutor al confinar o evacuar, si lo hay. */
  borrador?: Comunicado;
  /** Comunicado escalado por el supervisor que este texto viene a sustituir. */
  reescribe?: ComunicadoEscalado;
}

interface ComunicadoEscalado {
  decisionId: string;
  comunicadoId: string;
  titulo: string;
  motivo: string;
  urgente: boolean;
}

/**
 * Comunicado del portavoz que el supervisor escaló y que TODAVÍA no se ha
 * reescrito. Una sola vez por decisión: si la reescritura vuelve a escalarse,
 * se queda esperando al humano, que es exactamente lo que debe pasar.
 */
function comunicadoEscaladoSinReescribir(incendio: Incendio, ctx: ContextoAgente): ComunicadoEscalado | undefined {
  const mias = [...ctx.estado.decisiones.values()].filter((d) => d.agenteId === "portavoz" && d.incendioId === incendio.id);
  const yaReescritas = new Set(mias.map((d) => d.sustituyeA).filter(Boolean) as string[]);
  for (const d of mias) {
    if (d.estado !== "pendiente_humano" && d.estado !== "escalada") continue;
    if (yaReescritas.has(d.id)) continue;
    const motivo = d.evaluacion?.motivoEscalado?.trim();
    if (!motivo || d.evaluacion?.aprueba) continue;
    const accion = d.acciones.find((a) => a.tipo === "publicar_comunicado");
    const comunicadoId = accion?.parametros?.comunicadoId as string | undefined;
    const comunicado = comunicadoId ? ctx.estado.comunicados.get(comunicadoId) : undefined;
    if (!comunicado || comunicado.estado !== "pendiente_aprobacion") continue;
    return { decisionId: d.id, comunicadoId: comunicado.id, titulo: comunicado.titulo, motivo, urgente: d.prioridad <= 2 };
  }
  return undefined;
}

/** ¿Hay algo nuevo que contar y ha pasado el tiempo mínimo? */
function motivoParaComunicar(incendio: Incendio, ctx: ContextoAgente): Motivo | undefined {
  const { estado } = ctx;

  // 1. Un borrador de confinamiento o evacuación siempre se atiende, sin esperar.
  const borrador = [...estado.comunicados.values()].find((c) => c.incendioId === incendio.id && c.estado === "borrador");
  if (borrador) return { texto: `Hay una medida de protección a la población pendiente de comunicar: ${borrador.titulo}.`, urgente: true, borrador };

  const previos = [...estado.comunicados.values()].filter((c) => c.incendioId === incendio.id && c.estado !== "retirado");
  const ultimo = previos.sort((a, b) => (a.publicadoEn ?? "").localeCompare(b.publicadoEn ?? ""))[previos.length - 1];
  const minutosDesde = ultimo?.publicadoEn
    ? (Date.parse(estado.reloj.ahoraMundo) - Date.parse(ultimo.publicadoEn)) / 60_000
    : Number.POSITIVE_INFINITY;

  const poblacionesGraves = estado.poblacionesDe(incendio.id).filter((p) => p.riesgo === "inminente" || p.riesgo === "alto");
  const cambioGrave = incendio.nivelGravedad >= 2 || poblacionesGraves.some((p) => p.riesgo === "inminente");

  if (!ultimo) {
    // Primer boletín informativo: en cuanto el foco está confirmado y hay medios asignados (ataque
    // inicial), o si ya hay población en riesgo, nivel ≥ 1 o más de 20 ha. La ciudadanía debe saber
    // que hay un incendio y que se está actuando, aunque sea pequeño.
    const medios = estado.unidadesDe(incendio.id).length;
    const confirmadoConMedios = ["confirmado", "activo", "estabilizado"].includes(incendio.estado) && medios > 0;
    if (confirmadoConMedios || poblacionesGraves.length || incendio.nivelGravedad >= 1 || incendio.areaHa > 20) {
      return {
        texto: `Primer comunicado del ${incendio.nombre}: ${medios} medio(s) movilizados, ${poblacionesGraves.length} población(es) en riesgo, ${incendio.areaHa.toFixed(0)} ha, nivel ${incendio.nivelGravedad}.`,
        urgente: cambioGrave,
      };
    }
    return undefined;
  }

  if (minutosDesde < MINUTOS_ENTRE_COMUNICADOS && !cambioGrave) return undefined;
  if (!cambioGrave && !poblacionesGraves.length && incendio.areaHa < 20) return undefined;

  return {
    texto: cambioGrave
      ? `Cambio grave desde el último comunicado: nivel ${incendio.nivelGravedad}, ${poblacionesGraves.filter((p) => p.riesgo === "inminente").length} población(es) con el frente encima.`
      : `Actualización: ${incendio.areaHa.toFixed(0)} ha, ${poblacionesGraves.length} población(es) en riesgo, ${Math.round(minutosDesde)} min desde el último comunicado.`,
    urgente: cambioGrave,
  };
}

async function redactar(incendio: Incendio, motivo: Motivo, ctx: ContextoAgente): Promise<{ comunicado: Comunicado; decision: Decision } | undefined> {
  const { estado } = ctx;
  const poblaciones = estado.poblacionesDe(incendio.id).sort((a, b) => (a.etaFrenteMin ?? 1e9) - (b.etaFrenteMin ?? 1e9));
  const unidades = estado.unidadesDe(incendio.id);
  const idiomas = lenguasDe(incendio.comunidad);
  const organismo = process.env.ORGANISMO_NOMBRE?.trim() || "Centro de Coordinación de Incendios Forestales";

  const contexto = [
    fichaIncendio(incendio),
    "",
    poblaciones.length
      ? `Poblaciones: ${poblaciones
          .slice(0, 8)
          .map((p) => `${p.nombre} (riesgo ${p.riesgo}${p.etaFrenteMin !== undefined ? `, frente en ~${p.etaFrenteMin} min` : ""}, ${p.estadoAviso})`)
          .join("; ")}`
      : "Poblaciones: ninguna en el radio operativo.",
    `Medios trabajando: ${unidades.length ? unidades.map((u) => u.nombre).join("; ") : "en despliegue"}.`,
    motivo.borrador ? `\nMEDIDA YA ADOPTADA QUE HAY QUE COMUNICAR:\n${motivo.borrador.titulo}\n${motivo.borrador.cuerpo}` : "",
    // VIENTO FORZADO: el mando ha fijado el viento a mano para un ejercicio. Si
    // el comunicado lo presentara como previsión real, el supervisor lo tumbaría
    // por incoherente (el parte de Open-Meteo dice otra cosa) y con razón.
    incendio.meteoForzada
      ? `\nEJERCICIO DEL MANDO: el viento de este foco NO es la previsión real: lo ha fijado a mano ${incendio.meteoForzada.fijadoPor} ` +
        `(${Math.round(incendio.meteoForzada.vientoKmh)} km/h, ${incendio.meteoForzada.direccionGrados}°) como supuesto de trabajo. ` +
        `El comunicado TIENE que decirlo con estas palabras o equivalentes: "ejercicio del mando", "escenario de trabajo", ` +
        `"supuesto". Nunca presentes este viento como la previsión meteorológica oficial.`
      : "",
    `\nMotivo del comunicado: ${motivo.texto}`,
    bloqueLecciones(ctx),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const r = await completarJson({
      // Cola prioritaria de lib/ia/llm.ts: Cadena de mando: el comunicado a la ciudadanía no puede esperar detrás de la prensa.
      prioridad: "alta",
      system:
        `Eres el portavoz del ${organismo}. Escribes comunicados oficiales para la ciudadanía sobre incendios forestales.\n` +
        "Reglas:\n" +
        "- Castellano claro, sin tecnicismos ni siglas sin explicar, sin alarmismo y sin minimizar.\n" +
        "- Estructura del cuerpo: (1) qué está pasando y dónde, (2) qué se está haciendo, (3) QUÉ DEBE HACER LA GENTE " +
        "(instrucciones concretas), (4) teléfonos útiles (112 emergencias; 062 Guardia Civil para denuncias) y dónde seguir la información.\n" +
        "- Nunca des por cerrada una evacuación o un confinamiento que aún no ha ordenado el Director del Plan: di 'se ha propuesto' o " +
        "'se está avisando' según corresponda.\n" +
        "- No inventes datos que no estén en el contexto (número de heridos, causas, detenidos).\n" +
        (incendio.meteoForzada
          ? "- El viento de este foco es un SUPUESTO fijado por el mando: dilo en el cuerpo ('ejercicio del mando' / 'escenario de trabajo'). Es obligatorio.\n"
          : "") +
        (motivo.reescribe
          ? "- Este texto SUSTITUYE a uno que el supervisor de calidad devolvió: corrige exactamente lo que te objeta y no repitas el error.\n"
          : "") +
        "- Entre 120 y 250 palabras el cuerpo. Escribes SOLO en castellano: las traducciones se piden aparte.",
      user: contexto,
      esquema: ESQUEMA,
      nombreEsquema: "comunicado_oficial",
      papel: "razonamiento",
      // 1.400 en vez de 2.200: sin traducciones el cuerpo cabe de sobra y la
      // llamada baja de ~30-40 s a ~12-18 s (medido).
      maxTokens: 1400,
      signal: ctx.abortSignal,
    });
    const datos = r.datos;

    const comunicado: Comunicado = {
      id: motivo.borrador?.id ?? nuevoId("com"),
      ejecucionId: estado.ejecucion.id,
      incendioId: incendio.id,
      titulo: datos.titulo,
      cuerpo: datos.cuerpo,
      // Se guarda YA sin traducciones: el boletín en castellano es lo urgente.
      // `traducir()` las añade en cuanto llegan, sin bloquear nada.
      traducciones: {},
      canales: ["portal", "telegram"],
      estado: "pendiente_aprobacion",
      decisionId: motivo.borrador?.decisionId,
    };
    estado.guardar(estado.comunicados, comunicado);

    const previas = bloqueDecisionesPrevias(ctx, incendio.id);
    const decision = decisionBase(ctx, {
      agenteId: "portavoz",
      incendioId: incendio.id,
      decisionesPrevias: previas.ids,
      titulo: `Publicar comunicado: ${datos.titulo}`,
      resumen: datos.resumenParaElMando,
      sustituyeA: motivo.reescribe?.decisionId,
      motivoReplanificacion: motivo.reescribe ? `Reescrito tras el supervisor: ${motivo.reescribe.motivo}` : undefined,
      razonamiento:
        `${motivo.texto} El comunicado explica qué ocurre, qué se está haciendo y qué debe hacer la población, con los teléfonos ` +
        `de emergencia. Se publica en el portal ciudadano y se difunde por Telegram, con traducción a ${idiomas.join(" y ")}. ` +
        `Informar pronto y bien reduce llamadas al 112 y evita que circulen bulos.`,
      prioridad: datos.urgente ? 2 : 3,
      // Informativo → autónomo (tras el supervisor); con órdenes a la población o cambio grave → una persona.
      riesgo: datos.urgente ? 60 : 25,
      acciones: [
        {
          tipo: "publicar_comunicado",
          descripcion: `Publicar "${datos.titulo}" en el portal ciudadano y difundirlo`,
          parametros: { comunicadoId: comunicado.id, incendioId: incendio.id, idiomas },
        },
      ],
      evidencias: incendio.meteo
        ? [
            {
              id: `ev-com-${comunicado.id}`,
              fuente: incendio.meteo.fuente,
              resumen: `Situación al redactar: ${incendio.areaHa.toFixed(0)} ha, viento ${incendio.meteo.vientoKmh.toFixed(0)} km/h del ${incendio.meteo.direccionTexto}.`,
              url: incendio.meteo.url,
              en: incendio.meteo.horaMundo,
              confianza: 0.9,
            },
          ]
        : [],
    });
    estado.actualizar(estado.comunicados, comunicado.id, { decisionId: decision.id });

    // Traducciones EN SEGUNDO PLANO con el papel "rapido": no retrasan ni el
    // comunicado ni la decisión. Si fallan, el comunicado sale igual en
    // castellano (que es el que exige la ley) y queda anotado el motivo.
    void traducir(comunicado.id, datos.titulo, datos.cuerpo, idiomas, ctx);

    return { comunicado, decision };
  } catch (e) {
    ctx.registrar("agente", `El portavoz no ha podido redactar el comunicado de ${incendio.nombre}: ${e instanceof Error ? e.message : String(e)}`, {
      incendioId: incendio.id,
      nivel: "aviso",
    });
    return undefined;
  }
}

/**
 * Traduce un comunicado ya publicado a los idiomas que toquen y lo actualiza en
 * el estado. Papel "rapido": traducir no necesita el modelo de razonamiento
 * (verificado leyendo las salidas: la calidad es la misma y cuesta 3-5 s).
 * Nunca lanza: un fallo de traducción no puede tumbar el ciclo del portavoz.
 */
async function traducir(
  comunicadoId: string,
  titulo: string,
  cuerpo: string,
  idiomas: ("en" | "ca" | "gl" | "eu")[],
  ctx: ContextoAgente,
): Promise<void> {
  if (!idiomas.length) return;
  try {
    const r = await completarJson({
      prioridad: "alta",
      system:
        "Traduces comunicados oficiales de emergencias. Mantienes el registro institucional, los números de teléfono " +
        "y los topónimos tal cual. No resumes ni añades nada: traduces el texto completo.",
      user: `Traduce este comunicado a: ${idiomas.join(", ")} (códigos ISO: en inglés, ca catalán/valenciano, gl gallego, eu euskera).\n\nTítulo: ${titulo}\n\nCuerpo:\n${cuerpo}`,
      esquema: ESQUEMA_TRADUCCIONES,
      nombreEsquema: "traducciones_comunicado",
      papel: "rapido",
      maxTokens: 2000,
    });
    const traducciones: Record<string, { titulo: string; cuerpo: string }> = {};
    for (const t of r.datos.traducciones) traducciones[t.idioma] = { titulo: t.titulo, cuerpo: t.cuerpo };
    if (!Object.keys(traducciones).length) return;
    if (!ctx.estado.comunicados.get(comunicadoId)) return; // se ha retirado mientras tanto
    ctx.estado.actualizar(ctx.estado.comunicados, comunicadoId, { traducciones });
  } catch (e) {
    console.warn(`[portavoz] traducciones del comunicado ${comunicadoId} fallidas: ${e instanceof Error ? e.message : e}`);
  }
}
