// Ayudas de teclado compartidas por la sala y el mapa. DUEÑO: constructor N.
// Sin dependencias externas.

/** true si el foco del teclado está dentro de un campo de texto o un diálogo modal. */
export function escribiendo(): boolean {
  if (typeof document === "undefined") return false;
  const a = document.activeElement as HTMLElement | null;
  if (!a) return false;
  const etiqueta = a.tagName.toLowerCase();
  return etiqueta === "input" || etiqueta === "textarea" || etiqueta === "select" || a.isContentEditable;
}

/** true si la pulsación lleva modificadores (no es un atajo de una sola tecla). */
export function conModificadores(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey || e.altKey;
}
