// =====================================================================
// ATALAYA INCENDIOS · Duraciones, horas y distancias legibles (módulo ISOMORFO, sin dependencias)
// ---------------------------------------------------------------------
// Para los textos que lee una persona fuera de la sala: SMS a ayuntamientos y unidades, fichas
// que se pasan al modelo. «2972 minutos» no lo entiende nadie; «49 h 32 min» sí (Javi, 19-09).
// DUEÑO: sesión fireops-00 (2026-09-19).
// =====================================================================

/** 45 → "45 min" · 60 → "1 h" · 90 → "1 h 30 min" · 2972 → "49 h 32 min" · <1 → "menos de 1 min". */
export function duracionLegible(minutos: number): string {
  if (!Number.isFinite(minutos) || minutos < 0) return "tiempo desconocido";
  const total = Math.round(minutos);
  if (total < 1) return "menos de 1 min";
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Hora local de España (HH:MM) de una fecha ISO; si no es una fecha, se devuelve tal cual. */
export function horaLegible(iso: string, zona = "Europe/Madrid"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: zona }).format(d);
}

/** 1.23 → "1,2 km" · 12.4 → "12 km" · 0.4 → "400 m". */
export function kmLegible(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "distancia desconocida";
  if (km < 1) return `${Math.round(km * 100) * 10} m`;
  if (km < 10) return `${km.toFixed(1).replace(".", ",")} km`;
  return `${Math.round(km)} km`;
}
