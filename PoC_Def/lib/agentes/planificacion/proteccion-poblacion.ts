// =====================================================================
// ATALAYA INCENDIOS · Agente "proteccion_poblacion" (planificación)
// ---------------------------------------------------------------------
// Propósito: decidir, pueblo a pueblo y por orden de tiempo de llegada del
// frente, si se avisa, se confina o se evacúa; y escribir el guion de la
// llamada al ayuntamiento y el SMS/Telegram que recibirán los vecinos.
// Confinar y evacuar los ORDENA el director del plan: aquí se propone y
// la política lo deja en "humano". DUEÑO: constructor D.
// Dependencias: lib/ia/llm (razonamiento).
//
// F3 de la migración (2026-09-19): UNA llamada por FOCO, no una por pueblo.
// Antes cada pueblo costaba su propia llamada de razonamiento de ~25 s y
// 6.000 tokens: medido, dos pueblos gastaron 7.410 tokens de salida. El
// contexto (el incendio, su meteo, su frente, los medios desplegados) era
// EL MISMO en las dos y se reenviaba entera cada vez. Ahora se manda una
// vez y el modelo devuelve la medida de cada pueblo.
//
// Lo que NO se ha hecho, y por qué: el plan de migración decía fundir esto
// dentro del coordinador, en una sola decisión. Leyendo la política se ve
// que sería una regresión — `evaluarCompetencia` aplica la acción MÁS
// restrictiva, así que una evacuación (humano) convertiría en humano
// también el envío de camiones (supervisada) y el ataque inicial dejaría
// de ser autónomo. Esa fusión necesita antes la competencia POR ACCIÓN
// (fase F5). Aquí se coge el ahorro que no cuesta autonomía.
// =====================================================================
import { z } from "zod";
import type { Decision, Incendio, Poblacion } from "../../dominio/tipos";
import type { Agente, ContextoAgente, ResultadoCiclo } from "../../motor/contratos";
import { gradosATexto } from "../../fuentes/geo";
import { completarJson, modeloPara, proveedorDisponible } from "../../ia/llm";
import { bloqueDecisionesPrevias, bloqueLecciones, decisionBase, DOCTRINA_ESPANA, fichaIncendio, hayEquivalenteViva, type AccionPropuesta } from "./comun";

/** Focos que se tratan por ciclo. Cada uno cuesta UNA llamada de razonamiento. */
const MAX_FOCOS_POR_CICLO = 2;
/**
 * Pueblos que entran en la llamada de un foco. 4, no 2: al ir todos en la misma
 * petición, el contexto del incendio (ficha, meteo, frente, medios) se manda una
 * sola vez y lo que crece es solo la lista de pueblos y la respuesta.
 */
const MAX_POBLACIONES_POR_FOCO = 4;
/** Tokens de salida reservados por pueblo (guion de llamada + SMS + razonamiento). */
const TOKENS_POR_POBLACION = 2200;
/** Techo de la respuesta, pase lo que pase. */
const MAX_TOKENS = 9000;

/**
 * Distancia (km) por debajo de la cual un núcleo con colectivos vulnerables o con
 * población relevante se trata SIEMPRE, aunque el modelo de propagación le dé
 * riesgo "bajo" por tener el frente parado ahora mismo. Caso real visto por Javi:
 * Tuéjar (1.221 hab, camping + colegio + residencia) a 2,9 km con riesgo "bajo"
 * y "sin avisar" porque la ETA del frente salía a 42 h con viento flojo.
 */
const KM_PROXIMIDAD_SENSIBLE = 8;
/** Habitantes a partir de los cuales la proximidad basta para valorar el aviso. */
const HABITANTES_SENSIBLE = 500;

const ESQUEMA_MEDIDA = z.object({
  poblacionId: z.string(),
  medida: z.enum(["avisar", "confinar", "evacuar", "esperar"]),
  titulo: z.string(),
  resumen: z.string(),
  razonamiento: z.string(),
  prioridad: z.number().int().min(1).max(5),
  riesgo: z.number().min(0).max(100),
  guionLlamada: z.string(),
  textoSms: z.string(),
});

