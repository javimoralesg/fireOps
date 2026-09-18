// Memoria de doctrina: el feedback de un cargo al denegar se convierte en una
// regla persistente que todas las propuestas posteriores deben respetar.
// Esto es lo que hace que el sistema "aprenda de interacciones pasadas".

import type { Decision, EstadoSistema, ReglaDoctrina, Rol } from "../tipos-sistema";
import { nuevoId, registrar } from "./estado";

/** Heurística de normalización sin LLM (se usa si Claude no está disponible). */
export function normalizarSinLLM(texto: string): string {
  const t = texto.trim().replace(/\s+/g, " ");
  const min = t.toLowerCase();
  if (/helic[oó]ptero|a[eé]reo/.test(min)) return "No emplear medios aéreos en este tipo de intervención salvo autorización expresa.";
  if (/m-?30|corte total|cortar/.test(min)) return "Evitar cortes totales de vías principales; preferir cortes parciales con regulación semafórica.";
  if (/hospital|sanitari/.test(min)) return "Priorizar la protección y accesibilidad de centros sanitarios sobre cualquier otra infraestructura.";
  if (/evacu/.test(min)) return "Incluir siempre un plan de evacuación preventiva del entorno inmediato cuando haya humo tóxico.";
  if (/coste|presupuesto|caro/.test(min)) return "Optimizar el coste de los recursos desplegados; justificar cualquier medio extraordinario.";
  return `Restricción del mando: ${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!]$/.test(t) ? "" : "."}`;
}

export function crearRegla(e: EstadoSistema, decision: Decision, texto: string, rol: Rol, reglaNormalizada: string, ambito: ReglaDoctrina["ambito"] = "global"): ReglaDoctrina {
  const regla: ReglaDoctrina = {
    id: nuevoId("reg"),
    texto,
    reglaNormalizada,
    ambito,
    origen: { decisionId: decision.id, rol, timestamp: new Date().toISOString() },
    activa: true,
    vecesAplicada: 0,
  };
  e.doctrina.unshift(regla);
  registrar(e, "regla", `Nueva regla de doctrina (${rol}): "${reglaNormalizada}"`, regla.id);
  return regla;
}

export function reglasActivas(e: EstadoSistema): ReglaDoctrina[] {
  return e.doctrina.filter((r) => r.activa);
}

export function marcarAplicadas(e: EstadoSistema, ids: string[]) {
  for (const r of e.doctrina) if (ids.includes(r.id)) r.vecesAplicada += 1;
}
