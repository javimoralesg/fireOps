// =====================================================================
// ATALAYA INCENDIOS · Registro de llamadas al 112 ya atendidas (por run)
// ---------------------------------------------------------------------
// Propósito: que la recuperación de llamadas (lib/happyrobot/recuperar-llamadas.ts)
// sepa qué llamadas ya llegaron a Atalaya AUNQUE el proceso se reinicie y la
// ejecución viva solo en memoria (lo habitual en local: SUPABASE_PERSISTIR sin
// activar). Antes la pasada se recortaba por el inicio de la ejecución, así que
// una llamada recibida con el servidor parado quedaba antes de ese inicio y no
// se recuperaba nunca: justo el caso que la recuperación debe cubrir (revisión
// del PR, 19-09). Ahora el corte lo pone este registro: un JSON pequeño en
// data/ con { runId: ISO } de las llamadas atendidas en las últimas horas.
//   · Lo escribe la pasada de recuperación (llamadas ya registradas, recuperadas
//     o mudas) y el webhook de colgar cuando la llamada llegó en directo.
//   · Una llamada que NO está aquí y terminó dentro de la ventana se recupera,
//     empezara antes o después de la ejecución actual.
//   · Un cursor por tiempo no vale: con llamadas en curso saltaría alguna.
// Independiente de Supabase y de la ejecución. Tolerante: si data/ no se puede
// escribir, funciona en memoria y lo avisa una vez. La ruta se puede cambiar con
// HAPPYROBOT_LLAMADAS_ATENDIDAS_PATH (lo usan las pruebas).
// DUEÑO: sesión fireops-f4 (2026-09-19). Dependencias: solo node:fs.
// =====================================================================
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const VARIABLE_RUTA_ATENDIDAS = "HAPPYROBOT_LLAMADAS_ATENDIDAS_PATH";
/** Cuánto se conserva cada marca: más que la ventana de recuperación (6 h), para que ninguna llamada de la ventana se quede sin marca. */
export const RETENCION_MS = 24 * 3_600_000;

interface Registro {
  llamadas: Record<string, string>;
}
interface Cache {
  ruta: string;
  datos: Registro;
  /** ¿Existía el archivo cuando este proceso lo cargó? (false = primer arranque con esta versión o data/ vacío). */
  existiaAlCargar: boolean;
  avisado: boolean;
}
type Global = typeof globalThis & { __atalayaLlamadasAtendidas?: Cache };

const rutaArchivo = (): string => process.env[VARIABLE_RUTA_ATENDIDAS]?.trim() || join(process.cwd(), "data", "happyrobot-llamadas-atendidas.json");
const mensajeDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function cargar(): Cache {
  const g = globalThis as Global;
  const ruta = rutaArchivo();
  if (g.__atalayaLlamadasAtendidas?.ruta === ruta) return g.__atalayaLlamadasAtendidas;
  let datos: Registro = { llamadas: {} };
  const existiaAlCargar = existsSync(ruta);
  if (existiaAlCargar) {
    try {
      const leido = JSON.parse(readFileSync(ruta, "utf8")) as Partial<Registro> | null;
      if (leido && typeof leido === "object" && leido.llamadas && typeof leido.llamadas === "object") {
        datos = { llamadas: Object.fromEntries(Object.entries(leido.llamadas).filter(([, v]) => typeof v === "string")) };
      }
    } catch (e) {
      console.warn(`[112 entrante] ${ruta} ilegible, el registro de llamadas atendidas empieza de cero: ${mensajeDe(e)}`);
    }
  }
  g.__atalayaLlamadasAtendidas = { ruta, datos, existiaAlCargar, avisado: false };
  return g.__atalayaLlamadasAtendidas;
}

function guardar(c: Cache): void {
  try {
    mkdirSync(dirname(c.ruta), { recursive: true });
    const temporal = `${c.ruta}.tmp`;
    writeFileSync(temporal, JSON.stringify(c.datos, null, 2));
    renameSync(temporal, c.ruta);
  } catch (e) {
    if (!c.avisado) {
      c.avisado = true;
      console.warn(`[112 entrante] no se puede escribir ${c.ruta} (el registro de llamadas atendidas vive solo en memoria): ${mensajeDe(e)}`);
    }
  }
}

function podar(c: Cache, ahoraMs: number): void {
  for (const [id, iso] of Object.entries(c.datos.llamadas)) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t) || ahoraMs - t > RETENCION_MS) delete c.datos.llamadas[id];
  }
}

/** true si ya había registro en disco cuando arrancó este proceso (false: primer arranque, o data/ vacío). */
export function hayRegistroDeLlamadas(): boolean {
  return cargar().existiaAlCargar;
}

/** ¿Esta llamada ya llegó a Atalaya (en directo o recuperada), en esta ejecución o en una anterior? */
export function llamadaAtendida(runId: string): boolean {
  return Object.prototype.hasOwnProperty.call(cargar().datos.llamadas, runId);
}

/**
 * Marca llamadas como atendidas y lo escribe en disco (una sola escritura). Con la lista
 * vacía y sin archivo, crea el archivo: así queda constancia de que el registro ya existe.
 */
export function marcarLlamadasAtendidas(runIds: string[], en: Date = new Date()): void {
  const c = cargar();
  const nuevas = runIds.filter((id) => id && !llamadaAtendida(id));
  if (!nuevas.length && existsSync(c.ruta)) return;
  for (const id of nuevas) c.datos.llamadas[id] = en.toISOString();
  podar(c, en.getTime());
  guardar(c);
}

/** Una sola llamada (webhook de colgar, cuando la llamada llegó entera en directo). */
export function marcarLlamadaAtendida(runId: string, en?: Date): void {
  marcarLlamadasAtendidas([runId], en);
}

/** Solo pruebas: olvida la caché en memoria (el archivo manda en la siguiente lectura). */
export function reiniciarRegistroDeLlamadas(): void {
  delete (globalThis as Global).__atalayaLlamadasAtendidas;
}
