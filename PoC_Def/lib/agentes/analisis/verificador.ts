// =====================================================================
// ATALAYA INCENDIOS · Agente "verificador" (análisis)
// ---------------------------------------------------------------------
// Propósito: convertir el ruido de entrada (llamadas, SMS, Telegram, web,
// prensa, redes, satélite, cámaras) en focos reales. Deduplica por espacio
// y tiempo, cruza con los incendios ya activos y, cuando la señal se
// sostiene, declara un foco nuevo con el orquestador.
// Vía inmediata (sesión fireops-2a): `verificarObservacionAhora(id)` verifica UNA
// observación fuera del ciclo; la llama el Vigía al ver fuego en una cámara para
// que el foco se declare o confirme en el acto. Una cámara que ve LLAMAS con
// fiabilidad ≥ 0,8 es confirmación visual: confirma el foco (aunque el origen sea
// otra cámara) y, si lo crea, nace ya "confirmado".
// DUEÑO: constructor D.
// Dependencias: lib/motor/orquestador (declararFoco), lib/ia/llm (modelo
// rápido, solo cuando la regla determinista no basta), lib/fuentes/geo,
// lib/dominio/fuentes-deteccion (fuentes apagadas por el escenario del mando:
// sus avisos se registran pero no crean ni confirman focos).
// =====================================================================
import { z } from "zod";
import type { Incendio, Observacion } from "../../dominio/tipos";
import type { Agente, ContextoAgente, ResultadoCiclo } from "../../motor/contratos";
import { canalPuedeDeclararFoco, fuenteQueBloquea } from "../../dominio/fuentes-deteccion";
import { haversine } from "../../fuentes/geo";
import { completarJson, modeloPara, proveedorDisponible } from "../../ia/llm";
import { describirFueraEspana, enEspana } from "../../dominio/espana";

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

/** Cámara que ve LLAMAS con fiabilidad alta: confirmación visual, no un indicio más. */
function evidenciaVisual(obs: Observacion): boolean {
  return obs.canal === "camara" && obs.extraccion?.tipo === "llamas" && (obs.extraccion?.fiabilidad ?? 0) >= 0.8;
}

