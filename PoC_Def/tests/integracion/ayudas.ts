// =====================================================================
// Utilidades para las pruebas de integración contra el servidor VIVO.
// DUEÑO: constructor L.
// No se arranca ningún servidor: se usa el compartido en ATALAYA_URL
// (por defecto http://localhost:3100). Los agentes son reales y la IA
// también, así que todo espera con `esperarHasta` y mide tiempos.
// =====================================================================
import { appendFileSync } from "node:fs";
import type { Snapshot } from "@/lib/dominio/tipos";

export const BASE = process.env.ATALAYA_URL ?? "http://localhost:3100";

/** Errores de compilación en caliente: otros constructores están editando. */
const TRANSITORIO = /Failed to compile|Module not found|ECONNREFUSED|fetch failed|socket hang up|ENOTFOUND|terminated/i;

export interface RespuestaCruda {
  estado: number;
  cabeceras: Headers;
  texto: string;
  json: unknown;
}

/** GET/POST/PUT/DELETE contra la API, con reintentos ante fallos transitorios. */
export async function api(
  ruta: string,
  opciones: { metodo?: string; cuerpo?: unknown; intentos?: number; timeoutMs?: number } = {},
): Promise<RespuestaCruda> {
  const { metodo = "GET", cuerpo, intentos = 3, timeoutMs = 120_000 } = opciones;
  let ultimo: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(`${BASE}${ruta}`, {
        method: metodo,
        headers: cuerpo === undefined ? undefined : { "content-type": "application/json" },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      const texto = await r.text();
      let json: unknown;
      try {
        json = JSON.parse(texto);
      } catch {
        json = undefined;
      }
      // 500 con traza de compilación → el servidor se está recargando.
      if (r.status >= 500 && TRANSITORIO.test(texto) && i < intentos - 1) {
        await dormir(60_000);
        continue;
      }
      return { estado: r.status, cabeceras: r.headers, texto, json };
    } catch (e) {
      ultimo = e;
      const mensaje = e instanceof Error ? e.message : String(e);
      if (!TRANSITORIO.test(mensaje) || i === intentos - 1) throw e;
      await dormir(60_000); // esperar a que termine la recompilación
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error(String(ultimo));
}

/** GET que exige 2xx y devuelve el JSON tipado. */
export async function obtener<T>(ruta: string): Promise<T> {
  const r = await api(ruta);
  if (r.estado >= 300) throw new Error(`GET ${ruta} → ${r.estado}: ${r.texto.slice(0, 300)}`);
  return r.json as T;
}

/** POST/PUT/DELETE que exige 2xx y devuelve el JSON tipado. */
export async function enviar<T>(ruta: string, cuerpo?: unknown, metodo = "POST"): Promise<T> {
  const r = await api(ruta, { metodo, cuerpo });
  if (r.estado >= 300) throw new Error(`${metodo} ${ruta} → ${r.estado}: ${r.texto.slice(0, 300)}`);
  return r.json as T;
}

export const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Snapshot completo del mundo. */
export const snapshot = (): Promise<Snapshot> => obtener<Snapshot>("/api/estado");

export interface ResultadoEspera<T> {
  valor: T;
  /** Milisegundos reales que ha costado que se cumpliera la condición. */
  ms: number;
}

/**
 * Espera hasta que `condicion(snapshot)` devuelva algo distinto de
 * undefined/false/null, o hasta agotar `msMaximo`. Devuelve el valor y el
 * tiempo medido, que cada prueba imprime.
 */
export async function esperarHasta<T>(
  descripcion: string,
  condicion: (s: Snapshot) => T | undefined | false | null,
  msMaximo: number,
  cadaMs = 1500,
): Promise<ResultadoEspera<T>> {
  const t0 = Date.now();
  let ultimoError = "";
  while (Date.now() - t0 < msMaximo) {
    try {
      const s = await snapshot();
      const v = condicion(s);
      if (v !== undefined && v !== false && v !== null) return { valor: v as T, ms: Date.now() - t0 };
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : String(e);
    }
    await dormir(cadaMs);
  }
  throw new Error(`Se agotaron ${(msMaximo / 1000).toFixed(0)} s esperando: ${descripcion}${ultimoError ? ` · último error: ${ultimoError}` : ""}`);
}

/** Igual que `esperarHasta` pero sobre una llamada arbitraria (no el snapshot). */
export async function esperarValor<T>(
  descripcion: string,
  sonda: () => Promise<T | undefined | false | null>,
  msMaximo: number,
  cadaMs = 2000,
): Promise<ResultadoEspera<T>> {
  const t0 = Date.now();
  let ultimoError = "";
  while (Date.now() - t0 < msMaximo) {
    try {
      const v = await sonda();
      if (v !== undefined && v !== false && v !== null) return { valor: v as T, ms: Date.now() - t0 };
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : String(e);
    }
    await dormir(cadaMs);
  }
  throw new Error(`Se agotaron ${(msMaximo / 1000).toFixed(0)} s esperando: ${descripcion}${ultimoError ? ` · último error: ${ultimoError}` : ""}`);
}

const medidas: { prueba: string; ms: number; detalle: string }[] = [];

/**
 * Imprime y guarda un tiempo medido (el requisito dice: cada prueba imprime
 * tiempos). Además lo anota en `ATALAYA_MEDIDAS` (una línea por medida) si la
 * variable está puesta: el reporter por defecto de vitest se come la consola de
 * las pruebas que pasan, y las cifras de docs/PRUEBAS.md tienen que ser reales.
 */
export function medir(prueba: string, ms: number, detalle = ""): void {
  medidas.push({ prueba, ms, detalle });
  const linea = `⏱  ${prueba}: ${(ms / 1000).toFixed(1)} s${detalle ? ` · ${detalle}` : ""}`;
  console.log(linea);
  const destino = process.env.ATALAYA_MEDIDAS;
  if (destino) {
    try {
      appendFileSync(destino, `${linea}\n`);
    } catch {
      /* que no se caiga una prueba por no poder escribir el registro */
    }
  }
}

export const tiemposMedidos = () => [...medidas];

/** Crea una ejecución nueva y limpia (sin persistencia): punto de partida de cada suite. */
export async function ejecucionNueva(nombre: string): Promise<{ id: string; ms: number }> {
  const t0 = Date.now();
  const r = await enviar<{ ejecucion: { id: string } }>("/api/ejecucion", { accion: "nueva", nombre });
  // Asegurar que el mundo corre (una suite anterior pudo dejarlo en pausa).
  await enviar("/api/reloj", { pausado: false });
  const ms = Date.now() - t0;
  medir(`ejecución nueva «${nombre}»`, ms, r.ejecucion.id);
  return { id: r.ejecucion.id, ms };
}

/** Declara un foco a mano y devuelve el incendio creado. */
export async function declararFoco(lat: number, lon: number, nombre?: string) {
  const r = await enviar<{ incendio: { id: string; nombre: string } }>("/api/focos", { lat, lon, nombre, quien: "pruebas L" });
  return r.incendio;
}

/**
 * Espera a que el ENTORNO del foco esté cargado antes de exigirle pueblos,
 * unidades o avisos. AÑADIDO por el constructor M (2026-09-19) tras el fallo
 * (f) de la pasada de las 08:02: la prueba leía `s.poblaciones` 16 ms después
 * de que fallara la prueba anterior y, claro, no había ninguna — no porque el
 * sistema estuviera mal, sino porque Overpass todavía no había contestado.
 *
 * `lib/motor/enriquecer.ts` emite dos eventos `incendio_actualizado`:
 *   · `datos.fase = "medios"`   → ya hay unidades (el ataque inicial puede salir).
 *   · `datos.fase = "completo"` → ha terminado todo (pueblos incluidos).
 * Aquí se espera al SEGUNDO. Si el enriquecimiento acabó con fallos, el evento
 * llega igual con `datos.completo = false`: se devuelve y la prueba decide.
 *
 * Presupuesto por defecto 90 s: medido hoy con overpass-api.de caído y
 * maps.mail.ru de espejo, el entorno completo tarda 8-15 s; 90 s cubre además
 * un reintento (el primero es a los 30 s).
 */
export async function esperarEntornoCargado(
  incendioId: string,
  msMaximo = 90_000,
): Promise<{ pueblos: number; unidades: number; completo: boolean; fallos: string[]; ms: number }> {
  // Se lee de /api/eventos (histórico filtrado por foco, hasta 2.000) y NO del
  // snapshot: el snapshot solo lleva los 200 últimos eventos y en una tanda
  // larga el de carga del entorno ya se ha ido.
  const { valor, ms } = await esperarValor(
    `entorno del foco ${incendioId} cargado (evento incendio_actualizado fase=completo)`,
    async () => {
      const r = await obtener<{ eventos: { tipo: string; datos?: Record<string, unknown> }[] }>(
        `/api/eventos?incendioId=${encodeURIComponent(incendioId)}&limite=500`,
      );
      const ev = r.eventos.filter((e) => e.tipo === "incendio_actualizado" && (e.datos as { fase?: string } | undefined)?.fase === "completo").slice(-1)[0];
      if (!ev) return undefined;
      const d = (ev.datos ?? {}) as { pueblos?: number; unidades?: number; completo?: boolean; fallos?: string[] };
      return { pueblos: d.pueblos ?? 0, unidades: d.unidades ?? 0, completo: d.completo !== false, fallos: d.fallos ?? [] };
    },
    msMaximo,
    1000,
  );
  medir(
    "entorno cargado",
    ms,
    `${valor.pueblos} pueblo(s), ${valor.unidades} unidad(es)${valor.completo ? "" : ` · FALLOS: ${valor.fallos.join(" · ")}`}`,
  );
  return { ...valor, ms };
}

/** Distancia en km entre dos puntos (copia local para no arrastrar el alias en las aserciones). */
export function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371.0088;
  const r = (g: number) => (g * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
