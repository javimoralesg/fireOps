"use client";

// Pantalla del móvil emparejado (poc-07, subagente B). Mobile-first, a pantalla
// completa y sin la cabecera de la consola: cabecera mínima con el estado y
// cuatro pestañas abajo (Cámara · Voz · Publicar · Estado).

import { useState } from "react";
import { Activity, Camera, Mic, Send } from "lucide-react";
import { CamaraMovil } from "@/components/perifericos/CamaraMovil";
import { Emparejar } from "@/components/perifericos/Emparejar";
import { EstadoMovil } from "@/components/perifericos/EstadoMovil";
import { PublicarMovil } from "@/components/perifericos/PublicarMovil";
import { VozMovil } from "@/components/perifericos/VozMovil";
import { Aviso } from "@/components/perifericos/ui-movil";
import type { TipoPeriferico } from "@/lib/tipos-perifericos";
import { usePeriferico } from "@/lib/usePeriferico";

type Pestana = "camara" | "voz" | "publicar" | "estado";

const PESTANAS: { clave: Pestana; texto: string; Icono: typeof Camera }[] = [
  { clave: "camara", texto: "Cámara", Icono: Camera },
  { clave: "voz", texto: "Voz", Icono: Mic },
  { clave: "publicar", texto: "Publicar", Icono: Send },
  { clave: "estado", texto: "Estado", Icono: Activity },
];

const NOMBRE_TIPO: Record<TipoPeriferico, string> = {
  movil_ciudadano: "Ciudadano",
  camara_fija: "Cámara fija",
  efectivo: "Efectivo",
  pma: "Puesto de mando avanzado",
  camara_trafico: "Cámara de tráfico",
  sensor: "Sensor",
  webhook: "Canal externo",
};

export default function PaginaPeriferico() {
  const per = usePeriferico();
  const [pestana, setPestana] = useState<Pestana>("camara");

  // Mientras no haya emparejamiento (incluido el primer render del servidor) se
  // muestra el formulario: es lo que ve el jurado al escanear el QR.
  if (!per.periferico) {
    return <Emparejar onEmparejar={per.emparejar} esSeguro={per.esSeguro} error={per.error} />;
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-panel-border bg-panel/95 px-4 py-2.5 backdrop-blur">
        <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
          {per.enLinea && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />}
          <span className={`relative inline-flex size-2.5 rounded-full ${per.enLinea ? "bg-success" : "bg-warning"}`} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-semibold text-foreground">{per.periferico.nombre}</p>
          <p className="truncate text-[12px] text-muted">
            {per.enLinea ? "En línea" : "Reconectando…"} · {NOMBRE_TIPO[per.periferico.tipo]}
          </p>
        </div>
        <button type="button" className="boton boton-secundario boton-sm min-h-[40px]" onClick={() => void per.desconectar()}>
          Desconectar
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pb-[calc(84px+env(safe-area-inset-bottom))] pt-3">
        {!per.esSeguro && (
          <div className="mb-3">
            <Aviso tono="aviso" titulo="Esta página no va por HTTPS">
              Abre esta página por HTTPS (túnel) para usar cámara, GPS y micrófono; el texto y las publicaciones funcionan igual.
            </Aviso>
          </div>
        )}

        {pestana === "camara" && <CamaraMovil per={per} />}
        {pestana === "voz" && <VozMovil per={per} />}
        {pestana === "publicar" && <PublicarMovil per={per} />}
        {pestana === "estado" && <EstadoMovil per={per} />}
      </main>

      <nav
        aria-label="Secciones del periférico"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-panel-border bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        {PESTANAS.map(({ clave, texto, Icono }) => (
          <button
            key={clave}
            type="button"
            aria-current={pestana === clave}
            onClick={() => setPestana(clave)}
            className={`flex min-h-[60px] flex-col items-center justify-center gap-1 text-[12px] font-semibold ${pestana === clave ? "text-brand" : "text-muted"}`}
          >
            <Icono className="size-5" aria-hidden="true" />
            {texto}
          </button>
        ))}
      </nav>
    </div>
  );
}
