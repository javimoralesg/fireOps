// =====================================================================
// ATALAYA INCENDIOS · Lógica compartida de los webhooks de HappyRobot
// ---------------------------------------------------------------------
// Propósito: las cuatro rutas /api/webhooks/happyrobot/* hacen lo mismo con
// pequeñas variaciones, así que la verificación del secreto, la lectura
// tolerante del cuerpo (HappyRobot puede nombrar los campos de varias
// formas) y el enganche con la centralita viven aquí.
// DUEÑO: constructor D.
// =====================================================================
import type { Accion, CanalComunicacion, Decision, EstadoAviso } from "../dominio/tipos";
import { obtenerEstado } from "../motor/estado";
import { emitir } from "../motor/orquestador";
import { error, json } from "../motor/respuestas";
import { verificarWebhook } from "./cliente";
import { marcarLlamadaAtendida } from "./llamadas-atendidas";

export type CanalEntrada = "llamada" | "sms" | "email";

/** Lee el primer campo con contenido de entre varios nombres posibles. */
export function primerTexto(cuerpo: Record<string, unknown>, claves: string[]): string | undefined {
  for (const k of claves) {
    const v = cuerpo[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function primerNumero(cuerpo: Record<string, unknown>, claves: string[]): number | undefined {
  for (const k of claves) {
    const v = cuerpo[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

function esVerdadero(v: unknown): boolean {
  return v === true || v === "true" || v === "yes" || v === "si" || v === "sí" || v === 1 || v === "1";
}

async function leerCuerpo(peticion: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const bruto = (await peticion.json()) as unknown;
    if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) {
      const obj = bruto as Record<string, unknown>;
      // HappyRobot puede envolver los datos en { data: {...} } o { payload: {...} }.
      const anidado = (obj.data ?? obj.payload ?? obj.result) as Record<string, unknown> | undefined;
      return anidado && typeof anidado === "object" && !Array.isArray(anidado) ? { ...anidado, ...obj } : obj;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Entrada de una conversación (llamada al 112 virtual, SMS o correo del
 * ciudadano). Entrega el texto a la centralita, que extrae lugar y gravedad.
 */
export async function entradaHappyRobot(peticion: Request, canal: CanalEntrada): Promise<Response> {
  if (!verificarWebhook(peticion.headers)) return error("Cabecera x-webhook-secret ausente o incorrecta", 401);
  const cuerpo = await leerCuerpo(peticion);
  if (!cuerpo) return error("El cuerpo debe ser JSON", 400);

  // Con contenido de verdad: ni vacío, ni variable sin resolver de HappyRobot, ni una transcripción vacía ("[]").
  const conContenido = (v: unknown): boolean =>
    typeof v === "string" ? v.trim() !== "" && !/^\{\{\$var:/.test(v.trim()) && !/^(\[\]|\{\})$/.test(v.trim()) : typeof v === "number" || typeof v === "boolean";
  const textoCampo = primerTexto(cuerpo, ["transcripcion", "transcript", "texto", "mensaje", "message", "body", "resumen", "summary"]);
  const textoUtil = textoCampo && conContenido(textoCampo) ? textoCampo : undefined;
  // Nada que registrar: la plataforma "prueba" el nodo con las variables sin resolver (todo vacío) y una
  // llamada colgada sin hablar no trae transcripción. Antes se guardaba el JSON crudo como aviso y la
  // centralita gastaba una llamada de IA en analizarlo (medido el 19-09: dos avisos basura).
  if (!textoUtil && (canal === "llamada" || !Object.values(cuerpo).some(conContenido))) {
    return json({ recibido: false, motivo: "Sin transcripción ni texto: nada que registrar" });
  }
  const texto = textoUtil ?? JSON.stringify(cuerpo).slice(0, 1500);
  const remitente = primerTexto(cuerpo, ["telefono", "phone_number", "from", "remitente", "caller", "email", "from_email"]);
  const referencia = primerTexto(cuerpo, ["run_id", "runId", "call_id", "id", "message_id", "referencia"]);
  const lugar = primerTexto(cuerpo, ["lugar", "ubicacion", "location", "direccion", "address"]);
  const lat = primerNumero(cuerpo, ["lat", "latitude", "latitud"]);
  const lon = primerNumero(cuerpo, ["lon", "lng", "longitude", "longitud"]);

  // 112 virtual por teléfono (sesión fireops-82): si la herramienta registrar_aviso ya
  // creó la observación de este run durante la llamada, la transcripción se ADJUNTA a
  // ella. Misma llamada = una sola observación; nunca una segunda que el verificador
  // tendría que descartar como duplicada.
  if (canal === "llamada" && referencia) {
    const { adjuntarTranscripcion } = await import("./entrante");
    const existente = adjuntarTranscripcion(referencia, texto, remitente);
    if (existente) {
      // La llamada llegó entera: la recuperación (lib/happyrobot/recuperar-llamadas.ts) no tiene que volver a mirarla.
      marcarLlamadaAtendida(referencia);
      return json({ recibido: true, observacionId: existente.id, impacto: existente.impacto ?? null, adjuntada: true });
    }
  }

  try {
    const { procesarEntrada } = await import("../agentes/percepcion/centralita");
    const observacion = await procesarEntrada({
      canal,
      texto: lugar && !texto.includes(lugar) ? `${texto}\n\nLugar indicado: ${lugar}` : texto,
      remitente,
      referenciaExterna: referencia,
      punto: lat !== undefined && lon !== undefined ? { lat, lon } : undefined,
    });
    if (canal === "llamada" && referencia) marcarLlamadaAtendida(referencia);
    return json({ recibido: true, observacionId: observacion.id, impacto: observacion.impacto ?? null });
  } catch (e) {
    return error(`No se pudo procesar la entrada de HappyRobot: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
}

/** Busca la acción por sus ids, o por la referencia del run si los ids vienen vacíos. */
function localizar(decisionId: string | undefined, accionId: string | undefined, referencia: string | undefined): { decision: Decision; accion: Accion } | undefined {
  const estado = obtenerEstado();
  if (decisionId && accionId) {
    const decision = estado.decisiones.get(decisionId);
    const accion = decision?.acciones.find((a) => a.id === accionId);
    if (decision && accion) return { decision, accion };
  }
  if (referencia) {
    for (const decision of estado.decisiones.values()) {
      const accion = decision.acciones.find((a) => a.resultado?.referencia === referencia);
      if (accion) return { decision, accion };
    }
  }
  return undefined;
}

/**
 * Resultado de una acción disparada por nosotros: la llamada se contestó o
 * no, el ayuntamiento confirmó o no. Es lo que cierra el círculo y lo que
 * convierte "avisando" en "avisado" o "sin_respuesta".
 */
export async function resultadoHappyRobot(peticion: Request): Promise<Response> {
  if (!verificarWebhook(peticion.headers)) return error("Cabecera x-webhook-secret ausente o incorrecta", 401);
  const cuerpo = await leerCuerpo(peticion);
  if (!cuerpo) return error("El cuerpo debe ser JSON", 400);

  const decisionId = primerTexto(cuerpo, ["decisionId", "decision_id"]);
  const accionId = primerTexto(cuerpo, ["accionId", "accion_id", "action_id"]);
  const referencia = primerTexto(cuerpo, ["ref", "run_id", "runId", "call_id", "id"]);
  const encontrado = localizar(decisionId, accionId, referencia);
  if (!encontrado) {
    // SMS del agente del 112 al teléfono del .env (lib/happyrobot/sms-avisos.ts, sesión fireops-00):
    // detrás no hay Decision/Accion, así que el resultado se anota por la referencia del run.
    if (referencia) {
      const { anotarResultadoSms } = await import("./sms-avisos");
      const okSms = esVerdadero(cuerpo.ok ?? cuerpo.success ?? cuerpo.exito) || cuerpo.status === "completed";
      const detalleSms = primerTexto(cuerpo, ["detalle", "summary", "resumen", "error", "status"]) ?? (okSms ? "completado" : "fallido");
      const anotado = anotarResultadoSms(referencia, cuerpo, okSms, detalleSms);
      if (anotado) return json({ recibido: true, smsAgente: true, referencia, ok: okSms });
    }
    return error(`No se encuentra la acción (decisionId=${decisionId ?? "-"}, accionId=${accionId ?? "-"}, ref=${referencia ?? "-"})`, 404);
  }

  const { decision, accion } = encontrado;
  const estado = obtenerEstado();
  const transcripcion = primerTexto(cuerpo, ["transcripcion", "transcript", "detalle", "summary", "resumen", "outcome"]);
  const contestada = "contestada" in cuerpo || "answered" in cuerpo ? esVerdadero(cuerpo.contestada ?? cuerpo.answered) : undefined;
  const confirmado = "confirmado" in cuerpo || "confirmed" in cuerpo ? esVerdadero(cuerpo.confirmado ?? cuerpo.confirmed) : undefined;
  const ok = esVerdadero(cuerpo.ok ?? cuerpo.success ?? cuerpo.exito) || cuerpo.status === "completed" || contestada === true;

  const resumen =
    (transcripcion ? `${transcripcion}` : "Resultado recibido de HappyRobot") +
    (contestada !== undefined ? ` · ${contestada ? "contestada" : "sin respuesta"}` : "") +
    (confirmado !== undefined ? ` · ${confirmado ? "confirmado" : "no confirmado"}` : "");

  // AUDITORÍA: el resultado del webhook se AÑADE a lo que ya había (payload
  // enviado, respuesta de la API, duración); nunca se sustituye.
  const acciones = decision.acciones.map((a) =>
    a.id === accion.id
      ? {
          ...a,
          estado: (ok ? "ejecutada" : a.estado === "ejecutada" ? "ejecutada" : "fallida") as Accion["estado"],
          resultado: {
            en: new Date().toISOString(),
            proveedor: "HappyRobot",
            referencia: referencia ?? a.resultado?.referencia,
            resumen: a.resultado?.resumen ? `${a.resultado.resumen} → ${resumen}` : resumen,
            exito: ok,
            datos: {
              ...(a.resultado?.datos ?? {}),
              transcripcion,
              contestada,
              confirmado,
              webhook: JSON.stringify(cuerpo).slice(0, 2048),
              webhookRecibidoEn: new Date().toISOString(),
            },
          },
        }
      : a,
  );
  estado.actualizar(estado.decisiones, decision.id, { acciones });

  // Avisos a población: el resultado real decide si el pueblo quedó avisado.
  const poblacionId = accion.objetivo?.poblacionId ?? (typeof accion.parametros?.poblacionId === "string" ? (accion.parametros.poblacionId as string) : undefined);
  const esAviso = accion.tipo === "avisar_poblacion" || accion.tipo === "confinar_poblacion" || accion.tipo === "evacuar_poblacion";
  if (esAviso && poblacionId) {
    const poblacion = estado.poblaciones.get(poblacionId);
    if (poblacion) {
      const canal: CanalComunicacion = accion.tipo === "avisar_poblacion" ? "llamada" : "llamada";
      const nuevoEstadoAviso =
        contestada === false
          ? "sin_respuesta"
          : accion.tipo === "avisar_poblacion"
            ? "avisado"
            : accion.tipo === "confinar_poblacion"
              ? "confinado"
              : "evacuando";
      estado.actualizar(estado.poblaciones, poblacionId, {
        estadoAviso: nuevoEstadoAviso,
        ultimoContacto: { en: estado.reloj.ahoraMundo, canal, resultado: resumen },
      });
      emitir("poblacion_avisada", `${poblacion.nombre}: ${contestada === false ? "no contestan al teléfono del ayuntamiento" : confirmado ? "el ayuntamiento confirma que activa el aviso" : "aviso entregado"}.`, {
        incendioId: decision.incendioId,
        nivel: contestada === false ? "aviso" : "info",
        datos: { poblacionId, decisionId: decision.id, accionId: accion.id },
      });
    }
  }

  if (contestada === true) estado.ejecucion.metricas.llamadasContestadas += 1;

  emitir(ok ? "accion_ejecutada" : "accion_fallida", `Resultado de "${accion.descripcion}": ${resumen}`, {
    agenteId: decision.agenteId,
    incendioId: decision.incendioId,
    nivel: ok ? "info" : "aviso",
    datos: { decisionId: decision.id, accionId: accion.id, referencia, resumen, transcripcion, contestada, confirmado },
  });

  return json({ recibido: true, decisionId: decision.id, accionId: accion.id, ok });
}
