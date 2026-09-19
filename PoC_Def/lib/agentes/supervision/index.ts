// Índice de agentes de supervisión. DUEÑO: constructor C. Lo importa lib/agentes/registro.ts (A).
import type { Agente } from "../../motor/contratos";
import { supervisor } from "./supervisor";

export const agentesSupervision: Agente[] = [supervisor];
export { evaluarDecision } from "./supervisor";
