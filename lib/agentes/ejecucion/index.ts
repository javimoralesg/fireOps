// Índice de agentes de ejecucion. DUEÑO: constructor D.
// El registro (lib/agentes/registro.ts) lo importa estáticamente.
import type { Agente } from "../../motor/contratos";
import { despachador } from "./despachador";

export { despachador };
export { asignar, retirar } from "./despachador";
export { ejecutorAcciones } from "./ejecutor";

export const agentesEjecucion: Agente[] = [despachador];
