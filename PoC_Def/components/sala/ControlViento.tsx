"use client";
// =====================================================================
// "Viento (ejercicio)": el mando decide a mano DESDE dónde sopla y con
// qué fuerza, para ensayar escenarios. DUEÑO: constructor H.
// ---------------------------------------------------------------------
// Rosa de los vientos arrastrable (ratón, dedo y teclado: flechas giran
// 5° y con Mayús 15°) + deslizador de intensidad y rachas. El convenio
// es el de `Meteo.direccionGrados`: DESDE dónde sopla. La flecha del
// dibujo apunta HACIA dónde va, que es lo que la gente espera ver.
//
// Al aplicar se llama a POST /api/focos/[id]/viento (o /api/viento para
// todos los focos activos) y el núcleo marca `incendio.meteoForzada`.
// =====================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Wind } from "lucide-react";
import { fijarViento, fijarVientoGlobal, mensajeDeError, quitarViento, quitarVientoGlobal } from "@/lib/cliente/api";
import { rumboTexto } from "@/lib/cliente/formato";
import { Boton } from "@/components/ui/Boton";
import { Insignia } from "@/components/ui/Insignia";
import { useToast } from "@/components/ui/Toast";

/** Quién firma el forzado (mismo criterio que las aprobaciones de la sala). */
export const QUIEN_VIENTO = "Sala de mando";

const LADO = 132;
const CENTRO = LADO / 2;
const RADIO = LADO / 2 - 14;

export interface ValorViento {
  direccionGrados: number;
  vientoKmh: number;
  rachasKmh?: number;
}

