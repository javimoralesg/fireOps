// Escenario del mando: apagar y encender fuentes de detección en la ejecución
// activa (satélite, prensa y redes, cámaras fijas, avisos ciudadanos). Las
// reglas puras están en lib/dominio/fuentes-deteccion.ts; aquí va lo que toca
// el Estado: la ejecución, las fichas de agente, la vigilancia de cámaras, el
// evento visible y la persistencia. DUEÑO: sesión actual (mismo criterio que
// viento-forzado.ts). No importa orquestador ni enriquecer (ambos importan este
// módulo): lo que necesita de ellos va por import dinámico.

import type { Ejecucion, FuenteDeteccion, Incendio, Observacion } from "../dominio/tipos";
import {
  agenteDesactivadoPorEscenario,
  esSimulacro,
  fichaFuente,
  type FichaFuenteDeteccion,
  fuenteActiva,
  fuenteQueBloquea,
  fuentesDesactivadas,
  IDS_FUENTES,
  listaFuentes,
  normalizarFuentes,
  PREFIJO_CAMARA_MOVIL,
  RADIO_CAMARAS_FIJAS_KM,
} from "../dominio/fuentes-deteccion";
import { haversine, rumbo } from "../fuentes/geo";
import { riesgoPorDistancia } from "../simulacion/propagacion";
import type { Estado } from "./estado";

export {
  agenteDesactivadoPorEscenario,
  canalPuedeDeclararFoco,
  esSimulacro,
  fuenteActiva,
  fuenteQueBloquea,
  fuentesDesactivadas,
  resumenFuentes,
} from "../dominio/fuentes-deteccion";

/** Frase que ve el usuario en la tarjeta del agente mientras su fuente está apagada. */
const tareaApagada = (nombreFuente: string) => `Sin ciclos: la fuente «${nombreFuente}» está apagada por el escenario`;

/**
 * Pone o quita la marca de escenario en las fichas de agente para que la sala
 * refleje quién no corre y por qué. Idempotente y barata (17 fichas): el tick la
 * llama en cada vuelta porque `reanudar`, la pausa global y `nuevaEjecucion`
 * reescriben las fichas y perderían la marca.
 */
export function sincronizarAgentesConEscenario(estado: Estado): void {
  for (const ficha of estado.agentes.values()) {
    const fuente = agenteDesactivadoPorEscenario(estado.ejecucion, ficha.id);
    if (fuente) {
      if (ficha.desactivadoPorEscenario === fuente.nombre && ficha.estado === "inactivo") continue;
      estado.actualizar(estado.agentes, ficha.id, {
        estado: "inactivo",
        tareaActual: tareaApagada(fuente.nombre),
        desactivadoPorEscenario: fuente.nombre,
      });
    } else if (ficha.desactivadoPorEscenario) {
      estado.actualizar(estado.agentes, ficha.id, { estado: "inactivo", tareaActual: undefined, desactivadoPorEscenario: undefined });
    }
  }
}

/**
 * Vigilancia de cámaras fijas coherente con el escenario: al apagarlas se
 * desarman todas (el vigía ya no las mira y el mapa no debe enseñar anillos que
 * nadie analiza); al encenderlas se rearman las que están a menos de
 * RADIO_CAMARAS_FIJAS_KM de un foco activo, como hace el enriquecimiento.
 */
function ajustarVigilanciaCamarasFijas(estado: Estado, activas: boolean): number {
  let cambiadas = 0;
  const focos = estado.incendiosActivos();
  for (const camara of estado.camaras.values()) {
    if (camara.fuente === "Movil") continue;
    if (!activas) {
      if (!camara.vigilada) continue;
      estado.actualizar(estado.camaras, camara.id, { vigilada: false });
      cambiadas += 1;
      continue;
    }
    if (camara.vigilada) continue;
    const cercano = focos
      .map((i) => ({ id: i.id, km: haversine(i.centro, camara.punto) }))
      .filter((x) => x.km <= RADIO_CAMARAS_FIJAS_KM)
      .sort((a, b) => a.km - b.km)[0];
    if (!cercano) continue;
    estado.actualizar(estado.camaras, camara.id, { vigilada: true, incendioId: camara.incendioId ?? cercano.id });
    cambiadas += 1;
  }
  return cambiadas;
}

/** Un foco sin confirmar junto con la fuente apagada que era lo único que lo sostenía. */
export interface FocoSoloDeFuenteApagada {
  foco: Incendio;
  fuente: FichaFuenteDeteccion;
}