const ESQUEMA = z.object({ medidas: z.array(ESQUEMA_MEDIDA) });

/** Lo que el modelo decide para UN pueblo. Frontera zod: por debajo, todo determinista. */
export type MedidaPoblacion = z.infer<typeof ESQUEMA_MEDIDA>;

const TIPO_ACCION = { avisar: "avisar_poblacion", confinar: "confinar_poblacion", evacuar: "evacuar_poblacion" } as const;

export const proteccionPoblacion: Agente = {
  id: "proteccion_poblacion",
  nombre: "Protección de población",
  categoria: "planificacion",
  descripcion: "Decide a qué pueblos se avisa, confina o evacúa, y redacta el guion de la llamada y el mensaje a los vecinos.",
  modelo: modeloPara("razonamiento"),
  cadenciaSeg: 60,
  // 180 s: dos focos × una llamada de ~30 s (más larga que antes porque responde
  // por varios pueblos a la vez) más el ida y vuelta del RAG caben de sobra.
  tiempoMaximoSeg: 180,
  despiertaCon: ["peligro_sube", "viento_gira", "incendio_nuevo", "incendio_actualizado"],

  async ciclo(ctx: ContextoAgente): Promise<ResultadoCiclo> {
    const { estado } = ctx;
    // Se entra por riesgo O por proximidad sensible: el riesgo lo calcula el modelo
    // de propagación a partir de la ETA del frente, y con viento flojo un pueblo
    // pegado al foco sale "bajo". Un núcleo habitado o con colectivos vulnerables a
    // pocos kilómetros merece al menos que se valore el aviso preventivo.
    const proximidadSensible = (p: Poblacion): boolean =>
      p.distanciaKm <= KM_PROXIMIDAD_SENSIBLE &&
      ((p.vulnerables?.length ?? 0) > 0 || (p.habitantes ?? 0) >= HABITANTES_SENSIBLE);
    const enRiesgo = (p: Poblacion): boolean => p.riesgo === "medio" || p.riesgo === "alto" || p.riesgo === "inminente";
    // `sin_respuesta` (todos los canales fallaron) no vuelve a la cola salvo que el
    // frente se le eche encima: si no, se reintentaría en bucle cada ciclo.
    const pendienteDeMedida = (p: Poblacion): boolean =>
      p.estadoAviso === "sin_avisar" || p.estadoAviso === "avisado" || (p.estadoAviso === "sin_respuesta" && p.riesgo === "inminente");

    // Solo poblaciones de focos OPERATIVOS (confirmados por un humano o por fuentes independientes):
    // una noticia sin confirmar no dispara avisos a los ayuntamientos ni satura al agente.
    const focosOperativos = new Set(estado.incendiosOperativos().map((i) => i.id));
    const candidatas = [...estado.poblaciones.values()]
      .filter((p) => focosOperativos.has(p.incendioId))
      .filter((p) => (enRiesgo(p) || proximidadSensible(p)) && pendienteDeMedida(p))
      .filter((p) => !yaTratada(p, ctx))
      .sort(
        (a, b) =>
          (a.etaFrenteMin ?? 1e9) - (b.etaFrenteMin ?? 1e9) ||
          a.distanciaKm - b.distanciaKm ||
          (b.habitantes ?? 0) - (a.habitantes ?? 0),
      );

    if (!candidatas.length) {
      ctx.informarTarea("Ninguna población en riesgo pendiente de medida");
      return { resumen: "Sin poblaciones en riesgo pendientes" };
    }
    if (!proveedorDisponible()) {
      ctx.informarTarea(`${candidatas.length} población(es) en riesgo, pero no hay proveedor de IA configurado`);
      return { resumen: `${candidatas.length} población(es) en riesgo sin tratar: el planificador necesita el LLM (sin proveedor configurado)` };
    }

    // Agrupadas por foco: el contexto del incendio se manda UNA vez por llamada.
    const porFoco = new Map<string, Poblacion[]>();
    for (const p of candidatas) {
      const lista = porFoco.get(p.incendioId) ?? [];
      if (lista.length < MAX_POBLACIONES_POR_FOCO) lista.push(p);
      porFoco.set(p.incendioId, lista);
    }

    const decisiones: Decision[] = [];
    const tratadas: string[] = [];

    for (const [incendioId, poblaciones] of [...porFoco.entries()].slice(0, MAX_FOCOS_POR_CICLO)) {
      if (ctx.abortSignal.aborted) break;
      const incendio = estado.incendios.get(incendioId);
      if (!incendio) continue;

      ctx.informarTarea(`Decidiendo las medidas de ${poblaciones.length} población(es) de ${incendio.nombre}`, incendio.id);
      const nuevas = await decidirPoblaciones(incendio, poblaciones, ctx);
      for (const { decision, medida } of nuevas) {
        decisiones.push(decision);
        tratadas.push(`${nombreDe(poblaciones, medida.poblacionId)} → ${medida.medida}`);
      }
    }

    return {
      resumen: tratadas.length ? `Medidas propuestas: ${tratadas.join(" · ")}` : `${candidatas.length} población(es) en riesgo, sin medidas nuevas`,
      decisiones,
    };
  },
};

