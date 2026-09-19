"use client";
// Avisos efímeros (toasts) + proveedor y hook `useToast`. DUEÑO: constructor E.
// Se anuncian en una región aria-live para que un lector de pantalla los lea.
//
// Uso:  const toast = useToast();  toast.exito("Foco declarado");
//       toast.error("No se pudo aprobar", detalle);

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

export type TipoToast = "exito" | "error" | "aviso" | "info";

export interface Toast {
  id: string;
  tipo: TipoToast;
  titulo: string;
  detalle?: string;
}

interface ApiToast {
  mostrar: (t: Omit<Toast, "id">, ms?: number) => void;
  exito: (titulo: string, detalle?: string) => void;
  error: (titulo: string, detalle?: string) => void;
  aviso: (titulo: string, detalle?: string) => void;
  info: (titulo: string, detalle?: string) => void;
}

const Contexto = createContext<ApiToast | null>(null);

const ICONOS: Record<TipoToast, ReactNode> = {
  exito: <CheckCircle2 className="size-4 text-success" aria-hidden />,
  error: <XCircle className="size-4 text-danger" aria-hidden />,
  aviso: <AlertTriangle className="size-4 text-warning" aria-hidden />,
  info: <Info className="size-4 text-info" aria-hidden />,
};

const ETIQUETA: Record<TipoToast, string> = { exito: "Hecho", error: "Error", aviso: "Aviso", info: "Información" };

const BORDES: Record<TipoToast, string> = {
  exito: "border-l-success",
  error: "border-l-danger",
  aviso: "border-l-warning",
  info: "border-l-info",
};

export function ProveedorToast({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([]);
  const contador = useRef(0);

  const cerrar = useCallback((id: string) => setLista((l) => l.filter((t) => t.id !== id)), []);

  const mostrar = useCallback(
    (t: Omit<Toast, "id">, ms = 6000) => {
      contador.current += 1;
      const id = `toast-${contador.current}`;
      setLista((l) => [...l.slice(-4), { ...t, id }]);
      if (ms > 0) setTimeout(() => cerrar(id), ms);
    },
    [cerrar],
  );

  const api = useMemo<ApiToast>(
    () => ({
      mostrar,
      exito: (titulo, detalle) => mostrar({ tipo: "exito", titulo, detalle }),
      error: (titulo, detalle) => mostrar({ tipo: "error", titulo, detalle }, 9000),
      aviso: (titulo, detalle) => mostrar({ tipo: "aviso", titulo, detalle }, 8000),
      info: (titulo, detalle) => mostrar({ tipo: "info", titulo, detalle }),
    }),
    [mostrar],
  );

  return (
    <Contexto.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-[2000] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[24rem]"
      >
        {lista.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border border-panel-border border-l-4 bg-panel p-3 shadow-[var(--sombra-flotante)] ${BORDES[t.tipo]}`}
          >
            <span className="mt-0.5 shrink-0">{ICONOS[t.tipo]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug text-foreground">
                <span className="solo-lectores">{ETIQUETA[t.tipo]}: </span>
                {t.titulo}
              </p>
              {t.detalle ? <p className="mt-0.5 text-xs leading-snug text-muted">{t.detalle}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => cerrar(t.id)}
              aria-label="Cerrar aviso"
              className="-m-1 shrink-0 rounded-lg p-1 text-muted hover:bg-panel-2 hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </Contexto.Provider>
  );
}

/** Devuelve la API de avisos. Fuera del proveedor no rompe: escribe en consola. */
export function useToast(): ApiToast {
  const ctx = useContext(Contexto);
  return (
    ctx ?? {
      mostrar: (t) => console.warn("[toast sin proveedor]", t.titulo),
      exito: (t) => console.warn("[toast sin proveedor]", t),
      error: (t) => console.warn("[toast sin proveedor]", t),
      aviso: (t) => console.warn("[toast sin proveedor]", t),
      info: (t) => console.warn("[toast sin proveedor]", t),
    }
  );
}
