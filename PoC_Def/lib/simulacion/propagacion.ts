// =====================================================================
// ATALAYA INCENDIOS · Modelo de propagación del fuego
// ---------------------------------------------------------------------
// DUEÑO: constructor D. Sin dependencias externas ni red: función pura
// sobre el Incendio y su Meteo real (Open-Meteo, constructor B).
//
// MODELO (elíptico tipo Rothermel simplificado, documentado a propósito
// para poder defenderlo ante el jurado):
//
//   1. Velocidad de cabeza (m/min de mundo)
//        R = R0(combustible) · Fviento · Fhumedad · Ftemperatura · Fpendiente
//
//      R0   pasto 1,50 · matorral 1,10 · bosque 0,70 · agrícola 0,50 · urbano 0,15
//           (velocidad de referencia sin viento, HR 40 %, 20 °C, llano)
//      Fviento     = 1 + 0,38 · U^1,20           U = viento sostenido en km/h,
//                    tomando U = max(viento, 0,85 · rachas) porque la cabeza
//                    avanza con las rachas, no con la media.
//      Fhumedad    = recorte(1,40 − 0,014 · HR, 0,25, 1,40)
//      Ftemperatura= recorte(1 + (T − 20)/60, 0,80, 1,50)
//      Fpendiente  = recorte(1 + 0,023·p + 0,00035·p², 1, 4)   p = pendiente %
//                    (el fuego sube la ladera mucho más rápido que la baja)
//      Lluvia: si ha llovido en la hora, Fhumedad se reduce a la mitad.
//
//   2. Forma: elipse con el punto de ignición en el foco. La relación
//      longitud/anchura crece con el viento:
//        LB = recorte(1 + 0,20 · U, 1, 8)
//      (sin viento el fuego es un círculo; con 35 km/h es una lengua muy
//      alargada, que es lo que se ve en los incendios de pasto reales).
//      Excentricidad e = √(LB² − 1) / LB y velocidad en el ángulo θ
//      respecto al rumbo del frente:
//        R(θ) = R · (1 − e) / (1 − e·cos θ)
//      θ = 0 → cabeza (R) · θ = 180° → cola (muy lenta) · flancos intermedios.
//
//   3. Estado del incendio: estabilizado ×0,2 · controlado, extinguido y
//      descartado ×0 (ya no avanza; los medios lo tienen cogido).
//
//   3 bis. EXTINCIÓN (constructor K, 2026-09-19): `propagar`, `predecir` y
//      `evaluarPoblaciones` aceptan un `factorExtincion` opcional (1 por
//      defecto) que multiplica la velocidad de cabeza. Lo calcula
//      lib/simulacion/contencion.ts a partir de la fracción de perímetro
//      controlada por las unidades, de las descargas aéreas y de la lluvia
//      real. Este archivo NO importa contencion.ts (la dependencia va en un
//      solo sentido): solo recibe el número ya calculado.
//
//   4. Rumbo del frente = dirección meteorológica del viento + 180°
//      (Open-Meteo da la dirección DESDE la que sopla).
//
// Limitaciones asumidas: no hay modelo de combustible por celda ni saltos
// de pavesas; la pendiente es un único valor medio del foco. Es un modelo
// operativo para decidir a quién avisar, no un simulador científico.
// =====================================================================
import type { Combustible, Incendio, Poblacion, PrediccionPropagacion, Punto, RiesgoPoblacion, Trazado } from "../dominio/tipos";
import {
  alcanceEnRumbo,
  areaHa as areaDePoligono,
  dentroDePoligono,
  diferenciaAngular,
  gradosATexto,
  normalizarGrados,
  poligonoDesdeRadios,
  radiosPorRumbo,
  recortar,
} from "./geometria";

/** Vértices del perímetro (uno cada 10°). */
export const VERTICES = 36;
/** Radio del perímetro de un foco recién declarado (m). */
export const RADIO_INICIAL_M = 60;
/** Semiapertura del cono de amenaza para las poblaciones (grados). */
export const SEMICONO_GRADOS = 40;

/** Velocidad de referencia sin viento por combustible dominante, en m/min. */
export const VELOCIDAD_BASE_MMIN: Record<Combustible["dominante"], number> = {
  pasto: 1.5,
  matorral: 1.1,
  bosque: 0.7,
  agricola: 0.5,
  urbano: 0.15,
};

