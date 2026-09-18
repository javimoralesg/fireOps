"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

// Tooltip accesible y reutilizable (docs/identidad.md · "todo lo interactivo
// es informativo"). Se pinta por portal con posición fija para que ningún
// overflow-hidden de los paneles lo recorte; se abre con ratón (con retardo)
// y con foco de teclado (al instante); se cierra con Escape, scroll o blur.

type Lado = "arriba" | "abajo" | "izquierda" | "derecha";

interface Props {
  /** Cuerpo del globo: qué significa el dato y de dónde sale. */
  contenido: ReactNode;
  /** Línea en negrita encima del contenido. */
  titulo?: string;
  lado?: Lado;
  /** Clase del envoltorio del disparador (por defecto inline-flex). */
  className?: string;
  /** Ancho máximo del globo en px. */
  ancho?: number;
  /** Retardo de apertura con ratón, en ms. */
  retardo?: number;
  /** Desactiva el tooltip sin desmontar el hijo. */
  desactivado?: boolean;
  children: ReactNode;
}

const SEPARACION = 8;
const MARGEN = 6;

const suscribirNada = () => () => {};

export function Tooltip({
  contenido,
  titulo,
  lado = "arriba",
  className = "",
  ancho = 280,
  retardo = 160,
  desactivado = false,
  children,
}: Props) {
  const id = useId();
  const enCliente = useSyncExternalStore(suscribirNada, () => true, () => false);
  const disparador = useRef<HTMLSpanElement>(null);
  const globo = useRef<HTMLDivElement>(null);
  const temporizador = useRef<number | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; lado: Lado } | null>(null);

  const cancelar = () => {
    if (temporizador.current !== null) {
      window.clearTimeout(temporizador.current);
      temporizador.current = null;
    }
  };

  const abrir = (inmediato: boolean) => {
    if (desactivado) return;
    cancelar();
    if (inmediato) setAbierto(true);
    else temporizador.current = window.setTimeout(() => setAbierto(true), retardo);
  };

  const cerrar = () => {
    cancelar();
    setAbierto(false);
    setPos(null);
  };

  const colocar = useCallback(() => {
    const t = disparador.current?.getBoundingClientRect();
    const g = globo.current?.getBoundingClientRect();
    if (!t || !g) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let l = lado;
    if (l === "arriba" && t.top - g.height - SEPARACION < MARGEN) l = "abajo";
    else if (l === "abajo" && t.bottom + g.height + SEPARACION > vh - MARGEN) l = "arriba";
    else if (l === "izquierda" && t.left - g.width - SEPARACION < MARGEN) l = "derecha";
    else if (l === "derecha" && t.right + g.width + SEPARACION > vw - MARGEN) l = "izquierda";
    let top: number;
    let left: number;
    if (l === "arriba") {
      top = t.top - g.height - SEPARACION;
      left = t.left + t.width / 2 - g.width / 2;
    } else if (l === "abajo") {
      top = t.bottom + SEPARACION;
      left = t.left + t.width / 2 - g.width / 2;
    } else if (l === "izquierda") {
      top = t.top + t.height / 2 - g.height / 2;
      left = t.left - g.width - SEPARACION;
    } else {
      top = t.top + t.height / 2 - g.height / 2;
      left = t.right + SEPARACION;
    }
    left = Math.max(MARGEN, Math.min(vw - g.width - MARGEN, left));
    top = Math.max(MARGEN, Math.min(vh - g.height - MARGEN, top));
    setPos({ top, left, lado: l });
  }, [lado]);

  useLayoutEffect(() => {
    if (abierto) colocar();
  }, [abierto, colocar]);

  useEffect(() => {
    if (!abierto) return;
    const alScroll = () => cerrar();
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
    };
    window.addEventListener("scroll", alScroll, true);
    window.addEventListener("resize", colocar);
    window.addEventListener("keydown", alTeclear);
    return () => {
      window.removeEventListener("scroll", alScroll, true);
      window.removeEventListener("resize", colocar);
      window.removeEventListener("keydown", alTeclear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, colocar]);

  useEffect(() => cancelar, []);

  return (
    <>
      <span
        ref={disparador}
        className={`inline-flex min-w-0 ${className}`}
        onMouseEnter={() => abrir(false)}
        onMouseLeave={cerrar}
        onFocus={() => abrir(true)}
        onBlur={cerrar}
        aria-describedby={abierto ? id : undefined}
      >
        {children}
      </span>
      {abierto &&
        enCliente &&
        createPortal(
          <div
            ref={globo}
            id={id}
            role="tooltip"
            data-lado={pos?.lado ?? lado}
            className="tooltip-globo"
            style={{
              position: "fixed",
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              maxWidth: ancho,
              visibility: pos ? "visible" : "hidden",
            }}
          >
            {titulo && <p className="tooltip-titulo">{titulo}</p>}
            <div className="tooltip-cuerpo">{contenido}</div>
          </div>,
          document.body,
        )}
    </>
  );
}

interface AyudaProps {
  /** Explicación breve: qué significa, cómo se calcula o de dónde sale. */
  texto: ReactNode;
  titulo?: string;
  lado?: Lado;
  className?: string;
}

/** Icono (i) enfocable que abre un tooltip explicativo junto a una etiqueta. */
export function Ayuda({ texto, titulo, lado, className = "" }: AyudaProps) {
  const etiqueta = titulo ?? (typeof texto === "string" ? texto : "Más información");
  return (
    <Tooltip contenido={texto} titulo={titulo} lado={lado}>
      <span tabIndex={0} role="img" aria-label={etiqueta} className={`ayuda ${className}`}>
        <Info className="size-3.5" aria-hidden />
      </span>
    </Tooltip>
  );
}
