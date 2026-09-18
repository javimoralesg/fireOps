"use client";

// Hook del móvil (poc-07, subagente B): guarda el emparejamiento en localStorage,
// mantiene el latido cada 10 s con la última posición y el rumbo, y envía
// observaciones y publicaciones al pipeline de ingesta (subagente C).
// Todo lo que depende de permisos del navegador (GPS, brújula) degrada sin romper:
// sin HTTPS el texto y las publicaciones siguen funcionando.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  Capacidad,
  ObservacionEntrante,
  Periferico,
  PosicionGeo,
  Publicacion,
  ResultadoIngesta,
  TipoPeriferico,
} from "@/lib/tipos-perifericos";

const CLAVE = "atalaya.periferico";
const LATIDO_MS = 10_000;

/** Mensaje único cuando el pipeline de ingesta todavía no está desplegado. */
export const AVISO_SIN_PIPELINE = "El pipeline de ingesta aún no está disponible";

export interface PerifericoLocal {
  id: string;
  nombre: string;
  tipo: TipoPeriferico;
}

export interface DatosEmparejar {
  nombre: string;
  tipo: TipoPeriferico;
  nodoId?: string;
}

export interface DatosPublicacion {
  autor: string;
  texto: string;
  imagenBase64?: string;
}

export interface RespuestaPublicacion {
  publicacion?: Publicacion;
  resultado?: ResultadoIngesta;
}

export interface UsoPeriferico {
  /** Emparejamiento guardado en este móvil (null mientras no haya ninguno). */
  periferico: PerifericoLocal | null;
  /** Ficha completa que devuelve el último latido: contadores, confianza, modo. */
  detalle: Periferico | null;
  /** false hasta que se ha leído localStorage (evita parpadeos tras hidratar). */
  listo: boolean;
  esSeguro: boolean;
  posicion: PosicionGeo | null;
  rumbo: number | null;
  permisoBrujula: "concedido" | "denegado" | "no_pedido" | "no_aplica";
  ultimoLatido: number | null;
  /** Último latido aceptado por el servidor (lo pinta el punto verde). */
  enLinea: boolean;
  ultimoResultado: ResultadoIngesta | null;
  error: string | null;
  limpiarError: () => void;
  emparejar: (datos: DatosEmparejar) => Promise<PerifericoLocal>;
  desconectar: () => Promise<void>;
  latir: () => Promise<Periferico | null>;
  pedirPermisoBrujula: () => Promise<boolean>;
  configurarVigilancia: (modo: Periferico["modo"], intervaloVigilanciaSeg: number) => void;
  enviarObservacion: (obs: Omit<ObservacionEntrante, "perifericoId">) => Promise<ResultadoIngesta>;
  publicar: (datos: DatosPublicacion) => Promise<RespuestaPublicacion>;
  cargarPublicaciones: () => Promise<Publicacion[]>;
}

type NavegadorBateria = Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> };
type OrientacionConPermiso = { requestPermission?: () => Promise<string> };
type EventoOrientacion = DeviceOrientationEvent & { webkitCompassHeading?: number };

/** Nivel de batería 0..1 si el navegador lo expone (Chrome Android). */
export async function leerBateria(): Promise<{ nivel: number; cargando: boolean } | null> {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as NavegadorBateria;
  if (!nav.getBattery) return null;
  try {
    const b = await nav.getBattery();
    return { nivel: b.level, cargando: b.charging };
  } catch {
    return null;
  }
}

function detectarCapacidades(): Capacidad[] {
  if (typeof window === "undefined") return [];
  const caps: Capacidad[] = ["publicar"];
  if (typeof navigator.mediaDevices?.getUserMedia === "function") caps.push("camara", "microfono");
  if ("geolocation" in navigator) caps.push("gps");
  if ("DeviceOrientationEvent" in window) caps.push("brujula");
  if ("DeviceMotionEvent" in window) caps.push("acelerometro");
  return caps;
}

function leerGuardado(): PerifericoLocal | null {
  try {
    const bruto = window.localStorage.getItem(CLAVE);
    if (!bruto) return null;
    const p = JSON.parse(bruto) as Partial<PerifericoLocal>;
    if (typeof p?.id === "string" && typeof p.nombre === "string" && typeof p.tipo === "string") {
      return { id: p.id, nombre: p.nombre, tipo: p.tipo as TipoPeriferico };
    }
  } catch {
    /* localStorage bloqueado o JSON corrupto: se empareja de nuevo */
  }
  return null;
}

function guardar(p: PerifericoLocal | null) {
  try {
    if (p) window.localStorage.setItem(CLAVE, JSON.stringify(p));
    else window.localStorage.removeItem(CLAVE);
  } catch {
    /* modo privado: el emparejamiento solo dura esta sesión */
  }
}

// Almacén externo mínimo (useSyncExternalStore): el emparejamiento vive en
// localStorage, no en el estado de React, así que se lee sin efectos y el
// servidor siempre renderiza "sin emparejar" (el formulario de Conectar).
let cacheEmparejamiento: PerifericoLocal | null | undefined;
const oyentes = new Set<() => void>();