/** Observaciones que se están verificando ahora mismo (ciclo o vía inmediata): ninguna se procesa dos veces. */
type Global = typeof globalThis & { __atalayaVerificando?: Set<string> };
const enVerificacion = (): Set<string> => ((globalThis as Global).__atalayaVerificando ??= new Set());

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
    let nuevos = 0;
    let confirmadas = 0;
    let descartadas = 0;

    for (const obs of pendientes) {
      if (ctx.abortSignal.aborted) break;
      // Se recalculan focos y observaciones en cada aviso: el anterior puede haber
      // creado el foco que este debe confirmar (antes se calculaban una vez por ciclo
      // y dos avisos del mismo fuego en el mismo ciclo abrían dos focos).
      const resultado = await procesarObservacion(obs, ctx);
      if (!resultado) continue; // ya la está verificando la vía inmediata
      if (resultado.impacto === "nuevo_foco") nuevos += 1;
      else if (resultado.impacto === "confirma" || resultado.impacto === "agrava") confirmadas += 1;
      else if (resultado.impacto === "ruido" || resultado.impacto === "duplicada") descartadas += 1;
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

/**
 * Verifica una observación pendiente, guarda el veredicto en ella y lo registra.
 * Devuelve undefined si otra vía la está verificando ya (o acaba de hacerlo).
 */
async function procesarObservacion(obs: Observacion, ctx: ContextoAgente): Promise<Veredicto | undefined> {
  const { estado } = ctx;
  const enCurso = enVerificacion();
  if (enCurso.has(obs.id) || estado.observaciones.get(obs.id)?.impacto) return undefined;
  enCurso.add(obs.id);
  try {
    const todas = [...estado.observaciones.values()];
    const resultado = await verificarUna(obs, todas, estado.incendiosActivos(), estado.reloj.factor || 12, ctx);
    estado.actualizar(estado.observaciones, obs.id, {
      impacto: resultado.impacto,
      verificacion: resultado.verificacion,
      incendioId: resultado.incendioId ?? obs.incendioId,
    });
    ctx.registrar("observacion", resultado.verificacion, {
      incendioId: resultado.incendioId,
      nivel: resultado.impacto === "nuevo_foco" ? "critico" : resultado.impacto === "agrava" ? "aviso" : "info",
      datos: { observacionId: obs.id, canal: obs.canal, impacto: resultado.impacto },
    });
    return resultado;
  } finally {
    enCurso.delete(obs.id);
  }
}

/**
 * Verifica UNA observación ahora mismo, fuera del ciclo del agente. La llama el
 * Vigía al ver fuego en una cámara: así el foco se declara o confirma segundos
 * después, sin esperar al hueco mínimo del orquestador. Devuelve undefined si la
 * observación no existe, ya estaba verificada o la está verificando el ciclo.
 */
export async function verificarObservacionAhora(obsId: string): Promise<Veredicto | undefined> {
  const { contextoParaSistema } = await import("../../motor/orquestador");
  const ctx = contextoParaSistema("verificador", AbortSignal.timeout(30_000));
  const obs = ctx.estado.observaciones.get(obsId);
  if (!obs || obs.impacto) return undefined;
  ctx.informarTarea(`Verificando en el acto el aviso de ${obs.remitente ?? obs.canal}`, obs.incendioId);
  return procesarObservacion(obs, ctx);
}

async function verificarUna(
  obs: Observacion,
  todas: Observacion[],
  activos: Incendio[],
  factor: number,
  ctx: ContextoAgente,
): Promise<Veredicto> {
  // 0. Fuente apagada por el escenario del mando: queda registrada y no toca
  //    ningún foco (ni lo crea, ni lo confirma, ni le sube la confianza).
  const bloqueo = fuenteQueBloquea(ctx.estado.ejecucion, obs);
  if (bloqueo) {
    return {
      impacto: "registrada",
      verificacion: `Fuente apagada por el escenario (${bloqueo.nombre}): el aviso queda registrado y no crea ni confirma focos. No se volverá a verificar aunque la fuente se reactive.`,
    };
  }

  // 0b. Fuera de España: el sistema solo trabaja el territorio español. Queda
  //     como ruido con el motivo y no crea ni confirma nada.
  if (obs.punto && !enEspana(obs.punto)) {
    return { impacto: "ruido", verificacion: `${describirFueraEspana(obs.punto)} No crea ni confirma focos.` };
  }

  // ¿Cae sobre un incendio que ya conocemos? (se calcula antes de la regla de
  // duplicadas: una cámara que sigue viendo el fuego de un foco conocido debe
  // confirmarlo o agravarlo, no descartarse como repetida).
  const cercano = obs.punto
    ? activos
        .map((i) => ({ i, km: haversine(i.centro, obs.punto as { lat: number; lon: number }) }))
        .filter((x) => x.km < kmConfirmaDe(obs.canal))
        .sort((a, b) => a.km - b.km)[0]
    : undefined;

  // 1. Duplicada: mismo canal, cerca y reciente (salvo cámara sobre foco conocido).
  if (obs.punto && !(obs.canal === "camara" && cercano)) {
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

  // 2. Confirma o agrava el incendio conocido.
  if (cercano) {
    const grave = obs.extraccion?.gravedad === "grave" || obs.extraccion?.gravedad === "critica";
    const { estado } = ctx;
    const visual = evidenciaVisual(obs);
    // Solo confirma una fuente de familia distinta (una noticia no confirma otra noticia),
    // salvo LLAMAS vistas por una cámara: es confirmación visual sea cual sea el origen.
    const mismaFamilia = !visual && familiaCanal(obs.canal) === familiaCanal(cercano.i.origen);
    // Misma familia (p. ej. otra noticia): suma poco y nunca pasa de 0,7; otra familia sí puede confirmar.
    const confianza = mismaFamilia
      ? Math.min(0.7, +(cercano.i.confianza + 0.05).toFixed(2))
      : Math.min(1, +Math.max(cercano.i.confianza + 0.15, visual ? (obs.extraccion?.fiabilidad ?? 0) : 0).toFixed(2));
    const nuevoEstado = !mismaFamilia && cercano.i.estado === "detectado" && confianza >= 0.7 ? "confirmado" : cercano.i.estado;
    estado.actualizar(estado.incendios, cercano.i.id, {
      confianza,
      estado: nuevoEstado,
      observaciones: [...new Set([...cercano.i.observaciones, obs.id])],
      actualizadoEn: ctx.ahoraMundo,
    });
    if (nuevoEstado !== cercano.i.estado) {
      ctx.registrar("incendio_actualizado", `${cercano.i.nombre} pasa a confirmado: ${confianza.toFixed(2)} de confianza tras ${visual ? "ver llamas la cámara" : "cruzar fuentes"}.`, {
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
      o.impacto !== "ruido" &&
      // Un aviso de una fuente apagada tampoco corrobora: si no, un píxel de
      // satélite "registrado" seguiría convirtiendo una llamada en foco.
      canalPuedeDeclararFoco(ctx.estado.ejecucion, o),
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
      // Llamas vistas por una cámara: el foco nace confirmado (la imagen está en la sala).
      estadoInicial: obs.extraccion?.situacion === "estabilizado" ? "estabilizado" : evidenciaVisual(obs) ? "confirmado" : undefined,
      mediosExternos: obs.extraccion?.mediosMencionados,
    });
    const motivo = evidenciaVisual(obs)
      ? `llamas visibles en cámara (fiabilidad ${(obs.extraccion?.fiabilidad ?? 0).toFixed(2)}): nace confirmado`
      : corroboran.length
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
