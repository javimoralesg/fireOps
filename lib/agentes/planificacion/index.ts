// Índice de agentes de planificacion. DUEÑO: constructor D.
// El registro (lib/agentes/registro.ts) lo importa estáticamente.
import type { Agente } from "../../motor/contratos";
import { asesorLegal } from "./asesor-legal";
import { coordinador } from "./coordinador";
import { proteccionPoblacion } from "./proteccion-poblacion";

export { asesorLegal, coordinador, proteccionPoblacion };
export { revisarLegalidad } from "./asesor-legal";

export const agentesPlanificacion: Agente[] = [coordinador, proteccionPoblacion, asesorLegal];