const nombreDe = (poblaciones: Poblacion[], id: string): string => poblaciones.find((p) => p.id === id)?.nombre ?? id;

/** ¿Ya hay una medida viva para este pueblo, o ya está avisado y no ha empeorado? */
function yaTratada(poblacion: Poblacion, ctx: ContextoAgente): boolean {
  if (poblacion.estadoAviso === "avisado" && poblacion.riesgo !== "inminente") return true;
  return (
    hayEquivalenteViva(ctx, "proteccion_poblacion", poblacion.incendioId, "avisar_poblacion", poblacion.id) ||
    hayEquivalenteViva(ctx, "proteccion_poblacion", poblacion.incendioId, "confinar_poblacion", poblacion.id) ||
    hayEquivalenteViva(ctx, "proteccion_poblacion", poblacion.incendioId, "evacuar_poblacion", poblacion.id)
  );
}

/** Ficha de un pueblo para el prompt. */
function fichaPoblacion(p: Poblacion, destinoDemo: string | undefined): string {
  return [
    `- ${p.nombre} (id ${p.id}) · ${p.tipo}${p.habitantes !== undefined ? ` · ${p.habitantes} habitantes` : ""}`,
    `  Situación: a ${p.distanciaKm.toFixed(1)} km al ${gradosATexto(p.rumboDesdeFuegoGrados)} del foco`,
    `  Riesgo: ${p.riesgo}${p.etaFrenteMin !== undefined ? ` · el frente llegaría en ~${p.etaFrenteMin} min` : " · fuera de la trayectoria actual"}`,
    `  Estado de aviso: ${p.estadoAviso}`,
    p.vulnerables?.length
      ? `  Colectivos vulnerables cerca: ${p.vulnerables.map((v) => `${v.tipo} "${v.nombre}"`).join(", ")}`
      : "  Sin colectivos vulnerables registrados en OSM.",
    p.telefono ? `  Teléfono de contacto: ${p.telefono}` : `  Sin teléfono en OSM: se usará el número de demostración (${destinoDemo || "SIN DESTINO_DEMO configurado"}).`,
  ].join("\n");
}

/**
 * Una llamada para TODOS los pueblos del mismo foco. Devuelve la decisión de cada
 * uno que lleve medida (los "esperar" se registran y no producen decisión).
 */
