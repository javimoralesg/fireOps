// =====================================================================
// ATALAYA INCENDIOS · Ejecutor de acciones reales
// ---------------------------------------------------------------------
// Propósito: convertir cada Accion aprobada en un efecto REAL fuera del
// sistema: una llamada de voz y un SMS por HappyRobot, un mensaje de
// Telegram, un correo, una unidad que sale por carretera con OSRM, una
// cámara puesta en vigilancia, un comunicado publicado en el portal.
// DUEÑO: constructor D.
//
// PRINCIPIO INNEGOCIABLE: nada simulado. Si falta el workflow de
// HappyRobot, el token de Telegram o el destino, la acción queda FALLIDA
// con el nombre exacto de la variable que falta ("Falta
// HAPPYROBOT_WORKFLOW_SLUG_VOZ"). Nunca se finge un envío.
//
// AUDITORÍA (requisito de Javi, 2026-09-19): toda acción deja en
// `accion.resultado.datos` el payload enviado (sin secretos), la respuesta
// cruda recortada a 2 KB, el destino parcialmente enmascarado y la duración
// real, además de un evento `accion_ejecutada` / `accion_fallida` con
// {decisionId, accionId, tipo, referencia}. Con eso, el redactor de informes
// (constructor C) puede levantar el acta de cualquier cosa que pasara.
//
// Dependencias: lib/happyrobot/cliente, lib/telegram/cliente,
// ./despachador (OSRM), lib/motor/orquestador (cerrarIncendio).
// =====================================================================
import type { Accion, Comunicado, Decision, Punto, Ticket } from "../../dominio/tipos";
import type { ContextoAgente, EjecutorAcciones } from "../../motor/contratos";
import { nuevoId } from "../../motor/ids";
import { enviarEmail, enviarSms, llamar, type ResultadoEnvio } from "../../happyrobot/cliente";
import { chatDemo, enviarMensaje as enviarTelegram, enviarMensajeTrazado } from "../../telegram/cliente";
import { asignar, retirar } from "./despachador";

const variable = (clave: string): string | undefined => process.env[clave]?.trim() || undefined;
const destinoDemo = () => variable("DESTINO_DEMO");
const emailDemo = () => variable("EMAIL_DEMO");
const organismo = () => variable("ORGANISMO_NOMBRE") || "Centro de Coordinación de Incendios Forestales";

/** Tipos de acción que este ejecutor sabe llevar a cabo. */
const SOPORTADAS: Accion["tipo"][] = [
  "llamar",
  "enviar_sms",
  "enviar_email",
  "enviar_telegram",
  "desplegar_unidad",
  "reasignar_unidad",
  "retirar_unidad",
  "solicitar_medios_aereos",
  "avisar_poblacion",
  "confinar_poblacion",
  "evacuar_poblacion",
  "cortar_carretera",
  "publicar_comunicado",
  "elevar_nivel",
  "declarar_controlado",
  "abrir_ticket",
  "vigilar_camara",
  "solicitar_confirmacion",
];

const texto = (v: unknown, porDefecto = ""): string => (typeof v === "string" && v.trim() ? v.trim() : porDefecto);
const numero = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function exito(accion: Accion, proveedor: string, resumen: string, referencia?: string, datos?: Record<string, unknown>): Accion {
  const en = new Date().toISOString();
  return { ...accion, estado: "ejecutada", ejecutadaEn: en, resultado: { en, proveedor, referencia, resumen, exito: true, datos } };
}

function fallo(accion: Accion, proveedor: string, resumen: string, datos?: Record<string, unknown>): Accion {
  const en = new Date().toISOString();
  return { ...accion, estado: "fallida", ejecutadaEn: en, resultado: { en, proveedor, resumen, exito: false, datos } };
}

const mensajeDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------
// Auditoría: cada acción deja constancia de qué se mandó y qué contestaron
// ---------------------------------------------------------------------

