// Índice de agentes de aprendizaje. DUEÑO: constructor C. Lo importa lib/agentes/registro.ts (A).
import type { Agente } from "../../motor/contratos";
import { agenteMemoria } from "./memoria";

export const agentesAprendizaje: Agente[] = [agenteMemoria];
