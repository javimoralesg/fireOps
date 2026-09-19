// Formateo en español para la sala de mando: fechas relativas, horas de mundo,
// números, direcciones de viento y distancias. DUEÑO: constructor E. Sin dependencias.
//
// Regla: todo lo que ve el usuario pasa por aquí, para que "hace 2 min" y
// "14:32 (×12)" se escriban igual en toda la aplicación.

/** Hora local "14:32" a partir de un ISO. Vacío si la fecha no es válida. */
export function hora(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

/** Hora con segundos "14:32:07". */
export function horaSegundos(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** "19 sept, 14:32". */
export function fechaHora(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Hora de mundo con su factor: "14:32 (×12)". */
export function horaMundo(iso: string | undefined, factor: number): string {
  return `${hora(iso)} (×${factor})`;
}

/**
 * Fecha relativa en español: "ahora", "hace 12 s", "hace 2 min", "hace 3 h",
 * "hace 2 d". Con fechas futuras: "en 5 min".
 */
export function haceCuanto(iso?: string, referencia: number = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const seg = Math.round((referencia - t) / 1000);
  const futuro = seg < 0;
  const s = Math.abs(seg);
  let texto: string;
  if (s < 8) return futuro ? "enseguida" : "ahora";
  if (s < 60) texto = `${s} s`;
  else if (s < 3600) texto = `${Math.floor(s / 60)} min`;
  else if (s < 86400) texto = `${Math.floor(s / 3600)} h`;
  else texto = `${Math.floor(s / 86400)} d`;
  return futuro ? `en ${texto}` : `hace ${texto}`;
}

/** Duración en milisegundos legible: "820 ms", "3,4 s", "1 min 12 s". */
export function duracion(ms?: number): string {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${numero(ms / 1000, 1)} s`;
  const min = Math.floor(ms / 60_000);
  const seg = Math.round((ms % 60_000) / 1000);
  return `${min} min ${seg} s`;
}

/** Minutos de mundo legibles: "18 min", "1 h 20 min". */
export function minutos(min?: number): string {
  if (min === undefined || min === null || Number.isNaN(min)) return "—";
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

/**
 * Formateadores de `Intl` reutilizados. Construir uno cuesta bastante más que
 * formatear, y `toLocaleString` lo construye cada vez: con ~1.000 unidades en el
 * mapa eso eran cientos de milisegundos por snapshot (medido con el perfilador).
 */
const FORMATEADORES = new Map<number, Intl.NumberFormat>();

function formateador(decimales: number): Intl.NumberFormat {
  const guardado = FORMATEADORES.get(decimales);
  if (guardado) return guardado;
  const nuevo = new Intl.NumberFormat("es-ES", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
  FORMATEADORES.set(decimales, nuevo);
  return nuevo;
}

/** Número con separador español y los decimales pedidos. */
export function numero(n?: number, decimales = 0): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return formateador(decimales).format(n);
}

/** Superficie: "3,4 ha" o "1.240 ha". */
export function hectareas(ha?: number): string {
  if (ha === undefined || ha === null || Number.isNaN(ha)) return "—";
  return `${numero(ha, ha < 10 ? 1 : 0)} ha`;
}

/** Distancia: "820 m", "3,4 km", "24 km". */
export function distancia(km?: number): string {
  if (km === undefined || km === null || Number.isNaN(km)) return "—";
  if (km < 1) return `${numero(km * 1000, 0)} m`;
  return `${numero(km, km < 10 ? 1 : 0)} km`;
}

/** Distancia a partir de metros. */
export function distanciaMetros(m?: number): string {
  return distancia(m === undefined ? undefined : m / 1000);
}

/** Porcentaje 0..1 → "91 %". Si el valor ya viene 0..100, usa `porcentajeDirecto`. */
export function fraccionPorcentaje(f?: number, decimales = 0): string {
  if (f === undefined || f === null || Number.isNaN(f)) return "—";
  return `${numero(f * 100, decimales)} %`;
}

/** Confianza 0..1 con coma decimal, como la muestran los veredictos: "0,91". */
export function confianza(c?: number): string {
  if (c === undefined || c === null || Number.isNaN(c)) return "—";
  return formateador(2).format(c);
}

const ROSA = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];

/** Grados → punto cardinal español ("NNE", "SO"…). */
export function rumboTexto(grados: number): string {
  const g = ((grados % 360) + 360) % 360;
  return ROSA[Math.round(g / 22.5) % 16];
}

/** Viento de la meteo en una frase: "NO 32 km/h (rachas 48)". */
export function viento(direccionGrados?: number, kmh?: number, rachasKmh?: number, direccionTexto?: string): string {
  if (direccionGrados === undefined && kmh === undefined) return "Sin dato de viento";
  const dir = direccionTexto || (direccionGrados !== undefined ? rumboTexto(direccionGrados) : "?");
  const base = `${dir} ${numero(kmh, 0)} km/h`;
  return rachasKmh && rachasKmh > (kmh ?? 0) + 3 ? `${base} (rachas ${numero(rachasKmh, 0)})` : base;
}

/** "hacia el NE (42°)" para el frente del incendio. */
export function rumboFrase(grados?: number, texto?: string): string {
  if (grados === undefined) return "rumbo desconocido";
  return `hacia el ${texto || rumboTexto(grados)} (${Math.round(grados)}°)`;
}

/** Velocidad de avance del frente: "4,2 m/min · 252 m/h". */
export function velocidadFrente(mMin?: number): string {
  if (mMin === undefined || Number.isNaN(mMin)) return "—";
  return `${numero(mMin, 1)} m/min`;
}

/** Convierte "vigia_camaras" → "Vigia camaras" por si falta el nombre bonito. */
export function legible(id: string): string {
  const t = id.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Recorta un texto largo dejando puntos suspensivos. */
export function recortar(texto: string, max = 160): string {
  if (texto.length <= max) return texto;
  return `${texto.slice(0, max - 1).trimEnd()}…`;
}