/**
 * Sufijo que el vigía pone en `remitente` («Cámara X (Movil)») y el verificador
 * copia a `Incendio.fuenteDeteccion`: es lo único que queda de la cámara de
 * móvil cuando su observación ya no está en memoria.
 */
const SUFIJO_CAMARA_MOVIL = "(Movil)";

/**
 * Ficha de la fuente apagada que era lo ÚNICO que sostenía este foco, o
 * undefined si el foco debe quedarse: ya está confirmado (por otra fuente o por
 * el mando), su origen no está apagado, o alguna de sus observaciones viene de
 * una fuente activa (la mano, los sensores y las cámaras de móvil lo están
 * siempre). Si sus observaciones ya no están en memoria (poda o reinicio),
 * decide el origen; para una cámara sin observación, `fuenteDeteccion` dice si
 * era de móvil.
 */
export function fuenteQueSosteniaSola(estado: Estado, foco: Incendio): FichaFuenteDeteccion | undefined {
  if (foco.estado !== "detectado") return undefined;
  const e = estado.ejecucion;
  const observaciones = foco.observaciones.map((id) => estado.observaciones.get(id)).filter((o): o is Observacion => Boolean(o));
  if (observaciones.some((o) => !fuenteQueBloquea(e, o))) return undefined;
  const camaraMovilSinObservacion =
    foco.origen === "camara" && !observaciones.some((o) => o.canal === "camara") && Boolean(foco.fuenteDeteccion?.endsWith(SUFIJO_CAMARA_MOVIL));
  return fuenteQueBloquea(e, { canal: foco.origen, referenciaExterna: camaraMovilSinObservacion ? PREFIJO_CAMARA_MOVIL : undefined });
}

/** Focos sin confirmar que SOLO sostienen fuentes apagadas por el escenario, con la fuente que los deja huérfanos. */
export function focosSoloDeFuentesApagadas(estado: Estado): FocoSoloDeFuenteApagada[] {
  const huerfanos: FocoSoloDeFuenteApagada[] = [];
  for (const foco of estado.incendios.values()) {
    const fuente = fuenteQueSosteniaSola(estado, foco);
    if (fuente) huerfanos.push({ foco, fuente });
  }
  return huerfanos;
}

/**
 * " · 1 foco de satélite sin confirmar descartado" con una sola fuente implicada,
 * " · 4 focos sin confirmar descartados (prensa y redes 2, cámaras fijas 1, …)"
 * con varias, y vacío si no hay ninguno.
 */
function sufijoDescartes(huerfanos: readonly FocoSoloDeFuenteApagada[]): string {
  if (!huerfanos.length) return "";
  const porFuente = new Map<FuenteDeteccion, number>();
  for (const { fuente } of huerfanos) porFuente.set(fuente.id, (porFuente.get(fuente.id) ?? 0) + 1);
  const implicadas = IDS_FUENTES.filter((id) => porFuente.has(id));
  const n = huerfanos.length;
  const plural = n === 1 ? "" : "s";
  if (implicadas.length === 1) return ` · ${n} foco${plural} de ${fichaFuente(implicadas[0]).nombreCorto} sin confirmar descartado${plural}`;
  const detalle = implicadas.map((id) => `${fichaFuente(id).nombreCorto} ${porFuente.get(id)}`).join(", ");
  return ` · ${n} foco${plural} sin confirmar descartado${plural} (${detalle})`;
}

export interface ResultadoSoltarPoblaciones {
  /** Ids borrados del estado (para quitarlos también de Supabase). */
  eliminados: string[];
  /** Pueblos que pasan a depender de otro foco vivo cercano. */
  reasignados: number;
}

/**
 * Suelta los pueblos que cuelgan de un foco que se cierra. Un pueblo lo lleva UN
 * solo foco (el primero que lo cargó) aunque esté en el radio de varios: si hay
 * otro foco vivo que lo tenga dentro de su radio operativo, el pueblo pasa a ese
 * foco (distancia, rumbo y riesgo provisional recalculados; el analista lo afina
 * en su siguiente ciclo). Si no, se borra del estado. Devuelve los ids borrados.
 */
