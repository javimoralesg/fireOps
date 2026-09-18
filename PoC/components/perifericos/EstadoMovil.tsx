"use client";

// Estado del periférico (poc-07, subagente B): lo que el sistema sabe de este
// móvil. Además hace de sensor: una sacudida fuerte (> 25 m/s² de pico) se
// envía como observación "sensor" con antirrebote de 5 s.

import { useCallback, useEffect, useRef, useState } from "react";
import { Compass, Waves } from "lucide-react";
import type { UsoPeriferico } from "@/lib/usePeriferico";
import { leerBateria } from "@/lib/usePeriferico";
import { Aviso, BotonGrande, Dato, Tarjeta, formatearHora, haceSegundos, porcentaje } from "./ui-movil";

const UMBRAL_SACUDIDA = 25; // m/s²
const ANTIRREBOTE_MS = 5000;

type MovimientoConPermiso = { requestPermission?: () => Promise<string> };

export function EstadoMovil({ per }: { per: UsoPeriferico }) {
  const { periferico, detalle, posicion, rumbo, ultimoLatido, permisoBrujula, pedirPermisoBrujula, enviarObservacion } = per;
  const [bateria, setBateria] = useState<{ nivel: number; cargando: boolean } | null>(null);
  const [sacudida, setSacudida] = useState<{ valor: number; timestamp: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [tic, setTic] = useState(0);
  const refUltima = useRef(0);

  const esUnidad = periferico?.tipo === "efectivo" || periferico?.tipo === "pma";

  useEffect(() => {
    const id = window.setInterval(() => setTic((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let vivo = true;
    void leerBateria().then((b) => {
      if (vivo) setBateria(b);
    });
    const id = window.setInterval(() => void leerBateria().then((b) => vivo && setBateria(b)), 30_000);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, []);

  const alMover = useCallback(
    (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x === null || a.y === null || a.z === null) return;
      const magnitud = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
      if (magnitud < UMBRAL_SACUDIDA) return;
      const ahora = Date.now();
      if (ahora - refUltima.current < ANTIRREBOTE_MS) return;
      refUltima.current = ahora;
      const valor = Math.round(magnitud * 10) / 10;
      setSacudida({ valor, timestamp: new Date().toISOString() });
      void enviarObservacion({
        tipo: "sensor",
        sensor: { magnitud: "aceleracion", valor, unidad: "m/s2" },
        texto: `Sacudida detectada en el móvil (${valor} m/s²)`,
      }).catch((err: unknown) => setAviso(err instanceof Error ? err.message : String(err)));
    },
    [enviarObservacion],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) return;
    window.addEventListener("devicemotion", alMover);
    return () => window.removeEventListener("devicemotion", alMover);
  }, [alMover]);

  async function activarSensores() {
    await pedirPermisoBrujula();
    const constructor = window.DeviceMotionEvent as unknown as MovimientoConPermiso;
    if (constructor?.requestPermission) {
      try {
        await constructor.requestPermission();
      } catch {
        setAviso("iOS ha denegado el acelerómetro: la detección de sacudidas no funcionará");
      }
    }
  }

  return (
    <div className="flex flex-col gap-4" data-tic={tic}>
      <Tarjeta>
        <p className="etiqueta">Posición y sensores</p>
        <div className="mt-1">
          <Dato
            etiqueta="Posición"
            mono
            valor={posicion ? `${posicion.lat.toFixed(5)}, ${posicion.lon.toFixed(5)}` : "sin señal"}
          />
          <Dato etiqueta="Precisión" valor={posicion?.precisionM !== undefined ? `± ${posicion.precisionM} m` : "—"} />
          <Dato etiqueta="Rumbo" valor={rumbo === null ? "sin brújula" : `${rumbo}°`} />
          <Dato
            etiqueta="Batería"
            valor={bateria ? `${Math.round(bateria.nivel * 100)} %${bateria.cargando ? " · cargando" : ""}` : "no disponible"}
          />
          <Dato etiqueta="Último latido" valor={haceSegundos(ultimoLatido)} />
        </div>
        {permisoBrujula !== "concedido" && permisoBrujula !== "no_aplica" && (
          <div className="mt-3">
            <BotonGrande tono="secundario" onClick={() => void activarSensores()}>
              <Compass className="size-5" aria-hidden="true" />
              Activar brújula y acelerómetro
            </BotonGrande>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-subtle">
              En iPhone hace falta tocar este botón: el sistema solo concede la brújula tras un gesto tuyo.
            </p>
          </div>
        )}
      </Tarjeta>

      <Tarjeta>
        <p className="etiqueta">Este periférico</p>
        <div className="mt-1">
          <Dato etiqueta="Nombre" valor={periferico?.nombre ?? "—"} />
          <Dato etiqueta="Identificador" mono valor={periferico?.id ?? "—"} />
          <Dato etiqueta="Modo" valor={detalle?.modo === "vigilancia" ? `vigilancia · ${detalle.intervaloVigilanciaSeg} s` : "manual"} />
          <Dato etiqueta="Observaciones enviadas" valor={detalle?.observaciones ?? 0} />
          <Dato etiqueta="Confianza" valor={detalle ? porcentaje(detalle.confianza) : "—"} />
          {detalle?.ultimaObservacion && (
            <Dato etiqueta="Última observación" valor={`${detalle.ultimaObservacion.resumen} · ${formatearHora(detalle.ultimaObservacion.timestamp)}`} />
          )}
        </div>
        {esUnidad && (
          <p className="mt-3 rounded-xl border border-info/35 bg-info/10 px-3 py-2 text-[13px] leading-relaxed text-muted">
            Tu posición mueve tu unidad en el mapa del mando.
          </p>
        )}
      </Tarjeta>

      {sacudida && (
        <Aviso tono="aviso" titulo="Sacudida detectada">
          <span className="inline-flex items-center gap-1.5">
            <Waves className="size-4" aria-hidden="true" />
            {sacudida.valor} m/s² a las {formatearHora(sacudida.timestamp)} · enviada como observación de sensor.
          </span>
        </Aviso>
      )}

      {aviso && <Aviso tono="peligro">{aviso}</Aviso>}
    </div>
  );
}