export interface CondicionesPropagacion {
  vientoKmh: number;
  rachasKmh: number;
  /** Dirección DESDE la que sopla (meteorológica). */
  direccionGrados: number;
  humedadPct: number;
  temperaturaC: number;
  precipitacionMm: number;
  pendientePct: number;
  combustible: Combustible["dominante"];
}

/** Extrae las condiciones del incendio; sin meteo no hay propagación posible. */
export function condicionesDe(incendio: Incendio): CondicionesPropagacion | undefined {
  const m = incendio.meteo;
  if (!m) return undefined;
  return {
    vientoKmh: m.vientoKmh,
    rachasKmh: m.rachasKmh,
    direccionGrados: m.direccionGrados,
    humedadPct: m.humedadPct,
    temperaturaC: m.temperaturaC,
    precipitacionMm: m.precipitacionMm,
    pendientePct: incendio.pendientePct ?? 0,
    combustible: incendio.combustible?.dominante ?? "matorral",
  };
}

/** Viento efectivo que empuja la cabeza: la media o el 85 % de la racha. */
export const vientoEfectivoKmh = (c: Pick<CondicionesPropagacion, "vientoKmh" | "rachasKmh">): number =>
  Math.max(0, Math.max(c.vientoKmh ?? 0, 0.85 * (c.rachasKmh ?? 0)));

/** Velocidad de avance de la cabeza del frente en metros por minuto de mundo. */
export function velocidadCabezaMmin(c: CondicionesPropagacion): number {
  const base = VELOCIDAD_BASE_MMIN[c.combustible] ?? VELOCIDAD_BASE_MMIN.matorral;
  const u = vientoEfectivoKmh(c);
  const fViento = 1 + 0.38 * Math.pow(u, 1.2);
  let fHumedad = recortar(1.4 - 0.014 * (c.humedadPct ?? 40), 0.25, 1.4);
  if ((c.precipitacionMm ?? 0) > 0.2) fHumedad *= 0.5; // está lloviendo sobre el foco
  const fTemperatura = recortar(1 + ((c.temperaturaC ?? 20) - 20) / 60, 0.8, 1.5);
  const p = Math.max(0, c.pendientePct ?? 0);
  const fPendiente = recortar(1 + 0.023 * p + 0.00035 * p * p, 1, 4);
  return +(base * fViento * fHumedad * fTemperatura * fPendiente).toFixed(3);
}

/** Relación longitud/anchura de la elipse (1 = círculo, 8 = lengua muy alargada). */
export const relacionLongitudAnchura = (c: Pick<CondicionesPropagacion, "vientoKmh" | "rachasKmh">): number =>
  recortar(1 + 0.2 * vientoEfectivoKmh(c), 1, 8);

/** Excentricidad de la elipse a partir de la relación longitud/anchura. */
export const excentricidad = (lb: number): number => Math.sqrt(Math.max(0, lb * lb - 1)) / Math.max(1, lb);

/**
 * Velocidad de avance en un ángulo θ (grados) respecto al rumbo del frente.
 * Ecuación polar de la elipse con foco en el punto de ignición.
 */
export function velocidadEnAngulo(velocidadCabeza: number, lb: number, anguloGrados: number): number {
  const e = excentricidad(lb);
  const cos = Math.cos(normalizarGrados(anguloGrados) * (Math.PI / 180));
  const v = (velocidadCabeza * (1 - e)) / Math.max(1e-6, 1 - e * cos);
  // Suelo físico: ni la cola se queda completamente parada mientras haya llama.
  return Math.max(v, velocidadCabeza * 0.015);
}

/** Multiplicador por estado del incendio (estabilizado frena, controlado para). */
export function factorEstado(estado: Incendio["estado"]): number {
  if (estado === "estabilizado") return 0.2;
  if (estado === "controlado" || estado === "extinguido" || estado === "descartado") return 0;
  return 1;
}

/** Avanza el vector de radios `minutos` de mundo. Función pura. */
function avanzarRadios(radios: number[], rumboFrente: number, velocidadCabeza: number, lb: number, minutos: number): number[] {
  const paso = 360 / radios.length;
  return radios.map((r, i) => {
    const theta = diferenciaAngular(i * paso, rumboFrente);
    return r + velocidadEnAngulo(velocidadCabeza, lb, theta) * minutos;
  });
}

/**
 * Expande el perímetro del incendio `minutosMundo` minutos de mundo.
 * Devuelve exactamente los campos del Incendio que cambian, sin mutarlo.
 */
