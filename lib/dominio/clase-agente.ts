// =====================================================================
// ATALAYA INCENDIOS · Agente que razona vs. entrada determinista
// ---------------------------------------------------------------------
// Propósito: distinguir, en un solo sitio, las dos cosas muy distintas que
// hoy conviven en el tablero de agentes.
//
//  · AGENTE: llama a un modelo, interpreta, propone y puede equivocarse.
//    Su trabajo hay que supervisarlo, y cuesta tokens y segundos.
//
//  · ENTRADA DETERMINISTA: no llama a ningún modelo. Recoge un dato de una
//    fuente real (FIRMS, Open-Meteo, cámaras, OSRM) o calcula con una
//    fórmula (la elipse de propagación, el avance por carretera). Mismo
//    dato de entrada, mismo resultado, siempre. No hay nada que supervisar
//    y no cuesta ni un token.
//
// Por qué importa (fase F2 de la migración, 2026-09-19): decir "16 agentes"
// da a entender que hay dieciséis cosas razonando y equivocándose. Son doce.
// Las otras cuatro son instrumentos, y llamarlas agente confunde a quien
// tiene que decidir a cuál hacer caso.
//
// La clase NO es un campo nuevo del contrato: se deduce de `modelo`, que ya
// lo dice. Una sola fuente de verdad y ningún cambio aditivo que mantener.
// DUEÑO: constructor A. Sin dependencias.
// =====================================================================

export type ClaseAgente = "agente" | "servicio";

/** Valor de `modelo` que declara que algo no llama a ningún modelo. */
export const MODELO_DETERMINISTA = "determinista";

/**
 * ¿Esto razona o es un instrumento?
 * Acepta el `modelo` de un `Agente` o de un `EstadoAgenteApp`: es el mismo campo.
 */
export function claseDeAgente(modelo: string | undefined): ClaseAgente {
  return (modelo ?? "").trim().toLowerCase() === MODELO_DETERMINISTA ? "servicio" : "agente";
}

/** true si no llama a ningún modelo (y por tanto no cuesta tokens ni hay que supervisarlo). */
export function esServicioDeterminista(modelo: string | undefined): boolean {
  return claseDeAgente(modelo) === "servicio";
}

/** Etiqueta corta para la pantalla. */
export const TEXTO_CLASE: Record<ClaseAgente, string> = {
  agente: "Agente",
  servicio: "Entrada determinista",
};

/** Una frase que explica la diferencia a quien pasa el ratón por encima. */
export const AYUDA_CLASE: Record<ClaseAgente, string> = {
  agente: "Llama a un modelo de IA: interpreta, propone y hay que supervisarlo.",
  servicio: "No llama a ningún modelo: recoge datos reales o calcula con una fórmula. Mismo dato, mismo resultado.",
};