/** Enmascara parcialmente un teléfono, correo o chat para el acta. */
export function enmascarar(destino?: string): string | undefined {
  if (!destino) return undefined;
  const v = destino.trim();
  if (v.includes("@")) {
    const [usuario, dominio] = v.split("@");
    return `${usuario.slice(0, 2)}***@${dominio}`;
  }
  return v.length <= 5 ? "***" : `${v.slice(0, 4)}***${v.slice(-2)}`;
}

/** Datos de auditoría de un envío por HappyRobot. */
function trazaEnvio(r: ResultadoEnvio, destino?: string): Record<string, unknown> {
  return {
    peticion: r.peticion,
    respuesta: r.respuesta,
    urlPeticion: r.urlPeticion,
    destino: enmascarar(destino),
    duracionMs: r.duracionMs,
    referencia: r.referencia,
    urlRun: r.url,
  };
}

/** Contexto que viaja en el payload de HappyRobot para que el agente de voz sepa de qué habla. */
function contextoComun(decision: Decision, accion: Accion, ctx: ContextoAgente): Record<string, unknown> {
  const incendio = decision.incendioId ? ctx.estado.incendios.get(decision.incendioId) : undefined;
  return {
    organismo: organismo(),
    incendio: incendio ? `${incendio.nombre} (${incendio.municipio}, ${incendio.provincia})` : "incendio forestal",
    municipio: texto(accion.parametros.municipio, incendio?.municipio ?? ""),
    nivel: incendio?.nivelGravedad,
    superficieHa: incendio?.areaHa,
    tituloDecision: decision.titulo,
    resumenDecision: decision.resumen,
  };
}

// ---------------------------------------------------------------------
// Acciones elementales (las reutilizan las compuestas)
// ---------------------------------------------------------------------

async function hacerLlamada(accion: Accion, decision: Decision, ctx: ContextoAgente, telefono: string | undefined, guion: string): Promise<{ envio: ResultadoEnvio; destino: string }> {
  const destino = telefono || destinoDemo();
  if (!destino) throw new Error("Falta DESTINO_DEMO (ningún teléfono al que llamar)");
  const r = await llamar({
    telefono: destino,
    guion,
    contexto: contextoComun(decision, accion, ctx),
    decisionId: decision.id,
    accionId: accion.id,
    incendioId: decision.incendioId,
  });
  // El orquestador ya suma `llamadasRealizadas` para las acciones de tipo "llamar";
  // aquí solo se cuentan las llamadas que van dentro de una acción compuesta.
  if (accion.tipo !== "llamar") ctx.estado.ejecucion.metricas.llamadasRealizadas += 1;
  return { envio: r, destino };
}

async function hacerSms(accion: Accion, decision: Decision, ctx: ContextoAgente, telefono: string | undefined, cuerpo: string): Promise<{ envio: ResultadoEnvio; destino: string }> {
  const destino = telefono || destinoDemo();
  if (!destino) throw new Error("Falta DESTINO_DEMO (ningún número al que enviar el SMS)");
  const envio = await enviarSms({
    destino,
    texto: cuerpo,
    contexto: contextoComun(decision, accion, ctx),
    decisionId: decision.id,
    accionId: accion.id,
    incendioId: decision.incendioId,
  });
  return { envio, destino };
}

async function hacerEmail(accion: Accion, decision: Decision, ctx: ContextoAgente, direccion: string | undefined, asunto: string, cuerpo: string): Promise<{ envio: ResultadoEnvio; destino: string }> {
  const destino = direccion || emailDemo();
  if (!destino) throw new Error("Falta EMAIL_DEMO (ninguna dirección a la que escribir)");
  const envio = await enviarEmail({
    destino,
    asunto,
    texto: cuerpo,
    contexto: contextoComun(decision, accion, ctx),
    decisionId: decision.id,
    accionId: accion.id,
    incendioId: decision.incendioId,
  });
  return { envio, destino };
}

// ---------------------------------------------------------------------
// Ejecutor
// ---------------------------------------------------------------------