export function propagar(incendio: Incendio, minutosMundo: number, factorExtincion = 1): Pick<Incendio, "perimetro" | "areaHa" | "frente"> {
  const condiciones = condicionesDe(incendio);
  const ahora = incendio.actualizadoEn || new Date().toISOString();
  if (!condiciones) {
    // Sin meteo real no se inventa nada: el perímetro se queda como está.
    return { perimetro: incendio.perimetro, areaHa: incendio.areaHa, frente: incendio.frente };
  }

  const rumboFrente = normalizarGrados(condiciones.direccionGrados + 180);
  const lb = relacionLongitudAnchura(condiciones);
  const velocidadBruta = velocidadCabezaMmin(condiciones);
  const velocidad = +(velocidadBruta * factorEstado(incendio.estado) * recortar(factorExtincion, 0, 1)).toFixed(3);

  const radios = radiosPorRumbo(incendio.centro, incendio.perimetro, VERTICES, RADIO_INICIAL_M);
  const minutos = Math.max(0, minutosMundo || 0);
  const nuevos = velocidad > 0 && minutos > 0 ? avanzarRadios(radios, rumboFrente, velocidad, lb, minutos) : radios;
  const perimetro = poligonoDesdeRadios(incendio.centro, nuevos);

  return {
    perimetro,
    areaHa: +areaDePoligono(perimetro).toFixed(2),
    frente: {
      rumboGrados: +rumboFrente.toFixed(1),
      rumboTexto: gradosATexto(rumboFrente),
      velocidadMmin: velocidad,
      calculadoEn: ahora,
    },
  };
}

export interface AmenazaPoblacion {
  poblacionId: string;
  nombre: string;
  /** Minutos de mundo hasta que el frente la alcance; undefined = fuera de trayectoria. */
  etaMin?: number;
  riesgo: RiesgoPoblacion;
  /** Ángulo entre el rumbo del frente y la población (grados). */
  anguloGrados: number;
  enCono: boolean;
  distanciaKm: number;
  /** Frase para la pantalla. */
  explicacion: string;
}

/** Riesgo a partir del tiempo de llegada, según los umbrales operativos acordados. */
function riesgoPorEta(etaMin: number | undefined, enCono: boolean, distanciaKm: number): RiesgoPoblacion {
  if (enCono && etaMin !== undefined) {
    if (etaMin < 60) return "inminente";
    if (etaMin < 180) return "alto";
    if (etaMin < 360) return "medio";
    return "bajo";
  }
  // Fuera del cono el riesgo es bajo salvo proximidad: un giro del viento la
  // pondría en trayectoria en minutos, así que a menos de 2 km sigue contando.
  return distanciaKm < 2 ? "medio" : "bajo";
}

const ESCALA_RIESGO: RiesgoPoblacion[] = ["bajo", "medio", "alto", "inminente"];
const nivelDe = (r: RiesgoPoblacion): number => ESCALA_RIESGO.indexOf(r);
const mayorRiesgo = (a: RiesgoPoblacion, b: RiesgoPoblacion): RiesgoPoblacion => (nivelDe(a) >= nivelDe(b) ? a : b);
const subirUnEscalon = (r: RiesgoPoblacion): RiesgoPoblacion => ESCALA_RIESGO[Math.min(ESCALA_RIESGO.length - 1, nivelDe(r) + 1)];

/**
 * AÑADIDO (constructor K, 2026-09-19, a petición medida de J):
 * riesgo por PROXIMIDAD, independiente del tiempo de llegada.
 *
 * El caso que vio Javi en el mapa: Tuéjar, 1.221 habitantes con camping, colegio
 * y residencia, a 2,9 km de un foco, salía "bajo" con ETA de 42 h porque con
 * viento de 6 km/h y HR 95 % el frente avanza a 1,15 m/min. Un pueblo a 3 km de
 * un incendio forestal NO tiene riesgo bajo: basta que el viento rolde y se
 * levante para que esas 42 h se conviertan en 40 minutos. En protección civil
 * vale más adelantar el aviso que llegar tarde.
 */
export function riesgoPorDistancia(distanciaKm: number): RiesgoPoblacion {
  if (distanciaKm < 1) return "alto";
  if (distanciaKm < 3) return "medio";
  return "bajo";
}

/**
 * Calcula la amenaza sobre cada población con la meteo actual del incendio.
 * Se expone aparte de `predecir` porque el agente de propagación necesita el
 * riesgo de TODAS las poblaciones, no solo el de las que están en peligro.
 */
