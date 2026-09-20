// =====================================================================
// Análisis inmediato del fotograma de un móvil. DUEÑO: sesión fireops-2a.
// ---------------------------------------------------------------------
// Antes, el fotograma esperaba al siguiente ciclo del Vigía (20 s) y el
// teléfono se enteraba del veredicto en su siguiente sondeo (15 s): casi un
// minuto en el peor caso. Ahora POST /api/camaras/movil llama aquí nada más
// guardar el fotograma: se analiza con prioridad alta en la cola del modelo
// y el veredicto vuelve en la misma respuesta. Respeta el cupo de imágenes
// por minuto del Vigía y no repite un fotograma que ya esté en análisis.
// Dependencias: lib/agentes/percepcion/vigiaCamaras, lib/motor/orquestador.
// =====================================================================
import type { AnalisisCamara } from "../dominio/tipos";
import { analizarCamaraAhora, cupoDisponible } from "../agentes/percepcion/vigiaCamaras";
import { proveedorDisponible } from "../ia/llm";
import { obtenerEstado } from "../motor/estado";
import { contextoParaSistema } from "../motor/orquestador";
import { fotogramaDe } from "./camarasMovil";

/** Tiempo máximo del análisis (cola + modelo). Pasado, se aborta y el ciclo del Vigía sigue con la cámara. */
const TIEMPO_MAXIMO_MS = 45_000;

type Global = typeof globalThis & { __atalayaAnalisisMovil?: Map<string, Promise<AnalisisCamara | undefined>> };
const g = globalThis as Global;
const enCurso = () => (g.__atalayaAnalisisMovil ??= new Map());

/**
 * Analiza ahora el último fotograma de la cámara móvil `camaraId`.
 * Devuelve el análisis, o undefined si no hay proveedor de visión, no queda cupo
 * este minuto o el análisis falló (el Vigía deja el fallo registrado). Si la cámara
 * ya tiene un análisis en curso se comparte esa promesa: nunca corren dos análisis de
 * la misma cámara a la vez, así que uno antiguo no puede terminar después y pisar al
 * reciente; el fotograma más nuevo lo recoge el siguiente ciclo del Vigía.
 */
export function analizarMovilAlLlegar(camaraId: string): Promise<AnalisisCamara | undefined> {
  const f = fotogramaDe(camaraId);
  const camara = obtenerEstado().camaras.get(camaraId);
  if (!f || !camara || !proveedorDisponible("vision")) return Promise.resolve(undefined);
  const clave = camaraId;
  const pendiente = enCurso().get(clave);
  if (pendiente) return pendiente;
  if (cupoDisponible() <= 0) return Promise.resolve(undefined);

  const ctx = contextoParaSistema("vigia_camaras", AbortSignal.timeout(TIEMPO_MAXIMO_MS));
  const promesa = analizarCamaraAhora(ctx, camara, { prioridad: "alta" })
    .then((r) => r?.analisis)
    .finally(() => enCurso().delete(clave));
  enCurso().set(clave, promesa);
  return promesa;
}

/**
 * Espera la promesa como mucho `ms`. Si tarda más, devuelve `agotado: true` y la
 * promesa sigue su curso en segundo plano (el resultado llegará al estado igualmente).
 */
export function conTiempoMaximo<T>(promesa: Promise<T>, ms: number): Promise<{ valor?: T; agotado: boolean }> {
  return new Promise((resolver) => {
    const temporizador = setTimeout(() => resolver({ agotado: true }), ms);
    promesa.then(
      (valor) => {
        clearTimeout(temporizador);
        resolver({ valor, agotado: false });
      },
      () => {
        clearTimeout(temporizador);
        resolver({ agotado: false });
      },
    );
  });
}
