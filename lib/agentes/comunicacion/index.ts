// Índice de agentes de comunicacion. DUEÑO: constructor D.
// El redactor de informes va en agentesInformes (constructor C), no aquí.
import type { Agente } from "../../motor/contratos";
import { portavoz } from "./portavoz";

export { portavoz };

export const agentesComunicacion: Agente[] = [portavoz];
