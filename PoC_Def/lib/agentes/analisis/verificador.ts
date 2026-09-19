// =====================================================================
// ATALAYA INCENDIOS · Agente "verificador" (análisis)
// ---------------------------------------------------------------------
// Propósito: convertir el ruido de entrada (llamadas, SMS, Telegram, web,
// prensa, redes, satélite, cámaras) en focos reales. Deduplica por espacio
// y tiempo, cruza con los incendios ya activos y, cuando la señal se
// sostiene, declara un foco nuevo con el orquestador.
// DUEÑO: constructor D.
// Dependencias: lib/motor/orquestador (declararFoco), lib/ia/llm (modelo
// rápido, solo cuando la regla determinista no basta), lib/fuentes/geo.
// =====================================================================
import { z } from "zod";
import type { Incendio, Observacion } from "../../dominio/tipos";
import type { Agente, ContextoAgente, ResultadoCiclo } from "../../motor/contratos";
import { haversine } from "../../fuentes/geo";
import { completarJson, modeloPara, proveedorDisponible } from "../../ia/llm";

/** Radio (km) dentro del cual dos avisos del mismo canal se consideran el mismo. */
const KM_DUPLICADA = 2;

/** Familia de una fuente: dos fuentes de la misma familia no se confirman entre sí. */
function familiaCanal(canal: string): string {
  if (canal === "prensa" || canal === "rrss") return "prensa";
  if (canal === "camara" || canal === "satelite" || canal === "sensor") return "observacion";
  if (canal === "manual") return "humano";
  return "ciudadano"; // llamada, sms, email, telegram, web
}
/** Ventana (minutos de mundo) para considerar duplicada una observación. */
const MINUTOS_DUPLICADA = 30;
/** Radio (km) dentro del cual una observación confirma un incendio ya conocido. */
const KM_CONFIRMA = 5;
/**
 * Radio (km) para prensa y redes: no traen coordenadas, se geocodifican por
 * municipio y Nominatim devuelve el centroide del término, así que dos noticias
 * del MISMO incendio pueden caer a 7-8 km una de otra y se creaban dos focos.
 * Con 10 km la segunda noticia confirma el foco en vez de duplicarlo.
 */
const KM_CONFIRMA_PRENSA = 10;
/** Canales cuya posición es un centroide municipal, no un punto medido. */
const CANALES_APROXIMADOS: Observacion["canal"][] = ["prensa", "rrss"];
const kmConfirmaDe = (canal: Observacion["canal"]): number =>
  (CANALES_APROXIMADOS.includes(canal) ? KM_CONFIRMA_PRENSA : KM_CONFIRMA);
/** Radio (km) para agrupar observaciones independientes que juntas valen un foco. */
const KM_CORROBORA = 3;

const ESQUEMA = z.object({
  esFoco: z.boolean(),
  impacto: z.enum(["ruido", "registrada", "nuevo_foco"]),
  confianza: z.number().min(0).max(1),
  explicacion: z.string(),
});

