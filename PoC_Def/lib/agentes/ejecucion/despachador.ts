// =====================================================================
// ATALAYA INCENDIOS · Agente "despachador" (ejecución)
// ---------------------------------------------------------------------
// Propósito: que las unidades se muevan DE VERDAD por carreteras reales.
// Cada tick avanza a cada unidad en ruta (o de regreso) por su polilínea de
// OSRM, en función del tiempo de mundo transcurrido y de su velocidad; al
// llegar cambia su estado y lanza el evento `unidad_llega`.
// También expone `asignar` y `retirar`, que son las que llama el ejecutor
// de acciones cuando se aprueba un despliegue.
// DUEÑO: constructor D. Dependencias: lib/fuentes/osrm (rutas reales).
// =====================================================================
import type { Punto, RutaUnidad, Unidad } from "../../dominio/tipos";
import type { Agente, ContextoAgente, ResultadoCiclo } from "../../motor/contratos";
import { obtenerEstado } from "../../motor/estado";
import { avanzarPorRuta, ruta as calcularRuta } from "../../fuentes/osrm";

/** Estados en los que una unidad se mueve por la carretera. */
const EN_MOVIMIENTO: Unidad["estado"][] = ["en_ruta", "regreso"];
/** Los vehículos de emergencia van algo más rápido que el tráfico civil que estima OSRM. */
const FACTOR_EMERGENCIA = 1.25;

export interface ResultadoAsignacion {
  unidad: Unidad;
  ruta: RutaUnidad;
  minutosViaje: number;
  urlRuta: string;
}

/** Suma minutos a un ISO. */
const sumarMinutos = (iso: string, minutos: number): string => new Date(Date.parse(iso) + minutos * 60_000).toISOString();

/**
 * Envía una unidad a un destino por carretera real. Calcula la ruta con OSRM
 * (si falla, lanza: no se inventa un trayecto) y deja la unidad en_ruta con
 * su ruta, su hora de salida y su llegada prevista en tiempo de mundo.
 */
export async function asignar(
  unidadId: string,
  destino: Punto,
  incendioId: string,
  sector?: string,
  decisionId?: string,
  textoOrden?: string,
): Promise<ResultadoAsignacion> {
  const estado = obtenerEstado();
  const unidad = estado.unidades.get(unidadId);
  if (!unidad) throw new Error(`No existe la unidad ${unidadId}`);
  if (unidad.estado === "fuera_servicio") throw new Error(`${unidad.nombre} está fuera de servicio`);

  const r = await calcularRuta(unidad.posicion, destino);
  const minutos = Math.max(1, Math.round(r.duracionS / 60));
  const ahoraMundo = estado.reloj.ahoraMundo;
  const rutaUnidad: RutaUnidad = {
    coords: r.coords,
    distanciaM: r.distanciaM,
    duracionS: r.duracionS,
    progreso: 0,
    salida: ahoraMundo,
    llegadaPrevista: sumarMinutos(ahoraMundo, minutos),
    destino,
    fuente: "OSRM",
  };

  const actualizada = estado.actualizar(estado.unidades, unidadId, {
    estado: "en_ruta",
    incendioId,
    sector,
    ruta: rutaUnidad,
    ultimaOrden: { en: ahoraMundo, texto: textoOrden ?? `Acudir al sector ${sector ?? "A"} de ${estado.incendios.get(incendioId)?.nombre ?? incendioId}`, decisionId: decisionId ?? "manual" },
  });

  // La unidad queda anotada en su sector para que la sala la pinte agrupada.
  const incendio = estado.incendios.get(incendioId);
  if (incendio && sector) {
    const sectores = (incendio.sectores ?? []).map((s) => (s.nombre === sector ? { ...s, unidades: [...new Set([...s.unidades, unidadId])] } : s));
    if (!sectores.some((s) => s.nombre === sector)) sectores.push({ nombre: sector, rumboGrados: incendio.frente?.rumboGrados ?? 0, unidades: [unidadId] });
    estado.actualizar(estado.incendios, incendioId, { sectores });
  }

  estado.registrarEvento("unidad_movida", `${unidad.nombre} sale hacia ${incendio?.nombre ?? "el foco"}${sector ? ` (sector ${sector})` : ""}: ${(r.distanciaM / 1000).toFixed(1)} km por carretera, ${minutos} min.`, {
    agenteId: "despachador",
    incendioId,
    nivel: "info",
    datos: { unidadId, distanciaM: r.distanciaM, duracionS: r.duracionS, url: r.url },
  });

  return { unidad: actualizada ?? unidad, ruta: rutaUnidad, minutosViaje: minutos, urlRuta: r.url };
}

