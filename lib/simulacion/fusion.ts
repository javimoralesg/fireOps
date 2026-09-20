// =====================================================================
// ATALAYA INCENDIOS · FUSIÓN de focos por cercanía
// ---------------------------------------------------------------------
// DUEÑO: constructor K. Dos focos que crecen el uno hacia el otro acaban
// siendo UN incendio: se juntan las columnas, se juntan los perímetros y el
// escenario cambia de golpe (más superficie, más frente, más población en
// trayectoria y un único mando). Hasta ahora Atalaya los mantenía como dos
// incidencias independientes para siempre.
//
// CRITERIO: dos focos activos se fusionan cuando sus perímetros se solapan
// o distan menos de `UMBRAL_FUSION_M` (300 m) BORDE A BORDE. 300 m es el
// orden de magnitud de la distancia a la que dos frentes se atraen
// mutuamente por convección y pavesas y ya no se pueden trabajar por
// separado; por debajo de esa distancia el sector intermedio deja de ser
// defendible y la dirección de extinción unifica el dispositivo.
//
// QUIÉN SOBREVIVE: el foco más consolidado (un "confirmado" absorbe a un
// "detectado") y, a igualdad, el más antiguo. El absorbido NO se borra:
// pasa a estado "fusionado" con `fusionadoEn`, así su hilo, sus decisiones
// y sus actas siguen íntegros para la auditoría.
//
// PERÍMETRO RESULTANTE: envolvente convexa de los vértices de los dos
// perímetros, remuestreada a 36 radios desde el nuevo centro (el mismo
// formato con el que trabaja el modelo de propagación) por intersección de
// rayo, que es fiel a la geometría. La envolvente incluye el hueco entre los
// dos focos: es una unión por exceso, pero el hueco entre dos frentes que ya
// se tocan se consume en minutos, así que es también la hipótesis segura.
//
// Dependencias: solo ./geometria y ./propagacion (constantes). La parte que
// toca el estado vivo (`aplicarFusion`) recibe el `Estado` por parámetro.
// =====================================================================
import type { Estado } from "../motor/estado";
import type { Decision, Incendio, Punto, Trazado } from "../dominio/tipos";
import { areaHa as areaDePoligono, centroide, distanciaEntrePerimetrosM, distanciaKm, envolventeConvexa, poligonoDesdeRadios, radiosPorRayo, rumbo } from "./geometria";
import { RADIO_INICIAL_M, VERTICES } from "./propagacion";

/** Distancia borde a borde (m) por debajo de la cual dos focos son ya uno solo. */
export const UMBRAL_FUSION_M = 300;

/** Estados en los que un foco todavía puede fusionarse con otro. */
export const ESTADOS_FUSIONABLES: Incendio["estado"][] = ["detectado", "confirmado", "activo", "estabilizado"];

export interface PlanFusion {
  superviviente: Incendio;
  absorbido: Incendio;
  /** Distancia borde a borde que ha disparado la fusión (m). */
  distanciaBordeM: number;
  centro: Punto;
  perimetro: Trazado;
  areaHa: number;
  nombre: string;
}

/** Cuánto "pesa" un foco para decidir quién absorbe a quién. */
const consolidacion = (i: Incendio): number => (i.estado === "detectado" ? 0 : 1);

/** Elige superviviente y absorbido de una pareja. */
export function elegirSuperviviente(a: Incendio, b: Incendio): { superviviente: Incendio; absorbido: Incendio } {
  if (consolidacion(a) !== consolidacion(b)) return consolidacion(a) > consolidacion(b) ? { superviviente: a, absorbido: b } : { superviviente: b, absorbido: a };
  const ta = Date.parse(a.detectadoEn) || Number.MAX_SAFE_INTEGER;
  const tb = Date.parse(b.detectadoEn) || Number.MAX_SAFE_INTEGER;
  return ta <= tb ? { superviviente: a, absorbido: b } : { superviviente: b, absorbido: a };
}

/** Nombre del foco resultante. */
export function nombreFusionado(superviviente: Incendio, absorbido: Incendio): string {
  const ma = (superviviente.municipio || "").trim();
  const mb = (absorbido.municipio || "").trim();
  if (!ma || !mb || ma.toLowerCase() === mb.toLowerCase()) return superviviente.nombre;
  return `Incendio de ${ma} – ${mb}`;
}