export function ControlViento({
  /** Foco al que se aplica; sin `focoId` se aplica a TODOS los activos. */
  focoId,
  inicial,
  forzado,
  onCambio,
  compacto = false,
}: {
  focoId?: string;
  inicial?: ValorViento;
  /** Quién lo fijó, si ya está forzado. */
  forzado?: { fijadoPor: string; en: string };
  onCambio?: () => void;
  compacto?: boolean;
}) {
  const toast = useToast();
  const [grados, setGrados] = useState(() => Math.round(inicial?.direccionGrados ?? 315));
  const [kmh, setKmh] = useState(() => Math.round(inicial?.vientoKmh ?? 25));
  const [rachas, setRachas] = useState<number | "">(() => (inicial?.rachasKmh ? Math.round(inicial.rachasKmh) : ""));
  const [ocupado, setOcupado] = useState<"aplicar" | "quitar" | null>(null);
  const rosa = useRef<SVGSVGElement>(null);

  // Si el snapshot trae otro viento (otro foco, o el forzado de otro usuario),
  // el control se pone al día mientras no se esté arrastrando.
  const arrastrando = useRef(false);
  useEffect(() => {
    if (arrastrando.current || !inicial) return;
    setGrados(Math.round(inicial.direccionGrados));
    setKmh(Math.round(inicial.vientoKmh));
  }, [inicial?.direccionGrados, inicial?.vientoKmh]); // eslint-disable-line react-hooks/exhaustive-deps

  const desdePuntero = useCallback((clienteX: number, clienteY: number) => {
    const caja = rosa.current?.getBoundingClientRect();
    if (!caja) return;
    const x = clienteX - (caja.left + caja.width / 2);
    const y = clienteY - (caja.top + caja.height / 2);
    if (Math.abs(x) < 2 && Math.abs(y) < 2) return;
    // Pantalla → rumbo: 0° arriba, creciendo en el sentido de las agujas.
    const hacia = (Math.atan2(x, -y) * 180) / Math.PI;
    // El usuario apunta HACIA dónde va; se guarda DESDE dónde sopla.
    setGrados(Math.round(((hacia + 180) % 360 + 360) % 360));
  }, []);

  useEffect(() => {
    const mover = (e: PointerEvent) => {
      if (!arrastrando.current) return;
      e.preventDefault();
      desdePuntero(e.clientX, e.clientY);
    };
    const soltar = () => {
      arrastrando.current = false;
    };
    window.addEventListener("pointermove", mover, { passive: false });
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);
    return () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointercancel", soltar);
    };
  }, [desdePuntero]);

  async function aplicar() {
    setOcupado("aplicar");
    const cuerpo = {
      direccionGrados: grados,
      vientoKmh: kmh,
      rachasKmh: rachas === "" ? undefined : Number(rachas),
      quien: QUIEN_VIENTO,
    };
    try {
      if (focoId) {
        await fijarViento(focoId, cuerpo);
        toast.exito("Viento del ejercicio aplicado", `${rumboTexto(grados)} ${grados}° · ${kmh} km/h. Los agentes replanifican.`);
      } else {
        const { afectados } = await fijarVientoGlobal(cuerpo);
        toast.exito(`Viento aplicado a ${afectados} foco(s)`, `${rumboTexto(grados)} ${grados}° · ${kmh} km/h.`);
      }
      onCambio?.();
    } catch (e) {
      toast.error("No se ha podido fijar el viento", mensajeDeError(e));
    } finally {
      setOcupado(null);
    }
  }

  async function quitar() {
    setOcupado("quitar");
    try {
      if (focoId) await quitarViento(focoId, QUIEN_VIENTO);
      else await quitarVientoGlobal(QUIEN_VIENTO);
      toast.info("De vuelta a la previsión real", "Open-Meteo vuelve a mandar sobre el viento.");
      onCambio?.();
    } catch (e) {
      toast.error("No se ha podido quitar el viento forzado", mensajeDeError(e));
    } finally {
      setOcupado(null);
    }
  }

  // La flecha se dibuja HACIA dónde sopla: dirección + 180°.
  const hacia = (grados + 180) % 360;
  const rad = (hacia * Math.PI) / 180;
  const puntaX = CENTRO + Math.sin(rad) * RADIO;
  const puntaY = CENTRO - Math.cos(rad) * RADIO;
  const colaX = CENTRO - Math.sin(rad) * RADIO * 0.72;
  const colaY = CENTRO + Math.cos(rad) * RADIO * 0.72;

  return (
    <div className={compacto ? "space-y-2" : "space-y-2.5"}>
      {forzado ? (
        <Insignia pequena tono="aviso" punto>
          Viento forzado por {forzado.fijadoPor}
        </Insignia>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <svg
          ref={rosa}
          viewBox={`0 0 ${LADO} ${LADO}`}
          width={LADO}
          height={LADO}
          role="slider"
          tabIndex={0}
          aria-label="Dirección desde la que sopla el viento"
          aria-valuemin={0}
          aria-valuemax={359}
          aria-valuenow={grados}
          aria-valuetext={`${rumboTexto(grados)} ${grados} grados`}
          className="shrink-0 cursor-grab touch-none rounded-full border border-panel-border bg-panel-2 active:cursor-grabbing"
          onPointerDown={(e) => {
            arrastrando.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            desdePuntero(e.clientX, e.clientY);
          }}
          onKeyDown={(e) => {
            const paso = e.shiftKey ? 15 : 5;
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
              e.preventDefault();
              setGrados((g) => (g - paso + 360) % 360);
            } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
              e.preventDefault();
              setGrados((g) => (g + paso) % 360);
            }
          }}
        >
          <circle cx={CENTRO} cy={CENTRO} r={RADIO} fill="none" stroke="currentColor" strokeWidth={1} className="text-panel-border-strong" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((g) => {
            const r = (g * Math.PI) / 180;
            const x1 = CENTRO + Math.sin(r) * (RADIO - 5);
            const y1 = CENTRO - Math.cos(r) * (RADIO - 5);
            const x2 = CENTRO + Math.sin(r) * RADIO;
            const y2 = CENTRO - Math.cos(r) * RADIO;
            return <line key={g} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={g % 90 === 0 ? 1.8 : 1} className="text-muted" />;
          })}
          {(
            [
              ["N", CENTRO, 11],
              ["E", LADO - 7, CENTRO + 4],
              ["S", CENTRO, LADO - 4],
              ["O", 7, CENTRO + 4],
            ] as [string, number, number][]
          ).map(([t, x, y]) => (
            <text key={t} x={x} y={y} textAnchor="middle" fontSize={10} fontWeight={600} fill="currentColor" className="text-subtle">
              {t}
            </text>
          ))}
          <defs>
            <marker id="punta-viento" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          <line
            x1={colaX}
            y1={colaY}
            x2={puntaX}
            y2={puntaY}
            stroke="currentColor"
            strokeWidth={3.5}
            strokeLinecap="round"
            markerEnd="url(#punta-viento)"
            className="text-fuego"
          />
          <circle cx={CENTRO} cy={CENTRO} r={4} fill="currentColor" className="text-fuego" />
        </svg>

        <div className="min-w-[8rem] flex-1">
          <p className="tabular text-2xl font-semibold leading-none text-foreground">
            {rumboTexto(grados)} {grados}°
          </p>
          <p className="mt-0.5 text-[11px] text-muted">Desde donde sopla · arrastra la rosa o usa las flechas</p>

          <label htmlFor={`kmh-${focoId ?? "global"}`} className="mt-2 block text-[11.5px] font-medium text-foreground">
            Intensidad
          </label>
          <div className="flex items-center gap-2">
            <input
              id={`kmh-${focoId ?? "global"}`}
              type="range"
              min={0}
              max={120}
              step={1}
              value={kmh}
              onChange={(e) => setKmh(Number(e.target.value))}
              className="h-9 min-w-0 flex-1 accent-[var(--fuego)]"
            />
            <span className="tabular w-[4.5rem] shrink-0 text-right text-xl font-semibold text-foreground">
              {kmh}
              <span className="text-[11px] font-normal text-muted"> km/h</span>
            </span>
          </div>

          <label htmlFor={`rachas-${focoId ?? "global"}`} className="mt-1.5 block text-[11.5px] font-medium text-foreground">
            Rachas (opcional)
          </label>
          <input
            id={`rachas-${focoId ?? "global"}`}
            type="number"
            min={0}
            max={250}
            value={rachas}
            placeholder="sin rachas"
            onChange={(e) => setRachas(e.target.value === "" ? "" : Number(e.target.value))}
            className="min-h-9 w-full rounded-lg border border-panel-border-strong bg-panel-2 px-2 text-[13px] text-foreground placeholder:text-subtle"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Boton tamano="sm" variante="primario" icono={<Wind />} cargando={ocupado === "aplicar"} onClick={aplicar}>
          Aplicar
        </Boton>
        <Boton tamano="sm" variante="secundario" icono={<RotateCcw />} cargando={ocupado === "quitar"} onClick={quitar}>
          Volver a la previsión real
        </Boton>
      </div>
      <p className="text-[11px] leading-snug text-subtle">
        Es un ejercicio: el viento queda marcado como forzado, se registra en el evento crítico «viento gira» y los agentes de
        propagación, coordinación y aviso a la población replanifican con él.
      </p>
    </div>
  );
}
