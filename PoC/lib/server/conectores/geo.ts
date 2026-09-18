// Utilidades geográficas: WGS84 → UTM (huso 30N, el de Madrid) y distancia.
// Los sensores de informo.madrid.es vienen en UTM ETRS89 huso 30 (st_x, st_y).

export function latLonToUtm30(lat: number, lon: number): { x: number; y: number } {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const lon0 = (-3 * Math.PI) / 180; // meridiano central huso 30
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const φ = (lat * Math.PI) / 180;
  const λ = (lon * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
  const T = Math.tan(φ) ** 2;
  const C = ep2 * Math.cos(φ) ** 2;
  const A = Math.cos(φ) * (λ - lon0);
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * φ -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * φ) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * φ) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * φ));
  const x =
    k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  const y =
    k0 *
    (M +
      N *
        Math.tan(φ) *
        (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 + ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
  return { x, y };
}

export function distanciaMetros(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Rosa de 16 rumbos en castellano (N, NNE, NE, ENE, E, ESE, SE, SSE, S, SSO, SO, OSO, O, ONO, NO, NNO). */
export function gradosATexto(g: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  return dirs[Math.round((((g % 360) + 360) % 360) / 22.5) % 16];
}

/** Hacia dónde va el humo/viento: rumbo opuesto a la dirección de origen. */
export function destinoViento(direccionGrados: number): string {
  return gradosATexto(direccionGrados + 180);
}

/** Rumbo (0..360) desde a hacia b en coordenadas planas (x este, y norte). */
export function rumboGrados(a: { x: number; y: number }, b: { x: number; y: number }) {
  return (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
}

/** Offset en minutos de Europe/Madrid para un instante dado. */
function offsetMadridMin(instante: Date): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(instante).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
  const comoUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((comoUtc - instante.getTime()) / 60000);
}

/** Convierte una hora de pared de Madrid ("18/09/2026 20:50:04" o "2026-09-18T20:45") a ISO 8601 UTC. */
export function madridLocalAIso(texto: string): string {
  let y: number, mo: number, d: number, h = 0, mi = 0, se = 0;
  let m = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) [d, mo, y, h, mi, se] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  else {
    m = texto.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return new Date(texto).toISOString();
    [y, mo, d, h, mi, se] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  }
  const aprox = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  const off = offsetMadridMin(aprox);
  return new Date(aprox.getTime() - off * 60000).toISOString();
}
