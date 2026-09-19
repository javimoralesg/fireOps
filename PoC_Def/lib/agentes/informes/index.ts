// Índice de agentes de informes. DUEÑO: constructor C. Lo importa lib/agentes/registro.ts (A).
import type { Agente } from "../../motor/contratos";
import { redactor } from "./redactor";

export const agentesInformes: Agente[] = [redactor];
export { redactarInforme } from "./redactor";
