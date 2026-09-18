"use client";

// Cámara del móvil (poc-07, subagente B): vista previa, "Enviar foto" y modo
// vigilancia (un fotograma cada N s). Sin HTTPS o sin permiso, respaldo con
// <input type="file" capture="environment"> para que la demo nunca se caiga.

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CircleAlert, Loader2 } from "lucide-react";
import type { UsoPeriferico } from "@/lib/usePeriferico";
import { Aviso, BotonGrande, CLASE_ENTRADA, ResumenResultado, Tarjeta, archivoABase64, capturarFotograma } from "./ui-movil";

const INTERVALOS = [10, 15, 30];

export function CamaraMovil({ per }: { per: UsoPeriferico }) {
  const refVideo = useRef<HTMLVideoElement | null>(null);
  const refFlujo = useRef<MediaStream | null>(null);
  const refEnviando = useRef(false);
  const [hayCamara, setHayCamara] = useState(false);
  const [falloCamara, setFalloCamara] = useState<string | null>(null);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [miniatura, setMiniatura] = useState<string | null>(null);
  const [vigilancia, setVigilancia] = useState(false);
  const [intervalo, setIntervalo] = useState(15);

  const { enviarObservacion, configurarVigilancia, ultimoResultado, esSeguro } = per;

  // Vista previa: cámara trasera cuando existe.
  useEffect(() => {
    let cancelado = false;
    async function abrir() {
      if (!esSeguro || typeof navigator === "undefined" || typeof navigator.mediaDevices?.getUserMedia !== "function") {
        setFalloCamara("Este navegador no da acceso a la cámara sin HTTPS");
        return;
      }
      try {
        const flujo = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
          audio: false,
        });
        if (cancelado) {
          flujo.getTracks().forEach((t) => t.stop());
          return;
        }
        refFlujo.current = flujo;
        if (refVideo.current) refVideo.current.srcObject = flujo;
        setHayCamara(true);
        setFalloCamara(null);
      } catch (err) {
        setFalloCamara(err instanceof Error ? err.message : "No se pudo abrir la cámara");
      }
    }
    void abrir();
    return () => {
      cancelado = true;
      refFlujo.current?.getTracks().forEach((t) => t.stop());
      refFlujo.current = null;
    };
  }, [esSeguro]);

  const enviar = useCallback(
    async (tipo: "imagen" | "fotograma", datos: { base64: string; miniatura: string }, texto?: string) => {
      if (refEnviando.current) return;
      refEnviando.current = true;
      setEnviando(true);
      setAviso(null);
      setMiniatura(datos.miniatura);
      try {
        await enviarObservacion({
          tipo,
          imagenBase64: datos.base64,
          imagenMime: "image/jpeg",
          texto: texto?.trim() || undefined,
        });
      } catch (err) {
        setAviso(err instanceof Error ? err.message : String(err));
      } finally {
        refEnviando.current = false;
        setEnviando(false);
      }
    },
    [enviarObservacion],
  );

  async function enviarFoto() {
    const video = refVideo.current;
    if (!video) return;
    const datos = capturarFotograma(video);
    if (!datos) {
      setAviso("La cámara todavía no tiene imagen: espera un segundo y vuelve a intentarlo");
      return;
    }
    await enviar("imagen", datos, comentario);
    setComentario("");
  }

  async function enviarArchivo(archivo: File | undefined) {
    if (!archivo) return;
    try {
      const datos = await archivoABase64(archivo);
      await enviar("imagen", datos, comentario);
      setComentario("");
    } catch (err) {
      setAviso(err instanceof Error ? err.message : String(err));
    }
  }

  // Vigilancia automática: un fotograma cada N s y latido con modo "vigilancia".
  useEffect(() => {
    if (!vigilancia || !hayCamara) return;
    const disparar = () => {
      const video = refVideo.current;
      if (!video) return;
      const datos = capturarFotograma(video);
      if (datos) void enviar("fotograma", datos);
    };
    disparar();
    const id = window.setInterval(disparar, intervalo * 1000);
    return () => window.clearInterval(id);
  }, [vigilancia, intervalo, hayCamara, enviar]);

  function conmutarVigilancia() {
    const siguiente = !vigilancia;
    setVigilancia(siguiente);
    configurarVigilancia(siguiente ? "vigilancia" : "manual", intervalo);
  }

  function cambiarIntervalo(seg: number) {
    setIntervalo(seg);
    if (vigilancia) configurarVigilancia("vigilancia", seg);
  }

  return (
    <div className="flex flex-col gap-4">
      <Tarjeta className="p-3">
        <div className="relative overflow-hidden rounded-xl border border-panel-border bg-panel-2">
          <video ref={refVideo} autoPlay playsInline muted className="aspect-[3/4] w-full object-cover" />
          {!hayCamara && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
              <CircleAlert className="size-7 text-warning" aria-hidden="true" />
              <p className="text-[13.5px] leading-relaxed text-muted">
                {falloCamara ?? "Pidiendo acceso a la cámara…"}
              </p>
            </div>
          )}
          {vigilancia && (
            <span className="pildora pildora-peligro absolute left-2 top-2">Vigilancia · {intervalo} s</span>
          )}
        </div>

        <label htmlFor="comentario-foto" className="etiqueta mt-3 block">
          ¿Qué ves? (opcional)
        </label>
        <input
          id="comentario-foto"
          className={`${CLASE_ENTRADA} mt-1.5`}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          placeholder="Humo negro saliendo de la nave"
          maxLength={200}
        />

        <div className="mt-3 flex flex-col gap-2">
          {hayCamara ? (
            <BotonGrande onClick={enviarFoto} deshabilitado={enviando}>
              {enviando ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Camera className="size-5" aria-hidden="true" />}
              {enviando ? "Enviando…" : "Enviar foto"}
            </BotonGrande>
          ) : (
            <label className="boton boton-primario min-h-[52px] w-full cursor-pointer px-4 text-[15px]">
              <Camera className="size-5" aria-hidden="true" />
              {enviando ? "Enviando…" : "Hacer o elegir una foto"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  void enviarArchivo(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      </Tarjeta>

      <Tarjeta>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold text-foreground">Vigilancia automática</p>
            <p className="text-[13px] leading-snug text-muted">Envía un fotograma cada pocos segundos y solo avisa cuando la escena cambia.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={vigilancia}
            aria-label="Vigilancia automática"
            onClick={conmutarVigilancia}
            disabled={!hayCamara}
            className={`relative h-8 w-14 shrink-0 rounded-full border transition-colors disabled:opacity-40 ${vigilancia ? "border-brand bg-brand" : "border-panel-border-strong bg-panel-2"}`}
          >
            <span className={`absolute top-1 size-6 rounded-full bg-panel shadow transition-all ${vigilancia ? "left-7" : "left-1"}`} />
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="etiqueta">Cada</span>
          {INTERVALOS.map((seg) => (
            <button key={seg} type="button" className="chip min-h-[36px] px-3" aria-pressed={intervalo === seg} onClick={() => cambiarIntervalo(seg)}>
              {seg} s
            </button>
          ))}
        </div>
      </Tarjeta>

      {aviso && (
        <Aviso tono="peligro" titulo="No se pudo enviar">
          {aviso}
        </Aviso>
      )}

      {ultimoResultado && <ResumenResultado resultado={ultimoResultado} miniatura={miniatura} />}
    </div>
  );
}
