"use client";
// Ayuda de atajos de teclado. DUEÑO: constructor E.

import { Dialogo } from "@/components/ui/Dialogo";

export const ATAJOS: { tecla: string; que: string }[] = [
  { tecla: "F", que: "Declarar un foco: el cursor pasa a cruz y el clic en el mapa lo crea" },
  { tecla: "A", que: "Aprobar la primera decisión pendiente" },
  { tecla: "D", que: "Denegar la primera decisión pendiente (pide motivo)" },
  { tecla: "Espacio", que: "Pausar o reanudar el tiempo de mundo" },
  { tecla: "V", que: "Ver todo en el mapa: encuadra los focos activos y sus medios (o España entera si ya estaba encuadrado)" },
  { tecla: "G", que: "Abrir o cerrar la vista de agentes a pantalla completa" },
  { tecla: "Esc", que: "Salir del modo declarar foco o cerrar el diálogo abierto" },
  { tecla: "?", que: "Mostrar esta ayuda" },
];

export function DialogoAtajos({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Atajos de teclado"
      descripcion="No se activan mientras escribes en un campo de texto."
      ancho="sm"
    >
      <ul className="space-y-1.5">
        {ATAJOS.map((a) => (
          <li key={a.tecla} className="flex items-start gap-2.5">
            <kbd className="min-w-14 shrink-0 rounded-md border border-panel-border-strong bg-panel-2 px-2 py-0.5 text-center text-[12px] font-semibold text-foreground">
              {a.tecla}
            </kbd>
            <span className="text-[13px] leading-snug text-muted">{a.que}</span>
          </li>
        ))}
      </ul>
    </Dialogo>
  );
}