export function quitarPoblacionesDe(estado: Estado, incendioId: string): ResultadoSoltarPoblaciones {
  const r: ResultadoSoltarPoblaciones = { eliminados: [], reasignados: 0 };
  const vivos = estado.incendiosActivos().filter((i) => i.id !== incendioId);
  for (const p of [...estado.poblaciones.values()]) {
    if (p.incendioId !== incendioId) continue;
    const destino = vivos
      .map((i) => ({ i, km: haversine(i.centro, p.centro) }))
      .filter((x) => x.km <= (x.i.radioOperativoKm || 30))
      .sort((a, b) => a.km - b.km)[0];
    if (!destino) {
      if (estado.eliminar(estado.poblaciones, p.id)) r.eliminados.push(p.id);
      continue;
    }
    const km = +destino.km.toFixed(2);
    estado.actualizar(estado.poblaciones, p.id, {
      incendioId: destino.i.id,
      distanciaKm: km,
      rumboDesdeFuegoGrados: Math.round(rumbo(destino.i.centro, p.centro)),
      riesgo: riesgoPorDistancia(km),
      etaFrenteMin: undefined,
      motivoRiesgo: `Pasa a depender de ${destino.i.nombre} al cerrarse su foco anterior: riesgo provisional por distancia (a ${km.toFixed(1)} km), pendiente del análisis de propagación`,
    });
    r.reasignados += 1;
  }
  return r;
}

/** Descarte sin efectos externos: el foco pasa a "descartado" y sus pueblos se van del estado. */
function descartarEnMemoria(estado: Estado, foco: Incendio): void {
  estado.actualizar(estado.incendios, foco.id, { estado: "descartado", actualizadoEn: estado.reloj.ahoraMundo });
  quitarPoblacionesDe(estado, foco.id);
}

/**
 * Al apagar una fuente, los focos que SOLO sostenía esa fuente y siguen sin
 * confirmar se descartan y sus pueblos desaparecen del mapa. Empezó con el
 * satélite (sesión riesgo-fundado, 2026-09-19: decenas de puntos térmicos de
 * refinerías y quemas como incendios "sin confirmar" y sus pueblos en "riesgo
 * inminente" en Tarragona) y vale para las cuatro fuentes: si no, el
 * «Simulacro» dejaba en el mapa los focos de prensa, cámaras fijas y avisos que
 * ya había y el escenario no quedaba limpio (lo vio Javi el 19-09-2026 con un
 * foco de EL PAÍS). Los confirmados por otra fuente o por el mando se quedan (ya
 * no dependen de la fuente apagada), y también los que tienen alguna
 * observación de una fuente activa (mano, sensor, cámara de móvil). `cerrar` es
 * inyectable (pruebas sin red); en producción es `cerrarIncendio`, que además
 * retira unidades y cámaras y borra sus pueblos también de Supabase. Devuelve
 * los focos descartados con la fuente que los sostenía.
 */
export async function descartarFocosDeFuentesApagadas(
  estado: Estado,
  quien: string,
  cerrar?: (id: string, quien: string) => Promise<unknown>,
): Promise<FocoSoloDeFuenteApagada[]> {
  const huerfanos = focosSoloDeFuentesApagadas(estado);
  for (const { foco, fuente } of huerfanos) {
    if (cerrar) {
      try {
        await cerrar(foco.id, `${quien} (fuente ${fuente.nombreCorto} apagada)`);
      } catch (e) {
        descartarEnMemoria(estado, foco);
        estado.registrarEvento("sistema", `Cierre ordenado fallido, descartado a secas: ${e instanceof Error ? e.message : String(e)}`, {
          incendioId: foco.id,
          nivel: "aviso",
        });
      }
    } else {
      descartarEnMemoria(estado, foco);
    }
    estado.registrarEvento(
      "incendio_actualizado",
      `${foco.nombre} descartado: solo lo sostenía la fuente «${fuente.nombre}»${foco.fuenteDeteccion ? ` (${foco.fuenteDeteccion})` : ""}, nadie lo confirmó y ${quien} la ha apagado.`,
      { incendioId: foco.id, nivel: "aviso", datos: { origen: foco.origen, fuenteApagada: fuente.id, quien } },
    );
  }
  return huerfanos;
}

export interface ResultadoCambioFuentes {
  cambiado: boolean;
  ejecucion: Ejecucion;
}

export interface OpcionesCambioFuentes {
  /**
   * false = solo memoria: ni despierta agentes ni escribe en Supabase. Lo usan
   * las pruebas unitarias (deterministas y sin red). Por defecto true.
   */
  efectosExternos?: boolean;
}

