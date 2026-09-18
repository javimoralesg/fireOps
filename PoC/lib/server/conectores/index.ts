// Punto único de entrada de los conectores. Cada uno es real: de pago con clave
// (Exa, fal.ai, QuiverAI, ElevenLabs, Claude) o local sin clave (Ollama, prensa
// por RSS, RAG sobre normativa del BOE, voz del sistema, ArangoDB en Docker).

export { exaDisponible, buscarContextoReciente, detectarReciclado, evidenciaExa, modeloBusqueda, proveedorBusqueda } from "./exa";
export type { ContextoReciente, Coincidencia, Reciclado, ResultadoExa, ProveedorBusqueda } from "./exa";
export { falDisponible, modeloFal, analizarImagen, resumenClases, visionDisponible, proveedorVision, modeloVision } from "./fal";
export type { AnalisisImagen, ClaseVision, ProveedorVision } from "./fal";
export { quiverDisponible, protocoloAplicable, protocolosDisponibles, proveedorProtocolos } from "./quiver";
export type { ProtocoloQuiver, ProveedorProtocolos } from "./quiver";
export { describirLLM, llmDisponible, proveedorLLM } from "./llm";

import { exaDisponible, proveedorBusqueda } from "./exa";
import { falDisponible, modeloVision, proveedorVision } from "./fal";
import { proveedorProtocolos, quiverDisponible, ragLocalDisponibleSync } from "./quiver";
import { describirLLM } from "./llm";
import { ollamaDisponible } from "./ollama";
import { arangoConfigurado } from "../grafoArango";
import { elevenlabsDisponible, proveedorAudio } from "../audio";
import { proveedorDisponible } from "../ejecutor";

/** Qué conectores están activos ahora mismo (booleanos para `estado.conectores`). */
export function estadoConectores(): { exa: boolean; fal: boolean; quiver: boolean; ollama: boolean; vision: boolean; busqueda: boolean; rag: boolean; tts: boolean; arango: boolean } {
  return {
    exa: exaDisponible(),
    fal: falDisponible(),
    quiver: quiverDisponible(),
    ollama: ollamaDisponible(),
    vision: proveedorVision() !== null,
    busqueda: true, // Exa o prensa por RSS (sin clave)
    rag: quiverDisponible() || ragLocalDisponibleSync(),
    tts: proveedorAudio() !== null,
    arango: arangoConfigurado(),
  };
}

/** Texto por servicio para el panel "Servicios conectados": qué proveedor real responde. */
export function detalleConectores(): Record<string, string> {
  const ia = describirLLM();
  return {
    ia: ia.detalle,
    vision: proveedorVision() === null ? "sin visión (ni fal.ai, ni Claude, ni Ollama)" : modeloVision(),
    busqueda: proveedorBusqueda() === "Exa" ? "Exa (clave)" : "Google Noticias RSS (sin clave)",
    protocolos: proveedorProtocolos() === "QuiverAI" ? "QuiverAI (clave)" : proveedorProtocolos() === "RAG local" ? "RAG local · normativa BOE + all-minilm" : "sin corpus (data/protocolos/indice.json)",
    audio: elevenlabsDisponible() ? "ElevenLabs (clave)" : proveedorAudio() === "macOS say" ? "voz del sistema macOS (say + ffmpeg)" : "sin sintetizador",
    grafo: arangoConfigurado() ? "ArangoDB (Docker local)" : "grafo en memoria",
    ejecucion: proveedorDisponible() === "Ninguno" ? "sin canal externo (HappyRobot/Twilio)" : proveedorDisponible(),
  };
}
