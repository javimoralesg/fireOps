// =====================================================================
// Móvil como cámara. DUEÑO: constructor B.
// ---------------------------------------------------------------------
// La página /movil (Safari/Chrome en el teléfono) pide ubicación y cámara
// trasera y envía un fotograma JPEG cada 15 s a POST /api/camaras/movil.
// Aquí se guarda el ÚLTIMO fotograma por dispositivo en memoria (no se
// escribe a disco) y se registra/actualiza la Camara correspondiente en el
// estado, con id `movil:<dispositivoId>` y fuente "Movil".
// El Vigía las prioriza: analiza cada fotograma nuevo UNA sola vez.
// =====================================================================
import type { Camara, Punto } from "../dominio/tipos";
import type { Estado } from "../motor/estado";

export const INTERVALO_MOVIL_SEG = 15;
const MAX_BYTES = 4 * 1024 * 1024;

export interface FotogramaMovil {
  dispositivoId: string;
  nombre: string;
  punto: Punto;
  precisionM?: number;
  bytes: Uint8Array;
  mime: string;
  recibidoEn: string;
  /** Marca monótona del fotograma: el Vigía la usa para no repetir análisis. */
  secuencia: number;
}

type Global = typeof globalThis & { __atalayaCamarasMovil?: { fotogramas: Map<string, FotogramaMovil>; contador: number } };
const g = globalThis as Global;
const est = () => (g.__atalayaCamarasMovil ??= { fotogramas: new Map(), contador: 0 });

export const idCamaraMovil = (dispositivoId: string): string => `movil:${dispositivoId}`;

/** Decodifica un data URL o base64 pelado a bytes. Lanza si no es una imagen válida. */
export function decodificarImagenBase64(imagenBase64: string, mimeDeclarado?: string): { bytes: Uint8Array; mime: string } {
  const coincidencia = /^data:(image\/[a-z+]+);base64,([\s\S]*)$/i.exec(imagenBase64.trim());
  const mime = (coincidencia?.[1] ?? mimeDeclarado ?? "image/jpeg").toLowerCase();
  const b64 = coincidencia?.[2] ?? imagenBase64.trim();
  const buffer = Buffer.from(b64, "base64");
  if (buffer.byteLength < 500) throw new Error(`Fotograma demasiado pequeño (${buffer.byteLength} bytes): no parece una imagen`);
  if (buffer.byteLength > MAX_BYTES) throw new Error(`Fotograma demasiado grande (${Math.round(buffer.byteLength / 1024)} KB, máximo 4 MB)`);
  return { bytes: new Uint8Array(buffer), mime };
}

export interface EntradaFotograma {
  dispositivoId: string;
  nombre?: string;
  lat: number;
  lon: number;
  precisionM?: number;
  imagenBase64: string;
  mime?: string;
}

/**
 * Guarda el fotograma y registra/actualiza la cámara en el estado.
 * Devuelve la cámara resultante (vigilada, intervalo 15 s).
 */
export function registrarFotograma(estado: Estado, entrada: EntradaFotograma): Camara {
  const dispositivoId = entrada.dispositivoId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
  if (!dispositivoId) throw new Error("dispositivoId vacío o no válido");
  if (!Number.isFinite(entrada.lat) || !Number.isFinite(entrada.lon)) throw new Error("Coordenadas del móvil no válidas");

  const { bytes, mime } = decodificarImagenBase64(entrada.imagenBase64, entrada.mime);
  const e = est();
  e.contador += 1;
  const punto: Punto = { lat: +Number(entrada.lat).toFixed(6), lon: +Number(entrada.lon).toFixed(6) };
  const nombre = (entrada.nombre ?? "").trim().slice(0, 60) || `Móvil ${dispositivoId.slice(0, 6)}`;

  e.fotogramas.set(dispositivoId, {
    dispositivoId,
    nombre,
    punto,
    precisionM: Number.isFinite(entrada.precisionM) ? Number(entrada.precisionM) : undefined,
    bytes,
    mime,
    recibidoEn: new Date().toISOString(),
    secuencia: e.contador,
  });

  const id = idCamaraMovil(dispositivoId);
  const existente = estado.camaras.get(id);
  const camara: Camara = {
    id,
    nombre,
    punto,
    fuente: "Movil",
    urlImagen: `/api/camaras/${encodeURIComponent(id)}/imagen`,
    carretera: entrada.precisionM ? `GPS ±${Math.round(entrada.precisionM)} m` : "Móvil en campo",
    intervaloSeg: INTERVALO_MOVIL_SEG,
    vigilada: true,
    historial: existente?.historial ?? [],
    ultimoAnalisis: existente?.ultimoAnalisis,
    incendioId: existente?.incendioId,
  };
  estado.guardar(estado.camaras, camara);
  return camara;
}

/** Último fotograma de un dispositivo (id con o sin prefijo "movil:"). */
export function fotogramaDe(id: string): FotogramaMovil | undefined {
  return est().fotogramas.get(id.startsWith("movil:") ? id.slice(6) : id);
}

/** Imagen del móvil con el mismo contrato que `imagenCamara`. */
export function imagenCamaraMovil(id: string): { bytes: Uint8Array; mime: string; url: string } {
  const f = fotogramaDe(id);
  if (!f) throw new Error(`No hay ningún fotograma recibido de ${id}. ¿Está la página /movil abierta y enviando?`);
  return { bytes: f.bytes, mime: f.mime, url: `/api/camaras/${encodeURIComponent(idCamaraMovil(f.dispositivoId))}/imagen?t=${Date.parse(f.recibidoEn)}` };
}

/** Todas las cámaras móviles activas (con fotograma en los últimos minutos). */
export function camarasMovilActivas(minutos = 10): FotogramaMovil[] {
  const limite = Date.now() - minutos * 60_000;
  return [...est().fotogramas.values()].filter((f) => Date.parse(f.recibidoEn) >= limite);
}
