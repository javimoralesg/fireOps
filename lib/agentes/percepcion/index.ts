// Índice de agentes de percepción. DUEÑO: constructor B.
// Lo importa el registro (lib/agentes/registro.ts) del constructor A.
import type { Agente } from "../../motor/contratos";
import { agenteVigiaCamaras } from "./vigiaCamaras";
import { agenteSatelite } from "./satelite";
import { agentePrensaRedes } from "./prensaRedes";
import { agenteCentralita } from "./centralita";
import { agenteMeteorologo } from "./meteorologo";

export const agentesPercepcion: Agente[] = [
  agenteVigiaCamaras,
  agenteSatelite,
  agentePrensaRedes,
  agenteCentralita,
  agenteMeteorologo,
];

export { agenteVigiaCamaras, agenteSatelite, agentePrensaRedes, agenteCentralita, agenteMeteorologo };
export { procesarEntrada, contextoParaVoz, type EntradaCentralita, type ContextoVoz } from "./centralita";
