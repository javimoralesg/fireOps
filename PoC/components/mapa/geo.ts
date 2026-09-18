// Geometría geográfica sin dependencias (se puede usar en servidor y cliente).
// Rumbos en grados desde el norte, sentido horario. Coordenadas [lat, lon] WGS84.

export type LatLon = [number, number];

const R = 6_371_000; // radio medio de la Tierra (m)
const rad = (g: number) => (g * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
export const normalizar = (g: number) => ((g % 360) + 360) % 360;

/** Diferencia angular mínima entre dos rumbos (0..180). */
export function difAngular(a: number, b: number) {
  const d = Math.abs(normalizar(a) - normalizar(b));
  return d > 180 ? 360 - d : d;
}

/** Distancia ortodrómica en metros (haversine). */
export function distanciaM([lat1, lon1]: LatLon, [lat2, lon2]: LatLon) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Rumbo inicial de a hacia b. */
export function rumbo([lat1, lon1]: LatLon, [lat2, lon2]: LatLon) {
  const φ1 = rad(lat1);
  const φ2 = rad(lat2);
  const Δλ = rad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizar(deg(Math.atan2(y, x)));
}

/** Punto a `distancia` metros de `origen` siguiendo `rumboGrados`. */
export function destino([lat, lon]: LatLon, rumboGrados: number, distancia: number): LatLon {
  const δ = distancia / R;
  const θ = rad(rumboGrados);
  const φ1 = rad(lat);
  const λ1 = rad(lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [deg(φ2), normalizar(deg(λ2) + 540) - 180];
}

export interface Penacho {
  /** Hacia dónde VA el humo (viento meteorológico + 180). */
  rumboGrados: number;
  longitudM: number;
  semianguloGrados: number;
}

/**
 * Modelo simple de penacho a partir del viento. Si el servidor envía su propio
 * cálculo (entorno.penacho) hay que usar ese para que mapa, grafo y decisiones coincidan.
 */
export function penachoDesdeViento(viento: { direccionGrados: number; velocidadKmh: number }): Penacho {
  return {
    rumboGrados: normalizar(viento.direccionGrados + 180),
    longitudM: Math.min(4500, 500 + 90 * viento.velocidadKmh),
    semianguloGrados: 28,
  };
}

/** Polígono en abanico del penacho, con vértice en el foco. */
export function poligonoPenacho(origen: LatLon, p: Penacho, pasos = 24): LatLon[] {
  const puntos: LatLon[] = [origen];
  for (let i = 0; i <= pasos; i++) {
    const a = p.rumboGrados - p.semianguloGrados + (2 * p.semianguloGrados * i) / pasos;
    puntos.push(destino(origen, a, p.longitudM));
  }
  return puntos;
}

/** ¿Está el punto bajo el penacho? */
export function bajoPenacho(origen: LatLon, p: Penacho, punto: LatLon) {
  const d = distanciaM(origen, punto);
  if (d < 1 || d > p.longitudM) return false;
  return difAngular(rumbo(origen, punto), p.rumboGrados) <= p.semianguloGrados;
}

/** Rumbo en texto (rosa de 16 vientos). */
export function rumboTexto(g: number) {
  const rosa = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  return rosa[Math.round(normalizar(g) / 22.5) % 16];
}

export function formatearDistancia(m: number) {
  return m >= 1000 ? `${(m / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`;
}

export function formatearDuracion(s: number) {
  const min = Math.round(s / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Interpola puntos cada `pasoM` metros en los segmentos más largos que eso. */
export function densificar(coords: LatLon[], pasoM = 50): LatLon[] {
  const salida: LatLon[] = [];
  coords.forEach((b, i) => {
    if (i > 0) {
      const a = coords[i - 1];
      const n = Math.floor(distanciaM(a, b) / pasoM);
      for (let k = 1; k < n; k++) salida.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    salida.push(b);
  });
  return salida;
}

/** ¿Pasa alguna parte de la línea por debajo del penacho? (muestreo cada `pasoM` metros) */
export function lineaBajoPenacho(origen: LatLon, p: Penacho, coords: LatLon[], pasoM = 30) {
  return densificar(coords, pasoM).some((c) => bajoPenacho(origen, p, c));
}

/**
 * Trocea una línea en los tramos que caen a menos de `radioM` de `centro`, con un
 * vértice de margen a cada lado para que el tramo no se corte en seco.
 */
export function recortarTramos(coords: LatLon[], centro: LatLon, radioM: number): LatLon[][] {
  const puntos = densificar(coords, 60);
  const tramos: LatLon[][] = [];
  let actual: LatLon[] = [];
  puntos.forEach((c, i) => {
    if (distanciaM(c, centro) <= radioM) {
      if (!actual.length && i > 0) actual.push(puntos[i - 1]);
      actual.push(c);
    } else if (actual.length) {
      actual.push(c);
      tramos.push(actual);
      actual = [];
    }
  });
  if (actual.length) tramos.push(actual);
  return tramos.filter((t) => t.length > 1);
}

/** Nombre comparable: sin tildes, en minúsculas y sin signos ("C/ Méndez Álvaro" = "c mendez alvaro"). */
export function normalizarNombre(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "21:45" en hora local de España. */
export function horaCorta(iso: string | number | Date) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