/**
 * Cambia el conjunto de fuentes apagadas de la ejecución activa. No-op si no
 * cambia nada. Deja evento visible, marca las fichas de agente, ajusta la
 * vigilancia de cámaras, despierta a los agentes que vuelven y persiste la
 * ejecución (tolerante: sin Supabase todo sigue en memoria).
 */
export async function cambiarFuentesDesactivadas(
  estado: Estado,
  lista: readonly string[],
  quien: string,
  { efectosExternos = true }: OpcionesCambioFuentes = {},
): Promise<ResultadoCambioFuentes> {
  const antes = fuentesDesactivadas(estado.ejecucion);
  const despues = normalizarFuentes(lista);
  if (antes.join(",") === despues.join(",")) return { cambiado: false, ejecucion: estado.ejecucion };

  const apagadasNuevas = despues.filter((f) => !antes.includes(f));
  const encendidasNuevas = antes.filter((f) => !despues.includes(f));
  const antesFijas = fuenteActiva(estado.ejecucion, "camaras_fijas");
  // Apagar una fuente retira los focos sin confirmar que SOLO sostenía. Se
  // cuentan dentro del lote, ya con las fuentes nuevas puestas, para que el
  // evento lo diga; el descarte se ejecuta después del lote.
  let huerfanos: FocoSoloDeFuenteApagada[] = [];

  estado.lote(() => {
    estado.ejecucion = { ...estado.ejecucion, fuentesDesactivadas: despues };
    estado.tocar();
    sincronizarAgentesConEscenario(estado);
    const ahoraFijas = fuenteActiva(estado.ejecucion, "camaras_fijas");
    if (antesFijas !== ahoraFijas) ajustarVigilanciaCamarasFijas(estado, ahoraFijas);
    // Las detecciones crudas de NASA FIRMS (capa «Satélite (FRP)» del mapa) se
    // vacían al apagar el satélite: son lo que esa fuente recoge y, apagada, el
    // mapa no debe seguir enseñando puntos térmicos que nadie va a verificar. Al
    // encenderla, el agente despierta al momento y las vuelve a traer.
    if (apagadasNuevas.includes("satelite")) for (const f of [...estado.focosSatelite.values()]) estado.eliminar(estado.focosSatelite, f.id);
    if (apagadasNuevas.length) huerfanos = focosSoloDeFuentesApagadas(estado);

    const simulacro = esSimulacro(estado.ejecucion);
    const mensaje = simulacro
      ? `${quien} activa el SIMULACRO: solo la declaración a mano y las cámaras de móvil crean focos (apagadas: ${listaFuentes(despues)})`
      : despues.length === 0
        ? `${quien} vuelve a la operación real: todas las fuentes de detección activas`
        : `${quien} cambia las fuentes de detección · apagadas: ${listaFuentes(despues)}${encendidasNuevas.length ? ` · encendidas de nuevo: ${listaFuentes(encendidasNuevas)}` : ""}`;
    estado.registrarEvento("humano", `${mensaje}${sufijoDescartes(huerfanos)}`, {
      nivel: simulacro || apagadasNuevas.length ? "aviso" : "info",
      datos: { quien, fuentesDesactivadas: despues, apagadas: apagadasNuevas, encendidas: encendidasNuevas, focosDescartados: huerfanos.length },
    });
  });

  if (huerfanos.length) {
    await descartarFocosDeFuentesApagadas(
      estado,
      quien,
      efectosExternos
        ? async (id, q) => {
            const { cerrarIncendio } = await import("./orquestador");
            return cerrarIncendio(id, "descartado", q);
          }
        : undefined,
    );
  }

  if (!efectosExternos) return { cambiado: true, ejecucion: estado.ejecucion };

  // Los agentes que vuelven no deben esperar su cadencia (el satélite son 10 min).
  if (encendidasNuevas.length) {
    try {
      const { despertar } = await import("./orquestador");
      for (const f of encendidasNuevas) for (const agenteId of fichaFuente(f).agentes) despertar(agenteId, "humano");
    } catch (e) {
      console.warn("[escenario] no se pudo despertar a los agentes:", e instanceof Error ? e.message : e);
    }
  }

  try {
    const { guardarEjecucion } = await import("../db/repositorio");
    await guardarEjecucion(estado.ejecucion);
  } catch (e) {
    estado.marcarServicio("Supabase", false, `No se pudo guardar el escenario: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { cambiado: true, ejecucion: estado.ejecucion };
}
