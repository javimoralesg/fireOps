"use client";
// Cómo se llama y con qué icono se dibuja cada tipo de acción. DUEÑO: constructor E.

import {
  AlertTriangle,
  Ban,
  Building2,
  CheckCircle2,
  Eye,
  Mail,
  MessageCircle,
  MessageSquare,
  Megaphone,
  Phone,
  PlaneTakeoff,
  Radio,
  ShieldAlert,
  Ticket,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { EstadoAccion, TipoAccion } from "@/lib/dominio/tipos";

export const TEXTO_ACCION: Record<TipoAccion, string> = {
  llamar: "Llamada (sale por SMS)",
  enviar_sms: "SMS",
  enviar_email: "Correo",
  enviar_telegram: "Telegram",
  desplegar_unidad: "Despliegue",
  reasignar_unidad: "Reasignación",
  retirar_unidad: "Retirada",
  solicitar_medios_aereos: "Medios aéreos",
  avisar_poblacion: "Aviso a población",
  confinar_poblacion: "Confinamiento",
  evacuar_poblacion: "Evacuación",
  cortar_carretera: "Corte de carretera",
  publicar_comunicado: "Comunicado",
  elevar_nivel: "Elevar nivel",
  declarar_controlado: "Declarar controlado",
  abrir_ticket: "Ticket interno",
  vigilar_camara: "Vigilar cámara",
  solicitar_confirmacion: "Petición de confirmación",
};

export const ICONO_ACCION: Record<TipoAccion, LucideIcon> = {
  llamar: Phone,
  enviar_sms: MessageSquare,
  enviar_email: Mail,
  enviar_telegram: MessageCircle,
  desplegar_unidad: Truck,
  reasignar_unidad: Truck,
  retirar_unidad: Truck,
  solicitar_medios_aereos: PlaneTakeoff,
  avisar_poblacion: Megaphone,
  confinar_poblacion: Building2,
  evacuar_poblacion: Users,
  cortar_carretera: Ban,
  publicar_comunicado: Radio,
  elevar_nivel: ShieldAlert,
  declarar_controlado: CheckCircle2,
  abrir_ticket: Ticket,
  vigilar_camara: Eye,
  solicitar_confirmacion: AlertTriangle,
};

export const TEXTO_ESTADO_ACCION: Record<EstadoAccion, string> = {
  pendiente: "Pendiente",
  ejecutando: "Ejecutando",
  ejecutada: "Ejecutada",
  fallida: "Fallida",
  cancelada: "Cancelada",
};

export function tonoEstadoAccion(e: EstadoAccion): "neutro" | "info" | "exito" | "peligro" {
  if (e === "ejecutando") return "info";
  if (e === "ejecutada") return "exito";
  if (e === "fallida") return "peligro";
  return "neutro";
}
