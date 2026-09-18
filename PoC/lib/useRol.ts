"use client";

import { useCallback, useSyncExternalStore } from "react";
import { normalizarRol, ROLES, type DefinicionRol, type RolId } from "./roles";

// Rol activo de la demo (sin autenticación real): localStorage + cookie, para que
// también lo lean los route handlers. En producción vendría de Cl@ve / certificado.

const CLAVE = "atalaya.rol";
const COOKIE = "atalaya_rol";
const EVENTO = "atalaya:rol";

function leer(): RolId | null {
  try {
    const v = localStorage.getItem(CLAVE);
    return v ? normalizarRol(v) : null;
  } catch {
    return null;
  }
}

function suscribir(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENTO, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENTO, cb);
  };
}

/** Lee el rol activo sin hook (p. ej. para cabeceras en api-cliente). */
export function rolActual(): RolId {
  if (typeof window === "undefined") return "director_plan";
  return leer() ?? "director_plan";
}

export function guardarRol(rol: RolId) {
  try {
    localStorage.setItem(CLAVE, rol);
  } catch {
    /* modo privado: seguimos con la cookie */
  }
  document.cookie = `${COOKIE}=${rol}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
  window.dispatchEvent(new Event(EVENTO));
}

export function useRol(): {
  rol: RolId;
  definicion: DefinicionRol;
  /** false hasta que el usuario ha elegido perfil alguna vez */
  elegido: boolean;
  setRol: (rol: RolId) => void;
} {
  const guardado = useSyncExternalStore(suscribir, leer, () => null);
  const rol = guardado ?? "director_plan";
  const setRol = useCallback((r: RolId) => guardarRol(r), []);
  return { rol, definicion: ROLES[rol], elegido: guardado !== null, setRol };
}
