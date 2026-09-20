"use client";
// Modo desarrollo de la sala: muestra u oculta los controles de ejercicio
// (ejecución y fuentes, PARAR TODO, Declarar foco, Viento global). Es una
// preferencia del NAVEGADOR (como el tema), no estado del mundo: se guarda en
// localStorage con try/catch (en incógnito puede lanzar) y por defecto está
// apagado para que la sala enseñe solo lo operativo. DUEÑO: sesión actual.

import { useCallback, useEffect, useState } from "react";

const CLAVE = "atalaya:desarrollo";

function leerGuardado(): boolean {
  try {
    return localStorage.getItem(CLAVE) === "1";
  } catch {
    return false; // almacenamiento bloqueado: se queda apagado en esta sesión
  }
}

export function useModoDesarrollo() {
  // En el servidor no hay localStorage: se empieza apagado y se corrige al
  // montar. Así el HTML del servidor y el primer render coinciden (sin fallo
  // de hidratación) y quien lo tenía encendido ve aparecer los controles.
  const [desarrollo, setDesarrollo] = useState(false);

  useEffect(() => {
    // Sincronización con un sistema externo (localStorage) que solo existe en el
    // navegador: NO se puede leer en el render sin romper la hidratación.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDesarrollo(leerGuardado());
  }, []);

  const cambiar = useCallback((valor: boolean) => {
    setDesarrollo(valor);
    try {
      localStorage.setItem(CLAVE, valor ? "1" : "0");
    } catch {
      /* no se puede guardar: el cambio vale para esta sesión */
    }
  }, []);

  const alternar = useCallback(() => cambiar(!desarrollo), [cambiar, desarrollo]);

  return { desarrollo, cambiar, alternar };
}
