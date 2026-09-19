"use client";
// Confirmación de un foco declarado a mano: nombre opcional y notas.
// DUEÑO: constructor E.

import { useState } from "react";
import { Flame } from "lucide-react";
import type { Punto } from "@/lib/dominio/tipos";
import { Boton } from "@/components/ui/Boton";
import { Dialogo } from "@/components/ui/Dialogo";

export function DialogoDeclararFoco({
  punto,
  onCerrar,
  onConfirmar,
  ocupado,
}: {
  punto: Punto | null;
  onCerrar: () => void;
  onConfirmar: (datos: { nombre?: string; notas?: string }) => void | Promise<void>;
  ocupado: boolean;
}) {
  const [nombre, setNombre] = useState("");
  const [notas, setNotas] = useState("");

  // Cada punto nuevo estrena formulario. Se ajusta en el render (patrón oficial
  // de React para "estado derivado de props") en vez de en un efecto.
  const [puntoPrevio, setPuntoPrevio] = useState(punto);
  if (punto !== puntoPrevio) {
    setPuntoPrevio(punto);
    setNombre("");
    setNotas("");
  }

  return (
    <Dialogo
      abierto={punto !== null}
      onCerrar={onCerrar}
      titulo="Declarar un foco"
      descripcion="El núcleo buscará el municipio, el entorno (pueblos, parques, hospitales) y la meteo reales de esas coordenadas."
      ancho="sm"
      pie={
        <>
          <Boton variante="fantasma" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono={<Flame />} cargando={ocupado} onClick={() => onConfirmar({ nombre: nombre.trim() || undefined, notas: notas.trim() || undefined })}>
            Declarar foco
          </Boton>
        </>
      }
    >
      <p className="tabular mb-3 rounded-lg border border-panel-border bg-panel-2 px-2.5 py-1.5 text-[13px] text-muted">
        Coordenadas: {punto?.lat.toFixed(5)}, {punto?.lon.toFixed(5)}
      </p>
      <label htmlFor="foco-nombre" className="mb-1 block text-[13px] font-medium text-foreground">
        Nombre (opcional)
      </label>
      <input
        id="foco-nombre"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Se toma del municipio si lo dejas vacío"
        className="mb-3 min-h-11 w-full rounded-lg border border-panel-border-strong bg-panel-2 px-2.5 text-sm text-foreground placeholder:text-subtle"
      />
      <label htmlFor="foco-notas" className="mb-1 block text-[13px] font-medium text-foreground">
        Notas (opcional)
      </label>
      <textarea
        id="foco-notas"
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
        rows={3}
        placeholder="Ej.: aviso del 112, columna de humo visible desde la N-403"
        className="w-full rounded-lg border border-panel-border-strong bg-panel-2 p-2 text-sm text-foreground placeholder:text-subtle"
      />
    </Dialogo>
  );
}