export function evaluarPoblaciones(incendio: Incendio, poblaciones: Poblacion[], factorExtincion = 1): AmenazaPoblacion[] {
  const condiciones = condicionesDe(incendio);
  const radios = radiosPorRumbo(incendio.centro, incendio.perimetro, VERTICES, RADIO_INICIAL_M);
  const rumboFrente = incendio.frente?.rumboGrados ?? (condiciones ? normalizarGrados(condiciones.direccionGrados + 180) : 0);
  const lb = condiciones ? relacionLongitudAnchura(condiciones) : 1;
  const velocidadCabeza = condiciones ? velocidadCabezaMmin(condiciones) * factorEstado(incendio.estado) * recortar(factorExtincion, 0, 1) : 0;

  return poblaciones.map((p) => {
    const rumboPoblacion = p.rumboDesdeFuegoGrados;
    const theta = diferenciaAngular(rumboPoblacion, rumboFrente);
    const enCono = theta <= SEMICONO_GRADOS;
    const distanciaM = Math.max(0, p.distanciaKm * 1000);
    const alcance = alcanceEnRumbo(radios, rumboPoblacion);
    const yaDentro = dentroDePoligono(p.centro, incendio.perimetro) || alcance >= distanciaM;

    // Velocidad con la que el frente se acerca a ESE pueblo: la mayor entre la
    // de la elipse en ese ángulo y la componente del avance de cabeza
    // (max(elipse, R·cos θ)). Es deliberadamente conservadora: en protección
    // civil vale más adelantar el aviso que llegar tarde.
    const vElipse = velocidadCabeza > 0 ? velocidadEnAngulo(velocidadCabeza, lb, theta) : 0;
    const vComponente = theta < 90 ? velocidadCabeza * Math.cos(theta * (Math.PI / 180)) : 0;
    const velocidad = Math.max(vElipse, vComponente);

    let etaMin: number | undefined;
    if (yaDentro) etaMin = 0;
    else if (velocidad > 0.05) etaMin = Math.round((distanciaM - alcance) / velocidad);

    // El riesgo es el MAYOR entre el que dicta el frente y el que dicta la mera
    // proximidad, y sube un escalón si el pueblo tiene colectivos vulnerables
    // (residencias, colegios, campings): no se pueden evacuar en diez minutos.
    const porEta = riesgoPorEta(etaMin, enCono, p.distanciaKm);
    const porDistancia = riesgoPorDistancia(p.distanciaKm);
    let riesgo: RiesgoPoblacion = yaDentro ? "inminente" : mayorRiesgo(porEta, porDistancia);
    if (!yaDentro && (p.vulnerables?.length ?? 0) > 0) riesgo = subirUnEscalon(riesgo);
    // Cuando el frente no la amenaza pero está pegada al foco, manda la proximidad:
    // la explicación tiene que decirlo o el usuario ve "fuera del cono" y "medio" sin relación.
    const mandaProximidad = !yaDentro && nivelDe(porDistancia) > nivelDe(porEta);

    const explicacion = yaDentro
      ? `${p.nombre} está dentro del perímetro actual`
      : (enCono && etaMin !== undefined
          ? `${p.nombre} está a ${p.distanciaKm.toFixed(1)} km al ${gradosATexto(rumboPoblacion)}, en la trayectoria del frente (${theta.toFixed(0)}° del eje): ~${etaMin} min`
          : `${p.nombre} está a ${p.distanciaKm.toFixed(1)} km al ${gradosATexto(rumboPoblacion)}, fuera del cono del frente (${theta.toFixed(0)}° del eje)`) +
        (mandaProximidad ? `; a ${p.distanciaKm.toFixed(1)} km basta un giro del viento para ponerla en trayectoria en minutos, así que el riesgo no baja de ${porDistancia}` : "") +
        ((p.vulnerables?.length ?? 0) > 0 ? `; tiene ${p.vulnerables?.length} colectivo(s) vulnerable(s), por lo que el riesgo sube un escalón` : "");

    return { poblacionId: p.id, nombre: p.nombre, etaMin, riesgo, anguloGrados: +theta.toFixed(1), enCono, distanciaKm: p.distanciaKm, explicacion };
  });
}

/**
 * Predicción a +1 h, +3 h y +6 h con la meteo ACTUAL (no se predice el giro
 * del viento: de eso se encarga el meteorólogo disparando `viento_gira`).
 */
