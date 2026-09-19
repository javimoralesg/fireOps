"use client";
// Contenido del popup de una cámara: imagen que se refresca sola, último
// veredicto del Vigía y botón de vigilancia. DUEÑO: constructor E.

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { Camara } from "@/lib/dominio/tipos";
import { urlImagenCamara } from "@/lib/cliente/api";
import { confianza, haceCuanto } from "@/lib/cliente/formato";
import { urlOsmPunto, urlSegura } from "@/lib/cliente/enlaces";
import { EnlaceExterno } from "@/components/ui/Enlace";
import { Boton } from "@/components/ui/Boton";

export function PopupCamara({ camara, onVigilar }: { camara: Camara; onVigilar: (id: string, vigilar: boolean) => Promise<void> | void }) {
  const [sello, setSello] = useState(() => Date.now());
  const [fallo, setFallo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const intervaloMs = Math.max(5, camara.intervaloSeg || 20) * 1000;

  useEffect(() => {
    const id = setInterval(() => {
      setFallo(false);
      setSello(Date.now());
    }, intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);

  const a = camara.ultimoAnalisis;
  const veredicto = a ? (a.fuego ? "Fuego visible" : a.humo ? "Humo visible" : "Sin humo") : "Sin analizar todavía";
  const colorVeredicto = a?.fuego ? "text-danger" : a?.humo ? "text-warning" : "text-success";

  return (
    <div className="w-[16rem] max-w-full">
      <p className="text-[13px] font-semibold leading-tight text-foreground">{camara.nombre}</p>
      <p className="mt-0.5 text-[11px] text-muted">
        {camara.fuente === "Movil" ? "Móvil en directo" : `Cámara ${camara.fuente}`}
        {camara.carretera ? ` · ${camara.carretera}` : ""} · cada {camara.intervaloSeg || 20} s
      </p>
      {/* Enlaces a la fuente real: la imagen original del organismo y el punto
          exacto en el mapa. Si la cámara no trae URL, no se pinta nada. */}
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[11px]">
        <EnlaceExterno href={urlSegura(camara.urlImagen)} className="text-[11px]" siNoHayUrl="nada" titulo="Abrir la imagen original de la cámara">
          Imagen original
        </EnlaceExterno>
        <EnlaceExterno href={urlOsmPunto(camara.punto.lat, camara.punto.lon, 16)} className="text-[11px]" siNoHayUrl="nada" titulo="Ver dónde está la cámara">
          Ubicación
        </EnlaceExterno>
      </p>

      <div className="mt-2 aspect-video w-full overflow-hidden rounded-lg border border-panel-border bg-panel-2">
        {fallo ? (
          <p className="flex h-full items-center justify-center px-2 text-center text-[11px] text-muted">
            La imagen no llega ahora mismo. Se reintenta en {camara.intervaloSeg || 20} s.
          </p>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={urlImagenCamara(camara.id, sello)}
            alt={`Imagen en directo de ${camara.nombre}`}
            className="size-full object-cover"
            onError={() => setFallo(true)}
          />
        )}
      </div>

      <p className={`mt-1.5 text-[12px] font-medium ${colorVeredicto}`}>
        {veredicto}
        {a ? <span className="font-normal text-muted"> · {haceCuanto(a.en)} · {confianza(a.confianza)}</span> : null}
      </p>
      {a?.descripcion ? <p className="mt-0.5 text-[11px] leading-snug text-muted">{a.descripcion}</p> : null}

      <Boton
        tamano="sm"
        variante={camara.vigilada ? "secundario" : "primario"}
        cargando={ocupado}
        icono={camara.vigilada ? <EyeOff /> : <Eye />}
        ancho
        className="mt-2"
        onClick={async () => {
          setOcupado(true);
          try {
            await onVigilar(camara.id, !camara.vigilada);
          } finally {
            setOcupado(false);
          }
        }}
      >
        {camara.vigilada ? "Dejar de vigilar" : "Vigilar esta cámara"}
      </Boton>
    </div>
  );
}
