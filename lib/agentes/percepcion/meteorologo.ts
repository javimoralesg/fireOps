// =====================================================================
// Agente meteorólogo. DUEÑO: constructor B.
// ---------------------------------------------------------------------
// Cada 60 s (y al nacer un incendio) actualiza la meteo de cada incendio
// activo con la previsión horaria REAL indexada por la hora de MUNDO, calcula
// el índice de peligro y avisa cuando el viento rola o el peligro sube.
// Cada 10 min refresca los avisos oficiales (Meteoalarm / AEMET) y cada 15 min
// el peligro de 30 zonas representativas de España en UNA llamada múltiple.
// Dependencias: lib/fuentes/{openMeteo,peligro,avisos,geo}. Determinista: no
// usa LLM, así que nunca inventa un dato meteorológico.
// =====================================================================
import type { Agente, ContextoAgente } from "../../motor/contratos";
import type { Punto, ZonaPeligro } from "../../dominio/tipos";
import { meteoEnHora, meteoMultipunto, precipitacionAcumulada, previsionHoraria } from "../../fuentes/openMeteo";
import { calcularPeligro, nivelDe } from "../../fuentes/peligro";
import { avisosEspana } from "../../fuentes/avisos";
import { diferenciaAngular, gradosATexto } from "../../fuentes/geo";

/** 30 capitales y cabeceras comarcales con vocación forestal (una llamada múltiple). */
export const ZONAS_ESPANA: { nombre: string; punto: Punto }[] = [
  { nombre: "Ávila", punto: { lat: 40.66, lon: -4.7 } },
  { nombre: "Zamora", punto: { lat: 41.5, lon: -5.75 } },
  { nombre: "Ourense", punto: { lat: 42.34, lon: -7.86 } },
  { nombre: "León", punto: { lat: 42.6, lon: -5.57 } },
  { nombre: "Cáceres", punto: { lat: 39.48, lon: -6.37 } },
  { nombre: "Huelva", punto: { lat: 37.26, lon: -6.95 } },
  { nombre: "Tarragona", punto: { lat: 41.12, lon: 1.25 } },
  { nombre: "Valencia", punto: { lat: 39.47, lon: -0.38 } },
  { nombre: "Alicante", punto: { lat: 38.35, lon: -0.48 } },
  { nombre: "Murcia", punto: { lat: 37.99, lon: -1.13 } },
  { nombre: "Oviedo", punto: { lat: 43.36, lon: -5.85 } },
  { nombre: "Lugo", punto: { lat: 43.01, lon: -7.56 } },
  { nombre: "Girona", punto: { lat: 41.98, lon: 2.82 } },
  { nombre: "Cuenca", punto: { lat: 40.07, lon: -2.14 } },
  { nombre: "Guadalajara", punto: { lat: 40.63, lon: -3.16 } },
  { nombre: "Toledo", punto: { lat: 39.86, lon: -4.03 } },
  { nombre: "Jaén", punto: { lat: 37.77, lon: -3.79 } },
  { nombre: "Granada", punto: { lat: 37.18, lon: -3.6 } },
  { nombre: "Málaga", punto: { lat: 36.72, lon: -4.42 } },
  { nombre: "Teruel", punto: { lat: 40.34, lon: -1.11 } },
  { nombre: "Zaragoza", punto: { lat: 41.65, lon: -0.89 } },
  { nombre: "Burgos", punto: { lat: 42.34, lon: -3.7 } },
  { nombre: "Soria", punto: { lat: 41.76, lon: -2.46 } },
  { nombre: "Segovia", punto: { lat: 40.95, lon: -4.12 } },
  { nombre: "Salamanca", punto: { lat: 40.97, lon: -5.66 } },
  { nombre: "Badajoz", punto: { lat: 38.88, lon: -6.97 } },
  { nombre: "Ciudad Real", punto: { lat: 38.99, lon: -3.93 } },
  { nombre: "Albacete", punto: { lat: 38.99, lon: -1.86 } },
  { nombre: "Castellón", punto: { lat: 39.99, lon: -0.04 } },
  { nombre: "Pamplona", punto: { lat: 42.81, lon: -1.64 } },
];

const GIRO_AVISO_GRADOS = 30;
const SUBIDA_RACHAS_KMH = 20;
const MS_AVISOS = 10 * 60_000;
const MS_ZONAS = 15 * 60_000;