/** Perímetro, centro y área del foco resultante de unir dos perímetros. */
export function unirPerimetros(a: Incendio, b: Incendio): { centro: Punto; perimetro: Trazado; areaHa: number } {
  const vertices: Punto[] = [...(a.perimetro ?? []), ...(b.perimetro ?? [])].map(([lat, lon]) => ({ lat, lon }));
  if (!vertices.length) return { centro: a.centro, perimetro: a.perimetro, areaHa: a.areaHa };

  const casco = envolventeConvexa(vertices);
  const centro = casco.length >= 3 ? centroide(casco) : a.centro;
  // Remuestreo FIEL (rayo contra la envolvente, no media de vecinos): con dos
  // lenguas alargadas paralelas, `radiosPorRumbo` inflaría el área varias veces.
  const radios = radiosPorRayo(centro, casco, VERTICES, RADIO_INICIAL_M);
  const perimetro = poligonoDesdeRadios(centro, radios);
  return { centro, perimetro, areaHa: +areaDePoligono(perimetro).toFixed(2) };
}

/**
 * Parejas de focos que deben fusionarse AHORA, ordenadas por cercanía.
 * Función pura: no toca el estado. Cada foco aparece como mucho en una
 * pareja; las cadenas (A-B-C) se resuelven en ciclos sucesivos.
 */
export function planificarFusiones(incendios: Incendio[], umbralM = UMBRAL_FUSION_M): PlanFusion[] {
  const candidatos = incendios.filter((i) => ESTADOS_FUSIONABLES.includes(i.estado) && !i.fusionadoEn && (i.perimetro?.length ?? 0) >= 3);
  const parejas: { a: Incendio; b: Incendio; d: number }[] = [];

  for (let i = 0; i < candidatos.length; i++) {
    for (let j = i + 1; j < candidatos.length; j++) {
      const a = candidatos[i];
      const b = candidatos[j];
      // Filtro barato antes de la geometría fina: si los centros están a más
      // de 25 km no hace falta medir borde a borde.
      if (distanciaKm(a.centro, b.centro) > 25) continue;
      const d = distanciaEntrePerimetrosM(a.perimetro, b.perimetro);
      if (d <= umbralM) parejas.push({ a, b, d });
    }
  }

  parejas.sort((x, y) => x.d - y.d);
  const usados = new Set<string>();
  const planes: PlanFusion[] = [];
  for (const { a, b, d } of parejas) {
    if (usados.has(a.id) || usados.has(b.id)) continue;
    usados.add(a.id);
    usados.add(b.id);
    const { superviviente, absorbido } = elegirSuperviviente(a, b);
    const union = unirPerimetros(superviviente, absorbido);
    planes.push({ superviviente, absorbido, distanciaBordeM: d, ...union, nombre: nombreFusionado(superviviente, absorbido) });
  }
  return planes;
}

/** La primera fusión pendiente, si la hay. */
export const siguienteFusion = (incendios: Incendio[], umbralM = UMBRAL_FUSION_M): PlanFusion | undefined => planificarFusiones(incendios, umbralM)[0];

export interface ResultadoFusion {
  superviviente: Incendio;
  absorbido: Incendio;
  unidadesTraspasadas: number;
  poblacionesTraspasadas: number;
  decisionesCaducadas: string[];
  clustersMarcados: string[];
  mensaje: string;
}

/** Estados de decisión que se caducan al fusionar (el plan anterior ya no vale). */
const PENDIENTES: Decision["estado"][] = ["propuesta", "pendiente_humano", "escalada"];

/**
 * Aplica la fusión sobre el estado vivo. NO emite eventos ni despierta
 * agentes: de eso se encarga el agente `propagacion`, que es quien tiene el
 * `ContextoAgente`. Devuelve el resumen de lo movido.
 */
