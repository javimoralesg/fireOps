// Pruebas de components/mapa/animacion.ts · movimiento continuo de las unidades:
// duración adaptada a la cadencia con la que llegan posiciones, seguimiento de
// la carretera y llamadas repetidas sin reinicio. DUEÑO: constructor L (añadidas
// por Q). El módulo es "use client" pero no toca el DOM: basta con simular
// `requestAnimationFrame` y `performance.now`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Marker } from "leaflet";
import { ANIMACION_MS, moverMarcador, olvidarMarcador, unidadesAnimandose } from "@/components/mapa/animacion";

/** Marcador mínimo: solo lo que usa el módulo. */
function marcadorFalso(lat: number, lng: number): Marker & { historial: [number, number][] } {
  const m = {
    _pos: { lat, lng },
    historial: [] as [number, number][],
    getLatLng() {
      return this._pos;
    },
    setLatLng(p: [number, number]) {
      this._pos = { lat: p[0], lng: p[1] };
      this.historial.push([p[0], p[1]]);
      return this;
    },
  };
  creados.push(m as unknown as Marker);
  return m as unknown as Marker & { historial: [number, number][] };
}

let ahora = 0;
let pendientes: Array<(t: number) => void> = [];
/** Marcadores creados en la prueba: se olvidan siempre, falle o no. */
let creados: Marker[] = [];

/**
 * Avanza el reloj en fotogramas de 40 ms (alineados desde 0, como haría el
 * navegador) hasta cubrir `ms`, ejecutando los encolados.
 */
function avanzar(ms: number): void {
  const fin = ahora + ms;
  while (ahora < fin) {
    ahora += 40;
    const cola = pendientes;
    pendientes = [];
    for (const f of cola) f(ahora);
  }
}

beforeEach(() => {
  ahora = 0;
  pendientes = [];
  vi.stubGlobal("requestAnimationFrame", (f: (t: number) => void) => {
    pendientes.push(f);
    return pendientes.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    pendientes = [];
  });
  vi.spyOn(performance, "now").mockImplementation(() => ahora);
});

afterEach(() => {
  for (const m of creados) olvidarMarcador(m);
  creados = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("moverMarcador", () => {
  it("la primera vez anima durante ANIMACION_MS y llega exacto al destino", () => {
    const m = marcadorFalso(40, -3);
    moverMarcador(m, [40.01, -3]);
    avanzar(ANIMACION_MS / 2);
    expect(m.getLatLng().lat).toBeCloseTo(40.005, 3); // ± un fotograma de 40 ms
    avanzar(ANIMACION_MS / 2);
    expect(m.getLatLng().lat).toBeCloseTo(40.01, 9);
    expect(unidadesAnimandose()).toBe(0);
    olvidarMarcador(m);
  });

  it("adapta la duración a la cadencia con la que llegan posiciones (sin parones)", () => {
    const m = marcadorFalso(40, -3);
    moverMarcador(m, [40.01, -3]); // t=0, cadencia desconocida
    avanzar(5000); // la siguiente posición llega 5 s después
    moverMarcador(m, [40.02, -3]);
    // A mitad de esos 5 s el marcador va por la mitad del tramo: sigue moviéndose,
    // no corrió 1,4 s y se quedó clavado.
    avanzar(2500);
    expect(m.getLatLng().lat).toBeCloseTo(40.015, 3);
    expect(unidadesAnimandose()).toBe(1);
    avanzar(2500);
    expect(m.getLatLng().lat).toBeCloseTo(40.02, 9);
    expect(unidadesAnimandose()).toBe(0);
    olvidarMarcador(m);
  });

  it("repetir el mismo destino no reinicia la animación", () => {
    const m = marcadorFalso(40, -3);
    moverMarcador(m, [40.01, -3]);
    avanzar(ANIMACION_MS / 2);
    const aMitad = m.getLatLng().lat;
    moverMarcador(m, [40.01, -3]); // p. ej. cambió la ruta pero no la posición
    avanzar(40);
    expect(m.getLatLng().lat).toBeGreaterThan(aMitad); // sigue avanzando, no vuelve atrás
    avanzar(ANIMACION_MS);
    expect(m.getLatLng().lat).toBeCloseTo(40.01, 9);
    olvidarMarcador(m);
  });

  it("con ruta sigue la carretera entre el progreso anterior y el nuevo", () => {
    // Ruta en L: sube 0,01° y luego gira al este 0,01°. Recta entre los puntos
    // del 25 % y del 75 % cortaría por dentro de la esquina.
    const coords: [number, number][] = [
      [40, -3],
      [40.01, -3],
      [40.01, -2.99],
    ];
    const m = marcadorFalso(40.005, -3); // 25 % de la ruta
    moverMarcador(m, [40.005, -3], { coords, progreso: 0.25 }); // mismo sitio: solo registra la ruta
    avanzar(5000);
    moverMarcador(m, [40.01, -2.995], { coords, progreso: 0.75 });
    // A mitad del tramo (progreso 0,5) el tramo norte, más largo en metros, aún no
    // ha terminado: el marcador sigue sobre la vertical (lng = −3) y por encima de
    // donde estaba. La recta entre origen y destino pasaría por lng ≈ −2,9975.
    avanzar(2500);
    const p = m.getLatLng();
    expect(p.lng).toBeCloseTo(-3, 6);
    expect(p.lat).toBeGreaterThan(40.006);
    expect(p.lat).toBeLessThan(40.01);
    avanzar(2500);
    expect(m.getLatLng().lat).toBeCloseTo(40.01, 9);
    expect(m.getLatLng().lng).toBeCloseTo(-2.995, 9);
    olvidarMarcador(m);
  });

  it("un salto enorme coloca el marcador de golpe", () => {
    const m = marcadorFalso(40, -3);
    moverMarcador(m, [41, -3]); // ≈ 110 km: reencuadre, no un avance
    expect(m.getLatLng().lat).toBe(41);
    expect(unidadesAnimandose()).toBe(0);
    olvidarMarcador(m);
  });
});
