// =====================================================================
// ATALAYA INCENDIOS · Agente "proteccion_poblacion" (planificación)
// ---------------------------------------------------------------------
// Propósito: decidir, pueblo a pueblo y por orden de tiempo de llegada del
// frente, si se avisa, se confina o se evacúa; y escribir el guion de la
// llamada al ayuntamiento y el SMS/Telegram que recibirán los vecinos.
// Confinar y evacuar los ORDENA el director del plan: aquí se propone y
// la política lo deja en "humano". DUEÑO: constructor D.
// Dependencias: lib/ia/llm (razonamiento).
// =====================================================================
import { z } from "zod";
import type { Decision, Poblacion } from "../../dominio/tipos";
import type { Agente, ContextoAgente, ResultadoCiclo } from "../../motor/contratos";
import { duracionLegible, kmLegible } from "../../dominio/tiempo-legible";
import { gradosATexto } from "../../fuentes/geo";
import { completarJson, modeloPara, proveedorDisponible } from "../../ia/llm";
import { bloqueDecisionesPrevias, bloqueLecciones, decisionBase, DOCTRINA_ESPANA, fichaIncendio, hayEquivalenteViva, type AccionPropuesta } from "./comun";

/**
 * Máximo de pueblos que se tratan en un ciclo (los más urgentes).
 * 2, no 4: con `maxTokens: 6000` cada pueblo cuesta ~25 s de razonamiento y con 4
 * el ciclo superaba el tiempo máximo (medido 2026-09-19: traza "cancelado" a los
 * 90 s) — y al cancelarse se PERDÍAN también las decisiones ya redactadas en ese
 * ciclo, porque el orquestador descarta el resultado del ciclo abortado.
 */
const MAX_POR_CICLO = 2;

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

const ESQUEMA = z.object({
  medida: z.enum(["avisar", "confinar", "evacuar", "esperar"]),
  titulo: z.string(),
  resumen: z.string(),
  razonamiento: z.string(),
  prioridad: z.number().int().min(1).max(5),
  riesgo: z.number().min(0).max(100),
  guionLlamada: z.string(),
  textoSms: z.string(),
});

const TIPO_ACCION = { avisar: "avisar_poblacion", confinar: "confinar_poblacion", evacuar: "evacuar_poblacion" } as const;

export const proteccionPoblacion: Agente = {
  id: "proteccion_poblacion",
  nombre: "Protección de población",
  categoria: "planificacion",
  descripcion: "Decide a qué pueblos se avisa, confina o evacúa, y redacta el SMS al ayuntamiento y el mensaje a los vecinos (la voz saliente está desactivada).",
  modelo: modeloPara("razonamiento"),
  cadenciaSeg: 60,
  // 180 s: dos pueblos × ~25 s de razonamiento más el ida y vuelta del RAG caben de
  // sobra; con el límite por defecto de 90 s el ciclo moría a la mitad.
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

    const decisiones: Decision[] = [];
    const tratadas: string[] = [];

    for (const poblacion of candidatas.slice(0, MAX_POR_CICLO)) {
      if (ctx.abortSignal.aborted) break;
      const incendio = estado.incendios.get(poblacion.incendioId);
      if (!incendio) continue;

      // Si un pueblo ya avisado no ha empeorado, no se insiste.
      if (poblacion.estadoAviso === "avisado" && poblacion.riesgo !== "inminente") continue;
      const yaViva =
        hayEquivalenteViva(ctx, "proteccion_poblacion", incendio.id, "avisar_poblacion", poblacion.id) ||
        hayEquivalenteViva(ctx, "proteccion_poblacion", incendio.id, "confinar_poblacion", poblacion.id) ||
        hayEquivalenteViva(ctx, "proteccion_poblacion", incendio.id, "evacuar_poblacion", poblacion.id);
      if (yaViva) continue;

      ctx.informarTarea(`Decidiendo la medida para ${poblacion.nombre} (riesgo ${poblacion.riesgo})`, incendio.id);
      const decision = await decidirPoblacion(poblacion, incendio.id, ctx);
      if (decision) {
        decisiones.push(decision);
        tratadas.push(`${poblacion.nombre} → ${decision.acciones[0]?.tipo.replace("_poblacion", "")}`);
      }
    }

    return {
      resumen: tratadas.length ? `Medidas propuestas: ${tratadas.join(" · ")}` : `${candidatas.length} población(es) en riesgo, sin medidas nuevas`,
      decisiones,
    };
  },
};