async function decidirPoblaciones(
  incendio: Incendio,
  poblaciones: Poblacion[],
  ctx: ContextoAgente,
): Promise<{ decision: Decision; medida: MedidaPoblacion }[]> {
  const { estado } = ctx;
  const previas = bloqueDecisionesPrevias(ctx, incendio.id);
  const destinoDemo = process.env.DESTINO_DEMO?.trim();
  const organismo = process.env.ORGANISMO_NOMBRE?.trim() || "Centro de Coordinación de Incendios Forestales";

  const ficha = [
    fichaIncendio(incendio),
    "",
    `POBLACIONES A PROTEGER (${poblaciones.length}), por orden de urgencia:`,
    poblaciones.map((p) => fichaPoblacion(p, destinoDemo)).join("\n"),
    "",
    `Medios ya desplegados en el foco: ${estado.unidadesDe(incendio.id).length || "ninguno"}.`,
    previas.texto,
    bloqueLecciones(ctx),
  ].join("\n");

  try {
    const r = await completarJson({
      // Cola prioritaria de lib/ia/llm.ts: Cadena de mando: de esta llamada salen los avisos a la población.
      prioridad: "alta",
      system:
        "Eres el responsable de protección a la población de una sala de coordinación de incendios forestales en España.\n" +
        DOCTRINA_ESPANA +
        "\n\nTe dan VARIOS pueblos del mismo incendio. Devuelve una medida por CADA uno, con su `poblacionId` exacto " +
        "(no inventes ninguno y no te dejes ninguno sin responder). Cada pueblo se decide por separado: que uno se evacúe " +
        "no obliga a evacuar al de al lado.\n\n" +
        "Criterio de la medida (ajústalo con el resto de datos, no lo apliques a ciegas):\n" +
        "- 'avisar': aviso preventivo. El frente está lejos o fuera de trayectoria, pero conviene que el ayuntamiento esté sobre aviso.\n" +
        "- 'confinar': el frente llega pronto y la salida por carretera puede ser peor que quedarse dentro (humo, vía única, " +
        "carretera en la trayectoria). Ventanas y puertas cerradas, sin salir.\n" +
        "- 'evacuar': hay tiempo suficiente para salir y quedarse es peor que irse; obligatorio si hay colectivos vulnerables " +
        "(residencias, campings, colegios) que necesitan más tiempo.\n" +
        "- 'esperar': no hay nada que hacer todavía; explícalo.\n\n" +
        "Escribe SIEMPRE, para cada pueblo:\n" +
        `- guionLlamada: lo que dirá el agente de voz al llamar al ayuntamiento. En español, natural al oído. Debe decir quién llama ` +
        `("${organismo}"), qué ocurre (incendio, dónde, a qué distancia, tiempo estimado), qué se le pide exactamente, y pedir una ` +
        "confirmación explícita (\"¿me confirma que lo activan?\") antes de colgar.\n" +
        "- textoSms: mensaje para los vecinos, máximo 300 caracteres, claro, sin tecnicismos, con la instrucción concreta y sin alarmismo.\n" +
        "- razonamiento: 3 a 5 frases. Si propones confinar o evacuar, di explícitamente que la orden corresponde al Director del Plan " +
        "y que esta sala solo la propone.\n" +
        "Con 'esperar' puedes dejar guionLlamada y textoSms vacíos.",
      user: ficha,
      esquema: ESQUEMA,
      nombreEsquema: "medidas_poblacion",
      papel: "razonamiento",
      maxTokens: Math.min(MAX_TOKENS, poblaciones.length * TOKENS_POR_POBLACION),
      signal: ctx.abortSignal,
    });

    const salida: { decision: Decision; medida: MedidaPoblacion }[] = [];
    for (const medida of r.datos.medidas) {
      const poblacion = poblaciones.find((p) => p.id === medida.poblacionId);
      // El modelo puede nombrar un pueblo que no le dimos: se ignora en silencio,
      // igual que hace el mapeo del coordinador con una unidad inventada.
      if (!poblacion) continue;
      if (medida.medida === "esperar") {
        ctx.registrar("agente", `${poblacion.nombre}: sin medida por ahora. ${medida.razonamiento}`, {
          incendioId: incendio.id,
          nivel: "info",
          datos: { poblacionId: poblacion.id },
        });
        continue;
      }
      salida.push({ decision: decisionDeMedida(medida, poblacion, incendio, ctx, previas.ids, destinoDemo), medida });
    }
    return salida;
  } catch (e) {
    ctx.registrar(
      "agente",
      `No se han podido decidir las medidas de ${incendio.nombre}: ${e instanceof Error ? e.message : String(e)}`,
      { incendioId: incendio.id, nivel: "aviso" },
    );
    return [];
  }
}

