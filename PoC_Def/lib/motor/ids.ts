// Identificadores cortos, legibles y ordenables en el tiempo: "<prefijo>-<base36 tiempo>-<aleatorio>".

export function nuevoId(prefijo: string): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 7);
  return `${prefijo}-${t}-${r}`;
}
