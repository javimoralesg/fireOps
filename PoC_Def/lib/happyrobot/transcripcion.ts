// =====================================================================
// ATALAYA INCENDIOS · Transcripciones de HappyRobot (módulo PURO)
// ---------------------------------------------------------------------
// HappyRobot da la transcripción de una llamada como array de mensajes o como
// su texto JSON ({role, content, tool_calls…}). Aquí se lee y se pasa a texto
// legible ("Operador: … / Persona: …") para la ficha del aviso en la sala.
// Lo usan lib/happyrobot/entrante.ts (al colgar) y recuperar-llamadas.ts.
// DUEÑO: sesión fireops-82 (2026-09-19).
// =====================================================================

export interface MensajeTranscripcion {
  role?: string;
  content?: string | null;
  tool_calls?: { function?: { name?: string; arguments?: string } }[];
  name?: string;
}

/** La transcripción llega como array o como texto JSON; nunca lanza. */
export function leerTranscripcion(bruto: unknown): MensajeTranscripcion[] {
  let v: unknown = bruto;
  if (typeof bruto === "string") {
    try {
      v = JSON.parse(bruto);
    } catch {
      return bruto.trim() ? [{ role: "user", content: bruto }] : [];
    }
  }
  return Array.isArray(v) ? (v.filter((m) => m && typeof m === "object") as MensajeTranscripcion[]) : [];
}

/** "Operador: …\nPersona: …" (sin mensajes de herramientas ni vacíos). */
export function textoTranscripcion(msgs: MensajeTranscripcion[]): string {
  return msgs
    .filter((m) => (m.role === "assistant" || m.role === "user") && typeof m.content === "string" && m.content.trim())
    .map((m) => `${m.role === "user" ? "Persona" : "Operador"}: ${(m.content as string).trim()}`)
    .join("\n");
}

/** Lo que dijo la persona, junto. */
export function loQueDijoLaPersona(msgs: MensajeTranscripcion[]): string {
  return msgs
    .filter((m) => m.role === "user" && typeof m.content === "string" && m.content.trim())
    .map((m) => (m.content as string).trim())
    .join(" ");
}

/** Argumentos de la ÚLTIMA vez que el agente llamó a una herramienta (sin los campos internos). */
export function argumentosHerramienta(msgs: MensajeTranscripcion[], nombre: string): Record<string, unknown> | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    for (const c of [...(msgs[i].tool_calls ?? [])].reverse()) {
      if (c.function?.name !== nombre) continue;
      try {
        const args = JSON.parse(c.function.arguments ?? "{}") as Record<string, unknown>;
        return Object.fromEntries(Object.entries(args).filter(([k]) => !k.startsWith("_")));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Si el texto es una transcripción en JSON de HappyRobot, la devuelve legible;
 * si no, la devuelve tal cual (ya era texto).
 */
export function transcripcionLegible(texto: string): string {
  const t = texto.trim();
  if (!t.startsWith("[")) return t;
  const msgs = leerTranscripcion(t);
  const legible = textoTranscripcion(msgs);
  return legible || t;
}