/** Devuelve una unidad a su base por carretera real. */
export async function retirar(unidadId: string, motivo?: string, decisionId?: string): Promise<ResultadoAsignacion> {
  const estado = obtenerEstado();
  const unidad = estado.unidades.get(unidadId);
  if (!unidad) throw new Error(`No existe la unidad ${unidadId}`);

  const r = await calcularRuta(unidad.posicion, unidad.base.punto);
  const minutos = Math.max(1, Math.round(r.duracionS / 60));
  const ahoraMundo = estado.reloj.ahoraMundo;
  const rutaUnidad: RutaUnidad = {
    coords: r.coords,
    distanciaM: r.distanciaM,
    duracionS: r.duracionS,
    progreso: 0,
    salida: ahoraMundo,
    llegadaPrevista: sumarMinutos(ahoraMundo, minutos),
    destino: unidad.base.punto,
    fuente: "OSRM",
  };

  const actualizada = estado.actualizar(estado.unidades, unidadId, {
    estado: "regreso",
    ruta: rutaUnidad,
    sector: undefined,
    ultimaOrden: { en: ahoraMundo, texto: motivo ? `Regreso a base: ${motivo}` : "Regreso a base", decisionId: decisionId ?? "manual" },
  });

  estado.registrarEvento("unidad_movida", `${unidad.nombre} se retira a ${unidad.base.nombre}${motivo ? `: ${motivo}` : ""} (${minutos} min).`, {
    agenteId: "despachador",
    incendioId: unidad.incendioId,
    nivel: "aviso",
    datos: { unidadId, url: r.url },
  });

  return { unidad: actualizada ?? unidad, ruta: rutaUnidad, minutosViaje: minutos, urlRuta: r.url };
}

export const despachador: Agente = {
  id: "despachador",
  nombre: "Despachador de unidades",
  categoria: "ejecucion",
  descripcion: "Mueve cada unidad por su ruta real de carretera según el tiempo de mundo y avisa cuando llega.",
  modelo: "determinista",
  cadenciaSeg: 5,
  despiertaCon: ["decision_aprobada"],

  async ciclo(ctx: ContextoAgente): Promise<ResultadoCiclo | void> {
    const { estado } = ctx;
    const enMarcha = [...estado.unidades.values()].filter((u) => EN_MOVIMIENTO.includes(u.estado) && u.ruta);
    if (!enMarcha.length) {
      const desplegadas = [...estado.unidades.values()].filter((u) => u.estado === "en_intervencion").length;
      ctx.informarTarea(desplegadas ? `${desplegadas} unidad(es) trabajando en el terreno` : "Sin unidades en ruta");
      return;
    }

    const minutos = Math.max(0, ctx.minutosMundoDesdeUltimoCiclo || 0);
    const llegadas: string[] = [];
    let moviendose = 0;

    for (const unidad of enMarcha) {
      const ruta = unidad.ruta as RutaUnidad;
      // Velocidad media REAL de la ruta según OSRM (distancia / duración) con un factor de emergencia
      // (prioridad de paso), sin superar nunca la velocidad nominal de la unidad.
      const mediaOsrmKmh = ruta.duracionS > 0 ? (ruta.distanciaM / 1000) / (ruta.duracionS / 3600) : unidad.velocidadKmh;
      const velocidadKmh = Math.min(unidad.velocidadKmh, mediaOsrmKmh * FACTOR_EMERGENCIA);
      const metros = (velocidadKmh / 60) * minutos * 1000;
      const avance = avanzarPorRuta({ coords: ruta.coords, distanciaM: ruta.distanciaM, progreso: ruta.progreso }, metros);

      if (!avance.llegado) {
        moviendose += 1;
        estado.actualizar(estado.unidades, unidad.id, { posicion: avance.posicion, ruta: { ...ruta, progreso: avance.progreso } });
        continue;
      }

      // Ha llegado.
      const regreso = unidad.estado === "regreso";
      estado.actualizar(estado.unidades, unidad.id, {
        posicion: regreso ? unidad.base.punto : ruta.destino,
        estado: regreso ? "disponible" : "en_intervencion",
        incendioId: regreso ? undefined : unidad.incendioId,
        sector: regreso ? undefined : unidad.sector,
        ruta: { ...ruta, progreso: 1 },
      });
      llegadas.push(unidad.nombre);
      ctx.registrar("unidad_llega", regreso ? `${unidad.nombre} ha regresado a ${unidad.base.nombre} y vuelve a estar disponible.` : `${unidad.nombre} ha llegado al sector ${unidad.sector ?? "A"} y comienza a trabajar.`, {
        incendioId: regreso ? undefined : unidad.incendioId,
        nivel: "info",
        datos: { unidadId: unidad.id, regreso },
      });
    }

    ctx.informarTarea(`${moviendose} unidad(es) en carretera${llegadas.length ? `, ${llegadas.length} recién llegada(s)` : ""}`);
    return { resumen: `${moviendose} en ruta${llegadas.length ? ` · llegan: ${llegadas.join(", ")}` : ""}` };
  },
};