type Memoria = { ultimosAvisos: number; ultimasZonas: number };
const memoria: Memoria = { ultimosAvisos: 0, ultimasZonas: 0 };

const NIVELES = ["bajo", "moderado", "alto", "muy_alto", "extremo"] as const;
const orden = (n: string) => NIVELES.indexOf(n as (typeof NIVELES)[number]);

async function refrescarAvisos(ctx: ContextoAgente): Promise<void> {
  try {
    const { avisos, fuente, detalle } = await avisosEspana();
    ctx.estado.avisosMeteo = avisos;
    ctx.estado.tocar();
    ctx.estado.marcarServicio("Avisos meteorológicos", true, `${avisos.length} avisos vigentes (${fuente})${detalle ? ` · ${detalle}` : ""}`);
  } catch (e) {
    ctx.estado.marcarServicio("Avisos meteorológicos", false, e instanceof Error ? e.message : String(e));
  }
}

async function refrescarZonas(ctx: ContextoAgente): Promise<number> {
  const meteos = await meteoMultipunto(ZONAS_ESPANA.map((z) => z.punto));
  const zonas: ZonaPeligro[] = ZONAS_ESPANA.map((z, i) => ({
    nombre: z.nombre,
    punto: z.punto,
    meteo: meteos[i],
    peligro: calcularPeligro(meteos[i]),
  })).filter((z) => Boolean(z.meteo));
  ctx.estado.zonasPeligro = zonas.sort((a, b) => b.peligro.valor - a.peligro.valor);
  ctx.estado.tocar();
  return zonas.length;
}

