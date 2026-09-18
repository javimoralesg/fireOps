"use client";

// Alta del móvil como periférico (poc-07, subagente B). Es lo primero que ve el
// jurado al abrir el QR: nombre, para qué va a servir el móvil y "Conectar".

import { useState } from "react";
import { Radio, ShieldAlert } from "lucide-react";
import type { TipoPeriferico } from "@/lib/tipos-perifericos";
import type { DatosEmparejar } from "@/lib/usePeriferico";
import { Aviso, BotonGrande, CLASE_ENTRADA } from "./ui-movil";

const TIPOS: { tipo: TipoPeriferico; titulo: string; frase: string }[] = [
  { tipo: "movil_ciudadano", titulo: "Ciudadano", frase: "Envías fotos, avisos de voz y publicaciones desde donde estés." },
  { tipo: "camara_fija", titulo: "Cámara fija", frase: "Dejas el móvil apuntando a una escena y manda un fotograma cada pocos segundos." },
  { tipo: "efectivo", titulo: "Efectivo", frase: "Eres bomberos, policía o sanitarios: tu posición mueve tu unidad en el mapa del mando." },
  { tipo: "pma", titulo: "Puesto de mando avanzado", frase: "Coordinas sobre el terreno: tus partes llegan con la máxima confianza." },
];

export function Emparejar({
  onEmparejar,
  esSeguro,
  error,
}: {
  onEmparejar: (datos: DatosEmparejar) => Promise<unknown>;
  esSeguro: boolean;
  error: string | null;
}) {
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<TipoPeriferico>("movil_ciudadano");
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  async function conectar() {
    const limpio = nombre.trim();
    if (!limpio) {
      setFallo("Pon un nombre para reconocer este móvil en la consola");
      return;
    }
    setFallo(null);
    setEnviando(true);
    try {
      await onEmparejar({ nombre: limpio, tipo });
    } catch (err) {
      setFallo(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6">
      <header className="text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand/12 text-brand ring-1 ring-brand/30">
          <Radio className="size-6" aria-hidden="true" />
        </span>
        <h1 className="mt-3 text-[24px] font-bold text-foreground">Conecta tu móvil a Atalaya</h1>
        <p className="mt-1 text-[14.5px] leading-relaxed text-muted">
          Este móvil pasa a ser un periférico del centro de mando: lo que envíes entra en el sistema como una observación real.
        </p>
      </header>

      {!esSeguro && (
        <Aviso tono="aviso" titulo="Esta página no va por HTTPS">
          Abre el enlace del túnel (https://) para usar cámara, GPS y micrófono. El texto y las publicaciones funcionan igual.
        </Aviso>
      )}

      <div>
        <label htmlFor="nombre-periferico" className="etiqueta">
          Nombre del periférico
        </label>
        <input
          id="nombre-periferico"
          className={`${CLASE_ENTRADA} mt-1.5`}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Móvil de Javi"
          maxLength={60}
          autoComplete="off"
          enterKeyHint="done"
        />
      </div>

      <fieldset>
        <legend className="etiqueta">¿Qué papel tiene este móvil?</legend>
        <div className="mt-1.5 flex flex-col gap-2">
          {TIPOS.map((t) => (
            <button
              key={t.tipo}
              type="button"
              aria-pressed={tipo === t.tipo}
              onClick={() => setTipo(t.tipo)}
              className={`fila-interactiva min-h-[64px] px-3 py-2.5 text-left ${tipo === t.tipo ? "fila-interactiva-activa" : ""}`}
            >
              <span className="block text-[15px] font-semibold text-foreground">{t.titulo}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-muted">{t.frase}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {(fallo || error) && (
        <Aviso tono="peligro" titulo="No se ha podido conectar">
          {fallo ?? error}
        </Aviso>
      )}

      <BotonGrande onClick={conectar} deshabilitado={enviando}>
        {enviando ? "Conectando…" : "Conectar"}
      </BotonGrande>

      <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-subtle">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        No se guarda ningún dato personal: solo un identificador de este dispositivo, su posición mientras esté conectado y lo que envíes.
      </p>
    </div>
  );
}