function suscribirEmparejamiento(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

function emparejamientoActual(): PerifericoLocal | null {
  if (cacheEmparejamiento === undefined) cacheEmparejamiento = leerGuardado();
  return cacheEmparejamiento;
}

function emparejamientoServidor(): PerifericoLocal | null {
  return null;
}

function fijarEmparejamiento(p: PerifericoLocal | null) {
  cacheEmparejamiento = p;
  guardar(p);
  for (const oyente of oyentes) oyente();
}

/** Suscripción vacía: para valores que solo existen en el navegador y no cambian. */
function suscribirNada(): () => void {
  return () => {};
}

function leerEsSeguro(): boolean {
  return window.isSecureContext;
}

async function mensajeDeError(r: Response): Promise<string> {
  if (r.status === 404) return AVISO_SIN_PIPELINE;
  try {
    const j = (await r.json()) as { error?: string };
    if (j?.error) return j.error;
  } catch {
    /* respuesta sin JSON (HTML de error) */
  }
  return `El servidor respondió ${r.status}`;
}

async function enviarJson<T>(url: string, cuerpo: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    throw new Error("Sin conexión con el servidor de Atalaya");
  }
  if (!r.ok) throw new Error(await mensajeDeError(r));
  return (await r.json()) as T;
}

export function usePeriferico(): UsoPeriferico {
  const periferico = useSyncExternalStore(suscribirEmparejamiento, emparejamientoActual, emparejamientoServidor);
  const listo = useSyncExternalStore(suscribirNada, () => true, () => false);
  const esSeguro = useSyncExternalStore(suscribirNada, leerEsSeguro, () => true);
  const [detalle, setDetalle] = useState<Periferico | null>(null);
  const [enLinea, setEnLinea] = useState(false);
  const [posicion, setPosicion] = useState<PosicionGeo | null>(null);
  const [rumbo, setRumbo] = useState<number | null>(null);
  const [permisoBrujula, setPermisoBrujula] = useState<UsoPeriferico["permisoBrujula"]>("no_pedido");
  const [ultimoLatido, setUltimoLatido] = useState<number | null>(null);
  const [ultimoResultado, setUltimoResultado] = useState<ResultadoIngesta | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refPosicion = useRef<PosicionGeo | null>(null);
  const refRumbo = useRef<number | null>(null);
  const refVigilancia = useRef<{ modo: Periferico["modo"]; intervaloVigilanciaSeg: number }>({ modo: "manual", intervaloVigilanciaSeg: 15 });

  /** Posición actual con el rumbo de la brújula incorporado. */
  const posicionConRumbo = useCallback((): PosicionGeo | undefined => {
    const p = refPosicion.current;
    if (!p) return undefined;
    return refRumbo.current === null ? p : { ...p, rumboGrados: refRumbo.current };
  }, []);

  const latir = useCallback(async (): Promise<Periferico | null> => {
    const actual = emparejamientoActual();
    if (!actual) return null;
    try {
      const bateria = await leerBateria();
      const p = await enviarJson<Periferico>(`/api/perifericos/${encodeURIComponent(actual.id)}/latido`, {
        posicion: posicionConRumbo(),
        capacidades: detectarCapacidades(),
        modo: refVigilancia.current.modo,
        intervaloVigilanciaSeg: refVigilancia.current.intervaloVigilanciaSeg,
        bateria: bateria?.nivel,
      });
      setDetalle(p);
      setUltimoLatido(Date.now());
      setEnLinea(true);
      return p;
    } catch (err) {
      // Si el servidor ya no conoce este id (reinicio o baja), se limpia el emparejamiento.
      setEnLinea(false);
      if (err instanceof Error && err.message.includes("no encontrado")) {
        fijarEmparejamiento(null);
        setDetalle(null);
      }
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [posicionConRumbo]);

  // 2. GPS de alta precisión mientras haya un periférico emparejado.
  useEffect(() => {
    if (!periferico || typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const p: PosicionGeo = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          precisionM: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : undefined,
          timestamp: new Date(pos.timestamp).toISOString(),
        };
        refPosicion.current = p;
        setPosicion(p);
      },
      (err) => setError(`GPS: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [periferico]);

  // 3. Brújula. En Android y escritorio basta con escuchar; en iOS hace falta
  //    DeviceOrientationEvent.requestPermission() bajo un gesto del usuario.
  useEffect(() => {
    if (!periferico || typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return;
    if (permisoBrujula === "denegado") return;
    const alEscuchar = (e: Event) => {
      const ev = e as EventoOrientacion;
      const grados = typeof ev.webkitCompassHeading === "number" ? ev.webkitCompassHeading : ev.alpha !== null ? (360 - ev.alpha) % 360 : null;
      if (grados === null || !Number.isFinite(grados)) return;
      const redondeado = Math.round(((grados % 360) + 360) % 360);
      refRumbo.current = redondeado;
      setRumbo(redondeado);
    };
    window.addEventListener("deviceorientation", alEscuchar);
    return () => window.removeEventListener("deviceorientation", alEscuchar);
  }, [periferico, permisoBrujula]);

  // 4. Latido cada 10 s.
  useEffect(() => {
    if (!periferico) return;
    void latir();
    const id = window.setInterval(() => void latir(), LATIDO_MS);
    return () => window.clearInterval(id);
  }, [periferico, latir]);

  const pedirPermisoBrujula = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
      setPermisoBrujula("no_aplica");
      return false;
    }
    const constructor = window.DeviceOrientationEvent as unknown as OrientacionConPermiso;
    if (!constructor.requestPermission) {
      setPermisoBrujula("concedido"); // Android: no hace falta permiso explícito
      return true;
    }
    try {
      const estado = await constructor.requestPermission();
      const concedido = estado === "granted";
      setPermisoBrujula(concedido ? "concedido" : "denegado");
      if (!concedido) setError("iOS ha denegado el acceso a la brújula: el cono de rumbo no se dibujará");
      return concedido;
    } catch {
      setPermisoBrujula("denegado");
      setError("No se pudo pedir el permiso de la brújula (hace falta un toque en la pantalla)");
      return false;
    }
  }, []);

  const emparejar = useCallback(async (datos: DatosEmparejar): Promise<PerifericoLocal> => {
    setError(null);
    const p = await enviarJson<Periferico>("/api/perifericos", {
      nombre: datos.nombre,
      tipo: datos.tipo,
      nodoId: datos.nodoId,
      capacidades: detectarCapacidades(),
      posicion: posicionConRumbo(),
    });
    const local: PerifericoLocal = { id: p.id, nombre: p.nombre, tipo: p.tipo };
    refVigilancia.current = { modo: p.modo, intervaloVigilanciaSeg: p.intervaloVigilanciaSeg };
    fijarEmparejamiento(local);
    setDetalle(p);
    setEnLinea(true);
    return local;
  }, [posicionConRumbo]);

  const desconectar = useCallback(async () => {
    const actual = emparejamientoActual();
    fijarEmparejamiento(null);
    setDetalle(null);
    setEnLinea(false);
    setUltimoResultado(null);
    setUltimoLatido(null);
    setError(null);
    if (!actual) return;
    try {
      await fetch(`/api/perifericos/${encodeURIComponent(actual.id)}`, { method: "DELETE", cache: "no-store" });
    } catch {
      /* la baja en el servidor es cortesía: sin latido caerá solo a los 30 s */
    }
  }, []);

  const configurarVigilancia = useCallback((modo: Periferico["modo"], intervaloVigilanciaSeg: number) => {
    refVigilancia.current = { modo, intervaloVigilanciaSeg };
    void latir();
  }, [latir]);

  const enviarObservacion = useCallback(
    async (obs: Omit<ObservacionEntrante, "perifericoId">): Promise<ResultadoIngesta> => {
      const actual = emparejamientoActual();
      if (!actual) throw new Error("Este móvil no está emparejado todavía");
      const cuerpo: ObservacionEntrante = {
        ...obs,
        perifericoId: actual.id,
        timestamp: obs.timestamp ?? new Date().toISOString(),
        posicion: obs.posicion ?? posicionConRumbo(),
      };
      const res = await enviarJson<ResultadoIngesta>("/api/ingesta/observacion", cuerpo);
      setUltimoResultado(res);
      return res;
    },
    [posicionConRumbo],
  );

  const publicar = useCallback(
    async (datos: DatosPublicacion): Promise<RespuestaPublicacion> => {
      const actual = emparejamientoActual();
      const bruto = await enviarJson<RespuestaPublicacion & Partial<Publicacion>>("/api/ingesta/publicacion", {
        perifericoId: actual?.id,
        autor: datos.autor,
        texto: datos.texto,
        imagenBase64: datos.imagenBase64,
        posicion: posicionConRumbo(),
      });
      // El pipeline puede devolver {publicacion, resultado} o la publicación a secas.
      const respuesta: RespuestaPublicacion = bruto.publicacion || bruto.resultado ? { publicacion: bruto.publicacion, resultado: bruto.resultado } : { publicacion: bruto as Publicacion };
      if (respuesta.resultado) setUltimoResultado(respuesta.resultado);
      return respuesta;
    },
    [posicionConRumbo],
  );

  const cargarPublicaciones = useCallback(async (): Promise<Publicacion[]> => {
    let r: Response;
    try {
      r = await fetch("/api/ingesta/publicaciones", { cache: "no-store" });
    } catch {
      throw new Error("Sin conexión con el servidor de Atalaya");
    }
    if (!r.ok) throw new Error(await mensajeDeError(r));
    const datos = (await r.json()) as Publicacion[] | { publicaciones?: Publicacion[] };
    return Array.isArray(datos) ? datos : (datos.publicaciones ?? []);
  }, []);

  const limpiarError = useCallback(() => setError(null), []);

  return {
    periferico,
    detalle,
    listo,
    esSeguro,
    posicion,
    rumbo,
    permisoBrujula,
    ultimoLatido,
    enLinea,
    ultimoResultado,
    error,
    limpiarError,
    emparejar,
    desconectar,
    latir,
    pedirPermisoBrujula,
    configurarVigilancia,
    enviarObservacion,
    publicar,
    cargarPublicaciones,
  };
}
