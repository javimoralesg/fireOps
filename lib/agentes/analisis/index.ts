// Índice de agentes de analisis. DUEÑO: constructor D.
// El registro (lib/agentes/registro.ts) lo importa estáticamente.
import type { Agente } from "../../motor/contratos";
import { analistaPatrones } from "./patrones";
import { analistaPropagacion } from "./propagacion";
import { verificador } from "./verificador";

export { analistaPatrones, analistaPropagacion, verificador };

export const agentesAnalisis: Agente[] = [verificador, analistaPropagacion, analistaPatrones];