export function aplicarFusion(estado: Estado, plan: PlanFusion, ahoraMundo: string): ResultadoFusion {
  const { absorbido } = plan;
  const superviviente = estado.incendios.get(plan.superviviente.id) ?? plan.superviviente;
  const previo = estado.incendios.get(absorbido.id) ?? absorbido;

  // --- 1. El superviviente se queda con la unión ------------------------
  const observaciones = [...new Set([...(superviviente.observaciones ?? []), ...(previo.observaciones ?? [])])];
  const absorbidos = [...new Set([...(superviviente.focosAbsorbidos ?? []), previo.id, ...(previo.focosAbsorbidos ?? [])])];

  // La línea de control construida en los dos focos se suma, pero el sector
  // donde se han juntado se pierde: la fusión reabre el perímetro, así que se
  // borran los hitos y el foco vuelve a estar en carrera.
  const lineaPrevia = (superviviente.contencion?.perimetroControladoM ?? 0) + (previo.contencion?.perimetroControladoM ?? 0);
  const contencion = superviviente.contencion || previo.contencion
    ? {
        ...(superviviente.contencion ?? {
          perimetroTotalM: Math.max(1, lineaPrevia),
          perimetroControladoM: 0,
          fraccion: 0,
          ritmoMmin: 0,
          unidadesTrabajando: 0,
          mediosAereos: false,
          calculadoEn: ahoraMundo,
        }),
        perimetroControladoM: +lineaPrevia.toFixed(1),
        estabilizadoEn: undefined,
        controladoEn: undefined,
        vientoEstabilizadoKmh: undefined,
        calculadoEn: ahoraMundo,
        explicacion: "Los focos se han unido: el perímetro vuelve a estar abierto y la línea hay que rehacerla.",
      }
    : undefined;

  const actualizado = estado.actualizar(estado.incendios, superviviente.id, {
    nombre: plan.nombre,
    centro: plan.centro,
    perimetro: plan.perimetro,
    areaHa: plan.areaHa,
    nivelGravedad: (Math.max(superviviente.nivelGravedad, previo.nivelGravedad) as Incendio["nivelGravedad"]),
    confianza: Math.max(superviviente.confianza, previo.confianza),
    estado: superviviente.estado === "detectado" && previo.estado !== "detectado" ? previo.estado : superviviente.estado,
    observaciones,
    focosAbsorbidos: absorbidos,
    contencion,
    actualizadoEn: ahoraMundo,
  }) ?? superviviente;

  // --- 2. El absorbido queda cerrado pero íntegro (auditoría) -----------
  estado.actualizar(estado.incendios, previo.id, { estado: "fusionado", fusionadoEn: actualizado.id, actualizadoEn: ahoraMundo });

  // --- 3. Medios: un solo mando ----------------------------------------
  let unidadesTraspasadas = 0;
  for (const u of [...estado.unidades.values()]) {
    if (u.incendioId !== previo.id) continue;
    estado.actualizar(estado.unidades, u.id, { incendioId: actualizado.id, sector: undefined });
    unidadesTraspasadas += 1;
  }

  // --- 4. Poblaciones: se recalcula distancia y rumbo desde el nuevo centro
  let poblacionesTraspasadas = 0;
  for (const p of [...estado.poblaciones.values()]) {
    const era = p.incendioId === previo.id;
    if (!era && p.incendioId !== actualizado.id) continue;
    estado.actualizar(estado.poblaciones, p.id, {
      incendioId: actualizado.id,
      distanciaKm: +distanciaKm(actualizado.centro, p.centro).toFixed(2),
      rumboDesdeFuegoGrados: +rumbo(actualizado.centro, p.centro).toFixed(1),
    });
    if (era) poblacionesTraspasadas += 1;
  }

  // --- 5. Decisiones pendientes de los dos focos: el plan ya no vale ----
  const decisionesCaducadas: string[] = [];
  for (const d of [...estado.decisiones.values()]) {
    if (d.incendioId !== previo.id && d.incendioId !== actualizado.id) continue;
    if (!PENDIENTES.includes(d.estado)) continue;
    estado.actualizar(estado.decisiones, d.id, {
      estado: "caducada",
      decididaEn: new Date().toISOString(),
      decididaPor: "ia:propagacion",
      comentarioHumano: d.comentarioHumano,
      historial: [
        ...(d.historial ?? []),
        { en: new Date().toISOString(), enMundo: ahoraMundo, estado: "caducada" as const, quien: "ia:propagacion", motivo: "focos fusionados" },
      ],
    });
    decisionesCaducadas.push(d.id);
  }

  // --- 6. El clúster de patrones deja de ser una hipótesis --------------
  const clustersMarcados: string[] = [];
  for (const c of [...estado.clusters.values()]) {
    if (!c.incendios.includes(previo.id) || !c.incendios.includes(actualizado.id)) continue;
    estado.actualizar(estado.clusters, c.id, {
      tipo: "mismo_incendio",
      analisis: `${c.analisis}\n\nConfirmado sobre el terreno: los perímetros se han unido a las ${ahoraMundo.slice(11, 16)} de mundo.`,
      actualizadoEn: ahoraMundo,
    });
    clustersMarcados.push(c.id);
  }

  const mensaje =
    `Los focos ${previo.nombre} y ${superviviente.nombre} se han unido: ${actualizado.areaHa.toFixed(0)} ha` +
    (actualizado.frente ? `, frente al ${actualizado.frente.rumboTexto}` : "") +
    `. ${unidadesTraspasadas} unidad(es) y ${poblacionesTraspasadas} población(es) pasan a ${actualizado.nombre}.`;

  return { superviviente: actualizado, absorbido: previo, unidadesTraspasadas, poblacionesTraspasadas, decisionesCaducadas, clustersMarcados, mensaje };
}
