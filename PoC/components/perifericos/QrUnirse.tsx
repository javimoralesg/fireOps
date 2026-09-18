"use client";

// "Conecta tu móvil": el QR que el jurado escanea para abrir /periferico.
// El QR se genera con un servicio público (api.qrserver.com) para no añadir
// dependencias; si no carga, la URL en texto sigue siendo copiable y válida.

import { useEffect, useState } from "react";
import { Check, Copy, QrCode } from "lucide-react";
import { Ayuda } from "@/components/ui/Tooltip";
import { Aviso, EstadoRecurso, Panel } from "./ui-sala";

export interface QrUnirseProps {
  /** URL pública de /periferico (la del túnel si está arrancado). */
  urlUnion: string;
  /** false: la URL no es https y el navegador del móvil bloqueará cámara y GPS. */
  urlSegura: boolean;
  /** "tunel" | "lan" | "local" | "env": de dónde salió la URL. */
  origenUrl?: string;
  cargando?: boolean;
  ausente?: boolean;
  error?: string | null;
  className?: string;
}

const TAMANO = 220;

const qrDe = (url: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${TAMANO}x${TAMANO}&margin=0&data=${encodeURIComponent(url)}`;

export function QrUnirse({ urlUnion, urlSegura, origenUrl, cargando = false, ausente = false, error = null, className = "" }: QrUnirseProps) {
  const [copiado, setCopiado] = useState(false);
  // URL cuyo QR no se pudo cargar: al cambiar la URL se reintenta solo, sin efecto de reinicio.
  const [urlSinQr, setUrlSinQr] = useState<string | null>(null);
  const qrRoto = urlSinQr === urlUnion;

  useEffect(() => {
    if (!copiado) return;
    const id = setTimeout(() => setCopiado(false), 1800);
    return () => clearTimeout(id);
  }, [copiado]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(urlUnion);
      setCopiado(true);
    } catch {
      /* sin permiso de portapapeles: la URL sigue seleccionable a mano */
    }
  };

  return (
    <Panel
      titulo="Conecta tu móvil"
      icono={QrCode}
      className={className}
      cuerpoClassName="p-3"
      extra={
        <Ayuda
          titulo="Cómo se une un periférico"
          texto="Escanea el QR con la cámara del móvil: se abre /periferico, eliges rol (ciudadano, cámara fija, efectivo o PMA) y desde ese momento sus fotos, voz y posición entran en Atalaya."
        />
      }
    >
      {!urlUnion ? (
        <EstadoRecurso
          cargando={cargando}
          ausente={ausente}
          error={error}
          que="la URL de emparejamiento"
          endpoint="GET /api/perifericos"
        />
      ) : (
        <div className="flex flex-col items-center gap-3">
          {qrRoto ? (
            <div className="flex size-[220px] items-center justify-center rounded-lg border border-dashed border-panel-border bg-panel-2 px-4 text-center text-[11px] text-subtle">
              No se pudo generar el QR (sin salida a internet). Escribe la URL de abajo en el móvil.
            </div>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element -- QR remoto de tamaño fijo, no conviene optimizar */
            <img
              src={qrDe(urlUnion)}
              width={TAMANO}
              height={TAMANO}
              alt={`Código QR para abrir ${urlUnion} en el móvil`}
              className="rounded-lg border border-panel-border bg-white p-2"
              onError={() => setUrlSinQr(urlUnion)}
            />
          )}

          <div className="flex w-full items-center gap-1.5">
            <code className="min-w-0 flex-1 select-all truncate rounded-lg border border-panel-border bg-panel-2 px-2 py-1.5 font-mono text-[11px] text-foreground">
              {urlUnion}
            </code>
            <button type="button" onClick={copiar} className="boton boton-secundario boton-sm shrink-0" aria-label="Copiar la URL de emparejamiento">
              {copiado ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
              {copiado ? "Copiada" : "Copiar"}
            </button>
          </div>

          {!urlSegura && (
            <Aviso>
              Sin HTTPS el móvil no dará cámara ni GPS: arranca <code className="font-mono">scripts/tunel.sh</code> y vuelve a
              mostrar el QR.
            </Aviso>
          )}
          {origenUrl === "lan" && (
            <Aviso tono="neutro">
              Esta dirección es de la red local: solo funciona si el móvil está en la misma Wi-Fi que el portátil.
            </Aviso>
          )}
          {origenUrl === "local" && (
            <Aviso tono="neutro">
              Es una dirección de <code className="font-mono">localhost</code>: solo vale en este mismo equipo.
            </Aviso>
          )}
        </div>
      )}
    </Panel>
  );
}
