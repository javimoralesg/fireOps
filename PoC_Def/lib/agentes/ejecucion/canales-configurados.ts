// =====================================================================
// Compuertas de integración para las acciones de salida.
// ---------------------------------------------------------------------
// Una variable de entorno vacía significa que el canal no forma parte de
// esta ejecución. No es un fallo de la API ni del agente: la acción se omite
// antes de pasar por política/ejecución. Si el canal está configurado y la
// llamada falla, el ejecutor conserva el error real.
// =====================================================================
import type { Accion } from "../../dominio/tipos";
import { happyrobotDisponible, motivoNoDisponible } from "../../happyrobot/cliente";
import { chatDemo, telegramDisponible } from "../../telegram/cliente";

export interface AccionOmitidaPorConfiguracion {
  accion: Accion;
  motivo: string;
}

export interface AccionesFiltradasPorConfiguracion {
  acciones: Accion[];
  omitidas: AccionOmitidaPorConfiguracion[];
}

const usaSms = (tipo: Accion["tipo"]): boolean =>
  ["llamar", "enviar_sms", "avisar_poblacion", "confinar_poblacion", "evacuar_poblacion", "solicitar_confirmacion"].includes(tipo);

const usaEmail = (tipo: Accion["tipo"]): boolean => ["enviar_email", "cortar_carretera"].includes(tipo);

const variable = (clave: string): string | undefined => process.env[clave]?.trim() || undefined;
const texto = (valor: unknown): string | undefined => typeof valor === "string" && valor.trim() ? valor.trim() : undefined;

/** Destino que el ejecutor usaría para SMS: explícito en la acción o reserva del entorno. */
export function destinoSmsConfigurado(accion: Accion): boolean {
  const compuesto = ["avisar_poblacion", "confinar_poblacion", "evacuar_poblacion", "solicitar_confirmacion"].includes(accion.tipo);
  return Boolean(texto(accion.objetivo?.telefono) || (compuesto && texto(accion.parametros.telefono)) || variable("DESTINO_DEMO") || variable("TELEFONO_AVISOS_SMS"));
}

/** Destino que el ejecutor usaría para correo: explícito en la acción o reserva del entorno. */
export function destinoEmailConfigurado(accion: Accion): boolean {
  return Boolean(texto(accion.objetivo?.email) || variable("EMAIL_DEMO"));
}

export function smsAccionConfigurado(accion: Accion): boolean {
  return happyrobotDisponible("sms") && destinoSmsConfigurado(accion);
}

export function emailAccionConfigurado(accion: Accion): boolean {
  return happyrobotDisponible("email") && destinoEmailConfigurado(accion);
}

const motivoSms = (): string =>
  !happyrobotDisponible("sms") ? `SMS no configurado: ${motivoNoDisponible("sms") ?? "canal no disponible"}` : "SMS no configurado: falta teléfono explícito o DESTINO_DEMO/TELEFONO_AVISOS_SMS";

const motivoEmail = (): string =>
  !happyrobotDisponible("email") ? `Correo no configurado: ${motivoNoDisponible("email") ?? "canal no disponible"}` : "Correo no configurado: falta correo explícito o EMAIL_DEMO";

/**
 * Motivo de omisión por configuración, no por un error del proveedor.
 * `solicitar_medios_aereos` se conserva si está listo al menos uno de sus
 * dos canales (correo o SMS); el ejecutor omitirá el otro internamente.
 */
export function motivoAccionNoConfigurada(accion: Accion): string | undefined {
  if (usaSms(accion.tipo) && !happyrobotDisponible("sms")) {
    return motivoSms();
  }
  if (usaSms(accion.tipo) && !destinoSmsConfigurado(accion)) {
    return motivoSms();
  }
  if (usaEmail(accion.tipo) && !happyrobotDisponible("email")) {
    return motivoEmail();
  }
  if (usaEmail(accion.tipo) && !destinoEmailConfigurado(accion)) {
    return motivoEmail();
  }
  if (accion.tipo === "enviar_telegram") {
    if (!telegramDisponible()) return "Telegram no configurado: falta TELEGRAM_BOT_TOKEN";
    const chatExplicito = typeof accion.parametros.chatId === "string" && accion.parametros.chatId.trim();
    if (!chatExplicito && !chatDemo()) return "Telegram no configurado: falta TELEGRAM_CHAT_ID_DEMO";
  }
  if (accion.tipo === "solicitar_medios_aereos" && !smsAccionConfigurado(accion) && !emailAccionConfigurado(accion)) {
    return `Solicitud no configurada: ${motivoSms()}; ${motivoEmail()}`;
  }
  return undefined;
}

/** Separa las acciones que esta ejecución puede hacer de las que no tienen canal configurado. */
export function omitirAccionesNoConfiguradas(acciones: readonly Accion[]): AccionesFiltradasPorConfiguracion {
  const omitidas: AccionOmitidaPorConfiguracion[] = [];
  let disponibles = acciones.filter((accion) => {
    const motivo = motivoAccionNoConfigurada(accion);
    if (!motivo) return true;
    omitidas.push({ accion, motivo });
    return false;
  });

  // Una dependencia que se ha omitido no puede dejar a la acción posterior
  // en un fallo de grafo. Se omite también, pero solo cuando la dependencia
  // ausente procede de esta misma compuerta (no se enmascaran IDs inválidos).
  const idsOmitidos = new Set(omitidas.map(({ accion }) => accion.id));
  let cambio = true;
  while (cambio) {
    cambio = false;
    disponibles = disponibles.filter((accion) => {
      const dependenciaOmitida = (accion.dependeDe ?? []).find((id) => idsOmitidos.has(id));
      if (!dependenciaOmitida) return true;
      idsOmitidos.add(accion.id);
      omitidas.push({ accion, motivo: `Depende de la acción ${dependenciaOmitida}, omitida porque su canal no está configurado` });
      cambio = true;
      return false;
    });
  }
  return { acciones: disponibles, omitidas };
}

export const smsConfigurado = (): boolean => happyrobotDisponible("sms");
export const emailConfigurado = (): boolean => happyrobotDisponible("email");
