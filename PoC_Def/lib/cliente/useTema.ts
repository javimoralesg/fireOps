"use client";
// Tema claro/oscuro: preferencia del sistema por defecto, conmutable a mano y
// persistida en localStorage (con try/catch: en incógnito puede lanzar).
// DUEÑO: constructor E.

import { useCallback, useEffect, useState } from "react";

export type Tema = "sistema" | "claro" | "oscuro";
const CLAVE = "atalaya:tema";

function leerGuardado(): Tema {
  try {
    const v = localStorage.getItem(CLAVE);
    if (v === "claro" || v === "oscuro" || v === "sistema") return v;
  } catch {
    /* almacenamiento bloqueado: se usa la preferencia del sistema */
  }
  return "sistema";
}

function aplicar(tema: Tema) {
  const raiz = document.documentElement;
  if (tema === "claro") raiz.setAttribute("data-theme", "light");
  else if (tema === "oscuro") raiz.setAttribute("data-theme", "dark");
  else raiz.removeAttribute("data-theme");
}

export function useTema() {
  // En el servidor no hay localStorage: se empieza en "sistema" y se corrige al montar
  // (el <script> del layout ya ha puesto el atributo, así que no hay fogonazo).
  const [tema, setTemaEstado] = useState<Tema>("sistema");
  const [oscuro, setOscuro] = useState(false);

  const recalcularOscuro = useCallback((t: Tema) => {
    if (t === "oscuro") return setOscuro(true);
    if (t === "claro") return setOscuro(false);
    setOscuro(window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  }, []);

  useEffect(() => {
    const guardado = leerGuardado();
    // Sincronización con un sistema externo (localStorage + matchMedia) que solo
    // existe en el navegador: NO se puede leer en el render sin romper la
    // hidratación, porque el servidor siempre pinta "sistema".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTemaEstado(guardado);
    aplicar(guardado);
    recalcularOscuro(guardado);
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const alCambiar = () => recalcularOscuro(leerGuardado());
    mq?.addEventListener?.("change", alCambiar);
    return () => mq?.removeEventListener?.("change", alCambiar);
  }, [recalcularOscuro]);

  const cambiarTema = useCallback(
    (t: Tema) => {
      setTemaEstado(t);
      aplicar(t);
      recalcularOscuro(t);
      try {
        localStorage.setItem(CLAVE, t);
      } catch {
        /* no se puede guardar: el cambio vale para esta sesión */
      }
    },
    [recalcularOscuro],
  );

  return { tema, oscuro, cambiarTema };
}