/**
 * Ejecuta UNA acción. El envoltorio público (`ejecutorAcciones.ejecutar`)
 * añade la duración total y deja el evento de auditoría.
 */
async function ejecutarUna(accion: Accion, decision: Decision, ctx: ContextoAgente): Promise<Accion> {
  const { estado } = ctx;
  const p = accion.parametros ?? {};

  try {
      switch (accion.tipo) {
        // ---------------- comunicaciones sueltas ----------------
        case "llamar": {
          const { envio, destino } = await hacerLlamada(accion, decision, ctx, accion.objetivo?.telefono, texto(p.guion, accion.descripcion));
          return exito(accion, "HappyRobot", `Llamada lanzada a ${enmascarar(destino)} (run ${envio.referencia}).`, envio.referencia, { ...trazaEnvio(envio, destino), guion: texto(p.guion, accion.descripcion) });
        }

        case "enviar_sms": {
          const cuerpo = texto(p.sms, texto(p.texto, accion.descripcion)).slice(0, 300);
          const { envio, destino } = await hacerSms(accion, decision, ctx, accion.objetivo?.telefono, cuerpo);
          return exito(accion, "HappyRobot", `SMS enviado a ${enmascarar(destino)} (run ${envio.referencia}).`, envio.referencia, { ...trazaEnvio(envio, destino), texto: cuerpo });
        }

        case "enviar_email": {
          const asunto = texto(p.asunto, `[Atalaya] ${decision.titulo}`);
          const { envio, destino } = await hacerEmail(accion, decision, ctx, accion.objetivo?.email, asunto, texto(p.texto, texto(p.cuerpo, decision.resumen)));
          return exito(accion, "HappyRobot", `Correo enviado a ${enmascarar(destino)} (run ${envio.referencia}).`, envio.referencia, { ...trazaEnvio(envio, destino), asunto });
        }

        case "enviar_telegram": {
          const chat = texto(p.chatId, chatDemo() ?? "");
          if (!chat) throw new Error("Falta TELEGRAM_CHAT_ID_DEMO (ningún chat al que escribir)");
          const cuerpo = texto(p.texto, texto(p.sms, accion.descripcion));
          const t = await enviarMensajeTrazado(chat, cuerpo);
          return exito(accion, "Telegram", `Mensaje de Telegram enviado al chat ${enmascarar(chat)} (id ${t.resultado.message_id}).`, String(t.resultado.message_id), {
            peticion: t.peticion,
            respuesta: t.respuesta,
            destino: enmascarar(chat),
            duracionMs: t.duracionMs,
            texto: cuerpo,
          });
        }

        // ---------------- aviso, confinamiento y evacuación ----------------
        case "avisar_poblacion":
        case "confinar_poblacion":
        case "evacuar_poblacion": {
          const poblacionId = accion.objetivo?.poblacionId;
          const poblacion = poblacionId ? estado.poblaciones.get(poblacionId) : undefined;
          if (!poblacion) return fallo(accion, "Atalaya", `No se encuentra la población ${poblacionId ?? "(sin id)"}.`);

          const telefono = texto(p.telefono, poblacion.telefono ?? destinoDemo() ?? "");
          const guion = texto(p.guion, `${organismo()} informa de un incendio forestal próximo a ${poblacion.nombre}. ${decision.resumen}`);
          const sms = texto(p.sms, decision.resumen).slice(0, 300);

          const partes: string[] = [];
          const datos: Record<string, unknown> = { poblacionId: poblacion.id };
          let referencia: string | undefined;
          let algoFue = false;
          const errores: string[] = [];

          try {
            const { envio, destino } = await hacerLlamada(accion, decision, ctx, telefono, guion);
            referencia = envio.referencia;
            datos.llamada = { ...trazaEnvio(envio, destino), guion };
            partes.push(`llamada lanzada al ${enmascarar(destino)} (run ${envio.referencia})`);
            algoFue = true;
          } catch (e) {
            errores.push(`llamada: ${mensajeDe(e)}`);
          }

          try {
            const { envio, destino } = await hacerSms(accion, decision, ctx, telefono, sms);
            datos.sms = { ...trazaEnvio(envio, destino), texto: sms };
            partes.push(`SMS enviado (run ${envio.referencia})`);
            algoFue = true;
          } catch (e) {
            errores.push(`SMS: ${mensajeDe(e)}`);
          }

          const nuevoEstadoAviso = accion.tipo === "avisar_poblacion" ? "avisando" : accion.tipo === "confinar_poblacion" ? "confinado" : "evacuando";
          estado.actualizar(estado.poblaciones, poblacion.id, {
            // Si fallan TODOS los canales queda "sin_respuesta": visible en la sala y sin reintentos en bucle
            // (el mando puede pulsar "Avisar ahora" cuando haya un canal configurado).
            estadoAviso: algoFue ? nuevoEstadoAviso : accion.tipo === "avisar_poblacion" ? "sin_respuesta" : poblacion.estadoAviso,
            ultimoContacto: { en: ctx.ahoraMundo, canal: "llamada", resultado: algoFue ? partes.join("; ") : errores.join("; ") },
          });

          // Confinar y evacuar exigen comunicado oficial: se deja el borrador al portavoz.
          if (accion.tipo !== "avisar_poblacion") {
            const comunicado: Comunicado = {
              id: nuevoId("com"),
              ejecucionId: estado.ejecucion.id,
              incendioId: decision.incendioId,
              titulo: `${accion.tipo === "confinar_poblacion" ? "Confinamiento" : "Evacuación"} de ${poblacion.nombre}`,
              cuerpo: `${sms}\n\nMedida: ${accion.tipo === "confinar_poblacion" ? "confinamiento" : "evacuación"} de ${poblacion.nombre}.\nMotivo: ${texto(p.motivo, decision.resumen)}\n\nOrden pendiente de firma del Director del Plan. Información: ${organismo()}.`,
              canales: ["portal", "sms", "telegram"],
              estado: "borrador",
              decisionId: decision.id,
            };
            estado.guardar(estado.comunicados, comunicado);
            datos.comunicadoId = comunicado.id;
            partes.push("borrador de comunicado creado para el portavoz");
            try {
              const { despertar } = await import("../../motor/orquestador");
              despertar("portavoz");
            } catch {
              /* el portavoz lo cogerá en su siguiente ciclo */
            }
          }

          if (algoFue) {
            ctx.registrar("poblacion_avisada", `${poblacion.nombre}: ${partes.join("; ")}.`, { incendioId: decision.incendioId, nivel: "aviso", datos });
            return exito(accion, "HappyRobot", `${poblacion.nombre}: ${partes.join("; ")}.${errores.length ? ` Pendiente: ${errores.join("; ")}.` : ""}`, referencia, datos);
          }
          return fallo(accion, "HappyRobot", `No se ha podido avisar a ${poblacion.nombre}. ${errores.join("; ")}`, datos);
        }

        // ---------------- movimiento de medios ----------------
        case "desplegar_unidad":
        case "reasignar_unidad": {
          const unidadId = accion.objetivo?.unidadId;
          if (!unidadId) return fallo(accion, "Atalaya", "La acción no indica qué unidad desplegar.");
          const unidad = estado.unidades.get(unidadId);
          if (!unidad) return fallo(accion, "Atalaya", `No existe la unidad ${unidadId}.`);
          const incendioId = texto(p.incendioId, decision.incendioId ?? "");
          if (!incendioId) return fallo(accion, "Atalaya", "La acción no indica a qué incendio se despliega la unidad.");
          const destino = (p.destino as Punto | undefined) ?? accion.objetivo?.punto ?? estado.incendios.get(incendioId)?.centro;
          if (!destino) return fallo(accion, "Atalaya", "La acción no indica destino y el incendio no tiene centro.");
          const sector = texto(p.sector, "A");

          const r = await asignar(unidadId, destino, incendioId, sector, decision.id, accion.descripcion);
          const datos: Record<string, unknown> = {
            unidadId,
            sector,
            minutosViaje: r.minutosViaje,
            peticion: { unidadId, sector, incendioId, origen: unidad.posicion, destino },
            respuesta: r.urlRuta,
            ruta: { distanciaM: r.ruta.distanciaM, duracionS: r.ruta.duracionS, puntos: r.ruta.coords.length, salida: r.ruta.salida, llegadaPrevista: r.ruta.llegadaPrevista },
          };
          let extra = "";

          if (unidad.telefono) {
            const orden = `${organismo()}: ${accion.descripcion}. Llegada prevista ${r.ruta.llegadaPrevista.slice(11, 16)}. Sector ${sector}.`;
            try {
              const { envio, destino } = await hacerSms(accion, decision, ctx, unidad.telefono, orden.slice(0, 300));
              datos.sms = { ...trazaEnvio(envio, destino), texto: orden.slice(0, 300) };
              extra = ` Orden enviada por SMS a la unidad (run ${envio.referencia}).`;
            } catch (e) {
              extra = ` La orden queda registrada, pero el SMS a la unidad falló: ${mensajeDe(e)}.`;
            }
          } else {
            extra = " La unidad no tiene teléfono en OSM: la orden queda registrada en el sistema.";
          }

          return exito(accion, "OSRM + HappyRobot", `${unidad.nombre} en ruta al sector ${sector}: ${(r.ruta.distanciaM / 1000).toFixed(1)} km, ${r.minutosViaje} min por carretera.${extra}`, "osrm", datos);
        }

        case "retirar_unidad": {
          const unidadId = accion.objetivo?.unidadId;
          if (!unidadId) return fallo(accion, "Atalaya", "La acción no indica qué unidad retirar.");
          const r = await retirar(unidadId, texto(p.motivo, "orden del coordinador"), decision.id);
          return exito(accion, "OSRM", `${r.unidad.nombre} regresa a ${r.unidad.base.nombre}: ${r.minutosViaje} min por carretera.`, "osrm", {
            unidadId,
            peticion: { unidadId, destino: r.unidad.base.punto, motivo: texto(p.motivo, "orden del coordinador") },
            respuesta: r.urlRuta,
            ruta: { distanciaM: r.ruta.distanciaM, duracionS: r.ruta.duracionS, puntos: r.ruta.coords.length },
          });
        }

        // ---------------- peticiones a organismos ----------------
        case "solicitar_medios_aereos": {
          const incendio = decision.incendioId ? estado.incendios.get(decision.incendioId) : undefined;
          const tipoMedio = texto(p.tipo, "medios aéreos de extinción");
          const destinatario = texto(p.organismo, `Operativo de incendios de ${incendio?.comunidad ?? "la comunidad autónoma"}`);
          const parte =
            `SOLICITUD DE MEDIOS AÉREOS\n\n` +
            `De: ${organismo()}\nA: ${destinatario}\n\n` +
            `Incendio: ${incendio?.nombre ?? "sin nombre"} (${incendio?.municipio ?? "?"}, ${incendio?.provincia ?? "?"})\n` +
            `Coordenadas: ${incendio?.centro.lat.toFixed(5) ?? "?"}, ${incendio?.centro.lon.toFixed(5) ?? "?"}\n` +
            `Nivel de gravedad potencial: ${incendio?.nivelGravedad ?? "?"}\n` +
            `Superficie estimada: ${incendio?.areaHa.toFixed(1) ?? "?"} ha\n` +
            (incendio?.meteo ? `Meteorología: ${incendio.meteo.temperaturaC.toFixed(0)} °C, HR ${incendio.meteo.humedadPct.toFixed(0)} %, viento ${incendio.meteo.vientoKmh.toFixed(0)} km/h del ${incendio.meteo.direccionTexto}\n` : "") +
            (incendio?.frente ? `Frente: avanza al ${incendio.frente.rumboTexto} a ${incendio.frente.velocidadMmin.toFixed(1)} m/min\n` : "") +
            `\nMedios solicitados: ${tipoMedio}\nMotivo: ${texto(p.motivo, decision.resumen)}\n\n` +
            `Decisión ${decision.id}. ${decision.razonamiento}`;

          const partes: string[] = [];
          const datos: Record<string, unknown> = {};
          const errores: string[] = [];
          try {
            const { envio, destino } = await hacerEmail(accion, decision, ctx, accion.objetivo?.email, `[Atalaya] Solicitud de medios aéreos · ${incendio?.nombre ?? "incendio"}`, parte);
            datos.email = { ...trazaEnvio(envio, destino), cuerpo: parte };
            partes.push(`parte enviado por correo a ${enmascarar(destino)} (run ${envio.referencia})`);
          } catch (e) {
            errores.push(`correo: ${mensajeDe(e)}`);
          }
          try {
            const guion = `${organismo()}. Solicitamos ${tipoMedio} para el ${incendio?.nombre ?? "incendio forestal"} en ${incendio?.municipio ?? "la zona"}. ${texto(p.motivo, decision.resumen)} Le he enviado el parte formal por correo. ¿Me confirma la asignación de medios?`;
            const { envio, destino } = await hacerLlamada(accion, decision, ctx, accion.objetivo?.telefono, guion);
            datos.llamada = { ...trazaEnvio(envio, destino), guion };
            partes.push(`llamada al organismo (run ${envio.referencia})`);
          } catch (e) {
            errores.push(`llamada: ${mensajeDe(e)}`);
          }

          if (partes.length) return exito(accion, "HappyRobot", `Medios aéreos solicitados a ${destinatario}: ${partes.join("; ")}.${errores.length ? ` Pendiente: ${errores.join("; ")}.` : ""}`, undefined, datos);
          return fallo(accion, "HappyRobot", `No se ha podido solicitar medios aéreos. ${errores.join("; ")}`);
        }

        case "cortar_carretera": {
          const via = texto(p.via, texto(p.carretera, "la vía afectada"));
          const cuerpo =
            `SOLICITUD DE CORTE DE VÍA\n\nDe: ${organismo()}\nA: Dirección General de Tráfico / autoridad de tráfico competente\n\n` +
            `Vía: ${via}\nTramo: ${texto(p.tramo, "por determinar con la unidad en zona")}\n` +
            `Motivo: ${texto(p.motivo, decision.resumen)}\n\n${decision.razonamiento}`;
          const { envio, destino } = await hacerEmail(accion, decision, ctx, accion.objetivo?.email, `[Atalaya] Solicitud de corte de vía · ${via}`, cuerpo);
          return exito(accion, "HappyRobot", `Solicitud de corte de ${via} enviada a la DGT (run ${envio.referencia}).`, envio.referencia, { ...trazaEnvio(envio, destino), cuerpo });
        }

        // ---------------- comunicación pública ----------------
        case "publicar_comunicado": {
          const comunicadoId = texto(p.comunicadoId, "");
          const comunicado = comunicadoId ? estado.comunicados.get(comunicadoId) : [...estado.comunicados.values()].reverse().find((c) => c.decisionId === decision.id);
          if (!comunicado) return fallo(accion, "Atalaya", "No hay comunicado que publicar (el portavoz no ha dejado ninguno).");
          const publicado = estado.actualizar(estado.comunicados, comunicado.id, {
            estado: "publicado",
            publicadoEn: new Date().toISOString(),
            aprobadoPor: decision.decididaPor ?? `ia:${decision.agenteId}`,
          });
          ctx.registrar("comunicado", `Comunicado publicado en el portal ciudadano: "${publicado?.titulo ?? comunicado.titulo}".`, { incendioId: decision.incendioId, nivel: "aviso", datos: { comunicadoId: comunicado.id } });

          // Difusión por Telegram si hay canal configurado (el portal siempre se actualiza).
          let extra = "";
          if (comunicado.canales.includes("telegram") && chatDemo()) {
            try {
              const m = await enviarTelegram(chatDemo() as string, `📣 ${comunicado.titulo}\n\n${comunicado.cuerpo}`.slice(0, 4000));
              extra = ` Difundido por Telegram (id ${m.message_id}).`;
            } catch (e) {
              extra = ` No se pudo difundir por Telegram: ${mensajeDe(e)}.`;
            }
          }
          return exito(accion, "Atalaya", `Comunicado publicado en /publico.${extra}`, comunicado.id, { comunicadoId: comunicado.id });
        }

        // ---------------- mando ----------------
        case "elevar_nivel": {
          const incendioId = texto(p.incendioId, decision.incendioId ?? "");
          const incendio = incendioId ? estado.incendios.get(incendioId) : undefined;
          if (!incendio) return fallo(accion, "Atalaya", "No se encuentra el incendio cuyo nivel hay que elevar.");
          const nivel = numero(p.nivel);
          if (nivel === undefined || nivel < 0 || nivel > 3) return fallo(accion, "Atalaya", `Nivel inválido (${String(p.nivel)}): debe ser 0, 1, 2 o 3.`);
          estado.actualizar(estado.incendios, incendio.id, { nivelGravedad: nivel as 0 | 1 | 2 | 3, actualizadoEn: ctx.ahoraMundo });
          ctx.registrar("incendio_actualizado", `${incendio.nombre} pasa a nivel de gravedad potencial ${nivel}: ${texto(p.motivo, decision.resumen)}`, { incendioId: incendio.id, nivel: "critico" });
          return exito(accion, "Atalaya", `${incendio.nombre} elevado del nivel ${incendio.nivelGravedad} al ${nivel}.`, undefined, { nivelAnterior: incendio.nivelGravedad, nivel });
        }

        case "declarar_controlado": {
          const incendioId = texto(p.incendioId, decision.incendioId ?? "");
          if (!incendioId) return fallo(accion, "Atalaya", "La acción no indica qué incendio se declara controlado.");
          const nuevoEstado = (texto(p.estado, "controlado") as "controlado" | "extinguido" | "descartado") ?? "controlado";
          const { cerrarIncendio } = await import("../../motor/orquestador");
          const incendio = await cerrarIncendio(incendioId, nuevoEstado, decision.decididaPor ?? `ia:${decision.agenteId}`);
          if (!incendio) return fallo(accion, "Atalaya", `No se ha podido cerrar el incendio ${incendioId}.`);
          return exito(accion, "Atalaya", `${incendio.nombre} declarado ${nuevoEstado}.`, incendio.id, { estado: nuevoEstado });
        }

        // ---------------- registro interno ----------------
        case "abrir_ticket": {
          const ticket: Ticket = {
            id: nuevoId("tic"),
            titulo: texto(p.titulo, decision.titulo),
            cuerpo: texto(p.cuerpo, `${decision.resumen}\n\n${decision.razonamiento}`),
            destinatario: texto(p.destinatario, "Sala de coordinación"),
            estado: "abierto",
            creadoEn: new Date().toISOString(),
            decisionId: decision.id,
            incendioId: decision.incendioId,
          };
          estado.guardar(estado.tickets, ticket);
          ctx.registrar("accion_ejecutada", `Parte abierto para ${ticket.destinatario}: "${ticket.titulo}".`, { incendioId: decision.incendioId, nivel: "aviso", datos: { ticketId: ticket.id } });
          return exito(accion, "Atalaya", `Parte ${ticket.id} abierto para ${ticket.destinatario}.`, ticket.id, { ticketId: ticket.id });
        }

        case "vigilar_camara": {
          const camaraId = accion.objetivo?.camaraId ?? texto(p.camaraId, "");
          const camara = camaraId ? estado.camaras.get(camaraId) : undefined;
          if (!camara) return fallo(accion, "Atalaya", `No se encuentra la cámara ${camaraId || "(sin id)"}.`);
          estado.actualizar(estado.camaras, camara.id, { vigilada: true, incendioId: decision.incendioId ?? camara.incendioId });
          return exito(accion, "Atalaya", `Cámara "${camara.nombre}" puesta en vigilancia (análisis cada ${camara.intervaloSeg} s).`, camara.id, { camaraId: camara.id });
        }

        case "solicitar_confirmacion": {
          const observacionId = texto(p.observacionId, "");
          const observacion = observacionId ? estado.observaciones.get(observacionId) : undefined;
          const remitente = texto(p.telefono, accion.objetivo?.telefono ?? observacion?.remitente ?? "");
          const pregunta = texto(p.texto, texto(p.guion, `${organismo()}: nos ha llegado su aviso. ¿Puede confirmarnos el lugar exacto y si ve llamas o solo humo?`));
          if (!remitente) return fallo(accion, "Atalaya", "No hay remitente al que pedir confirmación (la observación no trae teléfono).");

          // Por SMS si parece un teléfono; si el canal era una llamada, se devuelve la llamada.
          const porLlamada = observacion?.canal === "llamada" || p.canal === "llamada";
          const { envio, destino } = porLlamada
            ? await hacerLlamada(accion, decision, ctx, remitente, pregunta)
            : await hacerSms(accion, decision, ctx, remitente, pregunta.slice(0, 300));
          return exito(accion, "HappyRobot", `Confirmación solicitada a ${enmascarar(destino)} por ${porLlamada ? "llamada" : "SMS"} (run ${envio.referencia}).`, envio.referencia, {
            ...trazaEnvio(envio, destino),
            observacionId,
            pregunta,
          });
        }

        default: {
          // `soporta()` ya filtra, pero si llega algo nuevo del contrato se dice claro.
          return fallo(accion, "Atalaya", `El ejecutor no sabe hacer todavía acciones de tipo "${accion.tipo}".`);
        }
      }
  } catch (e) {
    const resumen = mensajeDe(e);
    return fallo(accion, resumen.startsWith("Falta HAPPYROBOT") ? "HappyRobot" : "Atalaya", resumen, {
      peticion: { tipo: accion.tipo, objetivo: { ...accion.objetivo, telefono: enmascarar(accion.objetivo?.telefono), email: enmascarar(accion.objetivo?.email) } },
    });
  }
}

