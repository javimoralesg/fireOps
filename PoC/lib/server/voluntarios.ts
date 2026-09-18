// Civilian tasking: la IA propone tareas de bajo riesgo para voluntarios; el
// cargo las publica; cada tick se simulan aceptaciones hasta cubrir el cupo
// (cuando HappyRobot esté conectado, las aceptaciones llegarán por webhook).

import type { TareaVoluntarios } from "../tipos-sistema";

type Plantilla = Omit<TareaVoluntarios, "id" | "incidenteId" | "aceptados" | "estado" | "creadaEn" | "riesgo">;

export const TAREAS_GUION: { tick: number; tarea: Plantilla }[] = [
  { tick: 2, tarea: { titulo: "Reparto de mascarillas FFP2 en el polideportivo de Arganzuela", descripcion: "Recoger cajas en el almacén municipal de Legazpi y repartirlas a los vecinos que lleguen al polideportivo. Sin acercarse al perímetro.", lugar: "Polideportivo de Arganzuela", cupo: 8 } },
  { tick: 3, tarea: { titulo: "Acompañamiento de residentes evacuados", descripcion: "Acompañar a personas mayores desde los autobuses de EMT hasta el interior del polideportivo y ayudar con el registro.", lugar: "Polideportivo de Arganzuela", cupo: 12 } },
  { tick: 5, tarea: { titulo: "Difusión del comunicado oficial en comunidades de vecinos", descripcion: "Reenviar el comunicado oficial a los grupos de WhatsApp de las comunidades de Méndez Álvaro y Legazpi y desmentir los vídeos reciclados.", lugar: "Remoto", cupo: 20 } },
];

export function simularAceptaciones(tareas: TareaVoluntarios[]): string[] {
  const msgs: string[] = [];
  for (const t of tareas) {
    if (t.estado !== "abierta") continue;
    const nuevos = Math.min(t.cupo - t.aceptados, 2 + Math.floor(Math.random() * 4));
    if (nuevos <= 0) continue;
    t.aceptados += nuevos;
    if (t.aceptados >= t.cupo) {
      t.estado = "cubierta";
      msgs.push(`Tarea cubierta: ${t.titulo} (${t.aceptados}/${t.cupo} voluntarios)`);
    } else {
      msgs.push(`${nuevos} voluntario(s) aceptan "${t.titulo}" (${t.aceptados}/${t.cupo})`);
    }
  }
  return msgs;
}
