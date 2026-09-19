"use client";
// Panel derecho de la sala: pestañas con lo que requiere decisión, los agentes,
// los focos, el registro vivo y las lecciones. En tablet se convierte en hoja
// inferior. DUEÑO: constructor E.

import { Flame, GraduationCap, Inbox, PanelRightClose, PanelRightOpen, ScrollText } from "lucide-react";
import type { Snapshot } from "@/lib/dominio/tipos";
import { PanelPestana, Pestanas, type Pestana } from "@/components/ui/Pestanas";
import { Boton } from "@/components/ui/Boton";
import { PestanaDecisiones } from "./PestanaDecisiones";
import { PestanaFocos } from "./PestanaFocos";
import { PestanaLecciones } from "./PestanaLecciones";
import { PestanaRegistro } from "./PestanaRegistro";

export type ClavePestana = "decisiones" | "focos" | "registro" | "lecciones";

export function PanelDerecho({
  snapshot,
  activa,
  onCambiarPestana,
  plegado,
  onPlegar,
  onRefrescar,
  onCentrarIncendio,
  onCentrarUnidad,
  incendioSeleccionado,
}: {
  snapshot?: Snapshot;
  activa: ClavePestana;
  onCambiarPestana: (p: ClavePestana) => void;
  plegado: boolean;
  onPlegar: () => void;
  onRefrescar?: () => void;
  onCentrarIncendio?: (id: string) => void;
  onCentrarUnidad?: (id: string) => void;
  incendioSeleccionado?: string;
}) {
  const pendientes = (snapshot?.decisiones ?? []).filter((d) => d.estado === "pendiente_humano" || d.estado === "escalada").length;
  const focosActivos = (snapshot?.incendios ?? []).filter((i) => !["extinguido", "descartado", "fusionado"].includes(i.estado)).length;

  const pestanas: Pestana[] = [
    { id: "decisiones", etiqueta: "Requiere tu decisión", cuenta: pendientes, icono: <Inbox />, urgente: true },
    { id: "focos", etiqueta: "Focos", cuenta: focosActivos, icono: <Flame /> },
    { id: "registro", etiqueta: "Registro", icono: <ScrollText /> },
    { id: "lecciones", etiqueta: "Lecciones", cuenta: snapshot?.lecciones.length ?? 0, icono: <GraduationCap /> },
  ];

  if (plegado) {
    return (
      <div className="absolute right-2 top-2 z-[950] lg:static lg:flex lg:items-start lg:p-2">
        <Boton
          icono={<PanelRightOpen />}
          variante={pendientes > 0 ? "peligro" : "secundario"}
          onClick={onPlegar}
          className="shadow-[var(--sombra-flotante)]"
        >
          {pendientes > 0 ? `${pendientes} decisiones` : "Abrir panel"}
        </Boton>
      </div>
    );
  }

  return (
    <aside
      aria-label="Panel de mando"
      className="flex max-h-[55vh] w-full shrink-0 flex-col border-t border-panel-border bg-panel lg:max-h-none lg:w-[26.25rem] lg:border-l lg:border-t-0"
    >
      <div className="flex items-center gap-1 border-b border-panel-border px-1.5 py-1">
        <Pestanas
          pestanas={pestanas}
          activa={activa}
          onCambiar={(id) => onCambiarPestana(id as ClavePestana)}
          idBase="panel"
          className="min-w-0 flex-1"
        />
        <Boton tamano="sm" variante="fantasma" icono={<PanelRightClose />} onClick={onPlegar} className="shrink-0">
          <span className="solo-lectores">Plegar el panel</span>
        </Boton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5 scroll-fino">
        <PanelPestana id="decisiones" activa={activa} idBase="panel">
          <PestanaDecisiones
            snapshot={snapshot}
            onTrasDecidir={onRefrescar}
            onCentrarIncendio={onCentrarIncendio}
            onCentrarUnidad={onCentrarUnidad}
          />
        </PanelPestana>
        <PanelPestana id="focos" activa={activa} idBase="panel">
          <PestanaFocos snapshot={snapshot} onCentrar={onCentrarIncendio} onTrasCambio={onRefrescar} seleccionado={incendioSeleccionado} />
        </PanelPestana>
        <PanelPestana id="registro" activa={activa} idBase="panel">
          <PestanaRegistro snapshot={snapshot} />
        </PanelPestana>
        <PanelPestana id="lecciones" activa={activa} idBase="panel">
          <PestanaLecciones snapshot={snapshot} />
        </PanelPestana>
      </div>
    </aside>
  );
}