export const ejecutorAcciones: EjecutorAcciones = {
  soporta(tipo: Accion["tipo"]) {
    return SOPORTADAS.includes(tipo);
  },

  /**
   * Ejecuta la acción y deja el rastro: duración real, evento de auditoría y
   * `resultado.datos` con la petición y la respuesta. El orquestador (A) guarda
   * la decisión tras cada acción, así que esto se ve en la sala en vivo.
   */
  async ejecutar(accion: Accion, decision: Decision, ctx: ContextoAgente): Promise<Accion> {
    const t0 = Date.now();
    const hecha = await ejecutarUna(accion, decision, ctx);
    const duracionTotalMs = Date.now() - t0;

    const conTraza: Accion = hecha.resultado
      ? { ...hecha, resultado: { ...hecha.resultado, datos: { ...(hecha.resultado.datos ?? {}), duracionTotalMs } } }
      : hecha;

    const ok = conTraza.estado === "ejecutada" && conTraza.resultado?.exito !== false;
    ctx.registrar(ok ? "accion_ejecutada" : "accion_fallida", `${conTraza.descripcion}: ${conTraza.resultado?.resumen ?? (ok ? "hecho" : "sin resultado")}`, {
      incendioId: decision.incendioId,
      nivel: ok ? "info" : "aviso",
      datos: { decisionId: decision.id, accionId: conTraza.id, tipo: conTraza.tipo, referencia: conTraza.resultado?.referencia, resumen: conTraza.resultado?.resumen },
    });
    return conTraza;
  },
};