/** Minutos de mundo entre dos instantes reales, según el factor del reloj. */
function minutosMundoEntre(isoA: string, isoB: string, factor: number): number {
  const a = Date.parse(isoA);
  const b = Date.parse(isoB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return (Math.abs(a - b) / 60_000) * Math.max(1, factor);
}

const CANALES_FIABLES: Observacion["canal"][] = ["satelite", "camara", "manual"];

export const verificador: Agente = {
  id: "verificador",
  nombre: "Verificador",
  categoria: "analisis",
  descripcion: "Deduplica los avisos, los cruza con los focos conocidos y declara los focos nuevos.",
  modelo: modeloPara("rapido"),
  cadenciaSeg: 45,
  despiertaCon: ["observacion", "satelite", "camara_positiva"],

  async ciclo(ctx: ContextoAgente): Promise<ResultadoCiclo> {
    const { estado } = ctx;
    const todas = [...estado.observaciones.values()];
    const pendientes = todas.filter((o) => !o.impacto);
    if (!pendientes.length) {
      ctx.informarTarea("Sin avisos nuevos que verificar");
      return { resumen: `Sin avisos pendientes (${todas.length} verificados en total)` };
    }

    ctx.informarTarea(`Verificando ${pendientes.length} aviso(s)`);
    const factor = estado.reloj.factor || 12;
    const activos = estado.incendiosActivos();
    let nuevos = 0;
    let confirmadas = 0;
    let descartadas = 0;

    for (const obs of pendientes) {
      if (ctx.abortSignal.aborted) break;
      const resultado = await verificarUna(obs, todas, activos, factor, ctx);
      estado.actualizar(estado.observaciones, obs.id, {
        impacto: resultado.impacto,
        verificacion: resultado.verificacion,
        incendioId: resultado.incendioId ?? obs.incendioId,
      });
      if (resultado.impacto === "nuevo_foco") nuevos += 1;
      else if (resultado.impacto === "confirma" || resultado.impacto === "agrava") confirmadas += 1;
      else if (resultado.impacto === "ruido" || resultado.impacto === "duplicada") descartadas += 1;

      ctx.registrar("observacion", resultado.verificacion, {
        incendioId: resultado.incendioId,
        nivel: resultado.impacto === "nuevo_foco" ? "critico" : resultado.impacto === "agrava" ? "aviso" : "info",
        datos: { observacionId: obs.id, canal: obs.canal, impacto: resultado.impacto },
      });
    }

    return {
      resumen: `${pendientes.length} aviso(s) verificados: ${nuevos} foco(s) nuevo(s), ${confirmadas} confirmación(es), ${descartadas} descartado(s)`,
    };
  },
};

interface Veredicto {
  impacto: NonNullable<Observacion["impacto"]>;
  verificacion: string;
  incendioId?: string;
}

async function verificarUna(
  obs: Observacion,
  todas: Observacion[],
  activos: Incendio[],
  factor: number,
  ctx: ContextoAgente,
): Promise<Veredicto> {
  // 1. Duplicada: mismo canal, cerca y reciente.
  if (obs.punto) {
    const gemela = todas.find(
      (o) =>
        o.id !== obs.id &&
        o.canal === obs.canal &&
        o.punto &&
        haversine(o.punto, obs.punto as { lat: number; lon: number }) < Math.max(KM_DUPLICADA, kmConfirmaDe(obs.canal)) &&
        minutosMundoEntre(o.recibidaEn, obs.recibidaEn, factor) < MINUTOS_DUPLICADA,
    );
    if (gemela) {
      return {
        impacto: "duplicada",
        incendioId: gemela.incendioId,
        verificacion: `Duplicado del aviso ${gemela.id} (mismo canal ${obs.canal}, a menos de ${KM_DUPLICADA} km y ${MINUTOS_DUPLICADA} min).`,
      };
    }
  }

  // 2. ¿Cae sobre un incendio que ya conocemos?
  const cercano = obs.punto
    ? activos
        .map((i) => ({ i, km: haversine(i.centro, obs.punto as { lat: number; lon: number }) }))
        .filter((x) => x.km < kmConfirmaDe(obs.canal))
        .sort((a, b) => a.km - b.km)[0]
    : undefined;

  if (cercano) {
    const grave = obs.extraccion?.gravedad === "grave" || obs.extraccion?.gravedad === "critica";
    const { estado } = ctx;
    // Solo confirma una fuente de familia distinta (una noticia no confirma otra noticia).
    const mismaFamilia = familiaCanal(obs.canal) === familiaCanal(cercano.i.origen);
    // Misma familia (p. ej. otra noticia): suma poco y nunca pasa de 0,7; otra familia sí puede confirmar.
    const confianza = mismaFamilia
      ? Math.min(0.7, +(cercano.i.confianza + 0.05).toFixed(2))
      : Math.min(1, +(cercano.i.confianza + 0.15).toFixed(2));
    const nuevoEstado = !mismaFamilia && cercano.i.estado === "detectado" && confianza >= 0.7 ? "confirmado" : cercano.i.estado;
    estado.actualizar(estado.incendios, cercano.i.id, {
      confianza,
      estado: nuevoEstado,
      observaciones: [...new Set([...cercano.i.observaciones, obs.id])],
      actualizadoEn: ctx.ahoraMundo,
    });
    if (nuevoEstado !== cercano.i.estado) {
      ctx.registrar("incendio_actualizado", `${cercano.i.nombre} pasa a confirmado: ${confianza.toFixed(2)} de confianza tras cruzar fuentes.`, {
        incendioId: cercano.i.id,
        nivel: "aviso",
      });
    }
    return {
      impacto: grave ? "agrava" : "confirma",
      incendioId: cercano.i.id,
      verificacion: grave
        ? `Agrava ${cercano.i.nombre}: aviso por ${obs.canal} a ${cercano.km.toFixed(1)} km con gravedad ${obs.extraccion?.gravedad}. Confianza ${confianza.toFixed(2)}.`
        : `Confirma ${cercano.i.nombre}: aviso por ${obs.canal} a ${cercano.km.toFixed(1)} km. Confianza ${confianza.toFixed(2)}.`,
    };
  }

  // 3. Sin incendio cerca: ¿hay señal suficiente para declarar un foco?
  if (!obs.punto) {
    return {
      impacto: "registrada",
      verificacion: `Aviso por ${obs.canal} sin localización: no se puede declarar foco. Queda registrado para cruzarlo con lo que llegue.`,
    };
  }

  const corroboran = todas.filter(
    (o) =>
      o.id !== obs.id &&
      o.punto &&
      o.canal !== obs.canal &&
      haversine(o.punto, obs.punto as { lat: number; lon: number }) < KM_CORROBORA &&
      o.impacto !== "ruido",
  );

  const extraccionFiable = obs.extraccion?.esIncendio === true && (obs.extraccion?.fiabilidad ?? 0) >= 0.6;
  const canalFiable = CANALES_FIABLES.includes(obs.canal);
  const suficiente = extraccionFiable || canalFiable || corroboran.length >= 1;

  if (!suficiente) {
    // 4. Duda: se pregunta al modelo rápido con el vecindario como contexto.
    const juicio = await consultarModelo(obs, corroboran, activos, ctx.abortSignal);
    if (!juicio) {
      return {
        impacto: obs.extraccion?.esIncendio === false ? "ruido" : "registrada",
        verificacion:
          obs.extraccion?.esIncendio === false
            ? `El extractor descarta que sea un incendio (${obs.extraccion?.resumen ?? "sin resumen"}).`
            : `Señal débil por ${obs.canal} (fiabilidad ${(obs.extraccion?.fiabilidad ?? 0).toFixed(2)}) y sin corroboración: queda registrada a la espera de más fuentes.`,
      };
    }
    if (juicio.impacto !== "nuevo_foco") {
      return { impacto: juicio.impacto, verificacion: `${juicio.explicacion} (modelo rápido, confianza ${juicio.confianza.toFixed(2)}).` };
    }
  }

  // 5. Declaración del foco con el orquestador (enriquece con OSM, meteo, unidades…).
  try {
    const { declararFoco } = await import("../../motor/orquestador");
    const incendio = await declararFoco({
      punto: obs.punto,
      origen: obs.canal === "rrss" || obs.canal === "prensa" ? "prensa" : (obs.canal as Parameters<typeof declararFoco>[0]["origen"]),
      observacionId: obs.id,
      // Una sola fuente de prensa/redes nunca pasa de 0,7: confirmar exige otra familia de fuente.
      confianza: Math.min(
        obs.canal === "prensa" || obs.canal === "rrss" ? 0.7 : 1,
        extraccionFiable ? Math.max(0.6, obs.extraccion?.fiabilidad ?? 0.6) : canalFiable ? 0.7 : 0.55,
      ),
      // Lo que dice la fuente NO son notas del mando: va en resumenFuente/fuenteDeteccion.
      resumenFuente: obs.extraccion?.resumen ?? obs.texto.slice(0, 200),
      fuenteDeteccion: obs.remitente ?? obs.canal,
      fuenteUrl: obs.urlFuente,
      areaHa: obs.extraccion?.areaHa,
      nivelGravedad: obs.extraccion?.nivelDeclarado,
      estadoInicial: obs.extraccion?.situacion === "estabilizado" ? "estabilizado" : undefined,
      mediosExternos: obs.extraccion?.mediosMencionados,
    });
    const motivo = corroboran.length
      ? `${corroboran.length + 1} fuentes independientes a menos de ${KM_CORROBORA} km`
      : canalFiable
        ? `fuente ${obs.canal}`
        : `extracción fiable (${(obs.extraccion?.fiabilidad ?? 0).toFixed(2)})`;
    return {
      impacto: "nuevo_foco",
      incendioId: incendio.id,
      verificacion: `Foco nuevo declarado (${incendio.nombre}) por ${motivo}: ${obs.extraccion?.resumen ?? obs.texto.slice(0, 120)}`,
    };
  } catch (e) {
    return {
      impacto: "registrada",
      verificacion: `No se ha podido declarar el foco: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Consulta al modelo rápido cuando las reglas no deciden. Devuelve undefined si no hay proveedor. */
async function consultarModelo(obs: Observacion, vecinas: Observacion[], activos: Incendio[], signal?: AbortSignal): Promise<z.infer<typeof ESQUEMA> | undefined> {
  if (!proveedorDisponible()) return undefined;
  try {
    const contexto = [
      `AVISO A VERIFICAR (canal ${obs.canal}, recibido ${obs.recibidaEn}):`,
      obs.texto.slice(0, 800),
      obs.extraccion ? `Extracción previa: ${JSON.stringify(obs.extraccion)}` : "Sin extracción previa.",
      "",
      vecinas.length
        ? `AVISOS CERCANOS (${vecinas.length}):\n${vecinas.map((v) => `- [${v.canal}] ${v.texto.slice(0, 160)}`).join("\n")}`
        : "No hay otros avisos cerca.",
      activos.length ? `Incendios activos ahora: ${activos.map((i) => `${i.nombre} (${i.municipio})`).join(", ")}` : "No hay incendios activos.",
    ].join("\n");

    const r = await completarJson({
      system:
        "Eres el verificador de una sala de coordinación de incendios forestales en España. Decides si un aviso es ruido, " +
        "si merece quedar registrado a la espera de más fuentes, o si hay señal suficiente para declarar un foco nuevo. " +
        "Declarar un foco moviliza medios reales: no lo hagas con un rumor, pero tampoco dejes pasar un aviso creíble de humo o llamas. " +
        "Responde en español, en una frase.",
      user: contexto,
      esquema: ESQUEMA,
      nombreEsquema: "verificacion_observacion",
      papel: "rapido",
      // 4000: qwen3.6 razona antes de contestar y con 400 (subido a 1500 por el
      // mínimo de llm.ts) se gastaba el presupuesto pensando y devolvía contenido
      // vacío, obligando a un reintento con el doble → el doble de latencia.
      maxTokens: 4000,
      signal,
    });
    return r.datos;
  } catch {
    return undefined;
  }
}
