"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";

// Tema claro (marca) / oscuro (sala a oscuras). Se guarda en localStorage y
// app/layout.tsx lo aplica antes del primer pintado para evitar parpadeos.

const CLAVE = "atalaya.tema";
const EVENTO = "atalaya:tema";
type Tema = "light" | "dark";

function leer(): Tema {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function suscribir(cb: () => void) {
  window.addEventListener(EVENTO, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENTO, cb);
    window.removeEventListener("storage", cb);
  };
}

export function aplicarTema(tema: Tema) {
  if (tema === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  try {
    localStorage.setItem(CLAVE, tema);
  } catch {
    /* modo privado: el tema dura la sesión */
  }
  window.dispatchEvent(new Event(EVENTO));
}

export function useTema(): [Tema, (t: Tema) => void] {
  const tema = useSyncExternalStore(suscribir, leer, () => "light" as Tema);
  const setTema = useCallback((t: Tema) => aplicarTema(t), []);
  return [tema, setTema];
}

/** Botón de icono que alterna el tema. */
export function SelectorTema({ className = "" }: { className?: string }) {
  const [tema, setTema] = useTema();
  const oscuro = tema === "dark";
  const Icono = oscuro ? Sun : Moon;
  const texto = oscuro ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
  return (
    <Tooltip contenido={oscuro ? "Vuelve a la identidad clara de Atalaya." : "Para salas de mando con poca luz."} titulo={texto} lado="abajo">
      <button
        type="button"
        onClick={() => setTema(oscuro ? "light" : "dark")}
        aria-label={texto}
        aria-pressed={oscuro}
        className={`boton boton-fantasma size-8 rounded-full p-0 ${className}`}
      >
        <Icono className="size-4" aria-hidden />
      </button>
    </Tooltip>
  );
}
