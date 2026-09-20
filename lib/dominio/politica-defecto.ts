// Política de autonomía por defecto. Lista blanca: lo que no está aquí lo decide un humano.
// El agente constructor "planificación" puede afinar riesgos/descripciones, no cambiar la forma.

import type { PoliticaAutonomia, ReglaAutonomia } from "./tipos";

export const REGLAS_POR_DEFECTO: ReglaAutonomia[] = [
  { tipoAccion: "vigilar_camara", modo: "autonoma", riesgoMinimo: 5, descripcion: "Poner una cámara pública bajo vigilancia y analizarla cada pocos segundos" },
  { tipoAccion: "solicitar_confirmacion", modo: "autonoma", riesgoMinimo: 10, descripcion: "Llamar o escribir a quien dio el aviso para confirmar datos" },
  { tipoAccion: "abrir_ticket", modo: "autonoma", riesgoMinimo: 10, descripcion: "Registrar una incidencia en el sistema de tickets" },
  { tipoAccion: "enviar_email", modo: "autonoma", riesgoMinimo: 15, descripcion: "Enviar un correo informativo a organismos o unidades" },
  { tipoAccion: "enviar_sms", modo: "autonoma", riesgoMinimo: 20, descripcion: "Enviar un SMS informativo (no de evacuación)" },
  { tipoAccion: "enviar_telegram", modo: "autonoma", riesgoMinimo: 15, descripcion: "Enviar un mensaje de Telegram informativo a un ayuntamiento, unidad o ciudadano" },
  { tipoAccion: "llamar", modo: "supervisada", riesgoMinimo: 30, descripcion: "Llamada de voz a ayuntamientos, unidades o particulares (canal desactivado: sale como SMS)" },
  { tipoAccion: "desplegar_unidad", modo: "supervisada", riesgoMinimo: 35, descripcion: "Enviar una unidad desde su base a un incendio" },
  { tipoAccion: "reasignar_unidad", modo: "supervisada", riesgoMinimo: 40, descripcion: "Mover una unidad de un incendio o sector a otro" },
  { tipoAccion: "retirar_unidad", modo: "supervisada", riesgoMinimo: 40, descripcion: "Retirar una unidad por seguridad o fin de tarea" },
  { tipoAccion: "avisar_poblacion", modo: "autonoma", riesgoMinimo: 20, descripcion: "Aviso preventivo a una población (SMS al ayuntamiento y Telegram; la voz saliente está desactivada): se hace solo, como las alertas oficiales; confinar y evacuar siguen siendo de una persona" },
  { tipoAccion: "publicar_comunicado", modo: "autonoma", riesgoMinimo: 25, descripcion: "Publicar un comunicado oficial informativo a la ciudadanía (los que contienen órdenes de confinar/evacuar suben de riesgo y pasan a una persona)" },
  { tipoAccion: "solicitar_medios_aereos", modo: "supervisada", riesgoMinimo: 50, descripcion: "Pedir medios aéreos al organismo competente" },
  { tipoAccion: "cortar_carretera", modo: "humano", riesgoMinimo: 60, descripcion: "Solicitar el corte de una vía a la autoridad de tráfico" },
  { tipoAccion: "confinar_poblacion", modo: "humano", riesgoMinimo: 70, descripcion: "Ordenar confinamiento de una población" },
  { tipoAccion: "evacuar_poblacion", modo: "humano", riesgoMinimo: 85, descripcion: "Ordenar evacuación de una población (compete al director del plan)" },
  { tipoAccion: "elevar_nivel", modo: "humano", riesgoMinimo: 75, descripcion: "Elevar el nivel de gravedad potencial del incendio" },
  { tipoAccion: "declarar_controlado", modo: "humano", riesgoMinimo: 50, descripcion: "Declarar un incendio controlado o extinguido" },
];

export function politicaPorDefecto(): PoliticaAutonomia {
  return {
    reglas: REGLAS_POR_DEFECTO.map((r) => ({ ...r })),
    umbralHumano: 80,
    umbralSupervisada: 30,
    puntuacionMinimaSupervisor: 60,
    nivelGravedadHumano: 2,
    minutosCaducidad: 20,
    actualizadaEn: new Date().toISOString(),
    actualizadaPor: "sistema",
  };
}