export const agenteMeteorologo: Agente = {
  id: "meteorologo",
  nombre: "Meteorólogo",
  categoria: "percepcion",
  descripcion:
    "Sigue la previsión horaria real de cada incendio con la hora de mundo, calcula el índice de peligro y avisa cuando el viento rola o el peligro sube.",
  modelo: "determinista",
  cadenciaSeg: 60,
  despiertaCon: ["incendio_nuevo"],

  async ciclo(ctx: ContextoAgente) {
    const incendios = ctx.estado.incendiosActivos();
    const eventos: NonNullable<Awaited<ReturnType<NonNullable<Agente["ciclo"]>>> extends infer R ? R extends { eventos?: infer E } ? E : never : never> = [];
    const avisosTexto: string[] = [];
    let fallos = 0;

    if (incendios.length === 0) {
      ctx.informarTarea("Sin incendios activos: vigilando el peligro meteorológico de España");
    }

    for (const incendio of incendios) {
      if (ctx.abortSignal.aborted) break;
      ctx.informarTarea(`Consultando la previsión horaria de ${incendio.nombre}`, incendio.id);
      try {
        const prevision = await previsionHoraria(incendio.centro);
        const nueva = aplicarVientoForzado(meteoEnHora(prevision, ctx.ahoraMundo), incendio);
        const lluvia24 = precipitacionAcumulada(prevision, ctx.ahoraMundo, 24);
        const peligro = calcularPeligro(nueva, incendio.combustible, lluvia24);
        const anterior = incendio.meteo;
        const peligroAnterior = incendio.peligro;

        ctx.estado.actualizar(ctx.estado.incendios, incendio.id, { meteo: nueva, peligro, actualizadoEn: ctx.ahoraMundo });
        ctx.estado.marcarServicio("Open-Meteo", true, `Previsión de ${incendio.nombre} al día`);

        if (anterior) {
          const giro = diferenciaAngular(anterior.direccionGrados, nueva.direccionGrados);
          const subidaRachas = nueva.rachasKmh - anterior.rachasKmh;
          if (giro > GIRO_AVISO_GRADOS || subidaRachas > SUBIDA_RACHAS_KMH) {
            const mensaje =
              giro > GIRO_AVISO_GRADOS
                ? `El viento en ${incendio.nombre} ha rolado de ${anterior.direccionTexto} a ${nueva.direccionTexto} (${Math.round(giro)}°), rachas ${Math.round(nueva.rachasKmh)} km/h`
                : `Las rachas en ${incendio.nombre} han subido de ${Math.round(anterior.rachasKmh)} a ${Math.round(nueva.rachasKmh)} km/h del ${nueva.direccionTexto}`;
            ctx.registrar("viento_gira", mensaje, {
              incendioId: incendio.id,
              nivel: "critico",
              datos: {
                incendioId: incendio.id,
                anteriorGrados: anterior.direccionGrados,
                nuevoGrados: nueva.direccionGrados,
                giroGrados: Math.round(giro),
                rachas: nueva.rachasKmh,
              },
            });
            avisosTexto.push(mensaje);
          }
        }

        if (peligroAnterior && orden(peligro.nivel) > orden(peligroAnterior.nivel)) {
          const mensaje = `El peligro en ${incendio.nombre} sube de ${peligroAnterior.nivel.replace("_", " ")} a ${peligro.nivel.replace("_", " ")} (${peligro.valor}/100). ${peligro.motivo}`;
          ctx.registrar("peligro_sube", mensaje, {
            incendioId: incendio.id,
            nivel: peligro.nivel === "extremo" || peligro.nivel === "muy_alto" ? "critico" : "aviso",
            datos: { incendioId: incendio.id, anterior: peligroAnterior.valor, nuevo: peligro.valor, nivel: peligro.nivel },
          });
          avisosTexto.push(mensaje);
        }
      } catch (e) {
        fallos += 1;
        const detalle = e instanceof Error ? e.message : String(e);
        ctx.estado.marcarServicio("Open-Meteo", false, detalle);
        ctx.registrar("sistema", `No se pudo actualizar la meteorología de ${incendio.nombre}: ${detalle}`, { incendioId: incendio.id, nivel: "aviso" });
      }
    }

    const ahora = Date.now();
    if (ahora - memoria.ultimosAvisos > MS_AVISOS) {
      memoria.ultimosAvisos = ahora;
      ctx.informarTarea("Actualizando los avisos oficiales de España");
      await refrescarAvisos(ctx);
    }

    let zonas = ctx.estado.zonasPeligro.length;
    if (ahora - memoria.ultimasZonas > MS_ZONAS || zonas === 0) {
      memoria.ultimasZonas = ahora;
      ctx.informarTarea("Calculando el peligro de las 30 zonas forestales de España");
      try {
        zonas = await refrescarZonas(ctx);
        const peores = ctx.estado.zonasPeligro.slice(0, 3).map((z) => `${z.nombre} ${z.peligro.valor}`).join(", ");
        ctx.estado.marcarServicio("Peligro por zonas", true, `${zonas} zonas · máximos: ${peores}`);
      } catch (e) {
        const detalle = e instanceof Error ? e.message : String(e);
        ctx.estado.marcarServicio("Peligro por zonas", false, detalle);
      }
    }

    const peor = ctx.estado.zonasPeligro[0];
    const resumen =
      incendios.length > 0
        ? `Meteorología actualizada en ${incendios.length - fallos} de ${incendios.length} incendios${avisosTexto.length ? `; ${avisosTexto[0]}` : ""}`
        : peor
          ? `Sin incendios activos. Peligro máximo en España: ${peor.nombre} ${peor.peligro.valor}/100 (${nivelDe(peor.peligro.valor).replace("_", " ")})`
          : "Sin incendios activos ni datos de zonas todavía";
    ctx.informarTarea(resumen);
    return { resumen, eventos: eventos.length ? eventos : undefined };
  },
};


/** Escenario del mando: sustituye SOLO el viento por el fijado a mano y lo deja marcado en la fuente. */
export function aplicarVientoForzado<T extends { direccionGrados: number; direccionTexto: string; vientoKmh: number; rachasKmh: number; fuente: string }>(
  meteo: T,
  incendio: { meteoForzada?: { direccionGrados: number; vientoKmh: number; rachasKmh?: number; fijadoPor: string } },
): T {
  const f = incendio.meteoForzada;
  if (!f) return meteo;
  const direccionGrados = ((f.direccionGrados % 360) + 360) % 360;
  return {
    ...meteo,
    direccionGrados,
    direccionTexto: gradosATexto(direccionGrados),
    vientoKmh: f.vientoKmh,
    rachasKmh: f.rachasKmh ?? Math.max(f.vientoKmh, Math.round(f.vientoKmh * 1.4)),
    fuente: `Viento forzado por ${f.fijadoPor} (ejercicio) sobre ${meteo.fuente}`,
  };
}