/**
 * Convierte la medida que devolvió el modelo en la Decision del dominio.
 * Determinista: misma medida y mismo pueblo, misma decisión.
 */
export function decisionDeMedida(
  medida: MedidaPoblacion,
  poblacion: Poblacion,
  incendio: Incendio,
  ctx: ContextoAgente,
  decisionesPrevias: string[],
  destinoDemo?: string,
): Decision {
  const telefono = poblacion.telefono || destinoDemo;
  const tipo = TIPO_ACCION[medida.medida as keyof typeof TIPO_ACCION];
  const acciones: AccionPropuesta[] = [
    {
      tipo,
      descripcion:
        medida.medida === "avisar"
          ? `Avisar al Ayuntamiento de ${poblacion.nombre} (llamada + SMS + Telegram)`
          : medida.medida === "confinar"
            ? `Proponer confinamiento de ${poblacion.nombre}`
            : `Proponer evacuación de ${poblacion.nombre}`,
      objetivo: { poblacionId: poblacion.id, telefono, email: poblacion.email },
      parametros: {
        guion: medida.guionLlamada,
        sms: medida.textoSms.slice(0, 300),
        telefono,
        motivo: medida.resumen,
        municipio: poblacion.nombre,
        incendioId: incendio.id,
        etaMin: poblacion.etaFrenteMin,
      },
    },
    {
      tipo: "enviar_telegram",
      descripcion: `Difundir el aviso de ${poblacion.nombre} por Telegram`,
      parametros: { texto: `⚠️ ${poblacion.nombre}: ${medida.textoSms.slice(0, 300)}`, municipio: poblacion.nombre, incendioId: incendio.id, poblacionId: poblacion.id },
    },
  ];

  return decisionBase(ctx, {
    agenteId: "proteccion_poblacion",
    incendioId: incendio.id,
    titulo: medida.titulo || `${medida.medida === "avisar" ? "Aviso" : medida.medida === "confinar" ? "Confinamiento" : "Evacuación"} de ${poblacion.nombre}`,
    resumen: medida.resumen,
    razonamiento: medida.razonamiento,
    prioridad: medida.prioridad as Decision["prioridad"],
    // El aviso preventivo es autónomo por política (riesgo ≤ 20): el modelo no puede inflarlo.
    // Confinar y evacuar conservan el riesgo del modelo (≥ 70 por política → una persona).
    riesgo: medida.medida === "avisar" ? Math.min(medida.riesgo, 20) : Math.max(medida.riesgo, 70),
    acciones,
    decisionesPrevias,
    evidencias: [
      ...(incendio.meteo
        ? [
            {
              id: `ev-meteo-${poblacion.id}`,
              fuente: incendio.meteo.fuente,
              resumen: `Viento ${incendio.meteo.vientoKmh.toFixed(0)} km/h del ${incendio.meteo.direccionTexto}, HR ${incendio.meteo.humedadPct.toFixed(0)} %.`,
              url: incendio.meteo.url,
              en: incendio.meteo.horaMundo,
              confianza: 0.95,
            },
          ]
        : []),
      {
        id: `ev-eta-${poblacion.id}`,
        fuente: "Modelo de propagación (Atalaya)",
        resumen: `${poblacion.nombre}: ${poblacion.distanciaKm.toFixed(1)} km al ${gradosATexto(poblacion.rumboDesdeFuegoGrados)}, riesgo ${poblacion.riesgo}` + (poblacion.etaFrenteMin !== undefined ? `, frente en ~${poblacion.etaFrenteMin} min.` : "."),
        en: ctx.ahoraMundo,
        confianza: 0.75,
      },
    ],
  });
}
