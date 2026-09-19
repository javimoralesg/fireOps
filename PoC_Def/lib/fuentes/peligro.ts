// =====================================================================
// Índice de peligro de incendio (FWI simplificado). DUEÑO: constructor B.
// ---------------------------------------------------------------------
// Open-Meteo NO publica fire_weather_index (verificado: HTTP 400), así que
// calculamos un índice propio 0..100 con las variables que SÍ existen y que
// son las que usa el FWI canadiense de Van Wagner en su parte meteorológica:
// temperatura, humedad relativa, viento (y rachas), lluvia reciente y déficit
// de presión de vapor (VPD), modulado por el combustible dominante del OSM.
//
// FÓRMULA (documentada a propósito, para poder defenderla ante el jurado):
//
//   secoHR   = recorte((60 - HR) / 45)             · aire seco
//   calor    = recorte((T - 12) / 26)              · calor
//   vientoN  = recorte(max(viento, rachas*0,85) / 55)
//   vpdN     = recorte(VPD / 3,5)                  · mejor predictor individual
//   bruto    = 100 * (0,30·secoHR + 0,20·calor + 0,28·vientoN + 0,22·vpdN)
//   lluvia   = 1 - recorte(precipitación24h / 8)*0,55   · la lluvia apaga
//   factorCombustible ∈ [0,70 .. 1,15] según la mezcla OSM del entorno
//   valor    = redondear(bruto · lluvia · factorCombustible)  (0..100)
//
// Si falta el VPD (algunas respuestas multipunto), su peso se reparte entre
// humedad y calor para que el índice no se hunda artificialmente.
//
// Niveles: bajo <20 · moderado <40 · alto <60 · muy_alto <80 · extremo ≥80
// Regla 30-30-30 (criterio operativo clásico): T>30 °C, HR<30 %, viento>30 km/h.
// =====================================================================
import type { Combustible, IndicePeligro, Meteo, NivelPeligro } from "../dominio/tipos";

const recorte = (x: number): number => Math.max(0, Math.min(1, x));

/** Multiplicador por combustible dominante (bosque/matorral suben, agrícola/urbano bajan). */
export function factorCombustible(c?: Combustible): number {
  if (!c) return 1;
  const f =
    1 +
    0.12 * (c.bosque ?? 0) +
    0.15 * (c.matorral ?? 0) +
    0.05 * (c.pasto ?? 0) -
    0.15 * (c.agricola ?? 0) -
    0.30 * (c.urbano ?? 0);
  return Math.max(0.7, Math.min(1.15, +f.toFixed(3)));
}

const ETIQUETA_COMBUSTIBLE: Record<Combustible["dominante"], string> = {
  bosque: "masa forestal",
  matorral: "matorral seco",
  pasto: "pastizal",
  agricola: "terreno agrícola",
  urbano: "suelo urbano",
};

/** Criterio operativo 30-30-30: T > 30 °C, HR < 30 %, viento > 30 km/h. */
export function regla30_30_30(meteo: Meteo): boolean {
  return meteo.temperaturaC > 30 && meteo.humedadPct < 30 && Math.max(meteo.vientoKmh, meteo.rachasKmh) > 30;
}

export function nivelDe(valor: number): NivelPeligro {
  if (valor >= 80) return "extremo";
  if (valor >= 60) return "muy_alto";
  if (valor >= 40) return "alto";
  if (valor >= 20) return "moderado";
  return "bajo";
}

/**
 * Índice 0..100 con nivel y motivo en una frase.
 * `precipitacion24hMm` permite pasar la lluvia acumulada real (de la previsión
 * horaria); si no se pasa, se usa la precipitación de la hora de la meteo.
 */
export function calcularPeligro(meteo: Meteo, combustible?: Combustible, precipitacion24hMm?: number): IndicePeligro {
  const secoHR = recorte((60 - meteo.humedadPct) / 45);
  const calor = recorte((meteo.temperaturaC - 12) / 26);
  const vientoEfectivo = Math.max(meteo.vientoKmh, meteo.rachasKmh * 0.85);
  const vientoN = recorte(vientoEfectivo / 55);
  const hayVpd = typeof meteo.vpd === "number" && Number.isFinite(meteo.vpd);
  const vpdN = hayVpd ? recorte((meteo.vpd as number) / 3.5) : 0;

  // Pesos: si no hay VPD su 0,22 se reparte entre humedad (0,13) y calor (0,09).
  const pesoHR = hayVpd ? 0.3 : 0.43;
  const pesoCalor = hayVpd ? 0.2 : 0.29;
  const pesoViento = 0.28;
  const pesoVpd = hayVpd ? 0.22 : 0;

  const bruto = 100 * (pesoHR * secoHR + pesoCalor * calor + pesoViento * vientoN + pesoVpd * vpdN);
  const lluviaMm = precipitacion24hMm ?? meteo.precipitacionMm;
  const factorLluvia = 1 - recorte(lluviaMm / 8) * 0.55;
  const fc = factorCombustible(combustible);
  const valor = Math.max(0, Math.min(100, Math.round(bruto * factorLluvia * fc)));
  const nivel = nivelDe(valor);

  const partes: string[] = [
    `Humedad ${Math.round(meteo.humedadPct)} %`,
    `${Math.round(meteo.temperaturaC)} °C`,
    `rachas ${Math.round(meteo.rachasKmh)} km/h del ${meteo.direccionTexto}`,
  ];
  if (hayVpd) partes.push(`VPD ${(meteo.vpd as number).toFixed(1)} kPa`);
  if (combustible) partes.push(ETIQUETA_COMBUSTIBLE[combustible.dominante]);
  if (lluviaMm >= 0.5) partes.push(`${lluviaMm.toFixed(1)} mm de lluvia reciente`);
  if (regla30_30_30(meteo)) partes.push("se cumple la regla 30-30-30");

  return {
    valor,
    nivel,
    motivo: `${partes.join(", ")}.`,
    calculadoEn: new Date().toISOString(),
  };
}
