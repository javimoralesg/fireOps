// Exporta el registro de supervisión (conversación + traza) como JSON, sin backend.

import { ROLES, type RolId } from "@/lib/roles";
import type { Decision, EstadoSistema } from "@/lib/tipos-sistema";
import { GENERAL, type MensajeChat } from "./tipos";

function traza(d: Decision, estado: EstadoSistema) {
  const porId = new Map(estado.doctrina.map((r) => [r.id, r]));
  return {
    id: d.id,
    foco: d.foco,
    titulo: d.tarjeta?.titulo,
    estado: d.estado,
    urgencia: d.urgencia,
    riesgo: d.riesgo,
    umbralAutonomia: estado.umbralAutonomia,
    creadaEn: d.creadaEn,
    plazo: d.plazo,
    costeDeNoActuar: d.costeDeNoActuar,
    razonamiento: d.tarjeta?.plan?.razonamiento,
    versionPlan: d.tarjeta?.plan?.version,
    acciones: d.tarjeta?.plan?.acciones,
    restricciones: d.tarjeta?.plan?.restricciones,
    evidencia: d.evidencia,
    reglasAplicadas: d.reglasAplicadas.map((id) => porId.get(id) ?? { id, noEncontrada: true }),
    procesadoPor: d.procesadoPor ?? [],
    decididaPor: d.decididaPor ?? null,
    feedback: d.feedback ?? null,
    resultadoEjecucion: d.resultadoEjecucion ?? [],
    motivoInvalidacion: d.motivoInvalidacion ?? null,
  };
}

export function exportarRegistro(opts: {
  estado: EstadoSistema | null;
  conversaciones: Record<string, MensajeChat[]>;
  seleccion: string | null;
  rol: RolId;
}) {
  const { estado, conversaciones, seleccion, rol } = opts;
  const claves = new Set(Object.keys(conversaciones).filter((k) => conversaciones[k]?.length));
  if (seleccion) claves.add(seleccion);
  const decisiones = estado
    ? [...claves].filter((k) => k !== GENERAL).map((k) => estado.decisiones.find((d) => d.id === k)).filter((d): d is Decision => !!d)
    : [];

  const registro = {
    tipo: "registro_supervision_ia",
    base: "Reglamento (UE) 2024/1689, art. 14 — supervisión humana",
    generadoEn: new Date().toISOString(),
    supervisor: { rol, nombre: ROLES[rol].nombre, cargoReal: ROLES[rol].cargoReal },
    organismo: estado?.organismo ?? null,
    incidente: estado?.incidente ?? null,
    iaDisponible: estado?.iaDisponible ?? null,
    umbralAutonomia: estado?.umbralAutonomia ?? null,
    conversaciones: Object.fromEntries([...claves].map((k) => [k, conversaciones[k] ?? []])),
    trazas: estado ? decisiones.map((d) => traza(d, estado)) : [],
    doctrinaVigente: estado?.doctrina ?? [],
  };

  const blob = new Blob([JSON.stringify(registro, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const sello = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.href = url;
  a.download = `atalaya-supervision-ia-${sello}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