async function decidirPoblacion(poblacion: Poblacion, incendioId: string, ctx: ContextoAgente): Promise<Decision | undefined> {
  const { estado } = ctx;
  const incendio = estado.incendios.get(incendioId);
  if (!incendio) return undefined;
  const previas = bloqueDecisionesPrevias(ctx, incendioId);
  const destinoDemo = process.env.DESTINO_DEMO?.trim() || process.env.TELEFONO_AVISOS_SMS?.trim();
  const organismo = process.env.ORGANISMO_NOMBRE?.trim() || "Centro de Coordinación de Incendios Forestales";

  const ficha = [
    fichaIncendio(incendio),
    "",
    `POBLACIÓN A PROTEGER: ${poblacion.nombre} (id ${poblacion.id})`,
    `- Tipo: ${poblacion.tipo}${poblacion.habitantes !== undefined ? ` · ${poblacion.habitantes} habitantes` : ""}`,
    `- Situación: a ${poblacion.distanciaKm.toFixed(1)} km al ${gradosATexto(poblacion.rumboDesdeFuegoGrados)} del foco`,
    `- Riesgo: ${poblacion.riesgo}${poblacion.etaFrenteMin !== undefined ? ` · el frente llegaría en unas ${duracionLegible(poblacion.etaFrenteMin)} (escríbelo así en el SMS, nunca en minutos sueltos)` : " · fuera de la trayectoria actual"}`,
    `- Estado de aviso: ${poblacion.estadoAviso}`,
    poblacion.vulnerables?.length
      ? `- Colectivos vulnerables cerca: ${poblacion.vulnerables.map((v) => `${v.tipo} "${v.nombre}"`).join(", ")}`
      : "- Sin colectivos vulnerables registrados en OSM.",
    poblacion.telefono ? `- Teléfono de contacto: ${poblacion.telefono}` : `- Sin teléfono en OSM: se usará el número de demostración (${destinoDemo || "SIN DESTINO_DEMO ni TELEFONO_AVISOS_SMS configurados"}).`,
    "",
    `Medios ya desplegados en el foco: ${estado.unidadesDe(incendioId).length || "ninguno"}.`,
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
        "\n\nCriterio de la medida (ajústalo con el resto de datos, no lo apliques a ciegas):\n" +
        "- 'avisar': aviso preventivo. El frente está lejos o fuera de trayectoria, pero conviene que el ayuntamiento esté sobre aviso.\n" +
        "- 'confinar': el frente llega pronto y la salida por carretera puede ser peor que quedarse dentro (humo, vía única, " +
        "carretera en la trayectoria). Ventanas y puertas cerradas, sin salir.\n" +
        "- 'evacuar': hay tiempo suficiente para salir y quedarse es peor que irse; obligatorio si hay colectivos vulnerables " +
        "(residencias, campings, colegios) que necesitan más tiempo.\n" +
        "- 'esperar': no hay nada que hacer todavía; explícalo.\n\n" +
        "Escribe SIEMPRE:\n" +
        `- guionLlamada: texto para el ayuntamiento; va por SMS (la voz saliente está desactivada), así que máximo 300 caracteres. ` +
        `Debe decir quién avisa ("${organismo}"), qué ocurre (incendio, dónde, a qué distancia, tiempo estimado), qué se le pide ` +
        "exactamente, y pedir que confirmen por SMS que lo activan.\n" +
        "- textoSms: mensaje para los vecinos, máximo 300 caracteres, claro, sin tecnicismos, con la instrucción concreta y sin alarmismo.\n" +
        "- razonamiento: 3 a 5 frases. Si propones confinar o evacuar, di explícitamente que la orden corresponde al Director del Plan " +
        "y que esta sala solo la propone.",
      user: ficha,
      esquema: ESQUEMA,
      nombreEsquema: "medida_poblacion",
      papel: "razonamiento",
      maxTokens: 6000,
      signal: ctx.abortSignal,
    });
    const plan = r.datos;
    if (plan.medida === "esperar") {
      ctx.registrar("agente", `${poblacion.nombre}: sin medida por ahora. ${plan.razonamiento}`, { incendioId, nivel: "info", datos: { poblacionId: poblacion.id } });
      return undefined;
    }

    const telefono = poblacion.telefono || destinoDemo;
    const tipo = TIPO_ACCION[plan.medida];
    const acciones: AccionPropuesta[] = [
      {
        tipo,
        descripcion:
          plan.medida === "avisar"
            ? `Avisar al Ayuntamiento de ${poblacion.nombre} (SMS + Telegram)`
            : plan.medida === "confinar"
              ? `Proponer confinamiento de ${poblacion.nombre}`
              : `Proponer evacuación de ${poblacion.nombre}`,
        objetivo: { poblacionId: poblacion.id, telefono, email: poblacion.email },
        parametros: {
          guion: plan.guionLlamada,
          sms: plan.textoSms.slice(0, 300),
          telefono,
          motivo: plan.resumen,
          municipio: poblacion.nombre,
          incendioId,
          etaMin: poblacion.etaFrenteMin,
        },
      },
      {
        tipo: "enviar_telegram",
        descripcion: `Difundir el aviso de ${poblacion.nombre} por Telegram`,
        parametros: { texto: `⚠️ ${poblacion.nombre}: ${plan.textoSms.slice(0, 300)}`, municipio: poblacion.nombre, incendioId, poblacionId: poblacion.id },
      },
    ];

    return decisionBase(ctx, {
      agenteId: "proteccion_poblacion",
      incendioId,
      titulo: plan.titulo || `${plan.medida === "avisar" ? "Aviso" : plan.medida === "confinar" ? "Confinamiento" : "Evacuación"} de ${poblacion.nombre}`,
      resumen: plan.resumen,
      razonamiento: plan.razonamiento,
      prioridad: plan.prioridad as Decision["prioridad"],
      // El aviso preventivo es autónomo por política (riesgo ≤ 20): el modelo no puede inflarlo.
      // Confinar y evacuar conservan el riesgo del modelo (≥ 70 por política → una persona).
      riesgo: plan.medida === "avisar" ? Math.min(plan.riesgo, 20) : Math.max(plan.riesgo, 70),
      acciones,
      decisionesPrevias: previas.ids,
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
          resumen: `${poblacion.nombre}: ${kmLegible(poblacion.distanciaKm)} al ${gradosATexto(poblacion.rumboDesdeFuegoGrados)}, riesgo ${poblacion.riesgo}` + (poblacion.etaFrenteMin !== undefined ? `, frente en unas ${duracionLegible(poblacion.etaFrenteMin)}.` : "."),
          en: ctx.ahoraMundo,
          confianza: 0.75,
        },
      ],
    });
  } catch (e) {
    ctx.registrar("agente", `No se ha podido decidir la medida para ${poblacion.nombre}: ${e instanceof Error ? e.message : String(e)}`, { incendioId, nivel: "aviso" });
    return undefined;
  }
}