export function predecir(incendio: Incendio, poblaciones: Poblacion[], factorExtincion = 1): PrediccionPropagacion {
  const condiciones = condicionesDe(incendio);
  const ahora = incendio.actualizadoEn || new Date().toISOString();
  const radios = radiosPorRumbo(incendio.centro, incendio.perimetro, VERTICES, RADIO_INICIAL_M);

  if (!condiciones) {
    const p = poligonoDesdeRadios(incendio.centro, radios);
    return {
      en1h: p,
      en3h: p,
      en6h: p,
      poblacionesEnPeligro: [],
      explicacion: "Sin datos meteorológicos del foco todavía: no se puede predecir la propagación.",
      calculadoEn: ahora,
    };
  }

  const rumboFrente = normalizarGrados(condiciones.direccionGrados + 180);
  const lb = relacionLongitudAnchura(condiciones);
  const velocidad = velocidadCabezaMmin(condiciones) * factorEstado(incendio.estado) * recortar(factorExtincion, 0, 1);

  const r1 = avanzarRadios(radios, rumboFrente, velocidad, lb, 60);
  const r3 = avanzarRadios(r1, rumboFrente, velocidad, lb, 120);
  const r6 = avanzarRadios(r3, rumboFrente, velocidad, lb, 180);

  const amenazas = evaluarPoblaciones(incendio, poblaciones, factorExtincion);
  const enPeligro = amenazas
    .filter((a) => a.etaMin !== undefined && (a.riesgo === "inminente" || a.riesgo === "alto" || a.riesgo === "medio"))
    .sort((a, b) => (a.etaMin ?? 1e9) - (b.etaMin ?? 1e9))
    .map((a) => ({ poblacionId: a.poblacionId, nombre: a.nombre, etaMin: a.etaMin as number }));

  const primera = enPeligro[0];
  const explicacion =
    `Frente al ${gradosATexto(rumboFrente)} a ${velocidad.toFixed(1)} m/min ` +
    `(viento ${condiciones.vientoKmh.toFixed(0)} km/h del ${gradosATexto(condiciones.direccionGrados)}, ` +
    `HR ${condiciones.humedadPct.toFixed(0)} %, ${condiciones.temperaturaC.toFixed(0)} °C, combustible ${condiciones.combustible}` +
    (condiciones.pendientePct > 5 ? `, pendiente ${condiciones.pendientePct.toFixed(0)} %` : "") +
    `). ` +
    (factorExtincion < 0.99 ? `Los medios ya frenan el avance (×${factorExtincion.toFixed(2)}). ` : "") +
    (primera
      ? `${primera.nombre} quedaría alcanzada en ~${primera.etaMin} min si el viento sigue igual.`
      : "Ninguna población en la trayectoria con la meteo actual.");

  return {
    en1h: poligonoDesdeRadios(incendio.centro, r1),
    en3h: poligonoDesdeRadios(incendio.centro, r3),
    en6h: poligonoDesdeRadios(incendio.centro, r6),
    poblacionesEnPeligro: enPeligro,
    explicacion,
    calculadoEn: ahora,
  };
}

/** Perímetro circular inicial para un foco recién declarado (lo usa A si lo necesita). */
export function perimetroInicial(centro: Punto, radioM = RADIO_INICIAL_M): Trazado {
  return poligonoDesdeRadios(centro, new Array<number>(VERTICES).fill(radioM));
}

/**
 * AÑADIDO (sesión superficie-real, 2026-09-19). Perímetro circular inicial
 * cuya superficie MEDIDA (geometria.areaHa, la misma fórmula con la que el
 * mapa mide lo que dibuja) es exactamente `hectareas`. Un polígono de 36
 * lados inscrito en un círculo mide un 1 % menos que π·r²: si la fuente dice
 * "24 ha", se guardaba 24 y se dibujaba un círculo de radio √(A/π) que medía
 * 23,7. Aquí se corrige el radio para que la cifra y el trazado coincidan.
 */
export function perimetroDeSuperficie(centro: Punto, hectareas: number): Trazado {
  const objetivo = Math.max(0.01, hectareas);
  let radioM = Math.sqrt((objetivo * 10_000) / Math.PI);
  let poligono = perimetroInicial(centro, radioM);
  const medida = areaDePoligono(poligono);
  if (medida > 0) {
    // El área escala con r², así que una sola corrección deja la medida clavada.
    radioM *= Math.sqrt(objetivo / medida);
    poligono = perimetroInicial(centro, radioM);
  }
  return poligono;
}
